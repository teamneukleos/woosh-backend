import { earningsStage } from './present';

const now = new Date('2026-11-27T12:00:00Z');
const future = new Date('2026-11-29T12:00:00Z');
const past = new Date('2026-11-26T12:00:00Z');

describe('earningsStage', () => {
  it.each([
    ['COMMITTED', null, 'reserved'],
    // Some deliverables approved, others outstanding: still reserved, not yet earned.
    ['APPROVED', null, 'reserved'],
    ['APPROVED', future, 'pending'],
    ['APPROVED', past, 'processing'],
    ['PROCESSING', past, 'processing'],
    ['PAID', past, 'paid'],
    ['FAILED', past, 'attention'],
    ['DISPUTED', future, 'attention'],
    ['REVERSED', past, 'attention'],
  ] as const)('%s with release %s is %s', (status, availableAt, expected) => {
    expect(earningsStage({ status, availableAt }, now)).toBe(expected);
  });

  it('never reports reserved, failed, disputed or reversed money as paid', () => {
    for (const status of [
      'COMMITTED',
      'FAILED',
      'DISPUTED',
      'REVERSED',
    ] as const) {
      expect(earningsStage({ status, availableAt: past }, now)).not.toBe(
        'paid',
      );
    }
  });
});
