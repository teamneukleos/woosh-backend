import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asNumber } from '../common/fees';
import {
  assertProductionPaymentConfiguration,
  canTransitionObligation,
  providerMoneyMatches,
} from '../common/payments-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  initiateTransfer,
  PaystackError,
  paystackConfigured,
  verifyTransfer,
} from './paystack.client';
import { presentObligation } from './present';
import { hasReservedFunds } from './wallet.service';

type PayoutOutcome = 'processing' | 'paid' | 'failed';

type TransferProbe = {
  state: 'paid' | 'pending' | 'failed' | 'reversed' | 'absent' | 'unknown';
  record?: { reference: string; status: string; amount: number; currency: string; reason?: string };
};

/**
 * True only when Paystack definitely rejected the request (so no transfer was created).
 * Network failures, unreadable responses, timeouts, rate limits and 5xx are ambiguous.
 */
function isDefinitiveRejection(error: unknown) {
  if (!(error instanceof PaystackError)) return false;
  if (error.status < 400 || error.status >= 500) return false;
  if ([408, 409, 425, 429].includes(error.status)) return false;
  return !/duplicate|already|exist/i.test(error.message);
}

type PayoutAttemptMeta = {
  paystackOutcome?: 'failed' | 'reversed';
  recoveryAuthorized?: { by: string; at: string; reason: string };
};

function attemptMeta(attempt: { metadata: Prisma.JsonValue } | null | undefined) {
  const meta = attempt?.metadata;
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as PayoutAttemptMeta)
    : {};
}

/** Paystack confirmed this (latest) attempt failed and no admin has authorised a retry. */
/** Attempt statuses Paystack can confirm as final non-payment (failed, or reversed). */
const CONFIRMED_UNPAID = ['FAILED', 'REVERSED'];

function needsManualRecovery(
  attempt: { status: string; metadata: Prisma.JsonValue } | null | undefined,
) {
  if (!attempt || !CONFIRMED_UNPAID.includes(attempt.status)) return false;
  const meta = attemptMeta(attempt);
  return Boolean(meta.paystackOutcome) && !meta.recoveryAuthorized;
}

/** An admin authorised exactly one new attempt after this confirmed failure. */
function isAuthorizedRecovery(
  attempt: { status: string; metadata: Prisma.JsonValue } | null | undefined,
) {
  if (!attempt || !CONFIRMED_UNPAID.includes(attempt.status)) return false;
  const meta = attemptMeta(attempt);
  return Boolean(meta.paystackOutcome && meta.recoveryAuthorized);
}

function manualRecoveryRequired() {
  return new BadRequestException(
    'Paystack confirmed the last transfer failed. This payout needs manual recovery by a Woosh admin before it can be sent again.',
  );
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : 'Provider error';
}

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
    private readonly notifications: NotificationsService,
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
        participant: {
          include: {
            campaign: { include: { brand: true } },
            deliverables: {
              select: { id: true, title: true, state: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
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

  /**
   * Sends (or safely resumes) the creator payout for one obligation.
   *
   * Safety rules, so a payout can never be sent twice:
   *  - The attempt and its fixed Paystack reference are written in the same transaction that
   *    claims the obligation (→ PROCESSING), before Paystack is called. A crash at any later
   *    point leaves a PENDING attempt that reconciliation can verify by reference.
   *  - Ambiguous errors (network, timeout, 5xx, rate limit) never mark a payout FAILED; it stays
   *    PROCESSING until Paystack confirms the outcome.
   *  - A new reference is only used after Paystack confirms every earlier attempt failed,
   *    was reversed, or never existed.
   *  - Only payments whose funds were reserved from the brand wallet are ever paid.
   */
  async initiatePayout(input: {
    obligationId: string;
    actorUserId?: string;
    automated?: boolean;
  }): Promise<{ mode: 'paystack' | 'test'; status: PayoutOutcome; reference?: string }> {
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
    if (obligation.status === 'PROCESSING') {
      const active = await this.latestAttempt(obligation.id, 'PENDING');
      return { mode: 'paystack', status: 'processing', reference: active?.providerReference ?? undefined };
    }
    if (obligation.status === 'PAID') {
      return { mode: 'paystack', status: 'paid' };
    }
    if (!['APPROVED', 'FAILED'].includes(obligation.status)) {
      throw new BadRequestException(`Cannot payout from status ${obligation.status}.`);
    }
    if (!obligation.availableAt || obligation.availableAt > new Date()) {
      throw new BadRequestException('The payout release window is still open.');
    }
    const openDisputes = await this.prisma.dispute.count({
      where: { obligationId: obligation.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    });
    if (openDisputes) {
      throw new BadRequestException('Payout is frozen by an open dispute.');
    }
    if (!(await hasReservedFunds(this.prisma, obligation))) {
      throw new BadRequestException(
        'This payment was not reserved from the brand wallet, so it cannot be paid out. Contact Woosh support.',
      );
    }
    const payout = obligation.participant.creator.payoutAccount;
    if (!payout?.verifiedAt || !payout.recipientCode) {
      throw new BadRequestException(
        'Creator has not added a payout bank account. Ask them to save one on Profile.',
      );
    }

    // Paystack confirmed the latest transfer failed: only an admin recovery decision
    // (authorizeRecoveryAttempt) may lead to a new reference. Nothing automatic continues.
    const latest = await this.prisma.ledgerTransaction.findFirst({
      where: { obligationId: obligation.id, type: 'PAYOUT' },
      orderBy: { createdAt: 'desc' },
    });
    if (needsManualRecovery(latest)) throw manualRecoveryRequired();
    const recovery = isAuthorizedRecovery(latest) ? latest : null;

    const live = paystackConfigured();
    // The attempt to resend under its own reference: Paystack never created it.
    let reusable: { id: string; providerReference: string } | null = null;
    if (live) {
      // An earlier attempt may still land (or already has). Never send a new one until it is settled.
      const earlier = await this.prisma.ledgerTransaction.findMany({
        where: { obligationId: obligation.id, type: 'PAYOUT', status: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
      });
      for (const attempt of earlier) {
        if (!attempt.providerReference) continue;
        const probe = await this.probeTransfer(attempt.providerReference);
        if (probe.state === 'absent') {
          reusable ??= { id: attempt.id, providerReference: attempt.providerReference };
          continue;
        }
        if (probe.state === 'paid') {
          await this.settleAttempt(attempt.providerReference, probe);
          return { mode: 'paystack', status: 'paid', reference: attempt.providerReference };
        }
        if (probe.state === 'failed' || probe.state === 'reversed') {
          // The admin-authorised attempt is expected to read as failed; anything else stops here.
          if (recovery?.id === attempt.id) continue;
          await this.settleAttempt(attempt.providerReference, probe);
          throw manualRecoveryRequired();
        }
        if (probe.state === 'pending' || probe.state === 'unknown') {
          await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.paymentObligation.updateMany({
              where: { id: obligation.id, status: obligation.status },
              data: { status: 'PROCESSING', processingAt: new Date(), failedAt: null, failureReason: null },
            });
            if (claimed.count === 1) {
              await tx.ledgerTransaction.update({
                where: { id: attempt.id },
                data: { status: 'PENDING', failureReason: null, completedAt: null },
              });
            }
          });
          return { mode: 'paystack', status: 'processing', reference: attempt.providerReference };
        }
      }
    }

    const net = asNumber(obligation.netAmount) ?? 0;
    assertTransition(obligation.status, 'PROCESSING');
    const attempt = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentObligation.updateMany({
        where: { id: obligation.id, status: obligation.status },
        data: { status: 'PROCESSING', processingAt: new Date(), failedAt: null, failureReason: null },
      });
      if (claimed.count !== 1) return null;
      if (reusable) {
        // Same reference again: one payout, one Paystack reference, however often it is retried.
        const reopened = await tx.ledgerTransaction.updateMany({
          where: { id: reusable.id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'PENDING', failureReason: null, completedAt: null },
        });
        if (reopened.count !== 1) {
          throw new BadRequestException('Payout changed while retrying; refresh and try again.');
        }
        return tx.ledgerTransaction.findUniqueOrThrow({ where: { id: reusable.id } });
      }
      const previous = await tx.ledgerTransaction.count({
        where: { obligationId: obligation.id, type: 'PAYOUT' },
      });
      // A new reference only for the very first attempt, or once per admin recovery decision
      // on the latest (Paystack-confirmed failed) attempt. Never automatically.
      if (previous > 0) {
        const current = await tx.ledgerTransaction.findFirst({
          where: { obligationId: obligation.id, type: 'PAYOUT' },
          orderBy: { createdAt: 'desc' },
        });
        if (!recovery || current?.id !== recovery.id || !isAuthorizedRecovery(current)) {
          throw manualRecoveryRequired();
        }
      }
      const reference = `payout_${obligation.id}_${previous + 1}`;
      return tx.ledgerTransaction.create({
        data: {
          obligationId: obligation.id,
          type: 'PAYOUT',
          amount: net,
          currency: obligation.currency,
          status: 'PENDING',
          provider: live ? 'paystack' : 'test_mode',
          providerReference: reference,
          idempotencyKey: reference,
          metadata: {
            attempt: previous + 1,
            automated: Boolean(input.automated),
            ...(recovery ? { recoveryOf: recovery.id } : {}),
          },
        },
      });
    });
    if (!attempt) {
      const active = await this.latestAttempt(obligation.id, 'PENDING');
      return { mode: 'paystack', status: 'processing', reference: active?.providerReference ?? undefined };
    }
    const reference = attempt.providerReference!;

    if (!live) {
      return this.markPaidLocal({
        obligationId: obligation.id,
        attemptId: attempt.id,
        actorUserId: input.actorUserId,
        reference,
      });
    }

    try {
      const accepted = await initiateTransfer({
        amountMajor: net,
        recipientCode: payout.recipientCode,
        reference,
        reason: `Woosh payout ${obligation.id}`,
        currency: obligation.currency,
      });
      await this.prisma.ledgerTransaction
        .update({
          where: { id: attempt.id },
          data: {
            metadata: {
              ...((attempt.metadata as Prisma.JsonObject | null) ?? {}),
              transfer_code: accepted.transfer_code,
            },
          },
        })
        .catch(() => undefined);
    } catch (error) {
      if (!isDefinitiveRejection(error)) {
        // We cannot tell whether Paystack created the transfer. Leave it PROCESSING;
        // reconcileProcessing verifies this exact reference before anything else happens.
        await this.auditPayout(input.actorUserId, obligation.id, 'payment.payout.ambiguous', {
          reference,
          error: describeError(error),
        });
        return { mode: 'paystack', status: 'processing', reference };
      }
      const probe = await this.probeTransfer(reference);
      if (probe.state === 'absent') {
        const reason = describeError(error);
        await this.prisma.$transaction(async (tx) => {
          await tx.ledgerTransaction.updateMany({
            where: { id: attempt.id, status: 'PENDING' },
            data: { status: 'FAILED', failureReason: reason, completedAt: new Date() },
          });
          await tx.paymentObligation.updateMany({
            where: { id: obligation.id, status: 'PROCESSING' },
            data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
          });
        });
        throw new BadRequestException(reason);
      }
      if (probe.state === 'paid' || probe.state === 'failed' || probe.state === 'reversed') {
        await this.settleAttempt(reference, probe);
        return { mode: 'paystack', status: probe.state === 'paid' ? 'paid' : 'failed', reference };
      }
      return { mode: 'paystack', status: 'processing', reference };
    }

    await this.auditPayout(input.actorUserId, obligation.id, 'payment.payout.initiated', { reference });
    await this.notifyParties(obligation.id, {
      type: 'payment.payout.initiated',
      title: 'Payout processing',
      body: `${obligation.currency} ${net.toLocaleString()} is being sent to the creator’s verified bank account.`,
    });
    return { mode: 'paystack', status: 'processing', reference };
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

    if (input.reversed && obligation.status === 'PAID') {
      await this.recordReversalAfterPaid(tx, input.reference, input.failureReason);
      return tx;
    }

    if (!input.success || input.reversed) {
      const nextStatus = input.reversed ? 'REVERSED' : 'FAILED';
      if (obligation.status === nextStatus) {
        // Already FAILED (e.g. Paystack had no record earlier). Paystack now confirms the
        // failure: record it on the attempt so retries stop and admin recovery is possible.
        if (!input.reversed) await this.markConfirmedFailure(tx, input.failureReason);
        return tx;
      }
      assertTransition(obligation.status, nextStatus);
      const applied = await this.prisma.$transaction(async (db) => {
        // Claim the attempt so duplicate or concurrent deliveries change nothing twice.
        const claimed = await db.ledgerTransaction.updateMany({
          where: {
            id: tx.id,
            status: input.reversed ? { not: 'REVERSED' } : 'PENDING',
          },
          data: {
            status: input.reversed ? 'REVERSED' : 'FAILED',
            failureReason: input.failureReason,
            completedAt: new Date(),
            // Paystack itself reported this outcome: automatic retries stop for this payout.
            metadata: {
              ...((tx.metadata as Prisma.JsonObject | null) ?? {}),
              paystackOutcome: input.reversed ? 'reversed' : 'failed',
            },
          },
        });
        if (claimed.count !== 1) return false;
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
          await db.ledgerTransaction.create({
            data: {
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
          });
          await db.brandWallet.update({
            where: { brandId: participant.campaign.brandId },
            data: { balance: { increment: full } },
          });
        }
        return true;
      });
      if (applied) {
        await this.notifyParties(obligationId, {
          type: input.reversed ? 'payment.reversed' : 'payment.failed',
          title: input.reversed ? 'Payout reversed' : 'Payout failed',
          body: input.failureReason || 'The payout provider could not complete this transfer.',
        });
      }
      return tx;
    }

    if (obligation.status === 'PAID') return tx;
    // Money has moved: record it even if an earlier attempt had been marked FAILED.
    assertTransition(obligation.status, 'PAID');
    const settled = await this.prisma.$transaction(async (db) => {
      const claimed = await db.ledgerTransaction.updateMany({
        where: { id: tx.id, status: { not: 'SUCCEEDED' } },
        data: { status: 'SUCCEEDED', completedAt: new Date(), failureReason: null },
      });
      if (claimed.count !== 1) return false;
      await db.paymentObligation.update({
        where: { id: obligationId },
        data: { status: 'PAID', paidAt: new Date(), failureReason: null },
      });
      return true;
    });
    if (!settled) return tx;
    await this.createBrandReceipt(obligationId);
    await this.notifyParties(obligationId, {
      type: 'payment.paid',
      title: 'Creator payout completed',
      body: `${tx.currency} ${Number(tx.amount).toLocaleString()} has been paid.`,
    });
    return tx;
  }

  /** Idempotently marks an unpaid attempt as a Paystack-confirmed failure. Moves no money. */
  private async markConfirmedFailure(
    attempt: { id: string; metadata: Prisma.JsonValue },
    reason?: string,
  ) {
    const meta = attemptMeta(attempt);
    if (meta.paystackOutcome) return;
    await this.prisma.ledgerTransaction.updateMany({
      where: { id: attempt.id, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'FAILED',
        failureReason: reason,
        completedAt: new Date(),
        metadata: {
          ...((attempt.metadata as Prisma.JsonObject | null) ?? {}),
          paystackOutcome: 'failed',
        },
      },
    });
  }

  /**
   * Paystack reversed a transfer we had already recorded as PAID: the creator was not paid
   * after all. Record it exactly once (duplicate/concurrent webhooks are no-ops) and move
   * NO money: the payment becomes FAILED and waits for an admin recovery decision
   * (authorizeRecoveryAttempt) or a dispute resolution that refunds the brand.
   */
  private async recordReversalAfterPaid(
    attempt: { id: string; obligationId: string | null; metadata: Prisma.JsonValue },
    reference: string,
    reason?: string,
  ) {
    const obligationId = attempt.obligationId!;
    const detail = reason?.trim() || 'Transfer reversed by Paystack';
    const now = new Date();
    const applied = await this.prisma.$transaction(async (db) => {
      const claimed = await db.ledgerTransaction.updateMany({
        where: { id: attempt.id, status: 'SUCCEEDED' },
        data: {
          status: 'REVERSED',
          failureReason: detail,
          metadata: {
            ...((attempt.metadata as Prisma.JsonObject | null) ?? {}),
            paystackOutcome: 'reversed',
            reversedAfterPaidAt: now.toISOString(),
          },
        },
      });
      if (claimed.count !== 1) return false;
      const moved = await db.paymentObligation.updateMany({
        where: { id: obligationId, status: 'PAID' },
        data: {
          status: 'FAILED',
          paidAt: null,
          failedAt: now,
          reversedAt: now,
          reversalReason: detail,
          failureReason: `Reversed by the bank after payment: ${detail}. Needs manual recovery.`,
        },
      });
      if (moved.count !== 1) {
        throw new BadRequestException('Payment changed while recording the reversal.');
      }
      await db.auditEvent.create({
        data: {
          action: 'payment.payout.reversed_after_paid',
          targetType: 'PaymentObligation',
          targetId: obligationId,
          after: { reference, reason: detail },
        },
      });
      return true;
    });
    if (applied) {
      await this.notifyParties(obligationId, {
        type: 'payment.reversed',
        title: 'Payout reversed by the bank',
        body: `${detail}. Woosh will review this payout; it is not shown as paid.`,
      });
    }
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
        transactions: {
          where: { type: 'PAYOUT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      take: 100,
    });
    const results = { queued: 0, missingAccount: 0, failed: 0, manualRecovery: 0 };
    for (const obligation of eligible) {
      // Paystack confirmed the last transfer failed: wait for an admin recovery decision.
      if (needsManualRecovery(obligation.transactions[0])) {
        results.manualRecovery += 1;
        continue;
      }
      if (!obligation.participant.creator.payoutAccount?.verifiedAt) {
        results.missingAccount += 1;
        await this.notifications.create({
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

  /**
   * Settles PROCESSING payouts that have had time to land. Uses each attempt's own reference;
   * a missing attempt is only marked FAILED once Paystack confirms it does not exist.
   */
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
        },
      },
      take: 100,
    });
    for (const obligation of stale) {
      const attempts = obligation.transactions.filter((row) => row.providerReference);
      if (!attempts.length) {
        // Claimed but no attempt was ever written (same transaction), so nothing reached Paystack.
        await this.prisma.paymentObligation.updateMany({
          where: { id: obligation.id, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            failedAt: now,
            failureReason: 'Payout claim expired before provider submission',
          },
        });
        continue;
      }
      for (const attempt of attempts) {
        const reference = attempt.providerReference!;
        const probe = await this.probeTransfer(reference);
        if (probe.state === 'absent') {
          await this.prisma.$transaction(async (tx) => {
            await tx.ledgerTransaction.updateMany({
              where: { id: attempt.id, status: 'PENDING' },
              data: {
                status: 'FAILED',
                failureReason: 'Paystack has no record of this transfer',
                completedAt: now,
              },
            });
            await tx.paymentObligation.updateMany({
              where: { id: obligation.id, status: 'PROCESSING' },
              data: {
                status: 'FAILED',
                failedAt: now,
                failureReason: 'Paystack has no record of this transfer',
              },
            });
          });
        } else if (probe.state !== 'pending' && probe.state !== 'unknown') {
          await this.settleAttempt(reference, probe);
        }
      }
    }
    return { checked: stale.length };
  }

  private async latestAttempt(obligationId: string, status: 'PENDING') {
    return this.prisma.ledgerTransaction.findFirst({
      where: { obligationId, type: 'PAYOUT', status },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Asks Paystack what happened to one reference. Errors are 'unknown', never 'absent'. */
  private async probeTransfer(reference: string): Promise<TransferProbe> {
    try {
      const record = await verifyTransfer(reference);
      const state =
        record.status === 'success'
          ? 'paid'
          : record.status === 'failed'
            ? 'failed'
            : record.status === 'reversed'
              ? 'reversed'
              : 'pending';
      return { state, record };
    } catch (error) {
      if (
        error instanceof PaystackError &&
        (error.status === 404 || (error.status === 400 && /not found/i.test(error.message)))
      ) {
        return { state: 'absent' };
      }
      return { state: 'unknown' };
    }
  }

  private async settleAttempt(reference: string, probe: TransferProbe) {
    if (!probe.record) return;
    await this.completeFromWebhook({
      reference,
      success: probe.state === 'paid',
      reversed: probe.state === 'reversed',
      failureReason: probe.state === 'paid' ? undefined : probe.record.reason || probe.state,
      amountKobo: probe.record.amount,
      currency: probe.record.currency,
    });
  }

  private async auditPayout(
    actorId: string | undefined,
    obligationId: string,
    action: string,
    after: Prisma.InputJsonValue,
  ) {
    await this.prisma.auditEvent.create({
      data: { actorId, action, targetType: 'PaymentObligation', targetId: obligationId, after },
    });
  }

  /**
   * Manual recovery: a platform admin explicitly authorises ONE new transfer attempt (with a
   * new reference) after Paystack confirmed the latest attempt failed. It sends nothing itself;
   * the next initiatePayout or release run uses the authorisation exactly once.
   */
  async authorizeRecoveryAttempt(input: {
    obligationId: string;
    adminUserId: string;
    reason: string;
  }) {
    requirePaymentConfig();
    await this.workspace.requirePlatformAdmin(input.adminUserId);
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 10) {
      throw new BadRequestException('Give a reason for the recovery (at least 10 characters).');
    }
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { id: input.obligationId },
    });
    if (!obligation) throw new NotFoundException('Payment not found.');
    const latest = await this.prisma.ledgerTransaction.findFirst({
      where: { obligationId: obligation.id, type: 'PAYOUT' },
      orderBy: { createdAt: 'desc' },
    });
    if (obligation.status !== 'FAILED' || !needsManualRecovery(latest)) {
      throw new BadRequestException(
        'Recovery is only available after Paystack has confirmed the latest transfer failed.',
      );
    }
    const reference = latest!.providerReference!;
    if (paystackConfigured()) {
      // Re-check with Paystack before allowing any new reference.
      const probe = await this.probeTransfer(reference);
      if (probe.state === 'paid') {
        await this.settleAttempt(reference, probe);
        throw new BadRequestException(
          'Paystack now reports this transfer as paid; it has been recorded as paid. No recovery needed.',
        );
      }
      if (probe.state !== 'failed' && probe.state !== 'reversed') {
        throw new BadRequestException(
          'Paystack has not confirmed this transfer failed right now; check the Paystack dashboard and try again later.',
        );
      }
    }
    const authorizedAt = new Date();
    await this.prisma.$transaction(async (db) => {
      // Lock the attempt so two admins cannot both authorise it.
      const locked = await db.ledgerTransaction.updateMany({
        where: { id: latest!.id, status: { in: ['FAILED', 'REVERSED'] } },
        data: { updatedAt: authorizedAt },
      });
      const current = locked.count
        ? await db.ledgerTransaction.findUnique({ where: { id: latest!.id } })
        : null;
      if (!needsManualRecovery(current)) {
        throw new BadRequestException('This payout recovery has already been authorised.');
      }
      await db.ledgerTransaction.update({
        where: { id: latest!.id },
        data: {
          metadata: {
            ...((current!.metadata as Prisma.JsonObject | null) ?? {}),
            recoveryAuthorized: {
              by: input.adminUserId,
              at: authorizedAt.toISOString(),
              reason,
            },
          },
        },
      });
      await db.auditEvent.create({
        data: {
          actorId: input.adminUserId,
          action: 'payment.payout.recovery_authorized',
          targetType: 'PaymentObligation',
          targetId: obligation.id,
          after: { failedReference: reference, reason },
        },
      });
    });
    return { obligationId: obligation.id, failedReference: reference, authorizedAt };
  }

  /**
   * Guard for refunding the brand: refuses if any payout attempt for this payment is in
   * flight or paid, or if Paystack cannot confirm every attempt failed, was reversed or never
   * existed. Refunding while a transfer could still land would pay the money out twice.
   */
  async assertNoTransferCanLand(obligationId: string) {
    const attempts = await this.prisma.ledgerTransaction.findMany({
      where: { obligationId, type: 'PAYOUT' },
    });
    if (attempts.some((row) => row.status === 'PENDING' || row.status === 'SUCCEEDED')) {
      throw new BadRequestException(
        'A payout for this payment is in progress or has been paid; refunding the brand now could pay twice. Settle the payout first.',
      );
    }
    if (!paystackConfigured()) return;
    for (const attempt of attempts) {
      if (attempt.provider !== 'paystack' || !attempt.providerReference) continue;
      const probe = await this.probeTransfer(attempt.providerReference);
      if (!['failed', 'reversed', 'absent'].includes(probe.state)) {
        throw new BadRequestException(
          `Paystack reports payout ${attempt.providerReference} as ${probe.state === 'paid' ? 'paid' : 'not yet final'}; refunding the brand could pay twice. Check the Paystack dashboard first.`,
        );
      }
    }
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

  /** Non-production only: settles the already-recorded attempt without calling Paystack. */
  private async markPaidLocal(input: {
    obligationId: string;
    attemptId: string;
    actorUserId?: string;
    reference: string;
  }) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Test payouts are disabled in production.');
    }
    await this.prisma.$transaction(async (db) => {
      await db.ledgerTransaction.update({
        where: { id: input.attemptId },
        data: { status: 'SUCCEEDED', completedAt: new Date(), metadata: { mode: 'test' } },
      });
      await db.paymentObligation.update({
        where: { id: input.obligationId },
        data: { status: 'PAID', paidAt: new Date() },
      });
    });
    await this.createBrandReceipt(input.obligationId);
    await this.auditPayout(input.actorUserId, input.obligationId, 'payment.mark_paid', {
      provider: 'test_mode',
      transactionId: input.attemptId,
    });
    return { mode: 'test' as const, status: 'paid' as const, reference: input.reference };
  }

  /**
   * Creator plus the users who can see the brand (never other brands' teammates in the
   * same organisation). Creators land on Earnings, brand users on Payments.
   */
  private async notifyParties(
    obligationId: string,
    input: { type: string; title: string; body: string },
  ) {
    const obligation = await this.prisma.paymentObligation.findUniqueOrThrow({
      where: { id: obligationId },
      include: { participant: { include: { creator: true, campaign: true } } },
    });
    const creatorUserId = obligation.participant.creator.userId;
    const dedupe = (userId: string) =>
      `${input.type}:${obligationId}:${userId}:${obligation.status}`;
    await this.notifications.create({
      userId: creatorUserId,
      ...input,
      href: '/app/earnings',
      dedupeKey: dedupe(creatorUserId),
    });
    const brandUsers = await this.notifications.brandRecipients(
      obligation.participant.campaign.brandId,
    );
    for (const userId of brandUsers) {
      if (userId === creatorUserId) continue;
      await this.notifications.create({
        userId,
        ...input,
        href: '/app/payments',
        dedupeKey: dedupe(userId),
      });
    }
  }
}
