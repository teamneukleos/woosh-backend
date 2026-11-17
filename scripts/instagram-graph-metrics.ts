export type GraphMedia = {
  id?: string;
  like_count?: number | null;
  comments_count?: number | null;
  view_count?: number | null;
  play_count?: number | null;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
  caption?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
};

export type RecentGraphPost = {
  id: string;
  mediaType: string | null;
  permalink: string | null;
  imageUrl: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  timestamp: string | null;
};

export function discoveryHasPreviewMedia(discovery: GraphDiscovery | null | undefined) {
  return (discovery?.media?.data ?? []).some(
    (post) => Boolean(post.media_url || post.thumbnail_url),
  );
}

export function recentPostsFromDiscovery(
  discovery: GraphDiscovery | null | undefined,
  count = 3,
): RecentGraphPost[] {
  return (discovery?.media?.data ?? []).slice(0, count).map((post, index) => ({
    id: post.id ?? String(index),
    mediaType: post.media_type ?? post.media_product_type ?? null,
    permalink: post.permalink ?? null,
    imageUrl: post.thumbnail_url ?? post.media_url ?? null,
    likeCount: post.like_count ?? null,
    commentsCount: post.comments_count ?? null,
    timestamp: post.timestamp ?? null,
  }));
}

export type GraphDiscovery = {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
  media?: { data?: GraphMedia[] };
};

export type ProspectGraphMetrics = {
  engagementRate: number | null;
  averageLikes: number | null;
  averageComments: number | null;
  averageViews: number | null;
  sampleSize: number;
};

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** (avg likes + avg comments) / followers * 100 from recent public posts. */
export function metricsFromDiscovery(discovery: GraphDiscovery): ProspectGraphMetrics {
  const posts = discovery.media?.data ?? [];
  const followers = discovery.followers_count ?? 0;
  const usable = posts.filter(
    (post) => post.like_count != null || post.comments_count != null,
  );
  const likes = usable.map((post) => post.like_count ?? 0);
  const comments = usable.map((post) => post.comments_count ?? 0);
  const views = posts
    .map((post) => post.play_count ?? post.view_count)
    .filter((value): value is number => value != null);

  const avgLikes = mean(likes);
  const avgComments = mean(comments);
  const avgViews = mean(views);
  const engagementRate =
    followers > 0 && usable.length
      ? ((avgLikes ?? 0) + (avgComments ?? 0)) / followers * 100
      : null;

  return {
    engagementRate:
      engagementRate == null ? null : Math.round(engagementRate * 10000) / 10000,
    averageLikes: avgLikes == null ? null : Math.round(avgLikes),
    averageComments: avgComments == null ? null : Math.round(avgComments),
    averageViews: avgViews == null ? null : Math.round(avgViews),
    sampleSize: usable.length,
  };
}
