import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { addNote, editNote, fetchClient, K, money, withdrawNote } from './api';
import { Chips, errText, Head, input, Section, StatusPill, td, th, useDesk } from './parts';

/**
 * D15 · Client history: the tallies, every appointment (with its invoice where the reader may see Billing), and the
 * staff-only notes — add (queued offline), pin to the booking card, edit, withdraw (kept by the server, never deleted).
 */
export default function ClientHistory({ id, onBack }: { id: number; onBack: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.client(id), queryFn: ({ signal }) => fetchClient(id, signal) });
  const [tab, setTab] = useState<'appointments' | 'invoices'>('appointments');
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const h = q.data;
  const org = h?.can.notes[0] ?? null;
  const refresh = () => void qc.invalidateQueries({ queryKey: K.client(id) });

  const save = async () => {
    if (!body.trim() || !org) return;
    try {
      const r = await addNote(id, org, body.trim(), pin);
      toast(r.queued ? 'info' : 'success', r.message);
      setBody('');
      setPin(false);
      refresh();
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const change = async (fn: () => Promise<{ message: string }>) => {
    try {
      const r = await fn();
      toast('success', r.message || 'Saved.');
      setEditing(null);
      refresh();
    } catch (e) {
      toast('error', errText(e));
    }
  };

  if (!h) return <p className="text-[13px] text-ink-3">{q.isError ? errText(q.error) : 'Reading…'}</p>;
  const tiles: Array<[string, string | number]> = [
    ['Visits', h.tally.completed],
    ['Upcoming', h.tally.upcoming],
    ['Cancelled', h.tally.cancelled],
    ['No-shows', h.tally.no_show],
    ['Spend', h.revenue ? h.revenue.map((m) => money(m.amount, m.currency)).join(' · ') || '0' : '—'],
    ['Owed', h.owed ? h.owed.map((m) => money(m.amount, m.currency)).join(' · ') || '0' : '—'],
  ];
  return (
    <div>
      <button type="button" className="mb-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={onBack}>‹ Clients</button>
      <Head title={h.customer.name} sub={[h.customer.phone, h.customer.email, h.customer.since ? `client since ${h.customer.since}` : null, h.tally.favourite_service ? `usually ${h.tally.favourite_service}` : null, h.tally.preferred_provider ? `with ${h.tally.preferred_provider}` : null].filter(Boolean).join(' · ')}>
        {h.customer.phone ? <a className="inline-flex h-8 items-center rounded-[8px] border border-line px-3 text-[13px] text-ink hover:bg-subtle" href={`tel:${h.customer.phone.replace(/[^\d+]/g, '')}`}>Call</a> : null}
        <Button variant="primary" disabled={!desk.online} onClick={() => desk.book({ customer: { id: h.customer.id, name: h.customer.name } })}>Book again</Button>
      </Head>
      <div className="mb-4 grid grid-cols-6 gap-2">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-[10px] border border-line bg-surface px-3 py-2">
            <div className="text-[11px] text-ink-3">{k}</div>
            <div className="truncate text-[15px] font-bold text-ink tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <Section title={<Chips label="Show" value={tab} onChange={setTab} options={[{ id: 'appointments', label: 'Appointments' }, { id: 'invoices', label: 'Invoices' }]} />}>
          <table className="w-full border-collapse text-[12.5px] text-ink">
            <thead><tr>{(tab === 'appointments' ? ['Date', 'Service', 'With', 'Location', 'Status'] : ['Date', 'Appointment', 'Invoice', 'Total', 'Status']).map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
            <tbody>
              {h.timeline.filter((v) => tab === 'appointments' || v.invoice).map((v) => (
                <tr key={v.id} className="cursor-pointer hover:bg-subtle" onClick={() => desk.open(v.id)}>
                  <td className={cx(td, 'tabular-nums')}>{`${v.date ?? ''} ${v.time ?? ''}`}</td>
                  {tab === 'appointments' ? (
                    <>
                      <td className={td}>{v.service}</td>
                      <td className={td}>{v.provider}</td>
                      <td className={td}>{v.location}</td>
                      <td className={td}><StatusPill a={v} /></td>
                    </>
                  ) : (
                    <>
                      <td className={cx(td, 'font-mono text-[11.5px]')}>{v.number}</td>
                      <td className={td}>{v.invoice?.number ?? 'Draft'}</td>
                      <td className={td}>{money(v.invoice?.total, v.invoice?.currency)}</td>
                      <td className={td}>{v.invoice?.status}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {typeof h.earlier === 'number' && h.earlier > 0 ? <p className="m-0 px-3.5 py-2 text-[12px] text-ink-3">{`${h.earlier} earlier not shown.`}</p> : null}
        </Section>
        <Section title={<span>Notes <span className="font-normal text-ink-3">staff only</span></span>}>
          <div className="px-3.5 pb-3.5">
            {h.notes === null ? <p className="m-0 text-[12.5px] text-ink-3">Client notes need the notes permission.</p> : null}
            {(h.notes ?? []).map((n) => (
              <div key={n.id} className="border-b border-line/70 py-2 text-[12.5px]">
                {editing?.id === n.id ? (
                  <>
                    <textarea className={cx(input, 'h-20 py-2')} aria-label="Note" value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} />
                    <div className="mt-1 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={() => void change(() => editNote(n.id, { body: editing.body }))}>Save</Button></div>
                  </>
                ) : (
                  <>
                    <div className="text-ink whitespace-pre-wrap">{n.body}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-ink-3">
                      {n.pinned ? <b className="text-primary">Pinned</b> : null}
                      <span>{[n.by, n.at ? new Date(n.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}</span>
                      {desk.online ? (
                        <>
                          <button type="button" className="hover:underline" onClick={() => void change(() => editNote(n.id, { pinned: !n.pinned }))}>{n.pinned ? 'Unpin' : 'Pin'}</button>
                          <button type="button" className="hover:underline" onClick={() => setEditing({ id: n.id, body: n.body })}>Edit</button>
                          <button type="button" className="hover:underline" onClick={() => void change(() => withdrawNote(n.id))}>Withdraw</button>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ))}
            {org ? (
              <div className="mt-2">
                <textarea className={cx(input, 'h-20 py-2')} placeholder="A note for the team" aria-label="New note" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
                <div className="mt-1 flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 text-[12.5px] text-ink"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />Pin to the booking card</label>
                  <Button size="sm" variant="primary" disabled={!body.trim()} onClick={() => void save()}>Save note</Button>
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
