import { createHmac, timingSafeEqual } from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

export function paystackConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

export function paystackPublicKey() {
  return process.env.PAYSTACK_PUBLIC_KEY?.trim() || '';
}

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) throw new Error('Paystack is not configured');

  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: T;
  };

  if (!res.ok || !json.status) {
    throw new Error(json.message || `Paystack error ${res.status}`);
  }

  return json.data;
}

export type InitializeTransactionResult = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

/** Amount in major units (naira). Paystack expects kobo. */
export async function initializeTransaction(input: {
  email: string;
  amountMajor: number;
  currency?: string;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const amountKobo = Math.round(input.amountMajor * 100);
  return paystackFetch<InitializeTransactionResult>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: amountKobo,
      currency: input.currency ?? 'NGN',
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });
}

export async function verifyTransaction(reference: string) {
  return paystackFetch<{
    status: string;
    reference: string;
    amount: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function listPaystackBanks(currency = 'NGN') {
  return paystackFetch<Array<{ name: string; code: string; active: boolean }>>(
    `/bank?currency=${encodeURIComponent(currency)}&perPage=100`,
  );
}

export async function resolvePaystackAccount(input: {
  accountNumber: string;
  bankCode: string;
}) {
  return paystackFetch<{ account_number: string; account_name: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`,
  );
}

export async function createTransferRecipient(input: {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency?: string;
}) {
  return paystackFetch<{ recipient_code: string }>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: input.currency ?? 'NGN',
    }),
  });
}

export async function initiateTransfer(input: {
  amountMajor: number;
  recipientCode: string;
  reference: string;
  reason?: string;
  currency?: string;
}) {
  return paystackFetch<{
    transfer_code: string;
    status: string;
    reference: string;
  }>('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(input.amountMajor * 100),
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason,
      currency: input.currency ?? 'NGN',
    }),
  });
}

export async function verifyTransfer(reference: string) {
  return paystackFetch<{
    reference: string;
    status: string;
    amount: number;
    currency: string;
    reason?: string;
  }>(`/transfer/verify/${encodeURIComponent(reference)}`);
}

export function verifyPaystackWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || !signature) return false;
  const hash = createHmac('sha512', secret).update(rawBody).digest('hex');
  const expected = Buffer.from(hash);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
