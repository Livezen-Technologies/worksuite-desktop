import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from '../../core/toasts';
import { Button, Switch } from '../../components/ui';
import { errText, Head, input, Section, useDesk } from './parts';
import { printers, printPage, receiptHtml, type DeskSettings as Settings } from './print';

/**
 * D20 · This desk: settings for this computer only — which location it is, its receipt and A4 printers and the roll
 * width, whether a receipt prints with each payment, and which alerts it raises. Company rules are under Set up.
 */
export default function DeskSettings({ settings: s, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const desk = useDesk();
  const list = useQuery({ queryKey: ['appointments', 'printers'], queryFn: printers, networkMode: 'always' });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const test = async () => {
    try {
      await printPage(receiptHtml({ business: 'WorkSuite Appointments', location: 'Test page', invoice: null, at: new Date().toLocaleString('en-GB'), client: '—', servedBy: desk.me || '—', lines: [{ label: 'Test line', amount: '0.00' }], totals: [{ label: 'TOTAL', amount: '0.00' }], payment: null, footer: `Printed on ${s.receiptPrinter ?? 'the default printer'}` }, s.paper), 'Test receipt', s.receiptPrinter);
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const printerSelect = (k: 'receiptPrinter' | 'a4Printer', name: string) => (
    <select aria-label={name} className={input} value={s[k] ?? ''} onChange={(e) => set(k, e.target.value || null)}>
      <option value="">Ask each time (the system default)</option>
      {(list.data ?? []).map((p) => <option key={p.name} value={p.name}>{`${p.displayName}${p.isDefault ? ' · default' : ''}`}</option>)}
    </select>
  );
  return (
    <div className="max-w-[760px]">
      <Head title="This desk" sub="Settings for this computer only. Company rules are under Set up." />
      <Section title="Desk">
        <Row t="Location" h="What Today, the calendar and walk-ins show.">
          <select aria-label="Location" className={input} value={desk.location ?? ''} onChange={(e) => desk.setLocation(Number(e.target.value))}>
            {(desk.options?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Row>
      </Section>
      <Section title="Printers" className="mt-4">
        <Row t="Receipt printer" h="Receipts and deposit slips.">{printerSelect('receiptPrinter', 'Receipt printer')}</Row>
        <Row t="Roll width" h="80 mm or 58 mm paper.">
          <select aria-label="Roll width" className={input} value={s.paper} onChange={(e) => set('paper', e.target.value as Settings['paper'])}>
            <option value="80mm">80 mm</option>
            <option value="58mm">58 mm</option>
          </select>
        </Row>
        <Row t="Print with each payment" h="Offer the receipt already ticked at checkout."><Switch label="Print with each payment" checked={s.autoPrint} onChange={(v) => set('autoPrint', v)} /></Row>
        <Row t="A4 printer" h="Day sheets, reports and statements.">{printerSelect('a4Printer', 'A4 printer')}</Row>
        <div className="px-3.5 pb-3"><Button variant="secondary" icon="printer" onClick={() => void test()}>Print a test receipt</Button></div>
      </Section>
      <Section title="Alerts on this computer" className="mt-4">
        <Row t="Running late" h="A note on this desk when a booked client is late and has not arrived."><Switch label="Running late" checked={s.alertLate} onChange={(v) => set('alertLate', v)} /></Row>
      </Section>
      <p className="mt-2 mb-0 text-[12px] text-ink-3">New online bookings, arrivals and failed messages come as WorkSuite notifications; choose which under My account › Notifications.</p>
      <Section title="Offline" className="mt-4">
        <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-2">Without a connection this desk shows the day as last read, checks clients in and keeps notes; they are sent in order when WorkSuite is back (Outbox). Booking, moving, checkout and deposits need the connection.</p>
      </Section>
    </div>
  );
}

function Row({ t, h, children }: { t: string; h: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_280px] items-center gap-4 border-t border-line/70 px-3.5 py-2.5">
      <div>
        <div className="text-[13px] font-semibold text-ink">{t}</div>
        <div className="text-[12px] text-ink-3">{h}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
