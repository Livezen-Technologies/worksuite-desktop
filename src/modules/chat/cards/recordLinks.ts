/**
 * Which WorkSuite records a message's text points at, so each can show as a
 * card. A record is named by its address, either in full
 * (`https://app.worksuite.lk/meet/<uuid>`) or as a bare path on its own line
 * (`/tasks?task=12`, what Attach record sends). Only this server's addresses
 * (or app.worksuite.lk, where the server's invitations point) count; anything
 * else is an ordinary link.
 */
export type RecordRef =
  | { kind: 'meet'; uuid: string }
  | { kind: 'file'; id: number }
  | { kind: 'folder'; id: number }
  | { kind: 'task'; id: number }
  | { kind: 'note'; id: number }
  | { kind: 'event'; id: number }
  | { kind: 'deal'; id: number }
  | { kind: 'lead'; id: number }
  | { kind: 'account'; id: number }
  | { kind: 'invoice'; id: number }
  | { kind: 'contact'; id: number }
  | { kind: 'meeting'; id: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABS = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const PATH = /(?:^|\s)(\/[a-z][a-z-]*(?:\/[^\s?#]*)?(?:\?[^\s#]*)?)/gim;
const TRAIL = /[.,;:!?)\]}'"»”’]+$/;

const num = (v: string | null | undefined): number | null => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** One path (with its query) → the record it names, or null. */
export function refOf(pathAndQuery: string): RecordRef | null {
  let u: URL;
  try {
    u = new URL(pathAndQuery, 'https://x.invalid');
  } catch {
    return null;
  }
  const seg = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const q = u.searchParams;
  const one = (k: RecordRef['kind'], v: number | null): RecordRef | null => (v ? ({ kind: k, id: v } as RecordRef) : null);
  switch (seg[0]) {
    case 'meet':
      return seg[1] && UUID.test(seg[1]) ? { kind: 'meet', uuid: seg[1].toLowerCase() } : null;
    case 'files':
    case 'drive':
      return one('file', num(q.get('file'))) ?? one('folder', num(q.get('folder')));
    case 'tasks':
      return one('task', num(q.get('task')) ?? num(seg[1]));
    case 'notes':
      return one('note', num(q.get('note')) ?? num(seg[1]));
    case 'calendar':
      return one('event', num(q.get('event')) ?? num(seg[1]));
    case 'crm':
      if (seg[1] === 'leads') return one('lead', num(seg[2]));
      return one('deal', num(q.get('deal'))) ?? one('lead', num(q.get('lead'))) ?? one('account', num(q.get('account')));
    case 'billing':
    case 'invoices':
      return one('invoice', num(q.get('invoice')) ?? num(seg[2] ?? seg[1]));
    case 'contacts':
      return one('contact', num(q.get('open')) ?? num(q.get('contact')) ?? num(seg[1]));
    case 'meetings':
      return one('meeting', num(q.get('meeting')) ?? num(seg[1]));
    default:
      return null;
  }
}

/**
 * The address a record opens at: the same path in the web app and here, so
 * a link sent from either opens in both (`/crm?deal=` is what the web's CRM
 * reads, and the desktop's works out the view from it).
 */
export function pathOf(r: RecordRef): string {
  switch (r.kind) {
    case 'meet':
      return `/meet/${r.uuid}`;
    case 'file':
      return `/files?file=${r.id}`;
    case 'folder':
      return `/files?folder=${r.id}`;
    case 'task':
      return `/tasks?task=${r.id}`;
    case 'note':
      return `/notes?note=${r.id}`;
    case 'event':
      return `/calendar?event=${r.id}`;
    case 'deal':
      return `/crm?deal=${r.id}`;
    case 'lead':
      return `/crm/leads/${r.id}`;
    case 'account':
      return `/crm?account=${r.id}`;
    case 'invoice':
      return `/billing?invoice=${r.id}`;
    case 'contact':
      return `/contacts?open=${r.id}`;
    case 'meeting':
      return `/meetings?meeting=${r.id}`;
  }
}

const key = (r: RecordRef) => ('uuid' in r ? `${r.kind}:${r.uuid}` : `${r.kind}:${r.id}`);

/** Every record a message names, in order, each once. */
export function recordsIn(text: string | null | undefined, serverOrigin: string | null | undefined): RecordRef[] {
  if (!text) return [];
  let host = '';
  try {
    host = serverOrigin ? new URL(serverOrigin).host : '';
  } catch {
    host = '';
  }
  const out: RecordRef[] = [];
  const seen = new Set<string>();
  const add = (r: RecordRef | null) => {
    if (r && !seen.has(key(r))) {
      seen.add(key(r));
      out.push(r);
    }
  };
  for (const m of text.matchAll(ABS)) {
    let u: URL;
    try {
      u = new URL(m[0].replace(TRAIL, ''));
    } catch {
      continue;
    }
    if (u.host === host || u.hostname === 'app.worksuite.lk') add(refOf(`${u.pathname}${u.search}`));
  }
  // Bare paths only where the message is not a full address already.
  for (const m of text.replace(ABS, ' ').matchAll(PATH)) add(refOf(m[1]!.replace(TRAIL, '')));
  return out.slice(0, 4);
}

/** The text without the lines that are only a record's address (its card says it better). */
export function withoutRecordLines(text: string, serverOrigin: string | null | undefined): string {
  const lines = text.split('\n');
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (!t || /\s/.test(t)) return true;
    return recordsIn(t, serverOrigin).length === 0;
  });
  return kept.join('\n').trim();
}
