import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Modal, Spinner } from '../../components/ui';
import { createAndSend, fetchTemplatesFor, findRecords, hostSettings, hostStatus, K, newKey, recordId, reprint, sendJob, setHostSettings, STATION_SOURCES, type SourceRecord, type Template } from './api';
import type { ViewProps } from './LabelShell';
import { btn, btnPrimary, field, Section, StatePill } from './parts';

interface Printed {
  job: number;
  title: string;
  template: string;
  qty: number;
  state: string;
  at: string;
}

const SOURCE_KEY = 'label-station-source';
const readSource = () => {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? STATION_SOURCES[0]!.id;
  } catch {
    return STATION_SOURCES[0]!.id;
  }
};

/** A record's line for the operator: its name or number, whatever the source calls it. */
function titleOf(r: SourceRecord): string {
  const v = r.values;
  const pick = Object.entries(v).find(([k, x]) => /\.(name|title|order_number|number|job_number|tracking_number|asset_code|sku)$/.test(k) && x !== null && x !== '');
  return pick ? String(pick[1]) : r.ref;
}

/**
 * D03 — Print station (FR-DSK-04): built for a keyboard-wedge scanner. The field keeps the focus; a scan ends with
 * Enter and the server's data source for the chosen kind (products, assets, shipments …) finds the record by its
 * code, barcode or serial (`GET data-sources/{id}/records?q=`) with the person's own permissions; the published
 * templates for that kind are offered. Enter on the empty field prints the quantity on this station's printer,
 * silently. Recent prints can be reprinted with a reason (the server may ask for approval, FR-RPR).
 */
export default function Station({ active }: ViewProps) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: K.settings, queryFn: hostSettings });
  const host = useQuery({ queryKey: K.host, queryFn: hostStatus });
  const [source, setSourceState] = useState(readSource);
  const templates = useQuery({ queryKey: ['label', 'templates', 'context', source], queryFn: ({ signal }) => fetchTemplatesFor(source, signal), staleTime: 60_000 });
  const [code, setCode] = useState('');
  const [found, setFound] = useState<SourceRecord | null>(null);
  const [template, setTemplate] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Printed[]>([]);
  const [again, setAgain] = useState<Printed | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const focus = () => setTimeout(() => ref.current?.focus(), 0);
  useEffect(() => {
    if (active) focus();
  }, [active]);
  const setSource = (s: string) => {
    setSourceState(s);
    setFound(null);
    try {
      localStorage.setItem(SOURCE_KEY, s);
    } catch {
      /* remembered for this session only */
    }
  };

  const printers = (host.data?.printers ?? []).filter((p) => p.serverId && p.approved);
  const station = printers.find((p) => p.key === settings.data?.stationPrinter) ?? null;
  const list: Template[] = templates.data ?? [];
  const chosen = template ?? list[0]?.id ?? null;

  const lookup = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    try {
      const rows = await findRecords(source, c);
      const exact = rows.find((r) => Object.values(r.values).some((v) => String(v ?? '').toLowerCase() === c.toLowerCase())) ?? (rows.length === 1 ? rows[0]! : null);
      setFound(exact);
      setQty(1);
      setCode('');
      if (!exact) toast('error', rows.length ? `${rows.length} records match ${c}; scan a code that names one.` : `Nothing has the code ${c}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      focus();
    }
  };

  const print = async (confirmed = false) => {
    if (!found || !chosen || !station?.serverId) return;
    setBusy(true);
    setConfirm(null);
    try {
      const j = await createAndSend({ template_id: chosen, printer_id: Number(station.serverId), mode: qty > 1 ? 'copies' : 'single', copies: qty, records: [{ source, ref: recordId(found.ref) }], confirm: confirmed, source_module: 'label' }, newKey());
      setRecent((r) => [{ job: Number(j.id), title: titleOf(found), template: list.find((t) => t.id === chosen)?.name ?? '', qty, state: j.state, at: new Date().toLocaleTimeString() }, ...r].slice(0, 12));
      if (j.state === 'failed' || j.state === 'interrupted' || j.state === 'paused') toast('error', j.error ?? 'The labels did not all print. See Running batches.');
      setFound(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFIRM_REQUIRED') setConfirm(e.message);
      else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      focus();
    }
  };

  const reprintNow = async (p: Printed) => {
    setAgain(null);
    try {
      const j = await reprint(p.job, reason.trim(), newKey());
      setReason('');
      if (j.status === 'PENDING_APPROVAL') {
        toast('info', 'The reprint waits for approval.');
        return;
      }
      const done = await sendJob(j.id);
      toast(done.state === 'done' ? 'success' : 'info', done.state === 'done' ? 'Reprinted.' : (done.error ?? 'The reprint is in the printer’s queue.'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      focus();
    }
  };

  if (settings.isPending) return <Spinner />;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 flex-1 text-[18px] font-extrabold text-ink">Print station</h1>
        <select className={`${field} w-[160px]`} aria-label="What is scanned" value={source} onChange={(e) => setSource(e.target.value)}>
          {STATION_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select
          className={`${field} w-[240px]`}
          aria-label="Station printer"
          value={settings.data?.stationPrinter ?? ''}
          onChange={(e) => void setHostSettings({ stationPrinter: e.target.value || null }).then((s) => qc.setQueryData(K.settings, s), (err) => toast('error', errorMessage(err)))}
        >
          <option value="">Station printer…</option>
          {printers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
      </div>
      {!station ? <p className="m-0 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-yellow-ink">Choose a registered, approved printer on this computer for the station (Printers).</p> : null}
      <Section>
        <div className="flex flex-col gap-3 p-4">
          <input
            ref={ref}
            className={`${field} h-[48px] font-mono text-[18px]`}
            aria-label="Scan a barcode"
            placeholder="Scan a barcode"
            value={code}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (found && code.trim() === '') void print();
              else void lookup();
            }}
          />
          {found ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-ink">{titleOf(found)}</div>
                <div className="text-[12px] text-ink-3">{found.ref}</div>
              </div>
              <select className={`${field} w-[260px]`} aria-label="Template" value={chosen ?? ''} onChange={(e) => setTemplate(Number(e.target.value))}>
                {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input type="number" min={1} max={999} className={`${field} w-[90px]`} aria-label="Quantity" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))} />
              <button type="button" className={btnPrimary} disabled={busy || !station || !chosen} onClick={() => void print()}>Print ↵</button>
            </div>
          ) : null}
          {list.length === 0 && !templates.isPending ? <p className="m-0 text-[12px] text-ink-3">No published template is made for this kind of record yet.</p> : null}
          <p className="m-0 text-[11.5px] text-ink-3">Scan, check, then Enter on the empty field prints. The server applies your print policy (quantities, printers, templates).</p>
        </div>
      </Section>
      <Section title="Recent prints">
        {recent.length === 0 ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing printed from this station yet.</p> : (
          <ul className="m-0 list-none p-0">
            {recent.map((p) => (
              <li key={p.job} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                <span className="w-[70px] text-ink-3 tabular-nums">{p.at}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{`${p.title} · ${p.template} × ${p.qty}`}</span>
                <StatePill state={p.state} />
                <button type="button" className={btn} onClick={() => setAgain(p)}>Reprint</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {confirm ? (
        <Modal
          title="Print this many?"
          onClose={() => setConfirm(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={() => void print(true)}>Print</button>
            </div>
          }
        >
          <p className="m-0 text-[12.5px] text-ink">{confirm}</p>
        </Modal>
      ) : null}
      {again ? (
        <Modal
          title="Reprint"
          onClose={() => setAgain(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setAgain(null)}>Cancel</button>
              <button type="button" className={btnPrimary} disabled={reason.trim().length < 3} onClick={() => void reprintNow(again)}>Reprint</button>
            </div>
          }
        >
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
            {`Why reprint ${again.title}? Kept in the label history.`}
            <input className={field} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
