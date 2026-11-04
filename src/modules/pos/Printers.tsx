import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { DEFAULT_RECEIPT_DESIGN, type PosPrintPatch, type PosPrintSettings, type PosReceiptDesign } from '@shared/pos';
import { modelOfPrinterName, presetFor, printerModel, RECEIPT_PRINTER_MODELS } from '@shared/receipt-printers';
import { Select } from '../../components/Select';
import { Button, Card, Spinner, Switch } from '../../components/ui';
import { toast } from '../../core/toasts';
import { listPrinters, openDrawer, PK, printTest, receiptPreview, setPrintSettings, usePrintSettings } from './api';
import { useT } from './i18n';
import { logoFromFile } from './logo';
import { Choice, Failed, Field, Note } from './parts';

/**
 * This computer's receipt printer for POS, and how the receipt looks: the printer by model (Xprinter's range, each
 * set up with its roll, cutter and drawer port when chosen), the printer it prints to, ESC/POS straight to it or a
 * page through its driver, the cut and feed, copies, printing after every sale; the receipt's design (logo, the shop's
 * lines, what it shows, a QR code) with the receipt as it will print beside it; the cash drawer. Kept on this computer
 * — which printers are plugged in is a fact about it.
 */
const NONE = '';
const PREVIEW_KEY = ['pos', 'receiptPreview'] as const;

const MODEL_OPTIONS = [
  { value: NONE, label: 'Other, or set up by hand' },
  ...RECEIPT_PRINTER_MODELS.map((m) => ({
    value: m.id,
    label: `${m.brand} ${m.name}`,
    group: m.portable ? 'Xprinter · portable' : m.paper === '80mm' ? 'Xprinter · 80 mm' : 'Xprinter · 58 mm',
  })),
];

const textArea = 'rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary';

export default function Printers() {
  const t = useT();
  const qc = useQueryClient();
  const settings = usePrintSettings();
  const printers = useQuery({ queryKey: PK.printers, queryFn: listPrinters });
  const preview = useQuery({ queryKey: PREVIEW_KEY, queryFn: receiptPreview, enabled: settings.isSuccess });
  const [busy, setBusy] = useState<string | null>(null);
  const [header, setHeader] = useState<string | null>(null);
  const [footer, setFooter] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function save(patch: PosPrintPatch) {
    setBusy('save');
    try {
      qc.setQueryData<PosPrintSettings>(PK.print, await setPrintSettings(patch));
      void qc.invalidateQueries({ queryKey: PREVIEW_KEY });
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
  const design: PosReceiptDesign = { ...DEFAULT_RECEIPT_DESIGN, ...(s.design ?? {}) };
  const model = printerModel(s.printer_model);
  const names = (printers.data ?? []).map((p) => ({ value: p.name, label: p.displayName || p.name }));
  const gone = !!s.receipt_printer && printers.isSuccess && !names.some((n) => n.value === s.receipt_printer);
  const setDesign = (patch: Partial<PosReceiptDesign>) => void save({ design: { ...design, ...patch } });

  /** A model chosen: its settings, all at once. */
  function chooseModel(id: string) {
    const m = printerModel(id);
    if (!m) return void save({ printer_model: null });
    void save(presetFor(m, s) as PosPrintPatch);
    toast('success', `Set up for the ${m.brand} ${m.name}: ${m.paper === '80mm' ? '80' : '58'} mm roll, ESC/POS${m.cutter ? ', auto-cutter' : ''}${m.drawer ? '' : ', no drawer port'}.`);
  }

  /** A printer chosen: when its name says which Xprinter it is, and no model is set yet, set that one up too. */
  function choosePrinter(name: string) {
    const m = name && !model ? modelOfPrinterName(name) : null;
    void save({ receipt_printer: name || null, ...(m ? (presetFor(m, s) as PosPrintPatch) : {}) });
    if (m) toast('success', `This looks like an ${m.brand} ${m.name}: set up for it. Change the model if it is not.`);
  }

  async function chooseLogo(f: File | undefined) {
    if (!f) return;
    setBusy('logo');
    try {
      // half the roll's width: a logo that size reads well and keeps the receipt short
      setDesign({ logo: await logoFromFile(f, s.paper === '58mm' ? 256 : 384) });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'This picture could not be used.');
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  }

  const previewWidth = (preview.data?.paper ?? s.paper) === '58mm' ? 219 : 302;

  return (
    <div className="flex max-w-[1180px] flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">{t('pos.printers')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">The till’s receipt printer, the receipt’s design and the cash drawer, on this computer.</p>
      </div>
      {printers.isSuccess && names.length === 0 ? <Note tone="warning">This computer has no printer installed. Install the receipt printer’s driver, then come back here.</Note> : null}

      <Card title="Printer">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Printer model" hint={model ? `${model.paper === '80mm' ? '80' : '58'} mm roll · ${model.cutter ? 'auto-cutter' : 'tear off'} · ${model.drawer ? 'drawer port' : 'no drawer port'} · ${model.interfaces.join(', ')}` : 'Choose your Xprinter and the settings below are made for it.'}>
            <Select label="Printer model" value={s.printer_model ?? NONE} options={MODEL_OPTIONS} searchable onValueChange={chooseModel} />
          </Field>
          <Field label="Receipt printer" hint={gone ? `“${s.receipt_printer}” is not on this computer any more.` : 'The printer on this computer receipts go to, without the print dialog.'}>
            <Select label="Receipt printer" value={s.receipt_printer ?? NONE} options={[{ value: NONE, label: 'None chosen' }, ...names]} loading={printers.isLoading} onValueChange={choosePrinter} />
          </Field>
          <Field label="Roll width">
            <Choice label="Roll width" value={s.paper} onChange={(paper) => void save({ paper })} options={[{ value: '80mm', label: '80 mm' }, { value: '58mm', label: '58 mm' }]} />
          </Field>
          <Field label="How it prints" hint={s.mode === 'escpos' ? 'Fast, and the drawer opens in the same job. Latin script only: choose the driver for Sinhala, Tamil or other scripts.' : 'A page through the printer’s own driver: any script; the drawer is opened after it.'}>
            <Choice label="How it prints" value={s.mode} onChange={(mode) => void save({ mode })} options={[{ value: 'escpos', label: 'ESC/POS (raw)' }, { value: 'driver', label: 'Printer driver' }]} />
          </Field>
          <Field label="Cut the paper" hint={model && !model.cutter ? 'This model has no auto-cutter: tear the receipt off.' : s.mode === 'driver' ? 'Through the driver, its own settings decide the cut.' : undefined}>
            <Choice label="Cut the paper" value={s.cut ?? 'partial'} onChange={(cut) => void save({ cut })} options={[{ value: 'partial', label: 'Partial cut' }, { value: 'full', label: 'Full cut' }, { value: 'none', label: 'No cut' }]} />
          </Field>
          <Field label="Paper fed before the cut" hint="More if the last line stays inside the printer.">
            <Choice label="Feed" value={String(s.feed ?? 4) as '2'} onChange={(v) => void save({ feed: Number(v) })} options={['2', '3', '4', '5', '6'].map((v) => ({ value: v as '2', label: `${v} lines` }))} />
          </Field>
          <Field label="Copies of each receipt">
            <Choice label="Copies" value={String(s.copies) as '1' | '2' | '3'} onChange={(v) => void save({ copies: Number(v) })} options={[{ value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }]} />
          </Field>
          <div className="flex items-center justify-between gap-3 self-end">
            <span className="text-[13.5px] font-semibold text-ink">Print the receipt as soon as a sale is complete</span>
            <Switch checked={s.auto_print} onChange={(auto_print) => void save({ auto_print })} label="Print after every sale" />
          </div>
        </div>
        <div className="mt-4">
          <Button icon="printer" loading={busy === 'test'} onClick={() => void run('test', printTest)}>
            Print a test receipt
          </Button>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Receipt design">
          <div className="flex flex-col gap-4">
            {preview.data?.template ? <Note tone="indigo">Your company has published a receipt template for this till in WorkSuite: receipts print by it, as the preview shows. The design here applies when there is none.</Note> : null}
            <Field label="Logo" hint="A black-and-white version prints at the top. Simple, high-contrast logos print best.">
              <div className="flex flex-wrap items-center gap-2">
                {design.logo ? <img src={design.logo.png} alt="Receipt logo" className="h-12 rounded border border-line bg-white p-1" /> : null}
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" className="hidden" onChange={(e) => void chooseLogo(e.target.files?.[0])} />
                <Button icon="image" loading={busy === 'logo'} onClick={() => file.current?.click()}>{design.logo ? 'Change logo' : 'Add a logo'}</Button>
                {design.logo ? <Button variant="ghost" onClick={() => setDesign({ logo: null })}>Remove</Button> : null}
              </div>
            </Field>
            <Field label="At the top of every receipt" hint="The shop’s name, address, phone, tax number — a line each.">
              <textarea value={header ?? s.header} onChange={(e) => setHeader(e.target.value.slice(0, 400))} onBlur={() => header !== null && void save({ header })} rows={3} className={textArea} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="The shop’s name (first line)">
                <Choice label="Title size" value={design.title_size} onChange={(title_size) => setDesign({ title_size })} options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }]} />
              </Field>
              <Field label="Top and bottom lines">
                <Choice label="Alignment" value={design.align} onChange={(align) => setDesign({ align })} options={[{ value: 'center', label: 'Centred' }, { value: 'left', label: 'Left' }]} />
              </Field>
            </div>
            <Field label="Show on the receipt">
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['show_order', 'Order number'],
                    ['show_till', 'Till name'],
                    ['show_cashier', 'Cashier'],
                    ['show_customer', 'Customer'],
                    ['show_tax', 'Tax by rate'],
                    ['show_barcode', 'Receipt barcode (for returns)'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2 text-[13px] text-ink">
                    {label}
                    <Switch checked={design[key]} onChange={(v) => setDesign({ [key]: v })} label={label} />
                  </label>
                ))}
              </div>
            </Field>
            <Field label="At the bottom">
              <textarea value={footer ?? s.footer} onChange={(e) => setFooter(e.target.value.slice(0, 400))} onBlur={() => footer !== null && void save({ footer })} rows={2} className={textArea} />
            </Field>
            <Field label="QR code at the bottom" hint="A web address, a review link or a payment code. Empty for none.">
              <input value={qr ?? design.qr} onChange={(e) => setQr(e.target.value.slice(0, 300))} onBlur={() => qr !== null && setDesign({ qr: qr.trim() })} placeholder="https://" className={`${textArea} h-9`} />
            </Field>
          </div>
        </Card>

        <div className="lg:sticky lg:top-4">
          <Card title="Preview">
            <div className="flex flex-col items-center gap-2 rounded-[10px] bg-subtle py-4">
              {preview.data ? (
                <iframe title="Receipt preview" sandbox="" srcDoc={preview.data.html} style={{ width: previewWidth, height: 560 }} className="rounded-[4px] bg-white shadow-[0_2px_10px_rgba(0,0,0,.12)]" />
              ) : preview.isError ? (
                <p className="px-4 text-center text-[12.5px] text-ink-3">The preview could not be made.</p>
              ) : (
                <Spinner />
              )}
              <p className="px-4 text-center text-[11.5px] text-ink-3">
                A sample sale, as the receipt prints{s.mode === 'escpos' ? ' (ESC/POS uses the printer’s own font)' : ''}.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Cash drawer">
        <div className="flex flex-col gap-4">
          {model && !model.drawer ? <Note tone="muted">The {model.brand} {model.name} has no drawer port.</Note> : null}
          <Choice
            label="The drawer"
            value={s.drawer}
            onChange={(drawer) => void save({ drawer })}
            options={[
              { value: 'off', label: 'None, or opened by the printer’s driver' },
              { value: 'printer', label: 'Plugged into the receipt printer', disabled: !!model && !model.drawer },
            ]}
          />
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
