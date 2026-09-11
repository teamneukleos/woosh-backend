import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function key() {
  const secret =
    process.env.PAYOUT_ACCOUNT_ENCRYPTION_KEY ||
    (process.env.NODE_ENV === 'production' ? '' : process.env.JWT_ACCESS_SECRET);
  if (!secret) throw new Error('Payout account encryption is not configured');
  return createHash('sha256').update(secret).digest();
}

export function encryptAccountNumber(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptAccountNumber(value: string) {
  const [version, iv, tag, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new Error('Invalid encrypted payout account');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
