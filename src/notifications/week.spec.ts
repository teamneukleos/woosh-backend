import { utcWeekStart } from './week';

describe('utcWeekStart', () => {
  it('returns Monday of the current UTC week', () => {
    const wednesday = new Date('2026-08-26T15:00:00.000Z');
    expect(utcWeekStart(wednesday).toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });

  it('keeps Monday as the start', () => {
    const monday = new Date('2026-08-24T00:00:00.000Z');
    expect(utcWeekStart(monday).toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });
});
