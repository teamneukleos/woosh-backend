import { asNumber } from '../common/fees';

export function presentPayoutAccount(account: {
  id: string;
  bankCode: string;
  bankName: string | null;
  accountName: string | null;
  accountNumberLast4: string | null;
  currency: string;
  verifiedAt: Date | null;
} | null) {
  if (!account) return null;
  return {
    id: account.id,
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountName: account.accountName,
    accountNumberLast4: account.accountNumberLast4,
    currency: account.currency,
    verifiedAt: account.verifiedAt,
  };
}

export function presentMoney(value: { toNumber?: () => number } | number | null | undefined) {
  return asNumber(value) ?? 0;
}

export function presentObligation(obligation: {
  id: string;
  status: string;
  grossAmount: { toNumber?: () => number } | number;
  platformFee: { toNumber?: () => number } | number;
  netAmount: { toNumber?: () => number } | number;
  currency: string;
  approvedAt: Date | null;
  availableAt: Date | null;
  processingAt: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  reversedAt: Date | null;
  failureReason: string | null;
  reversalReason: string | null;
  createdAt: Date;
  participant?: {
    creatorProfileId: string;
    campaign: {
      id: string;
      title: string;
      brand: { id: string; name: string };
    };
    creator?: { displayName: string };
  };
  disputes?: Array<{
    id: string;
    status: string;
    category: string;
    subject: string;
    createdAt: Date;
  }>;
  transactions?: Array<{
    id: string;
    type: string;
    status: string;
    amount: { toNumber?: () => number } | number;
    currency: string;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}) {
  return {
    id: obligation.id,
    status: obligation.status,
    grossAmount: presentMoney(obligation.grossAmount),
    platformFee: presentMoney(obligation.platformFee),
    netAmount: presentMoney(obligation.netAmount),
    currency: obligation.currency,
    approvedAt: obligation.approvedAt,
    availableAt: obligation.availableAt,
    processingAt: obligation.processingAt,
    paidAt: obligation.paidAt,
    failedAt: obligation.failedAt,
    reversedAt: obligation.reversedAt,
    failureReason: obligation.failureReason,
    reversalReason: obligation.reversalReason,
    createdAt: obligation.createdAt,
    campaign: obligation.participant
      ? {
          id: obligation.participant.campaign.id,
          title: obligation.participant.campaign.title,
          brand: obligation.participant.campaign.brand,
        }
      : undefined,
    creator: obligation.participant?.creator
      ? { displayName: obligation.participant.creator.displayName }
      : undefined,
    disputes: obligation.disputes?.map((row) => ({
      id: row.id,
      status: row.status,
      category: row.category,
      subject: row.subject,
      createdAt: row.createdAt,
    })),
    transactions: obligation.transactions?.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      amount: presentMoney(row.amount),
      currency: row.currency,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    })),
  };
}
