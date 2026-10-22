import { isJunkFile } from '../files/api';
import type { Dashboard } from './HomePage';

export type ActivityRow = Dashboard['activity'][number];
export type RecentFile = Dashboard['recent_files'][number];

/** Transfer parts and the like are not activity (#104): a line per chunk of an upload says nothing. */
const NOISE = /\b(chunk(s|ed)?|part \d+ of \d+|upload(ed)? part|transfer part|segment \d+)\b/i;

/**
 * A transfer's own leftovers (#104): the pieces an upload or download is made of while it runs, and the editor and
 * system files `isJunkFile` already knows — never what the person saved.
 */
const TRANSFER = /(\.(chunk|tus|upload|uploading|blob)$)|(\.part\d+$)|(\.\d{3,}$)|(^(upload|transfer|chunk)[-_][0-9a-f-]{8,})/i;

export function isTransferArtifact(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  return !n || isJunkFile(n) || TRANSFER.test(n);
}

/** Recent files without a transfer's temporary pieces. */
export function recentFiles(files: RecentFile[]): RecentFile[] {
  return files.filter((f) => !isTransferArtifact(f.name));
}

/** How close two updates must be to read as one line: an hour. */
const WINDOW = 60 * 60_000;

/**
 * The activity feed, grouped (#104). Newer servers group already and send `count`; an older one sends a line per
 * update, so runs of the same thing by the same person, an hour apart at most, become one line with a count here.
 * Transfer-part lines are dropped first.
 */
export function groupActivity(rows: ActivityRow[]): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const r of rows) {
    if (NOISE.test(r.description ?? '')) continue;
    const last = out[out.length - 1];
    const near = last && Math.abs(Date.parse(last.at) - Date.parse(r.at)) <= WINDOW;
    if (last && near && last.user === r.user && (last.module ?? null) === (r.module ?? null) && (last.description ?? '') === (r.description ?? '')) {
      out[out.length - 1] = { ...last, count: (last.count ?? 1) + (r.count ?? 1), link: last.link ?? r.link ?? null };
    } else out.push(r);
  }
  return out;
}
