import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  BriefDistribution,
  BriefInvitation,
  BriefStatus,
  Prisma,
  ProspectStatus,
  RateMode,
  SocialChannel,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { hashToken, newOpaqueToken } from '../common/crypto/tokens';
import { MailService } from '../mail/mail.service';
import { claimInviteMessage } from '../mail/templates';
import { asNumber } from '../common/fees';
import { scoreBriefFit } from '../common/matching';
import { automatedBriefChecks, moderationPath } from '../common/trust';
import { WorkspaceService } from '../organisation/workspace.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBriefDto } from './dto/create-brief.dto';

@Injectable()
export class BriefsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}
  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpiredBriefs() {
    const now = new Date();

    await this.prisma.brief.updateMany({
      where: {
        status: { in: [BriefStatus.OPEN, BriefStatus.SELECTING] },
        applicationDeadline: { lt: now },
      },
      data: {
        status: BriefStatus.CLOSED,
      },
    });
  }

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
          ? /^\d{4}-\d{2}-\d{2}$/.test(input.applicationDeadline)
            ? new Date(`${input.applicationDeadline}T23:59:59.999`)
            : new Date(input.applicationDeadline)
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
      const actor = await this.workspace.getWorkActor(userId);
      if (!actor.isPlatformAdmin) {
        throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
      }
      const briefs = await this.prisma.brief.findMany({
        include: {
          _count: { select: { applications: true } },
          brand: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      return briefs.map((brief) => ({
        ...this.presentBrief(brief),
        applicationCount: brief._count.applications,
        brand: brief.brand,
      }));
    }
    await this.workspace.requireBrandAccess(userId, brandId);
    const briefs = await this.prisma.brief.findMany({
      where: { brandId },
      include: {
        _count: { select: { applications: true } },
        brand: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return briefs.map((brief) => ({
      ...this.presentBrief(brief),
      applicationCount: brief._count.applications,
      brand: brief.brand,
    }));
  }

  async listActiveApplications(userId: string, brandId?: string) {
    if (!brandId) {
      throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    }
    await this.workspace.requireBrandAccess(userId, brandId);
    const applications = await this.prisma.application.findMany({
      where: {
        brief: { brandId },
        status: {
          in: [ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED],
        },
      },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            avatarStatus: true,
          },
        },
        brief: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return applications.map((application) => ({
      id: application.id,
      status: application.status,
      proposedRate: asNumber(application.proposedRate),
      currency: application.currency,
      createdAt: application.createdAt,
      creator: application.creator,
      brief: application.brief,
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
          include: {
            creator: { select: { id: true, displayName: true } },
            prospect: { select: { id: true, handle: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
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

  async invite(
    userId: string,
    briefId: string,
    input: { creatorProfileId?: string; prospectId?: string; message?: string },
  ): Promise<BriefInvitation> {
    const creatorProfileId = input.creatorProfileId?.trim();
    const prospectId = input.prospectId?.trim();
    if (!creatorProfileId && !prospectId) {
      throw new BadRequestException('Select a claimed creator or an unclaimed account.');
    }
    if (creatorProfileId && prospectId) {
      throw new BadRequestException('Invite either a claimed creator or an unclaimed account.');
    }

    const brief = await this.prisma.brief.findUnique({
      where: { id: briefId },
      include: { brand: true },
    });
    if (!brief) throw new NotFoundException('Brief not found.');
    await this.workspace.requireBrandPermission(userId, brief.brandId, 'briefs.manage');

    if (creatorProfileId) {
      const creator = await this.prisma.creatorProfile.findUnique({
        where: { id: creatorProfileId },
      });
      if (!creator) throw new NotFoundException('Creator not found.');
      const invite = await this.prisma.briefInvitation.upsert({
        where: {
          briefId_creatorProfileId: { briefId, creatorProfileId },
        },
        create: { briefId, creatorProfileId, message: input.message, status: 'SENT' },
        update: { message: input.message, status: 'SENT' },
      });
      // One per invitation send: re-sending the same invite does not email again.
      await this.notifications.create({
        userId: creator.userId,
        type: 'brief.invited',
        title: `${brief.brand.name} invited you to ${brief.title}`,
        body: this.briefInviteCopy(brief, input.message),
        href: `/app/jobs/${brief.id}`,
        dedupeKey: `brief-invited:${invite.id}`,
      });
      await this.audit(userId, 'brief.invite', 'BriefInvitation', invite.id);
      return invite;
    }

    const prospect = await this.prisma.creatorProspect.findUnique({
      where: { id: prospectId },
    });
    if (!prospect) throw new NotFoundException('Unclaimed account not found.');
    if (prospect.status === ProspectStatus.CLAIMED && prospect.claimedProfileId) {
      return this.invite(userId, briefId, {
        creatorProfileId: prospect.claimedProfileId,
        message: input.message,
      });
    }

    const existing = await this.prisma.briefInvitation.findFirst({
      where: { briefId, prospectId },
    });
    const invite = existing
      ? await this.prisma.briefInvitation.update({
          where: { id: existing.id },
          data: { message: input.message, status: 'SENT' },
        })
      : await this.prisma.briefInvitation.create({
          data: {
            briefId,
            prospectId,
            message: input.message,
            status: 'SENT',
          },
        });

    const raw = newOpaqueToken();
    const expires = new Date();
    expires.setDate(expires.getDate() + 14);
    const openInterest = await this.prisma.brandInterest.findFirst({
      where: {
        brandId: brief.brandId,
        prospectId,
        status: { not: 'CLOSED' },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (openInterest) {
      await this.prisma.brandInterest.update({
        where: { id: openInterest.id },
        data: {
          message: input.message,
          claimToken: hashToken(raw),
          claimTokenExpiresAt: expires,
          status: 'INVITED',
        },
      });
    } else {
      await this.prisma.brandInterest.create({
        data: {
          brandId: brief.brandId,
          prospectId,
          message: input.message,
          status: 'INVITED',
          claimToken: hashToken(raw),
          claimTokenExpiresAt: expires,
          createdById: userId,
        },
      });
    }
    if (prospect.status === ProspectStatus.UNCLAIMED) {
      await this.prisma.creatorProspect.update({
        where: { id: prospect.id },
        data: { status: ProspectStatus.CLAIM_PENDING },
      });
    }

    const claimEmail = prospect.contactEmail?.trim().toLowerCase();
    const href = this.mail.frontendUrl(`/claim/${raw}`);
    if (claimEmail) {
      await this.mail.sendBestEffort({
        ...claimInviteMessage({
          brandName: brief.brand.name,
          handle: prospect.handle,
          href,
          note: input.message,
          briefTitle: brief.title,
          briefSummary: this.briefInviteCopy(brief, input.message),
        }),
        to: claimEmail,
      });
    }

    await this.audit(userId, 'brief.invite', 'BriefInvitation', invite.id);
    return invite;
  }

  private briefInviteCopy(
    brief: { brand: { name: string }; title: string; description: string },
    message?: string,
  ) {
    const summary = brief.description.replace(/\s+/g, ' ').trim().slice(0, 220);
    return [
      `${brief.brand.name} invited you to “${brief.title}”.`,
      summary ? `${summary}${brief.description.trim().length > 220 ? '…' : ''}` : '',
      message?.trim() || '',
    ]
      .filter(Boolean)
      .join(' ');
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
    const declined = await this.prisma.briefInvitation.update({
      where: { id: invite.id },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
        responseReason: reason,
      },
    });
    const [brief, creator] = await Promise.all([
      this.prisma.brief.findUniqueOrThrow({ where: { id: declined.briefId } }),
      this.prisma.creatorProfile.findUnique({ where: { id: creatorProfileId } }),
    ]);
    await this.notifications.notifyBrand(brief.brandId, {
      type: 'invitation.declined',
      title: `${creator?.displayName ?? 'A creator'} declined your invitation`,
      body: reason?.trim()
        ? `${brief.title}: “${reason.trim().slice(0, 160)}”`
        : `${brief.title}. You can invite other creators from Discover.`,
      href: `/app/briefs/${declined.briefId}`,
      dedupePrefix: `invitation-declined:${declined.id}`,
    });
    return declined;
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
    await this.notifications.notifyBrand(updated.brandId, {
      type: approve ? 'brief.approved' : 'brief.rejected',
      title: approve ? `${updated.title} is live` : `${updated.title} was not approved`,
      body: approve
        ? 'Your brief passed review and is open for applications.'
        : reason?.trim() || 'Your brief did not pass review. Contact support for details.',
      href: `/app/briefs/${updated.id}`,
      dedupePrefix: `brief-moderated:${updated.id}`,
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

  async closeBrief(userId: string, briefId: string) {
  const brief = await this.prisma.brief.findUnique({
    where: { id: briefId },
  });

  if (!brief) throw new NotFoundException('Brief not found.');

  await this.workspace.requireBrandPermission(
    userId,
    brief.brandId,
    'briefs.manage',
  );

  if (
    brief.status !== BriefStatus.OPEN &&
    brief.status !== BriefStatus.SELECTING
  ) {
    throw new BadRequestException('This brief cannot be closed from its current status.');
  }

  const updated = await this.prisma.brief.update({
    where: { id: briefId },
    data: { status: BriefStatus.CLOSED },
  });

  await this.audit(userId, 'brief.close', 'Brief', briefId);

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
