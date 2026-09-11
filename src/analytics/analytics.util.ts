export function clampInsightDays(days: number | undefined) {
  return days === 7 || days === 90 ? days : 30;
}

export function daysAgo(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 86_400_000);
}

export function utcDayStart(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function latestMetricsByContent<
  T extends {
    id: string;
    submissionId: string | null;
    deliverableId: string | null;
    postUrl: string | null;
  },
>(metrics: T[]) {
  const latest = new Map<string, T>();
  for (const metric of metrics) {
    const key =
      metric.submissionId || metric.deliverableId || metric.postUrl || metric.id;
    if (!latest.has(key)) latest.set(key, metric);
  }
  return [...latest.values()];
}

export function sumMetrics(
  metrics: Array<{
    reach: number | null;
    views: number | null;
    engagement: number | null;
    impressions: number | null;
  }>,
): { reach: number; views: number; engagement: number; impressions: number } {
  const totals = { reach: 0, views: 0, engagement: 0, impressions: 0 };
  for (const metric of metrics) {
    totals.reach += metric.reach ?? 0;
    totals.views += metric.views ?? 0;
    totals.engagement += metric.engagement ?? 0;
    totals.impressions += metric.impressions ?? 0;
  }
  return totals;
}
