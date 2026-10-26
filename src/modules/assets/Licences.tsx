import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, assignSeat, fetchPeople, fetchSubscriptions, linkSubscription, releaseSeat, revealKey, type Can, type License } from './api';
import { Badge, Btn, Card, Field, PageHead, Table, amt, input, td, tdr, useReadOnly } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Software licences (D16): seats used of bought, renewal and cost per year, the selected licence's seats with Assign
 * and Release, and its key — shown only on Reveal, which the server logs. Seat counts are the server's.
 */
interface Seat {
  id: number;
  holder: string;
  employee_id: number | null;
  assigned_at: string;
  released_at: string | null;
  note: string | null;
}

export default function Licences({ org, can }: { org: number; can: Can; active: boolean }) {
  const ro = useReadOnly() || !can.manage;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'licences'], queryFn: ({ signal }) => apiGet<{ licenses: License[] }>(`${BASE}/licenses`, undefined, signal) });
  const [sel, setSel] = useState<number | null>(null);
  const list = q.data?.licenses ?? [];
  const cur = list.find((l) => l.id === sel) ?? list[0] ?? null;
  const seats = useQuery({ queryKey: ['assets', 'seats', cur?.id], queryFn: ({ signal }) => apiGet<{ seats: Seat[] }>(`${BASE}/licenses/${cur!.id}/seats`, undefined, signal), enabled: !!cur });
  const people = useQuery({ queryKey: ['assets', 'people', org], queryFn: ({ signal }) => fetchPeople(org || null, signal), staleTime: 300_000, enabled: !!cur && !ro });
  const [key, setKey] = useState<{ id: number; key: string } | null>(null);
  const [who, setWho] = useState(0);
  const subs = useQuery({ queryKey: ['assets', 'expense-subscriptions'], queryFn: ({ signal }) => fetchSubscriptions(signal), staleTime: 300_000, enabled: !!cur && !ro });
  const [busy, setBusy] = useState(false);
  const done = () => void qc.invalidateQueries({ queryKey: ['assets'] });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      done();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const active = (seats.data?.seats ?? []).filter((s) => !s.released_at);

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-3">
        <PageHead title="Software licences" />
        <Card>
          <Table head={['Software', ['Seats', 'r'], 'Renews', ['Cost', 'r']]}>
            {list.map((l) => (
              <tr tabIndex={0} onKeyDown={clickOnKey} key={l.id} onClick={() => setSel(l.id)} className={cx('cursor-default', l.id === cur?.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={td}><b>{l.name}</b>{l.version ? <span className="text-ink-3">{` ${l.version}`}</span> : null}</td>
                <td className={tdr}><span className={l.over_allocated ? 'text-danger' : ''}>{`${l.seats_used} / ${l.seats_total}`}</span></td>
                <td className={td}>{l.days_left != null && l.days_left < 0 ? <Badge status="expired">Expired</Badge> : shortDate(l.expiry_date) || '—'}</td>
                <td className={tdr}>{amt(l.cost, l.currency)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      {cur ? (
        <section aria-label={cur.name} className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 self-start rounded-[10px] border border-line bg-surface p-4">
          <h2 className="m-0 text-[16px] font-bold">{cur.name}</h2>
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
            <dt className="text-ink-3">Vendor</dt><dd className="m-0">{cur.vendor ?? '—'}</dd>
            <dt className="text-ink-3">Term</dt><dd className="m-0">{`${shortDate(cur.purchase_date) || '—'} – ${shortDate(cur.expiry_date) || '—'}`}</dd>
            <dt className="text-ink-3">Key</dt>
            <dd className="m-0">
              {cur.has_key ? (
                key?.id === cur.id ? <span className="font-mono select-all">{key.key}</span> : (
                  <button type="button" className="font-semibold text-primary" disabled={ro} onClick={() => void revealKey(cur.id).then((r) => setKey({ id: cur.id, key: r.license_key })).catch((e) => toast('error', refusal(e)))}>
                    ••••  Reveal <span className="text-[11px] font-normal text-ink-3">· logged</span>
                  </button>
                )
              ) : '—'}
            </dd>
            <dt className="text-ink-3">Paid by</dt>
            <dd className="m-0">
              {cur.subscription ? (
                <span>{cur.subscription.name}{cur.subscription.next_renewal ? <span className="text-ink-3">{` · renews ${shortDate(cur.subscription.next_renewal)}`}</span> : null}{cur.subscription.amount ? <span className="text-ink-3">{` · ${amt(cur.subscription.amount, cur.subscription.currency ?? '')}${cur.subscription.billing_cycle ? ` ${cur.subscription.billing_cycle}` : ''}`}</span> : null}</span>
              ) : !subs.data?.length ? '—' : null}
              {!ro && subs.data?.length ? (
                <select aria-label="Expense subscription paying for it" className={cx(input, 'mt-1 h-8')} value={cur.subscription_id ?? 0} disabled={busy} onChange={(e) => void act(() => linkSubscription(cur.id, Number(e.target.value) || null), Number(e.target.value) ? 'Linked to the subscription.' : 'Unlinked.')}>
                  <option value={0}>No subscription</option>
                  {subs.data.map((s) => <option key={s.id} value={s.id}>{`${s.name}${s.billing_cycle ? ` · ${s.billing_cycle}` : ''}`}</option>)}
                </select>
              ) : null}
            </dd>
          </dl>
          <h3 className="m-0 text-[13px] font-bold">{`Seats ${cur.seats_used} of ${cur.seats_total}`}</h3>
          <Table head={['Person', 'Since', '']}>
            {active.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.holder}</td>
                <td className={td}>{shortDate(s.assigned_at)}</td>
                <td className={td}><Btn disabled={busy || ro} onClick={() => void act(() => releaseSeat(s.id), 'Seat released.')}>Release</Btn></td>
              </tr>
            ))}
          </Table>
          {!ro ? (
            <div className="flex items-end gap-2">
              <Field label="Assign a seat to" className="flex-1">
                <select className={input} value={who} onChange={(e) => setWho(Number(e.target.value))}>
                  <option value={0}>Choose…</option>
                  {(people.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Btn primary disabled={busy || !who} onClick={() => void act(() => assignSeat(cur.id, { employee_id: who }), 'Seat assigned.').then(() => setWho(0))}>Assign seat</Btn>
            </div>
          ) : null}
          {cur.days_left != null && cur.days_left >= 0 && cur.days_left <= 30 && cur.seats_available > 0 ? (
            <p className="m-0 rounded-[8px] bg-[#FFF8E6] px-3 py-2 text-[12px] text-[#7A3B05] dark:bg-warning-bg dark:text-warning">{`Renews in ${cur.days_left} days for ${cur.seats_total} seats; ${cur.seats_available} ${cur.seats_available === 1 ? 'is' : 'are'} free.`}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
