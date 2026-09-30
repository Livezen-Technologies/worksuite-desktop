import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PosPrintPatch, PosPrintSettings } from '@shared/pos';
import { Select } from '../../components/Select';
import { Button, Card, Spinner, Switch } from '../../components/ui';
import { toast } from '../../core/toasts';
import { listPrinters, openDrawer, PK, printTest, setPrintSettings, usePrintSettings } from './api';
import { useT } from './i18n';
import { Choice, Failed, Field, Note } from './parts';

/**
 * This computer's receipt printer for POS: the thermal printer at the counter and its roll, ESC/POS straight to it or
 * a page through its driver, copies, printing after every sale, the shop's lines on the receipt, and the cash drawer on
 * the printer's port. Kept on this computer — which printers are plugged in is a fact about it.
 */
const NONE = '';

export default function Printers() {
  const t = useT();
  const qc = useQueryClient();
  const settings = usePrintSettings();
  const printers = useQuery({ queryKey: PK.printers, queryFn: listPrinters });
  const [busy, setBusy] = useState<string | null>(null);
  const [header, setHeader] = useState<string | null>(null);
  const [footer, setFooter] = useState<string | null>(null);

  async function save(patch: PosPrintPatch) {
    setBusy('save');
    try {
      qc.setQueryData<PosPrintSettings>(PK.print, await setPrintSettings(patch));
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That was not saved.');
    } finally {
      setBusy(null);
    }
  }

  async function run(what: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(what);
    try {
      const o = await fn();
      toast(o.ok ? 'success' : 'warning', o.message);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (settings.isError) return <div className="p-6"><Failed text="This computer’s printer settings could not be read." onRetry={() => void settings.refetch()} /></div>;
  if (!settings.data) return <Spinner />;
  const s = settings.data;
  const names = (printers.data ?? []).map((p) => ({ value: p.name, label: p.displayName || p.name }));
  const gone = !!s.receipt_printer && printers.isSuccess && !names.some((n) => n.value === s.receipt_printer);

  return (
    <div className="flex max-w-[760px] flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">{t('pos.printers')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">The till’s receipt printer and cash drawer, on this computer.</p>
      </div>
      {printers.isSuccess && names.length === 0 ? <Note tone="warning">This computer has no printer installed. Install the receipt printer’s driver, then come back here.</Note> : null}
      <Card title={t('pos.receipt')}>
        <div className="flex flex-col gap-4">
          <Field label="Receipt printer" hint={gone ? `“${s.receipt_printer}” is not on this computer any more.` : 'The thermal printer at the counter. Receipts go to it without the print dialog.'}>
            <Select label="Receipt printer" value={s.receipt_printer ?? NONE} options={[{ value: NONE, label: 'None chosen' }, ...names]} loading={printers.isLoading} onValueChange={(v) => void save({ receipt_printer: v || null })} />
          </Field>
          <Field label="Roll width">
            <Choice label="Roll width" value={s.paper} onChange={(paper) => void save({ paper })} options={[{ value: '80mm', label: '80 mm' }, { value: '58mm', label: '58 mm' }]} />
          </Field>
          <Field label="How it prints" hint={s.mode === 'escpos' ? 'Fast, and the drawer opens in the same job. Prints Latin script only: choose the driver for Sinhala, Tamil or other scripts.' : 'A page through the printer’s own driver: any script; the drawer is opened after it.'}>
            <Choice label="How it prints" value={s.mode} onChange={(mode) => void save({ mode })} options={[{ value: 'escpos', label: 'ESC/POS (raw)' }, { value: 'driver', label: 'Printer driver' }]} />
          </Field>
          <Field label="Copies of each receipt">
            <Choice label="Copies" value={String(s.copies) as '1' | '2' | '3'} onChange={(v) => void save({ copies: Number(v) })} options={[{ value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }]} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13.5px] font-semibold text-ink">Print the receipt as soon as a sale is complete</span>
            <Switch checked={s.auto_print} onChange={(auto_print) => void save({ auto_print })} label="Print after every sale" />
          </div>
          <Field label="At the top of every receipt" hint="The shop’s name, address, phone, tax number — a line each.">
            <textarea value={header ?? s.header} onChange={(e) => setHeader(e.target.value.slice(0, 400))} onBlur={() => header !== null && void save({ header })} rows={3} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary" />
          </Field>
          <Field label="At the bottom">
            <textarea value={footer ?? s.footer} onChange={(e) => setFooter(e.target.value.slice(0, 400))} onBlur={() => footer !== null && void save({ footer })} rows={2} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary" />
          </Field>
          <div>
            <Button icon="printer" loading={busy === 'test'} onClick={() => void run('test', printTest)}>
              Print a test receipt
            </Button>
          </div>
        </div>
      </Card>
      <Card title="Cash drawer">
        <div className="flex flex-col gap-4">
          <Choice label="The drawer" value={s.drawer} onChange={(drawer) => void save({ drawer })} options={[{ value: 'off', label: 'None, or opened by the printer’s driver' }, { value: 'printer', label: 'Plugged into the receipt printer' }]} />
          {s.drawer === 'printer' ? (
            <>
              <Field label="Drawer connector" hint="Most drawers use pin 2. Try pin 5 if it does not open.">
                <Choice label="Drawer connector" value={String(s.drawer_pin) as '2' | '5'} onChange={(v) => void save({ drawer_pin: v === '5' ? 5 : 2 })} options={[{ value: '2', label: 'Pin 2' }, { value: '5', label: 'Pin 5' }]} />
              </Field>
              <div>
                <Button icon="banknote" loading={busy === 'drawer'} disabled={!s.receipt_printer} onClick={() => void run('drawer', openDrawer)}>
                  {t('pos.openDrawer')}
                </Button>
                <p className="mt-1 text-[12px] text-ink-3">It opens by itself when cash is taken. The printer must take ESC/POS commands, as thermal receipt printers do.</p>
              </div>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
