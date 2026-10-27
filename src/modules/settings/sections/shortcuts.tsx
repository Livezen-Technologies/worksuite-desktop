import type { Preferences } from '@shared/types';
import { useLauncherPrefs, updateLauncherPrefs } from '../../../core/launcher-prefs';
import { effectiveShortcuts, conflicts, shortcutMeta, prettyAccelerator, DEFAULT_SHORTCUTS, accelerator } from '../../../core/commands';
import { useState } from 'react';
import { useCanOpen } from '../../../core/access';
import { Button, cx } from '../../../components/ui';
import { updatePrefs } from '../../../core/app-state';
import { ShortcutRecorder } from '../LauncherSettings';
import { DEFAULT_LAUNCHER_SHORTCUT } from '@shared/launcher';
import { Row } from './parts';

/** Settings › Keyboard shortcuts. */

const SHORTCUT_LABELS: Record<string, string> = {
  search: 'Search',
  palette: 'Command palette',
  new: 'New (in this app)',
  'new-tab': 'New tab',
  'close-tab': 'Close tab',
  'restore-tab': 'Reopen closed tab',
  'next-tab': 'Next tab',
  'prev-tab': 'Previous tab',
  'support-copy-link': 'Support: copy the ticket’s link',
  settings: 'Settings',
  ai: 'AI Assistant',
  'switch-org': 'Switch organization',
  'marketing-claim-next': 'Marketing: claim the next contact',
  launcher: 'App launcher',
  lock: 'Lock WorkSuite',
  help: 'Help & Diagnostics',
  'pdf-open': 'PDF Studio: open a PDF',
  'pdf-save': 'PDF Studio: save',
  'pdf-print': 'PDF Studio: print',
  'pdf-find': 'PDF Studio: find',
  'pdf-find-advanced': 'PDF Studio: search comments and bookmarks too',
  'pdf-zoom-in': 'PDF Studio: zoom in',
  'pdf-zoom-out': 'PDF Studio: zoom out',
  'pdf-hand': 'PDF Studio: hand tool',
  'pdf-select': 'PDF Studio: select tool',
  // Meet (WS-MEET-ENH-01 D06). Mute and the camera are held for the whole
  // computer while a call is live, so they work from whatever you are
  // presenting; the rest are answered while WorkSuite is in front.
  'meet-mute': 'Toggle microphone',
  'meet-camera': 'Toggle camera',
  'meet-new': 'Start instant meeting',
  'meet-join-next': 'Join next meeting',
  'meet-share-screen': 'Share screen',
  'meet-raise-hand': 'Raise or lower hand',
  'meet-pop-out': 'Float the call over other apps',
  'meet-action-item': 'Add action item',
  'meet-decision': 'Add decision',
  // Held, not pressed: the only key here that does something for as long as it
  // is down. The label says so, because "Push to talk" alone reads like a
  // switch and people press it once and wonder why nothing stayed on.
  'meet-push-to-talk': 'Push to talk (hold)',
};

/** Rows shown but not changed here: the emergency stop is the remote-control service's. */
const SHORTCUT_FIXED: Record<string, { accelerator: string; note: string }> = {
  'rc-emergency-stop': {
    // Ctrl+Alt+Shift+Esc, with Command standing in for Ctrl on a Mac
    // (shared/remote-control/channel.ts). It can be changed but never removed,
    // and somebody controlling this computer cannot press it.
    accelerator: 'Mod+Alt+Shift+Escape',
    note: 'Always on. Changed in Settings › Remote control; it cannot be removed, and whoever is controlling this computer cannot press it.',
  },
};

/**
 * Settings › Keyboard shortcuts (WS-MEET-ENH-01 D06).
 *
 * The artboard's table: Area, Action, Shortcut, Scope, and a Change for each.
 * Grouped by area because a flat list of forty keys is a list nobody reads,
 * searchable for the same reason, and with one Reset to defaults beside the
 * per-row ones.
 *
 * A clash is shown rather than resolved quietly: four of Meet's keys were
 * moved off the design's because the shell already used them, and anybody who
 * would rather have it the other way round can swap the two here.
 */
export function Shortcuts({ prefs }: { prefs: Preferences }) {
  const launcher = useLauncherPrefs();
  const map: Record<string, string> = { ...effectiveShortcuts(prefs.shortcuts), launcher: launcher.shortcut };
  const clashes = conflicts(map);
  const [recording, setRecording] = useState<string | null>(null);
  const [find, setFind] = useState('');
  // The AI Assistant's shortcut only for whoever has the AI app; Marketing's Next contact only for whoever has Marketing;
  // Meet's keys only for whoever has Meet.
  const hasAi = useCanOpen('ai');
  const hasMarketing = useCanOpen('marketing');
  const hasMeet = useCanOpen('meet');
  const mine = (id: string): boolean =>
    (id !== 'ai' || hasAi) && (id !== 'marketing-claim-next' || hasMarketing) && (!id.startsWith('meet-') || hasMeet) && (!id.startsWith('rc-') || hasMeet);
  const q = find.trim().toLowerCase();
  const ids = [...Object.keys(SHORTCUT_LABELS), ...Object.keys(SHORTCUT_FIXED)].filter(
    (id) => mine(id) && (q === '' || SHORTCUT_LABELS[id]?.toLowerCase().includes(q) || shortcutMeta(id).area.toLowerCase().includes(q) || prettyAccelerator(map[id] ?? SHORTCUT_FIXED[id]?.accelerator ?? '').toLowerCase().includes(q)),
  );
  // Grouped by area, in the order the areas first appear.
  const areas: string[] = [];
  const byArea = new Map<string, string[]>();

  for (const id of ids) {
    const { area } = shortcutMeta(id);

    if (!byArea.has(area)) {
      areas.push(area);
      byArea.set(area, []);
    }
    byArea.get(area)!.push(id);
  }

  const changed = Object.keys(prefs.shortcuts ?? {}).filter((id) => prefs.shortcuts[id] !== DEFAULT_SHORTCUTS[id]);

  return (
    <div className="mt-8">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="text-[16px] font-bold text-ink">Keyboard shortcuts</h3>
        <span className="text-[12.5px] text-ink-3">Global shortcuts work even when WorkSuite is in the background</span>
        <span className="flex-1" />
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          className="w-[180px] rounded-[7px] border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
        />
        {changed.length ? (
          <Button size="sm" variant="ghost" onClick={() => void updatePrefs({ shortcuts: {} })}>
            Reset to defaults
          </Button>
        ) : null}
      </div>
      {clashes.length ? (
        <div className="mb-2 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          {clashes.map((c) => `${prettyAccelerator(c.accelerator)} is used by ${c.commands.map((id) => SHORTCUT_LABELS[id] ?? id).join(' and ')}`).join('. ')}. The shell command wins, and the other key does nothing until one of them is changed.
        </div>
      ) : null}
      {ids.length === 0 ? <div className="py-6 text-center text-[13px] text-ink-3">No shortcut matches “{find.trim()}”.</div> : null}
      {areas.map((area) => (
        <div key={area} className="mt-4">
          <div className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">{area}</div>
          {byArea.get(area)!.map((id) => {
            const fixed = SHORTCUT_FIXED[id];
            const { scope } = shortcutMeta(id);
            const scopeChip = (
              <span className={cx('rounded-[5px] px-1.5 py-px text-[11px] font-semibold', scope === 'global' ? 'bg-selection text-primary' : 'bg-surface-2 text-ink-3')}>
                {scope === 'global' ? 'Global' : 'In app'}
              </span>
            );

            if (fixed) {
              return (
                <Row key={id} label="Emergency stop" hint={fixed.note}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[110px] rounded-[7px] border border-line px-2.5 py-1 font-mono text-[12.5px] text-ink-2">{prettyAccelerator(fixed.accelerator)}</span>
                    {scopeChip}
                  </div>
                </Row>
              );
            }

            return id === 'launcher' ? (
              // Kept with the launcher's own preferences, synced to the person's devices, and checked against ⌘K.
              <Row key={id} label={SHORTCUT_LABELS[id]!}>
                <div className="flex items-center gap-2">
                  <ShortcutRecorder value={launcher.shortcut} onChange={(acc) => updateLauncherPrefs((p) => ({ ...p, shortcut: acc }))} />
                  {scopeChip}
                  {launcher.shortcut !== DEFAULT_LAUNCHER_SHORTCUT ? (
                    <Button size="sm" variant="ghost" onClick={() => updateLauncherPrefs((p) => ({ ...p, shortcut: DEFAULT_LAUNCHER_SHORTCUT }))}>
                      Reset
                    </Button>
                  ) : null}
                </div>
              </Row>
            ) : (
              <Row key={id} label={SHORTCUT_LABELS[id]!}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onKeyDown={(e) => {
                      if (recording !== id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.key === 'Escape') return setRecording(null);
                      const acc = accelerator(e.nativeEvent);
                      if (!acc) return;
                      void updatePrefs({ shortcuts: { ...prefs.shortcuts, [id]: acc } });
                      setRecording(null);
                    }}
                    onClick={() => setRecording(id)}
                    aria-label={`Change the shortcut for ${SHORTCUT_LABELS[id]}`}
                    className={cx('min-w-[110px] rounded-[7px] border px-2.5 py-1 font-mono text-[12.5px]', recording === id ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}
                  >
                    {recording === id ? 'Press keys…' : prettyAccelerator(map[id] ?? '')}
                  </button>
                  {scopeChip}
                  {prefs.shortcuts[id] && prefs.shortcuts[id] !== DEFAULT_SHORTCUTS[id] ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const next = { ...prefs.shortcuts };
                        delete next[id];
                        void updatePrefs({ shortcuts: next });
                      }}
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
              </Row>
            );
          })}
        </div>
      ))}
      <div className="mt-3 text-[12px] text-ink-3">
        If another app already holds a global key, WorkSuite does without it and takes it back when that app lets go. Nothing is silently reassigned.
      </div>
    </div>
  );
}
