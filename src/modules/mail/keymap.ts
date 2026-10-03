import { accelerator, DEFAULT_SHORTCUTS } from '../../core/commands';
import { text } from '../../core/i18n';

/**
 * Mail's keyboard schemes (ENH-MAIL-03 DMO-KEY-01/02, §5.4): WorkSuite (the
 * default), Outlook and Gmail. Keys are written the way the shell writes
 * them — "Mod+Shift+R", "Shift+I", "F9", "E" — where Mod is Ctrl, or ⌘ on
 * macOS ("on macOS Ctrl maps to Cmd"). Two-key sequences are written with a
 * space: "G M" is G, then M.
 */

export type Scheme = 'worksuite' | 'outlook' | 'gmail';

export const MAIL_COMMANDS = [
  { id: 'new', label: 'New message' },
  { id: 'reply', label: 'Reply' },
  { id: 'replyAll', label: 'Reply all' },
  { id: 'forward', label: 'Forward' },
  { id: 'delete', label: 'Delete' },
  { id: 'deleteForever', label: 'Permanently delete' },
  { id: 'archive', label: 'Archive' },
  { id: 'spam', label: 'Report junk' },
  { id: 'read', label: 'Mark as read' },
  { id: 'unread', label: 'Mark as unread' },
  { id: 'flag', label: 'Flag / unflag' },
  { id: 'move', label: 'Move to folder' },
  { id: 'goto', label: 'Go to folder' },
  { id: 'search', label: 'Search' },
  { id: 'findInMessage', label: 'Find in message' },
  { id: 'goMail', label: 'Go to Mail' },
  { id: 'goCalendar', label: 'Go to Calendar' },
  { id: 'goPeople', label: 'Go to People' },
  { id: 'goTasks', label: 'Go to Tasks' },
  { id: 'syncAll', label: 'Sync all accounts' },
  { id: 'syncFolder', label: 'Sync this account' },
  { id: 'openWindow', label: 'Open in a new window' },
  { id: 'open', label: 'Open message' },
  { id: 'next', label: 'Next message' },
  { id: 'prev', label: 'Previous message' },
  { id: 'snooze', label: 'Snooze' },
  { id: 'pin', label: 'Pin / unpin' },
  { id: 'selectAll', label: 'Select all' },
  { id: 'commandSearch', label: 'Command search' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `quickStep${i + 1}`, label: `Quick Step ${i + 1}` })),
] as const;

export type MailCommandId = (typeof MAIL_COMMANDS)[number]['id'];

const QUICK = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`quickStep${i + 1}`, [`Mod+Shift+${i + 1}`]]));

/** Each scheme's keys per command; the first is the one the sheet shows. */
export const SCHEMES: Record<Scheme, Partial<Record<MailCommandId, string[]>>> = {
  worksuite: {
    new: ['N', 'C'],
    reply: ['R'],
    replyAll: ['A'],
    forward: ['F'],
    delete: ['#', 'Delete'],
    deleteForever: ['Shift+Delete'],
    archive: ['E'],
    spam: ['!'],
    read: ['Shift+I'],
    unread: ['Shift+U', 'U'],
    flag: ['S'],
    move: ['V'],
    goto: ['G F'],
    search: ['/'],
    findInMessage: ['Mod+F'],
    goMail: ['G M'],
    goCalendar: ['G C'],
    goPeople: ['G P'],
    goTasks: ['G T'],
    syncAll: ['Mod+Shift+R'],
    openWindow: ['Shift+Enter'],
    open: ['Enter', 'O'],
    next: ['J', 'ArrowDown'],
    prev: ['K', 'ArrowUp'],
    snooze: ['B'],
    pin: ['P'],
    selectAll: ['Mod+A'],
    commandSearch: ['Mod+Shift+P'],
    shortcuts: ['?', 'Mod+/'],
    ...QUICK,
  },
  outlook: {
    new: ['Mod+N', 'Mod+Shift+M'],
    reply: ['Mod+R'],
    replyAll: ['Mod+Shift+R'],
    forward: ['Mod+F'],
    delete: ['Delete'],
    deleteForever: ['Shift+Delete'],
    archive: ['Backspace'],
    spam: ['Mod+Alt+J'],
    read: ['Mod+Q'],
    unread: ['Mod+U'],
    flag: ['Insert'],
    move: ['Mod+Shift+V'],
    goto: ['Mod+Y'],
    search: ['Mod+E', 'F3'],
    findInMessage: ['F4'],
    goMail: ['Mod+1'],
    goCalendar: ['Mod+2'],
    goPeople: ['Mod+3'],
    goTasks: ['Mod+4'],
    syncAll: ['F9'],
    syncFolder: ['Shift+F9'],
    openWindow: ['Shift+Enter'],
    open: ['Enter'],
    next: ['Mod+.', 'ArrowDown'],
    prev: ['Mod+,', 'ArrowUp'],
    snooze: ['Mod+Shift+Z'],
    pin: ['Mod+Shift+P'],
    selectAll: ['Mod+A'],
    commandSearch: ['Alt+Q'],
    shortcuts: ['Mod+/'],
    ...QUICK,
  },
  gmail: {
    new: ['C'],
    reply: ['R'],
    replyAll: ['A'],
    forward: ['F'],
    delete: ['#'],
    archive: ['E', 'Y'],
    spam: ['!'],
    read: ['Shift+I'],
    unread: ['Shift+U'],
    flag: ['S'],
    move: ['V'],
    goto: ['G L'],
    search: ['/'],
    goMail: ['G I'],
    goCalendar: ['G C'],
    goPeople: ['G P'],
    goTasks: ['G K'],
    syncAll: ['Mod+Shift+R'],
    openWindow: ['Shift+Enter'],
    open: ['Enter', 'O'],
    next: ['J', 'ArrowDown'],
    prev: ['K', 'ArrowUp'],
    snooze: ['B'],
    pin: ['P'],
    selectAll: ['Mod+A'],
    commandSearch: ['Mod+Shift+P'],
    shortcuts: ['?'],
    ...QUICK,
  },
};

/** The keys in effect: the scheme's, with the person's own rebinding on top (DMO-KEY-02). */
export function bindings(scheme: Scheme | undefined, overrides?: Record<string, string> | null): Record<string, string[]> {
  const base = SCHEMES[scheme ?? 'worksuite'] ?? SCHEMES.worksuite;
  const out: Record<string, string[]> = {};
  for (const c of MAIL_COMMANDS) out[c.id] = [...(base[c.id] ?? [])];
  for (const [id, key] of Object.entries(overrides ?? {})) if (id in out && key) out[id] = [key];
  return out;
}

/** An event as a key: the shell's accelerator, with Shift dropped from symbols typed with it ("#", "?", "!"). */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>, mac?: boolean): string | null {
  const acc = accelerator(e, mac);
  if (!acc) return null;
  const parts = acc.split('+');
  const key = acc.endsWith('++') ? '+' : parts[parts.length - 1]!;
  if (key.length === 1 && !/[A-Z0-9]/.test(key)) return acc.replace(/(^|\+)Shift\+/, '$1');
  return acc;
}

/** The command a key (or a two-key sequence, "G M") runs; `pending` is a waiting first key. */
export function commandFor(map: Record<string, string[]>, key: string, pending: string | null): { id: string | null; pending: string | null } {
  const seq = pending ? `${pending} ${key}` : key;
  for (const [id, keys] of Object.entries(map)) if (keys.includes(seq)) return { id, pending: null };
  // A first key of some sequence: wait for the second.
  if (!pending && Object.values(map).some((keys) => keys.some((k) => k.startsWith(`${key} `)))) return { id: null, pending: key };
  // A sequence that went nowhere: try the key on its own.
  if (pending) return commandFor(map, key, null);
  return { id: null, pending: null };
}

/** Keys bound to more than one command here, or taken by the app's own shortcuts (DMO-KEY-02). */
export function keyConflicts(map: Record<string, string[]>, shell: Record<string, string> = DEFAULT_SHORTCUTS): Array<{ key: string; commands: string[]; shell: string | null }> {
  const by = new Map<string, string[]>();
  for (const [id, keys] of Object.entries(map)) for (const k of keys) by.set(k, [...(by.get(k) ?? []), id]);
  const shellBy = new Map(Object.entries(shell).map(([id, k]) => [k, id] as const));
  const out: Array<{ key: string; commands: string[]; shell: string | null }> = [];
  for (const [key, ids] of by) {
    const s = shellBy.get(key) ?? null;
    // Command search IS the app's command palette: sharing its key is the point, not a clash.
    const clashShell = !!s && !ids.includes('commandSearch');
    if (ids.length > 1 || clashShell) out.push({ key, commands: ids, shell: clashShell ? s : null });
  }
  return out;
}

/** "Ctrl+Shift+R", or "⌘⇧R" on macOS. */
export function keyLabel(key: string, mac: boolean): string {
  if (!mac) return key.replace(/Mod/g, 'Ctrl').replace(/ /g, text(' then '));
  return key
    .replace(/Mod\+/g, '⌘')
    .replace(/Shift\+/g, '⇧')
    .replace(/Alt\+/g, '⌥')
    .replace(/Ctrl\+/g, '⌃')
    .replace(/ /g, text(' then '));
}

/** Is this key a plain letter or symbol, which must not fire while typing? */
export function isPlain(key: string): boolean {
  return !/(^|\+)(Mod|Ctrl|Alt)\+/.test(key) && !/^F\d+$/.test(key) && !key.startsWith('Shift+F');
}
