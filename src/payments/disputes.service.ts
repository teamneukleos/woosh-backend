import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DisputeCategory, DisputeResolutionType } from '@prisma/client';
import { canTransitionObligation, disputeWindowOpen } from '../common/payments-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from './notify';
import { PayoutService } from './payout.service';

function assertTransition(
  from: Parameters<typeof canTransitionObligation>[0],
  to: Parameters<typeof canTransitionObligation>[1],
) {
  if (!canTransitionObligation(from, to)) {
    throw new BadRequestException(`Payment cannot move from ${from} to ${to}.`);
  }
}

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly payouts: PayoutService,
  ) {}

  async open(input: {
    actorUserId: string;
    obligationId: string;
    category: DisputeCategory;
    subject: string;
    description: string;
    requestedResolution?: string;
  }) {
    const { obligation } = await this.payouts.requireObligationAccess(
      input.obligationId,
      input.actorUserId,
    );
    if (!['APPROVED', 'FAILED'].includes(obligation.status)) {
      throw new BadRequestException('This payment cannot be disputed.');
    }
    if (input.category !== 'PAYOUT_DELAY' && !disputeWindowOpen(obligation.availableAt)) {
      throw new BadRequestException('The 72-hour dispute window has closed.');
    }
    const existing = obligation.disputes.find((row) =>
      ['OPEN', 'UNDER_REVIEW'].includes(row.status),
    );
    if (existing) return existing;
    assertTransition(obligation.status, 'DISPUTED');
    const dispute = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          raisedById: input.actorUserId,
          obligationId: obligation.id,
          campaignId: obligation.participant.campaign.id,
          category: input.category,
          subject: input.subject.trim(),
          description: input.description.trim(),
          requestedResolution: input.requestedResolution?.trim() || undefined,
          responseDueAt: new Date(Date.now() + 2 * 86_400_000),
        },
      });
      await tx.paymentObligation.update({
        where: { id: obligation.id },
        data: { status: 'DISPUTED' },
      });
      return created;
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorUserId,
        action: 'payment.dispute.open',
        targetType: 'Dispute',
        targetId: dispute.id,
        after: { obligationId: obligation.id, category: input.category },
      },
    });
    const creatorUserId = obligation.participant.creator.userId;
    await notify(this.prisma, {
      userId: creatorUserId,
      type: 'payment.dispute.opened',
      title: 'Payment dispute opened',
      body: input.subject,
      href: `/app/disputes/${dispute.id}`,
      dedupeKey: `dispute-open:${dispute.id}:${creatorUserId}`,
    });
    return dispute;
  }

  async listForUser(actorUserId: string) {
    const actor = await this.workspace.getWorkActor(actorUserId);
    const rows = await this.prisma.dispute.findMany({
      where: actor.isPlatformAdmin
        ? undefined
        : {
            OR: [
              { raisedById: actorUserId },
              ...(actor.creatorProfileId
                ? [
                    {
                      obligation: {
                        participant: { creatorProfileId: actor.creatorProfileId },
                      },
                    },
                  ]
                : []),
              ...(actor.brandIds.length
                ? [
                    {
                      obligation: {
                        participant: {
                          campaign: { brandId: { in: actor.brandIds } },
                        },
                      },
                    },
                  ]
                : []),
            ],
          },
      include: {
        obligation: {
          include: {
            participant: {
              include: { creator: true, campaign: { include: { brand: true } } },
            },
          },
        },
        raisedBy: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      category: row.category,
      subject: row.subject,
      description: row.description,
      requestedResolution: row.requestedResolution,
      resolution: row.resolution,
      resolutionType: row.resolutionType,
      responseDueAt: row.responseDueAt,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      raisedBy: row.raisedBy,
      obligation: {
        id: row.obligation.id,
        status: row.obligation.status,
        currency: row.obligation.currency,
        campaign: {
          id: row.obligation.participant.campaign.id,
          title: row.obligation.participant.campaign.title,
          brand: {
            id: row.obligation.participant.campaign.brand.id,
            name: row.obligation.participant.campaign.brand.name,
          },
        },
        creator: { displayName: row.obligation.participant.creator.displayName },
      },
    }));
  }

  async resolve(input: {
    disputeId: string;
    actorUserId: string;
    resolutionType: DisputeResolutionType;
    resolution: string;
  }) {
    await this.workspace.requirePlatformAdmin(input.actorUserId);
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: input.disputeId },
      include: {
        obligation: {
          include: {
            participant: {
              include: {
                creator: true,
                campaign: { include: { brand: true } },
              },
            },
          },
        },
      },
    });
    if (!dispute || !['OPEN', 'UNDER_REVIEW'].includes(dispute.status)) {
      throw new NotFoundException('Open dispute not found.');
    }
    const nextStatus = input.resolutionType === 'RELEASE_PAYOUT' ? 'APPROVED' : 'REVERSED';
    assertTransition(dispute.obligation.status, nextStatus);
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: dispute.id },
        data: {
          status: 'RESOLVED',
          resolutionType: input.resolutionType,
          resolution: input.resolution.trim(),
          resolvedById: input.actorUserId,
          resolvedAt: new Date(),
        },
      });
      await tx.paymentObligation.update({
        where: { id: dispute.obligationId },
        data:
          nextStatus === 'APPROVED'
            ? { status: 'APPROVED', availableAt: new Date() }
            : {
                status: 'REVERSED',
                reversedAt: new Date(),
                reversalReason: input.resolution.trim(),
              },
      });
      if (nextStatus === 'REVERSED') {
        const amount =
          Number(dispute.obligation.grossAmount) + Number(dispute.obligation.platformFee);
        const brandId = dispute.obligation.participant.campaign.brandId;
        await tx.brandWallet.update({
          where: { brandId },
          data: { balance: { increment: amount } },
        });
        await tx.ledgerTransaction.create({
          data: {
            obligationId: dispute.obligationId,
            type: 'REFUND',
            amount,
            currency: dispute.obligation.currency,
            status: 'SUCCEEDED',
            provider: 'woosh_ledger',
            providerReference: `dispute_refund_${dispute.id}`,
            idempotencyKey: `dispute_refund_${dispute.id}`,
            completedAt: new Date(),
            metadata: { brandId, disputeId: dispute.id },
          },
        });
      }
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorUserId,
        action: 'payment.dispute.resolve',
        targetType: 'Dispute',
        targetId: dispute.id,
        after: {
          resolutionType: input.resolutionType,
          obligationStatus: nextStatus,
        },
      },
    });
    await notify(this.prisma, {
      userId: dispute.obligation.participant.creator.userId,
      type: 'payment.dispute.resolved',
      title: 'Payment dispute resolved',
      body: input.resolution.trim().slice(0, 160),
      href: `/app/disputes/${dispute.id}`,
      dedupeKey: `dispute-resolved:${dispute.id}`,
    });
    return this.prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
  }
}
