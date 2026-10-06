import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { request } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage, isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { shownPresence } from '../../core/presence';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { STATUS_CHOICES, statusChoice } from '../chat/MyStatus';
import { K, agents } from './api';

/**
 * Availability (D-01, FR-ASN-06): Online or Away, and how much of my capacity my open tickets fill.
 *
 * One status everywhere: it is Chat's presence (`/api/chat/presence`), the same heartbeat the server reads for the
 * agent picker and for routing (`GET agents` reports it), so setting it here sets it on the avatar, in Website chats
 * and on the desk alike. Capacity is the larger of my teams' limits, against my live tickets
 * (`GET agents`). Somebody without Chat's presence has no switch here — the server has no other place to keep it.
 *
 * ⌥⌘A (Ctrl+Alt+A elsewhere) switches between Online and Away while the inbox is in front.
 */
interface Me {
  status: string;
  choice: string;
}

export const AVAILABILITY_KEYS = isMac ? '⌥⌘A' : 'Ctrl+Alt+A';

export function useMyAvailability() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: K.myPresence, queryFn: async ({ signal }) => (await request<Me>('GET', '/api/chat/presence/me', { signal })).data, refetchInterval: 60_000, retry: false });
  const network = useStore(app, (s) => s.status?.network ?? 'ONLINE');
  const shown = me.data ? statusChoice(shownPresence(me.data, network)) : null;
  const choice = STATUS_CHOICES.find((c) => c.id === (me.data?.choice ?? 'available')) ?? STATUS_CHOICES[0]!;
  const set = async (status: 'available' | 'away') => {
    try {
      await request('POST', '/api/chat/presence', { body: { status, active: true } });
      void qc.invalidateQueries({ queryKey: ['chat', 'presence'] });
      void qc.invalidateQueries({ queryKey: ['support', 'agents'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const toggle = () => void set(choice.id === 'available' ? 'away' : 'available');
  return { available: !me.isError && !!me.data, shown, choice, set, toggle };
}

export function Availability({ organization, active }: { organization: number | null; active: boolean }) {
  const a = useMyAvailability();
  const userId = useStore(app, (s) => s.auth?.user?.id ?? null);
  const load = useQuery({ queryKey: K.agents(`org:${organization ?? ''}`), queryFn: () => agents({ organization }), enabled: a.available, staleTime: 60_000 });
  const mine = load.data?.find((x) => String(x.id) === String(userId));
  const toggle = useRef(a.toggle);
  useEffect(() => {
    toggle.current = a.toggle;
  });

  useEffect(() => {
    if (!active || !a.available) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.altKey && !e.shiftKey && e.code === 'KeyA') {
        e.preventDefault();
        toggle.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, a.available]);

  if (!a.available) return null;
  const online = a.choice.id === 'available';
  const away = a.choice.id === 'away';
  return (
    <section aria-label={text('Availability')} className="flex flex-col gap-2 border-t border-line px-2 pt-3 pb-1">
      <div className="flex items-center justify-between px-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        <span>{text('Availability')}</span>
        <kbd className="font-sans text-[10.5px] font-semibold tracking-normal normal-case">{AVAILABILITY_KEYS}</kbd>
      </div>
      <div role="radiogroup" aria-label={text('Availability')} className="grid grid-cols-2 gap-1 rounded-[9px] bg-subtle p-0.5">
        {(['available', 'away'] as const).map((id) => {
          const on = id === 'available' ? online : away;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => void a.set(id)}
              className={cx('flex h-7 items-center justify-center gap-1.5 rounded-[7px] text-[12.5px] font-semibold', on ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
            >
              <span className={cx('h-2 w-2 rounded-full', id === 'available' ? 'bg-success' : 'bg-warning')} />
              {id === 'available' ? text('Online') : text('Away')}
            </button>
          );
        })}
      </div>
      {!online && !away ? <p className="px-1 text-[11.5px] text-ink-3">{text('Your status is {status}.', { status: text(a.choice.label) })}</p> : null}
      {a.shown && a.shown.id !== a.choice.id ? <p className="px-1 text-[11.5px] text-ink-3">{text('Showing as {status} now.', { status: text(a.shown.label) })}</p> : null}
      {mine ? (
        <p className="px-1 text-[12px] text-ink-2">
          {mine.capacity ? text('{open} / {capacity} capacity', { open: mine.open, capacity: mine.capacity }) : text('{open} open tickets', { open: mine.open })}
        </p>
      ) : null}
    </section>
  );
}
