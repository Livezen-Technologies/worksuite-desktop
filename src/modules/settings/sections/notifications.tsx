import { type Preferences, FOLLOW_UP_DEFAULTS, type WebchatFollowUpPrefs } from '@shared/types';
import { useTab } from '../../../core/tab-context';
import { useVisibleIds } from '../../../core/access';
import { isLocked, app, updatePrefs } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { NotificationsOffBanner, TestChatNotification } from '../RingCheck';
import { Button, Switch } from '../../../components/ui';
import { Select } from '../../../components/Select';
import { call, errorMessage, isMac } from '../../../core/bridge';
import { categoryVisible } from '@shared/access';
import { toast } from '../../../core/toasts';
import { useState } from 'react';
import { useRingState } from '../../chat/website/Ringing';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { apiGet, request } from '../../../core/api';
import { ringtoneId, playTone, RINGTONES, type RingOn, playOnce } from '../../calls/tones';
import { Icon } from '../../../components/Icon';
import { H, Row, Toggle } from './parts';

/** Settings › Notifications, website chat ringing and follow-ups. */

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
  // Campaign notices (a campaign paused by the bounce guard) and callback reminders (MKT-DSK-01, MKT-CAL-12).
  ['marketing', 'Marketing'],
  // The Projects timer's idle prompt and Projects' banners with buttons (PRJ-DSK-02/03).
  ['projects', 'Projects timer and alerts'],
  ['system', 'System alerts'],
] as const;

export function NotificationsSection({ prefs }: { prefs: Preferences }) {
  const { navigate } = useTab();
  const visible = useVisibleIds();
  const lock = isLocked('notificationPrivacy');
  const paused = useStore(app, (s) => s.status?.notificationsPausedUntil);
  const hasChat = useStore(app, (s) => s.apps.some((a) => a.id === 'chat'));
  return (
    <>
      <H title="Notifications & calls" hint="How this computer shows notifications — even when WorkSuite's window is closed, from the tray." />
      <NotificationsOffBanner />
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
 * Website chat ringing on this computer (RING-UI-08, design P-02 "Desktop › Notifications & calls"): which device rings,
 * the ringtone and its test, where it plays, the call window, system Focus / Do not disturb, starting at login and
 * keeping to the tray (RING-48), and the shortcuts; then the volume, where to ring and the Live shortcuts.
 */
export function WebchatRingingPrefs({ prefs }: { prefs: Preferences }) {
  const r = prefs.webchatRinging;
  const set = (patch: Partial<Preferences['webchatRinging']>) => void updatePrefs({ webchatRinging: { ...r, ...patch } });
  const [testing, setTesting] = useState(false);
  const ring = useRingState();
  const qc = useQueryClient();
  // My ringtone and where my ring plays are kept on the server, for every device of mine (RING-10, RING-29); an older server has no say.
  const server = useQuery({ queryKey: ['website', 'ring-prefs'], queryFn: ({ signal }) => apiGet<{ prefs: { ring_where: RingWhere; ringtone?: string } }>('/api/chat/ring/prefs', undefined, signal), retry: false });
  const save = async (body: { ring_where?: RingWhere; ringtone?: string }) => {
    try {
      await request('PUT', '/api/chat/ring/prefs', { body });
      void qc.invalidateQueries({ queryKey: ['website', 'ring-prefs'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const ringtone = ringtoneId(server.data?.prefs.ringtone ?? ring.ringtone);
  const ringOn = r.ringOn ?? 'both';
  const test = () => {
    if (testing) return;
    setTesting(true);
    const t = playTone('webchat', r.volume / 100, { ringtone, ringOn });
    setTimeout(() => {
      t.stop();
      setTesting(false);
    }, 3_000);
  };
  const startLock = isLocked('startWithOs');
  const keys = (mac: string, other: string) => <kbd className="rounded-[6px] border border-line bg-subtle px-2 py-1 font-mono text-[12px] text-ink">{isMac ? mac : other}</kbd>;
  return (
    <>
      <h3 className="mt-8 mb-1 text-[20px] leading-tight font-bold text-ink">Website chat ringing on this computer</h3>
      <p className="mb-3 text-[14px] text-ink-2">A new website chat or visitor call rings here like a phone until someone joins.</p>
      {ring.ringHere === true ? (
        <p className="mb-3 flex items-center gap-3 rounded-[12px] border border-success/30 bg-success-bg px-4 py-3 text-[13px] text-success"><Icon name="check" size={18} /> This computer rings for you. Your browser tabs show the card silently.</p>
      ) : ring.ringHere === false ? (
        <p className="mb-3 flex items-center gap-3 rounded-[12px] border border-line bg-subtle px-4 py-3 text-[13px] text-ink-2"><Icon name="bell-off" size={18} /> Another of your devices rings for you. This computer shows the chat without sound.</p>
      ) : null}
      <div className="rounded-[12px] border border-line bg-surface px-[18px] [&>div:last-child]:border-b-0">
        <Row label="Ringtone">
          <div className="flex items-center gap-3">
            {server.isSuccess ? (
              <Select
                label="Ringtone"
                value={ringtone}
                className="w-[210px]"
                options={RINGTONES.map((t) => ({ value: t.id, label: t.label }))}
                onValueChange={(v) => void save({ ringtone: v })}
              />
            ) : null}
            <Button onClick={test} disabled={testing}>
              {testing ? 'Ringing…' : 'Test ring'}
            </Button>
          </div>
        </Row>
        <Row label="Ring on" hint="Speakers too, so you hear it with the headset off.">
          <Select<RingOn>
            label="Ring on"
            value={ringOn}
            className="w-[280px]"
            options={[
              { value: 'both', label: 'Speakers and headset' },
              { value: 'default', label: 'System output only' },
            ]}
            onValueChange={(v) => set({ ringOn: v })}
          />
        </Row>
        <Row label="Call window on top of other apps" hint="Bottom-right, even with WorkSuite closed to the tray.">
          <Switch label="Call window on top of other apps" checked={r.window} onChange={(v) => set({ window: v })} />
        </Row>
        <Row label="During Focus / Do not disturb" hint="The window still appears; this decides the sound.">
          <Select
            label="During Focus / Do not disturb"
            value={r.duringDnd}
            className="w-[280px]"
            options={[
              { value: 'card', label: 'Show the window without ringing' },
              { value: 'at_risk', label: 'Ring only when a chat is at risk' },
              { value: 'ring', label: 'Ring as usual' },
            ]}
            onValueChange={(v) => set({ duringDnd: v })}
          />
        </Row>
        <Row label="Start at login and keep in the tray" lock={startLock}>
          <Switch
            label="Start at login and keep in the tray"
            checked={prefs.startWithOs && prefs.minimizeToTray}
            disabled={!!startLock}
            onChange={(v) => void updatePrefs(v ? { startWithOs: true, minimizeToTray: true } : { startWithOs: false })}
          />
        </Row>
        <Row label="Shortcuts">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-[12px] text-ink-2">Join chat</span>
            {keys('⌘⇧J', 'Ctrl+Shift+J')}
            <span className="text-[12px] text-ink-2">Answer call</span>
            {keys('⌘⇧A', 'Ctrl+Shift+A')}
            <Switch label="Shortcuts" checked={r.shortcut} onChange={(v) => set({ shortcut: v })} />
          </div>
        </Row>
      </div>
      <Row label="Volume" hint="At risk, high, urgent and VIP chats use a stronger tone.">
        <input type="range" min={0} max={100} step={5} value={r.volume} aria-label="Volume" onChange={(e) => set({ volume: Number(e.target.value) })} className="w-40" />
      </Row>
      {server.isSuccess ? (
        <Row label="Where to ring" hint="Only one of your devices rings at a time.">
          <Select<RingWhere>
            label="Where to ring"
            value={server.data.prefs.ring_where}
            options={[
              { value: 'desktop_first', label: 'Desktop app when running, else browser' },
              { value: 'browser', label: 'The browser first' },
              { value: 'all', label: 'Every device' },
            ]}
            onValueChange={(v) => void save({ ring_where: v })}
          />
        </Row>
      ) : null}
      <Row label="Live map and dashboard" hint="From other apps, while WorkSuite is not in front.">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-[12px] text-ink-2">Live map</span>
          {keys('⌘⇧M', 'Ctrl+Shift+M')}
          <span className="text-[12px] text-ink-2">Live dashboard</span>
          {keys('⌘⇧D', 'Ctrl+Shift+D')}
          <Switch label="Live map and dashboard shortcuts" checked={r.liveShortcuts !== false} onChange={(v) => set({ liveShortcuts: v })} />
        </div>
      </Row>
      <TestChatNotification volume={r.volume} muted={!prefs.notificationSounds} ringtone={ringtone} ringOn={ringOn} />
      <FollowUpPrefs prefs={prefs} />
    </>
  );
}

/**
 * When a visitor writes again in a chat I have and I am away from it (worksuite-desktop#230): another module or app,
 * the window minimised or behind, the computer locked, or no input for a while.
 */
function FollowUpPrefs({ prefs }: { prefs: Preferences }) {
  const f = { ...FOLLOW_UP_DEFAULTS, ...prefs.webchatFollowUps };
  const set = (patch: Partial<WebchatFollowUpPrefs>) => void updatePrefs({ webchatFollowUps: { ...f, ...patch } });
  return (
    <>
      <h4 className="mt-6 mb-1 text-[14px] font-bold text-ink">When a visitor writes again in your chat</h4>
      <p className="mb-1 text-[13px] text-ink-2">While you are in another module or app, away from the computer, or the chat is not in front. Nothing is shown while you are reading it.</p>
      <Row label="Card over other apps" hint="Their new message and the one before it, a reply box, Open chat and Snooze 5 min.">
        <Switch label="Card over other apps" checked={f.card} onChange={(v) => set({ card: v })} />
      </Row>
      <Row label="Desktop notification" hint="While WorkSuite is not in front, with Reply. Several messages make one notification.">
        <Switch label="Desktop notification" checked={f.desktop} onChange={(v) => set({ desktop: v })} />
      </Row>
      <Row label="Chime" hint="A short sound, unlike the new-chat ring. Quiet during Do not disturb.">
        <div className="flex items-center gap-3">
          <Switch label="Chime" checked={f.sound} onChange={(v) => set({ sound: v })} />
          <Button onClick={() => playOnce('reply', prefs.webchatRinging.volume / 100)}>Test</Button>
        </div>
      </Row>
      <Row label="Count me away after" hint="With the chat open but no keyboard or mouse for this long.">
        <Select<WebchatFollowUpPrefs['idleMinutes']>
          label="Count me away after"
          value={f.idleMinutes}
          options={[
            { value: 1, label: '1 minute' },
            { value: 2, label: '2 minutes' },
            { value: 5, label: '5 minutes' },
            { value: 10, label: '10 minutes' },
          ]}
          onValueChange={(v) => set({ idleMinutes: v })}
        />
      </Row>
    </>
  );
}

/** Where a person's website-chat ring plays, kept on the server for all their devices (RING-10). */
type RingWhere = 'desktop_first' | 'browser' | 'all';
