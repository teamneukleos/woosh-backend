import { createHash } from 'node:crypto';
import type { SocialChannelName } from '../common/taxonomy';
import { metaGraphVersion, oauthRedirectUri, YOUTUBE_CHANNEL_REQUIRED } from './oauth-config';

function capInt(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 2_147_483_647);
}

export type ProviderIdentity = {
  externalId: string;
  handle: string;
  followers?: number;
  engagementRate?: number;
  averageViews?: number;
  topContent?: object;
  raw: object;
};

export type ProviderTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  identity: ProviderIdentity;
};

export type ProviderMetrics = {
  handle?: string;
  followers?: number;
  engagementRate?: number;
  averageViews?: number;
  topContent?: object;
  raw: object;
};

export async function exchangeCode(
  channel: SocialChannelName,
  code: string,
): Promise<ProviderTokens> {
  const redirectUri = oauthRedirectUri(channel);

  if (channel === 'INSTAGRAM') {
    const body = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      client_secret: process.env.META_APP_SECRET!,
      redirect_uri: redirectUri,
      code,
    });
    const tokenRes = await fetch(
      `https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`,
      { method: 'POST', body },
    );
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message: string };
    };
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error?.message || 'Instagram token exchange failed');
    }

    const accountsRes = await fetch(
      `https://graph.facebook.com/${metaGraphVersion()}/me/accounts?fields=id,name,instagram_business_account{id,username,followers_count}&access_token=${encodeURIComponent(tokenJson.access_token)}`,
    );
    const accounts = (await accountsRes.json()) as {
      data?: Array<{
        instagram_business_account?: {
          id?: string;
          username?: string;
          followers_count?: number;
        };
      }>;
      error?: { message?: string };
    };
    const instagram = accounts.data?.find(
      (item) => item.instagram_business_account?.id,
    )?.instagram_business_account;
    if (!accountsRes.ok || !instagram?.id) {
      throw new Error(
        accounts.error?.message ||
          'Connect an Instagram Business or Creator account linked to a Facebook Page',
      );
    }
    const externalId = instagram.id;
    return {
      accessToken: tokenJson.access_token,
      expiresAt: tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      identity: {
        externalId,
        handle: instagram.username || externalId,
        followers: instagram.followers_count,
        raw: accounts,
      },
    };
  }

  if (channel === 'YOUTUBE') {
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error_description || 'YouTube token exchange failed');
    }

    const metrics = await fetchProviderMetrics({
      channel: 'YOUTUBE',
      externalId: '',
      accessToken: tokenJson.access_token,
    });
    const fallbackId = createHash('sha256').update(code).digest('hex').slice(0, 16);
    const channelId =
      (metrics.raw as { items?: Array<{ id?: string }> }).items?.[0]?.id || fallbackId;
    return {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresAt: tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      identity: {
        externalId: channelId,
        handle: metrics.handle || channelId,
        followers: metrics.followers,
        engagementRate: metrics.engagementRate,
        averageViews: metrics.averageViews,
        topContent: metrics.topContent,
        raw: metrics.raw,
      },
    };
  }

  if (channel === 'TIKTOK') {
    const body = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      error_description?: string;
    };
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error_description || 'TikTok token exchange failed');
    }
    const externalId =
      tokenJson.open_id || createHash('sha256').update(code).digest('hex').slice(0, 16);
    const metrics = await fetchProviderMetrics({
      channel: 'TIKTOK',
      externalId,
      accessToken: tokenJson.access_token,
    });
    return {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresAt: tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      identity: {
        externalId,
        handle: metrics.handle || externalId.slice(0, 12),
        followers: metrics.followers,
        engagementRate: metrics.engagementRate,
        averageViews: metrics.averageViews,
        raw: metrics.raw,
      },
    };
  }

  throw new Error(`Unsupported channel ${channel}`);
}

export async function refreshYoutubeAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || 'YouTube authorization was revoked; reconnect the account');
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  };
}

export async function fetchProviderMetrics(input: {
  channel: SocialChannelName;
  externalId: string;
  accessToken: string;
}): Promise<ProviderMetrics> {
  if (input.channel === 'INSTAGRAM') {
    const response = await fetch(
      `https://graph.facebook.com/${metaGraphVersion()}/${input.externalId}?fields=id,username,followers_count&access_token=${encodeURIComponent(input.accessToken)}`,
    );
    const json = (await response.json()) as {
      id?: string;
      username?: string;
      followers_count?: number;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(json.error?.message || 'Instagram refresh failed');
    return {
      handle: json.username,
      followers: json.followers_count,
      raw: json,
    };
  }

  if (input.channel === 'TIKTOK') {
    const response = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,follower_count,following_count,likes_count,video_count',
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );
    const json = (await response.json()) as {
      data?: {
        user?: {
          username?: string;
          display_name?: string;
          follower_count?: number;
        };
      };
      error?: { message?: string };
    };
    if (!response.ok || !json.data?.user) {
      throw new Error(json.error?.message || 'TikTok refresh failed');
    }
    const user = json.data.user;
    return {
      handle: user.username || user.display_name,
      followers: user.follower_count,
      raw: json,
    };
  }

  const channelResponse = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const channelJson = (await channelResponse.json()) as {
    items?: Array<{
      id: string;
      snippet?: { title?: string; customUrl?: string };
      statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
    }>;
    error?: { message?: string };
  };
  if (!channelResponse.ok) {
    throw new Error(channelJson.error?.message || 'YouTube refresh failed');
  }
  if (!channelJson.items?.[0]) {
    throw new Error(YOUTUBE_CHANNEL_REQUIRED);
  }
  const channel = channelJson.items[0];
  const searchResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channel.id}&order=date&type=video&maxResults=12`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const searchJson = (await searchResponse.json()) as {
    items?: Array<{ id?: { videoId?: string } }>;
  };
  const ids = searchJson.items?.map((item) => item.id?.videoId).filter(Boolean) ?? [];
  let averageViews: number | undefined;
  let engagementRate: number | undefined;
  let topContent: object | undefined;
  if (ids.length) {
    const videosResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );
    const videosJson = (await videosResponse.json()) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string; thumbnails?: object };
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }>;
    };
    const videos = videosJson.items ?? [];
    const totalViews = videos.reduce(
      (sum, video) => sum + Number(video.statistics?.viewCount ?? 0),
      0,
    );
    const totalEngagement = videos.reduce(
      (sum, video) =>
        sum +
        Number(video.statistics?.likeCount ?? 0) +
        Number(video.statistics?.commentCount ?? 0),
      0,
    );
    averageViews = videos.length ? Math.round(totalViews / videos.length) : undefined;
    engagementRate = totalViews ? (totalEngagement / totalViews) * 100 : undefined;
    topContent = videos.slice(0, 6);
  }
  return {
    handle: channel.snippet?.customUrl?.replace(/^@/, '') || channel.snippet?.title,
    followers: channel.statistics?.hiddenSubscriberCount
      ? 0
      : channel.statistics?.subscriberCount != null
        ? capInt(Number(channel.statistics.subscriberCount))
        : undefined,
    averageViews,
    engagementRate,
    topContent,
    raw: channelJson,
  };
}
