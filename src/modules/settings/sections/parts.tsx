import { useStore } from '../../../core/store';
import { app, isLocked, updatePrefs } from '../../../core/app-state';
import { SectionHeader, SettingRow } from '../../../components/SettingsKit';
import type { ReactNode } from 'react';
import type { Preferences } from '@shared/types';
import { useDesktopSettings, setDesktopSettings } from '../../../core/desktop-settings';
import { syncedPrefOf } from '@shared/desktop-settings';
import { Switch } from '../../../components/ui';

/** The pieces every Settings section draws with: a section title, a row, a synced preference's reset and a switch row. */

/** Whether this person may set the organisation's website chat ringing (the Chat module's `chat.widget.manage`). */
export const useManagesRinging = () => useStore(app, (s) => !!s.bootstrap?.permissions?.some((p) => p === '*' || p === 'chat.widget.manage'));

/** A section's title (the Settings kit's header). */
export function H({ title, hint }: { title: string; hint?: string }) {
  return <SectionHeader title={title} hint={hint} />;
}

/** One setting (the Settings kit's row): label, description, control; locked with the organisation's reason. */
export function Row({ label, hint, children, lock, onReset }: { label: string; hint?: ReactNode; children: ReactNode; lock?: { reason: string }; onReset?: (() => void) | null }) {
  return (
    <SettingRow label={label} hint={hint} lock={lock} onReset={onReset}>
      {children}
    </SettingRow>
  );
}

/**
 * Reset to default for a preference that syncs (`prefs.<name>`): offered while the person's own choice differs from
 * the default, and never for a key the organisation manages.
 */
function usePrefReset(k: keyof Preferences, _current?: unknown): (() => void) | null {
  const ds = useDesktopSettings();
  const p = syncedPrefOf(k);
  const e = p ? ds.effective[p.key] : undefined;
  // Offered while the value is the person's own synced choice; back to the organisation's default or the catalogue's.
  if (!p || !e || e.locked || e.source !== 'user') return null;
  return () => void setDesktopSettings({ [p.key]: null });
}

export function Toggle({ k, prefs, label, hint, disabled }: { k: keyof Preferences; prefs: Preferences; label: string; hint?: string; disabled?: boolean }) {
  const lock = isLocked(k);
  const onReset = usePrefReset(k, prefs[k]);
  return (
    <Row label={label} hint={hint} lock={lock} onReset={onReset}>
      <Switch label={label} checked={Boolean(prefs[k])} disabled={disabled || !!lock} onChange={(v) => void updatePrefs({ [k]: v } as Partial<Preferences>)} />
    </Row>
  );
}
