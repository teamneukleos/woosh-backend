import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  BriefDistribution,
  BriefStatus,
  ConversationType,
  Prisma,
  SocialChannel,
} from '@prisma/client';
import { hasPermission } from '../common/permissions';
import { canRespondToOffer, canWithdrawApplication } from '../common/work-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { WalletService } from '../payments/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplyBriefDto } from './dto/apply-brief.dto';

const ACCEPT_RATE_THRESHOLD = Number(process.env.WOOSH_ACCEPT_RATE_THRESHOLD ?? '500000');

type DeliverableSpec = {
  title?: string;
  channel?: SocialChannel;
  dueAt?: string;
  requirements?: Prisma.InputJsonValue;
};

@Injectable()
export class SelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly wallets: WalletService,
  ) {}

  async apply(userId: string, creatorProfileId: string, briefId: string, input: ApplyBriefDto) {
    const [brief, creator] = await Promise.all([
      this.prisma.brief.findUnique({ where: { id: briefId } }),
      this.prisma.creatorProfile.findUnique({
        where: { id: creatorProfileId },
        include: { user: { select: { status: true, emailVerified: true } } },
      }),
    ]);
    if (!brief) throw new NotFoundException('Brief not found.');
    if (!creator) throw new NotFoundException('Creator profile not found.');
    if (!creator.user.emailVerified || creator.user.status !== 'ACTIVE') {
      throw new ForbiddenException('Verify your email before applying.');
    }
    if (creator.marketplaceStatus !== 'PUBLISHED') {
      throw new ForbiddenException(
        'Publish your creator profile before applying to marketplace briefs.',
      );
    }
    if (brief.status !== BriefStatus.OPEN && brief.status !== BriefStatus.SELECTING) {
      throw new BadRequestException('Brief is not accepting applications.');
    }
    if (brief.applicationDeadline && brief.applicationDeadline < new Date()) {
      throw new BadRequestException('The application deadline has passed.');
    }
    const acceptedCount = await this.prisma.application.count({
      where: { briefId: brief.id, status: ApplicationStatus.ACCEPTED },
    });
    if (brief.maxCreators && acceptedCount >= brief.maxCreators) {
      throw new BadRequestException('This brief has filled all creator places.');
    }
    if (brief.distribution === BriefDistribution.INVITE_ONLY) {
      const invited = await this.prisma.briefInvitation.findUnique({
        where: {
          briefId_creatorProfileId: { briefId: brief.id, creatorProfileId },
        },
      });
      if (!invited || invited.status === 'DECLINED' || invited.status === 'EXPIRED') {
        throw new ForbiddenException('This brief is invitation-only.');
      }
    }

    let application;
    try {
      application = await this.prisma.application.create({
        data: {
          briefId,
          creatorProfileId,
          proposedRate: input.proposedRate,
          availabilityNote: input.availabilityNote,
          answers: input.answers as Prisma.InputJsonValue | undefined,
          currency: brief.currency,
          status: ApplicationStatus.APPLIED,
        },
        include: {
          creator: true,
          brief: { include: { brand: { include: { memberships: true } } } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You already applied to this brief.');
      }
      throw error;
    }

    const invitation = await this.prisma.briefInvitation.findUnique({
      where: { briefId_creatorProfileId: { briefId: brief.id, creatorProfileId } },
    });
    if (invitation) {
      await this.prisma.briefInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
    }

    if (
      brief.rateMode === 'FIXED_NON_NEGOTIABLE' &&
      brief.rateAmount != null &&
      input.proposedRate == null
    ) {
      await this.prisma.offer.create({
        data: {
          applicationId: application.id,
          amount: brief.rateAmount,
          currency: brief.currency,
          status: 'OPEN',
          createdById: userId,
          message: 'Rate accepted as listed',
        },
      });
    } else if (input.proposedRate != null) {
      await this.prisma.offer.create({
        data: {
          applicationId: application.id,
          amount: input.proposedRate,
          currency: brief.currency,
          status: 'OPEN',
          createdById: userId,
          message: 'Creator proposed rate',
        },
      });
    }

    for (const member of application.brief.brand.memberships) {
      await this.prisma.notification.create({
        data: {
          userId: member.userId,
          type: 'application.received',
          title: 'New application',
          body: `${application.creator.displayName} applied to ${brief.title}`,
          href: `/app/briefs/${brief.id}`,
        },
      });
    }
    await this.audit(userId, 'application.create', 'Application', application.id);
    return { id: application.id, status: application.status, briefId: application.briefId };
  }

  async withdraw(userId: string, applicationId: string, reason?: string) {
    const { application, side } = await this.requireApplicationAccess(applicationId, userId);
    if (side !== 'creator') throw new ForbiddenException('Creator access required.');
    if (!canWithdrawApplication(application.status)) {
      throw new BadRequestException('Application can no longer be withdrawn.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.offer.updateMany({
        where: { applicationId, status: { in: ['OPEN', 'COUNTERED'] } },
        data: { status: 'WITHDRAWN' },
      });
      return tx.application.update({
        where: { id: applicationId },
        data: {
          status: ApplicationStatus.WITHDRAWN,
          withdrawnAt: new Date(),
          withdrawalReason: reason,
        },
      });
    });
    await this.audit(userId, 'application.withdraw', 'Application', applicationId);
    return updated;
  }

  async shortlist(userId: string, applicationId: string) {
    const { application, side } = await this.requireApplicationAccess(applicationId, userId);
    if (side !== 'brand') throw new ForbiddenException('Brand access required.');
    await this.workspace.requireBrandPermission(
      userId,
      application.brief.brandId,
      'briefs.manage',
    );
    if (application.status !== ApplicationStatus.APPLIED) {
      throw new BadRequestException('Only new applications can be shortlisted.');
    }
    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.SHORTLISTED },
      include: { creator: true, brief: true },
    });
    await this.ensureApplicationConversation(applicationId);
    await this.prisma.notification.create({
      data: {
        userId: updated.creator.userId,
        type: 'application.shortlisted',
        title: "You've been shortlisted",
        body: updated.brief.title,
        href: `/app/jobs/${updated.briefId}`,
      },
    });
    await this.audit(userId, 'application.shortlist', 'Application', applicationId);
    return { id: updated.id, status: updated.status };
  }

  async decline(userId: string, applicationId: string) {
    const { application, side } = await this.requireApplicationAccess(applicationId, userId);
    if (side !== 'brand') throw new ForbiddenException('Brand access required.');
    await this.workspace.requireBrandPermission(
      userId,
      application.brief.brandId,
      'briefs.manage',
    );
    if (
      application.status !== ApplicationStatus.APPLIED &&
      application.status !== ApplicationStatus.SHORTLISTED
    ) {
      throw new BadRequestException('Application can no longer be declined.');
    }
    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.DECLINED },
      include: { creator: true, brief: true },
    });
    await this.prisma.notification.create({
      data: {
        userId: updated.creator.userId,
        type: 'application.declined',
        title: 'Application update',
        body: `Not selected for ${updated.brief.title}`,
        href: `/app/jobs/${updated.briefId}`,
      },
    });
    await this.audit(userId, 'application.decline', 'Application', applicationId);
    return { id: updated.id, status: updated.status };
  }

  async accept(userId: string, applicationId: string) {
    const { application: accessApp, side } = await this.requireApplicationAccess(
      applicationId,
      userId,
    );
    if (side !== 'brand') throw new ForbiddenException('Brand access required.');
    await this.workspace.requireBrandPermission(userId, accessApp.brief.brandId, 'briefs.manage');

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        creator: true,
        brief: true,
        offers: {
          where: { status: { in: ['AGREED', 'OPEN', 'COUNTERED'] } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!application) throw new NotFoundException('Application not found.');
    if (
      application.status !== ApplicationStatus.APPLIED &&
      application.status !== ApplicationStatus.SHORTLISTED
    ) {
      throw new BadRequestException('Application can no longer be accepted.');
    }

    const agreed = application.offers.find((offer) => offer.status === 'AGREED');
    if (application.offers.length > 0 && !agreed) {
      throw new BadRequestException('The creator must agree to the active offer first.');
    }
    const rate = agreed?.amount ?? application.proposedRate ?? application.brief.rateAmount;
    if (rate == null) {
      throw new BadRequestException('No agreed rate — accept or counter an offer first.');
    }
    const rateNum = Number(rate);
    await this.assertCanAcceptRate(userId, application.brief.brandId, rateNum);

    const specs = Array.isArray(application.brief.deliverables)
      ? (application.brief.deliverables as DeliverableSpec[])
      : [];
    const deliverableCreates =
      specs.length > 0
        ? specs.map((item) => ({
            title: item.title || 'Deliverable',
            channel: item.channel,
            dueAt: item.dueAt ? new Date(item.dueAt) : undefined,
            requirements: item.requirements,
            state: 'NOT_STARTED' as const,
          }))
        : [
            {
              title: 'Primary deliverable',
              channel: application.brief.channels[0] ?? null,
              state: 'NOT_STARTED' as const,
            },
          ];

    const campaign = await this.prisma.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.ACCEPTED },
      });
      const created = await tx.campaign.create({
        data: {
          briefId: application.briefId,
          brandId: application.brief.brandId,
          title: application.brief.title,
          status: 'ACTIVE',
        },
      });
      const participant = await tx.campaignParticipant.create({
        data: {
          campaignId: created.id,
          creatorProfileId: application.creatorProfileId,
          agreedRate: rate,
          currency: application.currency,
        },
      });
      await tx.deliverable.createMany({
        data: deliverableCreates.map((deliverable) => ({
          ...deliverable,
          campaignId: created.id,
          campaignParticipantId: participant.id,
        })),
      });
      await tx.brief.update({
        where: { id: application.briefId },
        data: { status: BriefStatus.SELECTING },
      });
      return tx.campaign.findUniqueOrThrow({
        where: { id: created.id },
        include: { participants: true, deliverables: true },
      });
    });

    const participant = campaign.participants[0];
    if (!participant) throw new BadRequestException('Campaign participant missing.');

    try {
      await this.wallets.commitOnAccept({
        brandId: application.brief.brandId,
        campaignParticipantId: participant.id,
        gross: rateNum,
        currency: application.currency,
        actorUserId: userId,
      });
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.campaign.delete({ where: { id: campaign.id } }),
        this.prisma.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.SHORTLISTED },
        }),
        this.prisma.brief.update({
          where: { id: application.briefId },
          data: { status: accessApp.brief.status },
        }),
      ]);
      throw error;
    }

    await this.ensureApplicationConversation(applicationId);
    await this.prisma.conversation.create({
      data: {
        type: ConversationType.CAMPAIGN,
        campaignId: campaign.id,
        messages: {
          create: {
            isSystem: true,
            body: `Campaign opened for ${application.creator.displayName}`,
          },
        },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: application.creator.userId,
        type: 'application.accepted',
        title: "You're on the campaign",
        body: application.brief.title,
        href: `/app/campaigns/${campaign.id}`,
      },
    });
    await this.audit(userId, 'application.accept', 'Application', applicationId, {
      campaignId: campaign.id,
    });

    return {
      campaignId: campaign.id,
      applicationId,
      agreedRate: rateNum,
      currency: application.currency,
      platformFee: 0,
      deliverables: campaign.deliverables.map((row) => ({
        id: row.id,
        title: row.title,
        state: row.state,
      })),
    };
  }

  async counterOffer(
    userId: string,
    applicationId: string,
    amount: number,
    message?: string,
  ) {
    const { application, side } = await this.requireApplicationAccess(applicationId, userId);
    if (side === 'brand') {
      await this.workspace.requireBrandPermission(
        userId,
        application.brief.brandId,
        'briefs.manage',
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Enter a valid offer amount.');
    }
    if (!canWithdrawApplication(application.status)) {
      throw new BadRequestException('This negotiation is closed.');
    }
    const latest = await this.prisma.offer.findFirst({
      where: { applicationId, status: { in: ['OPEN', 'COUNTERED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (latest?.createdById === userId) {
      throw new BadRequestException('Wait for the other party to respond to your offer.');
    }
    const offer = await this.prisma.$transaction(async (tx) => {
      await tx.offer.updateMany({
        where: { applicationId, status: { in: ['OPEN', 'COUNTERED'] } },
        data: { status: 'SUPERSEDED' },
      });
      return tx.offer.create({
        data: {
          applicationId,
          amount,
          currency: application.currency,
          message: message?.trim() || undefined,
          status: 'COUNTERED',
          createdById: userId,
          previousOfferId: latest?.id,
        },
      });
    });
    const conversation = await this.ensureApplicationConversation(applicationId);
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: userId,
        isSystem: true,
        offerId: offer.id,
        body: `Counter-offer: ${amount} ${application.currency}${message ? ` — ${message}` : ''}`,
      },
    });
    await this.audit(userId, 'offer.counter', 'Offer', offer.id);
    return { id: offer.id, amount, currency: application.currency, status: offer.status, side };
  }

  async agreeOffer(userId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        application: { include: { creator: true, brief: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found.');
    const access = await this.requireApplicationAccess(offer.applicationId, userId);
    if (access.side === 'brand') {
      await this.workspace.requireBrandPermission(
        userId,
        access.application.brief.brandId,
        'briefs.manage',
      );
    }
    if (
      !canRespondToOffer({
        status: offer.status,
        offerCreatedById: offer.createdById,
        actorUserId: userId,
        applicationStatus: offer.application.status,
      })
    ) {
      throw new BadRequestException('The other party cannot accept this offer now.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const agreed = await tx.offer.updateMany({
        where: { id: offer.id, status: { in: ['OPEN', 'COUNTERED'] } },
        data: { status: 'AGREED' },
      });
      if (agreed.count !== 1) throw new BadRequestException('Offer has already changed.');
      await tx.offer.updateMany({
        where: {
          applicationId: offer.applicationId,
          id: { not: offer.id },
          status: { in: ['OPEN', 'COUNTERED'] },
        },
        data: { status: 'SUPERSEDED' },
      });
      return tx.offer.findUniqueOrThrow({ where: { id: offer.id } });
    });
    const conversation = await this.ensureApplicationConversation(offer.applicationId);
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: userId,
        isSystem: true,
        offerId: offer.id,
        body: `Offer agreed at ${offer.amount} ${offer.currency}`,
      },
    });
    await this.audit(userId, 'offer.accept', 'Offer', offer.id);
    return { id: updated.id, status: updated.status, amount: Number(updated.amount) };
  }

  async moderateCreator(adminId: string, creatorProfileId: string, approve: boolean, reason?: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    const existing = await this.prisma.creatorProfile.findUnique({
      where: { id: creatorProfileId },
    });
    if (!existing) throw new NotFoundException('Creator profile not found.');
    const profile = await this.prisma.creatorProfile.update({
      where: { id: creatorProfileId },
      data: approve
        ? {
            marketplaceStatus: 'PUBLISHED',
            profileVisible: true,
            verifiedAt: new Date(),
            moderationNotes: null,
            avatarStatus: existing.avatarUrl ? 'APPROVED' : existing.avatarStatus,
            coverStatus: existing.coverUrl ? 'APPROVED' : existing.coverStatus,
          }
        : {
            marketplaceStatus: 'REJECTED',
            profileVisible: false,
            verifiedAt: null,
            moderationNotes: reason || 'Profile needs changes',
          },
    });
    await this.prisma.notification.create({
      data: {
        userId: profile.userId,
        type: approve ? 'creator.approved' : 'creator.rejected',
        title: approve ? 'Your creator profile is live' : 'Profile needs changes',
        body:
          reason ||
          (approve ? 'Brands can now discover you.' : 'Review the feedback and resubmit.'),
        href: '/app/profile',
      },
    });
    await this.audit(
      adminId,
      approve ? 'creator.profile.approve' : 'creator.profile.reject',
      'CreatorProfile',
      profile.id,
      { reason },
    );
    return {
      id: profile.id,
      marketplaceStatus: profile.marketplaceStatus,
      profileVisible: profile.profileVisible,
    };
  }

  async listCreatorModeration(adminId: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    const [profiles, media] = await Promise.all([
      this.prisma.creatorProfile.findMany({
        where: { marketplaceStatus: 'PENDING_REVIEW' },
        orderBy: { submittedAt: 'asc' },
        include: {
          socialAccounts: { select: { id: true, handle: true } },
          _count: { select: { portfolioItems: true, ratePackages: true } },
        },
      }),
      this.prisma.creatorPortfolioItem.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: { creator: { select: { displayName: true } } },
      }),
    ]);
    return {
      profiles: profiles.map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        marketplaceStatus: profile.marketplaceStatus,
        submittedAt: profile.submittedAt,
        _count: profile._count,
        socialAccounts: profile.socialAccounts,
      })),
      media: media.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        mediaType: item.mediaType,
        url: item.url,
        creator: { displayName: item.creator.displayName },
      })),
    };
  }

  async bootstrapAdmin(userId: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Admin bootstrap is disabled in production.');
    }
    const existing = await this.prisma.user.count({ where: { isPlatformAdmin: true } });
    if (existing > 0) {
      throw new ConflictException('A platform admin already exists.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPlatformAdmin: true },
    });
    return { ok: true, message: 'This account is now a platform admin (local only).' };
  }

  private async assertCanAcceptRate(actorId: string, brandId: string, rate: number) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { organisationId: true },
    });
    if (!brand) throw new NotFoundException('Brand not found.');
    const membership = await this.prisma.membership.findFirst({
      where: { userId: actorId, organisationId: brand.organisationId },
    });
    if (!membership) {
      const brandMem = await this.prisma.brandMembership.findFirst({
        where: { userId: actorId, brandId },
      });
      if (!brandMem) throw new ForbiddenException('Not a brand/agency member.');
      if (rate > ACCEPT_RATE_THRESHOLD) {
        throw new ForbiddenException(
          `Rate ₦${rate.toLocaleString()} exceeds manager threshold ₦${ACCEPT_RATE_THRESHOLD.toLocaleString()}. An owner or finance user must accept.`,
        );
      }
      return;
    }
    const canApproveMoney = hasPermission(membership.role, 'payments.approve', {
      canApprovePayments: membership.canApprovePayments,
    });
    if (rate > ACCEPT_RATE_THRESHOLD && !canApproveMoney) {
      throw new ForbiddenException(
        `Rate ₦${rate.toLocaleString()} exceeds manager threshold ₦${ACCEPT_RATE_THRESHOLD.toLocaleString()}. An owner or finance user must accept.`,
      );
    }
  }

  private async requireApplicationAccess(applicationId: string, userId: string) {
    const [actor, application] = await Promise.all([
      this.workspace.getWorkActor(userId),
      this.prisma.application.findUnique({
        where: { id: applicationId },
        include: { brief: true, creator: true },
      }),
    ]);
    if (!application) throw new NotFoundException('Application not found.');
    const side =
      actor.creatorProfileId === application.creatorProfileId
        ? 'creator'
        : actor.isPlatformAdmin || actor.brandIds.includes(application.brief.brandId)
          ? 'brand'
          : null;
    if (!side) throw new ForbiddenException('You cannot access this application.');
    return { actor, application, side };
  }

  private async ensureApplicationConversation(applicationId: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: { applicationId },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: {
        type: ConversationType.APPLICATION,
        applicationId,
        messages: {
          create: { isSystem: true, body: 'Conversation started for this application.' },
        },
      },
    });
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
