import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BriefDistribution,
  BriefStatus,
  Prisma,
  RateMode,
  SocialChannel,
} from '@prisma/client';
import { asNumber } from '../common/fees';
import { scoreBriefFit } from '../common/matching';
import { automatedBriefChecks, moderationPath } from '../common/trust';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBriefDto } from './dto/create-brief.dto';

@Injectable()
export class BriefsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async create(userId: string, input: CreateBriefDto, headerBrandId?: string) {
    const brandId = input.brandId || headerBrandId;
    if (!brandId) {
      throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    }
    await this.workspace.requireBrandPermission(userId, brandId, 'briefs.manage');
    this.assertRates(input);

    const brief = await this.prisma.brief.create({
      data: {
        brandId,
        title: input.title.trim(),
        description: input.description,
        objective: input.objective,
        category: input.category,
        distribution: (input.distribution as BriefDistribution) ?? BriefDistribution.OPEN,
        rateMode: (input.rateMode as RateMode) ?? RateMode.FIXED_NON_NEGOTIABLE,
        rateAmount: input.rateAmount,
        rateMin: input.rateMin,
        rateMax: input.rateMax,
        currency: input.currency ?? 'NGN',
        channels: (input.channels as SocialChannel[]) ?? [],
        deliverables: input.deliverables as Prisma.InputJsonValue | undefined,
        applicationDeadline: input.applicationDeadline
          ? new Date(input.applicationDeadline)
          : undefined,
        maxCreators: input.maxCreators,
        eligibility: input.eligibility as Prisma.InputJsonValue | undefined,
        rights: input.rights as Prisma.InputJsonValue | undefined,
        timing: input.timing as Prisma.InputJsonValue | undefined,
        status: BriefStatus.DRAFT,
      },
    });
    await this.audit(userId, 'brief.create', 'Brief', brief.id);
    return this.presentBrief(brief);
  }

  async publish(userId: string, briefId: string) {
    const brief = await this.prisma.brief.findUnique({
      where: { id: briefId },
      include: { brand: { include: { organisation: true } } },
    });
    if (!brief) throw new NotFoundException('Brief not found.');
    await this.workspace.requireBrandPermission(userId, brief.brandId, 'briefs.manage');
    if (
      brief.status !== BriefStatus.DRAFT &&
      brief.status !== BriefStatus.PENDING_MODERATION
    ) {
      throw new BadRequestException('Brief cannot be published from the current status.');
    }

    const priorPublishedBriefs = await this.prisma.brief.count({
      where: {
        id: { not: brief.id },
        brand: { organisationId: brief.brand.organisationId },
        status: { in: [BriefStatus.OPEN, BriefStatus.SELECTING, BriefStatus.CLOSED] },
      },
    });
    const checks = automatedBriefChecks({
      title: brief.title,
      description: brief.description,
      category: brief.category,
      currency: brief.currency,
      rates: [
        brief.rateAmount ? Number(brief.rateAmount) : null,
        brief.rateMin ? Number(brief.rateMin) : null,
        brief.rateMax ? Number(brief.rateMax) : null,
      ],
    });
    const path = moderationPath({
      orgVerified: Boolean(brief.brand.organisation.verifiedAt),
      isFirstCampaign: priorPublishedBriefs === 0,
      rateAnomaly: checks.rateAnomaly,
      prohibitedCategory: checks.prohibitedCategory,
    });
    const nextStatus =
      path === 'auto_publish' ? BriefStatus.OPEN : BriefStatus.PENDING_MODERATION;

    const updated = await this.prisma.brief.update({
      where: { id: briefId },
      data: {
        status: nextStatus,
        publishedAt: nextStatus === BriefStatus.OPEN ? new Date() : brief.publishedAt,
      },
    });
    await this.audit(
      userId,
      nextStatus === BriefStatus.OPEN ? 'brief.publish' : 'brief.submit_moderation',
      'Brief',
      briefId,
      { status: nextStatus, moderationPath: path, prohibitedTerms: checks.prohibitedTerms },
    );
    return {
      ...this.presentBrief(updated),
      moderationPath: path,
      message:
        nextStatus === BriefStatus.OPEN
          ? 'Brief is open for applications.'
          : 'Queued for admin review (first brief, unverified org, or flagged copy).',
    };
  }

  async listForBrand(userId: string, brandId?: string) {
    if (!brandId) {
      throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    }
    await this.workspace.requireBrandAccess(userId, brandId);
    const briefs = await this.prisma.brief.findMany({
      where: { brandId },
      include: { _count: { select: { applications: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return briefs.map((brief) => ({
      ...this.presentBrief(brief),
      applicationCount: brief._count.applications,
    }));
  }

  async get(userId: string, briefId: string) {
    const actor = await this.workspace.getWorkActor(userId);
    const access = await this.prisma.brief.findUnique({
      where: { id: briefId },
      select: {
        brandId: true,
        status: true,
        distribution: true,
        invitations: actor.creatorProfileId
          ? { where: { creatorProfileId: actor.creatorProfileId }, select: { id: true } }
          : false,
      },
    });
    if (!access) throw new NotFoundException('Brief not found.');
    const brandAccess = actor.isPlatformAdmin || actor.brandIds.includes(access.brandId);
    const creatorAccess =
      Boolean(actor.creatorProfileId) &&
      (access.status === BriefStatus.OPEN || access.status === BriefStatus.SELECTING) &&
      (access.distribution !== BriefDistribution.INVITE_ONLY ||
        Boolean(access.invitations && access.invitations.length));
    if (!brandAccess && !creatorAccess) {
      throw new ForbiddenException('You cannot view this brief.');
    }

    const brief = await this.prisma.brief.findUniqueOrThrow({
      where: { id: briefId },
      include: {
        brand: { select: { id: true, name: true } },
        invitations: {
          where:
            !brandAccess && actor.creatorProfileId
              ? { creatorProfileId: actor.creatorProfileId }
              : undefined,
        },
        applications: {
          where:
            !brandAccess && actor.creatorProfileId
              ? { creatorProfileId: actor.creatorProfileId }
              : undefined,
          include: {
            creator: { select: { id: true, displayName: true, marketplaceStatus: true } },
            offers: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return {
      ...this.presentBrief(brief),
      brand: brief.brand,
      invitations: brief.invitations,
      applications: brief.applications.map((application) => ({
        ...application,
        proposedRate: asNumber(application.proposedRate),
        offers: application.offers.map((offer) => ({
          ...offer,
          amount: Number(offer.amount),
        })),
      })),
    };
  }

  async listJobs(creatorProfileId: string, tab?: string) {
    const applied = await this.prisma.application.findMany({
      where: { creatorProfileId },
      select: { briefId: true },
    });
    const appliedIds = applied.map((row) => row.briefId);

    if (tab === 'applied') {
      const briefs = await this.prisma.brief.findMany({
        where: { id: { in: appliedIds } },
        include: {
          brand: { select: { id: true, name: true } },
          applications: { where: { creatorProfileId } },
        },
        orderBy: { publishedAt: 'desc' },
      });
      return briefs.map((brief) => this.presentJob(brief, creatorProfileId));
    }

    if (tab === 'invited') {
      const briefs = await this.prisma.brief.findMany({
        where: {
          invitations: { some: { creatorProfileId } },
          status: { in: [BriefStatus.OPEN, BriefStatus.SELECTING] },
        },
        include: {
          brand: { select: { id: true, name: true } },
          invitations: { where: { creatorProfileId } },
        },
        orderBy: { publishedAt: 'desc' },
      });
      return briefs.map((brief) => this.presentJob(brief, creatorProfileId));
    }

    const creator = await this.prisma.creatorProfile.findUnique({
      where: { id: creatorProfileId },
      include: {
        socialAccounts: {
          include: { snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 } },
        },
      },
    });
    const matchProfile = {
      categories: creator?.categories ?? [],
      languages: creator?.languages ?? [],
      locationCountry: creator?.locationCountry,
      locationCity: creator?.locationCity,
      channels: [...new Set((creator?.socialAccounts ?? []).map((account) => account.channel))],
      followers: Math.max(
        0,
        ...(creator?.socialAccounts ?? []).map((account) => account.snapshots[0]?.followers ?? 0),
      ),
      typicalRateMin: creator?.typicalRateMin ? Number(creator.typicalRateMin) : null,
      typicalRateMax: creator?.typicalRateMax ? Number(creator.typicalRateMax) : null,
    };

    const open = await this.prisma.brief.findMany({
      where: {
        status: { in: [BriefStatus.OPEN, BriefStatus.SELECTING] },
        distribution: { in: [BriefDistribution.OPEN, BriefDistribution.HYBRID] },
      },
      include: {
        brand: { select: { id: true, name: true } },
        applications: { where: { creatorProfileId } },
      },
      take: 80,
    });

    return open
      .map((brief) => ({
        brief,
        score: scoreBriefFit(
          {
            channels: brief.channels,
            category: brief.category,
            rateAmount: brief.rateAmount ? Number(brief.rateAmount) : null,
            rateMin: brief.rateMin ? Number(brief.rateMin) : null,
            rateMax: brief.rateMax ? Number(brief.rateMax) : null,
            publishedAt: brief.publishedAt,
            eligibility: brief.eligibility,
          },
          matchProfile,
        ),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.brief.publishedAt?.getTime() ?? 0) - (a.brief.publishedAt?.getTime() ?? 0),
      )
      .slice(0, 50)
      .map((item) => ({
        ...this.presentJob(item.brief, creatorProfileId),
        matchScore: item.score,
      }));
  }

  async invite(userId: string, briefId: string, creatorProfileId: string, message?: string) {
    const brief = await this.prisma.brief.findUnique({
      where: { id: briefId },
      include: { brand: true },
    });
    if (!brief) throw new NotFoundException('Brief not found.');
    await this.workspace.requireBrandPermission(userId, brief.brandId, 'briefs.manage');
    const creator = await this.prisma.creatorProfile.findUnique({
      where: { id: creatorProfileId },
    });
    if (!creator) throw new NotFoundException('Creator not found.');

    const invite = await this.prisma.briefInvitation.upsert({
      where: {
        briefId_creatorProfileId: { briefId, creatorProfileId },
      },
      create: { briefId, creatorProfileId, message, status: 'SENT' },
      update: { message, status: 'SENT' },
    });
    await this.prisma.notification.create({
      data: {
        userId: creator.userId,
        type: 'brief.invited',
        title: "You're invited to a brief",
        body: `${brief.brand.name}: ${brief.title}`,
        href: `/app/jobs/${brief.id}`,
      },
    });
    await this.audit(userId, 'brief.invite', 'BriefInvitation', invite.id);
    return invite;
  }

  async markInvitationViewed(creatorProfileId: string, briefId: string) {
    const invite = await this.prisma.briefInvitation.findUnique({
      where: { briefId_creatorProfileId: { briefId, creatorProfileId } },
    });
    if (!invite || invite.viewedAt) return invite;
    if (invite.status !== 'SENT' && invite.status !== 'VIEWED') return invite;
    return this.prisma.briefInvitation.update({
      where: { id: invite.id },
      data: { status: 'VIEWED', viewedAt: new Date() },
    });
  }

  async declineInvitation(
    creatorProfileId: string,
    invitationId: string,
    reason?: string,
  ) {
    const invite = await this.prisma.briefInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invite || invite.creatorProfileId !== creatorProfileId) {
      throw new NotFoundException('Invitation not found.');
    }
    if (invite.status !== 'SENT' && invite.status !== 'VIEWED') {
      throw new BadRequestException('This invitation can no longer be declined.');
    }
    return this.prisma.briefInvitation.update({
      where: { id: invite.id },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
        responseReason: reason,
      },
    });
  }

  async moderate(adminId: string, briefId: string, approve: boolean, reason?: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    const brief = await this.prisma.brief.findUnique({ where: { id: briefId } });
    if (!brief) throw new NotFoundException('Brief not found.');
    if (brief.status !== BriefStatus.PENDING_MODERATION) {
      throw new BadRequestException('Brief is not awaiting moderation.');
    }
    const updated = await this.prisma.brief.update({
      where: { id: briefId },
      data: approve
        ? { status: BriefStatus.OPEN, publishedAt: new Date() }
        : { status: BriefStatus.CANCELLED },
    });
    await this.audit(
      adminId,
      approve ? 'brief.moderate.approve' : 'brief.moderate.reject',
      'Brief',
      briefId,
      { reason },
    );
    return this.presentBrief(updated);
  }

  presentBrief(brief: {
    id: string;
    brandId: string;
    title: string;
    description: string;
    objective: string | null;
    category: string | null;
    status: BriefStatus;
    distribution: BriefDistribution;
    rateMode: RateMode;
    rateAmount: unknown;
    rateMin: unknown;
    rateMax: unknown;
    currency: string;
    channels: SocialChannel[];
    deliverables: unknown;
    applicationDeadline: Date | null;
    maxCreators: number | null;
    eligibility: unknown;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: brief.id,
      brandId: brief.brandId,
      title: brief.title,
      description: brief.description,
      objective: brief.objective,
      category: brief.category,
      status: brief.status,
      distribution: brief.distribution,
      rateMode: brief.rateMode,
      rateAmount: asNumber(brief.rateAmount as never),
      rateMin: asNumber(brief.rateMin as never),
      rateMax: asNumber(brief.rateMax as never),
      currency: brief.currency,
      channels: brief.channels,
      deliverables: brief.deliverables,
      applicationDeadline: brief.applicationDeadline,
      maxCreators: brief.maxCreators,
      eligibility: brief.eligibility,
      publishedAt: brief.publishedAt,
      createdAt: brief.createdAt,
      updatedAt: brief.updatedAt,
    };
  }

  private presentJob(
    brief: {
      id: string;
      brandId: string;
      title: string;
      description: string;
      objective: string | null;
      category: string | null;
      status: BriefStatus;
      distribution: BriefDistribution;
      rateMode: RateMode;
      rateAmount: unknown;
      rateMin: unknown;
      rateMax: unknown;
      currency: string;
      channels: SocialChannel[];
      deliverables: unknown;
      applicationDeadline: Date | null;
      maxCreators: number | null;
      eligibility: unknown;
      publishedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      brand: { id: string; name: string };
      applications?: Array<{ id: string; status: string }>;
      invitations?: Array<{ id: string; status: string }>;
    },
    _creatorProfileId: string,
  ) {
    return {
      ...this.presentBrief(brief),
      brand: brief.brand,
      myApplication: brief.applications?.[0] ?? null,
      myInvitation: brief.invitations?.[0] ?? null,
    };
  }

  private assertRates(input: CreateBriefDto) {
    const rateMode = input.rateMode ?? 'FIXED_NON_NEGOTIABLE';
    if (rateMode === 'RANGE_NEGOTIABLE') {
      if (input.rateMin == null || input.rateMax == null) {
        throw new BadRequestException('Negotiable ranges require a minimum and maximum rate.');
      }
      if (input.rateMin > input.rateMax) {
        throw new BadRequestException('Minimum rate cannot exceed maximum rate.');
      }
      return;
    }
    if (input.rateAmount == null || input.rateAmount <= 0) {
      throw new BadRequestException('This rate mode requires a positive amount.');
    }
  }

  private async audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    after?: object,
  ) {
    await this.prisma.auditEvent.create({
      data: { actorId, action, targetType, targetId, after },
    });
  }
}
