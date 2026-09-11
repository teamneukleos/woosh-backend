import { decryptOAuthToken, encryptOAuthToken } from './oauth-token';

const originalKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
const originalJwt = process.env.JWT_ACCESS_SECRET;
const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = originalKey;
  process.env.JWT_ACCESS_SECRET = originalJwt;
  process.env.NODE_ENV = originalEnv;
});

describe('OAuth token encryption', () => {
  it('round-trips without exposing the plaintext', () => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'test-key-that-is-long-enough';
    const encrypted = encryptOAuthToken('provider-secret-token');
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('provider-secret-token');
    expect(decryptOAuthToken(encrypted)).toBe('provider-secret-token');
  });

  it('rejects legacy plaintext tokens', () => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'test-key-that-is-long-enough';
    expect(() => decryptOAuthToken('plaintext-token')).toThrow(/reconnected/);
  });

  it('requires a dedicated key in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '';
    process.env.JWT_ACCESS_SECRET = 'jwt-secret-must-not-encrypt-provider-tokens';
    expect(() => encryptOAuthToken('provider-secret-token')).toThrow(/required in production/);
  });
});
