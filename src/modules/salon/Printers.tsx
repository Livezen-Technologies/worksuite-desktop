import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SalonPrintPatch, SalonPrintSettings } from '@shared/types';
import { Button, Card, Spinner, Switch } from '../../components/ui';
import { Select } from '../../components/Select';
import { toast } from '../../core/toasts';
import { listPrinters, MK, openDrawer, printTest, saveDeskSettings, setPrintSettings } from './money';
import { Choice, Failed, Note, useDesk, usePrintSettings } from './parts';

/**
 * This computer's printers for SalonMate (D14, PRN-01…07): the receipt
 * printer and its roll, an A4 printer for full-page copies, how many copies,
 * whether a receipt prints by itself after a payment and without the print
 * dialog, and the cash drawer plugged into the receipt printer.
 *
 * Kept on this computer — which printers are plugged in is a fact about it —
 * and told to WorkSuite too, so owners see how each desk prints.
 */
const NONE = '';

export default function Printers() {
  const desk = useDesk();
  const qc = useQueryClient();
  const settings = usePrintSettings();
  const printers = useQuery({ queryKey: ['salon', 'printers'], queryFn: listPrinters });
  const [busy, setBusy] = useState<string | null>(null);

  async function save(patch: SalonPrintPatch) {
    setBusy('save');
    try {
      const next = await setPrintSettings(patch);
      qc.setQueryData<SalonPrintSettings>(MK.print, next);
      /* Owners see it in the list of desks; the printing itself does not wait for WorkSuite. */
      void saveDeskSettings(desk.desk.id, next).catch(() => undefined);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That was not saved.');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    try {
      const o = await printTest();
      toast(o.ok ? 'success' : 'warning', o.ok ? `Test receipt ${o.silent ? 'sent to' : 'printed on'} ${o.printer ?? 'the printer chosen'}.` : o.message);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The test receipt could not be printed.');
    } finally {
      setBusy(null);
    }
  }

  async function drawer() {
    setBusy('drawer');
    try {
      const o = await openDrawer();
      toast(o.ok ? 'success' : 'warning', o.message);
    } finally {
      setBusy(null);
    }
  }

  if (settings.isError) return <div className="p-6"><Failed text="This computer’s printer settings could not be read." onRetry={() => void settings.refetch()} /></div>;
  if (!settings.data) return <Spinner label="Loading printers…" />;

  const s = settings.data;
  const names = (printers.data ?? []).map((p) => ({ value: p.name, label: p.displayName || p.name }));
  const options = [{ value: NONE, label: 'Ask each time' }, ...names];
  const gone = (name: string | null) => !!name && printers.isSuccess && !names.some((n) => n.value === name);

  return (
    <div className="flex max-w-[760px] flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">Printers</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">This computer’s receipt printer, A4 printer and cash drawer.</p>
      </div>

      {printers.isSuccess && names.length === 0 ? <Note tone="warning">This computer has no printer installed. Install the receipt printer’s driver, then come back here.</Note> : null}

      <Card title="Receipts">
        <div className="flex flex-col gap-4">
          <Field label="Receipt printer" hint={gone(s.receipt_printer) ? `“${s.receipt_printer}” is not on this computer any more.` : 'The thermal printer at the counter.'} warn={gone(s.receipt_printer)}>
            <Select label="Receipt printer" value={s.receipt_printer ?? NONE} options={options} loading={printers.isLoading} onValueChange={(v) => void save({ receipt_printer: v || null })} />
          </Field>
          <Field label="Roll width">
            <Choice
              label="Roll width"
              value={s.paper}
              onChange={(paper) => void save({ paper })}
              options={[
                { value: '80mm', label: '80 mm' },
                { value: '58mm', label: '58 mm' },
              ]}
            />
          </Field>
          <Field label="Copies of each receipt">
            <Choice
              label="Copies of each receipt"
              value={String(s.copies) as '1' | '2' | '3'}
              onChange={(v) => void save({ copies: Number(v) })}
              options={[
                { value: '1', label: 'One' },
                { value: '2', label: 'Two' },
                { value: '3', label: 'Three' },
              ]}
            />
          </Field>
          <Toggle label="Print the receipt as soon as a payment is taken" checked={s.auto_print} onChange={(auto_print) => void save({ auto_print })} />
          <Toggle
            label="Print without asking"
            hint={s.receipt_printer ? 'Straight to the receipt printer, without the print dialog.' : 'Choose the receipt printer first: without one, the print dialog asks where.'}
            checked={s.silent}
            onChange={(silent) => void save({ silent })}
          />
          <Field label="A4 printer" hint="For full-page copies. Without one, they go to the receipt printer.">
            <Select label="A4 printer" value={s.a4_printer ?? NONE} options={options} loading={printers.isLoading} onValueChange={(v) => void save({ a4_printer: v || null })} />
          </Field>
          <div>
            <Button icon="printer" loading={busy === 'test'} onClick={() => void test()}>
              Print a test receipt
            </Button>
            <p className="mt-1 text-[12px] text-ink-3">WorkSuite’s test receipt, in English, Sinhala and Tamil — check every script prints.</p>
          </div>
        </div>
      </Card>

      <Card title="Cash drawer">
        <div className="flex flex-col gap-4">
          <Field label="The drawer">
            <Choice
              label="The drawer"
              value={s.drawer}
              onChange={(drawer) => void save({ drawer })}
              options={[
                { value: 'off', label: 'None, or opened by the printer’s driver' },
                { value: 'printer', label: 'Plugged into the receipt printer' },
              ]}
            />
          </Field>
          {s.drawer === 'printer' ? (
            <>
              <Field label="Drawer connector" hint="Most drawers use pin 2. Try pin 5 if it does not open.">
                <Choice
                  label="Drawer connector"
                  value={String(s.drawer_pin) as '2' | '5'}
                  onChange={(v) => void save({ drawer_pin: v === '5' ? 5 : 2 })}
                  options={[
                    { value: '2', label: 'Pin 2' },
                    { value: '5', label: 'Pin 5' },
                  ]}
                />
              </Field>
              <div>
                <Button icon="banknote" loading={busy === 'drawer'} disabled={!s.receipt_printer} onClick={() => void drawer()}>
                  Open the drawer now
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

function Field({ label, hint, warn, children }: { label: string; hint?: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className={warn ? 'text-[12px] font-semibold text-warning' : 'text-[12px] text-ink-3'}>{hint}</span> : null}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint ? <div className="text-[12px] text-ink-3">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
