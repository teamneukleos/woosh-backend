import {
  canAccessFinancialDocument,
  canTransitionObligation,
  disputeWindowOpen,
  payoutReleaseAt,
  providerMoneyMatches,
} from './payments-policy';

describe('payment obligation policy', () => {
  it('promotes committed funds to approved, not straight to paid', () => {
    expect(canTransitionObligation('COMMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionObligation('COMMITTED', 'PAID')).toBe(false);
    expect(canTransitionObligation('APPROVED', 'PROCESSING')).toBe(true);
    expect(canTransitionObligation('PROCESSING', 'FAILED')).toBe(true);
    expect(canTransitionObligation('FAILED', 'PROCESSING')).toBe(true);
    expect(canTransitionObligation('PAID', 'PROCESSING')).toBe(false);
  });

  it('holds payout for 72 hours after completion', () => {
    const completed = new Date('2026-08-24T12:00:00.000Z');
    const release = payoutReleaseAt(completed);
    expect(release.toISOString()).toBe('2026-08-27T12:00:00.000Z');
    expect(disputeWindowOpen(release, new Date('2026-08-27T11:59:59.000Z'))).toBe(true);
    expect(disputeWindowOpen(release, release)).toBe(false);
  });

  it('rejects provider amount and currency mismatches', () => {
    expect(
      providerMoneyMatches({
        expectedMajor: 90_000,
        expectedCurrency: 'NGN',
        amountMinor: 9_000_000,
        currency: 'NGN',
      }),
    ).toBe(true);
    expect(
      providerMoneyMatches({
        expectedMajor: 90_000,
        expectedCurrency: 'NGN',
        amountMinor: 8_000_000,
        currency: 'NGN',
      }),
    ).toBe(false);
  });

  it('denies cross-tenant statement and receipt access', () => {
    expect(
      canAccessFinancialDocument({
        isPlatformAdmin: false,
        actorCreatorProfileId: 'creator-other',
        actorBrandIds: ['brand-other'],
        documentCreatorProfileId: 'creator-owner',
        documentBrandId: 'brand-owner',
      }),
    ).toBe(false);
    expect(
      canAccessFinancialDocument({
        isPlatformAdmin: false,
        actorCreatorProfileId: 'creator-owner',
        actorBrandIds: [],
        documentCreatorProfileId: 'creator-owner',
        documentBrandId: 'brand-owner',
      }),
    ).toBe(true);
  });
});
