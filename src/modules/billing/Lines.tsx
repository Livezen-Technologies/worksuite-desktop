import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { amount, lineNet, searchItems, type InvoiceLine, type Item, type Tax } from './api';

/**
 * An invoice's lines (BillInvoiceEditor, BillNewInvoice): what is charged for,
 * how many, at what rate, less a discount, with the sales taxes that apply —
 * each tax a chip on the line, on or off. A product is found by name or code
 * and added as a line at its price. The amount shown is before tax; the
 * server works out the taxes, the document discount and withholding when the
 * invoice is saved. Read-only once the invoice is issued.
 */
export type EditLine = InvoiceLine & { key: string };

let seq = 0;
export const newKey = () => `l${++seq}`;
export const blankLine = (taxIds: number[] = []): EditLine => ({ key: newKey(), product_id: null, description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_rate_ids: taxIds });
export const toEdit = (lines: InvoiceLine[]): EditLine[] => lines.map((l) => ({ ...l, key: newKey(), tax_rate_ids: l.tax_rate_ids ?? [] }));
/** What the server is sent: only lines with words (a line without a description is dropped there anyway). */
export const toSend = (lines: EditLine[]): InvoiceLine[] =>
  lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      product_id: l.product_id,
      ...(l.account_id ? { account_id: l.account_id } : {}),
      description: l.description.trim(),
      quantity: Number(l.quantity) || 0,
      ...(l.unit ? { unit: l.unit } : {}),
      unit_price: Number(l.unit_price) || 0,
      discount_pct: Math.min(100, Math.max(0, Number(l.discount_pct) || 0)),
      tax_rate_ids: l.tax_rate_ids,
      ...(l.source_type && l.source_type !== 'manual' ? { source_type: l.source_type, source_id: l.source_id ?? null } : {}),
    }));

const cell = 'h-[30px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-primary disabled:border-line/50 disabled:bg-ground';

export function Lines({ lines, onChange, taxes, currency, readOnly, defaultTaxes }: {
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  taxes: Tax[];
  currency: string;
  readOnly?: boolean;
  /** The taxes a new line starts with (the installation's default rate). */
  defaultTaxes: number[];
}) {
  const set = (key: string, patch: Partial<EditLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (it: Item) =>
    onChange([
      ...lines.filter((l) => l.description.trim() || l.product_id),
      { key: newKey(), product_id: it.id, description: it.name, quantity: 1, unit: it.unit ?? null, unit_price: Number(it.unit_price ?? 0) || 0, discount_pct: 0, tax_rate_ids: defaultTaxes },
    ]);
  const subtotal = lines.reduce((s, l) => s + lineNet(l), 0);

  return (
    <div className="flex flex-col gap-1.5">
      {!readOnly ? <ProductSearch onPick={add} /> : null}
      <div className="flex gap-2 px-0.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        <span className="min-w-0 flex-1">Description</span>
        <span className="w-[64px] shrink-0">Qty</span>
        <span className="w-[110px] shrink-0">Rate</span>
        <span className="w-[62px] shrink-0">Disc %</span>
        {taxes.length ? <span className="w-[170px] shrink-0">Tax</span> : null}
        <span className="w-[120px] shrink-0 text-right">Amount</span>
        {!readOnly ? <span className="w-5 shrink-0" /> : null}
      </div>
      {lines.map((l, i) => (
        <div key={l.key} className="flex items-center gap-2" data-line={i}>
          <input aria-label={`Line ${i + 1} description`} disabled={readOnly} value={l.description} placeholder="What is being charged for" onChange={(e) => set(l.key, { description: e.target.value })} className={cell + ' min-w-0 flex-1'} />
          <input aria-label={`Line ${i + 1} quantity`} disabled={readOnly} type="number" min={0} step="any" value={l.quantity} onChange={(e) => set(l.key, { quantity: Number(e.target.value) })} className={cell + ' w-[64px] shrink-0 tabular-nums'} />
          <input aria-label={`Line ${i + 1} rate`} disabled={readOnly} type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => set(l.key, { unit_price: Number(e.target.value) })} className={cell + ' w-[110px] shrink-0 tabular-nums'} />
          <input aria-label={`Line ${i + 1} discount`} disabled={readOnly} type="number" min={0} max={100} step="0.01" value={l.discount_pct} onChange={(e) => set(l.key, { discount_pct: Number(e.target.value) })} className={cell + ' w-[62px] shrink-0 tabular-nums'} />
          {taxes.length ? <TaxPicker label={`Line ${i + 1} tax`} taxes={taxes} chosen={l.tax_rate_ids} readOnly={readOnly} onChange={(ids) => set(l.key, { tax_rate_ids: ids })} /> : null}
          <b className="w-[120px] shrink-0 text-right text-ink tabular-nums">{amount(lineNet(l))}</b>
          {!readOnly ? (
            <button type="button" aria-label={`Remove line ${i + 1}`} title="Remove line" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-bg">
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <button type="button" className="self-start text-[12.5px] font-bold text-primary hover:underline" onClick={() => onChange([...lines, blankLine(defaultTaxes)])}>
          + Add line
        </button>
      ) : null}
      <div className="self-end text-[12.5px] text-ink-2">
        Lines before tax <b className="ml-1 text-ink tabular-nums">{amount(subtotal, currency)}</b>
      </div>
    </div>
  );
}

/** A product by name or code, as the invoice's line items find them. Enter takes an exact code, else the only match. */
function ProductSearch({ onPick }: { onPick: (it: Item) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ask = useRef(0);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const find = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      const mine = ++ask.current;
      searchItems(v).then(
        (r) => {
          if (mine !== ask.current) return;
          setHits(r.slice(0, 12));
          setOpen(true);
        },
        () => setHits([]),
      );
    }, 200);
  };
  const pick = (it: Item) => {
    onPick(it);
    setQ('');
    setHits([]);
    setOpen(false);
  };
  return (
    <div className="relative">
      <input
        aria-label="Add a product"
        value={q}
        placeholder="Type a product's name or code to add it…"
        onChange={(e) => find(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter') {
            const exact = hits.find((h) => (h.code ?? '').toLowerCase() === q.trim().toLowerCase());
            const it = exact ?? (hits.length === 1 ? hits[0] : undefined);
            if (it) {
              e.preventDefault();
              pick(it);
            }
          }
        }}
        className="h-[34px] w-full rounded-[8px] border border-dashed border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary"
      />
      {open ? (
        <div role="listbox" aria-label="Products" className="absolute top-9 right-0 left-0 z-30 flex max-h-[280px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin">
          {hits.length ? (
            hits.map((h) => (
              <button key={h.id} type="button" role="option" aria-selected={false} onClick={() => pick(h)} className="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-subtle">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{h.name}</span>
                {h.code ? <span className="font-mono text-[11.5px] text-ink-3">{h.code}</span> : null}
                <span className="text-[12px] text-ink-2 tabular-nums">{amount(Number(h.unit_price ?? 0))}</span>
              </button>
            ))
          ) : (
            <span className="px-3 py-2 text-[12px] text-ink-3">No product matches. Type the line instead.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

const taxWord = (t: Tax) => `${t.code || t.name} ${Number(t.rate)}%`;

/**
 * A line's taxes: a button naming the ones on (or "No tax"), opening a short
 * checklist of the active sales taxes. A compound tax is charged on the line
 * plus the simple taxes, which the list says.
 */
function TaxPicker({ label, taxes, chosen, readOnly, onChange }: { label: string; taxes: Tax[]; chosen: number[]; readOnly?: boolean; onChange: (ids: number[]) => void }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!at) return;
    const away = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setAt(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [at]);
  const on = taxes.filter((t) => chosen.includes(t.id));
  const words = on.length ? on.map(taxWord).join(' + ') : 'No tax';
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={!!at}
        disabled={readOnly}
        title={words}
        onClick={() => {
          const r = button.current!.getBoundingClientRect();
          setAt(at ? null : { left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 4 });
        }}
        className={cx(cell, 'flex w-[170px] shrink-0 items-center gap-1 text-left', on.length ? 'font-semibold text-ink' : 'text-ink-3')}
      >
        <span className="min-w-0 flex-1 truncate">{words}</span>
        {!readOnly ? <Icon name="chevron-down" size={13} className="shrink-0 text-ink-3" /> : null}
      </button>
      {at
        ? createPortal(
            <div ref={list} role="listbox" aria-label={label} aria-multiselectable className="fixed z-[70] flex w-[250px] flex-col rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.22)]" style={at}>
              {taxes.map((t) => {
                const yes = chosen.includes(t.id);
                return (
                  <label key={t.id} role="option" aria-selected={yes} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] text-ink hover:bg-subtle">
                    <input type="checkbox" checked={yes} onChange={() => onChange(yes ? chosen.filter((x) => x !== t.id) : [...chosen, t.id])} className="accent-primary" />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="text-ink-3 tabular-nums">
                      {Number(t.rate)}%{t.is_compound ? ' · compound' : ''}
                    </span>
                  </label>
                );
              })}
              {chosen.length ? (
                <button type="button" onClick={() => onChange([])} className="mx-3 mt-1 mb-0.5 self-start text-[12px] font-semibold text-primary hover:underline">
                  No tax
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
