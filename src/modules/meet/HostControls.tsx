import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Spinner, Switch, cx } from '../../components/ui';
import { DEFAULT_ROOM_SETTINGS, accessModeOf, guestsOf, type AccessMode, type MeetDefaultsView, type RoomSettings } from './api';
import type { ControlButton } from '../calls/ui/CoreCallControls';
import { mt, useMeetT, type MKey } from './i18n';
import { REACTIONS, meet } from './session';

/**
 * Host controls (worksuite-desktop#91): what participants may do in a
 * meeting and who may come in, in four groups — participant permissions,
 * chat, meeting access and activities.
 *
 * The same fields serve three places: the drawer in the meeting, where each
 * change is saved at once for everybody in it; "my defaults", which change
 * nothing that exists and are what the next meeting I start or schedule
 * begins with; and the scheduling form (`RoomSettingsFields`). The server
 * decides and enforces all of it — these screens only offer what it allows.
 */

type Patch = Partial<RoomSettings>;

/** One switch: what it reads in the settings, and the change it makes. */
interface Toggle {
  id: string;
  label: MKey;
  hint?: MKey;
  get: (s: RoomSettings) => boolean;
  set: (on: boolean, s: RoomSettings) => Patch;
  disabled?: (s: RoomSettings) => boolean;
}

/** A setting an older server leaves out reads as on. */
const flag = (key: keyof RoomSettings): Pick<Toggle, 'get' | 'set'> => ({
  get: (s) => s[key] !== false,
  set: (on) => ({ [key]: on }),
});

const PERMISSIONS: Toggle[] = [
  // Presenters keep the screen whatever this says: it is who else may share.
  { id: 'present', label: 'hc.screenShare', hint: 'hc.screenShareHint', get: (s) => s.present === 'everyone', set: (on) => ({ present: on ? 'everyone' : 'presenters' }) },
  { id: 'reactions', label: 'hc.reactions', hint: 'hc.reactionsHint', ...flag('reactions') },
  { id: 'microphone', label: 'hc.microphone', hint: 'hc.microphoneHint', ...flag('microphone') },
  { id: 'camera', label: 'hc.camera', hint: 'hc.cameraHint', ...flag('camera') },
];

const CHAT: Toggle[] = [
  // Chat off is off for everybody; back on, it is for everybody again.
  { id: 'chat', label: 'hc.chat', hint: 'hc.chatHint', get: (s) => s.chat !== 'off', set: (on) => ({ chat: on ? 'everyone' : 'off' }) },
  { id: 'chat-participants', label: 'hc.chatParticipants', hint: 'hc.chatParticipantsHint', get: (s) => s.chat === 'everyone', set: (on) => ({ chat: on ? 'everyone' : 'hosts' }), disabled: (s) => s.chat === 'off' },
];

const HOST_FIRST: Toggle = { id: 'host-first', label: 'hc.hostFirst', hint: 'hc.hostFirstHint', get: (s) => !s.join_before_host, set: (on) => ({ join_before_host: !on }) };
const INVITE: Toggle = { id: 'invite', label: 'hc.invite', hint: 'hc.inviteHint', get: (s) => s.invite === 'everyone', set: (on) => ({ invite: on ? 'everyone' : 'hosts' }) };

const MODES: Array<{ value: AccessMode; label: MKey; hint: MKey }> = [
  { value: 'open', label: 'hc.mode.open', hint: 'hc.mode.openHint' },
  { value: 'trusted', label: 'hc.mode.trusted', hint: 'hc.mode.trustedHint' },
  { value: 'restricted', label: 'hc.mode.restricted', hint: 'hc.mode.restrictedHint' },
];

const WHITEBOARD: Toggle = { id: 'whiteboard', label: 'hc.whiteboard', hint: 'hc.whiteboardHint', ...flag('whiteboard') };

/** Q&A, polls and raised hands (worksuite-desktop#92), under one heading. */
const SHARED: Toggle[] = [
  { id: 'qa', label: 'act.setting.qa', hint: 'act.setting.qaHint', ...flag('qa') },
  // Anonymous questions mean nothing with Q&A off.
  { id: 'qa-anonymous', label: 'act.setting.qaAnonymous', ...flag('qa_anonymous'), disabled: (s) => s.qa === false },
  { id: 'polls', label: 'act.setting.polls', ...flag('polls') },
  { id: 'raise-hand', label: 'act.setting.raiseHand', hint: 'act.setting.raiseHandHint', ...flag('raise_hand') },
];

const RECORDING: Toggle[] = [
  { id: 'recording', label: 'hc.recording', hint: 'hc.recordingHint', ...flag('recording') },
  { id: 'cohosts-record', label: 'hc.cohostsRecord', hint: 'hc.cohostsRecordHint', get: (s) => s.record === 'hosts', set: (on) => ({ record: on ? 'hosts' : 'host' }), disabled: (s) => s.recording === false },
  { id: 'transcription', label: 'hc.transcription', hint: 'hc.transcriptionHint', ...flag('transcription') },
  { id: 'transcripts', label: 'hc.transcripts', hint: 'hc.transcriptsHint', get: (s) => s.transcripts === 'participants', set: (on) => ({ transcripts: on ? 'participants' : 'hosts' }) },
];

/**
 * A change to who may come in also carries what it means in the settings
 * before the access modes (`access`, `waiting_room`), so a server that does
 * not know the modes yet still lets in about the same people.
 */
function withLegacy(patch: Patch, value: RoomSettings): Patch {
  if (!('access_mode' in patch) && !('guest_requests' in patch)) return patch;
  const next = { ...value, ...patch };
  const mode = accessModeOf(next);
  return { ...patch, access: mode === 'restricted' ? 'invited' : guestsOf(next) ? 'anyone' : 'signed_in', waiting_room: mode !== 'open' };
}

function Group({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2.5 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <span className="flex flex-col">
        <h3 id={`${id}-h`} className="text-[12px] font-bold tracking-[0.3px] text-ink-2 uppercase">
          {title}
        </h3>
        {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </section>
  );
}

function ToggleRow({ base, toggle, value, disabled, onChange }: { base: string; toggle: Toggle; value: RoomSettings; disabled?: boolean; onChange: (patch: Patch) => void }) {
  const t = useMeetT();
  const id = `${base}-${toggle.id}`;
  const label = t(toggle.label);
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={id} className="font-semibold text-ink">
          {label}
        </label>
        {toggle.hint ? (
          <span id={`${id}-hint`} className="text-[11.5px] text-ink-3">
            {t(toggle.hint)}
          </span>
        ) : null}
      </span>
      <Switch
        id={id}
        checked={toggle.get(value)}
        disabled={disabled || toggle.disabled?.(value)}
        label={label}
        describedBy={toggle.hint ? `${id}-hint` : undefined}
        onChange={(on) => onChange(toggle.set(on, value))}
      />
    </div>
  );
}

/**
 * The host controls as fields, in their groups. While scheduling and for my
 * defaults, `value` is a draft; in the meeting, each change is saved as it is made.
 */
export function HostControlsFields({ value: given, onChange, disabled }: { value: RoomSettings; onChange: (patch: Patch) => void; disabled?: boolean }) {
  const t = useMeetT();
  const base = useId();
  // A setting an older server does not send reads as its default.
  const value: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, ...given, access_mode: accessModeOf(given), guest_requests: guestsOf(given) };
  const mode = value.access_mode!;
  const change = (patch: Patch) => onChange(withLegacy(patch, value));
  const row = (toggle: Toggle, off?: boolean) => <ToggleRow key={toggle.id} base={base} toggle={toggle} value={value} disabled={disabled || off} onChange={change} />;
  const guestsHint = mode === 'restricted' ? t('hc.guestsRestricted') : mode === 'open' ? t('hc.guestsOpen') : t('hc.guestsTrusted');
  return (
    <div className="flex flex-col gap-4 text-[12.5px]">
      <Group id={`${base}-perm`} title={t('hc.group.permissions')} hint={t('hc.group.permissionsHint')}>
        {PERMISSIONS.map((x) => row(x))}
      </Group>
      <Group id={`${base}-chat`} title={t('hc.group.chat')}>
        {CHAT.map((x) => row(x))}
      </Group>
      <Group id={`${base}-access`} title={t('hc.group.access')}>
        {row(HOST_FIRST)}
        <fieldset disabled={disabled} className="flex flex-col gap-1.5">
          <legend className="mb-1 font-semibold text-ink">{t('hc.mode')}</legend>
          {MODES.map((m) => (
            <label key={m.value} className={cx('flex items-start gap-2 rounded-[9px] border px-2.5 py-2', mode === m.value ? 'border-primary bg-primary/5' : 'border-line')}>
              <input
                type="radio"
                name={`${base}-mode`}
                value={m.value}
                checked={mode === m.value}
                disabled={disabled}
                aria-describedby={`${base}-mode-${m.value}`}
                onChange={() => change({ access_mode: m.value })}
                className="mt-[3px] accent-primary"
              />
              <span className="flex min-w-0 flex-col">
                <b className="text-ink">{t(m.label)}</b>
                <span id={`${base}-mode-${m.value}`} className="text-[11.5px] text-ink-3">
                  {t(m.hint)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {/* A restricted meeting never takes guests: they cannot be on its invitation. */}
        <div className="flex items-start gap-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <label htmlFor={`${base}-guests`} className="font-semibold text-ink">
              {t('hc.guests')}
            </label>
            <span id={`${base}-guests-hint`} className="text-[11.5px] text-ink-3">
              {guestsHint}
            </span>
          </span>
          <Switch
            id={`${base}-guests`}
            checked={mode !== 'restricted' && !!value.guest_requests}
            disabled={disabled || mode === 'restricted'}
            label={t('hc.guests')}
            describedBy={`${base}-guests-hint`}
            onChange={(on) => change({ guest_requests: on })}
          />
        </div>
        {row(INVITE)}
      </Group>
      <Group id={`${base}-act`} title={t('hc.group.activities')}>
        {row(WHITEBOARD)}
        <h4 className="pt-1 font-bold text-ink-2">{t('hc.group.shared')}</h4>
        {SHARED.map((x) => row(x))}
        <span className="h-px bg-line" />
        {RECORDING.map((x) => row(x))}
      </Group>
    </div>
  );
}

/** This meeting: each change is saved at once and reaches everybody in it. */
function MeetingScope() {
  const t = useMeetT();
  // What was just switched shows at once, before the server answers; nothing is disabled meanwhile, so focus stays put.
  const [pending, setPending] = useState<Patch>({});
  const qc = useQueryClient();
  const value = { ...meet.settings, ...pending };

  const save = async (patch: Patch) => {
    setPending((p) => ({ ...p, ...patch }));
    try {
      await apiPut(`/api/meet/${meet.uuid}/settings`, patch);
      await meet.reload();
      qc.invalidateQueries({ queryKey: ['meet', meet.uuid, 'settings'] }).catch(() => undefined);
      toast('success', t('hc.saved'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setPending((p) => {
        const next = { ...p };
        for (const k of Object.keys(patch) as Array<keyof RoomSettings>) delete next[k];
        return next;
      });
    }
  };

  const asDefaults = async () => {
    try {
      const r = await apiPut<MeetDefaultsView>('/api/meet/defaults', meet.settings);
      qc.setQueryData(['meet', 'defaults'], r);
      toast('success', t('hc.savedDefaults'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <HostControlsFields value={value} disabled={!meet.canManage} onChange={(patch) => void save(patch)} />
      <Button onClick={() => void asDefaults()}>{t('hc.saveTheseAsDefaults')}</Button>
    </div>
  );
}

/** My defaults for new meetings: a draft, saved when I say so; this meeting does not change. */
function DefaultsScope() {
  const t = useMeetT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['meet', 'defaults'], queryFn: ({ signal }) => apiGet<MeetDefaultsView>('/api/meet/defaults', undefined, signal), retry: false });
  const [draft, setDraft] = useState<Patch>({});
  const [saving, setSaving] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data || q.data.available === false) return <p className="rounded-[9px] bg-subtle px-2.5 py-2 text-ink-2">{t('hc.defaultsUnavailable')}</p>;
  const value = { ...DEFAULT_ROOM_SETTINGS, ...q.data.settings, ...draft };
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const r = await apiPut<MeetDefaultsView>('/api/meet/defaults', value);
      qc.setQueryData(['meet', 'defaults'], r);
      setDraft({});
      toast('success', t('hc.savedDefaults'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <HostControlsFields value={value} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      <div className="flex items-center gap-2.5">
        <span role="status" className="min-w-0 flex-1 text-[11.5px] text-ink-3">
          {dirty ? t('hc.defaultsChanged') : !q.data.saved ? t('hc.defaultsUnsaved') : null}
        </span>
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
          {t('hc.saveAsDefaults')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The control bar's microphone and camera buttons. One the host turned off
 * for participants cannot be turned on, and says why — as its name and its
 * tooltip. One that is on can always be turned off.
 */
export function micControl(lp: { isMicrophoneEnabled: boolean }): ControlButton {
  if (!meet.mayMic && !lp.isMicrophoneEnabled) return { id: 'mic', icon: 'mic-off', label: mt('hc.off.microphone'), disabled: true };
  const on = lp.isMicrophoneEnabled;
  return { id: 'mic', icon: on ? 'mic' : 'mic-off', label: on ? 'Mute' : 'Unmute', tone: on ? undefined : 'warn', onClick: () => void meet.toggleMic() };
}

export function cameraControl(lp: { isCameraEnabled: boolean }): ControlButton {
  if (!meet.mayCamera && !lp.isCameraEnabled) return { id: 'camera', icon: 'video-off', label: mt('hc.off.camera'), disabled: true };
  const on = lp.isCameraEnabled;
  return { id: 'camera', icon: on ? 'video' : 'video-off', label: on ? 'Turn camera off' : 'Turn camera on', tone: on ? undefined : 'warn', onClick: () => void meet.toggleCamera() };
}

/** Reactions: a few, to everybody, while the host allows them. */
export function reactControl(): ControlButton {
  if (!meet.mayReact) return { id: 'react', icon: 'smile', label: mt('hc.off.reactions'), disabled: true };
  return { id: 'react', icon: 'smile', label: mt('hc.react'), menu: REACTIONS.map((e) => ({ label: e, hint: mt('hc.reactWith', { emoji: e }), onClick: () => meet.react(e) })) };
}

/** The Host controls button: the host and co-hosts only. */
export function hostControlsControl(open: boolean, toggle: () => void): ControlButton[] {
  return meet.canManage ? [{ id: 'host-controls', icon: 'shield', label: mt('hc.title'), tone: open ? 'active' : undefined, onClick: toggle }] : [];
}

type Scope = 'meeting' | 'defaults';

/**
 * The Host controls drawer, beside the meeting. A dialog that leaves the
 * meeting usable: focus moves to its heading as it opens and back to what
 * opened it as it closes; Escape closes it. The two scopes are tabs, so it is
 * always plain which one a switch changes.
 */
export function HostControlsDrawer({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const t = useMeetT();
  const id = useId();
  const [scope, setScope] = useState<Scope>('meeting');
  const heading = useRef<HTMLHeadingElement>(null);
  const tabs = useRef<Record<Scope, HTMLButtonElement | null>>({ meeting: null, defaults: null });
  // What had focus before, read while rendering — by the time an effect runs, focus may have moved.
  const [prev] = useState(() => (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null));

  useEffect(() => {
    heading.current?.focus();
    return () => {
      if (prev?.isConnected) prev.focus?.();
    };
  }, [prev]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  // Arrow keys move between the two tabs, as in any tab list.
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next: Scope = e.key === 'Home' ? 'meeting' : e.key === 'End' ? 'defaults' : scope === 'meeting' ? 'defaults' : 'meeting';
    setScope(next);
    tabs.current[next]?.focus();
  };

  const tab = (s: Scope, label: MKey) => (
    <button
      ref={(el) => {
        tabs.current[s] = el;
      }}
      type="button"
      role="tab"
      id={`${id}-tab-${s}`}
      aria-selected={scope === s}
      aria-controls={`${id}-panel`}
      tabIndex={scope === s ? 0 : -1}
      onClick={() => setScope(s)}
      onKeyDown={onTabKey}
      className={cx('h-8 flex-1 rounded-[7px] px-2 text-[12px] font-semibold', scope === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
    >
      {t(label)}
    </button>
  );

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      onKeyDown={onKeyDown}
      className="no-drag fixed top-0 right-0 bottom-0 z-[60] flex w-[min(400px,100vw)] flex-col border-l border-line bg-surface text-ink shadow-2xl"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Icon name="shield" size={17} className="text-primary" />
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="bare-focus flex-1 text-[14px] font-bold outline-none">
          {t('hc.title')}
        </h2>
        <button type="button" aria-label={t('hc.close')} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={16} />
        </button>
      </header>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-line px-3.5 py-2.5">
        <div role="tablist" aria-label={t('hc.scope')} className="flex gap-1 rounded-[9px] bg-subtle p-1">
          {tab('meeting', 'hc.scope.meeting')}
          {tab('defaults', 'hc.scope.defaults')}
        </div>
        <p className="text-[11.5px] text-ink-3">{t(scope === 'meeting' ? 'hc.scope.meetingHint' : 'hc.scope.defaultsHint')}</p>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${scope}`} className="min-h-0 flex-1 overflow-y-auto p-3.5 text-[12.5px] scroll-thin">
        {scope === 'meeting' ? <MeetingScope /> : <DefaultsScope />}
      </div>
    </section>
  );
}
