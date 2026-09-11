import {
  decodeComposioAccountId,
  encodeComposioAccountId,
  parseInstagramMediaMetrics,
  parseInstagramUserInfo,
} from './composio';

describe('composio Instagram helpers', () => {
  it('round-trips connected account ids', () => {
    expect(encodeComposioAccountId('ca_123')).toBe('composio:ca_123');
    expect(decodeComposioAccountId('composio:ca_123')).toBe('ca_123');
    expect(decodeComposioAccountId('plain')).toBeNull();
  });

  it('reads nested Instagram user info without inventing followers', () => {
    const identity = parseInstagramUserInfo({
      data: { id: '178414000', username: 'ada.creates', followers_count: 1200 },
    });
    expect(identity).toMatchObject({
      externalId: '178414000',
      handle: 'ada.creates',
      followers: 1200,
    });
  });

  it('rejects missing Instagram ids', () => {
    expect(() => parseInstagramUserInfo({ data: { username: 'personal' } })).toThrow(
      'instagram_business_required',
    );
  });

  it('averages media metrics only when view counts exist', () => {
    const metrics = parseInstagramMediaMetrics({
      data: [
        { like_count: 10, comments_count: 2, view_count: 100 },
        { like_count: 20, comments_count: 4, view_count: 300 },
      ],
    });
    expect(metrics.averageViews).toBe(200);
    expect(metrics.engagementRate).toBeCloseTo(9);
  });
});
