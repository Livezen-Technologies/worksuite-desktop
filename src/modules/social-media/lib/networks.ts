/**
 * The networks Social Media Manager reaches (WS-SMM-SRS-001 §6), as the desktop draws and checks them.
 *
 * Networks are marked with neutral letter chips, never their logos (design note, §24). What an account may actually do
 * is its capability set (SMM-ACC-004), which the server derives from the adapter and the scopes the account granted;
 * `DEFAULT_CAPABILITIES` is only the adapter's base set, used to check a draft live before the server has answered
 * and for a network the server describes without a set of its own. The server re-validates every post (CMP-003).
 */

export const NETWORKS = ['facebook', 'instagram', 'threads', 'linkedin', 'x', 'youtube', 'tiktok', 'google_business', 'pinterest'] as const;
export type Network = (typeof NETWORKS)[number];

export type MediaKind = 'image' | 'video' | 'document' | 'gif';
/** Where a post goes on the network: the feed, a Reel, a Story, a Short, a Pin… (CMP-006). */
export type PostKind = 'feed' | 'reel' | 'story' | 'short' | 'video' | 'pin' | 'update' | 'offer' | 'event' | 'thread';
export type InboxKind = 'comment' | 'message' | 'mention' | 'review';

export interface NetworkInfo {
  id: Network;
  label: string;
  /** The letter chip. */
  short: string;
  /** The chip's colour (design §24). White text on it is AA in both themes. */
  colour: string;
  /** What one account is on this network. */
  accountNoun: string;
}

export const NETWORK_INFO: Record<Network, NetworkInfo> = {
  facebook: { id: 'facebook', label: 'Facebook', short: 'Fb', colour: '#1d4ed8', accountNoun: 'Facebook Page' },
  instagram: { id: 'instagram', label: 'Instagram', short: 'Ig', colour: '#be185d', accountNoun: 'Instagram professional' },
  threads: { id: 'threads', label: 'Threads', short: '@', colour: '#3f3f46', accountNoun: 'Threads profile' },
  linkedin: { id: 'linkedin', label: 'LinkedIn', short: 'in', colour: '#075985', accountNoun: 'LinkedIn Page' },
  x: { id: 'x', label: 'X', short: 'X', colour: '#0f172a', accountNoun: 'X account' },
  youtube: { id: 'youtube', label: 'YouTube', short: 'YT', colour: '#b91c1c', accountNoun: 'YouTube channel' },
  tiktok: { id: 'tiktok', label: 'TikTok', short: 'TT', colour: '#115e59', accountNoun: 'TikTok account' },
  google_business: { id: 'google_business', label: 'Google Business', short: 'G', colour: '#166534', accountNoun: 'Business Profile location' },
  pinterest: { id: 'pinterest', label: 'Pinterest', short: 'P', colour: '#9f1239', accountNoun: 'Pinterest business account' },
};

export function isNetwork(v: unknown): v is Network {
  return typeof v === 'string' && (NETWORKS as readonly string[]).includes(v);
}

export function networkInfo(n: string): NetworkInfo {
  return isNetwork(n) ? NETWORK_INFO[n] : { id: n as Network, label: n, short: n.slice(0, 2).toUpperCase() || '?', colour: '#475569', accountNoun: 'account' };
}

/** How a network counts a caption (NFR-12): X weighs code points and links; the others count code points. */
export type CountingRule = 'code_points' | 'x_weighted';

/** What one account can do (SMM-ACC-004): declared by its adapter, narrowed by the scopes it granted. */
export interface CapabilitySet {
  /** The caption limit, in the network's own units; 0 when the network takes no caption. */
  text_limit: number;
  counting: CountingRule;
  /** The network needs at least one picture or video (Instagram, TikTok, YouTube, Pinterest). */
  media_required: boolean;
  media_kinds: MediaKind[];
  max_media: number;
  /** Width ÷ height allowed for pictures, inclusive; null = any. */
  image_ratio: [number, number] | null;
  max_image_bytes: number | null;
  max_video_bytes: number | null;
  max_video_seconds: number | null;
  /** Links are clickable in the caption (a link card), or only plain text (Instagram, TikTok). */
  links: 'card' | 'text';
  /** @mentions resolve to accounts (CMP-007); otherwise they stay text, with a warning. */
  mentions: boolean;
  /** Alt text is sent for pictures (CMP-015). */
  alt_text: boolean;
  post_kinds: PostKind[];
  options: {
    first_comment: boolean;
    thread: boolean;
    title: boolean;
    privacy: boolean;
    board: boolean;
    cta: boolean;
    offer: boolean;
  };
  inbox: InboxKind[];
  insights: boolean;
  /** Kinds the API cannot publish: they become manual reminders (SMM-PUB-007). */
  manual_kinds: PostKind[];
}

const NO_OPTIONS = { first_comment: false, thread: false, title: false, privacy: false, board: false, cta: false, offer: false };

/**
 * Each adapter's base capability set, as §6 records it at the time of writing. Networks change their APIs; the server's
 * set for the account always wins over this.
 */
export const DEFAULT_CAPABILITIES: Record<Network, CapabilitySet> = {
  facebook: {
    text_limit: 63_206, counting: 'code_points', media_required: false, media_kinds: ['image', 'video', 'gif'], max_media: 10, image_ratio: null,
    max_image_bytes: 10 * 1024 * 1024, max_video_bytes: 1024 * 1024 * 1024, max_video_seconds: 14_400, links: 'card', mentions: true, alt_text: true,
    post_kinds: ['feed', 'reel', 'story'], options: { ...NO_OPTIONS, first_comment: true }, inbox: ['comment', 'message'], insights: true, manual_kinds: [],
  },
  instagram: {
    text_limit: 2_200, counting: 'code_points', media_required: true, media_kinds: ['image', 'video'], max_media: 10, image_ratio: [0.8, 1.91],
    max_image_bytes: 8 * 1024 * 1024, max_video_bytes: 300 * 1024 * 1024, max_video_seconds: 900, links: 'text', mentions: true, alt_text: true,
    post_kinds: ['feed', 'reel', 'story'], options: { ...NO_OPTIONS, first_comment: true }, inbox: ['comment', 'mention', 'message'], insights: true, manual_kinds: [],
  },
  threads: {
    text_limit: 500, counting: 'code_points', media_required: false, media_kinds: ['image', 'video'], max_media: 10, image_ratio: null,
    max_image_bytes: 8 * 1024 * 1024, max_video_bytes: 1024 * 1024 * 1024, max_video_seconds: 300, links: 'card', mentions: true, alt_text: true,
    post_kinds: ['feed', 'thread'], options: { ...NO_OPTIONS, thread: true }, inbox: ['comment'], insights: true, manual_kinds: [],
  },
  linkedin: {
    text_limit: 3_000, counting: 'code_points', media_required: false, media_kinds: ['image', 'video', 'document'], max_media: 9, image_ratio: null,
    max_image_bytes: 8 * 1024 * 1024, max_video_bytes: 5 * 1024 * 1024 * 1024, max_video_seconds: 1_800, links: 'card', mentions: true, alt_text: true,
    post_kinds: ['feed'], options: { ...NO_OPTIONS, first_comment: true }, inbox: ['comment'], insights: true, manual_kinds: [],
  },
  x: {
    text_limit: 280, counting: 'x_weighted', media_required: false, media_kinds: ['image', 'video', 'gif'], max_media: 4, image_ratio: null,
    max_image_bytes: 5 * 1024 * 1024, max_video_bytes: 512 * 1024 * 1024, max_video_seconds: 140, links: 'card', mentions: true, alt_text: true,
    post_kinds: ['feed', 'thread'], options: { ...NO_OPTIONS, thread: true }, inbox: ['mention', 'message'], insights: true, manual_kinds: [],
  },
  youtube: {
    text_limit: 5_000, counting: 'code_points', media_required: true, media_kinds: ['video'], max_media: 1, image_ratio: null,
    max_image_bytes: null, max_video_bytes: 256 * 1024 * 1024 * 1024, max_video_seconds: 43_200, links: 'text', mentions: false, alt_text: false,
    post_kinds: ['video', 'short'], options: { ...NO_OPTIONS, title: true, privacy: true }, inbox: ['comment'], insights: true, manual_kinds: [],
  },
  tiktok: {
    text_limit: 2_200, counting: 'code_points', media_required: true, media_kinds: ['video', 'image'], max_media: 35, image_ratio: null,
    max_image_bytes: 20 * 1024 * 1024, max_video_bytes: 4 * 1024 * 1024 * 1024, max_video_seconds: 600, links: 'text', mentions: true, alt_text: false,
    post_kinds: ['video'], options: { ...NO_OPTIONS, privacy: true }, inbox: [], insights: true, manual_kinds: [],
  },
  google_business: {
    text_limit: 1_500, counting: 'code_points', media_required: false, media_kinds: ['image'], max_media: 1, image_ratio: null,
    max_image_bytes: 5 * 1024 * 1024, max_video_bytes: null, max_video_seconds: null, links: 'text', mentions: false, alt_text: false,
    post_kinds: ['update', 'offer', 'event'], options: { ...NO_OPTIONS, cta: true, offer: true }, inbox: ['review'], insights: true, manual_kinds: [],
  },
  pinterest: {
    text_limit: 500, counting: 'code_points', media_required: true, media_kinds: ['image', 'video'], max_media: 1, image_ratio: null,
    max_image_bytes: 20 * 1024 * 1024, max_video_bytes: 2 * 1024 * 1024 * 1024, max_video_seconds: 900, links: 'card', mentions: false, alt_text: true,
    post_kinds: ['pin'], options: { ...NO_OPTIONS, title: true, board: true }, inbox: [], insights: true, manual_kinds: [],
  },
};

/** An account's capability set: the server's when it sent one, else the adapter's base set. */
export function capabilitiesOf(network: string, fromServer?: Partial<CapabilitySet> | null): CapabilitySet {
  const base = isNetwork(network) ? DEFAULT_CAPABILITIES[network] : DEFAULT_CAPABILITIES.facebook;
  if (!fromServer) return base;
  return { ...base, ...fromServer, options: { ...base.options, ...(fromServer.options ?? {}) } };
}

export const POST_KIND_LABEL: Record<PostKind, string> = {
  feed: 'Feed post',
  reel: 'Reel',
  story: 'Story',
  short: 'Short',
  video: 'Video',
  pin: 'Pin',
  update: 'Update',
  offer: 'Offer',
  event: 'Event',
  thread: 'Thread',
};

/** Words per metric where networks define it differently (SMM-ANL-008), shown on hover; the server's own wins. */
export const METRIC_DEFINITIONS: Record<string, Partial<Record<Network, string>>> = {
  reach: {
    facebook: 'Accounts that saw the Page’s content at least once (Meta “accounts reached”).',
    instagram: 'Unique accounts that saw the post or the profile’s content.',
    linkedin: 'Unique LinkedIn members who saw the post (“unique impressions”).',
    x: 'X reports impressions only; reach is not available.',
    youtube: 'Unique viewers (YouTube Analytics).',
    tiktok: 'Unique viewers of the video.',
    google_business: 'People who viewed the Business Profile on Search and Maps.',
    pinterest: 'Unique users who saw the Pin.',
    threads: 'Accounts that viewed the post.',
  },
  engagements: {
    facebook: 'Reactions, comments, shares and clicks on the post.',
    instagram: 'Likes, comments, saves and shares.',
    linkedin: 'Reactions, comments, shares and clicks.',
    x: 'Likes, replies, reposts, bookmarks and link and profile clicks.',
    youtube: 'Likes, comments and shares.',
    tiktok: 'Likes, comments and shares.',
    google_business: 'Calls, direction requests and website clicks from the profile.',
    pinterest: 'Saves, Pin clicks and outbound clicks.',
    threads: 'Likes, replies, reposts and quotes.',
  },
  impressions: {
    facebook: 'Times the content was on screen.',
    instagram: 'Times the post was on screen (Meta “views”).',
    linkedin: 'Times the post was on screen.',
    x: 'Times the post was seen.',
    youtube: 'Thumbnail impressions on YouTube.',
    pinterest: 'Times the Pin was on screen.',
  },
};
