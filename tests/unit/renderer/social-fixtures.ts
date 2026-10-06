import { ApiError } from '../../../src/core/api';
import type {
  Account,
  AnalyticsOverview,
  Brand,
  Campaign,
  Heatmap,
  InboxCounts,
  LibraryItem,
  ModuleStatus,
  Post,
  PostPerformance,
  ProviderApps,
  PublishLog,
  QueueInfo,
  Thread,
  ThreadRow,
} from '../../../src/modules/social-media/api';

/**
 * A WorkSuite server with Social Media Manager, as the design draws it (TechHubiz and CreativeFX, 11 accounts in
 * 2 brands, the week of 6 October 2026), for the module's screen tests. `socialAnswer(false)` is today's server:
 * every /api/social-media route answers 404.
 */
export const NOW = '2026-10-06T04:30:00Z'; // Tue 6 Oct 2026, 10:00 Asia/Colombo

const me = { id: 1, name: 'Nadeesha P.' };
const kasun = { id: 2, name: 'Kasun R.' };
const imesha = { id: 3, name: 'Imesha F.' };

export const brands: Brand[] = [
  { id: 1, name: 'TechHubiz', color: '#0f172a', timezone: 'Asia/Colombo', approval_policy_id: 1, approval_policy: { id: 1, name: 'Brand manager', steps: 1 }, drive_folder: { id: 501, path: 'Marketing › Social' }, accounts_count: 6, min_gap_minutes: 90 },
  { id: 2, name: 'CreativeFX', color: '#be185d', timezone: 'Asia/Colombo', approval_policy_id: 2, approval_policy: { id: 2, name: 'Writer → Brand manager → Client', steps: 3 }, drive_folder: { id: 502, path: 'CreativeFX › Social' }, accounts_count: 5, min_gap_minutes: 90 },
];

const acct = (id: number, brand: number, network: Account['network'], name: string, handle: string, type: string, status: Account['status'], granted: string[], extra: Partial<Account> = {}): Account => ({
  id,
  brand_id: brand,
  network,
  external_id: `ext-${id}`,
  handle,
  display_name: name,
  account_type: type,
  avatar_url: null,
  status,
  granted,
  token_expires_at: null,
  last_sync_at: '2026-10-06T04:28:00Z',
  connected_by: me,
  my_level: 'manage',
  ...extra,
});

export const accounts: Account[] = [
  acct(1, 1, 'facebook', 'TechHubiz Sri Lanka', 'facebook.com/techhubiz.lk', 'Page', 'connected', ['Publish', 'Inbox', 'Insights']),
  acct(2, 1, 'instagram', 'TechHubiz', '@techhubiz.lk', 'Professional', 'connected', ['Publish', 'Inbox', 'Insights']),
  acct(3, 1, 'linkedin', 'TechHubiz', 'linkedin.com/company/techhubiz', 'Page', 'connected', ['Publish', 'Comments', 'Insights']),
  acct(4, 1, 'x', 'TechHubiz', '@techhubiz', 'Account', 'needs_reconnect', ['Publish'], { last_error_code: 'auth_revoked', last_error_message: 'Failed 08:42', held_posts: 1, quota: { label: 'Posts this month', used: 412, limit: 500, period: 'month' } }),
  acct(5, 1, 'youtube', 'TechHubiz Tech', '@techhubiztech', 'Channel', 'connected', ['Upload', 'Comments', 'Analytics']),
  acct(6, 1, 'google_business', 'TechHubiz Colombo', 'Google Business Profile', 'Location', 'connected', ['Posts', 'Reviews']),
  acct(7, 2, 'facebook', 'CreativeFX Studio', 'facebook.com/creativefx', 'Page', 'connected', ['Publish', 'Inbox', 'Insights']),
  acct(8, 2, 'instagram', 'CreativeFX Studio', '@creativefx.studio', 'Professional', 'expiring', ['Publish', 'Inbox', 'Insights'], { token_expires_at: '2026-10-09T04:30:00Z' }),
  acct(9, 2, 'tiktok', 'CreativeFX', '@creativefx', 'Business', 'connected', ['Publish', 'Insights']),
  acct(10, 1, 'threads', 'TechHubiz', '@techhubiz.lk', 'Profile', 'connected', ['Publish', 'Replies']),
  acct(11, 2, 'pinterest', 'CreativeFX', 'pinterest.com/creativefx', 'Business', 'connected', ['Publish', 'Insights']),
];

export const status: ModuleStatus = {
  paused_all: false,
  ai_enabled: true,
  alt_text_required: false,
  default_timezone: 'Asia/Colombo',
  default_brand_id: 1,
  counts: { accounts: 11, brands: 2, accounts_attention: 2, approvals_waiting: 4, inbox_open: 18, inbox_assigned_to_me: 6, failed_7d: 1, held: 1 },
  permissions: null,
};

const target = (id: number, account: number, network: Post['targets'][number]['network'], status: Post['targets'][number]['status'], run_at: string | null, extra: Partial<Post['targets'][number]> = {}): Post['targets'][number] => ({
  id,
  account_id: account,
  network,
  customised: false,
  text: null,
  options: {},
  status,
  run_at,
  published_at: null,
  permalink: null,
  ...extra,
});

const post = (id: number, text: string, status: Post['status'], at: string | null, targets: Post['targets'], extra: Partial<Post> = {}): Post => ({
  id,
  brand_id: 1,
  campaign_id: null,
  base_text: text,
  status,
  schedule_mode: at ? 'at' : null,
  scheduled_at: at,
  entered_timezone: 'Asia/Colombo',
  owner: me,
  created_by: me,
  labels: [],
  version: 3,
  media: [],
  targets,
  ...extra,
});

export const posts: Post[] = [
  post(101, 'WorkSuite 3.2 is here — offline mode, PDF Studio and a faster Mail. Join the launch webinar on Thursday.', 'scheduled', '2026-10-06T11:00:00Z', [target(1, 1, 'facebook', 'scheduled', '2026-10-06T11:00:00Z'), target(2, 2, 'instagram', 'scheduled', '2026-10-06T11:00:00Z'), target(3, 3, 'linkedin', 'scheduled', '2026-10-06T11:00:00Z')], {
    campaign_id: 1,
    campaign: { id: 1, name: 'WorkSuite 3.2 launch' },
    labels: ['launch', 'product'],
    media: [
      { id: 1, file_id: 9001, name: 'ws32-hero-1.jpg', kind: 'image', width: 1080, height: 1350, bytes: 412_000, alt_text: 'WorkSuite 3.2 desktop window' },
      { id: 2, file_id: 9002, name: 'ws32-hero-2.jpg', kind: 'image', width: 1080, height: 1350, bytes: 398_000, alt_text: null },
    ],
  }),
  post(102, 'Thread: 5 things you can automate in WorkSuite Forms this week (1/5)', 'scheduled', '2026-10-06T12:30:00Z', [target(4, 4, 'x', 'held', '2026-10-06T12:30:00Z', { hold_reason: 'Access to @techhubiz expired' }), target(5, 10, 'threads', 'scheduled', '2026-10-06T12:30:00Z')], { owner: kasun }),
  post(103, 'Carousel — Behind the scenes at the CreativeFX studio shoot', 'in_review', '2026-10-07T05:00:00Z', [target(6, 8, 'instagram', 'pending', '2026-10-07T05:00:00Z')], {
    brand_id: 2,
    owner: imesha,
    approval: {
      request_id: 7,
      state: 'pending',
      current_step: 2,
      can_decide: true,
      submitted_by: imesha,
      submitted_at: '2026-10-03T03:42:00Z',
      steps: [
        { index: 1, label: 'Content writer — Imesha F.', kind: 'user', approvers: [imesha], state: 'approved', decided_by: imesha, decided_at: '2026-10-03T03:42:00Z' },
        { index: 2, label: 'Brand manager — you', kind: 'user', approvers: [me], state: 'current', mine: true, reply_due_at: '2026-10-06T06:30:00Z' },
        { index: 3, label: 'Client — CreativeFX (external link)', kind: 'external', approvers: [], external_name: 'CreativeFX', state: 'waiting' },
      ],
    },
  }),
  post(104, 'Video — Setting up WorkSuite Desktop in 4 minutes', 'scheduled', '2026-10-07T06:30:00Z', [target(7, 5, 'youtube', 'scheduled', '2026-10-07T06:30:00Z', { options: { title: 'Setting up WorkSuite Desktop', privacy: 'public' } })], { owner: kasun }),
  post(105, 'We are hiring: Senior Laravel / CodeIgniter developer (Colombo, hybrid)', 'in_review', '2026-10-08T03:30:00Z', [target(8, 3, 'linkedin', 'pending', '2026-10-08T03:30:00Z')], {
    owner: { id: 4, name: 'HR team' },
    approval: { request_id: 8, state: 'pending', current_step: 1, can_decide: true, steps: [{ index: 1, label: 'Brand manager — you', kind: 'user', approvers: [me], state: 'current', mine: true }] },
  }),
  post(106, 'Offer — 10% off annual WorkSuite Business plans until 31 October', 'draft', null, [target(9, 6, 'google_business', 'pending', null, { options: { post_kind: 'offer' } })]),
  post(107, 'Customer story — Ceylon Freight on WorkSuite Fleet', 'published', '2026-10-02T04:00:01Z', [target(10, 1, 'facebook', 'published', '2026-10-02T04:00:01Z', { published_at: '2026-10-02T04:00:01Z', permalink: 'https://facebook.com/techhubiz.lk/posts/1', metrics: { reach: 9214, impressions: 12_000, engagements: 611, clicks: 205 } })]),
  post(108, 'Tip: Mail rules that save an hour a week', 'failed', '2026-10-03T05:30:00Z', [target(11, 4, 'x', 'failed', '2026-10-03T05:30:00Z', { error_class: 'auth_revoked', error_message: 'auth_revoked', attempts: 3 })]),
  post(109, 'Partner spotlight — Livezen support packages', 'draft', null, [target(12, 3, 'linkedin', 'pending', null), target(13, 1, 'facebook', 'pending', null)]),
  post(110, 'Webinar recap with the recording link', 'queued', null, [target(14, 3, 'linkedin', 'queued', '2026-10-13T04:30:00Z')], { schedule_mode: 'queue' }),
];

export const queue: QueueInfo = {
  brand_id: 1,
  account_id: null,
  timezone: 'Asia/Colombo',
  min_gap_minutes: 90,
  paused: false,
  slots: [
    { weekday: 1, local_time: '09:00', enabled: true, best: true },
    { weekday: 1, local_time: '13:00', enabled: true },
    { weekday: 1, local_time: '17:30', enabled: true },
    { weekday: 2, local_time: '10:30', enabled: true },
    { weekday: 2, local_time: '16:00', enabled: true },
    { weekday: 3, local_time: '09:00', enabled: true },
    { weekday: 3, local_time: '13:00', enabled: true, best: true },
    { weekday: 3, local_time: '17:30', enabled: true },
    { weekday: 4, local_time: '10:30', enabled: true, best: true },
    { weekday: 4, local_time: '16:00', enabled: true },
    { weekday: 5, local_time: '09:00', enabled: true },
    { weekday: 5, local_time: '12:30', enabled: true },
    { weekday: 6, local_time: '11:00', enabled: true },
  ],
  next: [
    { target_id: 14, post_id: 110, account_id: 3, network: 'linkedin', excerpt: 'Webinar recap with the recording link', run_at: '2026-10-13T04:30:00Z', status: 'queued' },
    { target_id: 15, post_id: 111, account_id: 9, network: 'tiktok', excerpt: 'CreativeFX reel — studio lighting in 20 seconds', run_at: '2026-10-13T12:30:00Z', status: 'queued' },
    { target_id: 16, post_id: 112, account_id: 1, network: 'facebook', excerpt: 'Forms tip: send responses straight to CRM', run_at: '2026-10-14T05:00:00Z', status: 'queued' },
  ],
  queued_total: 14,
  fills_until: '2026-10-31',
  blackouts_count: 2,
  evergreen: { reshare: true, skip_days: 60, ai_rewrite: false, pool: 26 },
};

export const threadRows: ThreadRow[] = [
  { id: 201, account_id: 1, network: 'facebook', kind: 'message', participant: { name: 'Ruwan Jayasinghe' }, excerpt: 'Does the Business plan include the desktop app for 15 users?', status: 'new', intent: 'sales', unread: true, last_message_at: '2026-10-06T04:26:00Z', reply_due_at: '2026-10-06T05:26:00Z', has_crm_contact: true },
  { id: 202, account_id: 2, network: 'instagram', kind: 'comment', participant: { name: 'dilini.designs', handle: '@dilini.designs' }, excerpt: 'Love this lighting setup! Which softbox is that?', status: 'open', unread: true, last_message_at: '2026-10-06T04:18:00Z' },
  { id: 203, account_id: 6, network: 'google_business', kind: 'review', participant: { name: 'Sahan Perera' }, excerpt: 'Waited two days for a reply to my support ticket', status: 'open', sentiment: 'negative', rating: 2, unread: false, last_message_at: '2026-10-06T03:30:00Z' },
];

export const counts: InboxCounts = { all_open: 18, assigned_to_me: 6, unassigned: 7, comment: 11, message: 5, mention: 1, review: 1, closed_today: 23 };

export const thread: Thread = {
  ...threadRows[0]!,
  crm: { contact_id: 77, name: 'Jayasinghe Traders', company: 'Jayasinghe Traders', deals: [{ id: 5, name: 'WorkSuite Business — 15 seats', amount: 240_000, currency: 'LKR', stage: 'Open' }] },
  viewing: [kasun],
  window_ends_at: '2026-10-07T04:26:00Z',
  actions: { reply: true, like: false, hide: false, delete: false },
  messages: [
    { id: 1, direction: 'in', author: { name: 'Ruwan' }, body: 'Hi, does the Business plan include the desktop app for 15 users? We are in Kandy and need it for our accounts team.', created_at: '2026-10-06T04:51:00Z' },
    { id: 2, direction: 'note', author: { name: 'Kasun R.', user_id: 2 }, body: 'Existing CRM contact — Jayasinghe Traders, open deal LKR 240,000', created_at: '2026-10-06T04:55:00Z' },
  ],
};

export const overview: AnalyticsOverview = {
  range: { from: '2026-09-06', to: '2026-10-05' },
  previous: { from: '2026-08-07', to: '2026-09-05' },
  kpis: {
    followers: { value: 48_215, delta: 1_204, delta_kind: 'abs' },
    reach: { value: 412_000, delta: 18, delta_kind: 'pct' },
    impressions: { value: 781_000, delta: 9, delta_kind: 'pct' },
    engagement_rate: { value: 4.6, delta: 0.4, delta_kind: 'pt' },
    link_clicks: { value: 6_930, delta: 22, delta_kind: 'pct' },
    median_reply_minutes: { value: 38, delta: -12, delta_kind: 'min' },
  },
  series: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 6 + i)).toISOString().slice(0, 10), reach: 30_000 + i * 3000, engagements: 1500 + i * 120 })),
  by_account: [
    { account_id: 1, network: 'facebook', name: 'TechHubiz Sri Lanka', posts: 22, reach: 146_000, engagement_rate: 3.9, clicks: 2_410, followers_delta: 312 },
    { account_id: 2, network: 'instagram', name: '@techhubiz.lk', posts: 18, reach: 121_000, engagement_rate: 6.2, clicks: null, followers_delta: 540 },
    { account_id: 4, network: 'x', name: '@techhubiz', posts: 15, reach: null, engagement_rate: 1.8, clicks: 560, followers_delta: 21 },
  ],
  mixed_definitions: ['reach'],
};

export const heatmap: Heatmap = {
  timezone: 'Asia/Colombo',
  days: 90,
  cells: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h < 7 || h > 21 ? null : ((d * 7 + h * 3) % 10) / 10))),
  best: [{ weekday: 4, hour: 10 }],
};

export const performance: PostPerformance[] = [
  { target_id: 3, post_id: 99, account_id: 3, network: 'linkedin', account: 'TechHubiz', excerpt: 'Launch teaser — WorkSuite Desktop offline mode', published_at: '2026-09-29T04:30:00Z', reach: 18_402, impressions: 25_000, engagements: 1_126, likes: 800, comments: 40, shares: 30, saves: null, clicks: 342, video_views: null },
  { target_id: 10, post_id: 107, account_id: 1, network: 'facebook', account: 'TechHubiz Sri Lanka', excerpt: 'Customer story — Ceylon Freight on WorkSuite Fleet', published_at: '2026-10-02T04:00:01Z', reach: 9_214, impressions: 12_000, engagements: 611, likes: 500, comments: 20, shares: 11, saves: null, clicks: 205, video_views: null },
];

export const campaigns: Campaign[] = [
  { id: 1, brand_id: 1, brand: 'TechHubiz', name: 'WorkSuite 3.2 launch', goal: 'Webinar sign-ups', starts_on: '2026-10-01', ends_on: '2026-10-31', owner: me, utm: { campaign: 'ws32-launch', medium: 'social' }, short_domain: 'wks.lk', status: 'running', budget_note: '[BOOSTED POST BUDGET]', posts_planned: 24, posts_published: 9, clicks: 3_412, crm_leads: 41, results: { reach: 214_600, engagements: 11_880, clicks: 3_412, form_submissions: 286, crm_leads: 41 } },
  { id: 2, brand_id: 2, brand: 'CreativeFX', name: 'Studio stories', goal: null, starts_on: null, ends_on: null, owner: imesha, utm: { campaign: 'studio-stories', medium: 'social' }, short_domain: null, status: 'running', posts_planned: 18, posts_published: 12, clicks: 1_104, crm_leads: 6 },
  { id: 3, brand_id: 1, brand: 'TechHubiz', name: 'Hiring — Q4 developers', goal: 'Applications', starts_on: '2026-10-06', ends_on: '2026-11-30', owner: { id: 4, name: 'HR team' }, utm: { campaign: 'hiring-q4', medium: 'social' }, status: 'planned', posts_planned: 8, posts_published: 0, clicks: null, crm_leads: null },
];

export const library: LibraryItem[] = [
  { id: 301, brand_id: 1, kind: 'media', name: 'ws32-hero-1.jpg', tags: ['launch'], usage_count: 3, media: { file_id: 9001, name: 'ws32-hero-1.jpg', kind: 'image', width: 1080, height: 1350, bytes: 412_000, alt_text: 'WorkSuite 3.2 desktop window on a desk', drive_path: 'Drive › Marketing › Social', fits: ['facebook', 'instagram', 'threads'], licence: 'Own work' } },
  { id: 302, brand_id: 2, kind: 'media', name: 'desktop-setup.mp4', tags: ['video'], usage_count: 1, media: { file_id: 9003, name: 'desktop-setup.mp4', kind: 'video', width: 1920, height: 1080, duration_seconds: 102, bytes: 48_000_000, alt_text: null, drive_path: 'Drive › Marketing › Social', fits: ['youtube', 'linkedin', 'x'], licence: 'Own work' } },
  { id: 303, brand_id: 1, kind: 'hashtag_set', name: 'Product launch', text: '#WorkSuite #SaaS #ProductLaunch #SriLanka', tags: [], usage_count: 9 },
  { id: 304, brand_id: 1, kind: 'caption', name: 'Webinar invite', text: 'Join the live webinar on {date} at {time} (Sri Lanka time) — link below.', tags: [], usage_count: 4 },
];

export const log: PublishLog = {
  attempts: [
    { id: 1, job_id: 1, target_id: 11, post_id: 108, post_excerpt: 'Tip: Mail rules that save an hour a week', account_id: 4, network: 'x', account: '@techhubiz', started_at: '2026-10-03T05:30:02Z', finished_at: '2026-10-03T05:30:03Z', outcome: 'failed', error_class: 'auth_revoked', detail: 'auth_revoked', attempt: 3, max_attempts: 3 },
    { id: 2, job_id: 2, target_id: 20, post_id: 120, post_excerpt: 'Reel: 30-second PDF Studio tour', account_id: 2, network: 'instagram', account: '@techhubiz.lk', started_at: '2026-10-02T13:30:04Z', finished_at: '2026-10-02T13:30:30Z', outcome: 'published', permalink: 'https://instagram.com/p/1', attempt: 1, max_attempts: 3 },
    { id: 3, job_id: 3, target_id: 21, post_id: 121, post_excerpt: 'Story: studio countdown', account_id: 8, network: 'instagram', account: '@creativefx.studio', started_at: '2026-10-01T12:30:03Z', finished_at: null, outcome: 'manual_reminder', reminder_to: imesha, attempt: 1, max_attempts: 1 },
  ],
  totals: { jobs: 214, first_try_rate: 97.2, retried_then_succeeded: 4, failed: 2, failed_note: 'both auth errors' },
  counts: { failed: 2, manual: 3, retrying: 0 },
};

export const providerApps: ProviderApps = {
  redirect_uri: 'https://demo.worksuite.lk/api/social-media/oauth/callback',
  apps: [
    { network: 'meta', label: 'Meta (Facebook, Instagram, Threads)', product: 'Graph API v-current · app review: approved', covers: 'Covers Pages, Instagram professional accounts, Messenger and Instagram messaging, insights and webhooks.', mode: 'own', enabled: true, client_id: '[META APP ID]', has_secret: true, secret_set_at: '2026-09-12T00:00:00Z', status: 'live' },
    { network: 'linkedin', label: 'LinkedIn', product: 'Community Management API', covers: 'Page posting and analytics need the Community Management product on the app.', mode: 'own', enabled: true, client_id: '[LINKEDIN CLIENT ID]', has_secret: true, secret_set_at: '2026-09-12T00:00:00Z', status: 'approved' },
    { network: 'x', label: 'X', product: 'X API v2', covers: 'The tier decides monthly post limits and whether mentions and DMs can be read.', mode: 'own', enabled: true, client_id: '[X API KEY]', has_secret: true, secret_set_at: null, status: 'limited', tier: 'Basic' },
    { network: 'tiktok', label: 'TikTok', product: 'Content Posting API', covers: 'Until TikTok audits the app, posts can only be published as private.', mode: 'own', enabled: true, client_id: '[TIKTOK CLIENT KEY]', has_secret: true, secret_set_at: null, status: 'audit_pending' },
  ],
};

/** A route of today's server: Social Media Manager is not there. */
function notThere(path: string): never {
  throw new ApiError(404, `The server answered 404 (${path}).`, null);
}

/**
 * Answers GET requests the way a server with the module would (`offered`), or today's server (404 for every
 * /api/social-media route). Writes answer `{}` when offered.
 */
export function socialAnswer(offered: boolean) {
  return async (path: string, query?: Record<string, unknown>): Promise<unknown> => {
    if (!path.startsWith('/api/social-media')) {
      if (path === '/api/files/browse') return { folder_id: null, breadcrumb: [], locked: false, folders: [], files: [] };
      return notThere(path);
    }
    if (!offered) return notThere(path);
    const p = path.replace('/api/social-media', '');
    if (p === '/status') return status;
    if (p === '/brands') return { brands };
    if (p === '/accounts') return { accounts };
    if (/^\/accounts\/\d+\/access$/.test(p)) return { access: [{ principal_type: 'user', principal_id: 1, name: 'Nadeesha P.', level: 'manage' }, { principal_type: 'role', principal_id: 9, name: 'Contributors', level: 'use' }] };
    if (p === '/accounts/connect/assets') return { assets: [] };
    if (p === '/posts') {
      if (query?.unscheduled) return { posts: posts.filter((x) => !x.scheduled_at && x.status === 'draft') };
      if (query?.status === 'in_review') return { posts: posts.filter((x) => x.status === 'in_review') };
      return { posts };
    }
    const postM = /^\/posts\/(\d+)$/.exec(p);
    if (postM) {
      const found = posts.find((x) => x.id === Number(postM[1]));
      if (!found) throw new ApiError(404, 'No such post.', 'not_found');
      return { post: found, events: [{ id: 1, type: 'created', actor: me, text: 'Created the post', created_at: '2026-10-03T03:00:00Z' }] };
    }
    if (/^\/posts\/\d+\/comments$/.test(p)) return { comments: [{ id: 1, author: imesha, body: 'Slide 3 is the new lighting rig — can we tag the supplier?', created_at: '2026-10-06T03:42:00Z' }, { id: 2, author: kasun, body: 'Supplier is fine to tag. Please move the price mention to the first comment.', created_at: '2026-10-06T05:10:00Z' }] };
    if (/^\/posts\/\d+\/review-links$/.test(p)) return { links: [] };
    if (p === '/queue/slots') return queue;
    if (p === '/queue/next') return { times: accounts.map((a) => ({ account_id: a.id, at: '2026-10-09T05:00:00Z' })), window: '10:00–11:00' };
    if (p === '/blackouts') return { blackouts: [{ id: 1, brand_id: 1, starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-21T00:00:00Z', mode: 'hold', reason: 'Deepavali' }] };
    if (p === '/library') return { items: library.filter((i) => !query?.kind || i.kind === query.kind), counts: { media: 148, template: 12, hashtag_set: 9, caption: 31, evergreen: 26 } };
    if (p === '/campaigns') return { campaigns };
    const campM = /^\/campaigns\/(\d+)$/.exec(p);
    if (campM) return { campaign: campaigns.find((c) => c.id === Number(campM[1])) ?? campaigns[0], posts: posts.filter((x) => x.campaign_id === Number(campM[1])) };
    if (p === '/inbox/threads') return { threads: threadRows, counts };
    if (/^\/inbox\/threads\/\d+$/.test(p)) return { thread };
    if (p === '/inbox/saved-replies') return { replies: [{ id: 1, brand_id: 1, name: 'Pricing', shortcut: '/price', body: 'Hi {first_name}, thanks for asking! WorkSuite Business includes WorkSuite Desktop for every user on the plan.' }] };
    if (p === '/inbox/rules') return { rules: [{ id: 1, priority: 1, name: 'Sales questions', summary: 'Messages containing “price” or “plan” → Sales team, round-robin', enabled: true }] };
    if (p === '/analytics/overview') return overview;
    if (p === '/analytics/posts') return { posts: performance };
    if (p === '/analytics/heatmap') return heatmap;
    if (p === '/analytics/inbox') return { volume: 312, median_first_reply_minutes: 38, median_resolution_minutes: 240, by_agent: [{ name: 'Kasun R.', replies: 120, median_first_reply_minutes: 22 }], by_brand: [{ name: 'TechHubiz', volume: 200, median_first_reply_minutes: 30 }] };
    if (p === '/reports/schedules') return { schedules: [] };
    if (p === '/log') return log;
    if (p === '/settings/provider-apps') return providerApps;
    const setM = /^\/settings\/([a-z]+)$/.exec(p);
    if (setM) return { section: setM[1], values: { default_brand_id: 1, default_timezone: 'Asia/Colombo', alt_text_required: false, ai_enabled: true, retry_backoff: '1,5,15', min_gap_minutes: 90, link_tracking: true, short_domain: 'wks.lk', reminder_lead_minutes: 15, approval_tolerance: 'any_date_change', review_link_days: 7, sync_interval_minutes: 5, retention_days: 730 } };
    return notThere(path);
  };
}
