import { createHash, randomBytes } from 'crypto';

export function newOpaqueToken() {
  return randomBytes(32).toString('hex');
}

export function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
