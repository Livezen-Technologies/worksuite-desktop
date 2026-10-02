import { text } from '../../core/i18n';
import { parseTs } from '../../core/time';

/**
 * Import my old mail (Mail SRS v2.2 MAIL-MIG-20…22, WF-M27, design D08):
 * what the server's import endpoints answer, and the small decisions the
 * screen makes from them, kept apart so they can be tested.
 */

export type ImportStage = 'copying' | 'paused' | 'needs_attention' | 'syncing' | 'done' | 'cancelled' | 'failed' | 'testing' | string;

export interface ImportMailbox {
  id: number;
  source: string;
  destination: string | null;
  state: string;
  error: string | null;
  found: number;
  copied: number;
  skipped: number;
  failed: number;
}

export interface ImportSummary {
  id: number;
  kind: string;
  name: string;
  source_type: string;
  stage: ImportStage;
  started_at: string | null;
  finished_at: string | null;
  found: number;
  copied: number;
  skipped: number;
  failed: number;
  bytes: number;
  percent: number;
  mailboxes: ImportMailbox[];
}

export interface ImportFolder {
  mailbox_id: number;
  source: string;
  destination: string | null;
  skip_reason: string | null;
  found: number;
  copied: number;
  skipped: number;
  failed: number;
  done: boolean;
}

export interface ImportDetail extends ImportSummary {
  folders: ImportFolder[];
  not_copied: Array<{ status: string; reason: string | null; subject: string | null; date: string | null; folder: string }>;
  events: Array<{ kind: string; detail: string; at: string }>;
}

export interface ImportOptions {
  accounts: Array<{ id: number; email: string; name: string; oauth: boolean }>;
  destinations: Array<{ id: number; email: string; name: string }>;
  presets: Array<{ key: string; label: string; note: string; needs_host: boolean }>;
  accounts_allowed?: boolean;
  zoho_regions: string[];
}

export interface ImportCheck {
  total: number;
  folders: Array<{ name: string; messages: number | null; skip_reason: string | null }>;
}

/** The five places old mail lives (D08), and how WorkSuite reads each. */
export type SourceKind = 'microsoft' | 'google' | 'zoho' | 'cpanel' | 'imap';

export const SOURCES: Array<{ id: SourceKind; name: string; hint: string; badge: string; preset: string | null; tone: string }> = [
  { id: 'microsoft', name: 'Microsoft 365', hint: 'Outlook, Exchange', badge: 'M', preset: null, tone: 'blue' },
  { id: 'google', name: 'Google', hint: 'Gmail, Workspace', badge: 'G', preset: 'gmail', tone: 'amber' },
  { id: 'zoho', name: 'Zoho Mail', hint: 'app password', badge: 'Z', preset: 'zoho', tone: 'red' },
  { id: 'cpanel', name: 'cPanel hosting', hint: 'IMAP', badge: 'cP', preset: 'cpanel', tone: 'amber' },
  { id: 'imap', name: 'Other IMAP', hint: 'server + password', badge: '@', preset: 'imap', tone: 'slate' },
];

/** The accounts already in the Mail app that can be read for a kind of source (Microsoft and Google: the signed-in ones). */
export function accountsFor(kind: SourceKind, accounts: ImportOptions['accounts']): ImportOptions['accounts'] {
  if (kind === 'microsoft') return accounts.filter((a) => a.oauth && !/gmail|googlemail/i.test(a.email));
  if (kind === 'google') return accounts.filter((a) => /@(gmail|googlemail)\./i.test(a.email) || a.oauth);
  return [];
}

/** "What to copy": the date the import starts from, on the reader's calendar (empty: everything). */
export function sinceFor(range: 'all' | '1y' | '3y' | '5y', today: string): string {
  if (range === 'all') return '';
  const years = range === '1y' ? 1 : range === '3y' ? 3 : 5;
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC((y ?? 2000) - years, (m ?? 1) - 1, d ?? 1));
  return date.toISOString().slice(0, 10);
}

/** Pause, resume and cancel, as the stage allows. */
export function importActions(stage: ImportStage): Array<'pause' | 'resume' | 'cancel'> {
  const out: Array<'pause' | 'resume' | 'cancel'> = [];
  if (stage === 'copying') out.push('pause');
  if (stage === 'paused' || stage === 'needs_attention') out.push('resume');
  if (stage === 'copying' || stage === 'paused' || stage === 'needs_attention') out.push('cancel');
  return out;
}

export function stageWords(stage: ImportStage, percent: number): { label: string; tone: 'indigo' | 'warning' | 'success' | 'danger' | 'muted' } {
  switch (stage) {
    case 'copying':
      return { label: text('Importing · {n}%', { n: percent }), tone: 'indigo' };
    case 'paused':
      return { label: text('Paused · {n}%', { n: percent }), tone: 'warning' };
    case 'needs_attention':
      return { label: text('Needs attention'), tone: 'danger' };
    case 'syncing':
      return { label: text('Done · keeps copying new mail'), tone: 'success' };
    case 'done':
      return { label: text('Done'), tone: 'success' };
    case 'cancelled':
      return { label: text('Cancelled'), tone: 'muted' };
    default:
      return { label: text('Failed'), tone: 'danger' };
  }
}

/** "~25 min" left, from how fast it has copied so far; null until there is enough to say. */
export function timeLeft(imp: Pick<ImportSummary, 'found' | 'copied' | 'skipped' | 'failed' | 'started_at' | 'stage'>, now = Date.now()): string | null {
  if (imp.stage !== 'copying' || !imp.started_at) return null;
  const done = imp.copied + imp.skipped + imp.failed;
  const remaining = imp.found - done;
  const elapsed = (now - parseTs(imp.started_at).getTime()) / 1000;
  if (remaining <= 0 || done < 20 || !Number.isFinite(elapsed) || elapsed < 30) return null;
  const seconds = (remaining / done) * elapsed;
  if (seconds < 90) return text('~1 min');
  if (seconds < 3600 * 2) return text('~{n} min', { n: Math.round(seconds / 60) });
  return text('~{n} h', { n: Math.round(seconds / 3600) });
}

/** A folder's progress cell: Done, n%, Waiting or the reason it is skipped. */
export function folderProgress(f: ImportFolder): { label: string; tone: 'success' | 'indigo' | 'muted' } {
  if (f.skip_reason) return { label: '—', tone: 'muted' };
  if (f.done) return { label: text('Done'), tone: 'success' };
  const done = f.copied + f.skipped + f.failed;
  if (done === 0) return { label: text('Waiting'), tone: 'muted' };
  return { label: `${f.found ? Math.min(99, Math.floor((done / f.found) * 100)) : 0}%`, tone: 'indigo' };
}
