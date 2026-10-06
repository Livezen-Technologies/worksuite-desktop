import { APP_CATALOGUE, findApp } from '@shared/apps';
import { PAGE_APPS, WORKSUITE_WEB_HOSTS, isPageType, itemWebLink, pageOfRoute, parseItemLink, type ItemLink } from '@shared/item-links';
import { appForWebPath, resolveWebLink } from '@shared/links';

/**
 * Which WorkSuite records a message's text points at, so each can show as a
 * card. A record is named by its address: an item link
 * (`https://app.worksuite.lk/o/7/task/12`, what sharing sends since
 * worksuite-desktop#266), the web address in full
 * (`https://app.worksuite.lk/meet/<uuid>`), or a bare path on its own line
 * (`/tasks?task=12`, what Attach record sent before). A page of an app
 * (`/o/7/hr/announcements`, or the older `/hr?tab=announcements`) is one
 * too. Only this server's addresses (or app.worksuite.lk, where the server's
 * invitations point) count; anything else is an ordinary link.
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
  | { kind: 'meeting'; id: number }
  | PageRef;

/** A page of a desktop app; `org` when its link names the organisation (an item link). */
export type PageRef = { kind: 'page'; app: string; page: string; org?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABS = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const PATH = /(?:^|\s)(\/[a-z][a-z-]*(?:\/[^\s?#]*)?(?:\?[^\s#]*)?)/gim;
const TRAIL = /[.,;:!?)\]}'"»”’]+$/;

const num = (v: string | null | undefined): number | null => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** The record a path names, or null. */
function recordOf(seg: string[], q: URLSearchParams): RecordRef | null {
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

/** The page of an app a web path shows (`/hr?tab=announcements`), with the app's web address mapped to its id (`/oms` is Sales). */
function pageOf(path: string, search: string): PageRef | null {
  const def = appForWebPath(path);
  if (!def || path.replace(/\/+$/, '') !== def.webPath || !isPageType(def.id)) return null;
  const p = pageOfRoute(`/${def.id}${search}`);
  return p ? { kind: 'page', app: p.app, page: p.page } : null;
}

/** One path (with its query) → the record or page it names, or null. */
export function refOf(pathAndQuery: string): RecordRef | null {
  let u: URL;
  try {
    u = new URL(pathAndQuery, 'https://x.invalid');
  } catch {
    return null;
  }
  const seg = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  return recordOf(seg, u.searchParams) ?? pageOf(u.pathname, u.search);
}

/** An item link → the card that shows it; null for the types no card shows (a reminder's, a chat's, a tender's…). */
export function refOfItem(l: Pick<ItemLink, 'org' | 'type' | 'id'>): RecordRef | null {
  if (isPageType(l.type)) return { kind: 'page', app: l.type, page: l.id, org: l.org };
  const n = num(l.id);
  switch (l.type) {
    case 'meeting':
      return UUID.test(l.id) ? { kind: 'meet', uuid: l.id.toLowerCase() } : n ? { kind: 'meeting', id: n } : null;
    case 'shared':
      return n ? { kind: 'file', id: n } : null;
    case 'file':
    case 'folder':
    case 'task':
    case 'note':
    case 'event':
    case 'deal':
    case 'lead':
    case 'invoice':
      return n ? ({ kind: l.type, id: n } as RecordRef) : null;
    default:
      return null;
  }
}

/** A card's item link type and id, for the records and pages item links can name (an account or a contact has none). */
function itemOfRef(r: RecordRef): { type: string; id: string } | null {
  switch (r.kind) {
    case 'page':
      return { type: r.app, id: r.page };
    case 'meet':
      return { type: 'meeting', id: r.uuid };
    case 'account':
    case 'contact':
      return null;
    default:
      return { type: r.kind, id: String(r.id) };
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
    case 'page':
      return `${findApp(r.app)?.webPath ?? `/${r.app}`}?${PAGE_APPS[r.app] ?? 'tab'}=${r.page}`;
  }
}

const key = (r: RecordRef) => (r.kind === 'page' ? `page:${r.app}/${r.page}` : 'uuid' in r ? `${r.kind}:${r.uuid}` : `${r.kind}:${r.id}`);

function hostOf(origin: string | null | undefined): string {
  try {
    return origin ? new URL(origin).host : '';
  } catch {
    return '';
  }
}

/** Every record a message names, in order, each once. */
export function recordsIn(text: string | null | undefined, serverOrigin: string | null | undefined): RecordRef[] {
  if (!text) return [];
  const host = hostOf(serverOrigin);
  const out: RecordRef[] = [];
  const seen = new Set<string>();
  const add = (r: RecordRef | null) => {
    if (r && !seen.has(key(r))) {
      seen.add(key(r));
      out.push(r);
    }
  };
  for (const m of text.matchAll(ABS)) {
    const raw = m[0].replace(TRAIL, '');
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.host !== host && u.hostname !== 'app.worksuite.lk') continue;
    if (u.pathname.startsWith('/o/')) {
      // An item link: held to the item-link allow-list, and shown only for what it names.
      const item = parseItemLink(raw, { hosts: [u.host === host ? u.hostname : null] });
      if (item.ok) add(refOfItem(item.link));
      continue;
    }
    add(refOf(`${u.pathname}${u.search}`));
  }
  // Bare paths only where the message is not a full address already.
  for (const m of text.replace(ABS, ' ').matchAll(PATH)) add(refOf(m[1]!.replace(TRAIL, '')));
  return out.slice(0, 4);
}

/** A page's name on its card: "HR · Announcements". */
export function pageTitle(r: PageRef): string {
  const words = r.page.replace(/-/g, ' ');
  return `${findApp(r.app)?.label ?? r.app} · ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * The line a share puts above a page's link — the tab's own title, "HR · Announcements" — which the page's card
 * takes as its title rather than repeating it under the card. Only a short line that starts with the app's name.
 */
export function pageTitleLine(text: string | null | undefined, r: PageRef): string | null {
  const label = findApp(r.app)?.label;
  if (!text || !label) return null;
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${label} · `) && l.length <= 80) ?? null
  );
}

/** The text without the lines that are only a record's address, or a page's title its card shows (the card says it better). */
export function withoutRecordLines(text: string, serverOrigin: string | null | undefined): string {
  const pages = recordsIn(text, serverOrigin).filter((r): r is PageRef => r.kind === 'page');
  const titles = new Set(pages.map((p) => pageTitleLine(text, p)).filter(Boolean));
  const lines = text.split('\n');
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (titles.has(t)) return false;
    if (!t || /\s/.test(t)) return true;
    return recordsIn(t, serverOrigin).length === 0;
  });
  return kept.join('\n').trim();
}

/** The web address of what a desktop route shows, when it is a record or a page of an app (null for a whole app, Chat or Home). */
export function webPathOfRoute(route: string): string | null {
  const [path] = route.split('?');
  const seg = path!.replace(/^\/+/, '').split('/');
  if (seg.length < 2 && !route.includes('?')) return null;
  const def = APP_CATALOGUE.find((a) => a.id === seg[0]);
  if (!def || def.id === 'chat' || def.id === 'home') return null;
  const web = `${def.webPath}${route.slice(def.id.length + 1)}`;
  return resolveWebLink(web).kind === 'none' ? null : web;
}

/** The host a share's link names: the signed-in server's own, when it is a plain https address; WorkSuite's otherwise. */
function shareHost(origin: string | null | undefined): string {
  try {
    const u = origin ? new URL(origin) : null;
    if (u && u.protocol === 'https:' && !u.port) return u.hostname;
  } catch {
    // Not an address: WorkSuite's own.
  }
  return WORKSUITE_WEB_HOSTS[0];
}

/**
 * The link a share sends for a WorkSuite web path (worksuite-desktop#266): an item link,
 * `https://<server>/o/<org>/<type>/<id>`, that names the organisation, what it is and which one — so every reader's
 * app shows it as a card and opens it in the right organisation, and a browser reaches it through the server's own
 * page for item links. A record item links can't name (an account, a contact), or a share with no organisation,
 * goes as the server's full web address instead. Never a bare path.
 */
export function shareLink(webPath: string, opts: { org: string | null | undefined; origin: string | null | undefined }): string {
  const ref = refOf(webPath);
  const item = ref ? itemOfRef(ref) : null;
  if (item && opts.org) {
    const link = itemWebLink({ org: opts.org, type: item.type, id: item.id }, shareHost(opts.origin));
    if (parseItemLink(link, { hosts: [shareHost(opts.origin)] }).ok) return link;
  }
  const base = (opts.origin && /^https?:\/\//.test(opts.origin) ? opts.origin : `https://${WORKSUITE_WEB_HOSTS[0]}`).replace(/\/+$/, '');
  return `${base}${webPath}`;
}
