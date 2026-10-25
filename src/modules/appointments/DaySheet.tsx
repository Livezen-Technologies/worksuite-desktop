import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { dayLabel, fetchDay, K } from './api';
import { errText, Head, input, label, Section, useDesk } from './parts';
import { daySheetHtml, printPage, savePdf, type DeskSettings } from './print';

/**
 * D23 · Day sheets: one A4 page per stylist for a day at this desk's location, from the server's calendar — what is
 * booked, with (as chosen) client phone numbers, the client and internal notes. Print or save as PDF.
 */
export default function DaySheet({ date: initial, settings, onBack }: { date: string; settings: DeskSettings; onBack: () => void }) {
  const desk = useDesk();
  const [date, setDate] = useState(initial);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState(true);
  const [internal, setInternal] = useState(false);
  const [phones, setPhones] = useState(true);
  const [busy, setBusy] = useState(false);
  const loc = desk.options?.locations.find((l) => l.id === desk.location) ?? null;
  const q = useQuery({ queryKey: K.day(loc?.id ?? 0, date), queryFn: ({ signal }) => fetchDay(loc!.id, date, signal), enabled: !!loc });
  const groups = (q.data?.providers ?? [])
    .filter((p) => !off.has(p.id))
    .map((p) => ({ provider: p.name, rows: (q.data?.appointments ?? []).filter((a) => a.provider.id === p.id && a.status !== 'cancelled').sort((x, y) => x.starts_at.localeCompare(y.starts_at)) }));
  const html = () => daySheetHtml(loc?.name ?? '', dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), groups, { notes, internal, phones, printedBy: desk.me || 'desk' });
  const run = async (pdf: boolean) => {
    setBusy(true);
    try {
      if (pdf) {
        const where = await savePdf(html(), `Day sheets ${date}`);
        if (where) toast('success', `Saved to ${where}`);
      } else await printPage(html(), `Day sheets ${date}`, settings.a4Printer);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const tick = (v: boolean, set: (v: boolean) => void, text: string) => (
    <label className="flex items-center gap-2 py-1 text-[12.5px] text-ink"><Checkbox checked={v} onChange={(e) => set(e.target.checked)} />{text}</label>
  );
  return (
    <div>
      <button type="button" className="mb-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={onBack}>‹ Calendar</button>
      <Head title="Print day sheets" sub={`${loc?.name ?? ''} · one page per stylist`}>
        <Button variant="secondary" loading={busy} disabled={!groups.length} onClick={() => void run(true)}>Save PDF</Button>
        <Button variant="primary" icon="printer" loading={busy} disabled={!groups.length} onClick={() => void run(false)}>{`Print ${groups.length} page${groups.length === 1 ? '' : 's'}`}</Button>
      </Head>
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Section>
          <div className="p-3.5">
            <label><span className={label}>Day</span><input type="date" className={input} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
            <div className={cx(label, 'mt-3')}>Stylists</div>
            {(q.data?.providers ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-1 text-[12.5px] text-ink">
                <Checkbox checked={!off.has(p.id)} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                <span className="flex-1">{p.name}</span>
                <span className="text-ink-3">{(q.data?.appointments ?? []).filter((a) => a.provider.id === p.id && a.status !== 'cancelled').length}</span>
              </label>
            ))}
            <div className={cx(label, 'mt-3')}>Include</div>
            {tick(notes, setNotes, 'Client notes')}
            {tick(internal, setInternal, 'Internal notes')}
            {tick(phones, setPhones, 'Client phone numbers')}
            <p className="mt-3 mb-0 text-[11.5px] text-ink-3">{`Printer: ${settings.a4Printer ?? 'ask each time'} · A4`}</p>
          </div>
        </Section>
        <Section>
          {/* A preview of the first page, drawn from the same rows. */}
          <div className="p-5">
            {groups[0] ? (
              <>
                <div className="text-[18px] font-extrabold text-ink">{groups[0].provider}</div>
                <div className="mb-3 text-[12.5px] text-ink-3">{`${dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${loc?.name ?? ''} · ${groups[0].rows.length} appointments`}</div>
                {groups[0].rows.map((a) => (
                  <div key={a.id} className="flex gap-3 border-b border-line/70 py-2 text-[12.5px]">
                    <b className="w-[90px] tabular-nums">{`${a.local.start}–${a.local.end}`}</b>
                    <span className="flex-1">{`${a.customer.name}${phones && a.customer.phone ? ` · ${a.customer.phone}` : ''} · ${a.service.name}`}{internal && a.internal_notes ? <span className="block text-ink-3">{a.internal_notes}</span> : null}</span>
                  </div>
                ))}
                {!groups[0].rows.length ? <p className="text-[12.5px] text-ink-3">Nothing booked.</p> : null}
              </>
            ) : <p className="m-0 text-[12.5px] text-ink-3">{q.isPending ? 'Reading…' : 'Choose a stylist.'}</p>}
          </div>
        </Section>
      </div>
    </div>
  );
}
