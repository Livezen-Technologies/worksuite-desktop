import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { Preferences } from '@shared/types';
import { app, isLocked, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { conflicts, effectiveShortcuts, prettyAccelerator, accelerator, DEFAULT_SHORTCUTS } from '../../core/commands';
import { LANGUAGES } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, currentZone, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Select, Switch, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';

/** Settings / profile tree (§4.9). Anything the organization's policy decides is shown locked, with the reason. */
const SECTIONS = [
  { id: 'general', label: 'General', icon: 'globe' },
  { id: 'preferences', label: 'Preferences', icon: 'settings' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'devices', label: 'Devices', icon: 'laptop' },
  { id: 'desktop', label: 'Desktop', icon: 'monitor' },
  { id: 'files', label: 'Files & Sync', icon: 'folder' },
  { id: 'offline', label: 'Offline', icon: 'cloud-off' },
  { id: 'monitoring', label: 'Monitoring', icon: 'eye' },
  { id: 'about', label: 'About', icon: 'info' },
] as const;

export default function SettingsPage(_props: ModuleProps) {
  useTabTitle('Settings');
  const { path, go } = useTab();
  const section = SECTIONS.find((s) => s.id === path[1])?.id ?? 'general';
  const prefs = useStore(app, (s) => s.prefs);
  if (!prefs) return null;
  return (
    <div className="flex h-full">
      <nav className="w-[230px] shrink-0 border-r border-line bg-surface p-3" aria-label="Settings sections">
        <h1 className="px-3 pt-1 pb-3 text-[20px] font-bold text-ink">Settings</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => go(`/settings/${s.id}`)} aria-current={section === s.id ? 'page' : undefined} className={cx('flex h-9 w-full items-center gap-2.5 rounded-[8px] px-3 text-left text-[13.5px]', section === s.id ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
            <Icon name={s.icon} size={16} /> {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-10 py-8 scroll-thin">
        <div className="max-w-[760px]">
          {section === 'general' ? <General /> : null}
          {section === 'preferences' ? <PreferencesSection prefs={prefs} /> : null}
          {section === 'notifications' ? <NotificationsSection prefs={prefs} /> : null}
          {section === 'security' ? <SecuritySection prefs={prefs} /> : null}
          {section === 'devices' ? <Devices /> : null}
          {section === 'desktop' ? <DesktopSection prefs={prefs} /> : null}
          {section === 'files' ? <FilesSection prefs={prefs} /> : null}
          {section === 'offline' ? <OfflineSection prefs={prefs} /> : null}
          {section === 'monitoring' ? <Monitoring /> : null}
          {section === 'about' ? <About /> : null}
        </div>
      </div>
    </div>
  );
}

function H({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[22px] font-bold text-ink">{title}</h2>
      {hint ? <p className="mt-1 text-[13.5px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function Row({ label, hint, children, lock }: { label: string; hint?: ReactNode; children: ReactNode; lock?: { reason: string } }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {label}
          {lock ? (
            <span title={lock.reason}>
              <Chip tone="warning">
                <Icon name="lock" size={11} /> Set by your organization
              </Chip>
            </span>
          ) : null}
        </div>
        {hint ? <div className="mt-0.5 text-[12.5px] text-ink-3">{hint}</div> : null}
        {lock ? <div className="mt-0.5 text-[12px] text-warning">{lock.reason}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ k, prefs, label, hint }: { k: keyof Preferences; prefs: Preferences; label: string; hint?: string }) {
  const lock = isLocked(k);
  return (
    <Row label={label} hint={hint} lock={lock}>
      <Switch label={label} checked={Boolean(prefs[k])} disabled={!!lock} onChange={(v) => void updatePrefs({ [k]: v } as Partial<Preferences>)} />
    </Row>
  );
}

function General() {
  const b = useStore(app, (s) => s.bootstrap);
  const server = useStore(app, (s) => s.auth?.server);
  const prefs = useStore(app, (s) => s.prefs)!;
  return (
    <>
      <H title="General" />
      <Row label="Language" hint="Sinhala, Tamil, Arabic and Hindi cover the main screens; the rest appears in English.">
        <Select label="Language" value={prefs.language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onChange={(v) => void updatePrefs({ language: v })} />
      </Row>
      <Row label="Time zone" hint="From your WorkSuite profile, then your organization, then this computer.">
        <span className="font-mono text-[13px] text-ink-2">{currentZone()}</span>
      </Row>
      <Row label="WorkSuite server" hint={server?.api === 'desktop-v1' ? 'Desktop API' : 'WorkSuite API'}>
        <span className="font-mono text-[13px] text-ink-2">{server ? new URL(server.origin).host : '—'}</span>
      </Row>
      <Row label="Organizations">
        <span className="text-[13px] text-ink-2">{b?.organizations.map((o) => o.name).join(', ') || '—'}</span>
      </Row>
    </>
  );
}

function PreferencesSection({ prefs }: { prefs: Preferences }) {
  return (
    <>
      <H title="Preferences" />
      <Toggle k="startWithOs" prefs={prefs} label="Start with your computer" />
      <Toggle k="startMinimized" prefs={prefs} label="Start minimized to the tray" />
      <Toggle k="minimizeToTray" prefs={prefs} label="Closing the window keeps WorkSuite in the tray" hint="Off: closing the window quits WorkSuite." />
      <Toggle k="restoreTabs" prefs={prefs} label="Reopen my tabs when WorkSuite starts" />
      <Row label="Theme">
        <Select label="Theme" value={prefs.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(v) => void updatePrefs({ theme: v })} />
      </Row>
      <Row label="Density">
        <Select label="Density" value={prefs.density} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onChange={(v) => void updatePrefs({ density: v })} />
      </Row>
      <Row label="Sidebar">
        <Select label="Sidebar" value={prefs.sidebarMode} options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }, { value: 'auto-hide', label: 'Auto-hide' }]} onChange={(v) => void updatePrefs({ sidebarMode: v })} />
      </Row>
      <Row label="Open downloaded files" hint="When a file is double-clicked in Files.">
        <Select label="Open downloaded files" value={prefs.openFilesLocally} options={[{ value: 'ask', label: 'Ask' }, { value: 'always', label: 'Open locally' }, { value: 'never', label: 'Download only' }]} onChange={(v) => void updatePrefs({ openFilesLocally: v })} />
      </Row>
      <Row label="Download folder" hint={<span className="font-mono">{prefs.downloadFolder}</span>}>
        <Button onClick={() => void call('files:chooseDownloadFolder').then((p) => p && toast('success', 'Download folder changed.'))}>Change…</Button>
      </Row>
      <Toggle k="notificationSounds" prefs={prefs} label="Sounds" />
      <Toggle k="hardwareAcceleration" prefs={prefs} label="Hardware acceleration" hint="Turn off if the window flickers or draws badly. Takes effect after a restart." />
      <Shortcuts prefs={prefs} />
    </>
  );
}

const SHORTCUT_LABELS: Record<string, string> = {
  search: 'Search',
  palette: 'Command palette',
  new: 'New (in this app)',
  'new-tab': 'New tab',
  'close-tab': 'Close tab',
  'restore-tab': 'Reopen closed tab',
  settings: 'Settings',
  ai: 'AI Assistant',
  'switch-org': 'Switch organization',
  lock: 'Lock WorkSuite',
  help: 'Help & Diagnostics',
};

function Shortcuts({ prefs }: { prefs: Preferences }) {
  const map = effectiveShortcuts(prefs.shortcuts);
  const clashes = conflicts(map);
  const [recording, setRecording] = useState<string | null>(null);
  return (
    <div className="mt-8">
      <h3 className="mb-2 text-[16px] font-bold text-ink">Keyboard shortcuts</h3>
      {clashes.length ? (
        <div className="mb-2 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          {clashes.map((c) => `${prettyAccelerator(c.accelerator)} is used by ${c.commands.map((id) => SHORTCUT_LABELS[id] ?? id).join(' and ')}`).join('. ')}. The shell command wins.
        </div>
      ) : null}
      {Object.keys(SHORTCUT_LABELS).map((id) => (
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
              className={cx('min-w-[110px] rounded-[7px] border px-2.5 py-1 font-mono text-[12.5px]', recording === id ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}
            >
              {recording === id ? 'Press keys…' : prettyAccelerator(map[id] ?? '')}
            </button>
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
      ))}
    </div>
  );
}

const MODULE_TOGGLES = [
  ['mail', 'Mail'],
  ['chat', 'Chat and calls'],
  ['calendar', 'Calendar and meetings'],
  ['tasks', 'Tasks'],
  ['hr', 'HR and approvals'],
  ['crm', 'CRM'],
  ['files', 'Files'],
  ['support', 'Support'],
  ['system', 'System alerts'],
] as const;

function NotificationsSection({ prefs }: { prefs: Preferences }) {
  const lock = isLocked('notificationPrivacy');
  const paused = useStore(app, (s) => s.status?.notificationsPausedUntil);
  return (
    <>
      <H title="Notifications" hint="WorkSuite shows notifications even when its window is closed, from the tray." />
      <Toggle k="notificationsEnabled" prefs={prefs} label="Show notifications" />
      <Row label="What notifications show" lock={lock} hint="On the lock screen and while WorkSuite is locked, content is always hidden.">
        <Select
          label="Notification privacy"
          disabled={!!lock && prefs.notificationPrivacy === 'GENERIC'}
          value={prefs.notificationPrivacy}
          options={[{ value: 'FULL', label: 'Full content' }, { value: 'SENDER_ONLY', label: 'Sender only' }, { value: 'GENERIC', label: '"New WorkSuite notification"' }]}
          onChange={(v) => void updatePrefs({ notificationPrivacy: v })}
        />
      </Row>
      <Row label="Pause notifications" hint={paused ? `Paused until ${new Date(paused).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Urgent notifications and calls still come through.'}>
        <div className="flex gap-2">
          {paused ? (
            <Button onClick={() => void call('notifications:pause', { minutes: null })}>Resume</Button>
          ) : (
            <>
              <Button onClick={() => void call('notifications:pause', { minutes: 30 })}>30 min</Button>
              <Button onClick={() => void call('notifications:pause', { minutes: 60 })}>1 hour</Button>
            </>
          )}
        </div>
      </Row>
      <Toggle k="dndEnabled" prefs={prefs} label="Do not disturb on a schedule" />
      {prefs.dndEnabled ? (
        <Row label="Quiet hours">
          <div className="flex items-center gap-2 text-[13px]">
            <input type="time" value={prefs.dndFrom} onChange={(e) => void updatePrefs({ dndFrom: e.target.value })} aria-label="From" className="h-8 rounded-[8px] border border-line bg-surface px-2" />
            to
            <input type="time" value={prefs.dndTo} onChange={(e) => void updatePrefs({ dndTo: e.target.value })} aria-label="To" className="h-8 rounded-[8px] border border-line bg-surface px-2" />
          </div>
        </Row>
      ) : null}
      <h3 className="mt-8 mb-1 text-[16px] font-bold text-ink">By app</h3>
      {MODULE_TOGGLES.map(([id, label]) => (
        <Row key={id} label={label}>
          <Switch label={label} checked={prefs.moduleNotifications[id] !== false} onChange={(v) => void updatePrefs({ moduleNotifications: { ...prefs.moduleNotifications, [id]: v } })} />
        </Row>
      ))}
      <div className="mt-6">
        <Button icon="bell" onClick={() => void call('notifications:test').then((ok) => !ok && toast('warning', 'This system does not support notifications. Check its notification settings.'))}>
          Send a test notification
        </Button>
      </div>
    </>
  );
}

function SecuritySection({ prefs }: { prefs: Preferences }) {
  const lock = isLocked('appLockMinutes');
  const lockState = useStore(app, (s) => s.lock);
  const max = useStore(app, (s) => s.bootstrap?.policy.app_lock_max_minutes ?? 0);
  const options = [0, 1, 5, 15, 30, 60].filter((m) => !max || (m > 0 && m <= max)).map((m) => ({ value: m, label: m === 0 ? 'Never' : `After ${m} minute${m === 1 ? '' : 's'}` }));
  return (
    <>
      <H title="Security" />
      <Row label="Lock WorkSuite" hint="When nobody has used WorkSuite for this long." lock={lock}>
        <Select label="App lock" value={prefs.appLockMinutes} options={options} onChange={(v) => void updatePrefs({ appLockMinutes: v as Preferences['appLockMinutes'] })} />
      </Row>
      <Toggle k="lockOnSystemLock" prefs={prefs} label="Lock when this computer locks or sleeps" />
      <Row label="Unlock with" hint={lockState?.biometric === 'touch-id' ? 'Your WorkSuite password or Touch ID.' : 'Your WorkSuite password. Windows Hello support is planned.'}>
        <Button icon="lock" onClick={() => void call('security:lock')}>
          Lock now
        </Button>
      </Row>
      <Row label="Where you're signed in" hint="Sessions on other devices and browsers.">
        <Button icon="external" onClick={() => void call('app:openInBrowser', { path: '/account/security' })}>
          Manage sessions
        </Button>
      </Row>
    </>
  );
}

function Devices() {
  const q = useQuery({ queryKey: ['device'], queryFn: () => call('security:deviceInfo') });
  const d = q.data;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <H title="This device" hint="Your organization sees each computer you use WorkSuite on, and can sign it out or remove WorkSuite's data from it." />
      {d ? (
        <>
          <Row label="Name">
            <span className="text-[13px] text-ink-2">{d.name}</span>
          </Row>
          <Row label="Device id">
            <span className="font-mono text-[12.5px] text-ink-2 selectable">{d.id ?? 'Not registered'}</span>
          </Row>
          <Row label="System">
            <span className="text-[13px] text-ink-2">
              {d.osVersion} · {d.arch}
            </span>
          </Row>
          <Row label="Trust" hint="Set by your organization. Trusted computers can queue changes while offline.">
            <Chip tone={d.trust === 'TRUSTED' ? 'success' : d.trust === 'STANDARD' ? 'muted' : 'danger'}>{d.trust.toLowerCase()}</Chip>
          </Row>
          <Row label="Credentials stored in" hint={d.secureStorage.persistent ? undefined : 'No system keyring was found, so WorkSuite keeps your sign-in in memory and asks again next time.'}>
            <span className="text-[13px] text-ink-2">{d.secureStorage.persistent ? d.secureStorage.backend : 'Memory only'}</span>
          </Row>
          <Row label="Last check-in">
            <span className="text-[13px] text-ink-2">{d.lastHeartbeatAt ? relative(d.lastHeartbeatAt) : '—'}</span>
          </Row>
        </>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button icon="external" onClick={() => void call('app:openInBrowser', { path: '/devices' })}>
          My other devices
        </Button>
        {confirm ? (
          <>
            <Button variant="danger" onClick={() => void call('auth:signOut', { wipe: true })}>
              Sign out and remove WorkSuite data
            </Button>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            Sign out and remove this computer's data…
          </Button>
        )}
      </div>
      {confirm ? <p className="mt-2 text-[12.5px] text-ink-3">Removes cached data, queued changes, drafts and this computer's registration. Files you saved yourself are not touched.</p> : null}
    </>
  );
}

function DesktopSection({ prefs }: { prefs: Preferences }) {
  const lock = isLocked('updateChannel');
  const info = useStore(app, (s) => s.info);
  return (
    <>
      <H title="Desktop" />
      <Row label="Update channel" lock={lock} hint="Beta and Development receive new versions earlier.">
        <Select
          label="Update channel"
          disabled={!!lock}
          value={prefs.updateChannel}
          options={[{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta' }, { value: 'dev', label: 'Development' }]}
          onChange={(v) => void call('updates:setChannel', { channel: v }).catch((e) => toast('error', errorMessage(e)))}
        />
      </Row>
      <Row label="Tab suspension" hint="Tabs you haven't looked at for this long are unloaded to save memory, and reload when you return.">
        <Select label="Tab suspension" value={prefs.tabSuspendMinutes} options={[15, 30, 60, 120, 480].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }))} onChange={(v) => void updatePrefs({ tabSuspendMinutes: v })} />
      </Row>
      <Row label="Always on top" hint="Pop-out chat windows can stay above other windows — use the pin in their title bar.">
        <span className="text-[13px] text-ink-3">Per window</span>
      </Row>
      <Row label="Safe Mode" hint={info?.safeMode ? 'Running in Safe Mode: no hardware acceleration and no tab restore.' : 'Starts without hardware acceleration or tab restore, for troubleshooting.'}>
        <Button onClick={() => void call('diagnostics:restartSafeMode', { safe: !info?.safeMode })}>{info?.safeMode ? 'Restart normally' : 'Restart in Safe Mode'}</Button>
      </Row>
    </>
  );
}

function FilesSection({ prefs }: { prefs: Preferences }) {
  return (
    <>
      <H title="Files & Sync" hint="Your WorkSuite Drive is available in Files. Keeping a WorkSuite folder on this computer in sync — selective sync, offline files, conflict handling — arrives with Drive sync." />
      <Row label="Downloads are saved to" hint={<span className="font-mono">{prefs.downloadFolder}</span>}>
        <Button onClick={() => void call('files:chooseDownloadFolder')}>Change…</Button>
      </Row>
      <Row label="WorkSuite folder" hint="Not set up — Drive sync is not part of this version.">
        <Chip>Online only</Chip>
      </Row>
    </>
  );
}

function OfflineSection({ prefs }: { prefs: Preferences }) {
  const st = useQuery({ queryKey: ['offline', 'status'], queryFn: () => call('offline:status') });
  return (
    <>
      <H title="Offline" hint="WorkSuite keeps what you've recently opened so you can read it without a connection. Everything saved on this computer is encrypted." />
      <Row label="Saved for offline use" hint={st.data ? `${st.data.cacheEntries} items` : undefined}>
        <span className="font-mono text-[13px] text-ink-2">{st.data ? bytes(st.data.cacheBytes) : '—'}</span>
      </Row>
      <Row label="Mail kept offline">
        <Select label="Mail cache" value={prefs.mailCacheDays} options={[{ value: 7, label: 'Last 7 days' }, { value: 30, label: 'Last 30 days' }, { value: 90, label: 'Last 90 days' }, { value: 0, label: 'Headers only' }]} onChange={(v) => void updatePrefs({ mailCacheDays: v as Preferences['mailCacheDays'] })} />
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

function Monitoring() {
  const policy = useStore(app, (s) => s.bootstrap?.monitoringPolicy);
  return (
    <>
      <H title="Monitoring" />
      {policy ? (
        <p className="text-[13.5px] text-ink-2">
          Policy “{policy.name}” (version {policy.version}) is assigned to you. The monitoring agent is part of a later version of WorkSuite Desktop; nothing is recorded by this version.
        </p>
      ) : (
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Icon name="shield-check" size={18} className="text-success" /> No monitoring policy is assigned to you
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">WorkSuite is not recording your work sessions, app usage, websites or screenshots.</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
            If your organization ever assigns a policy, you will be shown exactly what is tracked and what is never tracked — keystrokes, passwords, clipboard, continuous webcam and microphone are never collected — and nothing starts until you acknowledge it. A timer and tray indicator are always visible while a session is active.
          </p>
        </div>
      )}
    </>
  );
}

function About() {
  const { navigate } = useTab();
  const info = useStore(app, (s) => s.info);
  const u = useStore(app, (s) => s.update);
  const [checking, setChecking] = useState(false);
  return (
    <>
      <H title="About WorkSuite Desktop" />
      <Row label="Version">
        <span className="font-mono text-[13px] text-ink-2">
          {info?.version} ({info?.platform} {info?.arch})
        </span>
      </Row>
      <Row label="Channel">
        <span className="text-[13px] text-ink-2 capitalize">{u?.channel}</span>
      </Row>
      <Row
        label="Updates"
        hint={
          u
            ? u.state === 'STAGED'
              ? `Version ${u.availableVersion} is ready to install.`
              : u.state === 'DOWNLOADING'
                ? `Downloading ${u.availableVersion}… ${u.progress}%`
                : u.state === 'AVAILABLE'
                  ? `Version ${u.availableVersion} is available.${u.installBlockedReason ? ` ${u.installBlockedReason}` : ''}`
                  : (u.error ?? (u.lastCheckedAt ? `Up to date · checked ${relative(u.lastCheckedAt)}` : 'Not checked yet'))
            : undefined
        }
      >
        {u?.state === 'STAGED' ? (
          <Button variant="primary" onClick={() => void call('updates:installNow', {})}>
            Restart to update
          </Button>
        ) : (
          <Button
            loading={checking}
            onClick={async () => {
              setChecking(true);
              await call('updates:check').catch(() => undefined);
              setChecking(false);
            }}
          >
            Check for updates
          </Button>
        )}
      </Row>
      <Row label="Components">
        <span className="font-mono text-[12px] text-ink-3">
          Electron {info?.electron} · Chromium {info?.chrome} · Node {info?.node}
        </span>
      </Row>
      <Row label="Diagnostics" hint="Health checks and a support report with secrets removed.">
        <Button icon="stethoscope" onClick={() => navigate('/diagnostics')}>
          Open Diagnostics
        </Button>
      </Row>
      <p className="mt-6 text-[12px] text-ink-3">© Livezen Technologies. WorkSuite Desktop includes open-source software; licences are listed in the application's resources.</p>
    </>
  );
}
