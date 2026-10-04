import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { useTab, useTabTitle } from '../../../../core/tab-context';
import { Select } from '../../../../components/Select';
import { Button, Card, Empty, ErrorNote, Spinner, Switch, TextField, cx } from '../../../../components/ui';
import { Segmented } from '../live/LiveDashboard';
import { Area, Choice, Labelled, Section, Toggle } from './parts';
import { BehaviourTab, EmbedTab, useBehaviour } from './Behaviour';
import { ChatbotTab, useChatbot } from './ChatbotTab';
import { LiveStatusCalls } from './LiveStatusCalls';
import { StaffTab, useStaffList } from './StaffTab';
import { siteOf } from './Widgets';
import {
  ACCENT_SWATCHES,
  AUTO_OPEN_MAX,
  BRAND_SWATCHES,
  DAYS,
  MAX_LINKS,
  OFFSET_MAX,
  RADIUS_MAX,
  clampOffset,
  designOf,
  hoursOf,
  hoursText,
  palette,
  previewPeople,
  problems,
  saveDesign,
  saveHours,
  siteNameOf,
  weekOf,
  widgetsList,
  withDefaults,
  type DesignPayload,
  type HoursDay,
  type HoursSummary,
  type QuickLink,
  type Theme,
  type WidgetDesign,
  type WidgetRow,
} from './design';
import { WidgetPreview, type PreviewScreen } from './WidgetPreview';

/**
 * Website chats › Widgets & embed › a widget (S-02; WS-WCHAT X-UI-15, UX-SET-02, UX-SET-03): one editor for every
 * setting of one widget, in the tabs Appearance · Behaviour · Live status & calls · Staff · Hours · Chatbot · Embed
 * code, under "Widgets & embed › techubiz.com" with the widget's name, Cancel and Save.
 *
 * APPEARANCE (UX-SET-03, WGT-03, WGT-05) is the design's two cards — the names, the header, the welcome and offline
 * messages; brand and accent colour, position, corner radius, the button and auto-open — beside a LIVE PREVIEW that
 * follows every field before it is saved. The rest of the widget's look from #199/#207 (logo, theme, home screen,
 * WhatsApp, the launcher's place and greeting card) stays below them, and the preview can show those screens too.
 *
 * Appearance and Hours are one form: Save sends the design (`PUT widgets/{id}/design`), whose photos are shown — the
 * Team photos card, under Appearance since S-04 gave Staff its own table — and the hours (`widgets/{id}/hours`); Cancel
 * puts back what is saved. BEHAVIOUR (S-03, X-UI-16) has its own Cancel and Save in the same header and saves only what
 * it changed (`PUT widgets/{id}/behaviour`); beside its rules, and alone on the Embed code tab, are the snippet with
 * Copy, the install check and the install guides. STAFF (S-04, X-UI-17) is the table of who answers, with "Add people"
 * in the header; each change there is saved as it is made. Live status & calls (V-05) saves on its own. CHATBOT (S-05,
 * X-UI-18) saves from the header's Save, only what it changed (`PUT widgets/{id}/chatbot`), beside its Try it panel. Anybody who can see website chats can look; only somebody who may configure
 * widgets can save, and the screen says so.
 */

/** Whether this computer prefers a dark theme: what "Match the visitor" looks like to the person editing. */
const prefersDark = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
const darkFor = (theme: Theme) => theme === 'dark' || (theme === 'auto' && prefersDark());

const SCREENS: Array<{ id: PreviewScreen; label: string }> = [
  { id: 'start', label: 'New chat' },
  { id: 'home', label: 'Home' },
  { id: 'chat', label: 'Conversation' },
  { id: 'away', label: 'Away' },
  { id: 'launcher', label: 'Launcher' },
];

export type WidgetTab = 'appearance' | 'behaviour' | 'calls' | 'staff' | 'hours' | 'chatbot' | 'embed';

/** The tabs, in the design's order (UX-SET-02). */
export const WIDGET_TABS: Array<{ id: WidgetTab; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'calls', label: 'Live status & calls' },
  { id: 'staff', label: 'Staff' },
  { id: 'hours', label: 'Hours' },
  { id: 'chatbot', label: 'Chatbot' },
  { id: 'embed', label: 'Embed code' },
];

/** The tabs Save and Cancel act on: one form, one save. */
const DESIGN_TABS: WidgetTab[] = ['appearance', 'hours'];

/** `?tab=` as the address carries it; `design` is the Appearance tab's name from before S-02. */
export function tabOf(q: string | null): WidgetTab {
  if (q === 'design') return 'appearance';
  return WIDGET_TABS.find((t) => t.id === q)?.id ?? 'appearance';
}

const ZONES = ['Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

export function WidgetSettings({ onList }: { onList?: () => void }) {
  const { query } = useTab();
  const list = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), retry: false });
  const widgets = list.data?.widgets ?? [];
  const asked = Number(query.get('widget')) || null;
  const row = widgets.find((w) => w.id === asked) ?? widgets[0] ?? null;
  useTabTitle(row?.name ?? 'Widget');

  if (list.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (list.error) return <div className="flex-1 p-6"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div>;
  if (!row) return <div className="flex flex-1"><Empty icon="globe" title="No widgets yet" hint="Create one under Widgets & embed, then design it here." /></div>;
  return <WidgetEditor key={row.id} row={row} initialTab={tabOf(query.get('tab'))} onList={onList} />;
}

/** A row of ready colours and the hex field beside them (S-02's Brand colour and Accent colour). */
function Swatches({ label, value, swatches, onChange, error }: { label: string; value: string; swatches: string[]; onChange: (v: string) => void; error?: string | null }) {
  const lid = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={lid} className="text-[12.5px] font-semibold text-ink">{label}</span>
      <div className="flex items-center gap-2">
        <span role="radiogroup" aria-labelledby={lid} className="flex items-center gap-2">
          {swatches.map((c) => {
            const on = value.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c}
                title={c}
                onClick={() => onChange(c)}
                className="h-7 w-7 rounded-full"
                style={{ background: c, boxShadow: on ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }}
              />
            );
          })}
        </span>
        <input aria-label={label} value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} className={cx('h-[30px] w-[86px] rounded-[8px] border bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-primary', error ? 'border-danger' : 'border-line')} />
      </div>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}

function WidgetEditor({ row, initialTab, onList }: { row: WidgetRow; initialTab: WidgetTab; onList?: () => void }) {
  const id = row.id;
  const formId = useId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['website', 'widget-design', id], queryFn: ({ signal }) => designOf(id, signal), retry: false });
  const hq = useQuery({ queryKey: ['website', 'widget-hours', id], queryFn: ({ signal }) => hoursOf(id, signal), retry: false });
  const [tab, setTab] = useState<WidgetTab>(initialTab);
  // Live status & calls is mounted on its first visit and then kept, so switching tabs never loses what is edited.
  const [seen, setSeen] = useState<Partial<Record<WidgetTab, boolean>>>(() => ({ [initialTab]: true }));
  // What is being edited, over what the server holds: null means "as saved".
  const [draft, setDesign] = useState<WidgetDesign | null>(null);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const [weekDraft, setWeek] = useState<{ days: HoursDay[]; timezone: string; configured: boolean } | null>(null);
  const [hoursDraft, setHoursOn] = useState<boolean | null>(null);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [screen, setScreen] = useState<PreviewScreen>('start');
  const [busy, setBusy] = useState(false);
  // Behaviour (S-03) saves from this header, so its draft lives here; Staff (S-04) adds from it.
  const b = useBehaviour(id);
  const [adding, setAdding] = useState(false);
  const staffList = useStaffList(id, Boolean(seen.staff));
  // The Chatbot (S-05) saves from this header too.
  const bot = useChatbot(id, Boolean(seen.chatbot));

  const saved = useMemo(() => (q.data?.design ? withDefaults(q.data.design, q.data.widget?.name ?? row.name) : null), [q.data, row.name]);
  const design = draft ?? saved;
  const savedWeek = useMemo(() => (hq.data ? weekOf(hq.data) : null), [hq.data]);
  const week = weekDraft ?? savedWeek;
  const hoursOn = hoursDraft ?? Boolean(savedWeek?.configured);
  const issues = useMemo(() => (design ? problems(design) : {}), [design]);
  const p = q.data;

  const open = (t: WidgetTab) => {
    setTab(t);
    setSeen((s) => ({ ...s, [t]: true }));
  };
  const can = Boolean(p?.can_manage);
  const blocked = Object.keys(issues).length > 0;
  const dirty = Boolean(draft || weekDraft || hoursDraft !== null || Object.keys(shown).length);
  const undo = () => {
    setDesign(null);
    setShown({});
    setWeek(null);
    setHoursOn(null);
    setHoursTouched(false);
  };

  const save = async () => {
    if (!design || blocked) return;
    setBusy(true);
    try {
      const fresh = await saveDesign(id, design, shown);
      if (hoursTouched && week) {
        // Switching the hours off opens every day round the clock: there is nothing to delete hours with, and
        // "always open" is what a widget without hours means.
        const days = hoursOn ? week.days : week.days.map((d) => ({ ...d, is_open: true, opens_at: '00:00', closes_at: '23:59:59' }));
        if (hoursOn || week.configured) await saveHours(id, days, week.timezone);
      }
      qc.setQueryData<DesignPayload>(['website', 'widget-design', id], fresh);
      undo();
      void qc.invalidateQueries({ queryKey: ['website', 'widget-hours', id] });
      void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
      toast('success', text('Widget saved — visitors see it on their next page'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const designTab = DESIGN_TABS.includes(tab);
  const title = design?.name.trim() || p?.widget.name || row.name;
  const site = p?.widget.domain || siteOf(row);

  return (
    <main aria-label={text('Widget settings')} className="flex h-full min-w-0 flex-1 flex-col gap-3 border-l border-line bg-ground px-[22px] py-4 text-[13px] text-ink">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="text-[12.5px] text-ink-3">
            {onList ? (
              <button type="button" onClick={onList} className="hover:text-primary hover:underline">Widgets &amp; embed</button>
            ) : (
              <span>Widgets &amp; embed</span>
            )}
            {' › '}
            <b className="text-ink">{site}</b>
          </nav>
          <h1 className="truncate text-[21px] font-bold">{title}</h1>
        </div>
        {designTab ? (
          <>
            {blocked ? <span className="text-[12px] text-danger">Fix the highlighted fields to save.</span> : null}
            <Button type="button" disabled={busy || !dirty} onClick={undo}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!can || busy || blocked || !design}>Save</Button>
          </>
        ) : tab === 'behaviour' && b.settings ? (
          <>
            {b.blocked ? <span className="text-[12px] text-danger">Fix the highlighted fields to save.</span> : null}
            <Button type="button" disabled={b.busy || !b.dirty} onClick={b.undo}>Cancel</Button>
            <Button type="button" variant="primary" loading={b.busy} disabled={!b.can || b.busy || b.blocked || !b.dirty} onClick={() => void b.save()}>Save</Button>
          </>
        ) : tab === 'staff' ? (
          <Button type="button" variant="primary" disabled={!staffList.data} onClick={() => setAdding(true)}>Add people</Button>
        ) : tab === 'chatbot' && bot.settings ? (
          <>
            {bot.blocked ? <span className="text-[12px] text-danger">Fix the highlighted fields to save.</span> : null}
            <Button type="button" variant="primary" loading={bot.busy} disabled={!bot.can || bot.busy || bot.blocked || !bot.dirty} onClick={() => void bot.save()}>Save</Button>
          </>
        ) : null}
      </div>
      <div role="tablist" aria-label="Widget settings" className="flex gap-0.5 border-b border-line">
        {WIDGET_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`widget-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`widget-panel-${t.id}`} onClick={() => open(t.id)} className={cx('-mb-px border-b-2 px-[13px] py-2 text-[13px]', tab === t.id ? 'border-primary font-bold text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      {designTab ? (
        q.isLoading || !design ? (
          q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : <div className="flex flex-1 items-center justify-center"><Spinner /></div>
        ) : (
          <form
            id={formId}
            aria-label="Widget settings"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {!can ? <p role="note" className="mb-3 rounded-[8px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">You can look at the widget's design. Changing it needs the “Create and configure chat widgets” permission.</p> : null}
            {p && !p.installed ? <p role="note" className="mb-3 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-ink-2">The server has not been updated for the new widget yet: only the colour, position, theme and away message can be saved.</p> : null}
            <fieldset disabled={!can || busy} className="flex min-h-0 flex-1 flex-col">
              <DesignPanels
                tab={tab}
                design={design}
                p={p}
                issues={issues}
                setDesign={setDesign}
                shown={shown}
                setShown={setShown}
                week={week}
                setWeek={setWeek}
                hoursOn={hoursOn}
                setHoursOn={setHoursOn}
                setHoursTouched={setHoursTouched}
                screen={screen}
                setScreen={setScreen}
                onStaff={() => open('staff')}
              />
            </fieldset>
          </form>
        )
      ) : null}
      {seen.calls ? (
        <div role="tabpanel" id="widget-panel-calls" aria-labelledby="widget-tab-calls" hidden={tab !== 'calls'} className={cx('-mx-[22px] min-h-0 flex-1', tab === 'calls' ? 'flex' : 'hidden')}>
          <LiveStatusCalls key={id} id={id} onManageStaff={() => open('staff')} />
        </div>
      ) : null}
      {tab === 'behaviour' ? (
        <div role="tabpanel" id="widget-panel-behaviour" aria-labelledby="widget-tab-behaviour" className="flex min-h-0 flex-1">
          <BehaviourTab b={b} site={site} fallbackCode={row.embed_code ?? null} />
        </div>
      ) : null}
      {tab === 'staff' ? (
        <div role="tabpanel" id="widget-panel-staff" aria-labelledby="widget-tab-staff" className="flex min-h-0 flex-1">
          <StaffTab id={id} widgetName={title} adding={adding} setAdding={setAdding} />
        </div>
      ) : null}
      {tab === 'chatbot' ? (
        <div role="tabpanel" id="widget-panel-chatbot" aria-labelledby="widget-tab-chatbot" className="flex min-h-0 flex-1">
          <ChatbotTab id={id} c={bot} />
        </div>
      ) : null}
      {tab === 'embed' ? (
        <div role="tabpanel" id="widget-panel-embed" aria-labelledby="widget-tab-embed" className="flex min-h-0 flex-1">
          <EmbedTab b={b} site={site} fallbackCode={row.embed_code ?? null} />
        </div>
      ) : null}
    </main>
  );
}

interface PanelProps {
  tab: WidgetTab;
  design: WidgetDesign;
  p: DesignPayload | undefined;
  issues: Partial<Record<keyof WidgetDesign | 'quick_links', string>>;
  setDesign: (f: (d: WidgetDesign | null) => WidgetDesign | null) => void;
  shown: Record<number, boolean>;
  setShown: (f: (s: Record<number, boolean>) => Record<number, boolean>) => void;
  week: { days: HoursDay[]; timezone: string; configured: boolean } | null;
  setWeek: (f: ((w: { days: HoursDay[]; timezone: string; configured: boolean } | null) => { days: HoursDay[]; timezone: string; configured: boolean } | null) | { days: HoursDay[]; timezone: string; configured: boolean }) => void;
  hoursOn: boolean;
  setHoursOn: (v: boolean) => void;
  setHoursTouched: (v: boolean) => void;
  screen: PreviewScreen;
  setScreen: (s: PreviewScreen) => void;
  /** Opens the Staff tab, where people are added (S-04). */
  onStaff: () => void;
}

/** Appearance and Hours: the panels of the one design form, each kept mounted so nothing typed is lost. */
function DesignPanels({ tab, design, p, issues, setDesign, shown, setShown, week, setWeek, hoursOn, setHoursOn, setHoursTouched, screen, setScreen, onStaff }: PanelProps) {
  const set = <K extends keyof WidgetDesign>(k: K, v: WidgetDesign[K]) => setDesign((d) => ({ ...(d ?? design), [k]: v }));
  const { people, sample } = previewPeople(p, design, shown);
  const hoursPreview: HoursSummary | null = hoursOn && week ? { timezone: week.timezone, zone: p?.hours?.zone && p.hours.timezone === week.timezone ? p.hours.zone : week.timezone.replace(/_/g, ' '), text: hoursText(week.days), open_now: false, back_at: p?.hours?.back_at ?? '9:00 AM tomorrow' } : null;
  const brand = palette(design.brand_color);
  const setLink = (i: number, patch: Partial<QuickLink>) => set('quick_links', design.quick_links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setDay = (d: number, patch: Partial<HoursDay>) => {
    setHoursTouched(true);
    setWeek((w) => {
      const base = w ?? week;
      return base ? { ...base, days: base.days.map((x) => (x.weekday === d ? { ...x, ...patch } : x)) } : base;
    });
  };
  const panel = (id: WidgetTab, children: ReactNode, className?: string) => (
    <div role="tabpanel" id={`widget-panel-${id}`} aria-labelledby={`widget-tab-${id}`} hidden={tab !== id} className={cx('min-h-0 flex-1', tab === id ? 'flex' : 'hidden', className)}>
      {children}
    </div>
  );
  const offsetField = design.position === 'bottom_left' ? 'launcher_offset_left' : 'launcher_offset_right';

  return (
    <>
      {panel(
        'appearance',
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 scroll-thin">
            <div className="grid grid-cols-2 gap-3.5 rounded-[12px] border border-line bg-surface p-4">
              <TextField label="Widget name" value={design.name} maxLength={120} onChange={(e) => set('name', e.target.value)} error={issues.name ?? null} />
              <TextField
                label="Website name"
                value={design.website_name ?? ''}
                maxLength={190}
                onChange={(e) => set('website_name', e.target.value || null)}
                placeholder={p?.fallback_name || undefined}
                error={issues.website_name ?? null}
              />
              <TextField label="Header title" value={design.header_title ?? ''} maxLength={120} onChange={(e) => set('header_title', e.target.value || null)} placeholder="Chat with us" />
              <TextField label="Header subtitle" value={design.header_subtitle ?? ''} maxLength={190} onChange={(e) => set('header_subtitle', e.target.value || null)} />
              <TextField label="Welcome message" className="col-span-2" value={design.welcome_message ?? ''} maxLength={500} onChange={(e) => set('welcome_message', e.target.value || null)} />
              <div className="col-span-2">
                <Area label="Offline message" value={design.offline_message ?? ''} max={500} onChange={(v) => set('offline_message', v || null)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3.5 rounded-[12px] border border-line bg-surface p-4">
              <div className="flex flex-col gap-1">
                <Swatches label="Brand colour" value={design.brand_color} swatches={BRAND_SWATCHES} onChange={(v) => set('brand_color', v.toUpperCase())} error={issues.brand_color ?? null} />
                {brand.lightBrand && !issues.brand_color ? <span className="text-[12px] text-ink-3">A light colour: text on it will be dark, so it stays readable.</span> : null}
              </div>
              <Swatches label="Accent colour" value={design.accent_color} swatches={ACCENT_SWATCHES} onChange={(v) => set('accent_color', v.toUpperCase())} error={issues.accent_color ?? null} />
              <Labelled label="Position">
                <span className="w-max">
                  <Segmented label="Position" value={design.position} onChange={(v) => set('position', v)} options={[['bottom_left', 'Bottom left'], ['bottom_right', 'Bottom right']] as const} />
                </span>
              </Labelled>
              <Labelled label={text('Corner radius · {n} px', { n: design.border_radius })}>
                <input type="range" aria-label="Corner radius" min={0} max={RADIUS_MAX} step={1} value={design.border_radius} onChange={(e) => set('border_radius', Number(e.target.value))} className="mt-2 w-full accent-primary" />
              </Labelled>
              <Labelled label="Button">
                <span className="w-max">
                  <Segmented label="Button" value={design.launcher_style} onChange={(v) => set('launcher_style', v)} options={[['bubble', 'Icon'], ['pill', 'Icon + "Chat with us"']] as const} />
                </span>
              </Labelled>
              <TextField
                label="Auto-open after (seconds)"
                type="number"
                min={0}
                max={AUTO_OPEN_MAX}
                placeholder="Never"
                value={design.auto_open_delay ? String(design.auto_open_delay) : ''}
                onChange={(e) => set('auto_open_delay', Math.max(0, Math.min(AUTO_OPEN_MAX, Math.round(Number(e.target.value)) || 0)))}
                error={issues.auto_open_delay ?? null}
                className="[&_input]:w-[120px]"
              />
            </div>

            {/* The rest of the widget's look (#199, #207): kept with Appearance until their own screens come. */}
            <Card title="Logo and theme">
              <div className="flex flex-col gap-3">
                <TextField label="Logo" value={design.logo_url ?? ''} maxLength={500} onChange={(e) => set('logo_url', e.target.value || null)} placeholder="https://example.com/logo.png" hint="A square image at a web address. Without one, the company's initial is shown." error={issues.logo_url ?? null} />
                <Choice label="Theme" value={design.theme} onChange={(v) => set('theme', v)} options={[{ value: 'auto', label: 'Match the visitor' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
                <span className="text-[12px] text-ink-3">The header and the body follow it: white under the brand colour, or dark under a darker one.</span>
              </div>
            </Card>
            <Card title="Home screen">
              <div className="flex flex-col gap-3">
                <Area label="Greeting" value={design.greeting ?? ''} max={120} onChange={(v) => set('greeting', v || null)} placeholder={'Hi there,\nhow can we help?'} />
                <div className="flex flex-col gap-2" role="group" aria-label="Quick help links">
                  <span className="text-[12.5px] font-semibold text-ink-2">Quick help links</span>
                  {design.quick_links.map((l, i) => (
                    <span key={i} className="flex items-center gap-2">
                      <input aria-label={text('Link {n} label', { n: i + 1 })} value={l.label} maxLength={60} onChange={(e) => setLink(i, { label: e.target.value })} placeholder="Pricing and plans" className="h-9 w-[38%] rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary" />
                      <input aria-label={text('Link {n} address', { n: i + 1 })} value={l.url} maxLength={500} onChange={(e) => setLink(i, { url: e.target.value })} placeholder="https://" className="h-9 flex-1 rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary" />
                      <Button type="button" size="sm" variant="ghost" icon="x" aria-label={text('Remove link {n}', { n: i + 1 })} onClick={() => set('quick_links', design.quick_links.filter((_, j) => j !== i))} />
                    </span>
                  ))}
                  {issues.quick_links ? <span role="alert" className="text-[12px] text-danger">{issues.quick_links}</span> : null}
                  {design.quick_links.length < MAX_LINKS ? (
                    <Button type="button" size="sm" icon="plus" className="self-start" onClick={() => set('quick_links', [...design.quick_links, { label: '', url: '' }])}>Add a link</Button>
                  ) : null}
                </div>
              </div>
            </Card>
            <Card title="Away screen">
              <TextField label="WhatsApp number" value={design.whatsapp_number ?? ''} maxLength={32} onChange={(e) => set('whatsapp_number', e.target.value || null)} placeholder="+94 77 123 4567" hint="Optional. Offered on the away screen for anything urgent." error={issues.whatsapp_number ?? null} />
            </Card>
            <Card title="Launcher">
              <div className="flex flex-col gap-3">
                <span className="flex gap-3">
                  <TextField label="From the bottom (px)" type="number" min={0} max={OFFSET_MAX} value={String(design.launcher_offset_bottom)} onChange={(e) => set('launcher_offset_bottom', clampOffset(Number(e.target.value) || 0))} error={issues.launcher_offset_bottom ?? null} className="flex-1" />
                  <TextField
                    label={design.position === 'bottom_left' ? 'From the left (px)' : 'From the right (px)'}
                    type="number"
                    min={0}
                    max={OFFSET_MAX}
                    value={String(design[offsetField])}
                    onChange={(e) => set(offsetField, clampOffset(Number(e.target.value) || 0))}
                    error={issues[offsetField] ?? null}
                    className="flex-1"
                  />
                </span>
                <span className="text-[12px] text-ink-3">{text('0 to {max}px. Move the launcher clear of your site\'s own buttons; the chat opens 16px above it.', { max: OFFSET_MAX })}</span>
                <TextField label="Greeting card after (seconds)" type="number" min={0} max={300} value={String(design.greeting_delay)} onChange={(e) => set('greeting_delay', Math.max(0, Math.min(300, Number(e.target.value) || 0)))} hint="0 is off. Shown once a visit, while the team is online; the visitor can dismiss it." />
                <Area label="Greeting card message" value={design.greeting_text ?? ''} max={300} onChange={(v) => set('greeting_text', v || null)} placeholder="Hi there. Looking for hosting, a website or WorkSuite? Ask us anything." hint="Its quick replies are the widget's conversation starters." />
              </div>
            </Card>
            {/* Whose photos visitors see and how they are named (#199): what the widget shows, so with its look. */}
            <Card title="Team photos">
              <Section title="Team" hint="Visitors see up to three photos of the people online, and how many more are. Real profile photos, initials where there is none.">
                <Toggle label="Show the team's photos" checked={design.show_agents} onChange={(v) => set('show_agents', v)} />
                <Choice label="Name staff as" value={design.staff_display} onChange={(v) => set('staff_display', v)} options={[{ value: 'name_role', label: 'Name and role' }, { value: 'first_name', label: 'First name only' }]} />
                {p?.agents.length ? (
                  <ul aria-label="Whose photos are shown" className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
                    {p.agents.map((a) => (
                      <li key={a.user_id} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[13px] font-semibold text-ink">{a.name}</span>
                          <span className="truncate text-[12px] text-ink-3">{[a.role, a.presence === 'online' ? text('Online now') : a.presence === 'away' ? text('Away') : text('Offline'), a.active ? null : text('Suspended')].filter(Boolean).join(' · ')}</span>
                        </span>
                        <Switch label={text('Show {name} to visitors', { name: a.name })} checked={shown[a.user_id] ?? a.shown} onChange={(v) => setShown((s) => ({ ...s, [a.user_id]: v }))} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-ink-3">Nobody is added to this widget, so everybody who answers website chats is shown. Add people on the Staff tab to choose.</p>
                )}
                {sample && design.show_agents ? <span className="text-[12px] text-ink-3">The preview uses stand-in people until somebody is here.</span> : null}
                <Button type="button" className="self-start" onClick={onStaff}>Manage staff</Button>
              </Section>
            </Card>
          </div>
          <aside aria-label="Preview" className="relative flex w-[380px] shrink-0 flex-col items-end justify-end gap-3 overflow-hidden rounded-[12px] border border-line bg-subtle p-[18px]">
            <div className="absolute top-3 right-3.5 left-3.5 flex flex-wrap items-center gap-1">
              <span className="mr-auto text-[10.5px] font-bold tracking-[0.9px] text-ink-3">LIVE PREVIEW</span>
              <div role="tablist" aria-label="Preview screen" className="flex gap-0.5">
                {SCREENS.map((s) => (
                  <button key={s.id} type="button" role="tab" aria-selected={screen === s.id} onClick={() => setScreen(s.id)} className={cx('h-6 rounded-[6px] px-1.5 text-[11px] font-semibold', screen === s.id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface')}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {/* The full screens are drawn at the widget's own size, 420px, and shown at four fifths to fit. */}
            <div className={cx('flex w-full', screen === 'start' ? '' : 'mt-12 justify-center overflow-y-auto')} style={screen === 'start' ? undefined : { zoom: 0.8 }}>
              <WidgetPreview design={design} siteName={siteNameOf(design, p?.fallback_name)} people={people} replyTime={p?.reply_time ?? 'Usually replies in a few minutes'} hours={hoursPreview} screen={screen} dark={darkFor(design.theme)} starters={p?.starters ?? []} />
            </div>
          </aside>
        </div>,
      )}
      {panel(
        'hours',
        <div className="flex max-w-[860px] flex-1 flex-col gap-3 overflow-y-auto pb-4 scroll-thin">
          <Card>
            <div className="flex flex-col gap-3 pt-4">
              <Toggle
                label="Business hours"
                hint={hoursOn ? 'Outside these hours the widget shows the away screen.' : 'Off: the widget is open whenever somebody is online.'}
                checked={hoursOn}
                onChange={(v) => {
                  setHoursOn(v);
                  setHoursTouched(true);
                }}
              />
              {hoursOn && week ? (
                <div className="flex flex-col gap-2">
                  <Select
                    aria-label="Timezone"
                    value={week.timezone}
                    onValueChange={(v) => {
                      setHoursTouched(true);
                      setWeek({ ...week, timezone: v });
                    }}
                    options={[...new Set([week.timezone, ...ZONES])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
                  />
                  <table className="w-full text-[13px]">
                    <tbody>
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const day = week.days.find((x) => x.weekday === d)!;
                        return (
                          <tr key={d}>
                            <th scope="row" className="w-28 py-1 text-left font-semibold text-ink">{DAYS[d]}</th>
                            <td className="py-1"><Switch label={text('Open on {day}', { day: DAYS[d]! })} checked={day.is_open} onChange={(v) => setDay(d, { is_open: v })} /></td>
                            <td className="py-1">
                              {day.is_open ? (
                                <span className="flex items-center gap-1.5">
                                  <input type="time" aria-label={text('{day} opens', { day: DAYS[d]! })} value={day.opens_at} onChange={(e) => setDay(d, { opens_at: e.target.value })} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink" />
                                  <span className="text-ink-3">–</span>
                                  <input type="time" aria-label={text('{day} closes', { day: DAYS[d]! })} value={day.closes_at} onChange={(e) => setDay(d, { closes_at: e.target.value })} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink" />
                                </span>
                              ) : (
                                <span className="text-ink-3">Closed</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <span className="text-[12px] text-ink-3">{hoursText(week.days)}</span>
                </div>
              ) : null}
            </div>
          </Card>
        </div>,
      )}
    </>
  );
}
