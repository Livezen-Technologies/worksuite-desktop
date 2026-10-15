import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useRef, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, PageHead, Panel, Sheet } from '../hr/parts';
import Printers from './Printers';
import { lookupProducts } from './api';
import { allChecked, askRates, bookAndPrint, BOXES, deskReducer, EMPTY, isNoteCode, parseWeight, type DeskLine } from './desk';
import { OFFLINE_WRITE, useSalesOffline } from './offline';
import { moneyFull } from './parts';
import { printers, printLabel, printSettings } from './print';
import { bookShipment, createShipment, fetchDelivery, fetchRates, fetchShipmentsOn, findDelivery, KS, manifest, shipmentFor, updateShipment } from './ship';

/**
 * The Shipping desk (D-13, FR-DSK-08, FR-LBL-06): scan a delivery note, check the items by scanning them, weigh,
 * choose a courier from the rates, book — and the label prints by itself, silently, on this computer's label printer
 * (raw ZPL, or the PDF). Built for a barcode scanner and a scale that types its reading: one box takes every scan, and
 * Enter does the next thing. "Close the day" prints the day's manifest.
 */
export default function ShippingDesk({ org }: { org: string }) {
  const qc = useQueryClient();
  const [s, dispatch] = useReducer(deskReducer, EMPTY);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const offline = useSalesOffline();
  const today = todayInZone();
  const settings = useQuery({ queryKey: ['sales', 'print-settings'], queryFn: printSettings, staleTime: 60_000 });
  const installed = useQuery({ queryKey: ['sales', 'printers'], queryFn: printers, staleTime: 60_000 });
  const packed = useQuery({ queryKey: KS.today(today), queryFn: ({ signal }) => fetchShipmentsOn(today, org, signal), refetchInterval: 60_000 });
  const ps = settings.data;

  useEffect(() => {
    scanRef.current?.focus();
  }, [s.stage]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      dispatch({ type: 'message', ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  };

  /** One box for every scan: a delivery note, an item on it, or a scale's reading. */
  const scan = (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    if (isNoteCode(c) || s.stage === 'scan' || s.stage === 'booked') {
      void run(async () => {
        const hit = await findDelivery(c);
        if (!hit) return dispatch({ type: 'message', ok: false, text: `No delivery note ${c}.` });
        const [detail, existing] = await Promise.all([fetchDelivery(hit.id), shipmentFor(hit.dn_number).catch(() => null)]);
        dispatch({ type: 'note', note: { ...hit, ...detail.delivery }, lines: detail.lines, shipment: existing });
      });
      return;
    }
    if (s.stage === 'weigh' && parseWeight(c) !== null && !s.lines.some((l) => l.code?.toLowerCase() === c.toLowerCase())) {
      dispatch({ type: 'weight', text: c });
      return;
    }
    // An item: its own code, or a barcode Inventory knows as one of the note's products.
    if (s.lines.some((l) => l.code?.toLowerCase() === c.toLowerCase())) return dispatch({ type: 'item', code: c });
    void run(async () => {
      const found = await lookupProducts(c, null);
      const p = found.exact ? found.products[0] : null;
      dispatch({ type: 'item', code: c, matches: (l: DeskLine) => !!p && !!l.code && l.code === p.code });
    });
  };

  const rates = () => void run(() => askRates(s, { createShipment, updateShipment, rates: fetchRates }, dispatch));
  const book = () =>
    void run(async () => {
      const b = await bookAndPrint(s, { book: bookShipment, printLabel, autoPrint: ps?.auto_label !== false }, dispatch);
      if (b) void qc.invalidateQueries({ queryKey: KS.today(today) });
    });
  const closeDay = () =>
    void run(async () => {
      const ids = (packed.data ?? []).filter((x) => x.state !== 'cancelled' && x.state !== 'draft').map((x) => x.id);
      if (!ids.length) return dispatch({ type: 'message', ok: false, text: 'Nothing was booked today.' });
      const r = await manifest(ids);
      if (r.file_id) await call('transfers:download', { fileId: String(r.file_id), name: `manifest-${today}.pdf`, open: true });
      toast('success', `The manifest for ${ids.length} ${ids.length === 1 ? 'parcel' : 'parcels'} is ready${r.file_id ? ' — opening it to print' : ''}.`);
    });

  const ready = allChecked(s);
  const kg = parseWeight(s.weight);
  const has = (p: string | null | undefined) => !!p && (installed.data ?? []).some((x) => x.name === p);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Shipping desk" sub="Scan a delivery note, check the items, weigh, and the label prints by itself. Built for a barcode scanner and a thermal printer." />
      {offline ? <p className="m-0 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{OFFLINE_WRITE}</p> : null}
      <div className="grid grid-cols-3 gap-3.5">
        <div className="col-span-2 flex flex-col gap-3">
          <input
            ref={scanRef}
            value={code}
            disabled={busy || offline}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (code.trim()) {
                scan(code);
                setCode('');
              } else if (s.stage === 'weigh' && kg) rates();
              else if (s.stage === 'rates' && s.chosen) book();
            }}
            placeholder="Scan delivery note or item"
            aria-label="Scan delivery note or item"
            className="h-[46px] w-full rounded-[10px] border-2 border-dashed border-primary/60 bg-surface px-3.5 text-[15px] font-semibold text-ink outline-none focus:border-primary"
          />
          {s.message ? <p className={cx('m-0 text-[12.5px] font-semibold', s.message.ok ? 'text-success' : 'text-danger')} role="status">{s.message.text}</p> : null}
          {s.note ? (
            <Panel
              title={
                <span>
                  {s.note.dn_number}
                  {s.note.so_number ? ` · ${s.note.so_number}` : ''}
                </span>
              }
              sub={[s.note.client_name ?? s.note.client, s.note.ship_to].filter(Boolean).join(' · ') || undefined}
              action={
                <button type="button" className={btnSmall} onClick={() => dispatch({ type: 'reset' })}>
                  Next note
                </button>
              }
              bodyClassName="flex flex-col"
            >
              <div className="border-b border-line px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Check items</div>
              {s.lines.map((l) => (
                <div key={l.key} data-line={l.code ?? l.name} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
                  <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-white', l.got >= l.need ? 'bg-success' : 'bg-line')}>{l.got >= l.need ? <Icon name="check" size={12} /> : null}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">{l.name}</b>
                    <span className="text-[11.5px] text-ink-3">{l.service ? 'service' : l.code ?? '—'}</span>
                  </span>
                  <b className="tabular-nums text-ink">
                    {l.got} / {l.need}
                  </b>
                </div>
              ))}
            </Panel>
          ) : (
            <div className="rounded-[12px] border border-line bg-surface">
              <Empty text="Scan the barcode on a delivery note to start." />
            </div>
          )}
          {s.note && s.stage !== 'booked' ? (
            <div className="flex flex-wrap items-end gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3">
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
                Weight from scale
                <input value={s.weight} disabled={!ready} onChange={(e) => dispatch({ type: 'weight', text: e.target.value })} placeholder="0.80 kg" aria-label="Weight in kilograms" className="h-[34px] w-[120px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] tabular-nums outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
                Box
                <Select<string> aria-label="Box" value={s.box} onValueChange={(b) => dispatch({ type: 'box', box: b })} options={BOXES.map((b) => ({ value: b, label: b }))} className="h-[34px] w-[170px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
              </label>
              <span className="flex-1" />
              <button type="button" className={btn} disabled={busy || offline || !ready || !kg} onClick={rates} title={!ready ? 'Check every item first' : !kg ? 'Weigh the parcel' : undefined}>
                {s.rates.length ? 'Change courier' : 'Get rates'}
              </button>
              <button type="button" className={btnPrimary} disabled={busy || offline || !ready || !s.chosen} onClick={book}>
                {s.chosen ? `Book ${s.chosen.courier} & print ⏎` : 'Book & print'}
              </button>
            </div>
          ) : null}
          {s.rates.length && s.stage !== 'booked' ? (
            <Panel title="Couriers" sub="The cheapest that answered is chosen; pick another if you like." bodyClassName="flex flex-col">
              {s.rates.map((r) => (
                <button
                  key={`${r.account_id}-${r.service_code}`}
                  type="button"
                  disabled={!!r.error}
                  aria-pressed={s.chosen === r}
                  onClick={() => dispatch({ type: 'choose', rate: r })}
                  className={cx('flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0', s.chosen === r ? 'bg-selection' : 'hover:bg-subtle', r.error && 'opacity-60')}
                >
                  <b className="w-[140px] truncate text-ink">{r.courier}</b>
                  <span className="flex-1 truncate text-ink-2">{r.error ? r.error : `${r.service}${r.transit_days != null ? ` · ${r.transit_days} ${r.transit_days === 1 ? 'day' : 'days'}` : ''}`}</span>
                  {r.error ? null : <b className="tabular-nums text-ink">{moneyFull(r.price, r.currency)}</b>}
                </button>
              ))}
            </Panel>
          ) : null}
          {s.stage === 'booked' && s.shipment ? (
            <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-[12.5px]">
              <Icon name="check-circle" size={18} className="text-success" />
              <span className="flex-1 text-ink">
                <b>{s.shipment.number}</b> · {s.shipment.courier?.name ?? ''} {s.shipment.tracking_no ?? ''}
                {s.printed ? <span className={cx('block text-[11.5px]', s.printed.ok ? 'text-ink-3' : 'text-danger')}>{s.printed.message}</span> : null}
              </span>
              <button type="button" className={btnSmall} disabled={busy || offline} onClick={() => void run(() => printLabel(s.shipment!.id, { reason: 'reprint' }))}>
                <Icon name="printer" size={13} /> Reprint label
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <Panel
            title="Printers on this computer"
            action={
              <button type="button" className={btnSmall} onClick={() => setChoosing(true)}>
                Choose…
              </button>
            }
            bodyClassName="flex flex-col gap-2 px-3.5 py-3 text-[12.5px]">
            {installed.error ? <ErrorNote error={installed.error} /> : null}
            <PrinterLine label={`Labels · ${ps?.label_format === 'pdf' ? 'PDF' : 'ZPL'}`} name={ps?.label_printer ?? null} ok={has(ps?.label_printer)} />
            <PrinterLine label="Delivery notes · A4" name={ps?.note_printer ?? null} ok={!ps?.note_printer || has(ps?.note_printer)} fallback="the system's default" />
            <p className="m-0 text-[11.5px] text-ink-3">{ps?.silent ? 'Prints silently through WorkSuite Desktop — no dialog.' : 'Asks with the system’s print dialog each time.'} </p>
          </Panel>
          <Panel title={`Packed today · ${(packed.data ?? []).length}`} bodyClassName="flex max-h-[360px] flex-col overflow-y-auto scroll-thin">
            {(packed.data ?? []).map((x) => (
              <div key={x.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-1.5 text-[12px] last:border-b-0">
                <b className="flex-1 truncate text-ink">{x.tracking_no ?? x.number}</b>
                <span className="text-ink-3">{x.state === 'label_printed' ? 'Label printed' : x.state.replace(/_/g, ' ')}</span>
                {x.can?.label !== false && x.state !== 'cancelled' ? (
                  <button type="button" className="text-[11.5px] font-bold text-primary hover:underline" disabled={offline} onClick={() => void printLabel(x.id, { reason: 'reprint' })}>
                    reprint
                  </button>
                ) : null}
              </div>
            ))}
            {!packed.isLoading && !(packed.data ?? []).length ? <Empty text="Nothing packed yet today." /> : null}
          </Panel>
          <button type="button" className={btn + ' justify-center'} disabled={busy || offline} onClick={closeDay}>
            <Icon name="printer" size={14} /> Close the day · print manifests
          </button>
        </div>
      </div>
      {choosing ? (
        <Sheet
          title="Printers"
          width={640}
          onClose={() => (setChoosing(false), void settings.refetch())}
          footer={
            <button type="button" className={btn} onClick={() => (setChoosing(false), void settings.refetch())}>
              Done
            </button>
          }
        >
          <Printers />
        </Sheet>
      ) : null}
    </div>
  );
}

function PrinterLine({ label, name, ok, fallback = 'none chosen' }: { label: string; name: string | null; ok: boolean; fallback?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon name="printer" size={14} className="text-ink-3" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{name ?? fallback}</b>
        <span className="text-[11.5px] text-ink-3">{label}</span>
      </span>
      <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', ok ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>{ok ? 'Ready' : name ? 'Not found' : 'Choose'}</span>
    </div>
  );
}
