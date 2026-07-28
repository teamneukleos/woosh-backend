import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type OAuthState = {
  userId: string;
  nonce: string;
  exp: number;
};

@Injectable()
export class OAuthStateService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('SOCIAL_OAUTH_STATE_SECRET') ??
      config.getOrThrow<string>('JWT_SECRET');
  }

  create(userId: string): string {
    const payload: OAuthState = {
      userId,
      nonce: randomBytes(16).toString('hex'),
      exp: Date.now() + 10 * 60 * 1000,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }

  verify(state: string): OAuthState {
    const [encoded, signature] = state.split('.');
    if (!encoded || !signature) {
      throw new BadRequestException('Invalid OAuth state');
    }

    const expected = Buffer.from(this.sign(encoded));
    const actual = Buffer.from(signature);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new BadRequestException('Invalid OAuth state');
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as OAuthState;
      if (!payload.userId || payload.exp < Date.now()) {
        throw new Error('Expired OAuth state');
      }
      return payload;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
  }

  private sign(encoded: string): string {
    return createHmac('sha256', this.secret)
      .update(encoded)
      .digest('base64url');
  }
}
