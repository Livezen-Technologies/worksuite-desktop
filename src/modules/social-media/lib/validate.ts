/**
 * Live checks of one variant against its account's capability set (SMM-CMP-003, SMM-MED-004, SMM-CMP-015).
 *
 * The composer runs these on every change so Checks lists problems as they are typed and Schedule is disabled while a
 * blocking one remains. The server runs its own (POST /posts/{id}/validate) before it schedules anything: a check here
 * only ever makes the desktop stricter, never lets through what the server would refuse.
 */
import { countText, findLinks, findMentions } from './text';
import { networkInfo, POST_KIND_LABEL, type CapabilitySet, type MediaKind, type PostKind } from './networks';

export type IssueLevel = 'error' | 'warning' | 'info';

/** A fix the composer can offer in one click (SMM-CMP-004). */
export type IssueFix = 'split_thread' | 'shorten' | 'crop' | 'remove_account' | 'add_alt_text' | 'move_link_to_comment';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  fix?: IssueFix;
}

export interface MediaFacts {
  kind: MediaKind;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  duration_seconds?: number | null;
  alt_text?: string | null;
}

export interface VariantInput {
  network: string;
  caps: CapabilitySet;
  text: string;
  media: MediaFacts[];
  postKind?: PostKind | null;
  title?: string | null;
  board?: string | null;
  firstComment?: string | null;
  threadParts?: string[] | null;
  offer?: { starts_on?: string | null; ends_on?: string | null } | null;
  /** Module setting "alt text required" (SMM-ADM-003): a missing one blocks instead of warning. */
  altRequired?: boolean;
}

export interface VariantCheck {
  issues: Issue[];
  used: number;
  limit: number;
  blocking: boolean;
}

const MB = 1024 * 1024;
function size(bytes: number): string {
  return bytes >= 1024 * MB ? `${Math.round(bytes / (1024 * MB))} GB` : `${Math.round(bytes / MB)} MB`;
}

function ratioLabel(r: number): string {
  const known: Array<[number, string]> = [
    [1, '1:1'],
    [0.8, '4:5'],
    [1.91, '1.91:1'],
    [0.5625, '9:16'],
    [1.7778, '16:9'],
    [0.6667, '2:3'],
  ];
  for (const [v, l] of known) if (Math.abs(v - r) < 0.02) return l;
  return r.toFixed(2);
}

export function checkVariant(v: VariantInput): VariantCheck {
  const { caps } = v;
  const net = networkInfo(v.network).label;
  const issues: Issue[] = [];
  const parts = v.threadParts?.filter((p) => p.trim()) ?? [];
  const isThread = parts.length > 1;
  const used = isThread ? Math.max(...parts.map((p) => countText(p, caps.counting))) : countText(v.text, caps.counting);
  const limit = caps.text_limit;

  if (!v.text.trim() && v.media.length === 0 && !isThread) issues.push({ level: 'error', code: 'empty', message: `${net}: write a caption or add media.` });

  if (limit > 0) {
    if (isThread) {
      parts.forEach((p, i) => {
        const n = countText(p, caps.counting);
        if (n > limit) issues.push({ level: 'error', code: 'thread_part_too_long', message: `${net}: part ${i + 1} is ${n} / ${limit} characters.` });
      });
    } else if (used > limit) {
      issues.push(
        caps.options.thread
          ? { level: 'error', code: 'too_long', message: `${net}: ${used} / ${limit} characters. Shorten it, or let WorkSuite split it into a thread.`, fix: 'split_thread' }
          : { level: 'error', code: 'too_long', message: `${net}: ${used} / ${limit} characters. Shorten it for ${net}.`, fix: 'shorten' },
      );
    } else if (used > limit * 0.9) {
      issues.push({ level: 'info', code: 'near_limit', message: `${net}: ${used} / ${limit} characters.` });
    }
  }

  if (caps.media_required && v.media.length === 0) issues.push({ level: 'error', code: 'media_required', message: `${net} needs a picture or a video.`, fix: 'remove_account' });
  if (v.media.length > caps.max_media) issues.push({ level: 'error', code: 'too_many_media', message: `${net}: ${v.media.length} files; it takes ${caps.max_media} at most.` });

  const kinds = new Set(v.media.map((m) => m.kind));
  for (const k of kinds) {
    if (!caps.media_kinds.includes(k)) issues.push({ level: 'error', code: 'media_kind', message: `${net} cannot post ${k === 'document' ? 'documents' : k === 'gif' ? 'GIFs' : `${k}s`}.`, fix: 'remove_account' });
  }
  if (v.network === 'instagram' && kinds.has('image') && kinds.has('video') && v.postKind === 'story') {
    issues.push({ level: 'warning', code: 'story_mixed', message: 'Instagram: a Story posts one file at a time; each file becomes its own Story.' });
  }

  for (const m of v.media) {
    const name = m.name ? `“${m.name}”` : 'A file';
    if (m.kind === 'image' && caps.image_ratio && m.width && m.height) {
      const r = m.width / m.height;
      const [lo, hi] = caps.image_ratio;
      if (r < lo - 0.005 || r > hi + 0.005) {
        issues.push({ level: 'error', code: 'ratio', message: `${net}: ${name} is ${ratioLabel(r)}; it takes ${ratioLabel(lo)} to ${ratioLabel(hi)}. Crop or pad it.`, fix: 'crop' });
      }
    }
    if (m.kind === 'image' && caps.max_image_bytes && m.bytes && m.bytes > caps.max_image_bytes) {
      issues.push({ level: 'error', code: 'image_size', message: `${net}: ${name} is larger than ${size(caps.max_image_bytes)}.` });
    }
    if (m.kind === 'video' && caps.max_video_bytes && m.bytes && m.bytes > caps.max_video_bytes) {
      issues.push({ level: 'error', code: 'video_size', message: `${net}: ${name} is larger than ${size(caps.max_video_bytes)}.` });
    }
    if (m.kind === 'video' && caps.max_video_seconds && m.duration_seconds && m.duration_seconds > caps.max_video_seconds) {
      const mins = caps.max_video_seconds >= 120 ? `${Math.round(caps.max_video_seconds / 60)} minutes` : `${caps.max_video_seconds} seconds`;
      issues.push({ level: 'error', code: 'video_length', message: `${net}: ${name} is longer than ${mins}.` });
    }
    if (m.kind === 'image' && caps.alt_text && !m.alt_text?.trim()) {
      issues.push({ level: v.altRequired ? 'error' : 'warning', code: 'alt_text', message: `${net}: ${name} has no alt text.`, fix: 'add_alt_text' });
    }
  }

  if (v.postKind && !caps.post_kinds.includes(v.postKind)) {
    issues.push({ level: 'error', code: 'post_kind', message: `${net} cannot publish a ${POST_KIND_LABEL[v.postKind].toLowerCase()}.` });
  }
  if (v.postKind && caps.manual_kinds.includes(v.postKind)) {
    issues.push({ level: 'warning', code: 'manual', message: `${net}: the API cannot publish a ${POST_KIND_LABEL[v.postKind].toLowerCase()}. It becomes a reminder to post it yourself at that time.` });
  }

  const links = findLinks(v.text);
  if (links.length && caps.links === 'text') {
    issues.push({ level: 'warning', code: 'link_not_clickable', message: `${net}: links in the caption are not clickable.`, fix: caps.options.first_comment ? 'move_link_to_comment' : undefined });
  }
  if (links.length && v.media.length > 0 && caps.links === 'card' && (v.network === 'linkedin' || v.network === 'facebook')) {
    issues.push({ level: 'info', code: 'link_preview_replaced', message: `${net}: the link preview is replaced by the ${v.media.length > 1 ? 'picture carousel' : 'picture'}.` });
  }
  if (!caps.mentions && findMentions(v.text).length) {
    issues.push({ level: 'warning', code: 'mentions_text', message: `${net}: @mentions stay as plain text; they do not tag anyone.` });
  }
  if (caps.options.title && v.network === 'youtube' && !v.title?.trim()) issues.push({ level: 'error', code: 'title_required', message: 'YouTube needs a video title.' });
  if (caps.options.board && !v.board?.trim()) issues.push({ level: 'error', code: 'board_required', message: 'Pinterest needs a board for the Pin.' });
  if (v.postKind === 'offer' && (!v.offer?.starts_on || !v.offer?.ends_on)) issues.push({ level: 'error', code: 'offer_dates', message: 'Google Business: an offer needs a start and an end date.' });
  if (v.firstComment?.trim() && caps.options.first_comment) {
    issues.push({ level: 'info', code: 'first_comment', message: `${net}: the first comment is posted right after the post.` });
  }
  if (v.media.length > 1 && caps.max_media > 1 && v.media.length <= caps.max_media && !issues.some((i) => i.level === 'error')) {
    issues.push({ level: 'info', code: 'carousel', message: `${net}: ${v.media.length} ${v.media.every((m) => m.kind === 'image') ? 'pictures' : 'files'} as one carousel.` });
  }

  return { issues, used, limit, blocking: issues.some((i) => i.level === 'error') };
}

/** Errors first, then warnings, then notes. */
export function sortIssues<T extends { level: IssueLevel }>(issues: T[]): T[] {
  const rank: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
  return [...issues].sort((a, b) => rank[a.level] - rank[b.level]);
}
