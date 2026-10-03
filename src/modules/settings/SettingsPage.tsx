import { LivestreamDestinations } from '../meet/Livestreaming';
import { DarkProfilePicker } from './Appearance';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { categoryVisible } from '@shared/access';
import { QUICK_ASK_SHORTCUTS, type AiDisplay, type Preferences, type RemoteControlIdentity, type RemoteControlView } from '@shared/types';
import { useCanOpen, useVisibleIds } from '../../core/access';
import { app, isLocked, updatePrefs } from '../../core/app-state';
import { call, errorMessage, isMac, on } from '../../core/bridge';
import { conflicts, effectiveShortcuts, prettyAccelerator, accelerator, DEFAULT_SHORTCUTS } from '../../core/commands';
import { LANGUAGES, t, text } from '../../core/i18n';
import { LOCAL_AI_KEY, useLocalAIStatus, useLocalModels } from '../../core/local-ai';
import { secondsLeft, timeLeftLabel } from '../ai/setup';
import { queryClient } from '../../core/query';
import { useStore } from '../../core/store';
import { RecordingSettings } from '../meet/RecordingSettings';
import { SpeechModelSettings } from '../meet/SpeechModel';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, currentZone, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal, Switch, TextField, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import type { ModuleProps } from '../registry';
import { playTone } from '../calls/tones';
import { shortcutLabel, useWriter, writerProblem } from '../ai/writer';
import { ModuleAccess } from '../ai/ModuleAccess';
import { discoverStudioModels, setStudioModels, STUDIO_KEY, studioState, testStudioModel, useStudioStatus, type StudioDiscovery } from '../ai/studio';
import { Checkbox } from '../../components/Checkbox';
import { DriveSettings } from '../files/DriveSettings';
import { MailSettings } from '../mail/MailSettings';
import { LocalDataSection, LocalProfileSection } from '../guest/LocalSettings';
import { useGuest } from '../../core/session';

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
  { id: 'mail', label: 'Mail', icon: 'mail' },
  { id: 'ai', label: 'AI Assistant', icon: 'sparkles' },
  { id: 'local-ai', label: 'Local AI', icon: 'cpu' },
  { id: 'meet', label: 'Meet', icon: 'video' },
  { id: 'remote-control', label: 'Remote control', icon: 'screen-share' },
  { id: 'monitoring', label: 'Monitoring', icon: 'eye' },
  { id: 'about', label: 'About', icon: 'info' },
  // Guest mode's own (#149): the Local Profile and its data, where an account's profile and data settings are.
  { id: 'local-profile', label: 'Profile', icon: 'user' },
  { id: 'local-data', label: 'Backup & data', icon: 'download' },
] as const;

/** What a guest's Settings show: what applies to this computer and the Local Profile, nothing that needs an account. */
const GUEST_SECTIONS: ReadonlySet<string> = new Set(['general', 'preferences', 'local-profile', 'local-data', 'about']);
const LOCAL_SECTIONS: ReadonlySet<string> = new Set(['local-profile', 'local-data']);

export default function SettingsPage(_props: ModuleProps) {
  useTabTitle('Settings');
  const { path, go, query } = useTab();
  const guest = useGuest();
  const shown = SECTIONS.filter((s) => (guest ? GUEST_SECTIONS.has(s.id) : !LOCAL_SECTIONS.has(s.id)));
  const section = shown.find((s) => s.id === path[1])?.id ?? 'general';
  const prefs = useStore(app, (s) => s.prefs);
  const hasMail = useCanOpen('mail');
  if (!prefs) return null;
  return (
    <div className="flex h-full">
      <nav className="w-[230px] shrink-0 border-r border-line bg-surface p-3" aria-label="Settings sections">
        <h1 className="px-3 pt-1 pb-3 text-[20px] font-bold text-ink">Settings</h1>
        {shown.filter((s) => s.id !== 'mail' || hasMail).map((s) => (
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
          {section === 'files' ? <FilesSection /> : null}
          {section === 'offline' ? <OfflineSection prefs={prefs} /> : null}
          {section === 'mail' && hasMail ? <MailSettings query={query} /> : null}
          {section === 'ai' ? <AiSection prefs={prefs} /> : null}
          {section === 'local-ai' ? <LocalAISection /> : null}
          {section === 'meet' ? <MeetSection /> : null}
          {section === 'remote-control' ? <RemoteControlSection /> : null}
          {section === 'monitoring' ? <Monitoring /> : null}
          {section === 'about' ? <About /> : null}
          {section === 'local-profile' ? <LocalProfileSection /> : null}
          {section === 'local-data' ? <LocalDataSection /> : null}
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
      {/* Never wider than 60%: a long value wraps instead of running over the label. */}
      <div className="min-w-0 max-w-[60%] shrink-0 break-words">{children}</div>
    </div>
  );
}

function Toggle({ k, prefs, label, hint, disabled }: { k: keyof Preferences; prefs: Preferences; label: string; hint?: string; disabled?: boolean }) {
  const lock = isLocked(k);
  return (
    <Row label={label} hint={hint} lock={lock}>
      <Switch label={label} checked={Boolean(prefs[k])} disabled={disabled || !!lock} onChange={(v) => void updatePrefs({ [k]: v } as Partial<Preferences>)} />
    </Row>
  );
}

function General() {
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

function PreferencesSection({ prefs }: { prefs: Preferences }) {
  // Downloads are Files', which a guest does not have (#149).
  const guest = useGuest();
  return (
    <>
      <H title="Preferences" />
      <Toggle k="startWithOs" prefs={prefs} label="Start with your computer" />
      <Toggle k="startMinimized" prefs={prefs} label="Start minimized to the tray" />
      <Toggle k="minimizeToTray" prefs={prefs} label="Closing the window keeps WorkSuite in the tray" hint="Off: closing the window quits WorkSuite." />
      <Toggle k="restoreTabs" prefs={prefs} label="Reopen my tabs when WorkSuite starts" />
      <H title="Appearance" />
      <Row label="Theme">
        <Select label="Theme" value={prefs.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onValueChange={(v) => void updatePrefs({ theme: v })} />
      </Row>
      <Toggle k="highContrast" prefs={prefs} label="High contrast" />
      <DarkProfilePicker prefs={prefs} />
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
        </>
      )}
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
  'pdf-open': 'PDF Studio: open a PDF',
  'pdf-save': 'PDF Studio: save',
  'pdf-print': 'PDF Studio: print',
  'pdf-find': 'PDF Studio: find',
  'pdf-find-advanced': 'PDF Studio: search comments and bookmarks too',
  'pdf-zoom-in': 'PDF Studio: zoom in',
  'pdf-zoom-out': 'PDF Studio: zoom out',
  'pdf-hand': 'PDF Studio: hand tool',
  'pdf-select': 'PDF Studio: select tool',
};

function Shortcuts({ prefs }: { prefs: Preferences }) {
  const map = effectiveShortcuts(prefs.shortcuts);
  const clashes = conflicts(map);
  const [recording, setRecording] = useState<string | null>(null);
  // The AI Assistant's shortcut only for whoever has the AI app.
  const hasAi = useCanOpen('ai');
  return (
    <div className="mt-8">
      <h3 className="mb-2 text-[16px] font-bold text-ink">Keyboard shortcuts</h3>
      {clashes.length ? (
        <div className="mb-2 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          {clashes.map((c) => `${prettyAccelerator(c.accelerator)} is used by ${c.commands.map((id) => SHORTCUT_LABELS[id] ?? id).join(' and ')}`).join('. ')}. The shell command wins.
        </div>
      ) : null}
      {Object.keys(SHORTCUT_LABELS).filter((id) => id !== 'ai' || hasAi).map((id) => (
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
  ['salon', 'SalonMate front desk'],
  ['ai', 'AI Assistant'],
  ['system', 'System alerts'],
] as const;

function NotificationsSection({ prefs }: { prefs: Preferences }) {
  const { navigate } = useTab();
  const visible = useVisibleIds();
  const lock = isLocked('notificationPrivacy');
  const paused = useStore(app, (s) => s.status?.notificationsPausedUntil);
  const hasChat = useStore(app, (s) => s.apps.some((a) => a.id === 'chat'));
  return (
    <>
      <H title="Notifications" hint="How this computer shows notifications — even when WorkSuite's window is closed, from the tray." />
      <Row label="What reaches you, and when" hint="Each app by channel, quiet hours, and how this computer shows them.">
        <Button icon="bell" onClick={() => navigate('/notifications/settings')}>
          Open notification settings
        </Button>
      </Row>
      <Toggle k="notificationsEnabled" prefs={prefs} label="Show notifications" />
      <Row label="What notifications show" lock={lock} hint="On the lock screen and while WorkSuite is locked, content is always hidden.">
        <Select
          label="Notification privacy"
          disabled={!!lock && prefs.notificationPrivacy === 'GENERIC'}
          value={prefs.notificationPrivacy}
          options={[{ value: 'FULL', label: 'Full content' }, { value: 'SENDER_ONLY', label: 'Sender only' }, { value: 'GENERIC', label: '"New WorkSuite notification"' }]}
          onValueChange={(v) => void updatePrefs({ notificationPrivacy: v })}
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
      {hasChat ? <WebchatRingingPrefs prefs={prefs} /> : null}
      <h3 className="mt-8 mb-1 text-[16px] font-bold text-ink">By app</h3>
      {/* Only the apps the person has; System alerts belong to no app and always show. */}
      {MODULE_TOGGLES.filter(([id]) => categoryVisible(id, visible)).map(([id, label]) => (
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

/**
 * Website chats ringing on this computer (RING-UI-08): the call window, Do
 * not disturb, the join shortcut, the ringtone, and starting with the
 * computer so a chat can ring before anything is opened (RING-48).
 */
function WebchatRingingPrefs({ prefs }: { prefs: Preferences }) {
  const r = prefs.webchatRinging;
  const set = (patch: Partial<Preferences['webchatRinging']>) => void updatePrefs({ webchatRinging: { ...r, ...patch } });
  const [testing, setTesting] = useState(false);
  const test = () => {
    if (testing) return;
    setTesting(true);
    const t = playTone('webchat', r.volume / 100);
    setTimeout(() => {
      t.stop();
      setTesting(false);
    }, 3_000);
  };
  return (
    <>
      <h3 className="mt-8 mb-1 text-[16px] font-bold text-ink">Website chats</h3>
      <p className="mb-1 text-[13px] text-ink-2">A chat from your websites rings on this computer until someone joins it — while WorkSuite runs, with its window closed too.</p>
      <Row label="Ring over other apps" hint="A small window at the bottom right, over full-screen apps where the system allows. Off: the bar under your tabs and the tray only.">
        <Switch label="Ring over other apps" checked={r.window} onChange={(v) => set({ window: v })} />
      </Row>
      <Row label="During Do not disturb" hint="Quiet hours, or notifications paused.">
        <Select
          label="During Do not disturb"
          value={r.duringDnd}
          options={[
            { value: 'card', label: 'Show the window, no sound' },
            { value: 'at_risk', label: 'Ring only when a chat is at risk' },
            { value: 'ring', label: 'Ring as usual' },
          ]}
          onValueChange={(v) => set({ duringDnd: v })}
        />
      </Row>
      <Row label={`Join with ${isMac ? '⌘⇧J' : 'Ctrl+Shift+J'}`} hint="From any app, while a chat is ringing. Released as soon as nothing rings.">
        <Switch label="Join shortcut" checked={r.shortcut} onChange={(v) => set({ shortcut: v })} />
      </Row>
      <Row label="Ringtone volume" hint="At risk, high, urgent and VIP chats use a stronger tone.">
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={100} step={5} value={r.volume} aria-label="Ringtone volume" onChange={(e) => set({ volume: Number(e.target.value) })} className="w-40" />
          <Button onClick={test} disabled={testing}>
            {testing ? 'Ringing…' : 'Test'}
          </Button>
        </div>
      </Row>
      <Toggle k="startWithOs" prefs={prefs} label="Start WorkSuite with this computer" hint="So website chats can ring before you open anything." />
    </>
  );
}

const WEBSITE = 'https://worksuiteone.com/';

const DISPLAY_HINT: Record<AiDisplay, string> = {
  drawer: 'The AI button in the header opens the assistant beside your tabs.',
  widget: 'An Ask AI button in the bottom-right corner opens the assistant over your work. Minimize it and the conversation keeps going.',
  hidden: 'No button anywhere. The keyboard shortcut and the command palette still open it.',
};

/**
 * Settings › AI Assistant (AI Assistant — Web + Desktop UIs, page 3): how the
 * assistant works on this computer. It sees only what it is given, and never
 * sends anything without the person.
 */
export function AiSection({ prefs }: { prefs: Preferences }) {
  const a = prefs.ai;
  const set = (patch: Partial<Preferences['ai']>) => void updatePrefs({ ai: { ...a, ...patch } });
  const writer = useWriter();
  const held = useQuery({ queryKey: ['quickask', 'shortcut', a.quickAsk, a.shortcut], queryFn: () => call('quickask:context').then((c) => c.shortcut), retry: false });
  const languages = writer.data?.languages?.length ? writer.data.languages : [a.language];
  const taken = a.quickAsk && held.isSuccess && held.data === null;
  return (
    <>
      <H title="AI Assistant" hint="How the assistant works on this computer. It only sees what you give it and never sends anything without you." />
      {writer.isError || (writer.data && !writer.data.available) ? (
        <p className="mb-2 rounded-[10px] bg-warning-bg px-3 py-2 text-[13px] text-[#7A4308] dark:text-warning">{writer.isError ? writerProblem(writer.error) : 'No AI connection is configured for this workspace yet.'}</p>
      ) : null}
      <Row label="Display mode" hint={DISPLAY_HINT[a.display]}>
        <Select<AiDisplay>
          label="Display mode"
          value={a.display}
          options={[
            { value: 'drawer', label: 'Header icon & drawer' },
            { value: 'widget', label: 'Floating chat widget' },
            { value: 'hidden', label: 'Hidden' },
          ]}
          onValueChange={(v) => set({ display: v })}
        />
      </Row>
      <Row
        label="Allow online fallback"
        hint={
          a.onlineFallback
            ? 'The assistant answers on this computer when a model is installed. When it cannot (no model, a failure, or files and tabs, which only WorkSuite AI reads), WorkSuite AI answers instead, and your question and the content it needs are sent to it. Your permissions and Module Access apply either way.'
            : 'Only the model on this computer answers, and nothing you ask leaves it. Without one, or for files and tabs, the assistant says it cannot help.'
        }
      >
        <span data-guide="settings.online-fallback" className="inline-flex">
          <Switch label="Allow online fallback" checked={a.onlineFallback ?? true} onChange={(v) => set({ onlineFallback: v })} />
        </span>
      </Row>
      {a.display !== 'hidden' ? (
        <Row label={t('ai.autoMinimizeWorking')} hint={text('While the assistant is thinking, switching tabs, opening another app or clicking your work outside it puts it down to its floating button. The answer keeps coming, and the button tells you when it is ready. It stays open while you are typing in it.')}>
          <Switch label={t('ai.autoMinimizeWorking')} checked={a.autoMinimizeWhenWorking ?? true} onChange={(v) => set({ autoMinimizeWhenWorking: v })} />
        </Row>
      ) : null}
      {a.display === 'widget' ? (
        <Row label="Auto-minimize after sending" hint="The widget goes down to its button once you send a question. The answer keeps coming, and the button tells you when it is ready.">
          <Switch label="Auto-minimize after sending" checked={a.autoMinimize ?? false} onChange={(v) => set({ autoMinimize: v })} />
        </Row>
      ) : null}
      <Row label="Sound for new answers" hint="A short chime when an answer arrives while the assistant is closed or minimized. Off while notifications are off, paused or in Do not disturb.">
        <Switch label="Sound for new answers" checked={a.sound} onChange={(v) => set({ sound: v })} />
      </Row>
      <Row label="Quick Ask" hint="Opens over any app with the text you have selected there. The selection is read only when you press the shortcut.">
        <Switch label="Quick Ask" checked={a.quickAsk} onChange={(v) => set({ quickAsk: v })} />
      </Row>
      {a.quickAsk ? (
        <Row label="Quick Ask shortcut" hint={taken ? 'Another app already uses this shortcut. Choose another.' : undefined}>
          <Select
            label="Quick Ask shortcut"
            value={a.shortcut}
            options={QUICK_ASK_SHORTCUTS.map((k) => ({ value: k, label: shortcutLabel(k, isMac) }))}
            onValueChange={(v) => set({ shortcut: v })}
          />
        </Row>
      ) : null}
      <Row label="Insert results into other apps" hint="Pastes only when you click Insert, into the app Quick Ask was opened over.">
        <Switch label="Insert results into other apps" checked={a.insert} onChange={(v) => set({ insert: v })} />
      </Row>
      {a.display !== 'hidden' ? (
        <Row label="Open the AI Assistant at start-up" hint={a.display === 'widget' ? 'Open the floating widget when WorkSuite starts.' : 'Show the assistant beside every tab.'}>
          <Switch label="Open the AI Assistant at start-up" checked={a.dockAtStart} onChange={(v) => set({ dockAtStart: v })} />
        </Row>
      ) : null}
      <Row label="Language for translations" hint="Where Translate goes unless you choose another.">
        <Select label="Language for translations" value={a.language} options={languages.map((l) => ({ value: l, label: l }))} onValueChange={(v) => set({ language: v })} />
      </Row>
      {isMac ? (
        <p className="mt-4 text-[12.5px] text-ink-3">To read your selection in other apps, and to insert into them, WorkSuite needs System Settings › Privacy &amp; Security › Accessibility. Without it Quick Ask uses what you copied last.</p>
      ) : null}
      <p className="mt-2 text-[12.5px] text-ink-3">Files from this computer, summaries of WorkSuite files and actions waiting for your confirmation arrive when the assistant's desktop service does.</p>
      <ModuleAccess prefs={a.moduleAccess ?? { worksuite: {}, local: {} }} onChange={(moduleAccess) => set({ moduleAccess })} />
    </>
  );
}

export function SecuritySection({ prefs }: { prefs: Preferences }) {
  const { navigate } = useTab();
  const lock = isLocked('appLockMinutes');
  const enabled = prefs.appLockEnabled === true;
  const lockState = useStore(app, (s) => s.lock);
  const max = useStore(app, (s) => s.bootstrap?.policy.app_lock_max_minutes ?? 0);
  const [verify, setVerify] = useState<'disable' | null>(null);
  const [custom, setCustom] = useState(![0, 1, 5, 15, 30].includes(prefs.appLockMinutes));
  const [minutes, setMinutes] = useState(String(prefs.appLockMinutes || 15));
  const options = [0, 1, 5, 15, 30].filter((m) => !max || m <= max).map((m) => ({ value: String(m), label: m === 0 ? 'Immediately' : `${m} minute${m === 1 ? '' : 's'}` }));
  options.push({ value: 'custom', label: 'Custom' });
  return (
    <>
      <H
        title="Security → Lock Screen"
        hint="WorkSuite’s app lock protects its windows. These controls do not change or bypass your operating system’s lock screen. Preferences are saved for your account on this device."
      />
      <Row label="Enable Lock Screen" lock={isLocked('appLockEnabled')}>
        <Switch
          label="Enable Lock Screen"
          checked={enabled}
          disabled={!!isLocked('appLockEnabled')}
          onChange={(v) => (v ? void updatePrefs({ appLockEnabled: true }) : setVerify('disable'))}
        />
      </Row>
      {verify ? (
        <VerifyLockChange
          title="Disable Lock Screen"
          onClose={() => setVerify(null)}
          action={async (password) => {
            const result = await call('settings:set', { appLockEnabled: false, verificationPassword: password });
            app.set({ prefs: result.preferences, locks: result.locks });
          }}
        />
      ) : null}
      <fieldset disabled={!enabled}>
        <Row label="Automatically lock after" hint="Immediately locks when all WorkSuite windows lose focus; other intervals measure inactivity in WorkSuite." lock={lock}>
          <Select
            label="App lock"
            disabled={!enabled}
            value={custom ? 'custom' : String(prefs.appLockMinutes)}
            options={options}
            onValueChange={(v) => {
              setCustom(v === 'custom');
              if (v !== 'custom') void updatePrefs({ appLockMinutes: Number(v) });
            }}
          />
        </Row>
        {custom ? (
          <Row label="Custom timeout" hint={`Whole minutes from 1 to ${max || 1440}.`}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(minutes);
                if (Number.isInteger(n) && n >= 1 && n <= (max || 1440)) void updatePrefs({ appLockMinutes: n });
              }}
            >
              <TextField label="Minutes" type="number" min={1} max={max || 1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              <Button type="submit">Save</Button>
            </form>
          </Row>
        ) : null}
        <Toggle k="lockOnSystemLock" prefs={prefs} label="Lock after operating-system lock" disabled={!enabled} />
        <Toggle k="lockOnSleep" prefs={prefs} label="Lock after computer sleep" disabled={!enabled} />
      </fieldset>
      <H
        title="Notifications While Locked"
        hint="Message delivery and unread counts keep working when banners are hidden. Message content is hidden by default. Organization privacy policies still apply."
      />
      <Toggle k="lockedChatNotifications" prefs={prefs} label="Chat notifications" />
      <Toggle k="lockedCallNotifications" prefs={prefs} label="Incoming calls and ringing" />
      <Toggle k="lockedShowCallerDetails" prefs={prefs} label="Show caller names" />
      <Toggle k="lockedNotificationSender" prefs={prefs} label="Show sender names" />
      <Toggle k="lockedNotificationPreview" prefs={prefs} label="Message previews" hint="Never shows more than Notifications › What banners show or your organization allows." />
      <Toggle k="lockedNotificationSounds" prefs={prefs} label="Notification sounds while locked" />
      <H title="Access While Locked" hint="Restricted access remains subject to your organization’s policy." />
      <Toggle k="lockedAnswerCalls" prefs={prefs} label="Answer Calls While Locked" />
      <Toggle
        k="lockedAllowChat"
        prefs={prefs}
        label="Allow Chat While Locked"
        hint="Opens a restricted chat window from a notification. Off: unlock before opening the conversation."
      />
      <PinRow set={!!lockState?.pin} />
      <Row
        label="Unlock with"
        hint={`Your WorkSuite password${lockState?.pin ? ', your PIN' : ''}${lockState?.biometric === 'touch-id' ? ' or Touch ID' : ''}.${lockState?.biometric === 'touch-id' ? '' : ' Windows Hello support is planned.'}`}
      >
        <Button icon="lock" onClick={() => void call('security:lock')}>
          Lock now
        </Button>
      </Row>
      <Row label="Your account's security" hint="Password, two-factor, passkeys, and where you're signed in.">
        <Button icon="lock" onClick={() => navigate('/account/security')}>
          Open My account › Security
        </Button>
      </Row>
    </>
  );
}

function VerifyLockChange({ title, action, onClose }: { title: string; action: (password: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action(password);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!password} loading={busy} onClick={() => void save()}>
            Verify and continue
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="WorkSuite password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Verify your identity before changing protection on this device."
        />
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/** A PIN for the app lock on this computer: quicker than the password, and it works offline. */
function PinRow({ set }: { set: boolean }) {
  const [open, setOpen] = useState(false);
  const [remove, setRemove] = useState(false);
  return (
    <Row
      label="PIN"
      hint={set ? 'Unlocks WorkSuite on this computer, also offline. Five wrong tries sign you out.' : 'Set a 4 to 8 digit PIN to unlock WorkSuite on this computer, also offline.'}
    >
      <div className="flex gap-2">
        <Button data-guide="settings.set-pin" icon="lock" onClick={() => setOpen(true)}>
          {set ? 'Change PIN' : 'Set PIN'}
        </Button>
        {set ? (
          <Button variant="ghost" onClick={() => setRemove(true)}>
            Remove
          </Button>
        ) : null}
      </div>
      {remove ? (
        <VerifyLockChange
          title="Remove PIN"
          onClose={() => setRemove(false)}
          action={async (password) => {
            await call('security:clearPin', { password });
            toast('success', 'PIN removed.');
          }}
        />
      ) : null}
      {open ? <PinDialog change={set} onClose={() => setOpen(false)} /> : null}
    </Row>
  );
}

function PinDialog({ change, onClose }: { change: boolean; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  const mismatch = again.length >= pin.length && again !== pin;
  const ready = /^\d{4,8}$/.test(pin) && pin === again && !!password;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('security:setPin', { pin, password });
      if (!r.ok) setError(r.message);
      else {
        toast('success', change ? 'PIN changed.' : 'PIN set. Use it to unlock WorkSuite on this computer.');
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={change ? 'Change PIN' : 'Set a PIN'}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>
            {change ? 'Change PIN' : 'Set PIN'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="New PIN (4–8 digits)" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        <TextField
          label="Confirm PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={again}
          onChange={(e) => setAgain(digits(e.target.value))}
          error={mismatch ? 'The PINs do not match.' : null}
        />
        <TextField
          label="WorkSuite password"
          type="password"
          autoComplete="current-password"
          hint="To check it is you."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
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
          onValueChange={(v) => void call('updates:setChannel', { channel: v }).catch((e) => toast('error', errorMessage(e)))}
        />
      </Row>
      <Row label="Tab suspension" hint="Tabs you haven't looked at for this long are unloaded to save memory, and reload when you return.">
        <Select label="Tab suspension" value={prefs.tabSuspendMinutes} options={[15, 30, 60, 120, 480].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }))} onValueChange={(v) => void updatePrefs({ tabSuspendMinutes: v })} />
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

function FilesSection() {
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
                  <Button size="sm" icon="refresh" loading={busy === 'now'} disabled={sync.paused} onClick={() => run('now', call('sync:now'))}>
                    Sync now
                  </Button>
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

const TIER_WORDS = { minimal: 'Minimal', basic: 'Basic', good: 'Good', strong: 'Strong' } as const;
const RUNTIME_WORDS = { off: 'Off (starts when asked)', starting: 'Starting…', ready: 'Ready', loading: 'Loading the model…', busy: 'Answering…', error: 'Stopped' } as const;

/**
 * AI Studio: the models the assistant answers with through WorkSuite (the server's connection to
 * aistudio.livezentech.com). Anyone with `ai.view` sees the connection and may try a model; `ai.settings` may
 * ask the hub which models this key can run and choose the ones this workspace offers.
 */
function AIStudioBlock() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const has = (p: string) => !!perms && (perms.includes('*') || perms.includes(p));
  const status = useStudioStatus(has('ai.view'));
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<StudioDiscovery | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  if (!has('ai.view')) return null;
  const st = status.data;
  const state = studioState(st);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: STUDIO_KEY });
  const test = (m: string) => {
    setBusy(`t:${m}`);
    testStudioModel(m)
      .then((r) => toast(r.ok ? 'success' : 'error', r.ok ? `${m} answers.` : `${m}: ${r.detail}`))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  const discover = () => {
    setBusy('discover');
    discoverStudioModels()
      .then((r) => {
        setFound(r);
        setPicked(Array.from(new Set([...r.selected.filter((m) => r.available.includes(m)), ...r.available])));
        if (!r.available.length) toast('error', 'AI Studio has no model this key may run yet.');
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  const save = () => {
    setBusy('save');
    setStudioModels(picked)
      .then(() => {
        toast('success', picked.length === 1 ? 'The assistant offers 1 AI Studio model.' : `The assistant offers ${picked.length} AI Studio models.`);
        setFound(null);
        refresh();
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  return (
    <>
      <Row
        label="AI Studio"
        hint={status.error ? errorMessage(status.error) : st ? (st.connected ? 'The assistant answers with these models through WorkSuite when it is not using one on this computer.' : st.detail) : 'Checking…'}
      >
        <div className="flex items-center gap-2">
          <Chip tone={state.tone}>{state.word}</Chip>
          <Button size="sm" icon="refresh" loading={status.isFetching} onClick={refresh}>
            Check
          </Button>
        </div>
      </Row>
      {st && st.models.length ? (
        <div className="border-b border-line py-2">
          {st.models.map((m) => (
            <div key={m} className="flex items-center gap-3 py-1.5">
              <Icon name="cpu" size={15} className="text-ink-3" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{m}</span>
              <Button size="sm" variant="ghost" loading={busy === `t:${m}`} onClick={() => test(m)}>
                Test
              </Button>
            </div>
          ))}
        </div>
      ) : st ? (
        <p className="border-b border-line py-2.5 text-[12.5px] text-ink-3">
          {has('ai.settings') ? 'This workspace offers no AI Studio model yet. Find the models already downloaded on AI Studio and choose which to offer.' : 'This workspace offers no AI Studio model yet. An administrator chooses them.'}
        </p>
      ) : null}
      {has('ai.settings') && st?.configured ? (
        <div className="border-b border-line py-2.5">
          {!found ? (
            <Button size="sm" icon="search" loading={busy === 'discover'} onClick={discover}>
              Find models on AI Studio
            </Button>
          ) : (
            <>
              <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Models this key may run — tick the ones the assistant offers</div>
              {found.available.length ? (
                found.available.map((m) => (
                  <label key={m} className="flex items-center gap-2 py-1 text-[13px] text-ink">
                    <Checkbox checked={picked.includes(m)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m] : p.filter((x) => x !== m)))} aria-label={m} />
                    <span className="font-mono">{m}</span>
                  </label>
                ))
              ) : (
                <p className="text-[12.5px] text-ink-3">None yet. {Object.values(found.results).find((r) => !r.ok)?.detail ?? ''}</p>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" disabled={!found.available.length} loading={busy === 'save'} onClick={save}>
                  Offer these
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFound(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/** Local AI (WS-SRS-LAI): AI Studio's models through WorkSuite, and the same models downloaded to answer on this computer, also offline. */
export function LocalAISection() {
  const status = useLocalAIStatus();
  const models = useLocalModels();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, p: Promise<unknown>, ok?: string) => {
    setBusy(key);
    void p
      .then(() => {
        if (ok) toast('success', ok);
        void queryClient.invalidateQueries({ queryKey: LOCAL_AI_KEY });
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  const st = status.data;
  const hw = st?.hardware;
  const chat = (models.data ?? []).filter((m) => m.model.purpose === 'chat');
  return (
    <>
      <H title="Local AI" hint="The assistant answers with AI Studio's models through WorkSuite, or with one downloaded to this computer — then nothing is sent to a server, also offline. A download is checked against the file WorkSuite names before it is used." />
      <AIStudioBlock />
      <h3 className="mt-2 mb-2 text-[14px] font-bold text-ink">Speech — meeting transcripts</h3>
      <SpeechModelSettings />
      <Row
        label="This computer"
        hint={hw ? `${hw.cpuCores} cores · ${bytes(hw.memoryBytes)} memory${hw.gpu ? ` · GPU (${hw.gpu})${hw.vramBytes ? ` ${bytes(hw.vramBytes)}` : ''}` : ' · CPU only until Local AI first starts'}${hw.freeDiskBytes !== null ? ` · ${bytes(hw.freeDiskBytes)} free` : ''}` : 'Checking…'}
      >
        {hw ? <Chip tone={hw.tier === 'minimal' ? 'warning' : 'indigo'}>{TIER_WORDS[hw.tier]} tier</Chip> : null}
      </Row>
      <Row label="Local AI" hint={st?.error ?? (st?.loaded ? `Model loaded: ${chat.find((m) => m.model.id === st.loaded)?.model.name ?? st.loaded}` : 'The model loads on the first question and unloads after 10 idle minutes.')}>
        <div className="flex items-center gap-2">
          {st ? <Chip tone={st.runtime === 'error' ? 'danger' : st.runtime === 'off' ? 'muted' : 'success'}>{RUNTIME_WORDS[st.runtime]}</Chip> : null}
          <Button size="sm" icon="refresh" loading={busy === 'restart'} onClick={() => run('restart', call('ai:localRestart'), 'Local AI restarted.')}>
            Restart
          </Button>
        </div>
      </Row>
      <Row label="Models to download" hint={st?.catalogError ?? (st?.catalogAt ? `AI Studio's models, from your WorkSuite server — checked ${relative(st.catalogAt)}.` : 'Not checked yet.')}>
        <Button size="sm" icon="refresh" loading={busy === 'catalog'} onClick={() => run('catalog', call('ai:localRefresh'))}>
          Check for models
        </Button>
      </Row>

      <h3 className="mb-1 mt-6 text-[14px] font-bold text-ink">Models on this computer</h3>
      {models.isLoading ? <p className="text-[12.5px] text-ink-3">Loading…</p> : null}
      {!models.isLoading && !chat.length ? <p className="text-[12.5px] text-ink-3">No models to download to this computer yet. The assistant still answers with AI Studio's models above.</p> : null}
      {chat.map((v) => {
        const m = v.model;
        const pct = m.bytes ? Math.min(100, Math.round((v.received / m.bytes) * 100)) : 0;
        return (
          <div key={m.id} className="border-b border-line py-3.5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
                  {m.name}
                  {v.recommended ? <Chip tone="indigo">Recommended</Chip> : null}
                  {v.isDefault ? <Chip tone="success">Default</Chip> : null}
                  {!v.fits ? <Chip tone="warning">May be slow here</Chip> : null}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  Version {m.version} · {bytes(m.bytes)} download · {m.quantization} · {m.contextLength.toLocaleString()} tokens
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  Needs about {bytes(m.minMemoryBytes)} of memory · {TIER_WORDS[m.tiers[0] ?? 'strong']} tier computers and up
                  {hw ? (v.fits ? ' · suits this computer' : ` · this computer has ${bytes(Math.max(hw.memoryBytes, hw.vramBytes))}`) : ''}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  Licence:{' '}
                  <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: m.license.url })}>
                    {m.license.name}
                  </button>
                  {v.state === 'available' || v.state === 'failed' ? ' — by downloading it you accept its terms.' : null}
                </div>
                {m.notice ? <p className="mt-1.5 rounded-[8px] bg-subtle px-2.5 py-1.5 text-[11.5px] leading-[1.5] text-ink-2">{m.notice}</p> : null}
                {v.error ? <div className="mt-1 text-[12.5px] text-danger">{v.error}</div> : null}
                {v.state === 'installed' && v.readiness === 'failed' ? (
                  <div className="mt-1 text-[12.5px] text-danger">It downloaded and matches its checksum, but did not answer on this computer: {v.readinessError}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {v.state === 'available' || v.state === 'failed' ? (
                  <Button data-guide="settings.local-ai-download" size="sm" icon="download" loading={busy === `i:${m.id}`} onClick={() => run(`i:${m.id}`, call('ai:localInstall', { id: m.id }))}>
                    {v.state === 'failed' ? 'Try again' : 'Download and set up'}
                  </Button>
                ) : null}
                {v.state === 'paused' ? (
                  <>
                    <Button size="sm" icon="play" onClick={() => run(`i:${m.id}`, call('ai:localInstall', { id: m.id }))}>
                      Resume
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(`c:${m.id}`, call('ai:localCancelInstall', { id: m.id, discard: true }))}>
                      Discard
                    </Button>
                  </>
                ) : null}
                {v.state === 'downloading' ? (
                  <>
                    <Button size="sm" icon="pause" onClick={() => run(`c:${m.id}`, call('ai:localCancelInstall', { id: m.id }))}>
                      Pause
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(`c:${m.id}`, call('ai:localCancelInstall', { id: m.id, discard: true }))}>
                      Cancel
                    </Button>
                  </>
                ) : null}
                {v.state === 'verifying' ? <Chip tone="indigo">Checking the file…</Chip> : null}
                {v.state === 'installed' && v.readiness === 'testing' ? <Chip tone="indigo">Setting up…</Chip> : null}
                {v.state === 'installed' && v.readiness === 'ready' ? <Chip tone="success">Ready to use</Chip> : null}
                {v.state === 'installed' && (v.readiness === 'failed' || v.readiness === 'untested') ? (
                  <Button size="sm" loading={busy === `t:${m.id}`} onClick={() => run(`t:${m.id}`, call('ai:localTest', { id: m.id }).then((ok) => toast(ok ? 'success' : 'error', ok ? `${m.name} is ready to use.` : `${m.name} did not answer on this computer.`)))}>
                    {v.readiness === 'failed' ? 'Test again' : 'Test'}
                  </Button>
                ) : null}
                {v.state === 'installed' && v.readiness !== 'testing' ? (
                  <>
                    {!v.isDefault && v.readiness !== 'failed' ? (
                      <Button size="sm" loading={busy === `d:${m.id}`} onClick={() => run(`d:${m.id}`, call('ai:localSetDefault', { id: m.id }), `${m.name} answers from now on.`)}>
                        Use this model
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" loading={busy === `k:${m.id}`} onClick={() => run(`k:${m.id}`, call('ai:localCheck', { id: m.id }).then((ok) => toast(ok ? 'success' : 'error', ok ? 'The file is intact.' : 'The file does not match. Remove it and download it again.')))}>
                      Check
                    </Button>
                    <Button size="sm" variant="ghost" icon="trash" loading={busy === `r:${m.id}`} onClick={() => run(`r:${m.id}`, call('ai:localRemove', { id: m.id }), `${m.name} removed.`)}>
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {v.state === 'downloading' || v.state === 'paused' ? (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className={cx('h-full rounded-full transition-[width]', v.state === 'paused' ? 'bg-ink-3' : 'bg-primary')} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11.5px] text-ink-3">
                  {v.state === 'paused' ? 'Paused' : 'Downloading'} · {bytes(v.received)} of {bytes(m.bytes)} ({pct}%)
                  {v.state === 'downloading' && secondsLeft(v) !== null ? ` · ${timeLeftLabel(secondsLeft(v))}` : ''}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
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

/** Settings › Meet (worksuite-desktop#68): how meetings are recorded from this computer. */
function MeetSection() {
  return (
    <>
      <H title="Meet" hint="Meetings on this computer." />
      <h3 className="mt-2 mb-3 text-[14px] font-bold text-ink">Recording</h3>
      <RecordingSettings />
      <h3 className="mt-6 mb-3 text-[14px] font-bold text-ink">Livestreaming</h3>
      <LivestreamDestinations />
      <h3 className="mt-6 mb-3 text-[14px] font-bold text-ink">Transcription</h3>
      <SpeechModelSettings />
    </>
  );
}

/** RC09: whether others can control this computer in a meeting, and what it needs to. */
export function methodLabel(method: string | null): string {
  return method === 'sendinput' ? 'Windows input (SendInput, through PowerShell)' : method === 'cgevent' ? 'macOS events (CGEvent, through osascript)' : method === 'xdotool' ? 'xdotool (X11)' : 'None';
}

/** A fresh remote-control state, in place of any older answer still on its way. */
async function fresh(next: Awaited<ReturnType<typeof call<'rc:recheck'>>>): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ['rc-state'] });
  queryClient.setQueryData(['rc-state'], next);
}

/** While Accessibility is not yet granted, it is asked again this often (worksuite-desktop#147). */
export const RC_RECHECK_MS = 2_000;

function yesNo(v: boolean | null | undefined): string {
  return v === null || v === undefined ? text('Unable to verify') : v ? text('Granted') : text('Denied');
}

/** Why macOS may not be applying the entry in System Settings to this running copy. */
function IdentityWarnings({ identity }: { identity: RemoteControlIdentity | null | undefined }) {
  if (!identity) return null;
  const warnings: string[] = [];
  if (identity.development) warnings.push(text('This is a development build. macOS gives its Accessibility access to Electron or to the app that started it, such as Terminal — not to WorkSuite.'));
  if (identity.translocated) warnings.push(text('macOS is running WorkSuite from a temporary location because it was opened where it was downloaded. Move WorkSuite to Applications, open it from there, then allow it again.'));
  if (identity.otherInstalledCopy) warnings.push(text('Another copy of WorkSuite is in Applications. The entry in System Settings may belong to that copy, not to this one.'));
  if (identity.adhoc && !identity.development) warnings.push(text('This copy of WorkSuite is not signed with a Developer ID, so macOS ties Accessibility to this exact build. After an update the old entry stays on but no longer applies: remove WorkSuite from the list and add it again.'));
  if (warnings.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2" data-testid="rc-identity-warnings">
      {warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}

export function RemoteControlSection() {
  const q = useQuery({ queryKey: ['rc-state'], queryFn: () => call('rc:state'), refetchInterval: 5_000 });
  const v = q.data;
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [verifyError, setVerifyError] = useState(false);
  /** A fresh check of the app and its helper. `quiet` (the 2-second poll) keeps the last answer on screen meanwhile. */
  const recheck = async (quiet = false) => {
    if (quiet && inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true;
    if (!quiet) {
      setChecking(true);
      setVerifyError(false);
    }
    try {
      await queryClient.cancelQueries({ queryKey: ['rc-state'] });
      const next = await call('rc:recheck');
      if (request === generation.current) {
        await fresh(next);
        setVerifyError(false);
      }
    } catch {
      if (request === generation.current && !quiet) setVerifyError(true);
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setChecking(false);
      }
    }
  };
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void recheck(); });
    const back = () => { if (document.visibilityState === 'visible') void recheck(); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    // The main process checks again when WorkSuite becomes the active app, and says so.
    const off = on<RemoteControlView>('rc:changed', (next) => {
      if (!inFlight.current) void fresh(next);
    });
    return () => {
      mounted = false;
      // The ref is a request counter, not a DOM node. Invalidate outstanding replies.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      inFlight.current = false;
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
      off();
    };
  }, []);
  const s = v?.support;
  // The banner asks for access: keep asking macOS every two seconds while it is on screen, and stop once granted.
  const waiting = !!s && (s.accessibility === 'denied' || s.accessibility === 'unknown');
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recheck(true);
    }, RC_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [waiting]);
  const set = async (value: boolean) => {
    try {
      await call('rc:setAllowRequests', { value });
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const restart = async () => {
    setRestarting(true);
    try {
      await call('rc:restart');
    } catch (e) {
      setRestarting(false);
      toast('error', errorMessage(e));
    }
  };
  if (!v || !s) return <>
    <H title="Remote control" />
    <p className="text-ink-2">{checking ? text('Checking Accessibility access…') : text('Unable to verify Accessibility access')}</p>
    <Button size="sm" variant="ghost" loading={checking} onClick={() => void recheck()}>Check again</Button>
  </>;
  const pending = checking || s.accessibility === 'checking';
  const unknown = verifyError || s.accessibility === 'unknown';
  const works = s.available && s.policyAllows && !pending && !unknown;
  const hint = !pending && !unknown && s.accessibility === 'denied' ? (s.accessibilityHint ?? null) : null;
  const d = s.accessibilityDetails;
  const id = d?.identity ?? null;
  const headline = pending
    ? text('Checking Accessibility access…')
    : unknown
      ? text('Unable to verify Accessibility access')
      : hint === 'restart'
        ? text('Access granted — restart WorkSuite to finish')
        : hint === 'helper'
          ? text('WorkSuite has access, but its input helper does not')
          : works
            ? text('This computer can be controlled when you allow it')
            : text('This computer can be shared, but not controlled');
  return (
    <>
      <H title="Remote control" hint="When you share your screen in a meeting, others can ask to use your mouse and keyboard. Nothing happens until you allow it, on this computer, each time." />
      <div className={cx('mb-4 rounded-[12px] border p-4 text-[13.5px]', works || pending || unknown ? 'border-line bg-surface' : 'border-[#F1D9B5] bg-[#FFF9EC] dark:bg-warning-bg')} data-testid="rc-banner">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <Icon name={pending || unknown || hint === 'restart' ? 'refresh' : works ? 'shield-check' : 'warning'} size={17} className={works ? 'text-success' : 'text-warning'} />
          {headline}
        </div>
        {hint === 'restart' ? (
          <p className="mt-1.5 text-ink-2" data-testid="rc-accessibility-hint">
            macOS has given WorkSuite Accessibility access. Its input helper only receives it when WorkSuite starts again, so restart WorkSuite once to finish. Nothing else needs to change in System Settings.
          </p>
        ) : hint === 'helper' ? (
          <div className="mt-1.5 text-ink-2" data-testid="rc-accessibility-hint">
            <p>macOS still does not count WorkSuite’s input helper ({d?.helperPath ?? '/usr/bin/osascript'}) as part of WorkSuite after a restart. Usually another copy, or a stale entry, holds the permission.</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5">
              <li>Quit WorkSuite and open it from the Applications folder in Finder — not from Terminal, a download folder or the disk image.</li>
              <li>In Privacy &amp; Security › Accessibility, select WorkSuite and click − to remove it. Click +, choose WorkSuite in Applications and turn it on.</li>
              <li>Restart WorkSuite, then check again.</li>
            </ol>
          </div>
        ) : !works && !pending && !unknown ? (
          <p className="mt-1.5 text-ink-2">{!s.policyAllows ? text("Your organization's policy for this computer doesn't allow it.") : s.reason}</p>
        ) : works && s.reason ? (
          <p className="mt-1.5 text-ink-2">{s.reason}</p>
        ) : null}
        {!pending && !unknown && s.accessibility === 'granted' ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-ink-2" data-testid="rc-accessibility">
            <Icon name="check" size={14} className="text-success" /> Accessibility access enabled
          </p>
        ) : null}
        {!pending && !unknown && s.accessibility === 'denied' && !hint ? <p className="mt-1.5 text-ink-2">Permission required</p> : null}
        {unknown ? <p className="mt-1.5 text-ink-2">{d?.problem ?? text('The permission check did not complete. Check again to retry.')}</p> : null}
        {!works && !pending ? <IdentityWarnings identity={id} /> : null}
        {s.accessibility !== 'not_required' ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {hint ? (
              <Button size="sm" icon="refresh" loading={restarting} onClick={() => void restart()}>
                Restart WorkSuite
              </Button>
            ) : null}
            {s.accessibility === 'denied' && hint !== 'restart' ? (
              <Button size="sm" variant={hint ? 'ghost' : undefined} onClick={() => void call('media:privacySettings', { pane: 'accessibility' })}>
                Open Accessibility settings
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="refresh" loading={checking} onClick={() => void recheck()}>
              Check again
            </Button>
          </div>
        ) : null}
        {waiting ? <p className="mt-2 text-[12px] text-ink-3" data-testid="rc-auto-check">WorkSuite checks again every few seconds while this message is shown, and when you come back to it.</p> : null}
        {d ? (
          <details className="mt-2 text-[12px] text-ink-3" data-testid="rc-details">
            <summary className="cursor-pointer">Running app and input-helper checks</summary>
            <p className="break-all selectable">{text('Running copy: {path}', { path: id?.bundle ?? d.runningApp })}</p>
            {id ? (
              <p className="selectable">
                {text('Bundle ID: {id}', { id: id.bundleId ?? text('unknown') })} · {text('Team ID: {team}', { team: id.teamId ?? text('not set') })} · {text('Signed by: {who}', { who: id.signingUnavailable ? text('Unable to verify') : id.adhoc ? text('ad-hoc (no Developer ID)') : (id.authority ?? text('unknown')) })}
              </p>
            ) : null}
            <p>
              {text('App Accessibility: {state}.', { state: yesNo(d.appTrusted) })} {text('Helper Accessibility: {state}.', { state: yesNo(d.helperAccessibility) })} {text('Helper event posting: {state}.', { state: yesNo(d.helperTrusted) })}
            </p>
            <p className="break-all">{text('Input helper: {path}, started by WorkSuite, so WorkSuite’s entry in Accessibility covers it. It is not listed separately.', { path: d.helperPath ?? '/usr/bin/osascript' })}</p>
            <p>Compare this running copy with the entry in macOS settings if more than one WorkSuite installation exists. Diagnostics include signing identity and app translocation checks.</p>
          </details>
        ) : null}
        {s.accessibility !== 'not_required' && s.accessibility !== 'granted' ? (
          <details className="mt-2 text-[12px] text-ink-3" data-testid="rc-still-denied">
            <summary className="cursor-pointer">Still shows Denied after turning WorkSuite on?</summary>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5">
              <li>Check that the running copy above is the WorkSuite in Applications, and open WorkSuite from there.</li>
              <li>Quit WorkSuite. In System Settings › Privacy &amp; Security › Accessibility, select WorkSuite and click − to remove it, then click + and choose WorkSuite in Applications. Turn it on.</li>
              <li>Open WorkSuite again. This screen updates by itself; you can also press Check again.</li>
              <li>
                If it still does not change, reset WorkSuite’s entry in Terminal with <code className="selectable font-mono">tccutil reset Accessibility {id?.bundleId ?? 'lk.worksuite.desktop'}</code>, then open WorkSuite and allow it again.
              </li>
            </ol>
          </details>
        ) : null}
        {s.accessibility !== 'not_required' ? (
          <p className="mt-2 text-[12px] text-ink-3">Accessibility only lets WorkSuite take input. Nobody controls this computer until you approve their request, each time.</p>
        ) : null}
      </div>
      <Row label="Let people ask to control my screen" hint="The starting choice each time you share; you can change it in the share picker.">
        <Switch label="Let people ask to control my screen" checked={v.allowRequests} disabled={!works} onChange={(x) => void set(x)} />
      </Row>
      <Row label="Emergency stop" hint="Ends control at once, whatever the other person is doing. It is never passed on to them.">
        <span className="font-mono text-[13px] text-ink">{v.emergencyChord}</span>
        {!v.chordRegistered ? <span className="ml-2 text-[12px] text-warning">Another app holds this shortcut — use Stop on the bar instead.</span> : null}
      </Row>
      <Row label="How input reaches this computer" hint="The system's own tools, started only while someone has control.">
        <span className="text-[13px] text-ink-2">{methodLabel(s.method)}</span>
      </Row>
      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
        While someone has control, a red bar stays at the top of your screen with Pause and Stop. Moving your own mouse always wins: their input waits until you stop. Control pauses by itself when the screen locks, the computer sleeps, or a password manager or system prompt comes to the front, and only you can resume it.
      </p>
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

export function About() {
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
      {/* Who makes WorkSuite (#48): the year is this year's, and the website opens in the default browser. */}
      <div className="mt-6 space-y-1 text-[13px] leading-[1.5] break-words text-ink-2">
        <p>WorkSuite is owned and developed by Livezen Technologies LLC.</p>
        <p>© {new Date().getFullYear()} Livezen Technologies LLC. All rights reserved.</p>
        <p>
          Website:{' '}
          <a
            href={WEBSITE}
            onClick={(e) => {
              e.preventDefault();
              void call('app:openExternal', { url: WEBSITE }).catch(() => undefined);
            }}
            className="font-semibold text-primary hover:underline"
          >
            worksuiteone.com
          </a>
        </p>
      </div>
      <p className="mt-4 text-[12px] text-ink-3">WorkSuite Desktop includes open-source software; licences are listed in the application's resources.</p>
    </>
  );
}
