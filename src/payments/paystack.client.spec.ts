import { createHmac } from 'crypto';
import { verifyPaystackWebhookSignature } from './paystack.client';

describe('Paystack webhook signatures', () => {
  it('accepts a matching HMAC SHA512 header', () => {
    process.env.PAYSTACK_SECRET_KEY = 'test-secret';
    const rawBody = '{"event":"transfer.success"}';
    const signature = createHmac('sha512', 'test-secret').update(rawBody).digest('hex');
    expect(verifyPaystackWebhookSignature(rawBody, signature)).toBe(true);
    expect(verifyPaystackWebhookSignature(rawBody, 'deadbeef')).toBe(false);
  });
});
