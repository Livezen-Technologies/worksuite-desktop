import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { toast } from '../../core/toasts';
import { Spinner } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, fetchLookups, orNull, type Can, type Plan } from './api';
import { Badge, Btn, Card, Field, NotYet, PageHead, Table, input, td, useReadOnly } from './parts';

/**
 * Preventive plans (D15, T-06): each plan, what it applies to, how often, when it is next due and last done, and a
 * new plan for a category every so many months or kilometres. The next job is the server's to raise. Needs Assets 1.1
 * (`GET/POST plans`).
 */
export default function Plans({ can }: { org: number; can: Can; active: boolean }) {
  const ro = useReadOnly() || !(can.maintain || can.manage);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'plans'], queryFn: ({ signal }) => orNull(apiGet<{ plans: Plan[] }>(`${BASE}/plans`, undefined, signal)) });
  const cats = useQuery({ queryKey: ['assets', 'lookups', 'categories'], queryFn: ({ signal }) => fetchLookups('categories', signal), staleTime: 300_000 });
  const [name, setName] = useState('');
  const [cat, setCat] = useState(0);
  const [months, setMonths] = useState('6');
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  if (q.isPending) return <Spinner />;
  if (q.data === null) return (<div className="flex flex-col gap-3"><PageHead title="Preventive plans" /><Card><NotYet what="Preventive maintenance plans" /></Card></div>);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiPost(`${BASE}/plans`, { name: name.trim(), category_id: cat, kind: 'preventive', ...(Number(km) > 0 ? { interval_unit: 'km', interval_value: Number(km) } : { interval_unit: 'months', interval_value: Number(months) || 6 }) });
      toast('success', 'Plan saved.');
      setName('');
      void qc.invalidateQueries({ queryKey: ['assets', 'plans'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
        <PageHead title="Preventive plans" />
        <Card>
          <Table head={['Plan', 'Applies to', 'Every', 'Next due', 'Last done', 'On']}>
            {(q.data?.plans ?? []).map((p) => (
              <tr key={p.id}>
                <td className={td}><b>{p.name}</b></td>
                <td className={td}>{p.asset_code ?? p.category ?? '—'}</td>
                <td className={td}>{`${p.interval_value} ${p.interval_unit}`}</td>
                <td className={td}>{p.next_due_on ? (p.next_due_on.slice(0, 10) < today ? <Badge status="overdue">{`Late · ${shortDate(p.next_due_on)}`}</Badge> : shortDate(p.next_due_on)) : p.next_due_meter ? `at ${p.next_due_meter} ${p.interval_unit}` : '—'}</td>
                <td className={td}>{shortDate(p.last_done_on) || '—'}</td>
                <td className={td}>{p.status === 'archived' ? <Badge status="cancelled">Paused</Badge> : <Badge status="active">On</Badge>}</td>
              </tr>
            ))}
          </Table>
          {!q.data?.plans.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">No plans yet.</p> : null}
        </Card>
      </div>
      <aside aria-label="New plan" className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">New plan</h2>
        <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Applies to">
          <select className={input} value={cat} onChange={(e) => setCat(Number(e.target.value))}>
            <option value={0}>Choose a category…</option>
            {(cats.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <Field label="Every months" className="flex-1"><input className={input} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
          <Field label="or km" className="flex-1"><input className={input} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
        </div>
        <Btn primary disabled={ro || busy || !name.trim() || !cat} onClick={() => void save()}>Save plan</Btn>
      </aside>
    </div>
  );
}
