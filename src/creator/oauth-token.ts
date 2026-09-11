import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

function encryptionKey() {
  const dedicatedKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (process.env.NODE_ENV === 'production' && !dedicatedKey) {
    throw new Error(
      'OAUTH_TOKEN_ENCRYPTION_KEY is required in production and cannot fall back to the JWT secret',
    );
  }
  const secret = dedicatedKey || process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY is required for social OAuth');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptOAuthToken(token?: string | null) {
  if (!token) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptOAuthToken(value?: string | null) {
  if (!value) return null;
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Social connection must be reconnected securely');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
