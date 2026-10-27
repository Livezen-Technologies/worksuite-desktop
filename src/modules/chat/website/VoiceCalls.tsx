import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { dayKey, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Avatar, Button, Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { useNow } from '../../calls/parts';
import { WEBSITE } from './api';
import { CallbackBoard, dial } from './Callbacks';
import { Segmented, Tile } from './live/LiveDashboard';
import { clock } from './Ringing';
import { FilterPill, PANEL_HEADING, ROW_PICKED, TABLE_FRAME, TABLE_HEAD, Tag, useMe, whenLabel } from './rowParts';
import { StatGrid } from '../../../components/StatCard';

/**
 * Voice calls (V-01, X-UI-08; UX-CALL-01/02): the website widget's calls in one place — the calls on now in a green
 * banner with Open call, the period's tiles (calls, answered, missed, average wait and length, call-backs open), the
 * calls themselves filtered All / Answered / Missed / Recorded by site and period, and the picked call's details: what
 * happened in order, whether it was recorded, the staff's call notes with Add note, Open chat and Call back.
 *
 * Its Call-backs half (V-02, X-UI-09) is one switch away, under the same heading: the requests visitors left when
 * nobody could answer, worked here (CallbackBoard). The list and the details are the server's (`GET calls`,
 * `GET calls/{id}`); a call on now is followed in its chat, where the call bar is (VOICE-13).
 */

export type CallResult = 'answered' | 'transferred' | 'missed' | 'cancelled' | 'dropped' | 'live';
export type CallFilter = 'all' | 'answered' | 'missed' | 'recorded';

/** A call as the list has it (WidgetCalls::rows). */
export interface VoiceCallRow {
  id: number;
  conversation_id: number;
  widget_id: number;
  visitor: string;
  visitor_label: string | null;
  city: string | null;
  country: string | null;
  site: string | null;
  status: string;
  result: CallResult;
  /** The visitor asked to be called back after it. */
  callback: boolean;
  requested_at: string;
  answered_at: string | null;
  ended_at: string | null;
  answered_by: number | null;
  answered_by_name: string | null;
  /** Who took it, in the order they came on: "Nuwan → Kasun". */
  handled_by: string[];
  offered_by_name: string | null;
  wait: number | null;
  duration: number | null;
  recorded: boolean;
}

/** A call on now, for the banner: who from the team is on it. */
export interface LiveVoiceCall extends VoiceCallRow {
  since: string;
  on: Array<{ user_id: number; name: string }>;
}

export interface VoiceCallStats {
  requested: number;
  answered: number;
  missed: number;
  avg_wait: number | null;
  avg_duration: number | null;
  callbacks_open: number;
}

export interface VoiceCallsPage {
  installed: boolean;
  days?: number;
  live: LiveVoiceCall[];
  stats?: VoiceCallStats;
  sites?: Array<{ widget_id: number; site: string }>;
  calls: VoiceCallRow[];
  total: number;
  page: number;
  per_page?: number;
  has_more: boolean;
  counts?: Record<CallFilter, number>;
}

/** One step of WHAT HAPPENED (UX-CALL-02); the server names the people, this words it. */
export interface CallStep {
  at: string;
  kind: 'pressed' | 'rang' | 'declined' | 'answered' | 'joined' | 'left' | 'ended' | 'dropped' | 'missed' | 'cancelled';
  names?: string[];
  page?: string | null;
  by?: 'visitor' | 'agent' | 'system' | null;
  by_name?: string | null;
  after?: number | null;
}

export interface VoiceCallDetails extends Omit<VoiceCallRow, 'callback'> {
  visitor_id: number;
  email: string | null;
  /** The number to call back on: the one asked for, else the visitor's own. */
  phone: string | null;
  page_url: string | null;
  conversation_status: string;
  ended_by: string | null;
  ended_by_name: string | null;
  timeline: CallStep[];
  recording: { state: 'off' | 'recorded'; url: string | null };
  notes: string | null;
  callback: { id: number; phone: string; best_time: string | null; status: string; reference: string | null } | null;
  can: { note: boolean; call: boolean };
}

const PERIODS = [
  { value: 1, label: 'Today' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const FILTERS: Array<{ id: CallFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'answered', label: 'Answered' },
  { id: 'missed', label: 'Missed' },
  { id: 'recorded', label: 'Recorded' },
];

const PER_PAGE = 25;

/** The calls on now, the tiles and a page of the list, every fifteen seconds while it is in front (the banner's clock). */
export function useVoiceCalls(q: { result: CallFilter; site: number; days: number; page: number }, enabled = true) {
  return useQuery({
    queryKey: ['website', 'calls', 'list', q],
    queryFn: ({ signal }) => apiGet<VoiceCallsPage>(`${WEBSITE}/calls`, {
      result: q.result, days: String(q.days), page: String(q.page), per_page: String(PER_PAGE), ...(q.site ? { widget_id: String(q.site) } : {}),
    }, signal),
    enabled,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useVoiceCall(id: number | null) {
  return useQuery({
    queryKey: ['website', 'calls', 'one', id],
    queryFn: ({ signal }) => apiGet<VoiceCallDetails>(`${WEBSITE}/calls/${id}`, undefined, signal),
    enabled: id !== null,
    retry: false,
  });
}

/** "0:12", or a dash when there is none. */
const span = (s: number | null | undefined) => (s === null || s === undefined ? '—' : clock(s));

/** WHEN: the time today, else the day and the time — shared with Call-backs (V-02). */
export { whenLabel };

/** The timeline's clock, to the second: "10:44:02". */
function secondsLabel(at: string): string {
  const d = parseTs(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

/** The path of the page they called from: "/shop/adobe-creative-cloud". */
function pathOfPage(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/** The RESULT chip (V-01): answered, missed (with a call back asked for), cancelled, transferred, dropped, on now. */
export function ResultTag({ c }: { c: Pick<VoiceCallRow, 'result' | 'callback' | 'status'> }) {
  switch (c.result) {
    case 'answered': return <Tag tone="success" size="chip">{text('Answered')}</Tag>;
    case 'transferred': return <Tag tone="indigo" size="chip">{text('Transferred')}</Tag>;
    case 'missed': return <Tag tone="danger" size="chip">{c.callback ? text('Missed · call-back') : text('Missed')}</Tag>;
    case 'cancelled': return <Tag tone="muted" size="chip">{text('Cancelled by visitor')}</Tag>;
    case 'dropped': return <Tag tone="warning" size="chip">{text('Dropped')}</Tag>;
    default: return <Tag tone="success" size="chip">{c.status === 'ringing' ? text('Ringing') : c.status === 'on_hold' ? text('On hold') : text('On a call')}</Tag>;
  }
}

/** One step of WHAT HAPPENED, in words (UX-CALL-02). */
export function stepWords(s: CallStep): { text: string; strong?: boolean } {
  const who = (s.names ?? []).join(', ');
  switch (s.kind) {
    case 'pressed':
      if (s.by_name) return { text: text('Visitor accepted the call {name} offered', { name: s.by_name }) };
      return { text: s.page ? text('Visitor pressed Call on {page}', { page: pathOfPage(s.page) }) : text('Visitor pressed Call') };
    case 'rang': return { text: text('Rang {names}', { names: who }) };
    case 'declined': return { text: text('{name} declined', { name: who }) };
    case 'answered': return { text: text('{name} answered', { name: who }), strong: true };
    case 'joined': return { text: text('{name} joined the call', { name: who }) };
    case 'left': return { text: text('{name} left the call', { name: who }) };
    case 'missed': return { text: text('Nobody answered — missed') };
    case 'cancelled': return { text: text('Cancelled by the visitor') };
    case 'dropped': return { text: text('The connection dropped') };
    default:
      if (s.by === 'visitor') return { text: text('Ended by the visitor') };
      if (s.by === 'agent') return { text: s.by_name ? text('Ended by {name}', { name: s.by_name }) : text('Ended by the team') };
      // A call whose every ring was declined ends as `declined`, by the system.
      return { text: s.kind === 'ended' ? text('Ended') : text('Everybody rung declined') };
  }
}

export function VoiceCalls({ show = 'calls', selected, onSelect, onOpenChat, onCallbacks, onCalls, callbacksOpen, pickedCallback = null, onPickCallback }: {
  /** Which half shows: the calls (V-01) or the call-backs (V-02). */
  show?: 'calls' | 'callbacks';
  selected: number | null;
  onSelect: (id: number | null) => void;
  onOpenChat: (conversationId: number) => void;
  /** The Call-backs half (V-02); on a server without it, Missed chats, where VOICE-16 kept them. */
  onCallbacks: () => void;
  /** Back to the Calls half. */
  onCalls?: () => void;
  callbacksOpen: number | null;
  /** The call-back opened on the Call-backs half. */
  pickedCallback?: number | null;
  onPickCallback?: (id: number | null) => void;
}) {
  const backs = show === 'callbacks';
  const [result, setResult] = useState<CallFilter>('all');
  const [site, setSite] = useState(0);
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const calls = useVoiceCalls({ result, site, days, page }, !backs);
  const d = calls.data;
  const rows = d?.calls ?? [];
  // Nothing picked: the first call's details, as the design opens on.
  const picked = selected ?? rows[0]?.id ?? null;
  const filter = (f: CallFilter) => {
    setResult(f);
    setPage(1);
  };
  const s = d?.stats;
  const cbOpen = s?.callbacks_open ?? callbacksOpen ?? 0;

  /** The arrow keys move the pick through the rows, as in the other tables. */
  const keys = (e: ReactKeyboardEvent<HTMLDivElement>, id: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = rows.findIndex((r) => r.id === id) + (e.key === 'ArrowDown' ? 1 : -1);
    const next = rows[i];
    if (!next) return;
    onSelect(next.id);
    (e.currentTarget.parentElement?.querySelector(`[data-call-row="${next.id}"]`) as HTMLElement | null)?.focus();
  };

  const missing = calls.error instanceof ApiError && calls.error.status === 404;

  return (
    <main aria-label={text('Voice calls')} className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-5 py-4 scroll-thin">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold text-ink">{text('Voice calls')}</h1>
          <p className="text-[12.5px] text-ink-3">
            {backs ? text('Visitors who called when nobody could answer and asked us to call them back.') : text('Calls from the website widget — live, answered, missed, and the call-backs visitors asked for.')}
          </p>
        </div>
        <Segmented<'calls' | 'callbacks'> label="Show" value={show} onChange={(v) => (v === 'callbacks' ? !backs && onCallbacks() : backs && onCalls?.())} options={[['calls', 'Calls'], ['callbacks', 'Call-backs', cbOpen]]} />
        {backs ? null : (
          <>
            <Select aria-label="Site" value={site} onValueChange={(v) => (setSite(v), setPage(1))} options={[{ value: 0, label: 'All sites' }, ...(d?.sites ?? []).map((x) => ({ value: x.widget_id, label: x.site }))]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
            <Select aria-label="Period" value={days} onValueChange={(v) => (setDays(v), setPage(1))} options={PERIODS} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
          </>
        )}
      </div>

      {backs ? (
        <CallbackBoard picked={pickedCallback} onPick={(id) => onPickCallback?.(id)} onOpenChat={onOpenChat} />
      ) : calls.isLoading ? <Spinner /> : missing ? (
        <Empty icon="phone" title="Voice calls need a newer WorkSuite" hint="Ask your administrator to update the server." />
      ) : calls.error && !d ? (
        <ErrorNote error={calls.error} onRetry={() => void calls.refetch()} />
      ) : d && !d.installed ? (
        <Empty icon="phone" title="Voice calls are not set up" hint="Voice calls from the website widget need the server update (run php spark migrate)." />
      ) : d ? (
        <>
          {d.live.map((c) => <LiveBanner key={c.id} c={c} onOpen={() => onOpenChat(c.conversation_id)} />)}
          {s ? (
            <StatGrid min={170} role="list" label={text('Calls in this period')}>
              <Tile icon="phone" accent="blue" label="Calls" value={String(s.requested)} tone="plain" action="show all calls" onClick={() => filter('all')} />
              <Tile icon="phone-incoming" label="Answered" value={String(s.answered)} tone="green" action="show answered calls" onClick={() => filter('answered')} />
              <Tile icon="phone-missed" label="Missed" value={String(s.missed)} tone={s.missed ? 'red' : 'plain'} action="show missed calls" onClick={() => filter('missed')} />
              <Tile icon="hourglass" accent="violet" label="Avg wait" value={span(s.avg_wait)} tone="plain" />
              <Tile icon="timer" accent="cyan" label="Avg length" value={span(s.avg_duration)} tone="plain" />
              <Tile icon="phone-outgoing" label="Call-backs open" value={String(cbOpen)} tone={cbOpen ? 'amber' : 'plain'} action="open call-backs" onClick={onCallbacks} />
            </StatGrid>
          ) : null}
          <div className="flex min-h-[360px] flex-1 gap-3">
            <div className={cx(TABLE_FRAME, 'flex min-w-0 flex-1 flex-col')}>
              <div className="flex items-center gap-1.5 border-b border-line px-3.5 py-2.5 text-[12px] font-semibold" role="group" aria-label={text('Show')}>
                {FILTERS.map((f) => (
                  <FilterPill key={f.id} on={result === f.id} onClick={() => filter(f.id)}>
                    {f.id === 'all' ? `${text(f.label)} · ${d.counts?.all ?? d.total}` : text(f.label)}
                  </FilterPill>
                ))}
              </div>
              <div role="grid" aria-label={text('Calls')} aria-rowcount={rows.length + 1} className="flex min-h-0 flex-1 flex-col">
                <div role="row" className={cx(GRID, TABLE_HEAD, 'px-3.5 py-2')}>
                  {['Visitor', 'When', 'Answered by', 'Wait', 'Length', 'Result'].map((h) => <span key={h} role="columnheader">{text(h)}</span>)}
                </div>
                {!rows.length ? (
                  <Empty icon="phone" title={result === 'recorded' ? 'No recorded calls' : result === 'missed' ? 'No missed calls' : 'No calls in this period'} hint={result === 'recorded' ? text('Calls are not recorded: recording is off for these widgets.') : undefined} />
                ) : rows.map((r) => (
                  <CallRow key={r.id} r={r} picked={r.id === picked} onPick={() => onSelect(r.id)} onKeyDown={(e) => keys(e, r.id)} />
                ))}
              </div>
              {d.page > 1 || d.has_more ? (
                <div className="flex items-center gap-2 border-t border-line px-3.5 py-2 text-[12px] text-ink-3">
                  <span className="flex-1">{text('{from}–{to} of {n}', { from: (d.page - 1) * PER_PAGE + 1, to: (d.page - 1) * PER_PAGE + rows.length, n: d.total })}</span>
                  <Button size="sm" disabled={d.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{text('Newer')}</Button>
                  <Button size="sm" disabled={!d.has_more} onClick={() => setPage((p) => p + 1)}>{text('Older')}</Button>
                </div>
              ) : null}
            </div>
            {picked !== null ? <CallDetails key={picked} id={picked} onOpenChat={onOpenChat} /> : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

const GRID = 'grid grid-cols-[1.9fr_0.8fr_1.1fr_0.7fr_0.8fr_0.9fr] items-center gap-x-2';

function CallRow({ r, picked, onPick, onKeyDown }: { r: VoiceCallRow; picked: boolean; onPick: () => void; onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void }) {
  // Nobody answered a missed call; a cancelled one never rang long enough for anybody to.
  const by = r.handled_by.length ? r.handled_by.join(' → ') : r.result === 'missed' ? text('Nobody') : '—';
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={picked}
      data-call-row={r.id}
      onClick={onPick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), onPick()) : onKeyDown(e))}
      className={cx(GRID, 'cursor-default border-b border-line px-3.5 py-2.5 text-[12.5px] outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset', picked ? ROW_PICKED : 'hover:bg-subtle')}
    >
      <span role="gridcell" className="truncate">
        <b className="text-ink">{r.visitor}</b>
        {r.city ? <span className="text-ink-3"> · {r.city}</span> : null}
      </span>
      <span role="gridcell" className="truncate text-ink">{whenLabel(r.requested_at)}</span>
      <span role="gridcell" className={cx('truncate', r.handled_by.length ? 'text-ink' : 'text-ink-3')}>{by}</span>
      <span role="gridcell" className="text-ink tabular-nums">{span(r.wait)}</span>
      <span role="gridcell" className="text-ink tabular-nums">{span(r.duration)}</span>
      <span role="gridcell" className="flex items-center gap-1">
        <ResultTag c={r} />
        {r.recorded ? <span role="img" aria-label={text('Recorded')} title={text('Recorded')} className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger" /> : null}
      </span>
    </div>
  );
}

/** "On a call now · Visitor 9C1E (Galle) with You · 02:14 · not recorded", and Open call (UX-CALL-01). */
function LiveBanner({ c, onOpen }: { c: LiveVoiceCall; onOpen: () => void }) {
  const now = useNow(1_000);
  const me = useMe();
  const at = parseTs(c.since).getTime();
  const time = Number.isNaN(at) ? '0:00' : clock((now - at) / 1000);
  const people = c.on.map((p) => (p.user_id === me ? text('You') : p.name));
  const who = `${c.visitor}${c.city ? ` (${c.city})` : ''}`;
  const lead = c.status === 'ringing' ? text('Ringing now ·') : c.status === 'on_hold' ? text('On hold now ·') : text('On a call now ·');
  return (
    <div role="status" className="flex items-center gap-3 rounded-[12px] border border-success/30 bg-success-bg px-3.5 py-2.5">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-success shadow-[0_0_0_4px_rgb(47_158_103/0.2)]" />
      <div className="min-w-0 flex-1 truncate text-[13px] text-success-ink dark:text-success">
        <b>{lead}</b> {people.length ? text('{visitor} with {people}', { visitor: who, people: people.join(' & ') }) : who}
        {' · '}<span className="font-mono tabular-nums">{time}</span>
        {' · '}{c.recorded ? text('recorded') : text('not recorded')}
      </div>
      <button type="button" onClick={onOpen} className="h-[30px] shrink-0 rounded-[15px] border border-success/30 bg-surface px-3 text-[12.5px] font-semibold text-success-ink hover:bg-subtle dark:text-success">
        {text('Open call')}
      </button>
    </div>
  );
}


/**
 * The picked call's details (UX-CALL-02): who and when, Open chat; WHAT HAPPENED in order; RECORDING; CALL NOTES ·
 * STAFF ONLY; and Add note and Call back.
 */
function CallDetails({ id, onOpenChat }: { id: number; onOpenChat: (conversationId: number) => void }) {
  const qc = useQueryClient();
  const one = useVoiceCall(id);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const c = one.data;

  if (one.isLoading) return <aside aria-label={text('Call details')} className={ASIDE}><Spinner /></aside>;
  if (!c) return <aside aria-label={text('Call details')} className={ASIDE}><div className="p-4"><ErrorNote error={one.error} onRetry={() => void one.refetch()} /></div></aside>;

  const today = dayKey(parseTs(c.requested_at)) === dayKey(new Date());
  const when = today ? `${text('Today')} ${timeLabel(c.requested_at)}` : whenLabel(c.requested_at);
  const phone = dial(c.phone);
  const save = () => {
    if (!note.trim()) return;
    setBusy(true);
    void apiPost(`${WEBSITE}/calls/${c.id}/note`, { note: note.trim() }).then(
      () => {
        toast('success', text('Note added'));
        setNote('');
        setNoting(false);
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ['website', 'calls', 'one', c.id] });
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };
  /*
   * Call back (UX-CALL-02, UX-CALL-04): their number in the computer's dialler — the WorkSuite phone where it is the
   * tel: handler — as the Callbacks section's Call now does; without a number, offer the visitor a call in their chat
   * while it is open (VOICE-15).
   */
  const callBack = () => {
    if (phone) {
      void call('app:openExternal', { url: `tel:${phone}` });
      return;
    }
    void apiPost(`${WEBSITE}/conversations/${c.conversation_id}/offer-call`, {}).then(() => toast('success', text('Call offered')), (e) => toast('error', errorMessage(e)));
  };
  const canCallBack = !!phone || (c.can.call && c.conversation_status === 'open');

  return (
    <aside aria-label={text('Call details')} className={ASIDE}>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <Avatar name={c.visitor} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-ink">{c.visitor}</div>
          <div className="truncate text-[12px] text-ink-3">{[when, c.duration !== null ? clock(c.duration) : null, c.site].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" onClick={() => onOpenChat(c.conversation_id)} className="shrink-0 text-[12.5px] font-bold text-primary hover:underline">{text('Open chat')}</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3 scroll-thin">
        <h3 className={PANEL_HEADING}>{text('What happened')}</h3>
        <ol className="flex flex-col gap-[7px] border-l-2 border-line pl-3 text-[12.5px] text-ink">
          {c.timeline.map((step, i) => {
            const w = stepWords(step);
            return (
              <li key={i}>
                <span className="font-mono text-ink-3">{secondsLabel(step.at)}</span> {w.strong ? <b>{w.text}</b> : w.text}
              </li>
            );
          })}
        </ol>
        <h3 className={cx(PANEL_HEADING, 'mt-1')}>{text('Recording')}</h3>
        {c.recording.state === 'recorded' && c.recording.url ? (
          <audio controls src={c.recording.url} className="w-full" aria-label={text('Call recording')} />
        ) : (
          <div className="rounded-[10px] border border-line bg-subtle px-3 py-2.5 text-[12.5px] text-ink-2">{text('Not recorded — recording is off for this widget.')}</div>
        )}
        <h3 className={cx(PANEL_HEADING, 'mt-1')}>{text('Call notes · staff only')}</h3>
        {c.notes ? (
          <div className="rounded-[10px] border border-dashed border-amber bg-warning-bg px-3 py-2.5 text-[12.5px] whitespace-pre-wrap text-warning-strong select-text dark:text-warning">{c.notes}</div>
        ) : !noting ? (
          <div className="text-[12.5px] text-ink-3">{text('No notes yet.')}</div>
        ) : null}
        {noting ? (
          <div className="flex flex-col gap-1.5">
            <textarea autoFocus aria-label={text('Call note')} value={note} maxLength={4000} rows={3} onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNoting(false)}
              placeholder={text('Only staff see call notes')} className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-primary" />
            <span className="flex justify-end gap-1.5">
              <Button size="sm" onClick={() => setNoting(false)}>{text('Cancel')}</Button>
              <Button size="sm" variant="primary" disabled={busy || !note.trim()} onClick={save}>{text('Save note')}</Button>
            </span>
          </div>
        ) : null}
        {c.callback ? (
          <div className="text-[12px] text-ink-2">
            {text('Asked to be called back on {phone}', { phone: c.callback.phone })}{c.callback.best_time ? ` · ${c.callback.best_time}` : ''}
          </div>
        ) : null}
      </div>
      <div className="flex gap-2 border-t border-line px-4 py-3">
        <Button className="flex-1" disabled={!c.can.note || noting} title={c.can.note ? undefined : text('You need the "Reply to website visitors" permission')} onClick={() => setNoting(true)}>{text('Add note')}</Button>
        <Button className="flex-1" variant="primary" disabled={!canCallBack} title={phone ? c.phone ?? undefined : canCallBack ? text('Offer the visitor a call in their chat') : text('No number to call back on')} onClick={callBack}>{text('Call back')}</Button>
      </div>
    </aside>
  );
}

const ASIDE = 'flex w-[380px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface';
