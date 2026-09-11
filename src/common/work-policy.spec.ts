import {
  canAccessOwnedWork,
  canRespondToOffer,
  canTransitionDeliverable,
  canWithdrawApplication,
  idempotencyMatches,
} from './work-policy';

describe('work lifecycle', () => {
  it('allows only legal deliverable transitions', () => {
    expect(canTransitionDeliverable('NOT_STARTED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionDeliverable('IN_PROGRESS', 'APPROVED')).toBe(false);
    expect(canTransitionDeliverable('COMPLETED', 'IN_PROGRESS')).toBe(false);
  });

  it('prevents withdrawals after acceptance', () => {
    expect(canWithdrawApplication('SHORTLISTED')).toBe(true);
    expect(canWithdrawApplication('ACCEPTED')).toBe(false);
  });

  it('requires the other party to accept an active offer', () => {
    expect(
      canRespondToOffer({
        status: 'COUNTERED',
        offerCreatedById: 'brand-user',
        actorUserId: 'creator-user',
        applicationStatus: 'SHORTLISTED',
      }),
    ).toBe(true);
    expect(
      canRespondToOffer({
        status: 'COUNTERED',
        offerCreatedById: 'creator-user',
        actorUserId: 'creator-user',
        applicationStatus: 'SHORTLISTED',
      }),
    ).toBe(false);
  });

  it('allows only the assigned creator or owning brand', () => {
    expect(
      canAccessOwnedWork({
        isPlatformAdmin: false,
        actorCreatorProfileId: 'creator-other',
        actorBrandIds: ['brand-other'],
        ownerCreatorProfileId: 'creator-owner',
        ownerBrandId: 'brand-owner',
      }),
    ).toBe(false);
    expect(
      canAccessOwnedWork({
        isPlatformAdmin: false,
        actorCreatorProfileId: 'creator-owner',
        actorBrandIds: [],
        ownerCreatorProfileId: 'creator-owner',
        ownerBrandId: 'brand-owner',
      }),
    ).toBe(true);
  });

  it('binds idempotency keys to one deliverable', () => {
    expect(idempotencyMatches('deliverable-a', 'deliverable-a')).toBe(true);
    expect(idempotencyMatches('deliverable-a', 'deliverable-b')).toBe(false);
  });
});
