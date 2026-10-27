import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { SinhalaSettingsPatch, SinhalaUserSettings } from '@shared/sinhala';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { accelerator, prettyAccelerator } from '../../core/commands';
import { LANGUAGES } from '../../core/i18n';
import { queryClient } from '../../core/query';
import { SINHALA_KEY, useSinhalaProfiles, useSinhalaStatus } from '../../core/sinhala';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { SectionHeader, SettingRow } from '../../components/SettingsKit';
import { Button, Chip } from '../../components/ui';

/**
 * Settings › Language & Sinhala (Sinhala Tools blueprint §6.1 Settings): the interface language, and — while the
 * organisation has Sinhala Tools — the default profile, what a paste of legacy text does, the clipboard key, the
 * organisation's fonts on this computer and the profiles in use. What the organisation fixed is shown locked.
 */

/** Electron's form of a key the recorder heard ("Mod+Shift+U" → "CommandOrControl+Shift+U"), or null. */
export function electronAccelerator(acc: string | null): string | null {
  if (!acc) return null;
  const out = acc.replace(/^Mod\+/, 'CommandOrControl+').replace(/\+Ctrl\+/, '+Control+');
  return /^(?:(?:CommandOrControl|Control|Alt|Shift)\+){1,3}[A-Z0-9]$/.test(out) && /(CommandOrControl|Control|Alt)\+/.test(out) ? out : null;
}

const shown = (acc: string) => prettyAccelerator(acc.replace(/^(CommandOrControl|CmdOrCtrl)\+/, 'Mod+'));

/** A row of the Settings kit; `locked`: the organisation sets it (its badge, with why). */
function Row({ label, hint, locked, children }: { label: string; hint?: ReactNode; locked?: boolean; children: ReactNode }) {
  return (
    <SettingRow label={label} hint={hint} lock={locked ? { reason: 'Your organization sets this for everyone.' } : null}>
      {children}
    </SettingRow>
  );
}

export function SinhalaSettings() {
  const prefs = useStore(app, (s) => s.prefs)!;
  const status = useSinhalaStatus();
  const on = status.data?.availability === 'ok';
  return (
    <div>
      <SectionHeader title="Language & Sinhala" hint="The interface language, and Sinhala Tools on this computer." />
      <Row label="Language" hint="Choose your interface language. Some screens still use English.">
        <Select label="Language" value={prefs.language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onValueChange={(v) => void updatePrefs({ language: v })} />
      </Row>
      <Row label="Typing Sinhala" hint="Use your system's Sinhala keyboard (Wijesekara or phonetic on Windows, Sinhala on macOS, ibus or fcitx m17n on Linux). WorkSuite never reads your keystrokes." >
        <span />
      </Row>
      {on ? <SinhalaTools /> : <p className="mt-4 text-[13px] text-ink-3">Sinhala Tools are not available for your organization.</p>}
    </div>
  );
}

function SinhalaTools() {
  const status = useSinhalaStatus();
  const profiles = useSinhalaProfiles();
  const st = status.data!;
  const locked = (k: keyof SinhalaUserSettings) => st.org.locked.includes(k);
  const set = useMutation({
    mutationFn: (patch: SinhalaSettingsPatch) => call('sinhala:settingsSet', patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SINHALA_KEY }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const [recording, setRecording] = useState(false);
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const fonts = useQuery({ queryKey: [...SINHALA_KEY, 'fonts'], queryFn: () => call('sinhala:fontsStatus'), staleTime: 60_000 });
  const install = useMutation({
    mutationFn: () => call('sinhala:fontsInstall', null),
    onSuccess: (r) => queryClient.setQueryData([...SINHALA_KEY, 'fonts'], r),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const refresh = useMutation({
    mutationFn: () => call('sinhala:profiles', { refresh: true }),
    onSuccess: (r) => queryClient.setQueryData([...SINHALA_KEY, 'profiles'], r),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const profileOptions = [{ value: 'auto', label: 'Detect automatically' }, ...(profiles.data?.profiles ?? []).map((p) => ({ value: p.id, label: p.name }))];
  const missing = (fonts.data?.families ?? []).filter((f) => f.distributable && !f.installed);

  return (
    <>
      <h3 className="mt-8 mb-1 text-[16px] font-bold text-ink">Sinhala Tools</h3>
      <Row label="Default font profile" hint="Used when the text does not say which legacy font it was typed in." locked={locked('defaultProfile')}>
        <Select label="Default font profile" value={st.user.defaultProfile} disabled={locked('defaultProfile')} options={profileOptions} onValueChange={(v) => set.mutate({ defaultProfile: v })} />
      </Row>
      <Row label="Legacy text on paste" hint="What a WorkSuite editor does when pasted text looks like a legacy font." locked={locked('autoDetectOnPaste')}>
        <Select
          label="Legacy text on paste"
          value={st.user.autoDetectOnPaste}
          disabled={locked('autoDetectOnPaste')}
          options={[
            { value: 'prompt', label: 'Ask me' },
            { value: 'auto', label: 'Convert to Unicode' },
            { value: 'off', label: 'Leave it as it is' },
          ]}
          onValueChange={(v) => set.mutate({ autoDetectOnPaste: v as SinhalaUserSettings['autoDetectOnPaste'] })}
        />
      </Row>
      <Row
        label="Convert clipboard shortcut"
        hint={keyProblem ?? (st.user.shortcut && !st.shortcutHeld ? 'Another app is using this key. The tray menu still converts the clipboard.' : 'Converts copied legacy text to Unicode from any app, and puts it back on the clipboard.')}
        locked={locked('shortcut')}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Convert clipboard shortcut"
            disabled={locked('shortcut')}
            onClick={() => {
              setRecording(true);
              setKeyProblem(null);
            }}
            onBlur={() => setRecording(false)}
            onKeyDown={(e) => {
              if (!recording) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'Escape') return setRecording(false);
              const heard = accelerator(e.nativeEvent);
              if (!heard) return;
              setRecording(false);
              const acc = electronAccelerator(heard);
              if (!acc) return setKeyProblem('Use a letter or digit with ⌘ or Ctrl, or Alt.');
              set.mutate({ shortcut: acc });
            }}
            className="h-8 min-w-[120px] rounded-[8px] border border-line bg-ground px-3 text-[13px] text-ink"
          >
            {recording ? 'Press the keys…' : st.user.shortcut ? shown(st.user.shortcut) : 'None'}
          </button>
          {st.user.shortcut && !locked('shortcut') ? (
            <Button size="sm" onClick={() => set.mutate({ shortcut: null })}>
              Turn off
            </Button>
          ) : null}
        </div>
      </Row>
      <Row label="Sinhala fonts on this computer" hint={st.org.installFonts === 'never' ? 'Your organization does not install fonts on devices.' : missing.length ? 'Your organization’s Sinhala fonts, installed for you only.' : 'All of your organization’s fonts are installed.'}>
        {st.org.installFonts !== 'never' && missing.length ? (
          <Button size="sm" icon="download" loading={install.isPending} onClick={() => install.mutate()}>
            Install fonts
          </Button>
        ) : (
          <span />
        )}
      </Row>
      <Row label="Font profiles" hint={profiles.data?.syncedAt ? 'Checked against their fingerprints before use; kept on this computer for offline use.' : 'The profiles built into WorkSuite, until WorkSuite sends your organization’s.'}>
        <Button size="sm" icon="refresh" loading={refresh.isPending} onClick={() => refresh.mutate()}>
          Refresh
        </Button>
      </Row>
      <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-ink-2">
        {(profiles.data?.profiles ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{p.name}</span>
            <span>{p.version}</span>
            {p.status === 'provisional' ? <Chip tone="warning">Provisional</Chip> : null}
            {p.signed ? <Chip tone="success">Signed</Chip> : null}
            {p.source === 'builtin' ? <Chip>Built in</Chip> : null}
          </li>
        ))}
        {(profiles.data?.rejected ?? []).map((r) => (
          <li key={`${r.id}-${r.version}`} className="text-danger">
            {r.id} {r.version} — refused: {r.reason}
          </li>
        ))}
      </ul>
    </>
  );
}
