import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { useCanned, visitorStatus, WEBSITE, type Section } from './api';
import { Select } from '../../../components/Select';
import { LiveDashboard } from './live/LiveDashboard';
import type { Dashboard, OnlineVisitor } from './live/liveMap';

export type { OnlineVisitor } from './live/liveMap';

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
 * The Live section of Website chats (WebChatLive; worksuite-desktop#231): the Live dashboard (worksuite-desktop C-00;
 * live/LiveDashboard) — six figures each opening the view they count, the map, and everybody on the site in the order
 * they need us — and Visitors online, everybody, with filters. In both, a visitor is selected (a click, the arrow keys,
 * or Start chat) and their details open: beside the list here, over it on the dashboard; Enter or a double-click goes
 * to their chat. The selection is in the address, so it survives Back, a reopened tab and a refresh of the list.
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
  // Ten seconds, as the visitor list, so the two never disagree about how many people are on the site (C-00). One site
  // narrows every figure; changing it keeps the last figures on screen until the new ones land.
  const dash = useQuery({
    queryKey: ['website', 'dashboard', site],
    queryFn: ({ signal }) => apiGet<Dashboard>(`${WEBSITE}/dashboard`, site ? { widget_id: site } : undefined, signal),
    refetchInterval: 10_000,
    enabled: view === 'dashboard',
    placeholderData: keepPreviousData,
  });
  const visitors = useQuery({ queryKey: ['website', 'visitors'], queryFn: ({ signal }) => apiGet<{ visitors: OnlineVisitor[] }>(`${WEBSITE}/visitors`, undefined, signal), refetchInterval: 10_000 });
  const all = (visitors.data?.visitors ?? []).filter((v) => !site || v.widget_id === site);
  const list = view === 'visitors' && status ? all.filter((v) => visitorStatus(v)[0] === status) : all;

  // The selected visitor, and — once they have left the site — who they were and when they were last seen.
  const [last, setLast] = useState<{ v: OnlineVisitor; at: number } | null>(null);
  const here = selected !== null ? (visitors.data?.visitors ?? []).find((v) => v.id === selected) ?? null : null;
  if (here && last?.v !== here) setLast({ v: here, at: visitors.dataUpdatedAt - here.idle_seconds * 1000 });
  const picked = here ?? (selected !== null && last?.v.id === selected ? last.v : null);
  const left = !here && !!picked && visitors.isSuccess;

  const d = dash.data;
  const open = (v: OnlineVisitor) => {
    if (hasChat(v)) onOpenChat(v.conversation_id!);
    else {
      onSelect(v.id);
      setFocusStart((n) => n + 1);
    }
  };

  const card = picked ? <VisitorCard key={picked.id} v={picked} left={left} leftAt={left ? (last?.at ?? null) : null} focusStart={focusStart} onOpenChat={onOpenChat} onClose={() => onSelect(null)} /> : null;

  if (view === 'dashboard') {
    return (
      <LiveDashboard
        dash={dash}
        visitors={all}
        loading={visitors.isLoading}
        error={visitors.error}
        onRetry={() => void visitors.refetch()}
        site={site}
        onSite={setSite}
        selected={selected}
        onSelect={onSelect}
        onStart={(v) => {
          onSelect(v.id);
          setFocusStart((n) => n + 1);
        }}
        onOpenChat={onOpenChat}
        onSection={onSection}
        drawer={card}
      />
    );
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-ground px-6 py-5 text-[13px] scroll-thin">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[20px] font-bold text-ink">{text('Visitors online')}</h1>
        <span className="flex-1 text-[12px] text-ink-3">{text('Everybody on your sites now.')}</span>
        <Select aria-label={text('Show')} value={status} onChange={(e) => setStatus(e.target.value as '' | Status)} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{text(s.label)}</option>)}
        </Select>
        <Select aria-label={text('Site')} value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
          <option value={0}>{text('All sites')}</option>
          {(d?.widgets ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>
      <div className="grid min-h-0 gap-4 [grid-template-columns:1.5fr_1fr]">
        <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="flex-1 text-[15px] font-bold text-ink">{text('Visitors online · {n}', { n: list.length })}</h2>
            <span className="text-[12px] text-ink-3">{text('Select someone to see what they are looking at')}</span>
          </div>
          <VisitorTable rows={list} selected={selected} loading={visitors.isLoading} error={visitors.error} onRetry={() => void visitors.refetch()} onSelect={onSelect} onOpen={open} />
        </section>
        <div className="flex flex-col gap-4">
          {card ?? <section className="rounded-[12px] border border-dashed border-line p-4 text-ink-3">{text('Select a visitor to see their pages and start a conversation.')}</section>}
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
