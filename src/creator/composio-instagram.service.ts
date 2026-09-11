import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ProviderIdentity, ProviderMetrics } from './social-providers';
import {
  composioClient,
  composioInstagramCallbackUrl,
  composioUserId,
  INSTAGRAM_BUSINESS_REQUIRED,
  parseInstagramMediaMetrics,
  parseInstagramUserInfo,
} from './composio';

@Injectable()
export class ComposioInstagramService {
  private readonly logger = new Logger(ComposioInstagramService.name);

  async createAuthorizeUrl(userId: string, callbackState: string) {
    const authConfigId = process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID?.trim();
    if (!authConfigId) {
      throw new BadRequestException('Instagram Composio auth config is not set.');
    }
    const composio = composioClient();
    const composioId = composioUserId(userId);
    const existing = await composio.connectedAccounts.list({
      user_ids: [composioId],
      auth_config_ids: [authConfigId],
      statuses: ['ACTIVE'],
      limit: 1,
    });
    const callback = new URL(composioInstagramCallbackUrl());
    callback.searchParams.set('state', callbackState);
    if (existing.items[0]?.id) {
      callback.searchParams.set('connected_account_id', existing.items[0].id);
      callback.searchParams.set('status', 'success');
      callback.searchParams.set('reused', '1');
      return callback.toString();
    }

    try {
      const link = await composio.link.create({
        auth_config_id: authConfigId,
        user_id: composioId,
        callback_url: callback.toString(),
      });
      return link.redirect_url;
    } catch (error) {
      const retry = await composio.connectedAccounts.list({
        user_ids: [composioId],
        auth_config_ids: [authConfigId],
        statuses: ['ACTIVE'],
        limit: 1,
      });
      if (retry.items[0]?.id) {
        callback.searchParams.set('connected_account_id', retry.items[0].id);
        callback.searchParams.set('status', 'success');
        callback.searchParams.set('reused', '1');
        return callback.toString();
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Could not start Instagram connection.',
      );
    }
  }

  async fetchIdentity(
    userId: string,
    connectedAccountId: string,
  ): Promise<ProviderIdentity> {
    await this.waitUntilActive(connectedAccountId);
    const info = await this.execute('INSTAGRAM_GET_USER_INFO', userId, connectedAccountId, {
      ig_user_id: 'me',
    });
    if (!info.successful) {
      throw new BadRequestException(
        info.error || INSTAGRAM_BUSINESS_REQUIRED,
      );
    }
    let identity;
    try {
      identity = parseInstagramUserInfo(info.data);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : INSTAGRAM_BUSINESS_REQUIRED,
      );
    }
    try {
      const media = await this.execute(
        'INSTAGRAM_GET_IG_USER_MEDIA',
        userId,
        connectedAccountId,
        {
          ig_user_id: identity.externalId,
          limit: 12,
          fields:
            'id,caption,like_count,comments_count,view_count,media_type,permalink,timestamp',
        },
      );
      if (media.successful) {
        const extras = parseInstagramMediaMetrics(media.data);
        return {
          ...identity,
          averageViews: extras.averageViews,
          engagementRate: extras.engagementRate,
          topContent: extras.topContent,
          raw: { profile: identity.raw, media: media.data },
        };
      }
    } catch (error) {
      this.logger.warn(
        `Instagram media metrics skipped: ${error instanceof Error ? error.message : error}`,
      );
    }
    return identity;
  }

  async fetchMetrics(
    userId: string,
    connectedAccountId: string,
  ): Promise<ProviderMetrics> {
    const identity = await this.fetchIdentity(userId, connectedAccountId);
    return {
      handle: identity.handle,
      followers: identity.followers,
      engagementRate: identity.engagementRate,
      averageViews: identity.averageViews,
      topContent: identity.topContent,
      raw: identity.raw,
    };
  }

  private async waitUntilActive(connectedAccountId: string) {
    const composio = composioClient();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const account = await composio.connectedAccounts.retrieve(connectedAccountId);
      if (account.status === 'ACTIVE') return;
      if (account.status === 'FAILED' || account.status === 'EXPIRED') {
        throw new BadRequestException(
          account.status_reason || INSTAGRAM_BUSINESS_REQUIRED,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new BadRequestException(
      'Instagram is still connecting. Finish Facebook/Instagram authorization, then try again.',
    );
  }

  private async execute(
    slug: string,
    userId: string,
    connectedAccountId: string,
    args: Record<string, unknown>,
  ) {
    const version = process.env.COMPOSIO_INSTAGRAM_TOOL_VERSION?.trim();
    return composioClient().tools.execute(slug, {
      user_id: composioUserId(userId),
      connected_account_id: connectedAccountId,
      arguments: args,
      ...(version ? { version } : {}),
    });
  }
}
