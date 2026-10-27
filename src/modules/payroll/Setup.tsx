import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { humanise } from '../../components/PageKit';
import { fetchComponents, fetchGroups, fetchPeriods, fetchStructures, generatePeriods } from './api';
import { Badge, Card, NotYet, Pills, Table, td, useReadOnly } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Setup (D18–D20): components, structures, pay groups with their calendars (and Generate <year>), and GL mapping.
 * Read here, with the one act a calendar needs — generating next year's periods. Editing a component's formula or a
 * structure's lines opens on the web, where the formula tester lives.
 */
type Tab = 'components' | 'structures' | 'groups' | 'gl';

export default function Setup({ tab, onTab }: { tab: string; onTab: (t: Tab) => void }) {
  const t: Tab = (['components', 'structures', 'groups', 'gl'] as string[]).includes(tab) ? (tab as Tab) : 'components';
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 text-[21px] font-extrabold text-ink">Setup</h1>
      <Pills label="Setup" value={t} onChange={onTab} options={[{ id: 'components', label: 'Components' }, { id: 'structures', label: 'Structures' }, { id: 'groups', label: 'Pay groups & calendars' }, { id: 'gl', label: 'GL mapping' }]} />
      {t === 'components' ? <Components /> : t === 'structures' ? <Structures /> : t === 'groups' ? <Groups /> : (
        <Card title="GL mapping">
          <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-2">
            Which Finance account each payroll role posts to is kept with the chart of accounts.{' '}
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: '/payroll/setup/gl' })}>Open GL mapping ↗</button>
          </p>
        </Card>
      )}
    </div>
  );
}

function Components() {
  const q = useQuery({ queryKey: ['payroll', 'components'], queryFn: ({ signal }) => fetchComponents(signal) });
  const [sel, setSel] = useState<number | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data?.components ?? [];
  const pick = list.find((c) => c.id === sel) ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-2.5">
      <Card>
        <Table head={['Code', 'Name', 'Type', 'Method', 'Ver.']}>
          {list.map((c) => (
            <tr tabIndex={0} onKeyDown={clickOnKey} key={c.id} onClick={() => setSel(c.id)} className={cx('cursor-default', c.id === sel ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
              <td className={cx(td, 'font-mono text-[11px] font-bold')}>{c.code}</td>
              <td className={td}>{c.name}</td>
              <td className={td}>{humanise(c.kind)}</td>
              <td className={td}>{humanise(c.method ?? c.class ?? '')}</td>
              <td className={td}>{c.version ? `v${c.version}` : ''}</td>
            </tr>
          ))}
        </Table>
      </Card>
      {pick ? (
        <Card title={`${pick.code} · ${pick.name}`}>
          <dl className="m-0 grid grid-cols-[100px_1fr] gap-y-1.5 px-3.5 pb-2 text-[12.5px]">
            <dt className="text-ink-2">Type</dt><dd className="m-0">{humanise(pick.kind)}</dd>
            <dt className="text-ink-2">Class</dt><dd className="m-0">{humanise(pick.class ?? '')}</dd>
            <dt className="text-ink-2">Active</dt><dd className="m-0">{pick.is_active === 0 || pick.is_active === false ? 'No' : 'Yes'}</dd>
          </dl>
          <p className="m-0 px-3.5 pb-3 text-[12px]"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: '/payroll/setup/components' })}>Edit the formula and test it ↗</button></p>
        </Card>
      ) : null}
    </div>
  );
}

function Structures() {
  const q = useQuery({ queryKey: ['payroll', 'structures'], queryFn: ({ signal }) => fetchStructures(signal) });
  const [sel, setSel] = useState<number | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === null) return <Card><NotYet what="Pay structures" /></Card>;
  const list = q.data?.structures ?? [];
  const pick = list.find((s) => s.id === sel) ?? list[0] ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-2.5">
      <Card>
        {list.map((s) => (
          <button key={s.id} type="button" onClick={() => setSel(s.id)} className={cx('flex w-full flex-col items-start border-b border-line/70 px-3.5 py-2.5 text-left text-[12.5px]', s.id === pick?.id ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
            <b>{s.name}</b>
            <span className="text-[11.5px] text-ink-2">{`${s.code} · ${s.items.length} components`}</span>
          </button>
        ))}
      </Card>
      {pick ? (
        <Card title={pick.name}>
          <Table head={['Code', 'Component', 'How', 'Value']}>
            {[...pick.items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((i) => (
              <tr key={i.component_id}>
                <td className={cx(td, 'font-mono text-[11px] font-bold')}>{i.code}</td>
                <td className={td}>{i.name}</td>
                <td className={td}>{humanise(i.calc)}</td>
                <td className={cx(td, 'font-mono text-[11px]')}>{i.formula ?? i.percent ?? i.amount ?? 'per employee'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

function Groups() {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll', 'groups'], queryFn: ({ signal }) => fetchGroups(signal) });
  const [sel, setSel] = useState<number | null>(null);
  const g = sel ?? q.data?.groups[0]?.id ?? null;
  const periods = useQuery({ queryKey: ['payroll', 'periods', g], queryFn: ({ signal }) => fetchPeriods(g!, signal), enabled: !!g });
  const last = (periods.data?.periods ?? []).map((p) => Number(p.ends_on.slice(0, 4))).reduce((a, b) => Math.max(a, b), new Date().getFullYear());
  const gen = useMutation({
    mutationFn: () => generatePeriods(g!, last + 1),
    onSuccess: (r) => (toast('success', `${r.created.length} periods made.`), void qc.invalidateQueries({ queryKey: ['payroll', 'periods', g] })),
    onError: (e) => toast('error', refusal(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        {(q.data?.groups ?? []).map((x) => (
          <button key={x.id} type="button" onClick={() => setSel(x.id)} className={cx('rounded-[10px] border bg-surface px-3.5 py-3 text-left text-[12.5px]', x.id === g ? 'border-2 border-primary' : 'border-line hover:bg-subtle')}>
            <div className="flex items-center gap-2"><b className="flex-1">{x.name}</b><Badge status={x.is_active === 0 || x.is_active === false ? 'ne' : 'active'}>{x.confidential ? 'Confidential' : x.is_active === 0 || x.is_active === false ? 'Inactive' : 'Active'}</Badge></div>
            <div className="mt-1 text-ink-2">{`${x.currency} · ${humanise(x.cadence)}${x.employee_count != null ? ` · ${x.employee_count} staff` : ''}`}</div>
          </button>
        ))}
      </div>
      {g ? (
        <Card title="Calendar" action={q.data?.can?.edit ? <button type="button" disabled={ro || gen.isPending} onClick={() => gen.mutate()} className="h-7 rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink disabled:opacity-50">{`Generate ${last + 1}`}</button> : null}>
          {periods.isLoading ? <Spinner /> : (
            <Table head={['Period', 'Cut-off', 'Pay date', 'Status']}>
              {(periods.data?.periods ?? []).map((p) => (
                <tr key={p.id}>
                  <td className={td}><b>{p.name}</b></td>
                  <td className={td}>{p.attendance_cutoff ? shortDate(p.attendance_cutoff) : '—'}</td>
                  <td className={td}>{p.payment_date ? shortDate(p.payment_date) : '—'}</td>
                  <td className={td}><Badge status={p.status === 'closed' ? 'ne' : p.status === 'open' ? 'open' : 'in'}>{humanise(p.status)}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
