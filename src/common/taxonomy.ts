export const CREATOR_CATEGORIES = [
  'Beauty',
  'Fashion',
  'Lifestyle',
  'Food & Drink',
  'Tech',
  'Gaming',
  'Music',
  'Comedy',
  'Education',
  'Fitness & Wellness',
  'Parenting',
  'Finance',
  'Travel',
  'Sports',
  'Automotive',
  'Home & DIY',
  'Business',
  'News & Culture',
] as const;

export type CreatorCategory = (typeof CREATOR_CATEGORIES)[number];

export const LANGUAGES = [
  'English',
  'Yoruba',
  'Igbo',
  'Hausa',
  'Pidgin',
  'French',
  'Portuguese',
  'Arabic',
  'Swahili',
] as const;

export const SOCIAL_CHANNELS = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE'] as const;

export type SocialChannelName = (typeof SOCIAL_CHANNELS)[number];

export const BRAND_INDUSTRIES = [
  'FMCG',
  'Beauty & Personal Care',
  'Fashion & Apparel',
  'Food & Beverage',
  'Tech & Telecom',
  'Finance & Fintech',
  'Entertainment & Media',
  'Health & Pharma',
  'Automotive',
  'Travel & Hospitality',
  'Retail & E-commerce',
  'Education',
  'Government & NGO',
  'Other',
] as const;

export type BrandIndustry = (typeof BRAND_INDUSTRIES)[number];
