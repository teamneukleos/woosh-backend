import { automatedBriefChecks, moderationPath } from './trust';

describe('brief moderation policy', () => {
  it('queues the first brief from a verified organisation', () => {
    expect(
      moderationPath({
        orgVerified: true,
        isFirstCampaign: true,
        rateAnomaly: false,
      }),
    ).toBe('admin_review_queue');
  });

  it('auto-publishes established verified organisations after clean checks', () => {
    expect(
      moderationPath({
        orgVerified: true,
        isFirstCampaign: false,
        rateAnomaly: false,
      }),
    ).toBe('auto_publish');
  });

  it('flags prohibited categories and anomalous rates', () => {
    const prohibited = automatedBriefChecks({
      title: 'Casino launch',
      description: 'Create social posts for our new gambling product.',
      currency: 'NGN',
      rates: [250_000],
    });
    expect(prohibited.prohibitedCategory).toBe(true);
    expect(
      moderationPath({
        orgVerified: true,
        isFirstCampaign: false,
        rateAnomaly: prohibited.rateAnomaly,
        prohibitedCategory: prohibited.prohibitedCategory,
      }),
    ).toBe('policy_flag');
  });
});
