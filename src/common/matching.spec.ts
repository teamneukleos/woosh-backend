import { scoreBriefFit } from './matching';

const creator = {
  categories: ['Beauty'],
  languages: ['English', 'Yoruba'],
  locationCountry: 'NG',
  locationCity: 'Lagos',
  channels: ['INSTAGRAM', 'TIKTOK'],
  followers: 80_000,
  typicalRateMin: 80_000,
  typicalRateMax: 200_000,
};

describe('scoreBriefFit', () => {
  it('ranks overlapping category, channel and rate above a mismatch', () => {
    const fit = scoreBriefFit(
      {
        channels: ['INSTAGRAM'],
        category: 'Beauty',
        rateAmount: 120_000,
        publishedAt: new Date(),
        eligibility: { minFollowers: 20_000, languages: 'English', locations: 'Lagos' },
      },
      creator,
    );
    const miss = scoreBriefFit(
      {
        channels: ['YOUTUBE'],
        category: 'Sports',
        rateAmount: 2_000_000,
        publishedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        eligibility: { minFollowers: 500_000 },
      },
      creator,
    );
    expect(fit).toBeGreaterThan(miss);
  });
});
