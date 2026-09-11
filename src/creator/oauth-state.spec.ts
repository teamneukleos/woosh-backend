import { createHmac } from 'node:crypto';
import { decodeOAuthState, encodeOAuthState } from './oauth-state';

const originalJwt = process.env.JWT_ACCESS_SECRET;
const originalState = process.env.SOCIAL_OAUTH_STATE_SECRET;

afterEach(() => {
  process.env.JWT_ACCESS_SECRET = originalJwt;
  process.env.SOCIAL_OAUTH_STATE_SECRET = originalState;
});

describe('OAuth state', () => {
  it('round-trips a signed payload', () => {
    process.env.JWT_ACCESS_SECRET = 'state-secret';
    delete process.env.SOCIAL_OAUTH_STATE_SECRET;
    const encoded = encodeOAuthState({ channel: 'INSTAGRAM', nonce: 'abc' });
    const decoded = decodeOAuthState<{ channel: string; nonce: string; exp: number }>(
      encoded,
    );
    expect(decoded.channel).toBe('INSTAGRAM');
    expect(decoded.nonce).toBe('abc');
    expect(decoded.exp).toBeGreaterThan(Date.now());
  });

  it('rejects a tampered payload', () => {
    process.env.JWT_ACCESS_SECRET = 'state-secret';
    delete process.env.SOCIAL_OAUTH_STATE_SECRET;
    const encoded = encodeOAuthState({ channel: 'INSTAGRAM' });
    const [body] = encoded.split('.');
    expect(() => decodeOAuthState(`${body}.aaaaaaaa`)).toThrow(/signature/);
  });

  it('rejects an expired payload', () => {
    process.env.JWT_ACCESS_SECRET = 'state-secret';
    delete process.env.SOCIAL_OAUTH_STATE_SECRET;
    const encoded = encodeOAuthState({ channel: 'YOUTUBE', nonce: 'n' });
    const [body, signature] = encoded.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp: number;
    };
    payload.exp = Date.now() - 1;
    const expiredBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const expiredSig = createHmac('sha256', 'state-secret')
      .update(expiredBody)
      .digest('base64url');
    expect(() => decodeOAuthState(`${expiredBody}.${expiredSig}`)).toThrow(/expired/);
    expect(signature).toBeTruthy();
  });
});
