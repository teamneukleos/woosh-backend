import { capacityRequired, splitFee } from './fees';

describe('splitFee', () => {
  it('takes 0% of the creator rate', () => {
    expect(splitFee(150_000)).toEqual({
      gross: 150_000,
      platformFee: 0,
      net: 150_000,
    });
    expect(capacityRequired(150_000)).toBe(150_000);
  });
});
