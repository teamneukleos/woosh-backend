import { decryptAccountNumber, encryptAccountNumber } from './payout-account-crypto';

describe('payout account encryption', () => {
  it('round-trips account numbers without storing plaintext', () => {
    process.env.PAYOUT_ACCOUNT_ENCRYPTION_KEY = 'test-key-for-payouts';
    const encrypted = encryptAccountNumber('0123456789');
    expect(encrypted).not.toContain('0123456789');
    expect(decryptAccountNumber(encrypted)).toBe('0123456789');
  });
});
