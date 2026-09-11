import type { ObligationStatus } from '@prisma/client';

const TRANSITIONS: Record<ObligationStatus, readonly ObligationStatus[]> = {
  PENDING_FUNDING: ['FUNDED', 'REVERSED'],
  FUNDED: ['COMMITTED', 'APPROVED', 'REVERSED'],
  COMMITTED: ['APPROVED', 'REVERSED', 'DISPUTED'],
  APPROVED: ['PROCESSING', 'DISPUTED', 'REVERSED'],
  PROCESSING: ['PAID', 'FAILED', 'REVERSED'],
  PAID: [],
  FAILED: ['PROCESSING', 'DISPUTED', 'REVERSED'],
  REVERSED: [],
  DISPUTED: ['APPROVED', 'REVERSED'],
};

export function canTransitionObligation(from: ObligationStatus, to: ObligationStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertObligationTransition(from: ObligationStatus, to: ObligationStatus) {
  if (!canTransitionObligation(from, to)) {
    throw new Error(`Payment cannot move from ${from} to ${to}`);
  }
}

/** 72-hour dispute window after the last deliverable is completed. */
export function payoutReleaseAt(completedAt: Date) {
  return new Date(completedAt.getTime() + 72 * 60 * 60 * 1000);
}

export function disputeWindowOpen(availableAt: Date | null, now = new Date()) {
  return Boolean(availableAt && now < availableAt);
}

export function providerMoneyMatches(input: {
  expectedMajor: number;
  expectedCurrency: string;
  amountMinor?: number;
  currency?: string;
}) {
  return (
    (input.amountMinor == null || input.expectedMajor === input.amountMinor / 100) &&
    (!input.currency || input.expectedCurrency === input.currency)
  );
}

export function assertProductionPaymentConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.PAYSTACK_SECRET_KEY?.trim()) {
    throw new Error('Paystack is required in production');
  }
  if (!process.env.PAYOUT_ACCOUNT_ENCRYPTION_KEY?.trim()) {
    throw new Error('Payout account encryption is required in production');
  }
}

export function canAccessFinancialDocument(input: {
  isPlatformAdmin: boolean;
  actorCreatorProfileId?: string | null;
  actorBrandIds: readonly string[];
  documentCreatorProfileId?: string | null;
  documentBrandId?: string | null;
}) {
  return (
    input.isPlatformAdmin ||
    (!!input.documentCreatorProfileId &&
      input.actorCreatorProfileId === input.documentCreatorProfileId) ||
    (!!input.documentBrandId && input.actorBrandIds.includes(input.documentBrandId))
  );
}
