export const MATCHING_WEIGHTS = {
  hardEligibility: 'required',
  contentRelevance: 'high',
  audienceFit: 'high',
  performanceQuality: 'medium-high',
  commercialFit: 'medium',
  reliability: 'medium',
  relationshipHistory: 'medium',
  freshnessAvailability: 'low-medium',
} as const;

export type MatchableBrief = {
  channels: string[];
  category?: string | null;
  rateAmount?: number | null;
  rateMin?: number | null;
  rateMax?: number | null;
  publishedAt?: Date | null;
  eligibility?: unknown;
};

export type MatchableCreator = {
  categories: string[];
  languages: string[];
  locationCountry?: string | null;
  locationCity?: string | null;
  channels: string[];
  followers: number;
  typicalRateMin?: number | null;
  typicalRateMax?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[,|/]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function weight(level: (typeof MATCHING_WEIGHTS)[keyof typeof MATCHING_WEIGHTS]) {
  switch (level) {
    case 'required':
      return 8;
    case 'high':
      return 5;
    case 'medium-high':
      return 4;
    case 'medium':
      return 3;
    case 'low-medium':
      return 2;
    default:
      return 1;
  }
}

export function scoreBriefFit(brief: MatchableBrief, creator: MatchableCreator): number {
  const eligibility = asRecord(brief.eligibility);
  const minFollowers = Number(eligibility.minFollowers ?? 0);
  let score = 0;

  if (minFollowers > 0 && creator.followers < minFollowers) {
    score -= weight(MATCHING_WEIGHTS.hardEligibility);
  } else if (minFollowers > 0) {
    score += weight(MATCHING_WEIGHTS.performanceQuality);
  }

  const channelHits = brief.channels.filter((channel) =>
    creator.channels.includes(channel),
  ).length;
  if (brief.channels.length) {
    score += (channelHits / brief.channels.length) * weight(MATCHING_WEIGHTS.contentRelevance);
  }

  if (brief.category && creator.categories.includes(brief.category)) {
    score += weight(MATCHING_WEIGHTS.contentRelevance);
  }

  const requiredLanguages = parseList(eligibility.languages);
  if (requiredLanguages.length) {
    const langHits = requiredLanguages.filter((language) =>
      creator.languages.map((item) => item.toLowerCase()).includes(language),
    ).length;
    score += (langHits / requiredLanguages.length) * weight(MATCHING_WEIGHTS.audienceFit);
  }

  const locations = parseList(eligibility.locations);
  if (locations.length) {
    const places = [creator.locationCity, creator.locationCountry]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase());
    if (
      locations.some((location) =>
        places.some((place) => place.includes(location) || location.includes(place)),
      )
    ) {
      score += weight(MATCHING_WEIGHTS.audienceFit);
    }
  }

  const briefMin = brief.rateMin ?? brief.rateAmount;
  const briefMax = brief.rateMax ?? brief.rateAmount;
  if (
    briefMin != null &&
    creator.typicalRateMax != null &&
    briefMin <= Number(creator.typicalRateMax)
  ) {
    score += weight(MATCHING_WEIGHTS.commercialFit);
  } else if (
    briefMax != null &&
    creator.typicalRateMin != null &&
    briefMax >= Number(creator.typicalRateMin)
  ) {
    score += weight(MATCHING_WEIGHTS.commercialFit) / 2;
  }

  if (brief.publishedAt) {
    const ageDays = (Date.now() - brief.publishedAt.getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, weight(MATCHING_WEIGHTS.freshnessAvailability) - ageDays / 14);
  }

  return score;
}
