import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx, Modal } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { fetchCommission, K, markCommission, money, saveCsv, today, toCsv } from './api';
import { Chips, errText, Head, input, label, Pill, Section, td, tdr, th, useDesk } from './parts';
import { esc, printPage, readDesk } from './print';

/**
 * D18 · Commission: what each stylist earned on appointments checked out in a period — the server's lines and sums.
 * Select lines to mark paid, void (with a reason, kept with the line) or back to accrued; print a stylist's statement;
 * export CSV. Marking needs the commission-manage permission, which the server checks per line.
 */
export default function Commission() {
  const desk = useDesk();
  const qc = useQueryClient();
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`);
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState<'accrued' | 'paid' | 'void' | 'all'>('accrued');
  const [provider, setProvider] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [voiding, setVoiding] = useState(false);
  const [why, setWhy] = useState('');
  const q = useQuery({ queryKey: K.commission({ from, to, status, provider }), queryFn: ({ signal }) => fetchCommission({ from, to, provider, status: status === 'all' ? null : status }, signal) });
  const rows = q.data?.rows ?? [];
  const picked = rows.filter((r) => sel.has(r.id));
  const sum = picked.reduce((s, r) => s + r.amount, 0);
  const cur = picked[0]?.currency ?? '';

  const mark = async (to2: 'paid' | 'void' | 'accrued', note?: string) => {
    try {
      const r = await markCommission(picked.map((p) => p.id), to2, note);
      toast('success', r.message || `${r.data.changed} changed.`);
      setSel(new Set());
      setVoiding(false);
      void qc.invalidateQueries({ queryKey: ['appointments', 'commission'] });
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const statement = async () => {
    const lines = picked.length ? picked : rows.filter((r) => !provider || r.provider_id === provider);
    const who = lines[0]?.provider ?? 'Commission';
    const html = `<style>body{font:11px system-ui}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}.r{text-align:right}</style><h2>${esc(who)} · commission</h2><p>${esc(from)} – ${esc(to)}</p><table><tr><th>Date</th><th>Appointment</th><th>Line</th><th class="r">Base</th><th class="r">Commission</th><th>Status</th></tr>${lines.map((l) => `<tr><td>${esc(l.date)}</td><td>${esc(l.number)}</td><td>${esc(l.description)}</td><td class="r">${esc(money(l.base))}</td><td class="r">${esc(money(l.amount, l.currency))}</td><td>${esc(l.status)}</td></tr>`).join('')}</table>`;
    try {
      await printPage(html, `Commission · ${who}`, readDesk().a4Printer);
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const exportCsv = async () => {
    const where = await saveCsv(`commission-${from}-${to}.csv`, toCsv(['Earned', 'Appointment', 'Stylist', 'Client', 'Line', 'Base', 'Rate', 'Commission', 'Currency', 'Status', 'Note'], rows.map((r) => [r.date, r.number, r.provider, r.customer, r.description, r.base, r.rate_type === 'percent' ? `${r.rate}%` : r.rate, r.amount, r.currency, r.status, r.note])));
    if (where) toast('success', `Saved to ${where}`);
  };

  return (
    <div>
      <Head title="Commission" sub="Earned when an appointment is checked out.">
        <input type="date" aria-label="From" className={cx(input, 'w-[140px]')} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" aria-label="To" className={cx(input, 'w-[140px]')} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <Button variant="secondary" icon="download" disabled={!rows.length} onClick={() => void exportCsv()}>Export CSV</Button>
      </Head>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chips label="Status" value={status} onChange={(s) => (setStatus(s), setSel(new Set()))} options={[{ id: 'accrued', label: 'Accrued' }, { id: 'paid', label: 'Paid' }, { id: 'void', label: 'Void' }, { id: 'all', label: 'All' }]} />
      </div>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {(q.data?.providers ?? []).map((p) => (
          <button key={`${p.provider_id}-${p.currency}`} type="button" aria-pressed={provider === p.provider_id} onClick={() => setProvider(provider === p.provider_id ? null : p.provider_id)} className={cx('rounded-[12px] border px-3 py-2.5 text-left', provider === p.provider_id ? 'border-primary bg-[#EEF1FD] dark:bg-selection' : 'border-line bg-surface hover:bg-subtle')}>
            <div className="text-[13px] font-bold text-ink">{p.provider}</div>
            <div className="text-[16px] font-extrabold text-ink tabular-nums">{money(p.accrued, p.currency)}</div>
            <div className="text-[11.5px] text-ink-3">{`${p.lines} lines · paid ${money(p.paid)}`}</div>
          </button>
        ))}
      </div>
      {picked.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-primary bg-[#EEF1FD] px-4 py-2 text-[13px] dark:bg-selection">
          <b className="flex-1">{`${picked.length} line${picked.length === 1 ? '' : 's'} selected · ${money(sum, cur)}`}</b>
          <Button size="sm" variant="primary" disabled={!desk.online || picked.some((p) => !p.can_manage)} onClick={() => void mark('paid')}>Mark paid</Button>
          <Button size="sm" variant="secondary" disabled={!desk.online || picked.some((p) => !p.can_manage)} onClick={() => setVoiding(true)}>Void…</Button>
          <Button size="sm" variant="secondary" icon="printer" onClick={() => void statement()}>Print statement</Button>
        </div>
      ) : null}
      <Section>
        <table className="w-full border-collapse text-[12.5px] text-ink">
          <thead>
            <tr>
              <th className={th}><Checkbox aria-label="Select all" checked={!!rows.length && sel.size === rows.filter((r) => !provider || r.provider_id === provider).length} onChange={(e) => setSel(e.target.checked ? new Set(rows.filter((r) => !provider || r.provider_id === provider).map((r) => r.id)) : new Set())} /></th>
              {['Earned', 'Appointment', 'Stylist', 'Line', 'Base', 'Rate', 'Commission', 'Status'].map((h) => <th key={h} className={cx(th, ['Base', 'Commission'].includes(h) && 'text-right')}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => !provider || r.provider_id === provider).map((r) => (
              <tr key={r.id}>
                <td className={td}><Checkbox aria-label={`Select ${r.number}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                <td className={td}>{r.date}</td>
                <td className={td}><button type="button" className="font-mono text-[11.5px] hover:underline" onClick={() => desk.open(r.appointment_id)}>{r.number}</button></td>
                <td className={td}>{r.provider}</td>
                <td className={td}>{r.description}</td>
                <td className={tdr}>{money(r.base)}</td>
                <td className={td}>{r.rate_type === 'percent' ? `${r.rate}%` : money(r.rate)}</td>
                <td className={tdr}>{money(r.amount, r.currency)}</td>
                <td className={td}><Pill tone={r.status === 'paid' ? 'ok' : r.status === 'void' ? 'muted' : 'warn'}>{r.status}</Pill></td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-3">{q.isPending ? 'Reading…' : q.isError ? errText(q.error) : 'Nothing in this period.'}</td></tr> : null}
          </tbody>
        </table>
        {q.data?.truncated ? <p className="m-0 px-3.5 py-2 text-[12px] text-ink-3">More lines than shown — narrow the period.</p> : null}
      </Section>
      {voiding ? (
        <Modal title="Void commission" onClose={() => setVoiding(false)} width={440} footer={<><Button variant="secondary" onClick={() => setVoiding(false)}>Keep</Button><Button variant="danger" disabled={!why.trim()} onClick={() => void mark('void', why.trim())}>Void</Button></>}>
          <label><span className={label}>Why is it void? (kept with the line)</span><input autoFocus className={input} value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} /></label>
        </Modal>
      ) : null}
    </div>
  );
}
