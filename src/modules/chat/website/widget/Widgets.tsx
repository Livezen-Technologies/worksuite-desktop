import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPost } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { useTabTitle } from '../../../../core/tab-context';
import { Button, Chip, Empty, ErrorNote, Modal, Spinner, TextField, cx, initials } from '../../../../components/ui';
import { WEBSITE } from '../api';
import { insightsQuery, type Insights } from '../Insights';
import { clock } from '../live/liveMap';
import { widgetsList, type WidgetRow } from './design';

/**
 * Website chats › Widgets & embed (S-01; WS-WCHAT X-UI-14, UX-SET-01, WGT-01, WGT-02): one card per website — the
 * site, whether it is open now or when it opens, the visitors on it, its open chats and its staff, and chips for
 * what it does (the chatbot, voice calls, conversation starters, automated messages, offline enquiries while closed);
 * Customise and Embed code open the widget's editor (S-02) on Appearance or Embed code. Under the cards, this week's
 * figures across every widget, from Insights (L-07), and the way there. New widget creates one and opens it.
 */

/** The site a widget is on: its first allowed domain, or its website name. */
export function siteOf(w: Pick<WidgetRow, 'allowed_domains' | 'website_name' | 'name'>): string {
  const first = (w.allowed_domains ?? '').split(/[\s,]+/).map((d) => d.trim().replace(/^\./, '')).find(Boolean);
  return first || w.website_name || w.name;
}

const plural = (n: number, one: string, many: string) => text(n === 1 ? one : many, { n });

/** The card's state chip: open now, closed and when it opens, or switched off. Nothing from a server before S-01. */
function stateChip(w: WidgetRow): { label: string; tone: 'success' | 'muted' } | null {
  if (w.status === 'maintenance') return { label: text('Maintenance'), tone: 'muted' };
  if (w.status === 'disabled') return { label: text('Switched off'), tone: 'muted' };
  if (w.open_now === undefined) return null;
  if (w.open_now) return { label: text('Open now'), tone: 'success' };
  return { label: w.opens_at ? text('Closed · opens {time}', { time: w.opens_at }) : text('Closed'), tone: 'muted' };
}

/**
 * What the widget does, as chips: while it is closed, only that it takes offline enquiries (what matters then);
 * otherwise the chatbot on or off, voice calls when on, and how many starters and automated messages it has.
 */
export function featureChips(w: WidgetRow): Array<{ label: string; tone: 'indigo' | 'muted' | 'warning' }> {
  if (w.status === 'active' && w.open_now === false) return [{ label: text('Takes offline enquiries'), tone: 'warning' }];
  const out: Array<{ label: string; tone: 'indigo' | 'muted' | 'warning' }> = [];
  if (w.ai_enabled !== undefined) out.push(w.ai_enabled ? { label: text('Chatbot on'), tone: 'indigo' } : { label: text('Chatbot off'), tone: 'muted' });
  if (w.voice_enabled) out.push({ label: text('Voice calls on'), tone: 'indigo' });
  if (w.starters) out.push({ label: plural(w.starters, '{n} starter', '{n} starters'), tone: 'muted' });
  if (w.rules) out.push({ label: plural(w.rules, '{n} rule', '{n} rules'), tone: 'muted' });
  return out;
}

function Figure({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: 'red' }) {
  return (
    <div role="listitem" aria-label={`${text(label)}: ${value}`} className="min-w-0">
      <div className="truncate text-ink-3">{text(label)}</div>
      <b className={cx('tabular-nums', big ? 'text-[20px]' : 'text-[16px]', tone === 'red' && 'text-danger')}>{value}</b>
    </div>
  );
}

function WidgetCard({ w, onOpen }: { w: WidgetRow; onOpen: (id: number, tab?: 'embed') => void }) {
  const brand = w.brand_color && /^#[0-9a-f]{6}$/i.test(w.brand_color) ? w.brand_color : '#273498';
  const state = stateChip(w);
  const open = w.status === 'active' && w.open_now !== false;
  const chips = featureChips(w);
  const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-US'));
  return (
    <article aria-label={w.name} className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className={cx('h-1.5', !open && 'bg-ink-3/40')} style={open ? { background: brand } : undefined} aria-hidden />
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-bold text-white" style={{ background: brand }} aria-hidden>
            {initials(w.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-ink">{w.name}</div>
            <div className="truncate text-[12px] text-ink-3">{siteOf(w)}</div>
          </div>
          {state ? <Chip tone={state.tone} className="shrink-0 font-bold">{state.label}</Chip> : null}
        </div>
        <div role="list" aria-label={text('Now')} className="grid grid-cols-3 gap-1.5 text-[12px]">
          <Figure label="Online" value={n(w.online)} />
          <Figure label="Open chats" value={n(w.open_conversations)} />
          <Figure label="Staff" value={n(w.staff)} />
        </div>
        {chips.length ? (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label={text('Features')}>
            {chips.map((c) => (
              <span role="listitem" key={c.label}>
                <Chip tone={c.tone}>{c.label}</Chip>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-auto flex border-t border-line">
        <button type="button" onClick={() => onOpen(w.id)} aria-label={text('Customise {name}', { name: w.name })} className="flex-1 p-2.5 text-center text-[12.5px] font-bold text-primary hover:bg-subtle">
          {text('Customise')}
        </button>
        <button type="button" onClick={() => onOpen(w.id, 'embed')} aria-label={text('Embed code for {name}', { name: w.name })} className="flex-1 border-l border-line p-2.5 text-center text-[12.5px] font-bold text-primary hover:bg-subtle">
          {text('Embed code')}
        </button>
      </div>
    </article>
  );
}

/** This week across every widget (the Insights report's last 7 days): conversations, first response, rating, missed, returning visitors. */
function Week({ d, onInsights }: { d: Insights | undefined; onInsights: () => void }) {
  const v = (x: number | null | undefined, f: (n: number) => string) => (x === null || x === undefined ? '—' : f(x));
  return (
    <section aria-label={text('Widget analytics · this week')} className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center">
        <h2 className="flex-1 text-[14px] font-bold">{text('Widget analytics · this week')}</h2>
        <button type="button" onClick={onInsights} className="text-[12.5px] font-bold text-primary hover:underline">
          {text('Open Insights →')}
        </button>
      </div>
      <div role="list" aria-label={text('This week')} className="grid grid-cols-5 gap-2.5 text-[12px]">
        <Figure big label="Conversations" value={v(d?.conversations.value, (n) => n.toLocaleString('en-US'))} />
        <Figure big label="Avg first response" value={v(d?.first_response.value, clock)} />
        <Figure big label="Avg rating" value={v(d?.rating.value, (n) => n.toFixed(1))} />
        <Figure big label="Missed" value={v(d?.missed.value, (n) => n.toLocaleString('en-US'))} tone={d?.missed.value ? 'red' : undefined} />
        <Figure big label="Returning visitors" value={v(d?.visitors.returning_share, (n) => `${n}%`)} />
      </div>
    </section>
  );
}

/** New widget (WGT-01): a name and the site it goes on; the rest is set in its editor, which opens next. */
function NewWidget({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await apiPost<{ id: number }>(`${WEBSITE}/widgets`, { name: name.trim(), allowed_domains: site.trim() });
      toast('success', text('Widget created'));
      onCreated(r.id);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('New widget')}
      labelledBy="new-widget-title"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>{text('Cancel')}</Button>
          <Button variant="primary" type="submit" form="new-widget" loading={busy} disabled={busy || !name.trim()}>{text('Create widget')}</Button>
        </>
      }
    >
      <form
        id="new-widget"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <TextField label={text('Widget name')} value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Techubiz support" />
        <TextField label={text('Website')} value={site} maxLength={190} onChange={(e) => setSite(e.target.value)} placeholder="techubiz.com" hint={text('The site it goes on. It serves only the sites it is allowed on.')} />
      </form>
    </Modal>
  );
}

export function WebsiteWidgets({ onOpen, onInsights }: { onOpen: (id: number, tab?: 'embed') => void; onInsights: () => void }) {
  useTabTitle('Website widgets');
  const qc = useQueryClient();
  // The counts are of now: kept fresh while the list is open.
  const list = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), refetchInterval: 30_000 });
  const week = useQuery({ ...insightsQuery('7d', null), retry: false });
  const [adding, setAdding] = useState(false);
  const widgets = list.data?.widgets ?? [];
  const canManage = list.data?.can?.manage ?? false;

  return (
    <main aria-label={text('Website widgets')} className="flex h-full min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto border-l border-line bg-ground px-[22px] py-4 text-[13px] text-ink scroll-thin">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold">{text('Website widgets')}</h1>
          <p className="text-[12.5px] text-ink-3">{text('One widget per website. Each has its own look, staff, hours and rules.')}</p>
        </div>
        <Button variant="primary" icon="plus" disabled={!canManage} title={canManage ? undefined : text('Needs the “Create and configure chat widgets” permission')} onClick={() => setAdding(true)}>
          {text('New widget')}
        </Button>
      </div>
      {list.isLoading ? <Spinner /> : null}
      {list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && !widgets.length ? <Empty icon="globe" title={text('No widgets yet')} hint={text('Create one with New widget, then paste its embed code into your site.')} /> : null}
      {widgets.length ? (
        <div className="grid grid-cols-3 gap-3.5">
          {widgets.map((w) => (
            <WidgetCard key={w.id} w={w} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
      {widgets.length ? <Week d={week.data} onInsights={onInsights} /> : null}
      {adding ? (
        <NewWidget
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
            onOpen(id);
          }}
        />
      ) : null}
    </main>
  );
}
