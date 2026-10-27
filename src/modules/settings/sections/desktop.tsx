import type { Preferences } from '@shared/types';
import { useStore } from '../../../core/store';
import { app, updatePrefs } from '../../../core/app-state';
import { StartupSettings } from '../StartupSettings';
import { SettingsGroup } from '../../../components/SettingsKit';
import { UpdatesRow } from '../UpdatesCard';
import { Select } from '../../../components/Select';
import { Button, Chip } from '../../../components/ui';
import { call, errorMessage } from '../../../core/bridge';
import { LinksSettings } from '../LinksSettings';
import { useTab } from '../../../core/tab-context';
import { useState } from 'react';
import { toast } from '../../../core/toasts';
import { relative, bytes } from '../../../core/time';
import { SyncButton } from '../../../components/SyncButton';
import { DriveSettings } from '../../files/DriveSettings';
import { useQuery } from '@tanstack/react-query';
import { H, Toggle, Row } from './parts';

/** Settings › Desktop, Files and Offline. */

export function DesktopSection({ prefs }: { prefs: Preferences }) {
  const info = useStore(app, (s) => s.info);
  return (
    <>
      <H title="Desktop & startup" hint="What WorkSuite opens on, how it starts and how it runs on this computer." />
      <StartupSettings />
      <SettingsGroup title="Starting and closing">
        <Toggle k="startWithOs" prefs={prefs} label="Start with your computer" />
        <Toggle k="startMinimized" prefs={prefs} label="Start minimized to the tray" />
        <Toggle k="minimizeToTray" prefs={prefs} label="Closing the window keeps WorkSuite in the tray" hint="Off: closing the window quits WorkSuite." />
        <Toggle k="restoreTabs" prefs={prefs} label="Reopen my tabs when WorkSuite starts" />
      </SettingsGroup>
      <SettingsGroup title="This computer">
      {/* Updates have their own page (Settings › Updates); this row says where they stand. */}
      <UpdatesRow />
      <Row label="Tab suspension" hint="Tabs you haven't looked at for this long are unloaded to save memory, and reload when you return.">
        <Select label="Tab suspension" value={prefs.tabSuspendMinutes} options={[15, 30, 60, 120, 480].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }))} onValueChange={(v) => void updatePrefs({ tabSuspendMinutes: v })} />
      </Row>
      <Row label="Always on top" hint="Pop-out chat windows can stay above other windows — use the pin in their title bar.">
        <span className="text-[13px] text-ink-3">Per window</span>
      </Row>
      <Row label="Safe Mode" hint={info?.safeMode ? 'Running in Safe Mode: no hardware acceleration and no tab restore.' : 'Starts without hardware acceleration or tab restore, for troubleshooting.'}>
        <Button onClick={() => void call('diagnostics:restartSafeMode', { safe: !info?.safeMode })}>{info?.safeMode ? 'Restart normally' : 'Restart in Safe Mode'}</Button>
      </Row>
      </SettingsGroup>
      <LinksSettings prefs={prefs} />
    </>
  );
}

export function FilesSection() {
  const { navigate } = useTab();
  const sync = useStore(app, (s) => s.sync);
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, p: Promise<unknown>) => {
    setBusy(key);
    void p.catch((e) => toast('error', errorMessage(e))).finally(() => setBusy(null));
  };
  const words: Record<string, string> = { off: 'Off', idle: 'Up to date', syncing: 'Syncing…', paused: 'Paused', offline: 'Offline — waiting', error: 'Needs attention', disconnected: 'Disconnected', blocked: 'Blocked' };
  const tone = (st: string): 'success' | 'warning' | 'danger' | 'indigo' | 'muted' => (st === 'idle' ? 'success' : st === 'syncing' ? 'indigo' : st === 'error' || st === 'blocked' || st === 'disconnected' ? 'danger' : st === 'off' ? 'muted' : 'warning');
  return (
    <>
      <H title="Files & Sync" hint="Your WorkSuite Drive is available in Files. Keep Drive folders on this computer in sync — they stay available offline, and changes go both ways." />
      {!sync ? (
        <Row label="Drive sync" hint="Checking…">
          <Chip>—</Chip>
        </Row>
      ) : !sync.available ? (
        <Row label="Drive sync" hint={sync.reason ?? 'Drive sync is not available on this computer.'}>
          <Chip>Online only</Chip>
        </Row>
      ) : (
        <>
          <Row label="Drive sync" hint={sync.message ?? (sync.lastSyncAt ? `Last synced ${relative(sync.lastSyncAt)}.` : sync.folders.length ? undefined : 'No folder is kept on this computer yet.')}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Chip tone={tone(sync.state)}>{words[sync.state] ?? sync.state}</Chip>
              {sync.state === 'disconnected' ? (
                <Button size="sm" loading={busy === 'reconnect'} onClick={() => run('reconnect', call('sync:reconnect'))}>
                  Reconnect
                </Button>
              ) : null}
              {sync.folders.length ? (
                <>
                  <SyncButton size="sm" running={sync.state === 'syncing'} failed={sync.state === 'error'} disabled={sync.paused} reason={sync.paused ? 'Resume syncing first' : undefined} onSync={() => call('sync:now')} />
                  <Button size="sm" loading={busy === 'pause'} onClick={() => run('pause', call('sync:pause', { id: null, paused: !sync.paused }))}>
                    {sync.paused ? 'Resume' : 'Pause'}
                  </Button>
                </>
              ) : null}
            </div>
          </Row>
          {sync.folders.map((f) => (
            <Row key={f.id} label={f.folderName || 'My Drive'} hint={<span className="font-mono">{f.localPath}</span>}>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Chip tone={f.error ? 'danger' : f.paused ? 'warning' : f.pending.up + f.pending.down ? 'indigo' : 'success'}>
                  {f.error ? 'Needs attention' : f.paused ? 'Paused' : f.pending.up + f.pending.down ? `Syncing ${f.pending.up + f.pending.down}` : `${f.files} files · ${bytes(f.bytes)}`}
                </Chip>
                <Button size="sm" onClick={() => void call('sync:reveal', { syncFolderId: f.id })}>
                  Show
                </Button>
              </div>
            </Row>
          ))}
          <Row label="WorkSuite folder" hint={<span className="font-mono">{sync.defaultRoot}</span>}>
            <Button icon="folder" onClick={() => navigate('/files?view=devices')}>
              {sync.folders.length ? 'Manage sync…' : 'Set up sync…'}
            </Button>
          </Row>
        </>
      )}
      {/* The same settings as Drive › Settings: transfers, bandwidth, storage and their notifications. */}
      <div className="mt-8" id="drive-settings">
        <DriveSettings embedded />
      </div>
      <div className="mt-2">
        <Button size="sm" variant="ghost" icon="external" onClick={() => navigate('/files?view=settings')}>
          Open in Drive
        </Button>
      </div>
    </>
  );
}

export function OfflineSection({ prefs }: { prefs: Preferences }) {
  const st = useQuery({ queryKey: ['offline', 'status'], queryFn: () => call('offline:status') });
  return (
    <>
      <H title="Offline" hint="WorkSuite keeps what you've recently opened so you can read it without a connection. Everything saved on this computer is encrypted." />
      <Row label="Saved for offline use" hint={st.data ? `${st.data.cacheEntries} items` : undefined}>
        <span className="font-mono text-[13px] text-ink-2">{st.data ? bytes(st.data.cacheBytes) : '—'}</span>
      </Row>
      <Row label="Mail kept offline">
        <Select label="Mail cache" value={prefs.mailCacheDays} options={[{ value: 7, label: 'Last 7 days' }, { value: 30, label: 'Last 30 days' }, { value: 90, label: 'Last 90 days' }, { value: 0, label: 'Headers only' }]} onValueChange={(v) => void updatePrefs({ mailCacheDays: v as Preferences['mailCacheDays'] })} />
      </Row>
      <Row label="Changes waiting to sync" hint={st.data?.reason ?? 'Offline changes are sent in order when you reconnect.'}>
        <span className="font-mono text-[13px] text-ink-2">
          {st.data ? `${st.data.pending} pending${st.data.conflicts ? ` · ${st.data.conflicts} conflicts` : ''}${st.data.failed ? ` · ${st.data.failed} failed` : ''}` : '—'}
        </span>
      </Row>
      <div className="mt-6">
        <Button
          onClick={() =>
            void call('offline:clearCache').then((n) => {
              toast('success', `Removed ${n} saved item${n === 1 ? '' : 's'}.`);
              void st.refetch();
            })
          }
        >
          Clear saved data
        </Button>
      </div>
    </>
  );
}
