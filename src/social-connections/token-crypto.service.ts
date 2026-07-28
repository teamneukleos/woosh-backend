import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TokenCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>('SOCIAL_TOKEN_ENCRYPTION_KEY') ??
      config.getOrThrow<string>('JWT_SECRET');
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(value: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([1]), iv, authTag, ciphertext]);
  }

  decrypt(value: Uint8Array): string {
    const payload = Buffer.from(value);
    if (payload[0] !== 1 || payload.length < 30) {
      throw new Error('Unsupported encrypted token format');
    }

    const iv = payload.subarray(1, 13);
    const authTag = payload.subarray(13, 29);
    const ciphertext = payload.subarray(29);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
