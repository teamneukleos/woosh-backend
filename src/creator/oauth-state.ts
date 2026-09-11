import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret() {
  const secret =
    process.env.SOCIAL_OAUTH_STATE_SECRET?.trim() ||
    process.env.JWT_ACCESS_SECRET?.trim();
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required for OAuth state');
  return secret;
}

export function encodeOAuthState(payload: object) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      nonce:
        'nonce' in payload && typeof payload.nonce === 'string'
          ? payload.nonce
          : randomBytes(16).toString('hex'),
      exp: Date.now() + STATE_TTL_MS,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function decodeOAuthState<T>(state: string): T {
  const [body, suppliedSignature] = state.split('.');
  if (!body || !suppliedSignature) throw new Error('Invalid OAuth state');
  const expected = createHmac('sha256', stateSecret()).update(body).digest();
  const supplied = Buffer.from(suppliedSignature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error('Invalid OAuth state signature');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & {
    exp?: number;
  };
  if (!payload.exp || payload.exp < Date.now()) {
    throw new Error('Invalid or expired OAuth state');
  }
  return payload;
}
