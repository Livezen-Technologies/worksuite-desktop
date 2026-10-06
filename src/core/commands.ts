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
  /** The key to show beside it when the shell does not own its shortcut (a module's own keymap). */
  hint?: string;
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
  // ⌘J / Ctrl+J opens or minimises the assistant too (worksuite-desktop#153); inside the mail editor it is Write with AI.
  'ai-alt': 'Mod+J',
  'switch-org': 'Mod+Shift+O',
  // Marketing's Next contact inside WorkSuite (MKT-DSK-01). From other apps it is ⌘⇧N / Ctrl+Shift+N, held by the main
  // process only while WorkSuite is not in front: in here those keys are Move tab to new window.
  'marketing-claim-next': isMac ? 'Mod+Ctrl+N' : 'Mod+Alt+N',
  // The app launcher (worksuite-desktop#201); the person's own choice is kept with the launcher's preferences.
  launcher: 'Mod+Shift+K',
  lock: 'Mod+L',
  help: 'F1',
  // PDF Studio (PDF Studio SRS §4.3), answered only while a PDF Studio tab is in front.
  'pdf-open': 'Mod+O',
  'pdf-save': 'Mod+S',
  'pdf-undo': 'Mod+Z',
  'pdf-redo': 'Mod+Shift+Z',
  'pdf-redo-alt': 'Mod+Y',
  'pdf-print': 'Mod+P',
  'pdf-find': 'Mod+F',
  'pdf-find-advanced': 'Mod+Shift+F',
  'pdf-zoom-in': 'Mod+=',
  'pdf-zoom-in-alt': 'Mod+Shift++',
  'pdf-zoom-in-pad': 'Mod++',
  'pdf-zoom-out': 'Mod+-',
  'pdf-hand': 'H',
  'pdf-select': 'V',
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
