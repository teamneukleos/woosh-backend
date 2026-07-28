import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OAuthProvider,
  SocialPlatform,
  SyncSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthorizationUrlDto,
  SocialConnectionDto,
  SocialMessageDto,
} from './dto/social-connection.dto';
import { OAuthStateService } from './oauth-state.service';
import { TokenCryptoService } from './token-crypto.service';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type YouTubeChannel = {
  id: string;
  snippet: {
    title: string;
    customUrl?: string;
  };
  statistics: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
  };
};

type YouTubeChannelsResponse = {
  items?: YouTubeChannel[];
  error?: { message?: string };
};

@Injectable()
export class YouTubeService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly frontendRedirectUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly oauthState: OAuthStateService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.clientSecret =
      this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '';
    this.redirectUri =
      this.config.get<string>('GOOGLE_YOUTUBE_REDIRECT_URI') ?? '';
    this.frontendRedirectUrl =
      this.config.get<string>('SOCIAL_OAUTH_FRONTEND_REDIRECT_URL') ??
      `${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'}/oauth/youtube`;
  }

  async getAuthorizationUrl(userId: string): Promise<AuthorizationUrlDto> {
    this.ensureConfigured();
    await this.getCreator(userId);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: this.oauthState.create(userId),
    });

    return {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  async handleCallback(code: string, state: string): Promise<string> {
    this.ensureConfigured();
    const { userId } = this.oauthState.verify(state);
    const creator = await this.getCreator(userId);
    const tokens = await this.exchangeCode(code);
    const channel = await this.fetchChannel(tokens.accessToken);

    const existingOAuth = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: OAuthProvider.GOOGLE,
          providerAccountId: channel.id,
        },
      },
    });

    if (existingOAuth && existingOAuth.userId !== userId) {
      throw new ConflictException(
        'This YouTube channel is already connected to another account',
      );
    }

    const existingSocial = await this.prisma.creatorSocialAccount.findUnique({
      where: {
        creatorId_platform: {
          creatorId: creator.id,
          platform: SocialPlatform.YOUTUBE,
        },
      },
    });
    const isPrimary =
      existingSocial?.isPrimary ??
      ((await this.prisma.creatorSocialAccount.count({
        where: { creatorId: creator.id },
      })) === 0);

    await this.prisma.$transaction(async (tx) => {
      const oauth = existingOAuth
        ? await tx.oAuthAccount.update({
            where: { id: existingOAuth.id },
            data: {
              accessTokenEnc: this.tokenCrypto.encrypt(tokens.accessToken),
              refreshTokenEnc: tokens.refreshToken
                ? this.tokenCrypto.encrypt(tokens.refreshToken)
                : existingOAuth.refreshTokenEnc,
              scopes: tokens.scopes,
              expiresAt: tokens.expiresAt,
            },
          })
        : await tx.oAuthAccount.create({
            data: {
              userId,
              provider: OAuthProvider.GOOGLE,
              providerAccountId: channel.id,
              accessTokenEnc: this.tokenCrypto.encrypt(tokens.accessToken),
              refreshTokenEnc: tokens.refreshToken
                ? this.tokenCrypto.encrypt(tokens.refreshToken)
                : null,
              scopes: tokens.scopes,
              expiresAt: tokens.expiresAt,
            },
          });

      await tx.creatorSocialAccount.upsert({
        where: {
          creatorId_platform: {
            creatorId: creator.id,
            platform: SocialPlatform.YOUTUBE,
          },
        },
        create: {
          creatorId: creator.id,
          platform: SocialPlatform.YOUTUBE,
          handle: channel.snippet.customUrl ?? channel.snippet.title,
          platformUserId: channel.id,
          profileUrl: `https://www.youtube.com/channel/${channel.id}`,
          followerCount: this.followerCount(channel),
          isPrimary,
          lastSyncedAt: new Date(),
          syncSource: SyncSource.API,
          oauthAccountId: oauth.id,
        },
        update: {
          handle: channel.snippet.customUrl ?? channel.snippet.title,
          platformUserId: channel.id,
          profileUrl: `https://www.youtube.com/channel/${channel.id}`,
          followerCount: this.followerCount(channel),
          lastSyncedAt: new Date(),
          syncSource: SyncSource.API,
          oauthAccountId: oauth.id,
        },
      });
    });

    return this.frontendUrl({ youtube: 'connected' });
  }

  callbackErrorUrl(message: string): string {
    return this.frontendUrl({ youtube: 'error', message });
  }

  async list(userId: string): Promise<SocialConnectionDto[]> {
    const creator = await this.getCreator(userId);
    const accounts = await this.prisma.creatorSocialAccount.findMany({
      where: { creatorId: creator.id },
      orderBy: [{ isPrimary: 'desc' }, { platform: 'asc' }],
    });
    return accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      handle: account.handle,
      profileUrl: account.profileUrl,
      followerCount: account.followerCount,
      isPrimary: account.isPrimary,
      lastSyncedAt: account.lastSyncedAt,
      connected: Boolean(account.oauthAccountId),
    }));
  }

  async sync(userId: string): Promise<SocialConnectionDto> {
    this.ensureConfigured();
    const creator = await this.getCreator(userId);
    const social = await this.prisma.creatorSocialAccount.findUnique({
      where: {
        creatorId_platform: {
          creatorId: creator.id,
          platform: SocialPlatform.YOUTUBE,
        },
      },
      include: { oauthAccount: true },
    });
    if (!social?.oauthAccount) {
      throw new NotFoundException('YouTube is not connected');
    }

    const accessToken = await this.getValidAccessToken(social.oauthAccount);
    const channel = await this.fetchChannel(accessToken);
    const updated = await this.prisma.creatorSocialAccount.update({
      where: { id: social.id },
      data: {
        handle: channel.snippet.customUrl ?? channel.snippet.title,
        platformUserId: channel.id,
        profileUrl: `https://www.youtube.com/channel/${channel.id}`,
        followerCount: this.followerCount(channel),
        lastSyncedAt: new Date(),
        syncSource: SyncSource.API,
      },
    });

    return {
      id: updated.id,
      platform: updated.platform,
      handle: updated.handle,
      profileUrl: updated.profileUrl,
      followerCount: updated.followerCount,
      isPrimary: updated.isPrimary,
      lastSyncedAt: updated.lastSyncedAt,
      connected: true,
    };
  }

  async disconnect(userId: string): Promise<SocialMessageDto> {
    const creator = await this.getCreator(userId);
    const social = await this.prisma.creatorSocialAccount.findUnique({
      where: {
        creatorId_platform: {
          creatorId: creator.id,
          platform: SocialPlatform.YOUTUBE,
        },
      },
      include: { oauthAccount: true },
    });
    if (!social) {
      return { message: 'YouTube is already disconnected' };
    }

    if (social.oauthAccount) {
      const token = social.oauthAccount.refreshTokenEnc
        ? this.tokenCrypto.decrypt(social.oauthAccount.refreshTokenEnc)
        : this.tokenCrypto.decrypt(social.oauthAccount.accessTokenEnc);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      ).catch(() => undefined);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.creatorSocialAccount.delete({ where: { id: social.id } });
      if (social.oauthAccountId) {
        const links = await tx.creatorSocialAccount.count({
          where: { oauthAccountId: social.oauthAccountId },
        });
        if (links === 0) {
          await tx.oAuthAccount.delete({
            where: { id: social.oauthAccountId },
          });
        }
      }
    });

    return { message: 'YouTube disconnected successfully' };
  }

  private async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    expiresAt: Date;
  }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const body = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || !body.access_token) {
      throw new BadGatewayException(
        body.error_description ?? 'Google token exchange failed',
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      scopes: body.scope?.split(' ') ?? YOUTUBE_SCOPES,
      expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    };
  }

  private ensureConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadGatewayException(
        'YouTube OAuth is not configured on this environment',
      );
    }
  }

  private async getValidAccessToken(account: {
    id: string;
    accessTokenEnc: Uint8Array;
    refreshTokenEnc: Uint8Array | null;
    expiresAt: Date | null;
  }): Promise<string> {
    if (
      !account.expiresAt ||
      account.expiresAt.getTime() > Date.now() + 60_000
    ) {
      return this.tokenCrypto.decrypt(account.accessTokenEnc);
    }
    if (!account.refreshTokenEnc) {
      throw new UnauthorizedException(
        'YouTube authorization expired; reconnect the account',
      );
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: this.tokenCrypto.decrypt(account.refreshTokenEnc),
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || !body.access_token) {
      throw new UnauthorizedException(
        'YouTube authorization was revoked; reconnect the account',
      );
    }

    await this.prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: this.tokenCrypto.encrypt(body.access_token),
        expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
      },
    });
    return body.access_token;
  }

  private async fetchChannel(accessToken: string): Promise<YouTubeChannel> {
    const params = new URLSearchParams({
      part: 'id,snippet,statistics',
      mine: 'true',
    });
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const body = (await response.json()) as YouTubeChannelsResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        body.error?.message ?? 'Could not read YouTube channel',
      );
    }
    const channel = body.items?.[0];
    if (!channel) {
      throw new NotFoundException(
        'No YouTube channel was found for this Google account',
      );
    }
    return channel;
  }

  private followerCount(channel: YouTubeChannel): number {
    if (channel.statistics.hiddenSubscriberCount) return 0;
    const count = Number(channel.statistics.subscriberCount ?? 0);
    return Number.isSafeInteger(count)
      ? Math.min(count, 2_147_483_647)
      : 0;
  }

  private async getCreator(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) {
      throw new NotFoundException(
        'Complete creator onboarding before connecting YouTube',
      );
    }
    return creator;
  }

  private frontendUrl(params: Record<string, string>): string {
    const url = new URL(this.frontendRedirectUrl);
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    return url.toString();
  }
}
