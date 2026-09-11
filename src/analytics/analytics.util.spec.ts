import {
  clampInsightDays,
  daysAgo,
  latestMetricsByContent,
  sumMetrics,
} from './analytics.util';

describe('analytics helpers', () => {
  it('clamps insight windows to 7, 30, or 90 days', () => {
    expect(clampInsightDays(7)).toBe(7);
    expect(clampInsightDays(90)).toBe(90);
    expect(clampInsightDays(30)).toBe(30);
    expect(clampInsightDays(12)).toBe(30);
    expect(clampInsightDays(undefined)).toBe(30);
  });

  it('keeps the first (latest) metric per content key', () => {
    const rows = [
      { id: 'm1', submissionId: 's1', deliverableId: null, postUrl: null },
      { id: 'm2', submissionId: 's1', deliverableId: null, postUrl: null },
      { id: 'm3', submissionId: null, deliverableId: 'd1', postUrl: null },
    ];
    expect(latestMetricsByContent(rows).map((row) => row.id)).toEqual([
      'm1',
      'm3',
    ]);
  });

  it('sums latest metrics', () => {
    expect(
      sumMetrics([
        { reach: 10, views: 2, engagement: null, impressions: 4 },
        { reach: null, views: 3, engagement: 1, impressions: null },
      ]),
    ).toEqual({ reach: 10, views: 5, engagement: 1, impressions: 4 });
  });

  it('computes a millisecond lookback', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    expect(daysAgo(1, now).toISOString()).toBe('2026-08-25T12:00:00.000Z');
  });
});
