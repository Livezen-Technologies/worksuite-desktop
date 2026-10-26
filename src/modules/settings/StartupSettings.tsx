import { useState } from 'react';
import { navApps } from '@shared/apps';
import { parseStartup, STARTUP_KEY, startupOptions, type StartupChoice } from '@shared/desktop-settings';
import { app } from '../../core/app-state';
import { setDesktopSettings, useDesktopSettings } from '../../core/desktop-settings';
import { appLabel } from '../../core/i18n';
import { useStore } from '../../core/store';
import { Select } from '../../components/Select';
import { Button } from '../../components/ui';
import { RadioCards, SettingRow, SettingsGroup, SourceNote, type RadioCardOption } from './kit';

/**
 * Settings › Desktop & startup › Open at startup (desktop settings `startup.screen`): Home, where I left off, an app,
 * or a page. The organisation may set it — as a default the person can change, or managed and locked. Applied when
 * WorkSuite starts (core/startup.ts); an app turned off or no longer given opens Home instead.
 */
type Kind = StartupChoice['kind'];

const KINDS: ReadonlyArray<RadioCardOption<Kind>> = [
  { value: 'home', label: 'Home', description: 'Your day at a glance.', icon: 'home' },
  { value: 'last', label: 'Where I left off', description: 'The tab you were on, with your tabs.', icon: 'history' },
  { value: 'app', label: 'An app', description: 'Always open the same app.', icon: 'grid' },
  { value: 'route', label: 'A page', description: 'A WorkSuite address, e.g. /mail.', icon: 'route' },
];

export function StartupSettings() {
  const ds = useDesktopSettings();
  const apps = useStore(app, (s) => s.apps);
  const restoreTabs = useStore(app, (s) => s.prefs?.restoreTabs !== false);
  const e = ds.effective[STARTUP_KEY];
  const value = typeof e?.value === 'string' ? e.value : 'last';
  const choice = parseStartup(value) ?? { kind: 'home' };
  const locked = !!e?.locked;
  const appChoices = startupOptions(navApps(apps)).filter((o) => o.value.startsWith('app:')).map((o) => ({ ...o, label: appLabel(apps.find((a) => `app:${a.id}` === o.value) ?? { id: o.value.slice(4), label: o.label }) }));
  const routePath = choice.kind === 'route' ? choice.path : '';
  // What is typed, until it is saved; the saved page otherwise.
  const [typed, setPath] = useState<string | null>(null);
  const path = typed ?? routePath;
  const [routeDraft, setRouteDraft] = useState(false);
  const pathOk = path.trim() === '' || parseStartup(`route:${path.trim()}`) !== null;

  const choose = (kind: Kind) => {
    if (kind === 'home') void setDesktopSettings({ [STARTUP_KEY]: 'home' });
    else if (kind === 'last') void setDesktopSettings({ [STARTUP_KEY]: 'last' });
    else if (kind === 'app') {
      const first = choice.kind === 'app' ? `app:${choice.appId}` : appChoices[0]?.value;
      if (first) void setDesktopSettings({ [STARTUP_KEY]: first });
    } else if (path.trim() && pathOk) void setDesktopSettings({ [STARTUP_KEY]: `route:${path.trim()}` });
    else setRouteDraft(true);
  };
  const shownKind: Kind = routeDraft && !locked ? 'route' : choice.kind;

  const lock = locked ? { reason: 'Your organization chooses what WorkSuite opens on.' } : null;
  const note = e?.source === 'policy' && !locked ? <SourceNote>Your organization’s default</SourceNote> : null;
  return (
    <SettingsGroup title="Open at startup" description="What WorkSuite shows when it starts.">
      <SettingRow
        label="Startup screen"
        hint={shownKind === 'last' && !restoreTabs ? 'Reopen my tabs is off, so WorkSuite starts on Home.' : undefined}
        lock={lock}
        badge={note}
        keywords="startup launch open first page home last app"
        onReset={e?.source === 'user' ? () => void setDesktopSettings({ [STARTUP_KEY]: null }).then(() => setRouteDraft(false)) : null}
        stacked
      >
        <RadioCards label="Startup screen" value={shownKind} options={KINDS} onChange={(k) => { setRouteDraft(k === 'route'); choose(k); }} disabled={locked} columns={4} />
      </SettingRow>
      {shownKind === 'app' ? (
        <SettingRow label="App" hint="Opens in front of your other tabs.">
          <Select
            label="App to open at startup"
            value={choice.kind === 'app' ? `app:${choice.appId}` : ''}
            options={appChoices}
            disabled={locked}
            onValueChange={(v) => void setDesktopSettings({ [STARTUP_KEY]: v })}
          />
        </SettingRow>
      ) : null}
      {shownKind === 'route' ? (
        <SettingRow label="Page" hint={pathOk ? 'An address inside WorkSuite, starting with /.' : 'That is not an address inside WorkSuite.'}>
          <input
            value={path}
            disabled={locked}
            onChange={(ev) => setPath(ev.target.value)}
            placeholder="/mail"
            aria-label="Page to open at startup"
            aria-invalid={!pathOk || undefined}
            className="h-8 w-[220px] rounded-[7px] border border-line bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-primary aria-[invalid]:border-danger"
          />
          <Button size="sm" disabled={locked || !pathOk || !path.trim()} onClick={() => void setDesktopSettings({ [STARTUP_KEY]: `route:${path.trim()}` }).then((ok) => {
            if (!ok) return;
            setRouteDraft(false);
            setPath(null);
          })}>
            Save
          </Button>
        </SettingRow>
      ) : null}
    </SettingsGroup>
  );
}
