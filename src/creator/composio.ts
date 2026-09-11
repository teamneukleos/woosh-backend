import { Composio } from '@composio/client';

let client: Composio | null = null;

export const COMPOSIO_TOKEN_PREFIX = 'composio:';
export const INSTAGRAM_BUSINESS_REQUIRED = 'instagram_business_required';

export function composioInstagramConfigured() {
  return Boolean(
    process.env.COMPOSIO_API_KEY?.trim() &&
      process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID?.trim(),
  );
}

export function composioUserId(userId: string) {
  return `woosh:${userId}`;
}

export function composioInstagramCallbackUrl() {
  return (
    process.env.COMPOSIO_INSTAGRAM_CALLBACK_URL?.trim() ||
    `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/creators/social/instagram/callback`
  );
}

export function composioClient() {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured');
  }
  if (!client) {
    const baseURL = process.env.COMPOSIO_BASE_URL?.trim();
    client = new Composio(baseURL ? { apiKey, baseURL } : { apiKey });
  }
  return client;
}

export function encodeComposioAccountId(connectedAccountId: string) {
  return `${COMPOSIO_TOKEN_PREFIX}${connectedAccountId}`;
}

export function decodeComposioAccountId(token: string | null | undefined) {
  if (!token?.startsWith(COMPOSIO_TOKEN_PREFIX)) return null;
  return token.slice(COMPOSIO_TOKEN_PREFIX.length);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return undefined;
}

export function parseInstagramUserInfo(data: unknown) {
  const root = asRecord(data);
  const nested = asRecord(root?.data) ?? root;
  const id = readString(nested, ['id', 'ig_id', 'ig_user_id']);
  const handle = readString(nested, ['username', 'name']);
  if (!id) {
    throw new Error(INSTAGRAM_BUSINESS_REQUIRED);
  }
  return {
    externalId: id,
    handle: handle || id,
    followers: readNumber(nested, ['followers_count', 'follower_count']),
    raw: nested ?? { data },
  };
}

export function parseInstagramMediaMetrics(data: unknown) {
  const root = asRecord(data);
  const list = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(asRecord(root?.data)?.data)
      ? (asRecord(root?.data)?.data as unknown[])
      : [];
  const items = list
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => !!item);
  if (!items.length) return {};

  let views = 0;
  let viewsCount = 0;
  let engagement = 0;
  let engagementDenom = 0;
  for (const item of items) {
    const likeCount = readNumber(item, ['like_count', 'total_like_count']) ?? 0;
    const commentCount = readNumber(item, ['comments_count', 'total_comments_count']) ?? 0;
    const viewCount = readNumber(item, ['view_count', 'total_views_count']);
    if (viewCount != null) {
      views += viewCount;
      viewsCount += 1;
      engagementDenom += viewCount;
    }
    engagement += likeCount + commentCount;
  }
  return {
    averageViews: viewsCount ? Math.round(views / viewsCount) : undefined,
    engagementRate: engagementDenom ? (engagement / engagementDenom) * 100 : undefined,
    topContent: items.slice(0, 6),
  };
}
