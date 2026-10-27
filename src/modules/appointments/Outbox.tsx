import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import { fetchDashboard, K, today } from './api';
import { errText, Head, Pill, Section, StatusPill, td, th, useDesk } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * D21 · Offline and outbox: what this desk did without WorkSuite — check-ins and other status moves, client notes —
 * waiting in the desktop's encrypted queue and sent in order when the connection is back. The server judges each
 * again then; one it refuses stays here with its reason until someone retries or dismisses it (a later change to the
 * same appointment waits behind it). Below, the day as last read from WorkSuite.
 */
const STATE: Record<OfflineMutation['state'], [string, string]> = {
  PENDING: ['Waiting', 'warn'],
  SYNCING: ['Sending', 'info'],
  DONE: ['Sent', 'ok'],
  CONFLICT: ['Refused', 'late'],
  FAILED: ['Failed', 'late'],
};

export default function Outbox({ items }: { items: OfflineMutation[] }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const day = useQuery({ queryKey: K.dashboard(today()), queryFn: ({ signal }) => fetchDashboard(today(), signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: K.outbox });

  const tryNow = async () => {
    setBusy(true);
    try {
      const r = await call('offline:replay');
      toast(r.conflicts || r.failed ? 'warning' : 'success', r.done ? `${r.done} sent.${r.conflicts + r.failed ? ` ${r.conflicts + r.failed} refused.` : ''}` : r.remaining ? 'WorkSuite is still out of reach.' : 'Nothing to send.');
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const one = async (id: string, what: 'retry' | 'discard') => {
    try {
      await call(what === 'retry' ? 'offline:retry' : 'offline:discard', { id });
    } catch (e) {
      toast('error', errText(e));
    }
    refresh();
  };
  const waiting = items.filter((m) => m.state === 'PENDING' || m.state === 'SYNCING');

  return (
    <div className="max-w-[1000px]">
      <Head title={desk.online ? 'Outbox' : 'No connection to WorkSuite'} sub={desk.online ? 'Changes made while offline, and any WorkSuite refused.' : 'You can check clients in and write notes. Booking, moving, checkout and deposits wait for the connection.'}>
        <Button variant="primary" icon="refresh" loading={busy} onClick={() => void tryNow()}>Try now</Button>
      </Head>
      <Section title={`Waiting to send · ${waiting.length}`} action={<span className="text-[12px] text-ink-3">Sent in order when back online</span>}>
        <table className="w-full border-collapse text-[12.5px] text-ink">
          <thead><tr><th className={th}>What</th><th className={th}>When</th><th className={th}>State</th><th className={th} /></tr></thead>
          <tbody>
            {items.map((m) => {
              const [text, tone] = STATE[m.state];
              return (
                <tr key={m.id}>
                  <td className={td}>
                    {m.label}
                    {m.error ? <div className="text-[11.5px] whitespace-normal text-danger">{m.error}</div> : null}
                  </td>
                  <td className={td}>{new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className={td}><Pill tone={tone}>{text}</Pill></td>
                  <td className={td}>
                    {m.state === 'CONFLICT' || m.state === 'FAILED' ? (
                      <span className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => void one(m.id, 'retry')}>Retry</Button>
                        <Button size="sm" variant="ghost" onClick={() => void one(m.id, 'discard')}>Dismiss</Button>
                      </span>
                    ) : m.state === 'PENDING' ? (
                      <Button size="sm" variant="ghost" onClick={() => void one(m.id, 'discard')}>Don’t send</Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!items.length ? <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-3">Nothing waiting.</td></tr> : null}
          </tbody>
        </table>
        <p className="m-0 px-3.5 py-2 text-[11.5px] text-ink-3">A refused change keeps its reason here until someone dismisses it. Nothing is lost.</p>
      </Section>
      <Section className="mt-4" title={desk.online ? 'Today' : 'Today, as last read from WorkSuite'}>
        <table className="w-full border-collapse text-[12.5px] text-ink">
          <tbody>
            {(day.data?.schedule ?? []).filter((a) => !desk.location || a.location.id === desk.location).map((a) => (
              <tr tabIndex={0} onKeyDown={clickOnKey} key={a.id} className="cursor-pointer hover:bg-subtle" onClick={() => desk.open(a.id)}>
                <td className={td}>{a.local.start}</td>
                <td className={td}>{a.customer.name}</td>
                <td className={td}>{`${a.service.name} · ${a.provider.name}`}</td>
                <td className={td}><StatusPill a={a} /></td>
              </tr>
            ))}
            {!day.data ? <tr><td className="px-3 py-4 text-ink-3">{day.isPending ? 'Reading…' : 'No copy of today on this computer.'}</td></tr> : null}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
