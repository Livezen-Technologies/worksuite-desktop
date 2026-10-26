import { useMemo } from 'react';
import { grantOf } from '@shared/access';
import { LAUNCHER_GROUPS, navApps, visibleApps } from '@shared/apps';
import { DESKTOP_FEATURES, MANAGED_REASON, canDisableModule, featureKey, moduleKey, type CatalogueItem, type EffectiveSetting, type SettingValue } from '@shared/desktop-settings';
import { app } from '../../core/app-state';
import { refreshDesktopSettings, setDesktopSettings, useDesktopSettings } from '../../core/desktop-settings';
import { appLabel } from '../../core/i18n';
import { useGuest } from '../../core/session';
import { useStore } from '../../core/store';
import { relative } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button, Switch, cx } from '../../components/ui';
import { SectionHeader, SettingRow, SettingsGroup, SourceNote } from './kit';

/**
 * Settings › Features & apps (desktop settings `features.*`, `modules.<app>.enabled`): what this person has on this
 * computer. Personal: everything is on until they turn it off. Enterprise: what the organisation manages is shown
 * locked with its badge, its defaults are marked, and the rest is theirs. An app turned off leaves the launcher, the
 * sidebar, links, shortcuts, the command palette and the tray; turned on again, it comes back.
 */
export function FeaturesSettings() {
  const ds = useDesktopSettings();
  const bootstrap = useStore(app, (s) => s.bootstrap);
  const guest = useGuest();
  // Every app the person is given — turned off ones included, so they can be turned on again.
  const given = useMemo(() => (bootstrap ? navApps(visibleApps(grantOf(bootstrap))).filter((a) => canDisableModule(a.id)) : []), [bootstrap]);
  const items = new Map(ds.catalogue.map((c) => [c.key, c]));
  const known = new Set(DESKTOP_FEATURES.map((f) => featureKey(f.id)));
  // Features the server knows and this desktop does not draw itself: shown and synced all the same.
  const extra = ds.catalogue.filter((c) => c.key.startsWith('features.') && !known.has(c.key));
  const managedPrefs = Object.entries(ds.effective).filter(([k, e]) => k.startsWith('prefs.') && e.locked);
  const managedCount = Object.values(ds.effective).filter((e) => e.locked).length;

  const set = (key: string, v: SettingValue | null) => void setDesktopSettings({ [key]: v });
  const toggleRow = (key: string, label: string, hint?: string, item?: CatalogueItem) => (
    <BooleanRow key={key} k={key} label={item?.label ?? label} hint={item?.description ?? hint} e={ds.effective[key]} def={item?.default} onChange={(v) => set(key, v)} onReset={() => set(key, null)} />
  );

  return (
    <>
      <SectionHeader
        title="Features & apps"
        hint={ds.mode === 'enterprise' ? 'What you use on this computer. Your organization manages some of it; the rest is yours to change, and follows you to your other computers.' : 'Everything is on until you turn it off. Your choices follow you to your other computers.'}
        actions={
          ds.status !== 'local' ? (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refreshDesktopSettings()}>
              Sync now
            </Button>
          ) : null
        }
      />
      <SyncStatus status={ds.status} asOf={ds.asOf} pending={ds.pending.length} mode={ds.mode} managed={managedCount} />

      <SettingsGroup title="Features" description="Turned off, a feature is gone from every window, its shortcut included.">
        {DESKTOP_FEATURES.map((f) => toggleRow(featureKey(f.id), f.label, f.description, items.get(featureKey(f.id))))}
        {extra.map((c) => toggleRow(c.key, c.label, c.description, c))}
      </SettingsGroup>

      {guest ? null : (
        <SettingsGroup title="Apps" description="An app you turn off leaves the launcher, the sidebar, search, links, shortcuts and the tray. Its data stays on the server.">
          {given.length === 0 ? <div className="px-[18px] py-4 text-[13px] text-ink-3">No apps yet. They appear when you are signed in.</div> : null}
          {LAUNCHER_GROUPS.map((g) => {
            const list = given.filter((a) => a.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id} role="group" aria-label={g.label}>
                <div className="bg-well/60 px-[18px] py-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{g.label}</div>
                <div className="divide-y divide-line">
                  {list.map((a) => (
                    <BooleanRow
                      key={a.id}
                      k={moduleKey(a.id)}
                      label={appLabel(a)}
                      icon={a.icon}
                      e={ds.effective[moduleKey(a.id)]}
                      def={items.get(moduleKey(a.id))?.default ?? true}
                      onChange={(v) => set(moduleKey(a.id), v)}
                      onReset={() => set(moduleKey(a.id), null)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {managedPrefs.length ? (
        <SettingsGroup title="Set by your organization" description="Preferences your organization manages on every computer you use.">
          {managedPrefs.map(([k, e]) => (
            <SettingRow key={k} label={items.get(k)?.label ?? k.slice(6)} lock={{ reason: MANAGED_REASON }}>
              <span className="text-[13px] text-ink-2">{describe(items.get(k), e.value)}</span>
            </SettingRow>
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
}

/** A value as words: On / Off, an option's label, or the value itself. */
function describe(item: CatalogueItem | undefined, v: SettingValue): string {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (v === null) return '—';
  return item?.options?.find((o) => o.value === v)?.label ?? String(v);
}

function BooleanRow({ k, label, hint, icon, e, def, onChange, onReset }: { k: string; label: string; hint?: string; icon?: string; e: EffectiveSetting | undefined; def: SettingValue | undefined; onChange: (v: boolean) => void; onReset: () => void }) {
  const on = e?.value !== false;
  const locked = !!e?.locked;
  const changed = e?.source === 'user' && e.value !== (def ?? true);
  return (
    <div data-setting-key={k}>
      <SettingRow
        label={label}
        hint={hint}
        lock={locked ? { reason: MANAGED_REASON } : null}
        badge={e?.source === 'policy' && !locked ? <SourceNote>Your organization’s default</SourceNote> : null}
        onReset={changed ? onReset : null}
      >
        {icon ? (
          <span className="me-1 hidden h-7 w-7 items-center justify-center rounded-[8px] bg-subtle text-ink-2 sm:flex" aria-hidden>
            <Icon name={icon} size={15} />
          </span>
        ) : null}
        <Switch label={label} checked={on} disabled={locked} onChange={onChange} />
      </SettingRow>
    </div>
  );
}

function SyncStatus({ status, asOf, pending, mode, managed }: { status: 'synced' | 'cached' | 'local'; asOf: string | null; pending: number; mode: 'enterprise' | 'personal'; managed: number }) {
  const words =
    status === 'synced'
      ? `Synced${asOf ? ` ${relative(asOf)}` : ''}.`
      : status === 'cached'
        ? `Offline — showing your settings as of ${asOf ? relative(asOf) : 'the last sync'}.`
        : 'Saved on this computer only.';
  return (
    <div className={cx('mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border px-4 py-2.5 text-[12.5px]', status === 'cached' ? 'border-warning/30 bg-warning-bg text-warning-ink' : 'border-line bg-surface text-ink-2')}>
      <span className="inline-flex items-center gap-1.5">
        <Icon name={status === 'cached' ? 'cloud-off' : status === 'synced' ? 'cloud' : 'laptop'} size={14} />
        {words}
      </span>
      {pending ? <span className="text-ink-3">{pending === 1 ? '1 change waiting to sync.' : `${pending} changes waiting to sync.`}</span> : null}
      <span className="flex-1" />
      {mode === 'enterprise' ? (
        <span className="inline-flex items-center gap-2">
          <Icon name="building" size={14} /> Enterprise
          {managed ? (
            <span className="inline-flex items-center gap-1 text-ink-3">
              · <Icon name="lock" size={12} /> {managed === 1 ? '1 setting managed' : `${managed} settings managed`}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Icon name="user" size={14} /> Personal
        </span>
      )}
    </div>
  );
}
