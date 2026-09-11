import { SOCIAL_CHANNELS, type SocialChannelName } from '../common/taxonomy';
import { composioInstagramCallbackUrl, composioInstagramConfigured } from './composio';

export { composioInstagramConfigured };

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export const YOUTUBE_CHANNEL_REQUIRED = 'youtube_channel_required';

export function youtubeOAuthErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (
    message.includes(YOUTUBE_CHANNEL_REQUIRED) ||
    message.toLowerCase().includes('no youtube channel')
  ) {
    return YOUTUBE_CHANNEL_REQUIRED;
  }
  return 'connection_failed';
}

export function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function nestApiUrl() {
  return `${(process.env.APP_URL || 'http://localhost:4000').replace(/\/$/, '')}/api`;
}

export function metaGraphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v26.0';
}

export function youtubeRedirectUri() {
  return (
    process.env.GOOGLE_YOUTUBE_REDIRECT_URI?.trim() ||
    `${nestApiUrl()}/creators/social/youtube/callback`
  );
}

export function oauthRedirectUri(channel: SocialChannelName) {
  if (channel === 'YOUTUBE') return youtubeRedirectUri();
  if (channel === 'INSTAGRAM' && composioInstagramConfigured()) {
    return composioInstagramCallbackUrl();
  }
  return `${frontendUrl()}/api/oauth/${channel.toLowerCase()}`;
}

export function socialOAuthFrontendRedirectUrl() {
  return (
    process.env.SOCIAL_OAUTH_FRONTEND_REDIRECT_URL?.trim() ||
    `${frontendUrl()}/oauth/youtube`
  );
}

export function metaInstagramConfigured() {
  return Boolean(
    process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim(),
  );
}

export function instagramOAuthErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (
    lower.includes('instagram_business_required') ||
    lower.includes('business or creator') ||
    lower.includes('facebook page')
  ) {
    return 'instagram_business_required';
  }
  if (lower.includes('cancel')) return 'authorization_cancelled';
  return 'connection_failed';
}

export function oauthConfiguredFor(channel: SocialChannelName) {
  if (channel === 'INSTAGRAM') {
    return composioInstagramConfigured() || metaInstagramConfigured();
  }
  if (channel === 'TIKTOK') {
    return Boolean(
      process.env.TIKTOK_CLIENT_KEY?.trim() &&
        process.env.TIKTOK_CLIENT_SECRET?.trim(),
    );
  }
  if (channel === 'YOUTUBE') {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CLIENT_SECRET?.trim(),
    );
  }
  return false;
}

export function allowDevOAuth() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.WOOSH_ALLOW_DEV_OAUTH === 'true'
  );
}

export function oauthPublicStatus() {
  return {
    allowDev: allowDevOAuth(),
    configured: Object.fromEntries(
      SOCIAL_CHANNELS.map((channel) => [channel, oauthConfiguredFor(channel)]),
    ) as Record<SocialChannelName, boolean>,
  };
}

export function youtubeResultUrl(
  status: 'connected' | 'error',
  message?: string,
) {
  const url = new URL(socialOAuthFrontendRedirectUrl());
  url.searchParams.set('youtube', status);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}

export function instagramResultUrl(
  status: 'connected' | 'error',
  message?: string,
) {
  const url = new URL(
    process.env.SOCIAL_OAUTH_INSTAGRAM_FRONTEND_REDIRECT_URL?.trim() ||
      `${frontendUrl()}/oauth/instagram`,
  );
  url.searchParams.set('instagram', status);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}
