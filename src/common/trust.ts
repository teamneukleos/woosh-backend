export type BriefModerationPath =
  | 'auto_publish'
  | 'admin_review_queue'
  | 'rate_anomaly_flag'
  | 'policy_flag';

export function moderationPath(input: {
  orgVerified: boolean;
  isFirstCampaign: boolean;
  rateAnomaly: boolean;
  prohibitedCategory?: boolean;
}): BriefModerationPath {
  if (input.prohibitedCategory) return 'policy_flag';
  if (input.rateAnomaly) return 'rate_anomaly_flag';
  if (!input.orgVerified || input.isFirstCampaign) return 'admin_review_queue';
  return 'auto_publish';
}

const PROHIBITED_BRIEF_TERMS = [
  'adult content',
  'casino',
  'firearm',
  'gambling',
  'illegal drug',
  'tobacco',
  'weapon',
];

export function automatedBriefChecks(input: {
  title: string;
  description: string;
  category?: string | null;
  currency: string;
  rates: Array<number | null | undefined>;
}) {
  const searchable = `${input.title} ${input.description} ${input.category ?? ''}`.toLowerCase();
  const prohibitedTerms = PROHIBITED_BRIEF_TERMS.filter((term) =>
    searchable.includes(term),
  );
  const rates = input.rates.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  const bounds = { minimum: 10_000, maximum: 50_000_000 };
  const currencyMismatch = input.currency.toUpperCase() !== 'NGN';
  const rateAnomaly =
    currencyMismatch || rates.some((value) => value < bounds.minimum || value > bounds.maximum);

  return {
    prohibitedTerms,
    prohibitedCategory: prohibitedTerms.length > 0,
    rateAnomaly,
  };
}
