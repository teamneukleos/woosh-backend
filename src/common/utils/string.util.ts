import { randomBytes } from 'crypto';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function generateReferralCode(prefix = 'KR'): string {
  return `${prefix}${randomBytes(4).toString('hex').toUpperCase()}`;
}
