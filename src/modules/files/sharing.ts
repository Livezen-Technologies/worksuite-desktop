/**
 * The Share dialog's logic, without React (worksuite-desktop#329): what the one
 * search box lists and in what order, who can be shared with, the permission
 * levels and what each means, General access, and how the dialog's state
 * becomes the requests it sends. The server decides everything; this only
 * shapes what it answers and what is asked of it.
 */
import type { Level } from './api';

export type PType = 'user' | 'group' | 'department' | 'role' | 'organization';

export interface Principal {
  type: PType;
  id: number;
  name: string;
  detail: string | null;
  /** "Person", "Team"… (servers from #329 on). */
  kind?: string;
  /** False for a payroll record with no WorkSuite sign-in (servers from #329 on). */
  can_share?: boolean;
  /** Why it cannot be shared with, in a word or two. */
  why?: string | null;
  /** What it already has here — "Has view through “Web”". */
  has?: string | null;
  members?: number;
}

export interface Results {
  results?: Principal[];
  people?: Principal[];
  teams?: Principal[];
  departments?: Principal[];
  roles?: Principal[];
  companies?: Principal[];
  shareable: boolean;
}

export const KIND: Record<PType, string> = { user: 'Person', group: 'Team', department: 'Department', role: 'Role', organization: 'Company' };

export const NO_SIGN_IN = 'Payroll record · no WorkSuite sign-in';
export const CANT_SHARE = 'Can’t share';

/** Whether an address is one somebody can sign in with: not a reserved `.invalid` placeholder from the payroll import. */
export function signsIn(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase().replace(/\.$/, '');
  return !e.endsWith('.invalid');
}

/** One search result as the dialog shows it: typed, described, and whether it can be picked. */
export interface ShareResult extends Principal {
  kind: string;
  can_share: boolean;
  why: string | null;
  key: string;
}

export const keyOf = (p: Pick<Principal, 'type' | 'id'>) => `${p.type}:${p.id}`;

function shaped(p: Principal): ShareResult {
  const dead = p.type === 'user' && (p.can_share === false || (p.detail != null && p.detail.includes('@') && !signsIn(p.detail)));
  return {
    ...p,
    kind: p.kind ?? KIND[p.type] ?? 'Group',
    can_share: !dead,
    why: dead ? (p.why ?? CANT_SHARE) : null,
    detail: dead && p.detail?.includes('@') ? NO_SIGN_IN : p.detail,
    key: keyOf(p),
  };
}

/**
 * The one list the search box shows: the server's `results` when it sends one,
 * else its five groups flattened (an older server); people first, those who can
 * be shared with ahead of those who cannot; anything already chosen left out.
 */
export function resultsOf(data: Results | undefined, chosen: ReadonlyArray<Pick<Principal, 'type' | 'id'>> = []): ShareResult[] {
  if (!data) return [];
  const taken = new Set(chosen.map(keyOf));
  const raw = data.results ?? [...(data.people ?? []), ...(data.teams ?? []), ...(data.departments ?? []), ...(data.roles ?? []), ...(data.companies ?? [])];
  const all = raw.map(shaped).filter((r) => !taken.has(r.key));
  const rank = (r: ShareResult) => (r.type === 'user' ? (r.can_share ? 0 : 1) : 2);
  // A stable sort: within a rank, the server's order.
  return all.map((r, i) => [r, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
}

/** The next option the arrow keys land on, wrapping; -1 when there is none. Options that can't be shared with are still landed on (and read out), but not added. */
export function nextActive(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/* ---- levels ---------------------------------------------------------- */

export interface LevelOption {
  id: Level;
  label: string;
  help: string;
}

/** Each level with what it means, for a file or a folder. Short labels; the explanation is in the menu, not the button. */
export function levelsFor(type: 'file' | 'folder'): LevelOption[] {
  const folder = type === 'folder';
  return [
    { id: 'view', label: 'Can view', help: folder ? 'Open and download files' : 'Open and download it' },
    { id: 'comment', label: 'Can comment', help: folder ? 'View and add comments' : 'View it and add comments' },
    { id: 'edit', label: 'Can edit', help: folder ? 'Change files and add new ones' : 'Change it and upload new versions' },
    { id: 'full', label: 'Full access', help: 'Edit, share and manage access' },
  ];
}

export const LEVEL_LABEL: Record<Level, string> = { view: 'Can view', comment: 'Can comment', edit: 'Can edit', full: 'Full access' };

/** The levels a server offers (`levels` from #329 on); an older server has no comment level. */
export function offered(type: 'file' | 'folder', server?: string[] | null): LevelOption[] {
  const all = levelsFor(type);
  return server?.length ? all.filter((l) => server.includes(l.id)) : all.filter((l) => l.id !== 'comment');
}

/* ---- sharing ----------------------------------------------------------- */

export interface NotifyState {
  chat: boolean;
  email: boolean;
  message: string;
}

/** One POST to `…/grants` per chosen person or group. Turning both channels off shares quietly. */
export function grantRequests(chosen: ReadonlyArray<Pick<Principal, 'type' | 'id'>>, level: Level, notify: NotifyState) {
  const on = notify.chat || notify.email;
  const message = notify.message.trim().slice(0, 500);
  return chosen.map((p) => ({
    principal_type: p.type,
    principal_id: p.id,
    level,
    can_download: true,
    notify: on,
    ...(on ? { notify_chat: notify.chat, notify_email: notify.email, ...(message ? { message } : {}) } : {}),
  }));
}

const first = (p: Pick<Principal, 'type' | 'name'>) => (p.type === 'user' ? (p.name.split(/\s+/)[0] ?? p.name) : p.name);

/** "Shared with Chamudi, Tender team (can edit) · notified by chat and email". */
export function sharedSummary(chosen: ReadonlyArray<Pick<Principal, 'type' | 'name'>>, level: Level, notify: Pick<NotifyState, 'chat' | 'email'>): string {
  const how = notify.chat && notify.email ? 'notified by chat and email' : notify.chat ? 'notified in chat' : notify.email ? 'notified by email' : 'shared quietly';
  return `Shared with ${chosen.map(first).join(', ')} (${LEVEL_LABEL[level].toLowerCase()}) · ${how}`;
}

/* ---- general access ------------------------------------------------------ */

export type General = 'restricted' | 'org' | 'anyone';

export interface GeneralOption {
  id: General;
  label: string;
  help: string;
  icon: string;
}

export function generalOptions(company: string | null): GeneralOption[] {
  return [
    { id: 'restricted', label: 'Restricted', help: 'Only people and groups added above can open it', icon: 'lock' },
    { id: 'org', label: `Anyone at ${company ?? 'the company'} with the link`, help: 'Signed-in staff of this company can open it', icon: 'building' },
    { id: 'anyone', label: 'Anyone with the link', help: 'No sign-in needed · link can be set to expire', icon: 'globe' },
  ];
}

interface GrantLike {
  id: number;
  principal: { type: PType; id: number };
  level: Level;
  effect: 'allow' | 'deny';
}

/** What General access an item has: the server's `general`, else read off its public links and the rule naming its company. */
export function generalOf(a: {
  general?: { access: General; level: Level | null; grant_id: number | null } | null;
  public_links?: { shares: number } | null;
  grants?: GrantLike[] | null;
  item: { company: { id: number } | null };
}): { access: General; level: Level | null; grantId: number | null } {
  if (a.general) return { access: a.general.access, level: a.general.level, grantId: a.general.grant_id };
  const rule = a.item.company ? (a.grants ?? []).find((g) => g.effect === 'allow' && g.principal.type === 'organization' && g.principal.id === a.item.company!.id) : undefined;
  if (a.public_links?.shares) return { access: 'anyone', level: 'view', grantId: rule?.id ?? null };
  if (rule) return { access: 'org', level: rule.level, grantId: rule.id };
  return { access: 'restricted', level: null, grantId: null };
}

/**
 * What choosing a General access does: `put` it to the server, open the public
 * link dialog (anyone: its expiry and password are chosen there), or nothing
 * (it is already that).
 */
export function generalAction(from: General, to: General, level: Level = 'view'): { kind: 'none' } | { kind: 'link' } | { kind: 'put'; body: { access: 'restricted' | 'org'; level?: Level } } {
  if (from === to) return { kind: 'none' };
  if (to === 'anyone') return { kind: 'link' };
  return { kind: 'put', body: to === 'org' ? { access: 'org', level: level === 'full' ? 'edit' : level } : { access: 'restricted' } };
}
