import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { asNumber } from '../common/fees';
import {
  assertProductionPaymentConfiguration,
  canTransitionObligation,
  providerMoneyMatches,
} from '../common/payments-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from './notify';
import {
  initiateTransfer,
  paystackConfigured,
  verifyTransfer,
} from './paystack.client';
import { presentObligation } from './present';

const OBLIGATION_INCLUDE = {
  participant: {
    include: {
      creator: { include: { payoutAccount: true, user: true } },
      campaign: { include: { brand: true } },
    },
  },
  disputes: { orderBy: { createdAt: 'desc' as const } },
  transactions: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.PaymentObligationInclude;

function requirePaymentConfig() {
  try {
    assertProductionPaymentConfiguration();
  } catch (error) {
    throw new ServiceUnavailableException(
      error instanceof Error ? error.message : 'Payments are not configured.',
    );
  }
}

function assertTransition(from: Parameters<typeof canTransitionObligation>[0], to: Parameters<typeof canTransitionObligation>[1]) {
  if (!canTransitionObligation(from, to)) {
    throw new BadRequestException(`Payment cannot move from ${from} to ${to}.`);
  }
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async requireObligationAccess(obligationId: string, userId: string) {
    const [actor, obligation] = await Promise.all([
      this.workspace.getWorkActor(userId),
      this.prisma.paymentObligation.findUnique({
        where: { id: obligationId },
        include: OBLIGATION_INCLUDE,
      }),
    ]);
    if (!obligation) throw new NotFoundException('Payment not found.');
    const brandId = obligation.participant.campaign.brandId;
    const side =
      actor.creatorProfileId === obligation.participant.creatorProfileId
        ? ('creator' as const)
        : actor.isPlatformAdmin || actor.brandIds.includes(brandId)
          ? ('brand' as const)
          : null;
    if (!side) throw new ForbiddenException('You cannot access this payment.');
    return { actor, obligation, side, brandId };
  }

  async listCreatorEarnings(creatorProfileId: string) {
    const rows = await this.prisma.paymentObligation.findMany({
      where: { participant: { creatorProfileId } },
      include: {
        participant: { include: { campaign: { include: { brand: true } } } },
        transactions: { orderBy: { createdAt: 'desc' } },
        disputes: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => presentObligation(row));
  }

  async listBrandPayments(brandId: string) {
    const rows = await this.prisma.paymentObligation.findMany({
      where: { participant: { campaign: { brandId } } },
      include: {
        participant: {
          include: {
            creator: true,
            campaign: { include: { brand: true } },
          },
        },
        transactions: { orderBy: { createdAt: 'desc' } },
        disputes: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => presentObligation(row));
  }

  async getForActor(obligationId: string, userId: string) {
    const { obligation } = await this.requireObligationAccess(obligationId, userId);
    return presentObligation(obligation);
  }

  async initiatePayout(input: {
    obligationId: string;
    actorUserId?: string;
    automated?: boolean;
  }) {
    requirePaymentConfig();
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { id: input.obligationId },
      include: {
        participant: {
          include: {
            creator: { include: { payoutAccount: true, user: true } },
            campaign: true,
          },
        },
      },
    });
    if (!obligation) throw new NotFoundException('Payment not found.');
    const brandId = obligation.participant.campaign.brandId;
    if (!input.automated) {
      if (!input.actorUserId) throw new ForbiddenException('Finance access required.');
      await this.workspace.requireBrandPermission(input.actorUserId, brandId, 'payments.approve');
    }
    if (!['APPROVED', 'FAILED'].includes(obligation.status)) {
      throw new BadRequestException(`Cannot payout from status ${obligation.status}.`);
    }
    if (!obligation.availableAt || obligation.availableAt > new Date()) {
      throw new BadRequestException('The payout release window is still open.');
    }
    const openDisputes = await this.prisma.dispute.count({
      where: {
        obligationId: obligation.id,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
    });
    if (openDisputes) {
      throw new BadRequestException('Payout is frozen by an open dispute.');
    }
    const activePayout = await this.prisma.ledgerTransaction.findFirst({
      where: {
        obligationId: obligation.id,
        type: 'PAYOUT',
        status: 'PENDING',
      },
    });
    if (activePayout?.providerReference) {
      return { mode: 'paystack' as const, reference: activePayout.providerReference };
    }

    const net = asNumber(obligation.netAmount) ?? 0;
    const reference = `payout_${obligation.id}_${randomUUID().slice(0, 8)}`;
    const payout = obligation.participant.creator.payoutAccount;
    if (!payout?.verifiedAt || !payout.recipientCode) {
      throw new BadRequestException(
        'Creator has not added a payout bank account. Ask them to save one on Profile.',
      );
    }

    assertTransition(obligation.status, 'PROCESSING');
    const claimed = await this.prisma.paymentObligation.updateMany({
      where: { id: obligation.id, status: obligation.status },
      data: {
        status: 'PROCESSING',
        processingAt: new Date(),
        failedAt: null,
        failureReason: null,
      },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('Payout is already being processed.');
    }

    if (!paystackConfigured()) {
      return this.markPaidLocal({
        obligationId: obligation.id,
        actorUserId: input.actorUserId,
        provider: 'test_mode',
        reference,
      });
    }

    try {
      const transfer = await initiateTransfer({
        amountMajor: net,
        recipientCode: payout.recipientCode,
        reference,
        reason: `Woosh payout ${obligation.id}`,
        currency: obligation.currency,
      });
      await this.prisma.ledgerTransaction.create({
        data: {
          obligationId: obligation.id,
          type: 'PAYOUT',
          amount: net,
          currency: obligation.currency,
          status: 'PENDING',
          provider: 'paystack',
          providerReference: transfer.reference || reference,
          idempotencyKey: `payout_${obligation.id}_${reference}`,
          metadata: { transfer_code: transfer.transfer_code },
        },
      });
      await this.prisma.auditEvent.create({
        data: {
          actorId: input.actorUserId,
          action: 'payment.payout.initiated',
          targetType: 'PaymentObligation',
          targetId: obligation.id,
          after: { reference },
        },
      });
      await this.notifyParties(obligation.id, {
        type: 'payment.payout.initiated',
        title: 'Payout processing',
        body: `${obligation.currency} ${net.toLocaleString()} is being sent to the creator’s verified bank account.`,
        href: '/app/earnings',
      });
      return { mode: 'paystack' as const, reference };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : 'Provider error';
      await this.prisma.paymentObligation.update({
        where: { id: obligation.id },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
      throw new BadRequestException(reason);
    }
  }

  async completeFromWebhook(input: {
    reference: string;
    success: boolean;
    reversed?: boolean;
    failureReason?: string;
    amountKobo?: number;
    currency?: string;
  }) {
    const tx = await this.prisma.ledgerTransaction.findFirst({
      where: { providerReference: input.reference, type: 'PAYOUT' },
    });
    if (!tx?.obligationId) return null;
    const obligationId = tx.obligationId;
    if (
      !providerMoneyMatches({
        expectedMajor: asNumber(tx.amount) ?? 0,
        expectedCurrency: tx.currency,
        amountMinor: input.amountKobo,
        currency: input.currency,
      })
    ) {
      throw new BadRequestException('Transfer webhook amount or currency mismatch.');
    }
    const obligation = await this.prisma.paymentObligation.findUniqueOrThrow({
      where: { id: obligationId },
    });

    if (!input.success || input.reversed) {
      const nextStatus = input.reversed ? 'REVERSED' : 'FAILED';
      if (obligation.status === nextStatus) return tx;
      assertTransition(obligation.status, nextStatus);
      await this.prisma.$transaction(async (db) => {
        await db.ledgerTransaction.update({
          where: { id: tx.id },
          data: {
            status: input.reversed ? 'REVERSED' : 'FAILED',
            failureReason: input.failureReason,
            completedAt: new Date(),
          },
        });
        await db.paymentObligation.update({
          where: { id: obligationId },
          data: {
            status: nextStatus,
            failedAt: input.reversed ? undefined : new Date(),
            reversedAt: input.reversed ? new Date() : undefined,
            failureReason: input.failureReason,
            reversalReason: input.reversed ? input.failureReason : undefined,
          },
        });
        if (input.reversed) {
          const full = Number(obligation.grossAmount) + Number(obligation.platformFee);
          const participant = await db.campaignParticipant.findUniqueOrThrow({
            where: { id: obligation.campaignParticipantId },
            include: { campaign: true },
          });
          await db.brandWallet.update({
            where: { brandId: participant.campaign.brandId },
            data: { balance: { increment: full } },
          });
          await db.ledgerTransaction.upsert({
            where: { idempotencyKey: `transfer_reversal_${obligation.id}` },
            create: {
              obligationId: obligation.id,
              type: 'REFUND',
              amount: full,
              currency: obligation.currency,
              status: 'SUCCEEDED',
              provider: 'paystack',
              providerReference: input.reference,
              idempotencyKey: `transfer_reversal_${obligation.id}`,
              completedAt: new Date(),
              metadata: { brandId: participant.campaign.brandId },
            },
            update: {},
          });
        }
      });
      await this.notifyParties(obligationId, {
        type: input.reversed ? 'payment.reversed' : 'payment.failed',
        title: input.reversed ? 'Payout reversed' : 'Payout failed',
        body: input.failureReason || 'The payout provider could not complete this transfer.',
        href: '/app/earnings',
      });
      return tx;
    }

    if (tx.status === 'SUCCEEDED') return tx;
    if (obligation.status === 'PAID') return tx;

    assertTransition(obligation.status, 'PAID');
    await this.prisma.$transaction([
      this.prisma.ledgerTransaction.update({
        where: { id: tx.id },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      }),
      this.prisma.paymentObligation.update({
        where: { id: obligationId },
        data: { status: 'PAID', paidAt: new Date(), failureReason: null },
      }),
    ]);
    await this.createBrandReceipt(obligationId);
    await this.notifyParties(obligationId, {
      type: 'payment.paid',
      title: 'Creator payout completed',
      body: `${tx.currency} ${Number(tx.amount).toLocaleString()} has been paid.`,
      href: '/app/earnings',
    });
    return tx;
  }

  async processAutomaticReleases(now = new Date()) {
    const eligible = await this.prisma.paymentObligation.findMany({
      where: {
        status: { in: ['APPROVED', 'FAILED'] },
        availableAt: { lte: now },
        disputes: { none: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
      },
      include: {
        participant: { include: { creator: { include: { payoutAccount: true } } } },
      },
      take: 100,
    });
    const results = { queued: 0, missingAccount: 0, failed: 0 };
    for (const obligation of eligible) {
      if (!obligation.participant.creator.payoutAccount?.verifiedAt) {
        results.missingAccount += 1;
        await notify(this.prisma, {
          userId: obligation.participant.creator.userId,
          type: 'payment.account.required',
          title: 'Add a verified payout account',
          body: 'Your earnings are ready, but Woosh needs verified bank details to send them.',
          href: '/app/earnings',
          dedupeKey: `payment-account-required:${obligation.id}`,
        });
        continue;
      }
      try {
        await this.initiatePayout({ obligationId: obligation.id, automated: true });
        results.queued += 1;
      } catch {
        results.failed += 1;
      }
    }
    return results;
  }

  async reconcileProcessing(now = new Date()) {
    if (!paystackConfigured()) return { checked: 0 };
    const stale = await this.prisma.paymentObligation.findMany({
      where: {
        status: 'PROCESSING',
        processingAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) },
      },
      include: {
        transactions: {
          where: { type: 'PAYOUT', status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      take: 100,
    });
    for (const obligation of stale) {
      const reference = obligation.transactions[0]?.providerReference;
      if (!reference) {
        await this.prisma.paymentObligation.update({
          where: { id: obligation.id },
          data: {
            status: 'FAILED',
            failedAt: now,
            failureReason: 'Payout claim expired before provider submission',
          },
        });
        continue;
      }
      const transfer = await verifyTransfer(reference);
      if (transfer.status === 'success') {
        await this.completeFromWebhook({
          reference,
          success: true,
          amountKobo: transfer.amount,
          currency: transfer.currency,
        });
      } else if (['failed', 'reversed'].includes(transfer.status)) {
        await this.completeFromWebhook({
          reference,
          success: false,
          reversed: transfer.status === 'reversed',
          failureReason: transfer.reason || transfer.status,
          amountKobo: transfer.amount,
          currency: transfer.currency,
        });
      }
    }
    return { checked: stale.length };
  }

  async openReleaseWindow(obligationId: string, actorUserId: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Cannot skip the 72-hour window in production.');
    }
    await this.workspace.requirePlatformAdmin(actorUserId);
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { id: obligationId },
    });
    if (!obligation) throw new NotFoundException('Payment not found.');
    if (!['APPROVED', 'FAILED'].includes(obligation.status)) {
      throw new BadRequestException(`Cannot open the window from ${obligation.status}.`);
    }
    return this.prisma.paymentObligation.update({
      where: { id: obligationId },
      data: { availableAt: new Date() },
    });
  }

  async createBrandReceipt(obligationId: string) {
    const obligation = await this.prisma.paymentObligation.findUniqueOrThrow({
      where: { id: obligationId },
      include: {
        participant: {
          include: {
            creator: true,
            campaign: { include: { brand: true } },
          },
        },
      },
    });
    if (obligation.status !== 'PAID') {
      throw new BadRequestException('Payment is not complete.');
    }
    const suffix = obligation.id.slice(-8).toUpperCase();
    const year = new Date().getUTCFullYear();
    return this.prisma.financialDocument.upsert({
      where: { dedupeKey: `receipt:${obligation.id}` },
      create: {
        documentNumber: `WO-REC-${year}-${suffix}`,
        type: 'BRAND_RECEIPT',
        creatorProfileId: obligation.participant.creatorProfileId,
        brandId: obligation.participant.campaign.brandId,
        obligationId: obligation.id,
        currency: obligation.currency,
        grossAmount: obligation.grossAmount,
        feeAmount: obligation.platformFee,
        netAmount: obligation.netAmount,
        dedupeKey: `receipt:${obligation.id}`,
        snapshot: {
          campaign: obligation.participant.campaign.title,
          brand: obligation.participant.campaign.brand.name,
          creator: obligation.participant.creator.displayName,
          paidAt: obligation.paidAt?.toISOString(),
        },
      },
      update: {},
    });
  }

  private async markPaidLocal(input: {
    obligationId: string;
    actorUserId?: string;
    provider: string;
    reference: string;
  }) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Test payouts are disabled in production.');
    }
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { id: input.obligationId },
    });
    if (!obligation) throw new NotFoundException('Payment not found.');
    if (obligation.status === 'PAID') {
      return { mode: 'test' as const, obligationId: obligation.id };
    }
    assertTransition(obligation.status, 'PAID');
    const tx = await this.prisma.ledgerTransaction.create({
      data: {
        obligationId: obligation.id,
        type: 'PAYOUT',
        amount: obligation.netAmount,
        currency: obligation.currency,
        status: 'SUCCEEDED',
        provider: input.provider,
        providerReference: input.reference,
        idempotencyKey: `payout_${obligation.id}_${input.reference}`,
        metadata: { mode: 'test' },
        completedAt: new Date(),
      },
    });
    await this.prisma.paymentObligation.update({
      where: { id: obligation.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await this.createBrandReceipt(obligation.id);
    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorUserId,
        action: 'payment.mark_paid',
        targetType: 'PaymentObligation',
        targetId: obligation.id,
        after: { provider: input.provider, transactionId: tx.id },
      },
    });
    return { mode: 'test' as const, transactionId: tx.id };
  }

  private async notifyParties(
    obligationId: string,
    input: { type: string; title: string; body: string; href: string },
  ) {
    const obligation = await this.prisma.paymentObligation.findUniqueOrThrow({
      where: { id: obligationId },
      include: {
        participant: {
          include: {
            creator: true,
            campaign: {
              include: {
                brand: {
                  include: {
                    memberships: true,
                    organisation: { include: { memberships: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const users = new Set([
      obligation.participant.creator.userId,
      ...obligation.participant.campaign.brand.memberships.map((row) => row.userId),
      ...obligation.participant.campaign.brand.organisation.memberships.map((row) => row.userId),
    ]);
    await Promise.all(
      [...users].map((userId) =>
        notify(this.prisma, {
          userId,
          ...input,
          dedupeKey: `${input.type}:${obligationId}:${userId}:${obligation.status}`,
        }),
      ),
    );
  }
}
