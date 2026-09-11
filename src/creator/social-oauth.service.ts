import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SocialChannel, SocialConnectionStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { SocialChannelName } from '../common/taxonomy';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeHandle } from './handle';
import { ComposioInstagramService } from './composio-instagram.service';
import {
  decodeComposioAccountId,
  encodeComposioAccountId,
} from './composio';
import {
  allowDevOAuth,
  composioInstagramConfigured,
  instagramResultUrl,
  metaGraphVersion,
  metaInstagramConfigured,
  oauthConfiguredFor,
  oauthRedirectUri,
  youtubeResultUrl,
  YOUTUBE_SCOPES,
} from './oauth-config';
import { decodeOAuthState, encodeOAuthState } from './oauth-state';
import { decryptOAuthToken, encryptOAuthToken } from './oauth-token';
import { CreatorProfileService } from './profile.service';
import {
  exchangeCode,
  fetchProviderMetrics,
  refreshYoutubeAccessToken,
  type ProviderIdentity,
} from './social-providers';

type OAuthState = {
  channel: SocialChannelName;
  creatorProfileId: string;
  userId: string;
  nonce: string;
};

@Injectable()
export class SocialOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: CreatorProfileService,
    private readonly composioInstagram: ComposioInstagramService,
  ) {}

  async authorize(
    creatorProfileId: string,
    userId: string,
    channel: SocialChannelName,
  ) {
    await this.profiles.connectSocial(creatorProfileId, userId, { channel });
    const authorizeUrl = await this.buildAuthorizeUrl({
      channel,
      creatorProfileId,
      userId,
      nonce: randomBytes(16).toString('hex'),
    });
    return {
      authorizeUrl,
      channel,
      message: authorizeUrl
        ? 'Continue at the provider to verify this account. Metrics come from the platform — do not type a follower count.'
        : 'Handle reserved as PENDING. Configure provider OAuth on Nest, or use the local demo connection.',
    };
  }

  async completeCallback(input: {
    channel: SocialChannelName;
    code?: string;
    state: string;
    connectedAccountId?: string;
  }) {
    if (input.channel === 'INSTAGRAM' && input.connectedAccountId) {
      return this.completeComposioInstagram(input.state, input.connectedAccountId);
    }

    let parsed: OAuthState;
    try {
      parsed = decodeOAuthState<OAuthState>(input.state);
    } catch {
      throw new BadRequestException('Invalid OAuth state.');
    }
    if (parsed.channel !== input.channel) {
      throw new BadRequestException('OAuth channel does not match the callback.');
    }
    if (!input.code) {
      throw new BadRequestException('OAuth authorization code is missing.');
    }
    if (input.channel === 'INSTAGRAM' && !metaInstagramConfigured()) {
      throw new BadRequestException('Instagram OAuth is not configured.');
    }
    if (!oauthConfiguredFor(input.channel)) {
      throw new BadRequestException(`${input.channel} OAuth is not configured.`);
    }

    let tokens;
    try {
      tokens = await exchangeCode(input.channel, input.code);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'OAuth token exchange failed.',
      );
    }

    return this.persistConnectedAccount({
      parsed,
      channel: input.channel,
      identity: tokens.identity,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  }

  private async completeComposioInstagram(state: string, connectedAccountId: string) {
    if (!composioInstagramConfigured()) {
      throw new BadRequestException('Instagram OAuth is not configured.');
    }
    let parsed: OAuthState;
    try {
      parsed = decodeOAuthState<OAuthState>(state);
    } catch {
      throw new BadRequestException('Invalid OAuth state.');
    }
    if (parsed.channel !== 'INSTAGRAM') {
      throw new BadRequestException('OAuth channel does not match the callback.');
    }
    const identity = await this.composioInstagram.fetchIdentity(
      parsed.userId,
      connectedAccountId,
    );
    return this.persistConnectedAccount({
      parsed,
      channel: 'INSTAGRAM',
      identity,
      accessToken: encodeComposioAccountId(connectedAccountId),
    });
  }

  private async persistConnectedAccount(input: {
    parsed: OAuthState;
    channel: SocialChannelName;
    identity: ProviderIdentity;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }) {
    const { parsed, channel, identity } = input;
    const existing = await this.prisma.socialAccount.findUnique({
      where: {
        channel_externalId: {
          channel: channel as SocialChannel,
          externalId: identity.externalId,
        },
      },
    });
    if (existing && existing.creatorProfileId !== parsed.creatorProfileId) {
      throw new ConflictException(
        'This social account is already connected to another creator.',
      );
    }

    const account = await this.prisma.socialAccount.upsert({
      where: {
        channel_externalId: {
          channel: channel as SocialChannel,
          externalId: identity.externalId,
        },
      },
      create: {
        creatorProfileId: parsed.creatorProfileId,
        channel: channel as SocialChannel,
        externalId: identity.externalId,
        handle: identity.handle,
        status: SocialConnectionStatus.ACTIVE,
        accessTokenEnc: encryptOAuthToken(input.accessToken),
        refreshTokenEnc: input.refreshToken
          ? encryptOAuthToken(input.refreshToken)
          : existing?.refreshTokenEnc ?? null,
        tokenExpiresAt: input.expiresAt,
        lastRefreshedAt: new Date(),
      },
      update: {
        creatorProfileId: parsed.creatorProfileId,
        handle: identity.handle,
        status: SocialConnectionStatus.ACTIVE,
        accessTokenEnc: encryptOAuthToken(input.accessToken),
        refreshTokenEnc: input.refreshToken
          ? encryptOAuthToken(input.refreshToken)
          : existing?.refreshTokenEnc ?? undefined,
        tokenExpiresAt: input.expiresAt,
        lastRefreshedAt: new Date(),
      },
    });

    await this.prisma.socialAccount.deleteMany({
      where: {
        creatorProfileId: parsed.creatorProfileId,
        channel: channel as SocialChannel,
        status: SocialConnectionStatus.PENDING,
        id: { not: account.id },
      },
    });

    await this.prisma.socialMetricSnapshot.create({
      data: {
        socialAccountId: account.id,
        source: `${channel.toLowerCase()}_oauth`,
        followers: identity.followers ?? null,
        engagementRate: identity.engagementRate ?? null,
        averageViews: identity.averageViews ?? null,
        topContent: (identity.topContent as Prisma.InputJsonValue) ?? undefined,
        raw: identity.raw as Prisma.InputJsonValue,
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorId: parsed.userId,
        action: 'creator.social.oauth_complete',
        targetType: 'SocialAccount',
        targetId: account.id,
        after: { channel, handle: identity.handle },
      },
    });

    return {
      ok: true,
      id: account.id,
      channel: account.channel,
      handle: account.handle,
      status: account.status,
    };
  }

  async completeDev(
    creatorProfileId: string,
    userId: string,
    input: { channel: SocialChannelName; handle: string; followers?: number },
  ) {
    if (!allowDevOAuth()) {
      throw new ForbiddenException(
        'Dev OAuth is disabled. Set WOOSH_ALLOW_DEV_OAUTH=true on Nest (never in production).',
      );
    }
    const handle = normalizeHandle(input.handle);
    const externalId = `dev_${input.channel.toLowerCase()}_${handle}`;
    const account = await this.prisma.socialAccount.upsert({
      where: {
        channel_externalId: {
          channel: input.channel as SocialChannel,
          externalId,
        },
      },
      create: {
        creatorProfileId,
        channel: input.channel as SocialChannel,
        externalId,
        handle,
        status: SocialConnectionStatus.ACTIVE,
        accessTokenEnc: encryptOAuthToken(`dev_${randomBytes(8).toString('hex')}`),
        lastRefreshedAt: new Date(),
      },
      update: {
        creatorProfileId,
        handle,
        status: SocialConnectionStatus.ACTIVE,
        lastRefreshedAt: new Date(),
      },
    });

    await this.prisma.socialAccount.deleteMany({
      where: {
        creatorProfileId,
        channel: input.channel as SocialChannel,
        status: SocialConnectionStatus.PENDING,
        id: { not: account.id },
      },
    });

    await this.prisma.socialMetricSnapshot.create({
      data: {
        socialAccountId: account.id,
        source: 'dev_oauth',
        followers: input.followers ?? null,
        raw: { mode: 'dev', note: 'WOOSH_ALLOW_DEV_OAUTH' },
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'creator.social.dev_oauth',
        targetType: 'SocialAccount',
        targetId: account.id,
      },
    });
    return this.profiles.getMine(creatorProfileId);
  }

  async refresh(creatorProfileId: string, socialAccountId: string) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, creatorProfileId },
    });
    if (!account || account.status !== SocialConnectionStatus.ACTIVE) {
      throw new NotFoundException('Active social account not found.');
    }
    await this.refreshAccount(account.id);
    return this.profiles.getMine(creatorProfileId);
  }

  async refreshDue(input?: { staleBefore?: Date; limit?: number }) {
    const staleBefore =
      input?.staleBefore ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        status: SocialConnectionStatus.ACTIVE,
        OR: [{ lastRefreshedAt: null }, { lastRefreshedAt: { lt: staleBefore } }],
      },
      select: { id: true },
      orderBy: { lastRefreshedAt: 'asc' },
      take: Math.min(Math.max(input?.limit ?? 100, 1), 250),
    });
    const result = { attempted: accounts.length, refreshed: 0, failed: 0 };
    for (const account of accounts) {
      try {
        await this.refreshAccount(account.id);
        result.refreshed += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  private async refreshAccount(socialAccountId: string) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
    });
    if (!account || account.status !== SocialConnectionStatus.ACTIVE) {
      throw new Error('Account not active');
    }

    const latest = await this.prisma.socialMetricSnapshot.findFirst({
      where: { socialAccountId },
      orderBy: { capturedAt: 'desc' },
    });

    if (latest?.source === 'dev_oauth') {
      await this.prisma.$transaction([
        this.prisma.socialAccount.update({
          where: { id: socialAccountId },
          data: { lastRefreshedAt: new Date() },
        }),
        this.prisma.socialMetricSnapshot.create({
          data: {
            socialAccountId,
            source: 'dev_oauth',
            followers: latest.followers,
            engagementRate: latest.engagementRate,
            averageViews: latest.averageViews,
            postingFrequency: latest.postingFrequency,
            audienceGeo: latest.audienceGeo ?? undefined,
            audienceAge: latest.audienceAge ?? undefined,
            audienceGender: latest.audienceGender ?? undefined,
            topContent: latest.topContent ?? undefined,
            raw: { mode: 'dev_refresh', refreshedFrom: latest.id },
          },
        }),
      ]);
      return;
    }

    try {
      const access = decryptOAuthToken(account.accessTokenEnc);
      const composioAccountId = decodeComposioAccountId(access);
      if (composioAccountId) {
        const owner = await this.prisma.socialAccount.findUnique({
          where: { id: socialAccountId },
          select: { creatorProfile: { select: { userId: true } } },
        });
        const userId = owner?.creatorProfile.userId;
        if (!userId) throw new Error('Social account needs reconnecting');
        const metrics = await this.composioInstagram.fetchMetrics(
          userId,
          composioAccountId,
        );
        await this.prisma.$transaction([
          this.prisma.socialAccount.update({
            where: { id: socialAccountId },
            data: {
              lastRefreshedAt: new Date(),
              handle: metrics.handle || account.handle,
              status: SocialConnectionStatus.ACTIVE,
            },
          }),
          this.prisma.socialMetricSnapshot.create({
            data: {
              socialAccountId,
              source: `${account.channel.toLowerCase()}_oauth_refresh`,
              followers: metrics.followers ?? null,
              engagementRate: metrics.engagementRate ?? null,
              averageViews: metrics.averageViews ?? null,
              topContent: (metrics.topContent as Prisma.InputJsonValue) ?? undefined,
              raw: metrics.raw as Prisma.InputJsonValue,
            },
          }),
        ]);
        return;
      }

      const token = await this.resolveAccessToken(account);
      const metrics = await fetchProviderMetrics({
        channel: account.channel,
        externalId: account.externalId,
        accessToken: token,
      });
      await this.prisma.$transaction([
        this.prisma.socialAccount.update({
          where: { id: socialAccountId },
          data: {
            lastRefreshedAt: new Date(),
            handle: metrics.handle || account.handle,
            status: SocialConnectionStatus.ACTIVE,
          },
        }),
        this.prisma.socialMetricSnapshot.create({
          data: {
            socialAccountId,
            source: `${account.channel.toLowerCase()}_oauth_refresh`,
            followers: metrics.followers ?? null,
            engagementRate: metrics.engagementRate ?? null,
            averageViews: metrics.averageViews ?? null,
            topContent: (metrics.topContent as Prisma.InputJsonValue) ?? undefined,
            raw: metrics.raw as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (error) {
      await this.prisma.socialAccount.update({
        where: { id: socialAccountId },
        data: { status: SocialConnectionStatus.EXPIRED },
      });
      throw error;
    }
  }

  private async buildAuthorizeUrl(input: OAuthState) {
    if (!oauthConfiguredFor(input.channel)) return null;
    const state = encodeOAuthState(input);
    const redirectUri = oauthRedirectUri(input.channel);

    if (input.channel === 'INSTAGRAM' && composioInstagramConfigured()) {
      return this.composioInstagram.createAuthorizeUrl(input.userId, state);
    }

    if (input.channel === 'INSTAGRAM') {
      const params = new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        redirect_uri: redirectUri,
        scope: 'instagram_basic,pages_show_list,pages_read_engagement',
        response_type: 'code',
        state,
      });
      return `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${params}`;
    }

    if (input.channel === 'TIKTOK') {
      const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        redirect_uri: redirectUri,
        scope: 'user.info.basic,user.info.stats',
        response_type: 'code',
        state,
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
    }

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: YOUTUBE_SCOPES.join(' '),
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  youtubeCallbackRedirect(status: 'connected' | 'error', message?: string) {
    return youtubeResultUrl(status, message);
  }

  instagramCallbackRedirect(status: 'connected' | 'error', message?: string) {
    return instagramResultUrl(status, message);
  }

  private async resolveAccessToken(account: {
    id: string;
    channel: SocialChannel;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    tokenExpiresAt: Date | null;
  }) {
    const access = decryptOAuthToken(account.accessTokenEnc);
    if (!access) throw new Error('Social account needs reconnecting');
    if (decodeComposioAccountId(access)) {
      throw new Error('Social account needs reconnecting');
    }
    const stillValid =
      !account.tokenExpiresAt ||
      account.tokenExpiresAt.getTime() > Date.now() + 60_000;
    if (stillValid) return access;
    if (account.channel !== 'YOUTUBE') {
      throw new Error('Social account needs reconnecting');
    }
    const refresh = decryptOAuthToken(account.refreshTokenEnc);
    if (!refresh) {
      throw new Error('YouTube authorization expired; reconnect the account');
    }
    const tokens = await refreshYoutubeAccessToken(refresh);
    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encryptOAuthToken(tokens.accessToken),
        tokenExpiresAt: tokens.expiresAt,
      },
    });
    return tokens.accessToken;
  }
}
