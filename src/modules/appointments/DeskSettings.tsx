import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from '../../core/toasts';
import { Button, Switch } from '../../components/ui';
import { errText, input, useDesk } from './parts';
import { printers, printPage, receiptHtml, type DeskSettings as Settings } from './print';
import { SectionHeader, SettingRow, SettingRowFrame, SettingsGroup } from '../../components/SettingsKit';

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
      <SectionHeader title="This desk" hint="Settings for this computer only. Company rules are under Set up." />
      <SettingsGroup title="Desk">
        <Row t="Location" h="What Today, the calendar and walk-ins show.">
          <select aria-label="Location" className={input} value={desk.location ?? ''} onChange={(e) => desk.setLocation(Number(e.target.value))}>
            {(desk.options?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Row>
      </SettingsGroup>
      <SettingsGroup title="Printers">
        <Row t="Receipt printer" h="Receipts and deposit slips.">{printerSelect('receiptPrinter', 'Receipt printer')}</Row>
        <Row t="Roll width" h="80 mm or 58 mm paper.">
          <select aria-label="Roll width" className={input} value={s.paper} onChange={(e) => set('paper', e.target.value as Settings['paper'])}>
            <option value="80mm">80 mm</option>
            <option value="58mm">58 mm</option>
          </select>
        </Row>
        <Row t="Print with each payment" h="Offer the receipt already ticked at checkout."><Switch label="Print with each payment" checked={s.autoPrint} onChange={(v) => set('autoPrint', v)} /></Row>
        <Row t="A4 printer" h="Day sheets, reports and statements.">{printerSelect('a4Printer', 'A4 printer')}</Row>
        <SettingRowFrame><Button variant="secondary" icon="printer" onClick={() => void test()}>Print a test receipt</Button></SettingRowFrame>
      </SettingsGroup>
      <SettingsGroup title="Alerts on this computer">
        <Row t="Running late" h="A note on this desk when a booked client is late and has not arrived."><Switch label="Running late" checked={s.alertLate} onChange={(v) => set('alertLate', v)} /></Row>
      </SettingsGroup>
      <p className="-mt-3 mb-5 text-[12px] text-ink-3">New online bookings, arrivals and failed messages come as WorkSuite notifications; choose which under My account › Notifications.</p>
      <SettingsGroup title="Offline">
        <p className="m-0 px-[18px] py-3.5 text-[12.5px] text-ink-2">Without a connection this desk shows the day as last read, checks clients in and keeps notes; they are sent in order when WorkSuite is back (Outbox). Booking, moving, checkout and deposits need the connection.</p>
      </SettingsGroup>
    </div>
  );
}

/** One desk setting: the Settings kit's row, its control 280 px wide. */
function Row({ t, h, children }: { t: string; h: string; children: ReactNode }) {
  return (
    <SettingRow label={t} hint={h}>
      <div className="w-[280px]">{children}</div>
    </SettingRow>
  );
}
