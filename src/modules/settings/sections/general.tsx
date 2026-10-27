import { useTab } from '../../../core/tab-context';
import { useStore } from '../../../core/store';
import { app, updatePrefs } from '../../../core/app-state';
import { useGuest } from '../../../core/session';
import { Select } from '../../../components/Select';
import { LANGUAGES } from '../../../core/i18n';
import { currentZone } from '../../../core/time';
import { Chip, Button } from '../../../components/ui';
import type { Preferences } from '@shared/types';
import { ColorProfiles } from '../Appearance';
import { call } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { useOrgPrefs, setOrgSelectionShared } from '../../../core/org-prefs';
import { Row, H, Toggle } from './parts';
import { Shortcuts } from './shortcuts';

/** Settings › General and Preferences, and the organisation filter. */

export function General() {
  const { navigate } = useTab();
  const b = useStore(app, (s) => s.bootstrap);
  const server = useStore(app, (s) => s.auth?.server);
  const prefs = useStore(app, (s) => s.prefs)!;
  const guest = useGuest();
  const language = (
    <Row label="Language" hint="Choose your interface language. Some screens still use English.">
      <Select label="Language" value={prefs.language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onValueChange={(v) => void updatePrefs({ language: v })} />
    </Row>
  );
  // A guest has no WorkSuite profile, server or organizations: this computer's clock and language only.
  if (guest)
    return (
      <>
        <H title="General" />
        {language}
        <Row label="Time zone" hint="This computer's time zone.">
          <span className="font-mono text-[13px] text-ink-2">{currentZone()}</span>
        </Row>
      </>
    );
  return (
    <>
      <H title="General" />
      {language}
      <Row label="Time zone" hint="From your WorkSuite profile, then your organization, then this computer. Changed in My account › Preferences.">
        <button type="button" className="font-mono text-[13px] text-primary hover:underline" onClick={() => navigate('/account/preferences')}>
          {currentZone()}
        </button>
      </Row>
      <Row label="WorkSuite server" hint={server?.api === 'desktop-v1' ? 'Desktop API' : 'WorkSuite API'}>
        <span className="font-mono text-[13px] text-ink-2">{server ? new URL(server.origin).host : '—'}</span>
      </Row>
      <Row label="Organizations" hint={b?.organizations.length ? `You belong to ${b.organizations.length}.` : undefined}>
        {b?.organizations.length ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {b.organizations.map((o) => (
              <Chip key={o.id} tone="muted">
                {o.name}
              </Chip>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-ink-2">—</span>
        )}
      </Row>
    </>
  );
}

export function PreferencesSection({ prefs }: { prefs: Preferences }) {
  // Downloads are Files', which a guest does not have (#149).
  const guest = useGuest();
  return (
    <>
      <H title="Preferences" hint="How WorkSuite looks and behaves on this computer. How it starts is in Desktop & startup." />
      <Row label="Theme">
        <Select label="Theme" value={prefs.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onValueChange={(v) => void updatePrefs({ theme: v })} />
      </Row>
      <Toggle k="highContrast" prefs={prefs} label="High contrast" />
      <ColorProfiles prefs={prefs} />
      <Row label="Density">
        <Select label="Density" value={prefs.density} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onValueChange={(v) => void updatePrefs({ density: v })} />
      </Row>
      <Row label="Sidebar">
        <Select label="Sidebar" value={prefs.sidebarMode} options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }, { value: 'auto-hide', label: 'Auto-hide' }]} onValueChange={(v) => void updatePrefs({ sidebarMode: v })} />
      </Row>
      {guest ? null : (
        <>
          <Row label="Open downloaded files" hint="When a file is double-clicked in Files.">
            <Select label="Open downloaded files" value={prefs.openFilesLocally} options={[{ value: 'ask', label: 'Ask' }, { value: 'always', label: 'Open locally' }, { value: 'never', label: 'Download only' }]} onValueChange={(v) => void updatePrefs({ openFilesLocally: v })} />
          </Row>
          <Row label="Download folder" hint={<span className="font-mono">{prefs.downloadFolder}</span>}>
            <Button onClick={() => void call('files:chooseDownloadFolder').then((p) => p && toast('success', 'Download folder changed.'))}>Change…</Button>
          </Row>
          <OrgFilterSetting />
        </>
      )}
      <Toggle k="notificationSounds" prefs={prefs} label="Sounds" />
      <Toggle k="hardwareAcceleration" prefs={prefs} label="Hardware acceleration" hint="Turn off if the window flickers or draws badly. Takes effect after a restart." />
      <Toggle k="spellcheck" prefs={{ ...prefs, spellcheck: prefs.spellcheck !== false }} label="Check spelling as you type" />
      <Shortcuts prefs={prefs} />
    </>
  );
}

/**
 * The organisation filter (worksuite-desktop#214): one selection that every app follows — choose CreativeFX on Home
 * and Expenses opens on it — or each app keeping its own. Synced with the person's other preferences.
 */
export function OrgFilterSetting() {
  const orgPrefs = useOrgPrefs();
  return (
    <Row label="Organisation filter" hint="Which organisations Home and the apps show.">
      <Select
        label="Organisation filter"
        value={orgPrefs.shared ? 'shared' : 'apart'}
        options={[
          { value: 'shared', label: 'Same in every app' },
          { value: 'apart', label: 'Separate in each app' },
        ]}
        onValueChange={(v) => setOrgSelectionShared(v === 'shared')}
      />
    </Row>
  );
}
