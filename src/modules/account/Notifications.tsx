import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, Switch } from '../../components/ui';
import { input } from '../../components/PageKit';
import { K, useHasApp } from './api';
import { Card, Head, Note, SettingRow } from '../../components/CardKit';
import { computerZone, useZones } from './regional';
import { Checkbox } from '../../components/Checkbox';

/**
 * Notifications (my account's): whether anything reaches me, by which
 * channels, when it must not, and which kinds. Enforced on the server —
 * a switch here stops the notification before it is sent, on every device.
 * How this computer shows them (banners, privacy, pausing) is Settings ›
 * Notifications.
 *
 * `PUT /notifications/preferences` REPLACES the row: a partial body blanks
 * every column it leaves out, so every change sends the whole object.
 */
type Prefs = Record<string, unknown> & { categories?: Record<string, Record<string, boolean>> | unknown[] };

interface Channel {
  channel: string;
  label: string;
  available: boolean;
  message: string | null;
}

interface Payload {
  preferences: Prefs;
  catalogue: Array<{ key: string; label: string; events: Array<{ key: string; label: string }>; note: string | null }>;
  channels: Channel[];
}

const on = (v: unknown) => v === true || v === 1 || v === '1';

export default function Notifications() {
  const hasChat = useHasApp('chat');
  return (
    <div className="flex max-w-[1080px] flex-col gap-4">
      <Head title="Notifications" sub="What reaches you, how it reaches you, and when it must not." />
      <Note>
        These are your account’s, and apply everywhere you sign in. How this computer shows them — banners, what they reveal, pausing — is in{' '}
        <button type="button" className="font-bold underline" onClick={() => navigate('/settings/notifications')}>
          Settings › Notifications
        </button>
        .
      </Note>
      <Server />
      {hasChat ? <ChatAlerts /> : null}
    </div>
  );
}

function Server() {
  const qc = useQueryClient();
  const zones = useZones();
  const q = useQuery({ queryKey: K.notifications, queryFn: ({ signal }) => apiGet<Payload>('/api/notifications/preferences', undefined, signal) });
  const [draft, setDraft] = useState<Prefs | null>(null);
  const save = useMutation({
    mutationFn: (body: Prefs) => apiPut('/api/notifications/preferences', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.notifications });
      toast('success', 'Saved.');
    },
    onError: (e) => {
      setDraft(null);
      toast('error', errorMessage(e));
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const p: Prefs = { ...data.preferences, ...(draft ?? {}) };
  // The whole object, every time (see above).
  const commit = (patch: Prefs) => {
    const next = { ...p, ...patch };
    setDraft(next);
    save.mutate(next);
  };
  const cats = (p.categories && !Array.isArray(p.categories) ? p.categories : {}) as Record<string, Record<string, boolean>>;
  // Only channels the preferences carry a switch for (the "chat" channel has none to save).
  const channels = data.channels.filter((c) => c.channel in data.preferences);
  const usable = channels.filter((c) => c.available);
  const enabled = on(p.enabled);
  const zone = typeof p.timezone === 'string' && p.timezone ? p.timezone : 'UTC';
  const here = computerZone();

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Everything">
          <SettingRow label="Send me notifications" hint="Off stops everything below, email included.">
            <Switch label="Send me notifications" checked={enabled} onChange={(v) => commit({ enabled: v })} />
          </SettingRow>
          <SettingRow label="Play a sound" hint="With notifications, where the device can.">
            <Switch label="Play a sound" checked={on(p.sound)} disabled={!enabled} onChange={(v) => commit({ sound: v })} />
          </SettingRow>
        </Card>
        <Card title="How">
          {channels.map((c) => (
            <SettingRow key={c.channel} label={c.label} hint={!c.available ? c.message : c.channel === 'in_app' ? 'Also shown by this app as desktop notifications.' : c.channel === 'web_push' ? 'For browsers; this app shows the in-app ones.' : undefined}>
              <Switch label={c.label} checked={on(p[c.channel])} disabled={!c.available || !enabled} onChange={(v) => commit({ [c.channel]: v })} />
            </SettingRow>
          ))}
        </Card>
        <Card title="Quiet hours">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
              From
              <input type="time" className={input} value={typeof p.quiet_from === 'string' ? p.quiet_from.slice(0, 5) : ''} onChange={(e) => commit({ quiet_from: e.target.value || null })} aria-label="Quiet from" />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
              To
              <input type="time" className={input} value={typeof p.quiet_to === 'string' ? p.quiet_to.slice(0, 5) : ''} onChange={(e) => commit({ quiet_to: e.target.value || null })} aria-label="Quiet to" />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">Time zone</span>
            <Select label="Time zone for quiet hours" value={zone} searchable options={(zones.data?.zones ?? [{ value: zone, label: zone, offset: '', group: '' }]).map((z) => ({ value: z.value, label: z.offset ? `${z.label} (UTC${z.offset})` : z.label, group: z.group || undefined }))} onValueChange={(v) => commit({ timezone: v })} />
            <span className="text-[11.5px] text-ink-3">
              Quiet hours start and end by this clock.
              {here && here !== zone ? (
                <>
                  {' '}
                  This computer is in {here.replace(/_/g, ' ')}.{' '}
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => commit({ timezone: here })}>
                    Use it
                  </button>
                </>
              ) : null}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">During quiet hours</span>
            <Select
              label="During quiet hours"
              value={typeof p.quiet_action === 'string' ? p.quiet_action : 'hold'}
              options={[
                { value: 'hold', label: 'Hold them until quiet hours end' },
                { value: 'in_app_only', label: 'Show them in the app only' },
                { value: 'drop', label: 'Do not send them at all' },
              ]}
              onValueChange={(v) => commit({ quiet_action: v })}
            />
          </div>
          <SettingRow label="Let urgent ones through" className="mt-1">
            <Switch label="Let urgent ones through" checked={on(p.quiet_allows_urgent)} onChange={(v) => commit({ quiet_allows_urgent: v })} />
          </SettingRow>
        </Card>
      </div>
      <Card title="What" action={<span className="text-[12px] text-ink-3">By kind, and by channel</span>}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-line pb-2 text-[11.5px] font-bold text-ink-3">
            <span className="flex-1">Kind</span>
            {usable.map((c) => (
              <span key={c.channel} className="w-[64px] text-center leading-tight">
                {c.label}
              </span>
            ))}
          </div>
          {data.catalogue.map((cat) => (
            <div key={cat.key} className="flex items-center gap-2 border-b border-line/70 py-2 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold text-ink">{cat.label}</span>
                {cat.note ? <span className="text-[11.5px] text-warning">{cat.note}</span> : <span className="truncate text-[11.5px] text-ink-3">{cat.events.slice(0, 3).map((e) => e.label).join(', ')}{cat.events.length > 3 ? '…' : ''}</span>}
              </span>
              {usable.map((c) => {
                const checked = cats[cat.key]?.[c.channel] ?? true;
                return (
                  <span key={c.channel} className="flex w-[64px] justify-center">
                    <Checkbox
                      aria-label={`${cat.label} by ${c.label}`}
                      checked={checked}
                      disabled={!enabled || !on(p[c.channel])}
                      onChange={(e) => commit({ categories: { ...cats, [cat.key]: { ...(cats[cat.key] ?? {}), [c.channel]: e.target.checked } } })}
                    />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

interface ChatSwitches {
  sound: boolean;
  desktop: boolean;
  ringing: boolean;
  call_dnd: 'hold' | 'silent' | 'ring';
  urgent_through_dnd: boolean;
}

const CALLS_ON_DND: Record<ChatSwitches['call_dnd'], string> = { hold: 'calls are not put through and show as missed', silent: 'calls appear without ringing', ring: 'calls still ring' };

function ChatAlerts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.chatAlerts, queryFn: ({ signal }) => apiGet<ChatSwitches>('/api/chat/notification-settings', undefined, signal) });
  const presence = useQuery({ queryKey: K.presence, queryFn: ({ signal }) => apiGet<{ status: string; choice: string }>('/api/chat/presence/me', undefined, signal) });
  const put = async (patch: Partial<ChatSwitches>) => {
    qc.setQueryData<ChatSwitches>(K.chatAlerts, (d) => (d ? { ...d, ...patch } : d));
    try {
      await apiPut('/api/chat/notification-settings', patch);
    } catch (e) {
      void qc.invalidateQueries({ queryKey: K.chatAlerts });
      toast('error', errorMessage(e));
    }
  };
  const dnd = async (v: boolean) => {
    try {
      await apiPost('/api/chat/presence', { status: v ? 'dnd' : 'available', active: true });
      await qc.invalidateQueries({ queryKey: K.presence });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const s = q.data;
  return (
    <Card title={<span className="flex items-center gap-2"><Icon name="chat" size={16} className="text-ink-3" /> Chat and calls</span>}>
      <SettingRow label="Do not disturb" hint={`Messages don’t interrupt you: no cards, sounds or notifications. Mentions still wait for you${s ? `, ${CALLS_ON_DND[s.call_dnd]}` : ''}${s?.urgent_through_dnd ? ', and urgent messages still come through.' : '.'}`}>
        <Switch label="Do not disturb" checked={presence.data?.choice === 'dnd'} disabled={!presence.data} onChange={(v) => void dnd(v)} />
      </SettingRow>
      <SettingRow label="Message sound" hint="A short sound when a message arrives in a conversation you aren’t looking at.">
        <Switch label="Message sound" checked={s?.sound ?? true} disabled={!s} onChange={(v) => void put({ sound: v })} />
      </SettingRow>
      <SettingRow label="Ring for incoming calls" hint="Off, a call still appears, without the ringtone.">
        <Switch label="Ring for incoming calls" checked={s?.ringing ?? true} disabled={!s} onChange={(v) => void put({ ringing: v })} />
      </SettingRow>
      <SettingRow label="Desktop notifications for messages" hint="Shown by your computer when WorkSuite isn’t the window in front.">
        <Switch label="Desktop notifications for messages" checked={s?.desktop ?? true} disabled={!s} onChange={(v) => void put({ desktop: v })} />
      </SettingRow>
    </Card>
  );
}
