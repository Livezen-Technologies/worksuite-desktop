import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type DragEvent } from 'react';
import { request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { typingTarget } from '../../core/scanner';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, fetchAsset, returnAsset, statusLabel, type AssetFull, type Can } from './api';
import { printLabels } from './labelSheets';
import { Badge, Btn, Card, Field, Kpi, Table, amt, input, td, tdr, useReadOnly } from './parts';
import type { AssetView } from './Rail';

/**
 * One asset (D05 overview, D06 custody & handover, D07 depreciation vs ledger) with its upkeep, documents and history.
 * Keys: E edit, R record the return, T transfer, ⌘P print its label. A file dropped on the page is attached to the
 * asset. The depreciation is the server's schedule, shown as it sent it.
 */
const TABS = [
  ['overview', 'Overview'], ['custody', 'Custody'], ['depreciation', 'Depreciation'], ['upkeep', 'Upkeep'], ['documents', 'Documents'], ['history', 'History'],
] as const;

export function handoverHtml(d: AssetFull): string {
  const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const h = d.holder;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:11pt;margin:18mm}h1{font-size:16pt}td{padding:2mm 4mm 2mm 0;vertical-align:top}.s{margin-top:24mm;display:flex;gap:30mm}.s div{border-top:1px solid #000;width:60mm;padding-top:2mm}</style></head><body><h1>Handover note</h1><table><tr><td>Asset</td><td><b>${esc(d.asset.asset_code)}</b> ${esc(d.asset.name)}</td></tr><tr><td>Serial</td><td>${esc(d.asset.serial_number)}</td></tr><tr><td>Company</td><td>${esc(d.asset.company)}</td></tr><tr><td>Issued to</td><td>${esc(h?.name)}</td></tr><tr><td>Issued on</td><td>${esc(shortDate(h?.assigned_at))}</td></tr><tr><td>Due back</td><td>${esc(h?.expected_return_at ? shortDate(h.expected_return_at) : 'On exit')}</td></tr><tr><td>Condition</td><td>${esc(d.assignments[0]?.condition_out)}</td></tr><tr><td>Notes</td><td>${esc(d.assignments[0]?.notes)}</td></tr></table><div class="s"><div>Received by</div><div>Issued by</div></div></body></html>`;
}

export default function AssetPage({ id, can, active, tab, onTab, onEdit, onGo }: { id: number; can: Can; active: boolean; tab: string; onTab: (t: string) => void; onEdit: () => void; onGo: (v: AssetView, extra?: string) => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'one', id], queryFn: ({ signal }) => fetchAsset(id, signal) });
  const [cond, setCond] = useState('good');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const d = q.data;
  const t = TABS.some(([k]) => k === tab) ? tab : 'overview';
  const manage = can.manage ?? d?.can_manage ?? false;

  useEffect(() => {
    if (!active || !d) return;
    const onKey = (e: KeyboardEvent) => {
      if (typingTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void printLabels([{ code: d.asset.asset_code, name: d.asset.name, company: d.asset.company }]);
      } else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (e.key === 'e' && manage && !ro) onEdit();
      else if (e.key === 'r' && d.holder && !ro) onTab('custody');
      else if (e.key === 't' && !ro) onGo('transfers', `&asset=${id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (q.isPending) return <Spinner />;
  if (q.error || !d) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const a = d.asset;
  const dep = d.depreciation;
  const refresh = () => qc.invalidateQueries({ queryKey: ['assets'] });

  const doReturn = async () => {
    setBusy(true);
    try {
      await returnAsset(id, cond, notes.trim());
      toast('success', `${a.asset_code} returned.`);
      setNotes('');
      void refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (files: File[]) => {
    for (const f of files) {
      const form = new FormData();
      form.set('file', f, f.name);
      form.set('kind', /\.pdf$/i.test(f.name) ? 'invoice' : f.type.startsWith('image/') ? 'photo' : 'other');
      try {
        await request('POST', `${BASE}/${id}/documents`, { body: form });
        toast('success', `${f.name} attached.`);
      } catch (e) {
        toast('error', `${f.name}: ${refusal(e)}`);
      }
    }
    void refresh();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!ro && manage && e.dataTransfer.files.length) void attach([...e.dataTransfer.files]);
  };

  return (
    <div className={cx('flex flex-wrap gap-4', over && 'outline-2 outline-dashed outline-primary')} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[20px] font-extrabold text-ink">{a.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="font-mono">{a.asset_code}</span>
              {a.serial_number ? <span>{`· ${a.serial_number}`}</span> : null}
              <Badge status={a.status} />
              <Badge status={a.condition} />
              {d.holder && d.holder.acknowledged_at === null ? <Badge status="waiting">Awaiting confirmation</Badge> : null}
            </div>
          </div>
          {manage ? <Btn disabled={ro} onClick={onEdit}>Edit · E</Btn> : null}
          {can.assign && d.holder ? <Btn disabled={ro} onClick={() => onTab('custody')}>Return · R</Btn> : null}
          <Btn disabled={ro} onClick={() => onGo('transfers', `&asset=${id}`)}>Transfer · T</Btn>
          <Btn onClick={() => void printLabels([{ code: a.asset_code, name: a.name, company: a.company }])}>Label · ⌘P</Btn>
          {a.rustdesk_uri ? <Btn primary onClick={() => void call('app:openExternal', { url: a.rustdesk_uri! }).catch((e) => toast('error', errorMessage(e)))}>Remote help</Btn> : null}
        </div>
        <div role="tablist" className="flex gap-1 border-b border-line">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={t === k} onClick={() => onTab(k)} className={cx('-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold', t === k ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
              {label}
              {k === 'upkeep' && d.maintenance.length ? ` ${d.maintenance.length}` : k === 'documents' && d.documents.length ? ` ${d.documents.length}` : ''}
            </button>
          ))}
        </div>

        {t === 'overview' ? (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
              <Kpi label="Cost" value={amt(dep.cost || a.purchase_price, a.currency)} sub={a.purchase_date ? shortDate(a.purchase_date) : undefined} />
              <Kpi label="Book value" value={amt(dep.net_book_value, a.currency)} />
              <Kpi label="Upkeep" value={amt(d.upkeep_total, a.currency)} />
              <Kpi label="Warranty" value={a.warranty_days_left == null ? '—' : a.warranty_days_left < 0 ? 'Ended' : `${a.warranty_days_left} days`} tone={(a.warranty_days_left ?? 99) <= 30 ? 'warn' : undefined} />
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
              <Card title="Holder & location">
                <Dl rows={[['Holder', d.holder ? `${d.holder.name ?? '—'}${d.holder.acknowledged_at ? ' · confirmed' : ''}` : '—'], ['Since', d.holder ? `${shortDate(d.holder.assigned_at)}${d.holder.expected_return_at ? ` · due ${shortDate(d.holder.expected_return_at)}` : ' · due on exit'}` : '—'], ['Site', a.location ?? '—'], ['Company', a.company ?? 'No company']]} />
              </Card>
              <Card title="Purchase & accounts">
                <Dl rows={[['Vendor', a.vendor ?? '—'], ['Invoice', a.invoice_no ?? '—'], ['PO', a.po_number ?? '—'], ['Method', `${statusLabel(a.depreciation_method)} · ${a.life_months} months`]]} />
              </Card>
              <Card title="Details">
                <Dl rows={[['Category', a.category ?? '—'], ['Brand / model', [a.brand, a.model].filter(Boolean).join(' · ') || '—'], ['Barcode', a.barcode ?? '—'], ['RustDesk', a.rustdesk_id ?? '—']]} />
              </Card>
              <Card title="Warranty">
                <Dl rows={[['Provider', a.warranty_provider ?? '—'], ['Number', a.warranty_number ?? '—'], ['Ends', a.warranty_end ? shortDate(a.warranty_end) : '—']]} />
              </Card>
            </div>
          </>
        ) : t === 'custody' ? (
          <>
            {d.holder ? (
              <Card title={`Held by ${d.holder.name ?? '—'}`} action={d.holder.acknowledged_at ? <Badge status="confirmed">Confirmed</Badge> : d.holder.acknowledged_at === null ? <Badge status="waiting">Waiting for confirmation</Badge> : null}>
                <Dl rows={[['Issued', shortDate(d.holder.assigned_at)], ['Due back', d.holder.expected_return_at ? shortDate(d.holder.expected_return_at) : 'On exit'], ['Condition', d.assignments[0]?.condition_out ?? '—'], ['Notes', d.assignments[0]?.notes ?? '—']]} />
                <div className="flex gap-2 px-3.5 pb-3.5">
                  <Btn onClick={() => void call('print:toPdf', { html: handoverHtml(d), title: `Handover ${a.asset_code}` }).catch((e) => toast('error', errorMessage(e)))}>Save PDF</Btn>
                  <Btn onClick={() => void call('print:print', { html: handoverHtml(d), title: `Handover ${a.asset_code}` }).catch((e) => toast('error', errorMessage(e)))}>Print handover</Btn>
                </div>
              </Card>
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">Nobody holds this asset.</p>
            )}
            <Card title="Custody history">
              <Table head={['Holder', 'Out', 'Back', 'Condition', 'Confirmed']}>
                {d.assignments.map((h) => (
                  <tr key={h.id}>
                    <td className={td}>{h.holder ?? statusLabel(h.holder_type)}</td>
                    <td className={td}>{shortDate(h.assigned_at)}</td>
                    <td className={td}>{h.returned_at ? shortDate(h.returned_at) : '—'}</td>
                    <td className={td}>{`${h.condition_out} → ${h.condition_in ?? '—'}`}</td>
                    <td className={td}>{h.acknowledged_at ? <Badge status="confirmed">{shortDate(h.acknowledged_at)}</Badge> : h.acknowledged_at === null && !h.returned_at ? <Badge status="waiting">Waiting</Badge> : '—'}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </>
        ) : t === 'depreciation' ? (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
              <Kpi label="Monthly" value={amt(dep.monthly)} />
              <Kpi label="Accumulated" value={amt(dep.accumulated)} />
              <Kpi label="Book value" value={amt(dep.net_book_value)} />
              <Kpi label="Life" value={`${dep.months_elapsed} of ${dep.life_months} months`} sub={dep.fully_depreciated ? 'Fully depreciated' : undefined} />
            </div>
            {dep.note ? <p className="m-0 text-[12px] text-ink-3">{dep.note}</p> : null}
            <Card title="Schedule">
              <Table head={['Month', ['Charge', 'r'], ['Accumulated', 'r'], ['Book value', 'r'], 'In the accounts']}>
                {d.schedule.map((s) => (
                  <tr key={s.month}>
                    <td className={td}>{s.month}</td>
                    <td className={tdr}>{amt(s.charge)}</td>
                    <td className={tdr}>{amt(s.accumulated)}</td>
                    <td className={tdr}>{amt(s.nbv)}</td>
                    <td className={td}>{s.posted ? `Posted ${s.posted}` : s.status ? statusLabel(s.status) : <span className="text-ink-3">—</span>}</td>
                  </tr>
                ))}
              </Table>
            </Card>
            <p className="m-0 text-[11.5px] text-ink-3">Posted months never change. Editing the life or cost changes future months only.</p>
          </>
        ) : t === 'upkeep' ? (
          <Card title={`Upkeep · ${amt(d.upkeep_total, a.currency)}`}>
            <Table head={['Kind', 'Status', 'Scheduled', 'Done', 'Who', ['Cost', 'r']]}>
              {d.maintenance.map((m) => (
                <tr key={m.id}>
                  <td className={td}>{statusLabel(m.kind)}</td>
                  <td className={td}><Badge status={m.status} /></td>
                  <td className={td}>{shortDate(m.scheduled_for)}</td>
                  <td className={td}>{shortDate(m.completed_at)}</td>
                  <td className={td}>{m.vendor ?? m.technician ?? '—'}</td>
                  <td className={tdr}>{amt(m.cost, m.currency)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : t === 'documents' ? (
          <Card title="Documents">
            {d.documents.map((f) => (
              <div key={f.id} className="flex items-center gap-2 border-t border-line/70 px-3.5 py-2 text-[12.5px]">
                <Badge status="reserved">{statusLabel(f.kind)}</Badge>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-[11px] text-ink-3">{`${Math.max(1, Math.round(f.size / 1024))} KB · ${shortDate(f.created_at)}`}</span>
              </div>
            ))}
            <p className="m-0 px-3.5 py-3 text-[12px] text-ink-3">{manage ? 'Drag a file onto this window to attach it to the asset.' : 'Attached files.'}</p>
          </Card>
        ) : (
          <Card title="History">
            {d.activity.map((h, i) => (
              <div key={i} className="flex gap-2 border-t border-line/70 px-3.5 py-2 text-[12.5px]">
                <span className="w-[110px] shrink-0 text-ink-3">{shortDate(h.at)}</span>
                <b className="shrink-0">{statusLabel(h.action)}</b>
                <span className="min-w-0 flex-1 text-ink-2">{h.detail}</span>
                <span className="shrink-0 text-ink-3">{h.actor}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
      <aside aria-label={t === 'custody' && d.holder && can.assign ? 'Record return' : 'Notes'} className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5">
        {t === 'custody' && d.holder && can.assign ? (
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3.5">
            <h2 className="m-0 text-[13.5px] font-bold">Record return</h2>
            <Field label="Condition">
              <select className={input} value={cond} onChange={(e) => setCond(e.target.value)}>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
                <option value="damaged">Damaged — send to repair</option>
              </select>
            </Field>
            <Field label="Notes">
              <textarea className={cx(input, 'h-20 py-1.5')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What came back, what is missing" />
            </Field>
            <Btn primary disabled={ro || busy} onClick={() => void doReturn()}>Record return</Btn>
            <p className="m-0 text-[11px] text-ink-3">Tip: scan the asset at the scan station to return it in one step.</p>
          </div>
        ) : (
          <>
            <h2 className="m-0 text-[13.5px] font-bold">Notes</h2>
            <p className="m-0 text-[12.5px] whitespace-pre-wrap text-ink-2">{a.notes || '—'}</p>
          </>
        )}
      </aside>
    </div>
  );
}

function Dl({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 px-3.5 pb-3.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="m-0 min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
