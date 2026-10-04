import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { useTabTitle } from '../../../core/tab-context';
import { Select } from '../../../components/Select';
import { Button, Empty, ErrorNote, Spinner } from '../../../components/ui';
import { Note } from '../../account/parts';
import { designOf, hoursOf, saveHours, weekOf, widgetsList, type HoursDay } from './widget/design';
import { weekProblems, zoneLabel, zoneList } from './widget/hours';
import { OpenNow, WeekChart, WeekDays } from './widget/HoursWeek';
import { WidgetPicker } from './widget/parts';
import { AWAY_MESSAGE } from './widget/WidgetPreview';

/**
 * Website chats › Business hours (S-10; WS-WCHAT X-UI-22, UX-SET-11; HRS-01), under SETUP as the design has it: one
 * widget's week — its timezone, "Open now · closes 17:30" worked out from what is being edited, Monday to Sunday each
 * on or off with its times, "This week" as bars across the day, and what visitors see outside hours, with the way to
 * the offline message in Appearance. Save hours sends the week (`PUT widgets/{id}/hours`).
 *
 * Public holidays and date exceptions (HRS-02) are not supported, by the server or here. Switching business hours off
 * altogether stays on the widget's Hours tab.
 */

type Week = { days: HoursDay[]; timezone: string; configured: boolean };

export function BusinessHours({ widget, onWidget, onAppearance }: { widget: number | null; onWidget: (id: number) => void; onAppearance: (id: number) => void }) {
  useTabTitle('Business hours');
  const list = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), retry: false });
  const widgets = list.data?.widgets ?? [];
  const row = widgets.find((w) => w.id === widget) ?? widgets[0] ?? null;

  if (list.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (list.error) return <div className="flex-1 p-6"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div>;
  if (!row) return <div className="flex flex-1"><Empty icon="clock" title="No widgets yet" hint="Create one under Widgets & embed, then set its hours here." /></div>;
  return <HoursEditor key={row.id} id={row.id} picker={<WidgetPicker widgets={widgets} value={row.id} onChange={onWidget} />} can={list.data?.can?.manage} onAppearance={() => onAppearance(row.id)} />;
}

function HoursEditor({ id, picker, can: canList, onAppearance }: { id: number; picker: ReactNode; can: boolean | undefined; onAppearance: () => void }) {
  const qc = useQueryClient();
  const hq = useQuery({ queryKey: ['website', 'widget-hours', id], queryFn: ({ signal }) => hoursOf(id, signal), retry: false });
  const dq = useQuery({ queryKey: ['website', 'widget-design', id], queryFn: ({ signal }) => designOf(id, signal), retry: false });
  const saved = useMemo<Week | null>(() => (hq.data ? weekOf(hq.data) : null), [hq.data]);
  const [draft, setDraft] = useState<Week | null>(null);
  const [busy, setBusy] = useState(false);
  const week = draft ?? saved;
  // Who may save: the design payload says so; the widgets list's `can` stands in until it answers.
  const can = dq.data ? dq.data.can_manage : Boolean(canList);
  const problems = week ? weekProblems(week.days) : {};
  const blocked = Object.keys(problems).length > 0;
  const zones = useMemo(() => (week ? zoneList(week.timezone) : []), [week?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDay = (w: number, patch: Partial<HoursDay>) => setDraft((d) => {
    const base = d ?? saved;
    return base ? { ...base, days: base.days.map((x) => (x.weekday === w ? { ...x, ...patch } : x)) } : base;
  });

  const save = async () => {
    if (!week || blocked) return;
    setBusy(true);
    try {
      await saveHours(id, week.days, week.timezone);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['website', 'widget-hours', id] });
      // The widget card's "Open now" or "Closed · opens 08:30", and the away screen's words.
      void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
      void qc.invalidateQueries({ queryKey: ['website', 'widget-design', id] });
      toast('success', 'Business hours saved');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const offline = dq.data?.design.offline_message?.trim() || AWAY_MESSAGE;

  return (
    <main aria-label="Business hours" className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto border-l border-line bg-ground px-[22px] py-4 text-[13px] text-ink scroll-thin">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold">Business hours</h1>
          <p className="text-[12.5px] text-ink-3">Outside these hours the widget takes offline enquiries and nothing rings.</p>
        </div>
        {picker}
        <Button variant="primary" loading={busy} disabled={!can || busy || !week || blocked || (!draft && Boolean(saved?.configured))} onClick={() => void save()}>Save hours</Button>
      </div>
      {!can && dq.data ? <Note>You can look at these hours. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
      {hq.error ? (
        <ErrorNote error={hq.error} onRetry={() => void hq.refetch()} />
      ) : !week ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : (
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-[460px] flex-1 flex-col gap-3">
            {!saved?.configured ? <Note tone="amber">This widget has no business hours yet: it is open whenever somebody is online. Save hours to keep to the week below.</Note> : null}
            <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
              <span className="font-semibold">Timezone</span>
              <Select aria-label="Timezone" className="w-[280px]" disabled={!can || busy} value={week.timezone} onValueChange={(v) => setDraft({ ...week, timezone: v })} options={zones.map((z) => ({ value: z, label: zoneLabel(z) }))} />
              <span className="flex-1" />
              <OpenNow days={week.days} zone={week.timezone} />
            </div>
            <WeekDays days={week.days} onDay={setDay} problems={problems} disabled={!can || busy} />
          </div>
          <div className="flex w-[360px] shrink-0 flex-col gap-3">
            <WeekChart days={week.days} />
            <section aria-label="Outside hours, visitors see" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
              <h2 className="text-[14px] font-bold">Outside hours, visitors see</h2>
              <p className="rounded-[10px] border border-line bg-subtle px-3 py-2.5 text-[13px] whitespace-pre-line">{offline}</p>
              <button type="button" onClick={onAppearance} className="self-start text-[12.5px] font-bold text-primary hover:underline">Edit offline message in Appearance →</button>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
