import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { useCanned, visitorStatus, WEBSITE, type Section } from './api';
import { Select } from '../../../components/Select';

interface Dashboard {
  now: { visitors_online: number; open: number; pending: number; waiting_on_us: number; at_risk: number; window_seconds: number };
  today: { visitors: number; returning: number; conversations: number; missed: number; page_views: number; first_response_median: number | null };
  summary: { pages: Array<{ url?: string; title?: string; name?: string; count: number }>; countries: Array<{ name: string | null; count: number }>; devices: Array<{ name: string | null; count: number }>; referrers: Array<{ name: string; count: number }> };
  widgets: Array<{ id: number; name: string; online: number }>;
}

export interface OnlineVisitor {
  id: number;
  label: string;
  name: string | null;
  email: string | null;
  widget_id: number;
  website_name: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  current_url: string | null;
  current_title: string | null;
  landing_page?: string | null;
  referrer: string | null;
  utm_campaign: string | null;
  pages: number;
  visits: number;
  on_site_seconds: number;
  idle_seconds: number;
  conversation_id: number | null;
  conversation_status: string | null;
  /** The visitor's chat as the dashboard reads it: waiting on us, and who has it. */
  chat?: { awaiting: boolean; waiting_since: string | null; at_risk: boolean; agent: string | null } | null;
}

interface Activity {
  events: Array<{ id: number; kind: string; url: string | null; title: string | null; at: string; new_visit: boolean }>;
  visits?: number;
  first_seen?: string | null;
  chats?: Array<{ id: number; status: string; started_at: string | null; closed_at: string | null }>;
  contact?: { id: number; name: string } | null;
  language?: string | null;
  landing_page?: string | null;
}

/** The Live section's two views (worksuite-desktop#231): the dashboard, and everybody on the sites. */
export type LiveView = 'dashboard' | 'visitors';

function short(url: string | null | undefined): string {
  if (!url) return '—';
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname === '/' ? '/' : u.pathname}`;
  } catch {
    return url;
  }
}

function median(s: number | null): string {
  if (s === null) return '—';
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/** Whether there is a chat to go to: one open or waiting. */
const hasChat = (v: OnlineVisitor) => !!v.conversation_id && (v.conversation_status === 'open' || v.conversation_status === 'pending');

type Status = ReturnType<typeof visitorStatus>[0];

const STATUSES: Array<{ id: '' | Status; label: string }> = [
  { id: '', label: 'Everyone' },
  { id: 'Waiting', label: 'Waiting' },
  { id: 'Chatting', label: 'Chatting' },
  { id: 'Active', label: 'Browsing' },
  { id: 'Inactive', label: 'Inactive' },
];

/**
 * The Live section of Website chats (WebChatLive; worksuite-desktop#231): the dashboard — its cards each opening the
 * view they count, and the visitors on the sites now — and Visitors online, everybody, with filters. In both, a
 * visitor is selected by a click (or the arrow keys) and their details open beside the list; Enter or a double-click
 * goes to their chat. The selection is in the address, so it survives Back, a reopened tab and a refresh of the list.
 */
export function WebsiteLive({ view, selected, onSelect, onOpenChat, onSection }: {
  view: LiveView;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onOpenChat: (conversationId: number, then?: 'invite') => void;
  onSection: (s: 'visitors' | Section) => void;
}) {
  const [site, setSite] = useState(0);
  const [status, setStatus] = useState<'' | Status>('');
  const [focusStart, setFocusStart] = useState(0);
  const dash = useQuery({ queryKey: ['website', 'dashboard'], queryFn: ({ signal }) => apiGet<Dashboard>(`${WEBSITE}/dashboard`, undefined, signal), refetchInterval: 15_000, enabled: view === 'dashboard' });
  const visitors = useQuery({ queryKey: ['website', 'visitors'], queryFn: ({ signal }) => apiGet<{ visitors: OnlineVisitor[] }>(`${WEBSITE}/visitors`, undefined, signal), refetchInterval: 10_000 });
  const all = (visitors.data?.visitors ?? []).filter((v) => !site || v.widget_id === site);
  const list = view === 'visitors' && status ? all.filter((v) => visitorStatus(v)[0] === status) : all;
  const shown = view === 'dashboard' ? list.slice(0, 8) : list;

  // The selected visitor, and — once they have left the site — who they were and when they were last seen.
  const [last, setLast] = useState<{ v: OnlineVisitor; at: number } | null>(null);
  const here = selected !== null ? (visitors.data?.visitors ?? []).find((v) => v.id === selected) ?? null : null;
  if (here && last?.v !== here) setLast({ v: here, at: visitors.dataUpdatedAt - here.idle_seconds * 1000 });
  const picked = here ?? (selected !== null && last?.v.id === selected ? last.v : null);
  const left = !here && !!picked && visitors.isSuccess;

  const d = dash.data;
  const sites = (d?.widgets ?? []).filter((w) => w.online > 0).length;
  const cards: Array<{ label: string; value: string; hint: string; tone: string; go: 'visitors' | Section; action: string }> = d
    ? [
        { label: 'On the site now', value: String(d.now.visitors_online), hint: sites ? `across ${sites} site${sites === 1 ? '' : 's'}` : '', tone: 'text-ink', go: 'visitors', action: 'see who' },
        { label: 'Visitors today', value: String(d.today.visitors), hint: d.today.visitors ? `${Math.round((d.today.returning / Math.max(1, d.today.visitors)) * 100)}% returning` : '', tone: 'text-ink', go: 'visitors', action: 'see who is on now' },
        { label: 'Chats started', value: String(d.today.conversations), hint: '', tone: 'text-ink', go: 'inbox', action: 'open the inbox' },
        { label: 'Open chats', value: String(d.now.open + d.now.pending), hint: '', tone: 'text-ink', go: 'inbox', action: 'open the inbox' },
        { label: 'Waiting on us', value: String(d.now.waiting_on_us), hint: 'visitor spoke last', tone: 'text-[#9A4A06] dark:text-warning', go: 'awaiting', action: 'open those chats' },
        { label: 'At risk', value: String(d.now.at_risk), hint: 'nobody answered in time', tone: 'text-danger', go: 'awaiting', action: 'open those chats' },
        { label: 'Median first reply', value: median(d.today.first_response_median), hint: `missed today: ${d.today.missed}`, tone: 'text-success', go: 'missed', action: 'open missed chats' },
      ]
    : [];
  const refs = d?.summary.referrers ?? [];
  const refTotal = refs.reduce((n, r) => n + r.count, 0) || 1;
  const devs = d?.summary.devices ?? [];
  const devTotal = devs.reduce((n, r) => n + r.count, 0) || 1;

  const open = (v: OnlineVisitor) => {
    if (hasChat(v)) onOpenChat(v.conversation_id!);
    else {
      onSelect(v.id);
      setFocusStart((n) => n + 1);
    }
  };

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-ground px-6 py-5 text-[13px] scroll-thin">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[20px] font-bold text-ink">{view === 'dashboard' ? text('Live dashboard') : text('Visitors online')}</h1>
        <span className="flex-1 text-[12px] text-ink-3">{view === 'dashboard' ? text('Today. Median, not mean.') : text('Everybody on your sites now.')}</span>
        {view === 'visitors' ? (
          <Select aria-label={text('Show')} value={status} onChange={(e) => setStatus(e.target.value as '' | Status)} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{text(s.label)}</option>)}
          </Select>
        ) : null}
        <Select aria-label={text('Site')} value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
          <option value={0}>{text('All sites')}</option>
          {(d?.widgets ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>
      {view === 'dashboard' && dash.error ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
      {view === 'dashboard' ? (
        <div className="grid grid-cols-7 gap-2" role="list" aria-label={text('Today')}>
          {cards.map((c) => (
            <button
              key={c.label}
              type="button"
              role="listitem"
              aria-label={`${text(c.label)}: ${c.value} — ${text(c.action)}`}
              onClick={() => onSection(c.go)}
              className={cx('flex flex-col gap-0.5 rounded-[12px] border bg-surface px-3 py-2.5 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary', c.label === 'At risk' && c.value !== '0' ? 'border-[#F1B8A8]' : 'border-line')}
            >
              <span className="text-[11.5px] text-ink-3">{text(c.label)}</span>
              <span className={cx('text-[22px] font-bold', c.tone)}>{c.value}</span>
              <span className="truncate text-[11px] text-ink-3">{c.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid min-h-0 gap-4 [grid-template-columns:1.5fr_1fr]">
        <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="flex-1 text-[15px] font-bold text-ink">{text('Visitors online · {n}', { n: list.length })}</h2>
            {view === 'dashboard' && list.length > shown.length ? (
              <button type="button" onClick={() => onSection('visitors')} className="text-[12px] font-semibold text-primary hover:underline">
                {text('See all {n}', { n: list.length })}
              </button>
            ) : (
              <span className="text-[12px] text-ink-3">{text('Select someone to see what they are looking at')}</span>
            )}
          </div>
          <VisitorTable rows={shown} selected={selected} loading={visitors.isLoading} error={visitors.error} onRetry={() => void visitors.refetch()} onSelect={onSelect} onOpen={open} />
        </section>
        <div className="flex flex-col gap-4">
          {picked ? (
            <VisitorCard key={picked.id} v={picked} left={left} leftAt={left ? (last?.at ?? null) : null} focusStart={focusStart} onOpenChat={onOpenChat} onClose={() => onSelect(null)} />
          ) : (
            <section className="rounded-[12px] border border-dashed border-line p-4 text-ink-3">{text('Select a visitor to see their pages and start a conversation.')}</section>
          )}
          {view === 'dashboard' ? (
            <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
              <h2 className="text-[15px] font-bold text-ink">{text('How they got here · devices')}</h2>
              {!refs.length ? <p className="text-ink-3">{devs.length ? text('Nobody came from another site today.') : text('No visits today yet.')}</p> : null}
              {refs.map((r) => (
                <div key={r.name} className="grid grid-cols-[90px_1fr_40px] items-center gap-2">
                  <span className="truncate text-ink">{r.name}</span>
                  <span className="h-2 rounded-full bg-subtle">
                    <span className="block h-2 rounded-full bg-teal" style={{ width: `${Math.round((r.count / refs[0]!.count) * 100)}%` }} />
                  </span>
                  <b className="text-right text-ink">{Math.round((r.count / refTotal) * 100)}%</b>
                </div>
              ))}
              {devs.length ? <span className="text-[12px] text-ink-3">{devs.map((x) => `${x.name ? x.name[0]!.toUpperCase() + x.name.slice(1) : 'Unknown'} ${Math.round((x.count / devTotal) * 100)}%`).join(' · ')}</span> : null}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/**
 * The visitors, one row each: a click selects, a double-click or Enter goes to their chat (or to Start chat), the
 * arrow keys move, Escape closes the details. The status says what they are doing and goes there.
 */
function VisitorTable({ rows, selected, loading, error, onRetry, onSelect, onOpen }: {
  rows: OnlineVisitor[];
  selected: number | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (id: number | null) => void;
  onOpen: (v: OnlineVisitor) => void;
}) {
  const refs = useRef(new Map<number, HTMLDivElement>());
  const move = (i: number) => {
    const v = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!v) return;
    onSelect(v.id);
    refs.current.get(v.id)?.focus();
  };
  const onKey = (e: KeyboardEvent, v: OnlineVisitor, i: number) => {
    const act: Record<string, () => void> = {
      ArrowDown: () => move(i + 1),
      ArrowUp: () => move(i - 1),
      Enter: () => onOpen(v),
      ' ': () => onSelect(v.id),
      Escape: () => onSelect(null),
    };
    const f = act[e.key];
    if (!f) return;
    e.preventDefault();
    f();
  };
  const focusable = rows.some((r) => r.id === selected) ? selected : (rows[0]?.id ?? null);
  return (
    <>
      <div className="grid grid-cols-[1.4fr_1.6fr_1fr_0.6fr_0.9fr] gap-2.5 px-1.5 text-[11px] font-bold tracking-[0.5px] text-ink-3" aria-hidden>
        <span>VISITOR</span>
        <span>READING NOW</span>
        <span>WHERE</span>
        <span>VISITS</span>
        <span>STATUS</span>
      </div>
      {loading ? <Spinner /> : error ? <ErrorNote error={error} onRetry={onRetry} /> : null}
      {!loading && !rows.length ? <Empty icon="globe" title="Nobody is on your sites right now" /> : null}
      {rows.length ? (
        <div role="listbox" aria-label={text('Visitors online')} className="flex flex-col">
          {rows.map((v, i) => {
            const [st, tone] = visitorStatus(v);
            const on = selected === v.id;
            return (
              <div
                key={v.id}
                ref={(el) => {
                  if (el) refs.current.set(v.id, el);
                  else refs.current.delete(v.id);
                }}
                role="option"
                aria-selected={on}
                tabIndex={focusable === v.id ? 0 : -1}
                onClick={() => onSelect(v.id)}
                onDoubleClick={() => onOpen(v)}
                onKeyDown={(e) => onKey(e, v, i)}
                className={cx('grid cursor-pointer grid-cols-[1.4fr_1.6fr_1fr_0.6fr_0.9fr] items-center gap-2.5 rounded-[6px] border-b border-line px-1.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary', on ? 'bg-selection' : 'hover:bg-subtle')}
              >
                <b className="truncate text-ink">{v.name || v.label}</b>
                <span className="truncate text-ink-2">{short(v.current_url)}</span>
                <span className="truncate text-ink-2">{[v.city, v.device === 'mobile' ? v.os : (v.os ?? v.device)].filter(Boolean).join(' · ') || '—'}</span>
                <span className="text-ink">{v.visits}</span>
                <span>
                  <button
                    type="button"
                    tabIndex={-1}
                    title={hasChat(v) ? text('Open the chat') : text('Start a chat')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(v);
                    }}
                    className={cx('rounded-[5px] px-1 font-semibold hover:bg-subtle hover:underline', tone)}
                  >
                    {text(st)}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/**
 * Who they are and what they are doing — location, device, language, the page they are on, how they arrived, their
 * visits, this visit's pages, their earlier chats and linked contact — and Start chat (with a saved reply), Open
 * chat, Invite a colleague and Block. When they leave it says so and keeps what it showed.
 */
function VisitorCard({ v, left, leftAt, focusStart, onOpenChat, onClose }: {
  v: OnlineVisitor;
  left: boolean;
  leftAt: number | null;
  focusStart: number;
  onOpenChat: (id: number, then?: 'invite') => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('Hello — can I help with anything?');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canned = useCanned(true);
  const trail = useQuery({
    queryKey: ['website', 'visitor', v.id],
    queryFn: ({ signal }) => apiGet<Activity>(`${WEBSITE}/visitors/${v.id}/activity`, undefined, signal),
    refetchInterval: left ? false : 15_000,
  });
  useEffect(() => {
    if (focusStart) input.current?.focus();
  }, [focusStart]);
  const a = trail.data;
  const events = a?.events ?? [];
  // This visit's pages: from the last page view that began a visit.
  const pages = events.filter((e) => e.kind === 'page_view');
  const start = pages.map((e) => e.new_visit).lastIndexOf(true);
  const visit = (start >= 0 ? pages.slice(start) : pages).slice(-8);
  const [st] = visitorStatus(v);
  const chats = (a?.chats ?? []).filter((c) => c.id !== v.conversation_id);
  const send = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ conversation_id: number }>(`${WEBSITE}/visitors/${v.id}/message`, { message: message.trim() });
      toast('success', text('Message sent.'));
      onOpenChat(r.conversation_id);
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? text('That visitor is blocked.') : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const block = async () => {
    setBusy(true);
    try {
      if (hasChat(v)) await apiPost(`${WEBSITE}/conversations/${v.conversation_id}/action`, { action: 'block', days: 7 });
      else await apiPost(`${WEBSITE}/visitors/${v.id}/block`, { days: 7 });
      toast('success', text('Blocked for a week. Lift it under Blocked visitors on the web.'));
      void qc.invalidateQueries({ queryKey: ['website', 'visitors'] });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const btn = 'h-8 rounded-[8px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle disabled:opacity-50';
  return (
    <section aria-label={text('Visitor details')} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4" onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onClose();
      }}>
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[15px] font-bold text-ink">{[v.name || v.label, v.city, v.website_name].filter(Boolean).join(' · ')}</h2>
        <button type="button" aria-label={text('Close the details')} onClick={onClose} className="h-7 w-7 rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
          ×
        </button>
      </div>
      {left ? (
        <p role="status" className="rounded-[8px] bg-subtle px-2.5 py-1.5 text-[12px] font-semibold text-ink-2">
          {text('Left the site · {time}', { time: leftAt ? timeLabel(new Date(leftAt).toISOString()) : '' })}
        </p>
      ) : null}
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <dt className="text-ink-3">{text('Status')}</dt>
        <dd className="text-ink">{left ? text('Left') : text(st)}{v.chat?.agent ? ` · ${text('with {name}', { name: v.chat.agent })}` : ''}</dd>
        <dt className="text-ink-3">{text('Where')}</dt>
        <dd className="text-ink">{[v.city, v.country].filter(Boolean).join(', ') || '—'}</dd>
        <dt className="text-ink-3">{text('Device')}</dt>
        <dd className="text-ink">{[v.device, v.browser, v.os].filter(Boolean).join(' · ') || '—'}</dd>
        {a?.language ? (
          <>
            <dt className="text-ink-3">{text('Language')}</dt>
            <dd className="text-ink">{a.language}</dd>
          </>
        ) : null}
        <dt className="text-ink-3">{text('Reading now')}</dt>
        <dd className="truncate text-ink">{left ? '—' : (v.current_title || short(v.current_url))}</dd>
        <dt className="text-ink-3">{text('Landed on')}</dt>
        <dd className="truncate text-ink">{short(a?.landing_page ?? v.landing_page ?? null)}</dd>
        <dt className="text-ink-3">{text('Came from')}</dt>
        <dd className="truncate text-ink">{v.referrer ? short(v.referrer) : text('Direct')}</dd>
        <dt className="text-ink-3">{text('Visits')}</dt>
        <dd className="text-ink">{v.visits}</dd>
        {a?.contact ? (
          <>
            <dt className="text-ink-3">{text('Contact')}</dt>
            <dd className="text-ink">{a.contact.name}</dd>
          </>
        ) : null}
      </dl>
      <b className="text-ink">{text('Pages this visit')}</b>
      {trail.isLoading ? <Spinner /> : null}
      <ol className="flex flex-col gap-0.5">
        {visit.map((e, i) => (
          <li key={e.id} className="flex gap-3">
            <span className="w-[68px] shrink-0 font-mono text-[12px] whitespace-nowrap text-ink-3">{timeLabel(e.at)}</span>
            <span className={cx('truncate', i === visit.length - 1 ? 'font-bold text-ink' : 'text-ink-2')}>
              {short(e.url)}
              {i === visit.length - 1 && !left && st !== 'Inactive' ? ` · ${text('reading now')}` : ''}
            </span>
          </li>
        ))}
      </ol>
      {chats.length ? (
        <>
          <b className="text-ink">{text('Previous chats')}</b>
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {chats.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenChat(c.id)} className="text-primary hover:underline">
                  {c.started_at ? timeLabel(c.started_at) : `#${c.id}`} · {c.status}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {hasChat(v) ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenChat(v.conversation_id!)} className="h-9 rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover">{text('Open the chat')}</button>
          <button type="button" className={btn} onClick={() => onOpenChat(v.conversation_id!, 'invite')}>{text('Invite a colleague')}</button>
          <button type="button" className={btn} disabled={busy} onClick={() => void block()}>{text('Block')}</button>
        </div>
      ) : left ? null : (
        <>
          <b className="text-ink">{text('Start the conversation')}</b>
          {(canned.data?.responses ?? []).length ? (
            <Select aria-label={text('Saved replies')} value="" onChange={(e) => e.target.value && setMessage(e.target.value)} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
              <option value="">{text('Use a saved reply…')}</option>
              {(canned.data?.responses ?? []).slice(0, 30).map((r) => <option key={r.id} value={r.body}>{r.title || r.body.slice(0, 60)}</option>)}
            </Select>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim()) void send();
            }}
          >
            <input ref={input} value={message} onChange={(e) => setMessage(e.target.value)} aria-label={text('Send a message')} className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
            <button type="submit" disabled={busy || !message.trim()} className="h-9 rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover disabled:opacity-50">{text('Start chat')}</button>
          </form>
          <div>
            <button type="button" className={btn} disabled={busy} onClick={() => void block()}>{text('Block')}</button>
          </div>
        </>
      )}
    </section>
  );
}
