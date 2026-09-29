import { isMac } from './bridge';

/**
 * CoreKeyboardShortcutRegistry and the command palette's command list
 * (§4.5, §4.6, FR-SRCH-03/04).
 *
 * Commands are registered by the shell and by modules. Each may have a
 * default shortcut; the user can remap any of them in Settings, and conflicts
 * are detected — the shell's command wins a conflict with a module's.
 */
export interface Command {
  id: string;
  label: string;
  group: 'Shell' | 'Create' | 'Navigate' | 'Module';
  keywords?: string;
  run: () => void;
  /** Whether the command is available now (its app is the person's, say). Unavailable, it is neither listed nor run. */
  when?: () => boolean;
  /** Kept out of the palette; still runs from its shortcut. */
  hidden?: boolean;
  source?: 'shell' | 'module';
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  search: 'Mod+K',
  palette: 'Mod+Shift+P',
  new: 'Mod+N',
  'new-tab': 'Mod+T',
  'close-tab': 'Mod+W',
  'restore-tab': 'Mod+Shift+T',
  'move-tab-to-window': 'Mod+Shift+N',
  'dock-tab-beside': 'Mod+Shift+D',
  settings: 'Mod+,',
  ai: 'Mod+Shift+A',
  'switch-org': 'Mod+Shift+O',
  lock: 'Mod+L',
  help: 'F1',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tab-${i + 1}`, `Mod+${i + 1}`])),
  // Organisations: 0 is All organizations, 1–9 the list in order. Control on
  // macOS, where ⌘1–9 are the tabs; Ctrl+Alt elsewhere, where Ctrl is.
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`org-${i}`, isMac ? `Ctrl+${i}` : `Mod+Alt+${i}`])),
};

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();

export function registerCommand(c: Command): () => void {
  commands.set(c.id, { source: 'shell', ...c });
  for (const fn of listeners) fn();
  return () => {
    commands.delete(c.id);
    for (const fn of listeners) fn();
  };
}

const available = (c: Command): boolean => !c.when || c.when();

export function allCommands(): Command[] {
  return [...commands.values()].filter((c) => !c.hidden && available(c));
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

/**
 * Runs a command from a shortcut or the application menu — only while it is
 * available: a shortcut must not open what the palette would not list.
 * Returns whether it ran.
 */
export function runCommand(id: string): boolean {
  const c = commands.get(id);
  if (!c || !available(c)) return false;
  c.run();
  return true;
}

export function onCommandsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Normalises a key event to "Mod+Shift+K" form; Mod is Cmd on macOS, Ctrl elsewhere. */
export function accelerator(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>, mac = isMac): string | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(key)) return null;
  // Shift+digit gives "!" etc.; use the physical digit.
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

export function effectiveShortcuts(overrides: Record<string, string> | undefined): Record<string, string> {
  return { ...DEFAULT_SHORTCUTS, ...(overrides ?? {}) };
}

/** Accelerators bound to more than one command. */
export function conflicts(map: Record<string, string>): Array<{ accelerator: string; commands: string[] }> {
  const by = new Map<string, string[]>();
  for (const [id, acc] of Object.entries(map)) {
    if (!acc) continue;
    by.set(acc, [...(by.get(acc) ?? []), id]);
  }
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([accelerator, ids]) => ({ accelerator, commands: ids }));
}

export function commandForAccelerator(map: Record<string, string>, acc: string): string | null {
  const ids = Object.entries(map)
    .filter(([, a]) => a === acc)
    .map(([id]) => id);
  if (ids.length === 0) return null;
  // The shell wins a conflict.
  return ids.find((id) => (commands.get(id)?.source ?? 'shell') === 'shell') ?? ids[0]!;
}

export function prettyAccelerator(acc: string, mac = isMac): string {
  return acc
    .split('+')
    .map((p) => (p === 'Mod' ? (mac ? '⌘' : 'Ctrl') : p === 'Shift' ? (mac ? '⇧' : 'Shift') : p === 'Alt' ? (mac ? '⌥' : 'Alt') : p === 'Ctrl' ? '⌃' : p))
    .join(mac ? '' : '+');
}
