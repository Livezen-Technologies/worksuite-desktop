import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { useTabTitle } from '../../../../core/tab-context';
import { Select } from '../../../../components/Select';
import { Button, Empty, ErrorNote, Spinner, Switch, TextField, cx } from '../../../../components/ui';
import { DAYS, MAX_LINKS, designOf, hoursOf, hoursText, palette, previewPeople, problems, saveDesign, saveHours, weekOf, widgetsList, type DesignPayload, type HoursDay, type HoursSummary, type QuickLink, type WidgetDesign } from './design';
import { WidgetPreview, type PreviewScreen } from './WidgetPreview';

/**
 * Website chats → Widget (worksuite-desktop#199): how the visitor widget looks and what it says, with a live preview
 * beside the settings — the brand colour, logo, greeting, quick links, whose photos are shown and how they are named,
 * business hours, the away message, WhatsApp, the launcher and its greeting card.
 *
 * Saving sends only these settings (`PUT widgets/{id}/design`, and the hours to `widgets/{id}/hours`); the widget's
 * domains, status and routing stay with the web's widget form, where they are edited. Anybody who can see website
 * chats can look; only somebody who may configure widgets can save, and the screen says so.
 */

const SCREENS: Array<{ id: PreviewScreen; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'chat', label: 'Conversation' },
  { id: 'away', label: 'Away' },
  { id: 'launcher', label: 'Launcher' },
];

const ZONES = ['Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

export function WidgetSettings() {
  useTabTitle('Widget');
  const list = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), retry: false });
  const widgets = list.data?.widgets ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const id = picked ?? widgets[0]?.id ?? null;

  if (list.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (list.error) return <div className="flex-1 p-6"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div>;
  if (!widgets.length || id === null) return <div className="flex flex-1"><Empty icon="globe" title="No widgets yet" hint="Create a widget on the web, then design it here." /></div>;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <b className="flex-1 text-[15px] text-ink">Widget</b>
        {widgets.length > 1 ? (
          <Select aria-label="Widget" value={id} onValueChange={(v) => setPicked(v)} options={widgets.map((w) => ({ value: w.id, label: w.website_name || w.name }))} />
        ) : (
          <span className="text-[12.5px] text-ink-3">{widgets[0]!.website_name || widgets[0]!.name}</span>
        )}
      </header>
      <WidgetEditor key={id} id={id} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line py-5 first:pt-0 last:border-b-0">
      <div>
        <h3 className="text-[14px] font-bold text-ink">{title}</h3>
        {hint ? <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Area({ label, value, onChange, max, rows = 2, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; hint?: string; placeholder?: string }) {
  const fid = useId();
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={fid} className="text-[12.5px] font-semibold text-ink-2">{label}</label>
      <textarea id={fid} rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="resize-none rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary" />
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </span>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx('h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold', value === o.value ? 'border-primary bg-selection text-primary' : 'border-line text-ink hover:bg-subtle')}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const hid = useId();
  return (
    <span className="flex items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[13px] font-semibold text-ink">{label}</span>
        {hint ? <span id={hid} className="text-[12px] text-ink-3">{hint}</span> : null}
      </span>
      <Switch label={label} checked={checked} onChange={onChange} describedBy={hint ? hid : undefined} />
    </span>
  );
}

function WidgetEditor({ id }: { id: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['website', 'widget-design', id], queryFn: ({ signal }) => designOf(id, signal), retry: false });
  const hq = useQuery({ queryKey: ['website', 'widget-hours', id], queryFn: ({ signal }) => hoursOf(id, signal), retry: false });
  // What is being edited, over what the server holds: null means "as saved".
  const [draft, setDesign] = useState<WidgetDesign | null>(null);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const [weekDraft, setWeek] = useState<{ days: HoursDay[]; timezone: string; configured: boolean } | null>(null);
  const [hoursDraft, setHoursOn] = useState<boolean | null>(null);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [screen, setScreen] = useState<PreviewScreen>('home');
  const [busy, setBusy] = useState(false);

  const design = draft ?? q.data?.design ?? null;
  const savedWeek = useMemo(() => (hq.data ? weekOf(hq.data) : null), [hq.data]);
  const week = weekDraft ?? savedWeek;
  const hoursOn = hoursDraft ?? Boolean(savedWeek?.configured);

  const issues = useMemo(() => (design ? problems(design) : {}), [design]);
  const p = q.data;
  if (q.isLoading || !design) return q.error ? <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : <div className="flex flex-1 items-center justify-center"><Spinner /></div>;

  const can = Boolean(p?.can_manage);
  const set = <K extends keyof WidgetDesign>(k: K, v: WidgetDesign[K]) => setDesign((d) => ({ ...(d ?? design), [k]: v }));
  const { people, sample } = previewPeople(p, design, shown);
  const hoursPreview: HoursSummary | null = hoursOn && week ? { timezone: week.timezone, zone: p?.hours?.zone && p.hours.timezone === week.timezone ? p.hours.zone : week.timezone.replace(/_/g, ' '), text: hoursText(week.days), open_now: false, back_at: p?.hours?.back_at ?? '9:00 AM tomorrow' } : null;
  const brand = palette(design.brand_color);
  const blocked = Object.keys(issues).length > 0;

  const setLink = (i: number, patch: Partial<QuickLink>) => set('quick_links', design.quick_links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setDay = (d: number, patch: Partial<HoursDay>) => {
    setHoursTouched(true);
    setWeek((w) => {
      const base = w ?? week;
      return base ? { ...base, days: base.days.map((x) => (x.weekday === d ? { ...x, ...patch } : x)) } : base;
    });
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
      setDesign(null);
      setShown({});
      setWeek(null);
      setHoursOn(null);
      setHoursTouched(false);
      void qc.invalidateQueries({ queryKey: ['website', 'widget-hours', id] });
      toast('success', text('Widget saved — visitors see it on their next page'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <form
        aria-label="Widget settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex min-w-[360px] flex-1 flex-col overflow-y-auto px-6 py-5 scroll-thin"
      >
        {!can ? <p role="note" className="mb-4 rounded-[8px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">You can look at the widget's design. Changing it needs the “Create and configure chat widgets” permission.</p> : null}
        {p && !p.installed ? <p role="note" className="mb-4 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-ink-2">The server has not been updated for the new widget yet: only the colour, position, theme and away message can be saved.</p> : null}
        <fieldset disabled={!can || busy} className="flex flex-col">
          <Section title="Brand" hint="The header, buttons and launcher use the brand colour. Text on it is chosen for contrast.">
            <TextField label="Company name" value={design.website_name ?? ''} maxLength={190} onChange={(e) => set('website_name', e.target.value || null)} placeholder="Livezen Technologies" />
            <span className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-ink-2">Brand colour</span>
                <input type="color" aria-label="Pick the brand colour" value={/^#[0-9a-f]{6}$/i.test(design.brand_color) ? design.brand_color : '#2f3fb5'} onChange={(e) => set('brand_color', e.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded-[8px] border border-line bg-surface p-1" />
              </label>
              <TextField aria-label="Brand colour" value={design.brand_color} maxLength={7} onChange={(e) => set('brand_color', e.target.value)} error={issues.brand_color ?? null} className="flex-1" />
            </span>
            {brand.lightBrand && !issues.brand_color ? <span className="text-[12px] text-ink-3">A light colour: text on it will be dark, so it stays readable.</span> : null}
            <TextField label="Logo" value={design.logo_url ?? ''} maxLength={500} onChange={(e) => set('logo_url', e.target.value || null)} placeholder="https://example.com/logo.png" hint="A square image at a web address. Without one, the company's initial is shown." error={issues.logo_url ?? null} />
            <Choice label="Theme" value={design.dark_mode} onChange={(v) => set('dark_mode', v)} options={[{ value: 'auto', label: 'Match the visitor' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </Section>

          <Section title="Home screen">
            <Area label="Greeting" value={design.greeting ?? ''} max={120} onChange={(v) => set('greeting', v || null)} placeholder={'Hi there,\nhow can we help?'} />
            <Area label="Under the greeting" value={design.header_subtitle ?? ''} max={190} onChange={(v) => set('header_subtitle', v || null)} placeholder="Ask us anything about your account, plans or support." />
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
          </Section>

          <Section title="Team" hint="Visitors see up to three photos of the people online, and how many more are. Real profile photos, initials where there is none.">
            <Toggle label="Show the team's photos" checked={design.show_agents} onChange={(v) => set('show_agents', v)} />
            <Choice label="Name staff as" value={design.staff_display} onChange={(v) => set('staff_display', v)} options={[{ value: 'name_role', label: 'Name and role' }, { value: 'first_name', label: 'First name only' }]} />
            {p?.agents.length ? (
              <ul aria-label="Whose photos are shown" className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
                {p.agents.map((a) => (
                  <li key={a.user_id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-semibold text-ink">{a.name}</span>
                      <span className="truncate text-[12px] text-ink-3">{[a.role, a.presence === 'online' ? text('Online now') : a.presence === 'away' ? text('Away') : text('Offline'), a.active ? null : text('Paused')].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Switch label={text('Show {name} to visitors', { name: a.name })} checked={shown[a.user_id] ?? a.shown} onChange={(v) => setShown((s) => ({ ...s, [a.user_id]: v }))} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-3">Nobody is assigned to this widget, so everybody who answers website chats is shown. Assign staff on the web to choose.</p>
            )}
            {sample && design.show_agents ? <span className="text-[12px] text-ink-3">The preview uses stand-in people until somebody is here.</span> : null}
          </Section>

          <Section title="Away" hint="Shown outside business hours, or when nobody is online. A message left here becomes a website chat, and the reply goes to the visitor by email.">
            <Area label="Away message" value={design.offline_message ?? ''} max={500} onChange={(v) => set('offline_message', v || null)} placeholder="Leave a message and we will reply by email when we are back." />
            <TextField label="WhatsApp number" value={design.whatsapp_number ?? ''} maxLength={32} onChange={(e) => set('whatsapp_number', e.target.value || null)} placeholder="+94 77 123 4567" hint="Optional. Offered on the away screen for anything urgent." error={issues.whatsapp_number ?? null} />
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
                <Select aria-label="Timezone" value={week.timezone} onValueChange={(v) => { setHoursTouched(true); setWeek({ ...week, timezone: v }); }} options={[...new Set([week.timezone, ...ZONES])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} />
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
          </Section>

          <Section title="Launcher">
            <Choice label="Style" value={design.launcher_style} onChange={(v) => set('launcher_style', v)} options={[{ value: 'pill', label: 'Photos and “Chat with us”' }, { value: 'bubble', label: 'Round button' }]} />
            <Choice label="Position" value={design.position} onChange={(v) => set('position', v)} options={[{ value: 'bottom_right', label: 'Bottom right' }, { value: 'bottom_left', label: 'Bottom left' }]} />
            <TextField label="Greeting card after (seconds)" type="number" min={0} max={300} value={String(design.greeting_delay)} onChange={(e) => set('greeting_delay', Math.max(0, Math.min(300, Number(e.target.value) || 0)))} hint="0 is off. Shown once a visit, while the team is online; the visitor can dismiss it." />
            <Area label="Greeting card message" value={design.greeting_text ?? ''} max={300} onChange={(v) => set('greeting_text', v || null)} placeholder="Hi there. Looking for hosting, a website or WorkSuite? Ask us anything." hint="Its quick replies are the widget's conversation starters." />
          </Section>
        </fieldset>
        <div className="sticky bottom-0 -mx-6 mt-2 flex items-center gap-3 border-t border-line bg-surface px-6 py-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!can || busy || blocked}>Save</Button>
          <Button
            type="button"
            disabled={busy || (!draft && !weekDraft && hoursDraft === null && !Object.keys(shown).length)}
            onClick={() => {
              setDesign(null);
              setShown({});
              setWeek(null);
              setHoursOn(null);
              setHoursTouched(false);
            }}
          >
            Undo changes
          </Button>
          {blocked ? <span className="text-[12px] text-danger">Fix the highlighted fields to save.</span> : null}
        </div>
      </form>
      <aside aria-label="Preview" className="flex w-[468px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ground p-5 scroll-thin">
        <div role="tablist" aria-label="Preview screen" className="flex gap-1">
          {SCREENS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={screen === s.id} onClick={() => setScreen(s.id)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', screen === s.id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}>
              {s.label}
            </button>
          ))}
        </div>
        <WidgetPreview design={design} people={people} replyTime={p?.reply_time ?? 'Usually replies in a few minutes'} hours={hoursPreview} screen={screen} dark={design.dark_mode === 'dark'} />
        <p className="text-[12px] text-ink-3">Below 480px wide the widget fills the screen. Visitors who prefer a dark theme see it dark when the theme matches the visitor.</p>
      </aside>
    </div>
  );
}
