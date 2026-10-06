/**
 * W02 / D02 Create post — the composer's working copy and what is derived from it (SMM-CMP-001/002/003/004/008,
 * SMM-MED-001..004, SMM-CMP-010/015). The Original holds the caption and media every network gets; a network tab is
 * that network's variant, customised once its text or media is edited (CMP-002). Pure functions only, so the checks
 * and the save body are the same whichever part of the screen asks.
 */
import { call } from '../../../core/bridge';
import type { Account, Brand, Campaign, Post, PostInput, PostMedia, ScheduleMode, TargetOptions } from '../api';
import { capabilitiesOf, isNetwork, type CapabilitySet, type MediaKind, type Network } from '../lib/networks';
import { findLinks, tagLink } from '../lib/text';
import { fromLocalInput, toLocalInput } from '../lib/time';
import { checkVariant, sortIssues, type Issue, type MediaFacts } from '../lib/validate';

export interface NetVariant {
  customised: boolean;
  text: string;
  /** null = the Original's media. */
  media: PostMedia[] | null;
  options: TargetOptions;
}

export interface LinkState {
  url: string;
  tracking: boolean;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}

export type WhenMode = Exclude<ScheduleMode, 'queue'>;

export interface ComposerDraft {
  brand_id: number | null;
  campaign_id: number | null;
  base_text: string;
  media: PostMedia[];
  labels: string[];
  first_comment: string;
  link: LinkState;
  account_ids: number[];
  variants: Partial<Record<Network, NetVariant>>;
  /** datetime-local value on the viewer's clock; '' = no time chosen yet. */
  when: string;
  mode: WhenMode;
  /** An AI suggestion was put into the post (SMM-AI-004): the save records it. */
  ai_used: boolean;
}

/**
 * What the composer sends: PostInput plus the time and the AI flag. The SRS has the server record both on the post
 * (scheduled_at / entered_timezone, the ai_used event); api.ts's PostInput does not carry them yet.
 */
export type ComposerPostInput = PostInput & { ai_used?: boolean; scheduled_at?: string | null; schedule_mode?: ScheduleMode | null; entered_timezone?: string | null };

export const DEFAULT_UTM_SOURCE = '{network}';
export const DEFAULT_UTM_MEDIUM = 'social';

export function emptyDraft(): ComposerDraft {
  return {
    brand_id: null,
    campaign_id: null,
    base_text: '',
    media: [],
    labels: [],
    first_comment: '',
    link: { url: '', tracking: true, utm_source: DEFAULT_UTM_SOURCE, utm_medium: DEFAULT_UTM_MEDIUM, utm_campaign: '' },
    account_ids: [],
    variants: {},
    when: '',
    mode: 'at',
    ai_used: false,
  };
}

/** `?account=1,2&file=9001&date=2026-10-09&campaign=1&text=…` (Calendar, Library, Campaigns open the composer so). */
export function draftFromQuery(q: URLSearchParams): ComposerDraft {
  const d = emptyDraft();
  const ids = (q.get('account') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  d.account_ids = [...new Set(ids)];
  const file = Number(q.get('file'));
  if (Number.isInteger(file) && file > 0) d.media = [{ file_id: file, name: `Drive file ${file}`, kind: 'image' }];
  const date = q.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) d.when = `${date}T10:00`;
  const camp = Number(q.get('campaign'));
  if (Number.isInteger(camp) && camp > 0) d.campaign_id = camp;
  const text = q.get('text');
  if (text) d.base_text = text.slice(0, 20_000);
  return d;
}

export function draftFromPost(p: Post): ComposerDraft {
  const d = emptyDraft();
  d.brand_id = p.brand_id;
  d.campaign_id = p.campaign_id;
  d.base_text = p.base_text ?? '';
  d.media = p.media ?? [];
  d.labels = p.labels ?? [];
  d.first_comment = p.first_comment ?? '';
  if (p.link) {
    d.link = {
      url: p.link.url,
      tracking: p.link.tracking,
      utm_source: p.link.utm_source ?? DEFAULT_UTM_SOURCE,
      utm_medium: p.link.utm_medium ?? DEFAULT_UTM_MEDIUM,
      utm_campaign: p.link.utm_campaign ?? '',
    };
  }
  d.account_ids = p.targets.map((t) => t.account_id);
  for (const t of p.targets) {
    if (d.variants[t.network]) continue;
    d.variants[t.network] = { customised: t.customised, text: t.text ?? '', media: t.customised ? (t.media ?? null) : null, options: t.options ?? {} };
  }
  if (p.scheduled_at) d.when = toLocalInput(p.scheduled_at);
  if (p.schedule_mode === 'best' || p.schedule_mode === 'now') d.mode = p.schedule_mode;
  return d;
}

/* ------------------------------------------------------------------------ *
 * Derived
 * ------------------------------------------------------------------------ */

export function chosenAccounts(d: ComposerDraft, accounts: Account[]): Account[] {
  return d.account_ids.map((id) => accounts.find((a) => a.id === id)).filter((a): a is Account => !!a);
}

/** The networks the post goes to, once each, in the order the accounts were chosen (the tabs). */
export function draftNetworks(d: ComposerDraft, accounts: Account[]): Network[] {
  const out: Network[] = [];
  for (const a of chosenAccounts(d, accounts)) if (isNetwork(a.network) && !out.includes(a.network)) out.push(a.network);
  return out;
}

export function capsFor(network: Network, accounts: Account[], d: ComposerDraft): CapabilitySet {
  const a = chosenAccounts(d, accounts).find((x) => x.network === network);
  return capabilitiesOf(network, a?.capabilities);
}

export function variantOf(d: ComposerDraft, n: Network): NetVariant {
  return d.variants[n] ?? { customised: false, text: '', media: null, options: {} };
}

export function textFor(d: ComposerDraft, n: Network | null): string {
  if (!n) return d.base_text;
  const v = d.variants[n];
  return v?.customised ? v.text : d.base_text;
}

export function mediaFor(d: ComposerDraft, n: Network | null): PostMedia[] {
  if (!n) return d.media;
  return d.variants[n]?.media ?? d.media;
}

export function firstCommentFor(d: ComposerDraft, n: Network): string {
  return d.variants[n]?.options.first_comment ?? d.first_comment;
}

/** The brand the post belongs to: its own, else the first chosen account's. */
export function draftBrand(d: ComposerDraft, accounts: Account[], brands: Brand[]): Brand | null {
  const id = d.brand_id ?? chosenAccounts(d, accounts)[0]?.brand_id ?? null;
  return brands.find((b) => b.id === id) ?? null;
}

export function utmCampaign(d: ComposerDraft, campaign: Campaign | null | undefined): string {
  return d.link.utm_campaign || campaign?.utm.campaign || '';
}

/** The tracked link as one network gets it (WF-13). */
export function taggedLink(d: ComposerDraft, network: string, campaign: Campaign | null | undefined): string {
  if (!d.link.url.trim()) return '';
  if (!d.link.tracking) return d.link.url.trim();
  return tagLink(d.link.url.trim(), { source: d.link.utm_source || null, medium: d.link.utm_medium || null, campaign: utmCampaign(d, campaign) || null }, network);
}

/* ------------------------------------------------------------------------ *
 * Updates
 * ------------------------------------------------------------------------ */

export function setVariant(d: ComposerDraft, n: Network, patch: Partial<NetVariant>): ComposerDraft {
  const cur = variantOf(d, n);
  return { ...d, variants: { ...d.variants, [n]: { ...cur, ...patch, options: { ...cur.options, ...(patch.options ?? {}) } } } };
}

/** Editing a network's caption customises it, starting from the Original's text (CMP-002). */
export function editVariantText(d: ComposerDraft, n: Network, text: string): ComposerDraft {
  return setVariant(d, n, { customised: true, text });
}

export function editVariantMedia(d: ComposerDraft, n: Network, media: PostMedia[]): ComposerDraft {
  const cur = variantOf(d, n);
  return setVariant(d, n, { customised: true, text: cur.customised ? cur.text : d.base_text, media });
}

/** "Reset to Original": the network takes the Original's caption and media again; its own options stay. */
export function resetVariant(d: ComposerDraft, n: Network): ComposerDraft {
  const cur = variantOf(d, n);
  return { ...d, variants: { ...d.variants, [n]: { customised: false, text: '', media: null, options: { ...cur.options, thread_parts: null } } } };
}

/** Removes every chosen account on a network ("Remove account" in Checks). */
export function removeNetwork(d: ComposerDraft, n: Network, accounts: Account[]): ComposerDraft {
  const drop = new Set(accounts.filter((a) => a.network === n).map((a) => a.id));
  return { ...d, account_ids: d.account_ids.filter((id) => !drop.has(id)) };
}

/** "Move link to first comment": links out of the network's caption, into its first comment. */
export function moveLinksToComment(d: ComposerDraft, n: Network): ComposerDraft {
  const text = textFor(d, n);
  const links = findLinks(text);
  if (!links.length) return d;
  let out = text;
  for (const l of [...links].reverse()) out = out.slice(0, l.start) + out.slice(l.end);
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/u, '');
  const comment = [firstCommentFor(d, n), ...links.map((l) => l.url)].filter((s) => s.trim()).join('\n');
  return setVariant(editVariantText(d, n, out), n, { options: { first_comment: comment } });
}

/** The ratio a crop fix uses: the nearest end of what the network takes. */
export function cropRatioFor(caps: CapabilitySet): string {
  if (!caps.image_ratio) return '1:1';
  const [lo] = caps.image_ratio;
  return Math.abs(lo - 0.8) < 0.02 ? '4:5' : lo <= 1 && caps.image_ratio[1] >= 1 ? '1:1' : '1.91:1';
}

export function ratioValue(r: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

/* ------------------------------------------------------------------------ *
 * Media kinds (Drive rows carry only a name and an extension)
 * ------------------------------------------------------------------------ */

const IMAGE = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff'];
const VIDEO = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'mpeg', 'mpg'];

export function kindOfName(name: string, extension?: string | null): MediaKind {
  const ext = (extension || name.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  if (ext === 'gif') return 'gif';
  if (IMAGE.includes(ext)) return 'image';
  if (VIDEO.includes(ext)) return 'video';
  return 'document';
}

/* ------------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------------ */

export interface DraftIssue extends Issue {
  network: Network | null;
}

export interface DraftChecks {
  issues: DraftIssue[];
  byNetwork: Partial<Record<Network, { used: number; limit: number; blocking: boolean; count: number }>>;
  blocking: boolean;
}

function facts(m: PostMedia): MediaFacts {
  // A crop chosen here changes the shape the network receives.
  const r = m.crop ? ratioValue(m.crop.ratio) : null;
  const height = r && m.width ? Math.round(m.width / r) : m.height;
  return { kind: m.kind, name: m.name, width: m.width, height, bytes: m.bytes, duration_seconds: m.duration_seconds, alt_text: m.alt_text };
}

export function checkDraft(d: ComposerDraft, accounts: Account[], altRequired: boolean): DraftChecks {
  const issues: DraftIssue[] = [];
  const byNetwork: DraftChecks['byNetwork'] = {};
  const nets = draftNetworks(d, accounts);
  if (!nets.length) {
    if (!d.base_text.trim() && !d.media.length) issues.push({ network: null, level: 'error', code: 'empty', message: 'Write a caption or add media.' });
    issues.push({ network: null, level: 'error', code: 'no_accounts', message: 'Choose at least one account to post to.' });
  }
  for (const n of nets) {
    const v = variantOf(d, n);
    const caps = capsFor(n, accounts, d);
    const res = checkVariant({
      network: n,
      caps,
      text: textFor(d, n),
      media: mediaFor(d, n).map(facts),
      postKind: v.options.post_kind ?? null,
      title: v.options.title ?? null,
      board: v.options.board ?? null,
      firstComment: firstCommentFor(d, n),
      threadParts: v.options.thread_parts ?? null,
      offer: v.options.offer ?? null,
      altRequired,
    });
    byNetwork[n] = { used: res.used, limit: res.limit, blocking: res.blocking, count: res.issues.filter((i) => i.level === 'error').length };
    for (const i of res.issues) issues.push({ ...i, network: n });
  }
  for (const a of chosenAccounts(d, accounts)) {
    if (a.status === 'needs_reconnect' || a.status === 'error') {
      issues.push({ network: isNetwork(a.network) ? a.network : null, level: 'warning', code: 'reconnect', message: `${a.display_name} needs reconnecting: its post is held until it is reconnected.` });
    }
  }
  const sorted = sortIssues(issues);
  return { issues: sorted, byNetwork, blocking: sorted.some((i) => i.level === 'error') };
}

/* ------------------------------------------------------------------------ *
 * The save body
 * ------------------------------------------------------------------------ */

export function toPostInput(d: ComposerDraft, accounts: Account[], brandId: number | null, campaign: Campaign | null | undefined, version: number | undefined, zone: string): ComposerPostInput {
  const targets = chosenAccounts(d, accounts).map((a) => {
    const n = a.network;
    const v = d.variants[n];
    return {
      account_id: a.id,
      customised: !!v?.customised,
      text: v?.customised ? v.text : null,
      media: v?.customised ? (v.media ?? null) : null,
      options: v?.options ?? {},
    };
  });
  const at = d.mode === 'at' && d.when ? fromLocalInput(d.when, zone) : null;
  return {
    brand_id: brandId,
    campaign_id: d.campaign_id,
    base_text: d.base_text,
    media: d.media.map((m, i) => ({ ...m, sort: i })),
    labels: d.labels,
    first_comment: d.first_comment.trim() || null,
    link: d.link.url.trim()
      ? { url: d.link.url.trim(), tracking: d.link.tracking, utm_source: d.link.utm_source || null, utm_medium: d.link.utm_medium || null, utm_campaign: utmCampaign(d, campaign) || null }
      : null,
    targets,
    ...(version !== undefined ? { version } : {}),
    ai_used: d.ai_used || undefined,
    scheduled_at: at,
    schedule_mode: d.when || d.mode !== 'at' ? d.mode : null,
    entered_timezone: zone,
  };
}

/* ------------------------------------------------------------------------ *
 * The unsaved copy on this computer (SMM-CMP-010, DSK-004)
 * ------------------------------------------------------------------------ */

export interface LocalCopy {
  draft: ComposerDraft;
  saved_at: string;
}

const MODULE = 'social-media';
const lsKey = (ctx: string) => `${MODULE}.draft.${ctx}`;

function isCopy(v: unknown): v is LocalCopy {
  return !!v && typeof v === 'object' && 'draft' in v && 'saved_at' in v;
}

/** Kept in the app's encrypted draft store (src/core/drafts' channels); in a plain browser, localStorage. */
export async function loadLocalCopy(ctx: string): Promise<LocalCopy | null> {
  try {
    const d = await call('offline:getDraft', { module: MODULE, context: ctx });
    if (d && typeof d === 'object' && 'content' in d && isCopy(d.content)) return d.content;
  } catch {
    /* no desktop bridge: fall through */
  }
  try {
    const raw = localStorage.getItem(lsKey(ctx));
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isCopy(v) ? v : null;
  } catch {
    return null;
  }
}

export async function saveLocalCopy(ctx: string, draft: ComposerDraft): Promise<void> {
  const copy: LocalCopy = { draft, saved_at: new Date().toISOString() };
  try {
    await call('offline:saveDraft', { module: MODULE, context: ctx, content: copy });
    return;
  } catch {
    /* fall through */
  }
  try {
    localStorage.setItem(lsKey(ctx), JSON.stringify(copy));
  } catch {
    /* storage full or blocked: nothing more to do */
  }
}

export async function clearLocalCopy(ctx: string): Promise<void> {
  await call('offline:deleteDraft', { module: MODULE, context: ctx }).catch(() => undefined);
  try {
    localStorage.removeItem(lsKey(ctx));
  } catch {
    /* ignore */
  }
}
