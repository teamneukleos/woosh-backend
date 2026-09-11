import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DeliverableState } from '@prisma/client';
import { canTransitionDeliverable, idempotencyMatches } from '../common/work-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { WalletService } from '../payments/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { validateUpload } from '../storage/upload-policy';
import { CampaignAccessService } from './access.service';

@Injectable()
export class DeliverablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CampaignAccessService,
    private readonly workspace: WorkspaceService,
    private readonly wallets: WalletService,
    private readonly storage: StorageService,
  ) {}

  async start(userId: string, deliverableId: string) {
    const { deliverable, side } = await this.access.requireDeliverableAccess(
      deliverableId,
      userId,
    );
    if (side !== 'creator') throw new ForbiddenException('Creator access required.');
    if (!deliverable.participant.termsAcceptedAt) {
      throw new BadRequestException('Accept campaign terms before starting work.');
    }
    if (deliverable.state !== DeliverableState.NOT_STARTED) {
      throw new BadRequestException('Deliverable has already started.');
    }
    this.requireTransition(deliverable.state, DeliverableState.IN_PROGRESS);
    if (deliverable.dueAt && deliverable.dueAt < new Date()) {
      throw new BadRequestException(
        'This deliverable is overdue; contact the brand before starting.',
      );
    }
    const updated = await this.prisma.deliverable.update({
      where: { id: deliverable.id },
      data: { state: DeliverableState.IN_PROGRESS, startedAt: new Date() },
    });
    await this.audit(userId, 'deliverable.start', deliverable.id);
    return { id: updated.id, state: updated.state, startedAt: updated.startedAt };
  }

  async uploadDraft(
    userId: string,
    deliverableId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    notes?: string,
  ) {
    try {
      validateUpload({
        buffer: file.buffer,
        contentType: file.mimetype,
        kind: 'deliverable',
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid upload',
      );
    }
    const stored = await this.storage.store({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: `deliverables/${deliverableId}`,
    });
    try {
      return await this.submitDraft(userId, deliverableId, {
        draftUrl: stored.url,
        notes,
        idempotencyKey: `upload:${stored.key}`,
        storageKey: stored.key,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
      });
    } catch (error) {
      await this.storage.remove(stored.key);
      throw error;
    }
  }

  async submitDraft(
    userId: string,
    deliverableId: string,
    input: {
      draftUrl: string;
      notes?: string;
      idempotencyKey?: string;
      storageKey?: string;
      fileName?: string;
      mimeType?: string;
      fileSizeBytes?: number;
    },
  ) {
    const { deliverable, side } = await this.access.requireDeliverableAccess(
      deliverableId,
      userId,
    );
    if (side !== 'creator') throw new ForbiddenException('Creator access required.');
    if (!deliverable.participant.termsAcceptedAt) {
      throw new BadRequestException('Accept campaign terms before submitting work.');
    }
    if (input.idempotencyKey) {
      const existing = await this.prisma.submission.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (!idempotencyMatches(existing.deliverableId, deliverableId)) {
          throw new BadRequestException('Invalid idempotency key.');
        }
        return existing;
      }
    }
    if (
      deliverable.state !== DeliverableState.IN_PROGRESS &&
      deliverable.state !== DeliverableState.REVISION_REQUESTED
    ) {
      throw new BadRequestException('This deliverable is not ready for a submission.');
    }
    const draftUrl = this.requireHttpUrl(input.draftUrl, 'submission URL');
    const isRevision = deliverable.state === DeliverableState.REVISION_REQUESTED;
    const nextState = isRevision
      ? DeliverableState.RESUBMITTED
      : DeliverableState.DRAFT_SUBMITTED;
    this.requireTransition(deliverable.state, nextState);

    const submission = await this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.submission.findFirst({
          where: { deliverableId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const created = await tx.submission.create({
          data: {
            deliverableId,
            version: (latest?.version ?? 0) + 1,
            submittedById: userId,
            draftUrl,
            storageKey: input.storageKey,
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileSizeBytes: input.fileSizeBytes,
            notes: input.notes?.trim() || undefined,
            idempotencyKey: input.idempotencyKey,
          },
        });
        const transitioned = await tx.deliverable.updateMany({
          where: {
            id: deliverableId,
            state: isRevision
              ? DeliverableState.REVISION_REQUESTED
              : DeliverableState.IN_PROGRESS,
          },
          data: { state: nextState },
        });
        if (transitioned.count !== 1) {
          throw new BadRequestException(
            'Deliverable changed while the draft was uploading.',
          );
        }
        return created;
      },
      { isolationLevel: 'Serializable' },
    );

    await this.notifyBrandUsers(deliverable.campaign.brandId, {
      type: 'deliverable.submitted',
      title: isRevision ? 'Revision submitted' : 'Draft submitted',
      body: deliverable.title,
      href: `/app/campaigns/${deliverable.campaignId}`,
      dedupePrefix: `deliverable-submitted:${submission.id}`,
    });
    await this.audit(userId, 'deliverable.submit', deliverableId, {
      version: submission.version,
      draftUrl,
    });
    return {
      id: submission.id,
      version: submission.version,
      draftUrl: submission.draftUrl,
      state: nextState,
    };
  }

  async requestRevision(userId: string, deliverableId: string, reviewNotes: string) {
    const { deliverable, side } = await this.access.requireDeliverableAccess(
      deliverableId,
      userId,
    );
    if (side !== 'brand') throw new ForbiddenException('Brand access required.');
    await this.workspace.requireBrandPermission(
      userId,
      deliverable.campaign.brandId,
      'campaigns.manage',
    );
    const notes = reviewNotes.trim();
    if (notes.length < 3 || notes.length > 2000) {
      throw new BadRequestException('Revision feedback must be between 3 and 2,000 characters.');
    }
    if (
      deliverable.state !== DeliverableState.DRAFT_SUBMITTED &&
      deliverable.state !== DeliverableState.RESUBMITTED
    ) {
      throw new BadRequestException('Only a submitted draft can be returned for revision.');
    }
    const latest = deliverable.submissions[0];
    if (!latest) throw new BadRequestException('No submission to review.');
    this.requireTransition(deliverable.state, DeliverableState.REVISION_REQUESTED);

    await this.prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: latest.id },
        data: { reviewNotes: notes, reviewedAt: new Date() },
      });
      const transitioned = await tx.deliverable.updateMany({
        where: {
          id: deliverable.id,
          state: {
            in: [DeliverableState.DRAFT_SUBMITTED, DeliverableState.RESUBMITTED],
          },
        },
        data: { state: DeliverableState.REVISION_REQUESTED },
      });
      if (transitioned.count !== 1) {
        throw new BadRequestException('Deliverable already reviewed.');
      }
    });
    await this.prisma.notification.create({
      data: {
        userId: deliverable.participant.creator.userId,
        type: 'deliverable.revision',
        title: 'Revision requested',
        body: notes.slice(0, 120),
        href: `/app/campaigns/${deliverable.campaignId}`,
        dedupeKey: `deliverable-revision:${latest.id}`,
      },
    });
    await this.audit(userId, 'deliverable.revision_requested', deliverableId);
    return { id: deliverableId, state: DeliverableState.REVISION_REQUESTED };
  }

  async approve(userId: string, deliverableId: string, liveUrl?: string) {
    const { deliverable, side } = await this.access.requireDeliverableAccess(
      deliverableId,
      userId,
    );
    if (side !== 'brand') throw new ForbiddenException('Brand access required.');
    await this.workspace.requireBrandPermission(
      userId,
      deliverable.campaign.brandId,
      'campaigns.manage',
    );
    if (
      deliverable.state !== DeliverableState.DRAFT_SUBMITTED &&
      deliverable.state !== DeliverableState.RESUBMITTED
    ) {
      throw new BadRequestException('Only a submitted draft can be approved.');
    }
    const latest = deliverable.submissions[0];
    if (!latest) throw new BadRequestException('No submission to approve.');
    this.requireTransition(deliverable.state, DeliverableState.APPROVED);
    if (liveUrl) this.requireHttpUrl(liveUrl, 'live URL');

    await this.prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: latest.id },
        data: { reviewedAt: new Date(), liveUrl },
      });
      const transitioned = await tx.deliverable.updateMany({
        where: {
          id: deliverable.id,
          state: {
            in: [DeliverableState.DRAFT_SUBMITTED, DeliverableState.RESUBMITTED],
          },
        },
        data: { state: DeliverableState.APPROVED },
      });
      if (transitioned.count !== 1) {
        throw new BadRequestException('Deliverable already reviewed.');
      }
    });

    await this.wallets.approveOnDeliverableApprove(
      deliverable.participant.id,
      userId,
    );
    await this.prisma.notification.create({
      data: {
        userId: deliverable.participant.creator.userId,
        type: 'deliverable.approved',
        title: 'Deliverable approved',
        body: deliverable.title,
        href: `/app/campaigns/${deliverable.campaignId}`,
        dedupeKey: `deliverable-approved:${deliverable.id}`,
      },
    });
    await this.audit(userId, 'deliverable.approve', deliverableId);
    return { id: deliverableId, state: DeliverableState.APPROVED };
  }

  async setLive(userId: string, deliverableId: string, liveUrl: string) {
    const { deliverable, side } = await this.access.requireDeliverableAccess(
      deliverableId,
      userId,
    );
    if (side !== 'creator') throw new ForbiddenException('Creator access required.');
    if (
      deliverable.state !== DeliverableState.APPROVED &&
      deliverable.state !== DeliverableState.SCHEDULED
    ) {
      throw new BadRequestException('Only approved content can be marked live.');
    }
    const parsed = this.requireHttpUrl(liveUrl, 'published content URL');
    const latest = deliverable.submissions[0];
    if (!latest) throw new BadRequestException('No approved submission found.');
    this.requireTransition(deliverable.state, DeliverableState.LIVE);
    await this.prisma.$transaction([
      this.prisma.submission.update({
        where: { id: latest.id },
        data: { liveUrl: parsed },
      }),
      this.prisma.deliverable.update({
        where: { id: deliverable.id },
        data: { state: DeliverableState.LIVE },
      }),
    ]);
    await this.audit(userId, 'deliverable.live', deliverableId);
    return { id: deliverableId, state: DeliverableState.LIVE, liveUrl: parsed };
  }

  async complete(userId: string, deliverableId: string) {
    const { deliverable, side } = await this.access.requireDeliverableAccess(
      deliverableId,
      userId,
    );
    if (side !== 'brand') throw new ForbiddenException('Brand access required.');
    await this.workspace.requireBrandPermission(
      userId,
      deliverable.campaign.brandId,
      'campaigns.manage',
    );
    if (deliverable.state !== DeliverableState.LIVE) {
      throw new BadRequestException('Only live work can be completed.');
    }
    this.requireTransition(deliverable.state, DeliverableState.COMPLETED);
    const updated = await this.prisma.deliverable.update({
      where: { id: deliverableId },
      data: { state: DeliverableState.COMPLETED, completedAt: new Date() },
    });

    const remainingForParticipant = await this.prisma.deliverable.count({
      where: {
        campaignParticipantId: deliverable.campaignParticipantId,
        state: { not: DeliverableState.COMPLETED },
      },
    });
    if (remainingForParticipant === 0) {
      await this.prisma.campaignParticipant.update({
        where: { id: deliverable.campaignParticipantId },
        data: { status: 'COMPLETED' },
      });
      await this.wallets.scheduleRelease(
        deliverable.campaignParticipantId,
        new Date(),
      );
    }
    const remainingForCampaign = await this.prisma.deliverable.count({
      where: {
        campaignId: deliverable.campaignId,
        state: { not: DeliverableState.COMPLETED },
      },
    });
    if (remainingForCampaign === 0) {
      await this.prisma.campaign.update({
        where: { id: deliverable.campaignId },
        data: { status: 'COMPLETED' },
      });
    }
    await this.audit(userId, 'deliverable.complete', deliverableId);
    return {
      id: updated.id,
      state: updated.state,
      campaignComplete: remainingForCampaign === 0,
      payoutHoldScheduled: remainingForParticipant === 0,
    };
  }

  private requireTransition(from: DeliverableState, to: DeliverableState) {
    if (!canTransitionDeliverable(from, to)) {
      throw new BadRequestException(`Deliverable cannot move from ${from} to ${to}.`);
    }
  }

  private requireHttpUrl(value: string, label: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`Enter a valid ${label}.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`${label} must use HTTP or HTTPS.`);
    }
    return parsed.toString();
  }

  private async notifyBrandUsers(
    brandId: string,
    input: {
      type: string;
      title: string;
      body: string;
      href: string;
      dedupePrefix: string;
    },
  ) {
    const brand = await this.prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
      include: {
        memberships: true,
        organisation: { include: { memberships: true } },
      },
    });
    const users = new Set([
      ...brand.memberships.map((row) => row.userId),
      ...brand.organisation.memberships.map((row) => row.userId),
    ]);
    for (const userId of users) {
      await this.prisma.notification.create({
        data: {
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          href: input.href,
          dedupeKey: `${input.dedupePrefix}:${userId}`,
        },
      });
    }
  }

  private async audit(actorId: string, action: string, targetId: string, after?: object) {
    await this.prisma.auditEvent.create({
      data: {
        actorId,
        action,
        targetType: 'Deliverable',
        targetId,
        after,
      },
    });
  }
}
