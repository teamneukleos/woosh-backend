import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AnalyticsEventType,
  ObligationStatus,
  SocialConnectionStatus,
} from '@prisma/client';
import { asNumber } from '../common/fees';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import type { LogCampaignMetricDto } from './dto/analytics.dto';
import {
  clampInsightDays,
  daysAgo,
  latestMetricsByContent,
  sumMetrics,
  utcDayStart,
} from './analytics.util';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async record(input: {
    eventType: AnalyticsEventType;
    actorUserId?: string;
    organisationId?: string;
    brandId?: string;
    creatorProfileId?: string;
    briefId?: string;
    campaignId?: string;
    metadata?: object;
    dedupePerDay?: boolean;
  }) {
    if (input.dedupePerDay && input.actorUserId && input.creatorProfileId) {
      const existing = await this.prisma.analyticsEvent.findFirst({
        where: {
          eventType: input.eventType,
          actorUserId: input.actorUserId,
          creatorProfileId: input.creatorProfileId,
          createdAt: { gte: utcDayStart() },
        },
        select: { id: true },
      });
      if (existing) return existing;
    }
    return this.prisma.analyticsEvent.create({
      data: {
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        organisationId: input.organisationId,
        brandId: input.brandId,
        creatorProfileId: input.creatorProfileId,
        briefId: input.briefId,
        campaignId: input.campaignId,
        metadata: input.metadata,
      },
    });
  }

  async recordBestEffort(input: Parameters<AnalyticsService['record']>[0]) {
    try {
      return await this.record(input);
    } catch (error) {
      this.logger.warn(
        `Analytics event ${input.eventType} failed`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  async creatorInsights(creatorProfileId: string, days?: number) {
    const window = clampInsightDays(days);
    const since = daysAgo(window);
    const snapshotSince = daysAgo(90);
    const monthStart = daysAgo(30);
    const [accounts, events, applications, invitations, campaigns, earnings] =
      await Promise.all([
        this.prisma.socialAccount.findMany({
          where: {
            creatorProfileId,
            status: SocialConnectionStatus.ACTIVE,
          },
          include: {
            snapshots: {
              where: {
                capturedAt: { gte: snapshotSince },
                source: { not: 'manual_unverified' },
              },
              orderBy: { capturedAt: 'asc' },
            },
          },
        }),
        this.prisma.analyticsEvent.groupBy({
          by: ['eventType'],
          where: { creatorProfileId, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.application.findMany({
          where: { creatorProfileId, createdAt: { gte: since } },
          select: { status: true },
        }),
        this.prisma.briefInvitation.findMany({
          where: { creatorProfileId, createdAt: { gte: since } },
          select: { status: true, viewedAt: true },
        }),
        this.prisma.campaignParticipant.findMany({
          where: { creatorProfileId },
          include: {
            campaign: {
              include: {
                metrics: {
                  where: { creatorProfileId },
                  orderBy: { capturedAt: 'desc' },
                },
                brand: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.paymentObligation.findMany({
          where: { participant: { creatorProfileId } },
          select: { status: true, netAmount: true, createdAt: true },
        }),
      ]);

    const eventCounts = Object.fromEntries(
      events.map((event) => [event.eventType, event._count._all]),
    );

    const earningsSummary = earnings.reduce(
      (summary, row) => {
        const value = asNumber(row.netAmount) ?? 0;
        summary.total += value;
        if (row.status === ObligationStatus.PAID) summary.paid += value;
        else if (row.status === ObligationStatus.PROCESSING)
          summary.processing += value;
        else summary.available += value;
        if (row.createdAt >= monthStart) summary.monthToDate += value;
        return summary;
      },
      { total: 0, paid: 0, processing: 0, available: 0, monthToDate: 0 },
    );

    return {
      days: window,
      channels: accounts.map((account) => {
        const first = account.snapshots[0];
        const latest = account.snapshots.at(-1);
        const followers = latest?.followers ?? null;
        const growth =
          followers != null && first?.followers != null
            ? followers - first.followers
            : null;
        return {
          id: account.id,
          channel: account.channel,
          handle: account.handle,
          followers,
          growth,
          engagementRate: asNumber(latest?.engagementRate),
          averageViews: latest?.averageViews ?? null,
          postingFrequency: asNumber(latest?.postingFrequency),
          audienceGeo: latest?.audienceGeo,
          audienceAge: latest?.audienceAge,
          audienceGender: latest?.audienceGender,
          topContent: latest?.topContent,
          source: latest?.source ?? null,
          capturedAt: latest?.capturedAt ?? null,
          history: account.snapshots.map((snapshot) => ({
            capturedAt: snapshot.capturedAt,
            followers: snapshot.followers,
          })),
        };
      }),
      opportunities: {
        profileViews: eventCounts.PROFILE_VIEW ?? 0,
        saves: eventCounts.CREATOR_SAVED ?? 0,
        invites: invitations.length,
        inviteViews: invitations.filter((item) => item.viewedAt).length,
        applications: applications.length,
        shortlisted: applications.filter((item) => item.status === 'SHORTLISTED')
          .length,
        accepted: applications.filter((item) => item.status === 'ACCEPTED')
          .length,
      },
      campaigns: campaigns.map((participant) => {
        const metrics = sumMetrics(
          latestMetricsByContent(participant.campaign.metrics),
        );
        return {
          id: participant.campaign.id,
          title: participant.campaign.title,
          brand: participant.campaign.brand.name,
          status: participant.campaign.status,
          reach: metrics.reach,
          views: metrics.views,
          engagement: metrics.engagement,
        };
      }),
      earnings: earningsSummary,
    };
  }

  async listBrandCampaignMetrics(userId: string, brandId: string) {
    await this.workspace.requireBrandAccess(userId, brandId);
    await this.workspace.requireBrandPermission(
      userId,
      brandId,
      'analytics.view',
    );
    const campaigns = await this.prisma.campaign.findMany({
      where: { brandId },
      include: {
        metrics: { orderBy: { capturedAt: 'desc' }, take: 20 },
        participants: {
          include: { creator: { select: { id: true, displayName: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    const totals = { reach: 0, views: 0, engagement: 0, impressions: 0 };
    for (const campaign of campaigns) {
      const unique = sumMetrics(latestMetricsByContent(campaign.metrics));
      totals.reach += unique.reach;
      totals.views += unique.views;
      totals.engagement += unique.engagement;
      totals.impressions += unique.impressions;
    }

    return {
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        metrics: campaign.metrics.map((metric) => ({
          id: metric.id,
          source: metric.source,
          capturedAt: metric.capturedAt,
          views: metric.views,
          reach: metric.reach,
          impressions: metric.impressions,
          engagement: metric.engagement,
          postUrl: metric.postUrl,
          raw: metric.raw,
        })),
      })),
      totals,
    };
  }

  async logCampaignMetric(
    userId: string,
    campaignId: string,
    input: LogCampaignMetricDto,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { participants: { select: { creatorProfileId: true } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    await this.workspace.requireBrandPermission(
      userId,
      campaign.brandId,
      'campaigns.manage',
    );

    const creatorProfileId =
      input.creatorProfileId ||
      (campaign.participants.length === 1
        ? campaign.participants[0]?.creatorProfileId
        : undefined);
    if (
      creatorProfileId &&
      !campaign.participants.some(
        (participant) => participant.creatorProfileId === creatorProfileId,
      )
    ) {
      throw new BadRequestException('Creator is not part of this campaign');
    }
    if (input.deliverableId) {
      const deliverable = await this.prisma.deliverable.findFirst({
        where: { id: input.deliverableId, campaignId },
        select: { id: true },
      });
      if (!deliverable) {
        throw new BadRequestException('Deliverable is not part of this campaign');
      }
    }
    if (input.submissionId) {
      const submission = await this.prisma.submission.findFirst({
        where: {
          id: input.submissionId,
          deliverable: { campaignId },
        },
        select: { id: true },
      });
      if (!submission) {
        throw new BadRequestException('Submission is not part of this campaign');
      }
    }

    const metric = await this.prisma.campaignMetric.create({
      data: {
        campaignId,
        creatorProfileId,
        deliverableId: input.deliverableId,
        submissionId: input.submissionId,
        postUrl: input.postUrl,
        source: input.source?.trim() || 'manual',
        reach: input.reach,
        impressions: input.impressions,
        views: input.views,
        engagement: input.engagement,
        raw: input.postUrl ? { postUrl: input.postUrl } : undefined,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'campaign.metric.log',
        targetType: 'CampaignMetric',
        targetId: metric.id,
      },
    });
    return metric;
  }
}
