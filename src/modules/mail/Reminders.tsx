import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canOpen } from '../../core/access';
import { apiGet, apiGetMeta, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { addDays, dateLabel, timeLabel, todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { dueReminders, pruneMemory, snoozeUntil, type ReminderEvent, type ReminderItem, type ReminderMemory } from './reminderTimes';
import type { MessageStates } from './states';

/**
 * The reminder window (ENH-MAIL-03 DMO-NTF-05, DMO-TSK-02, design O-UI-06):
 * due flags, messages back from snooze and events about to start, with Open,
 * Snooze (5 minutes, an hour, tomorrow), Mark complete and Dismiss — and
 * Dismiss all. Worked out on this computer, so it works offline; while
 * WorkSuite cannot be reached it also raises the system notification the
 * server would have sent.
 */

const STORE = 'ws-mail-reminders';

function loadMemory(): ReminderMemory {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE) ?? 'null') as ReminderMemory | null;
    return raw && typeof raw === 'object' ? pruneMemory({ dismissed: raw.dismissed ?? {}, snoozed: raw.snoozed ?? {} }) : { dismissed: {}, snoozed: {} };
  } catch {
    return { dismissed: {}, snoozed: {} };
  }
}

function saveMemory(m: ReminderMemory): void {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(m));
  } catch {
    // Remembered for this session only.
  }
}

/** When it is due, in words. */
export function reminderWhen(r: ReminderItem, now = Date.now()): string {
  if (r.kind === 'event' && r.at) {
    const mins = Math.round((Date.parse(r.at) - now) / 60_000);
    return mins > 0 ? text('Starts in {n} min', { n: mins }) : mins === 0 ? text('Starting now') : text('Started {n} min ago', { n: -mins });
  }
  if (r.kind === 'snooze') return text('Back from snooze');
  return r.at ? text('Due {when}', { when: `${dateLabel(r.at)} ${timeLabel(r.at)}` }) : text('Follow up');
}

export function MailReminders() {
  const qc = useQueryClient();
  const online = useStore(app, (s) => s.status?.network !== 'OFFLINE');
  const today = todayInZone();
  const states = useQuery({
    queryKey: ['mail', 'states', 'all', 'reminders'],
    queryFn: async () => {
      try {
        return await apiGet<MessageStates>('/api/mail/states');
      } catch {
        return null;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const events = useQuery({
    queryKey: ['calendar', 'reminders', today],
    queryFn: async () => {
      try {
        return (await apiGetMeta<{ events: ReminderEvent[] }>('/api/calendar/events', { from: today, to: addDays(today, 1) })).data.events ?? [];
      } catch {
        return [];
      }
    },
    enabled: canOpen('calendar'),
    refetchInterval: 5 * 60_000,
  });
  const [memory, setMemory] = useState<ReminderMemory>(loadMemory);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const items = useMemo(() => dueReminders(states.data ?? null, events.data ?? [], memory, now), [states.data, events.data, memory, now]);

  // Offline, the server cannot announce them: this computer does, once each.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const r of items) {
      if (announced.current.has(r.key)) continue;
      announced.current.add(r.key);
      if (online) continue;
      void call('notifications:reminder', { id: r.key.slice(0, 200).replace(/[^A-Za-z0-9:._\-/ ]/g, '_'), title: r.kind === 'event' ? r.title : text('Follow up: {subject}', { subject: r.title || text('(no subject)') }), body: reminderWhen(r), route: r.route, ...(r.ref ? { flag: r.ref } : {}) }).catch(() => undefined);
    }
  }, [items, online]);

  const remember = (m: ReminderMemory) => {
    setMemory(m);
    saveMemory(m);
  };
  const dismiss = (keys: string[]) => {
    const at = new Date().toISOString();
    remember({ ...memory, dismissed: { ...memory.dismissed, ...Object.fromEntries(keys.map((k) => [k, at])) } });
  };
  const snooze = (r: ReminderItem, choice: '5m' | '1h' | 'tomorrow') => {
    const until = snoozeUntil(choice).toISOString();
    remember({ ...memory, snoozed: { ...memory.snoozed, [r.key]: until } });
    // A flag's reminder moves on the server too, so the phone agrees.
    if (r.ref && online) void apiPost('/api/mail/states', { action: 'remind', items: [r.ref], at: until }).then(() => qc.invalidateQueries({ queryKey: ['mail', 'states'] }), () => undefined);
  };
  const complete = (r: ReminderItem) => {
    if (!r.ref) return;
    dismiss([r.key]);
    void apiPost('/api/mail/states', { action: 'complete', items: [r.ref] }).then(() => qc.invalidateQueries({ queryKey: ['mail'] }), () => undefined);
  };

  const shown = items.filter((r) => !hidden.includes(r.key));
  if (!shown.length) return null;
  return (
    <section role="dialog" aria-modal="false" aria-label={text('Reminders')} className="fixed right-4 bottom-10 z-40 flex max-h-[60vh] w-[380px] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_10px_40px_rgb(var(--ws-shadow-rgb)/0.22)]">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon name="bell" size={15} className="text-primary" />
        <h2 className="flex-1 text-[13.5px] font-bold text-ink">{text('Reminders · {n}', { n: shown.length })}</h2>
        <Button size="sm" variant="ghost" onClick={() => dismiss(shown.map((r) => r.key))}>
          Dismiss all
        </Button>
        <button type="button" aria-label={text('Hide reminders')} title={text('Hide reminders')} onClick={() => setHidden(items.map((r) => r.key))} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="minus" size={14} />
        </button>
      </header>
      <ul role="list" aria-live="polite" className="min-h-0 overflow-y-auto scroll-thin">
        {shown.map((r) => (
          <li key={r.key} className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5 last:border-b-0">
            <div className="flex items-start gap-2">
              <Icon name={r.kind === 'event' ? 'calendar' : r.kind === 'snooze' ? 'snooze' : 'flag'} size={15} className={cx('mt-0.5 shrink-0', r.kind === 'flag' ? 'text-danger' : 'text-ink-3')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{r.title || text('(no subject)')}</span>
                <span className="block text-[12px] text-ink-3">{reminderWhen(r, now)}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 pl-6">
              <Button size="sm" onClick={() => navigate(r.route)}>Open</Button>
              <select
                aria-label={text('Snooze')}
                value=""
                onChange={(e) => e.target.value && snooze(r, e.target.value as '5m' | '1h' | 'tomorrow')}
                className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink"
              >
                <option value="">{text('Snooze…')}</option>
                <option value="5m">{text('5 minutes')}</option>
                <option value="1h">{text('1 hour')}</option>
                <option value="tomorrow">{text('Tomorrow')}</option>
              </select>
              {r.kind === 'flag' && r.ref ? (
                <Button size="sm" variant="ghost" onClick={() => complete(r)} disabled={!online}>
                  Mark complete
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => dismiss([r.key])}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
