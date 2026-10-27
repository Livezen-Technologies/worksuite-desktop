import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead, Panel, Seg } from '../../components/PageKit';

/**
 * My access (HrAdminSheet "My access"; the web's HrAdmin): whose HR records
 * I can open and why, and what I may do with them. Both come from
 * `/hr/access`, the same call every roster query makes, so this cannot claim
 * a reach the module will not honour. Amber rows are effective only through
 * `hr.manage` (HR's master key) — revoking one of them alone changes nothing.
 */
interface Explain {
  scope: { kind: 'all' | 'team' | 'self' | 'none'; reach: number; why: string };
  linked: boolean;
  master_key: boolean;
  via_master: number;
  permissions: Array<{ slug: string; name: string; literal: boolean; effective: boolean; via: 'granted' | 'hr.manage' | null }>;
}

const KIND: Record<Explain['scope']['kind'], string> = { all: 'Everybody', team: 'You and your reports', self: 'Only you', none: 'Nobody' };

export default function MyAccess() {
  const [tab, setTab] = useState<'scope' | 'perms'>('scope');
  const q = useQuery({ queryKey: ['hr', 'access'], queryFn: ({ signal }) => apiGet<Explain>('/api/hr/access', undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data!;
  const held = a.permissions.filter((p) => p.effective).length;

  return (
    <div className="flex max-w-[760px] flex-col gap-3.5">
      <PageHead title="My access" sub="What you can see and do in People — nothing here changes anything">
        <Seg
          label="My access"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'scope', label: 'Data access' },
            { id: 'perms', label: `My access · ${held}` },
          ]}
        />
      </PageHead>
      {tab === 'scope' ? (
        <>
          <section className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-4 py-3.5">
            <span className="text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase">Whose records you can open</span>
            <div className="flex items-baseline gap-2.5">
              <b className="text-[18px] text-ink">{KIND[a.scope.kind]}</b>
              <span className="text-[12.5px] text-ink-3 tabular-nums">
                {a.scope.reach} {a.scope.reach === 1 ? 'employee' : 'employees'}
              </span>
            </div>
            <p className="m-0 text-[12.5px] text-ink-2">{a.scope.why}</p>
            {!a.linked ? (
              <p className="m-0 mt-1.5 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink dark:text-warning">
                Your login is not linked to an employee record, so anything that starts from "which employee am I" — your attendance, documents and leave — has nothing to start from. An administrator sets that link on the employee record.
              </p>
            ) : null}
          </section>
          {a.via_master > 0 ? (
            <section className="rounded-[12px] border border-warning-line bg-warning-bg px-4 py-3 text-[12.5px] text-warning-strong dark:border-warning/40 dark:text-warning">
              <b>
                {a.via_master} of these {a.permissions.length} permissions are yours only through <code>hr.manage</code>.
              </b>{' '}
              HR treats <code>hr.manage</code> as a master key: it answers yes to every capability in the module, so revoking one of the amber rows would change nothing. To narrow this account, take away <code>hr.manage</code> itself.
            </section>
          ) : null}
        </>
      ) : (
        <Panel title="Permissions" sub="Green is granted to you; amber is effective only through hr.manage; grey you do not hold.">
          {a.permissions.map((p) => (
            <div key={p.slug} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-[7px] text-[12.5px] last:border-b-0">
              <span className={cx('h-2 w-2 shrink-0 rounded-full', !p.effective ? 'bg-primary-soft dark:bg-line' : p.via === 'hr.manage' ? 'bg-warning' : 'bg-success')} />
              <span className={cx('min-w-0 flex-1 truncate', p.effective ? 'text-ink' : 'text-ink-3')}>{p.name}</span>
              <code className="shrink-0 font-mono text-[11.5px] text-ink-3">{p.slug}</code>
              <span className={cx('w-[92px] shrink-0 text-right text-[11.5px] font-bold', !p.effective ? 'text-ink-3' : p.via === 'hr.manage' ? 'text-warning dark:text-warning' : 'text-success')}>{!p.effective ? 'Not held' : p.via === 'hr.manage' ? 'via hr.manage' : 'Held'}</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
