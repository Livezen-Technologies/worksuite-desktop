import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { visitorStatus, WEBSITE } from './api';

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
  referrer: string | null;
  utm_campaign: string | null;
  pages: number;
  visits: number;
  on_site_seconds: number;
  idle_seconds: number;
  conversation_id: number | null;
  conversation_status: string | null;
}

function short(url: string | null): string {
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

/** Live dashboard (WebChatLive): who is on the sites now, and a way to start talking to them. */
export function WebsiteLive({ onOpenChat }: { onOpenChat: (conversationId: number) => void }) {
  const [site, setSite] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const dash = useQuery({ queryKey: ['website', 'dashboard'], queryFn: ({ signal }) => apiGet<Dashboard>(`${WEBSITE}/dashboard`, undefined, signal), refetchInterval: 15_000 });
  const visitors = useQuery({ queryKey: ['website', 'visitors'], queryFn: ({ signal }) => apiGet<{ visitors: OnlineVisitor[] }>(`${WEBSITE}/visitors`, undefined, signal), refetchInterval: 10_000 });
  const list = (visitors.data?.visitors ?? []).filter((v) => !site || v.widget_id === site);
  const selected = list.find((v) => v.id === picked) ?? null;
  const d = dash.data;
  const sites = (d?.widgets ?? []).filter((w) => w.online > 0).length;
  const kpis: Array<[string, string, string, string]> = d
    ? [
        ['On the site now', String(d.now.visitors_online), sites ? `across ${sites} site${sites === 1 ? '' : 's'}` : '', 'text-ink'],
        ['Visitors today', String(d.today.visitors), d.today.visitors ? `${Math.round((d.today.returning / Math.max(1, d.today.visitors)) * 100)}% returning` : '', 'text-ink'],
        ['Chats started', String(d.today.conversations), '', 'text-ink'],
        ['Open chats', String(d.now.open + d.now.pending), '', 'text-ink'],
        ['Waiting on us', String(d.now.waiting_on_us), 'visitor spoke last', 'text-[#9A4A06] dark:text-warning'],
        ['At risk', String(d.now.at_risk), 'nobody answered in time', 'text-danger'],
        ['Median first reply', median(d.today.first_response_median), `missed today: ${d.today.missed}`, 'text-success'],
      ]
    : [];
  const refs = d?.summary.referrers ?? [];
  const refTotal = refs.reduce((n, r) => n + r.count, 0) || 1;
  const devs = d?.summary.devices ?? [];
  const devTotal = devs.reduce((n, r) => n + r.count, 0) || 1;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-ground px-6 py-5 text-[13px] scroll-thin">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[20px] font-bold text-ink">Live dashboard</h1>
        <span className="flex-1 text-[12px] text-ink-3">Today. Median, not mean.</span>
        <select aria-label="Site" value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
          <option value={0}>All sites</option>
          {(d?.widgets ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {dash.error ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
      <div className="grid grid-cols-7 gap-2">
        {kpis.map(([l, v, h, tone]) => (
          <div key={l} className={cx('flex flex-col gap-0.5 rounded-[12px] border bg-surface px-3 py-2.5', l === 'At risk' && v !== '0' ? 'border-[#F1B8A8]' : 'border-line')}>
            <span className="text-[11.5px] text-ink-3">{l}</span>
            <span className={cx('text-[22px] font-bold', tone)}>{v}</span>
            <span className="truncate text-[11px] text-ink-3">{h}</span>
          </div>
        ))}
      </div>
      <div className="grid min-h-0 gap-4 [grid-template-columns:1.5fr_1fr]">
        <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[15px] font-bold text-ink">Visitors online · {list.length}</h2>
            <span className="text-[12px] text-ink-3">Select someone to see what they are looking at</span>
          </div>
          <div className="grid grid-cols-[1.4fr_1.6fr_1fr_0.6fr_0.9fr] gap-2.5 px-1.5 text-[11px] font-bold tracking-[0.5px] text-ink-3">
            <span>VISITOR</span>
            <span>READING NOW</span>
            <span>WHERE</span>
            <span>VISITS</span>
            <span>STATUS</span>
          </div>
          {visitors.isLoading ? <Spinner /> : visitors.error ? <ErrorNote error={visitors.error} onRetry={() => void visitors.refetch()} /> : null}
          {!visitors.isLoading && !list.length ? <Empty icon="globe" title="Nobody is on your sites right now" /> : null}
          {list.map((v) => {
            const [st, tone] = visitorStatus(v);
            return (
              <button key={v.id} type="button" aria-pressed={picked === v.id} onClick={() => setPicked(v.id)} className={cx('grid grid-cols-[1.4fr_1.6fr_1fr_0.6fr_0.9fr] items-center gap-2.5 rounded-[6px] border-b border-line px-1.5 py-2 text-left', picked === v.id ? 'bg-selection' : 'hover:bg-subtle')}>
                <b className="truncate text-ink">{v.name || v.label}</b>
                <span className="truncate text-ink-2">{short(v.current_url)}</span>
                <span className="truncate text-ink-2">{[v.city, v.device === 'mobile' ? v.os : (v.os ?? v.device)].filter(Boolean).join(' · ') || '—'}</span>
                <span className="text-ink">{v.visits}</span>
                <span className={cx('font-semibold', tone)}>{st}</span>
              </button>
            );
          })}
        </section>
        <div className="flex flex-col gap-4">
          {selected ? <VisitorCard v={selected} onOpenChat={onOpenChat} /> : <section className="rounded-[12px] border border-dashed border-line p-4 text-ink-3">Select a visitor to see their pages and start a conversation.</section>}
          <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
            <h2 className="text-[15px] font-bold text-ink">How they got here · devices</h2>
            {!refs.length ? <p className="text-ink-3">{devs.length ? 'Nobody came from another site today.' : 'No visits today yet.'}</p> : null}
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
        </div>
      </div>
    </main>
  );
}

function VisitorCard({ v, onOpenChat }: { v: OnlineVisitor; onOpenChat: (id: number) => void }) {
  const [text, setText] = useState('Hello — can I help with anything?');
  const [busy, setBusy] = useState(false);
  const trail = useQuery({
    queryKey: ['website', 'visitor', v.id],
    queryFn: ({ signal }) => apiGet<{ events: Array<{ id: number; kind: string; url: string | null; title: string | null; at: string; new_visit: boolean }> }>(`${WEBSITE}/visitors/${v.id}/activity`, undefined, signal),
    refetchInterval: 15_000,
  });
  const events = trail.data?.events ?? [];
  // This visit's pages: from the last page view that began a visit.
  const pages = events.filter((e) => e.kind === 'page_view');
  const start = pages.map((e) => e.new_visit).lastIndexOf(true);
  const visit = (start >= 0 ? pages.slice(start) : pages).slice(-8);
  const [st] = visitorStatus(v);
  const send = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ conversation_id: number }>(`${WEBSITE}/visitors/${v.id}/message`, { message: text.trim() });
      toast('success', 'Message sent.');
      onOpenChat(r.conversation_id);
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? 'That visitor is blocked.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
      <h2 className="text-[15px] font-bold text-ink">{[v.name || v.label, v.city, v.website_name].filter(Boolean).join(' · ')}</h2>
      <span className="text-[12px] text-ink-3">
        {st} · {[v.browser, v.os].filter(Boolean).join(' on ') || 'Unknown browser'}
        {v.referrer ? ` · came from ${short(v.referrer)}` : ''}
      </span>
      <b className="text-ink">Pages this visit</b>
      {trail.isLoading ? <Spinner /> : null}
      {visit.map((e, i) => (
        <div key={e.id} className="flex gap-3">
          <span className="w-[68px] shrink-0 font-mono text-[12px] whitespace-nowrap text-ink-3">{timeLabel(e.at)}</span>
          <span className={cx('truncate', i === visit.length - 1 ? 'font-bold text-ink' : 'text-ink-2')}>
            {short(e.url)}
            {i === visit.length - 1 && st !== 'Inactive' ? ' · reading now' : ''}
          </span>
        </div>
      ))}
      {v.conversation_id && (v.conversation_status === 'open' || v.conversation_status === 'pending') ? (
        <button type="button" onClick={() => onOpenChat(v.conversation_id!)} className="h-9 self-start rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover">Open the chat</button>
      ) : (
        <>
          <b className="text-ink">Start the conversation</b>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void send();
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Send a message" className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
            <button type="submit" disabled={busy || !text.trim()} className="h-9 rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover disabled:opacity-50">Send</button>
          </form>
        </>
      )}
    </section>
  );
}
