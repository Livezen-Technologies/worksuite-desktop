import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { categoryVisible } from '@shared/access';
import type { Preferences } from '@shared/types';
import { useVisibleIds } from '../../core/access';
import { app, updatePrefs } from '../../core/app-state';
import { apiGet, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, Switch, cx } from '../../components/ui';
import { K as AccountK } from '../account/api';
import { Card, SettingRow } from '../account/parts';
import { computerZone, useZones } from '../account/regional';
import { appOf } from './api';

/**
 * Notification settings (NotifSettings): which kinds of notification reach
 * you by which channel, when they must not, and how this computer shows
 * them.
 *
 * The grid's rows are the server's own categories and its columns the
 * channels the server can send by, each with its own master switch; the
 * "This computer" column mutes one category's banners here only. Quiet hours
 * are the account's (email and push wait), and can silence this computer's
 * banners for the same hours.
 *
 * `PUT /notifications/preferences` replaces the whole row, so every change
 * sends every setting.
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
/** The channels this screen offers, in this order, with the design's words. */
const OFFERED: Record<string, string> = { in_app: 'In app', email: 'Email', web_push: 'Browser push', chat: 'System conversation' };
const DESKTOP = '__desktop';

export default function NotificationSettings() {
  useTabTitle('Notification settings');
  const { navigate } = useTab();
  const qc = useQueryClient();
  const prefs = useStore(app, (s) => s.prefs);
  const visible = useVisibleIds();
  const q = useQuery({ queryKey: AccountK.notifications, queryFn: ({ signal }) => apiGet<Payload>('/api/notifications/preferences', undefined, signal) });
  const [draft, setDraft] = useState<Prefs | null>(null);
  const save = useMutation({
    mutationFn: (body: Prefs) => apiPut('/api/notifications/preferences', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: AccountK.notifications }),
    onError: (e) => {
      setDraft(null);
      toast('error', errorMessage(e));
    },
  });

  if (q.isLoading || !prefs) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const p: Prefs = { ...data.preferences, ...(draft ?? {}) };
  const commit = (patch: Prefs) => {
    const next = { ...p, ...patch };
    setDraft(next);
    save.mutate(next);
  };
  const local = (patch: Partial<Preferences>) => void updatePrefs(patch).catch((e) => toast('error', errorMessage(e)));
  const cats = (p.categories && !Array.isArray(p.categories) ? p.categories : {}) as Record<string, Record<string, boolean>>;
  const channels = Object.keys(OFFERED)
    .map((id) => data.channels.find((c) => c.channel === id))
    .filter((c): c is Channel => !!c && c.channel in data.preferences);
  const enabled = on(p.enabled);
  const columns: Array<{ id: string; label: string; master: boolean; setMaster: (v: boolean) => void; usable: boolean; why?: string | null; hint: string }> = [
    ...channels.slice(0, 1).map((c) => ({ id: c.channel, label: OFFERED[c.channel]!, master: on(p[c.channel]), setMaster: (v: boolean) => commit({ [c.channel]: v }), usable: c.available && enabled, why: c.message, hint: 'Bell and center' })),
    { id: DESKTOP, label: 'This computer', master: prefs.notificationsEnabled, setMaster: (v: boolean) => local({ notificationsEnabled: v }), usable: true, hint: 'Banners here' },
    ...channels.slice(1).map((c) => ({ id: c.channel, label: OFFERED[c.channel]!, master: on(p[c.channel]), setMaster: (v: boolean) => commit({ [c.channel]: v }), usable: c.available && enabled, why: c.message, hint: c.channel === 'email' ? 'Your sign-in email' : c.channel === 'web_push' ? 'Browsers you allowed' : 'A chat from WorkSuite' })),
  ];
  const cell = (cat: string, col: string) => (col === DESKTOP ? prefs.moduleNotifications[`cat:${cat}`] !== false : (cats[cat]?.[col] ?? true));
  const setCell = (cat: string, col: string, v: boolean) =>
    col === DESKTOP ? local({ moduleNotifications: { ...prefs.moduleNotifications, [`cat:${cat}`]: v } }) : commit({ categories: { ...cats, [cat]: { ...(cats[cat] ?? {}), [col]: v } } });

  return (
    <div className="h-full overflow-y-auto bg-ground scroll-thin dark:bg-[#0A0F1E]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-8 py-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/notifications')} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle" aria-label="Back to notifications" title="Back to notifications">
            <Icon name="chevron-left" size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[22px] font-extrabold text-ink">Notification settings</h1>
            <p className="m-0 text-[13px] text-ink-3">What reaches you, where, and when it must not. Your account’s choices apply on every device; “This computer” is this computer’s.</p>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            Send me notifications
            <Switch label="Send me notifications" checked={enabled} onChange={(v) => commit({ enabled: v })} />
          </label>
        </div>

        <Card title="By app and channel" action={<span className="text-[12px] text-ink-3">A switch at the top turns a whole channel on or off</span>}>
          <div className="overflow-x-auto" data-notif-matrix>
            <table className="w-full table-fixed border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase">App</th>
                  {columns.map((c) => (
                    <th key={c.id} className="w-[112px] px-1.5 py-2 text-center align-bottom">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[12px] font-bold text-ink">{c.label}</span>
                        <span className="text-[10.5px] leading-tight font-medium text-ink-3">{c.hint}</span>
                        <span title={!c.usable && c.why ? c.why : undefined}>
                          <Switch label={`${c.label}: everything`} checked={c.master && (c.id === DESKTOP || c.usable)} disabled={c.id !== DESKTOP && !c.usable} onChange={c.setMaster} />
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Only apps the person has (and categories of no app): the rest are not theirs to tune. */}
                {data.catalogue.filter((cat) => categoryVisible(cat.key, visible)).map((cat) => {
                  const a = appOf(cat.key, { [cat.key]: cat.label });
                  return (
                    <tr key={cat.key} className="border-b border-line/70 last:border-b-0">
                      <td className="overflow-hidden py-2.5 pr-3">
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] [background:var(--tl)] dark:[background:var(--td)]" style={{ color: a.acc, ['--tl' as string]: a.tintLight, ['--td' as string]: a.tint }}>
                            <Icon name={a.icon} size={15} />
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <b className="truncate text-ink">{cat.label}</b>
                            {cat.note ? (
                              <span className="text-[11.5px] text-warning">{cat.note}</span>
                            ) : (
                              <span className="truncate text-[11.5px] text-ink-3">
                                {cat.events.slice(0, 3).map((e) => e.label.toLowerCase()).join(', ')}
                                {cat.events.length > 3 ? '…' : ''}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      {columns.map((c) => {
                        const live = c.master && (c.id === DESKTOP ? prefs.notificationsEnabled : c.usable);
                        return (
                          <td key={c.id} className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${cat.label}: ${c.label}`}
                              checked={cell(cat.key, c.id) && live}
                              disabled={!live}
                              onChange={(e) => setCell(cat.key, c.id, e.target.checked)}
                              className={cx('h-4 w-4 accent-primary', !live && 'opacity-40')}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <QuietHours p={p} commit={commit} prefs={prefs} local={local} />
          <Card title={<span className="flex items-center gap-2"><Icon name="monitor" size={16} className="text-ink-3" /> This computer</span>}>
            <SettingRow label="Show banners" hint="Notifications appear in the corner of the screen, even with WorkSuite’s window closed.">
              <Switch label="Show banners" checked={prefs.notificationsEnabled} onChange={(v) => local({ notificationsEnabled: v })} />
            </SettingRow>
            <SettingRow label="Sound" hint="A sound with each banner.">
              <Switch label="Sound" checked={prefs.notificationSounds} onChange={(v) => local({ notificationSounds: v })} />
            </SettingRow>
            <SettingRow label="What banners show" hint="While WorkSuite is locked, banners never show what they are about.">
              <Select
                label="What banners show"
                value={prefs.notificationPrivacy}
                options={[
                  { value: 'FULL', label: 'Preview text' },
                  { value: 'SENDER_ONLY', label: 'Who and which app only' },
                  { value: 'GENERIC', label: '“New WorkSuite notification”' },
                ]}
                onValueChange={(v) => local({ notificationPrivacy: v as Preferences['notificationPrivacy'] })}
              />
            </SettingRow>
            <SettingRow label="Badge count on the app icon" hint="Unread chat and notifications, on the Dock or the taskbar.">
              <Switch label="Badge count on the app icon" checked={prefs.badgeCount !== false} onChange={(v) => local({ badgeCount: v })} />
            </SettingRow>
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <Button icon="bell" onClick={() => void call('notifications:test').then((ok) => !ok && toast('warning', 'This system does not support notifications. Check its notification settings.'))}>
                Send a test notification
              </Button>
              <Button icon="chat" onClick={() => navigate('/account/notifications')}>
                Chat and calls
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuietHours({ p, commit, prefs, local }: { p: Prefs; commit: (patch: Prefs) => void; prefs: Preferences; local: (patch: Partial<Preferences>) => void }) {
  const zones = useZones();
  const from = typeof p.quiet_from === 'string' ? p.quiet_from.slice(0, 5) : '';
  const to = typeof p.quiet_to === 'string' ? p.quiet_to.slice(0, 5) : '';
  const onNow = !!from && !!to;
  const zone = typeof p.timezone === 'string' && p.timezone ? p.timezone : 'UTC';
  const here = computerZone();
  const setHours = (f: string, t: string) => {
    commit({ quiet_from: f || null, quiet_to: t || null });
    // This computer keeps the same hours when it is silenced with them.
    if (prefs.dndEnabled && f && t) local({ dndFrom: f, dndTo: t });
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Icon name="moon" size={16} className="text-ink-3" /> Quiet hours</span>}>
      <SettingRow label="Quiet hours" hint="Email and browser pushes wait until they end. The bell still fills.">
        <Switch
          label="Quiet hours"
          checked={onNow}
          onChange={(v) => {
            if (v) setHours(from || '19:00', to || '08:00');
            else {
              commit({ quiet_from: null, quiet_to: null });
              if (prefs.dndEnabled) local({ dndEnabled: false });
            }
          }}
        />
      </SettingRow>
      {onNow ? (
        <>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
              From
              <input type="time" value={from} onChange={(e) => setHours(e.target.value, to)} aria-label="Quiet from" className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
              To
              <input type="time" value={to} onChange={(e) => setHours(from, e.target.value)} aria-label="Quiet to" className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">By the clock of</span>
            <Select label="Time zone for quiet hours" value={zone} searchable options={(zones.data?.zones ?? [{ value: zone, label: zone, offset: '', group: '' }]).map((z) => ({ value: z.value, label: z.offset ? `${z.label} (UTC${z.offset})` : z.label, group: z.group || undefined }))} onValueChange={(v) => commit({ timezone: v })} />
            {here && here !== zone ? (
              <span className="text-[11.5px] text-ink-3">
                This computer is in {here.replace(/_/g, ' ')}.{' '}
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => commit({ timezone: here })}>
                  Use it
                </button>
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">During quiet hours, email and pushes</span>
            <Select
              label="During quiet hours"
              value={typeof p.quiet_action === 'string' ? p.quiet_action : 'hold'}
              options={[
                { value: 'hold', label: 'Wait, and arrive when they end' },
                { value: 'in_app_only', label: 'Are not sent; the bell has them' },
                { value: 'drop', label: 'Are not sent at all' },
              ]}
              onValueChange={(v) => commit({ quiet_action: v })}
            />
          </div>
          <SettingRow label="Urgent ones still come through" hint="Only what is sent as critical: security alerts, outages.">
            <Switch label="Urgent ones still come through" checked={on(p.quiet_allows_urgent)} onChange={(v) => commit({ quiet_allows_urgent: v })} />
          </SettingRow>
          <SettingRow label="Silence this computer too" hint={`No banners or sounds here from ${from} to ${to}, by this computer’s clock.`}>
            <Switch label="Silence this computer too" checked={prefs.dndEnabled} onChange={(v) => local(v ? { dndEnabled: true, dndFrom: from, dndTo: to } : { dndEnabled: false })} />
          </SettingRow>
        </>
      ) : null}
    </Card>
  );
}
