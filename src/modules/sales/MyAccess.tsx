import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead, Panel, Seg } from '../hr/parts';
import { fetchAccess, fetchModuleAccess, KM } from './manage';

/**
 * My access · Orders: which companies I may work in, which lists the company
 * picker narrows and which it does not, and what I may do here. Read-only,
 * and open to everyone in Orders — it answers a question about me, so it is
 * not behind the administrators' Settings. The boundary note is as prominent
 * as the reassurance: a company narrows what a list shows; it does not stop
 * somebody who knows an order's number from opening it.
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

export default function MyAccess() {
  const [tab, setTab] = useState<'scope' | 'perms'>('scope');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const scope = useQuery({ queryKey: KM.access, queryFn: ({ signal }) => fetchAccess(signal) });
  const mod = useQuery({ queryKey: KM.moduleAccess, queryFn: ({ signal }) => fetchModuleAccess(signal) });
  const held = (mod.data?.permissions ?? []).filter((p) => p.held || has(perms, p.slug)).length;
  // Only what there is: a count of nothing is not something anybody needs to be told about.
  const unassigned = Object.entries(scope.data?.unassigned ?? {}).filter(([, n]) => Number(n) > 0);

  return (
    <div className="flex max-w-[820px] flex-col gap-3.5 px-6 py-5">
      <PageHead title="My access" sub="What you can see and do in Orders — nothing here changes anything">
        <Seg
          label="My access"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'scope', label: 'Data access' },
            { id: 'perms', label: mod.data ? `My access · ${held}` : 'My access' },
          ]}
        />
      </PageHead>
      {tab === 'scope' ? (
        scope.isLoading ? (
          <Spinner />
        ) : scope.error ? (
          <ErrorNote error={scope.error} onRetry={() => void scope.refetch()} />
        ) : scope.data ? (
          <>
            {scope.data.why ? <p className="m-0 text-[13px] text-ink-2">{scope.data.why}</p> : null}
            {scope.data.boundary_note ? <p className="m-0 rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">{scope.data.boundary_note}</p> : null}
            <div className="grid grid-cols-2 gap-3.5">
              <Panel title="Narrowed by the company picker" bodyClassName="flex flex-col gap-1 px-3.5 py-3">
                {scope.data.scoped.map((x) => (
                  <span key={x} className="flex items-start gap-2 text-[12.5px] text-ink">
                    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-success" />
                    {x}
                  </span>
                ))}
              </Panel>
              <Panel title="Not narrowed" bodyClassName="flex flex-col gap-1 px-3.5 py-3">
                {scope.data.unscoped.length ? (
                  scope.data.unscoped.map((x) => (
                    <span key={x} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                      <Icon name="minus" size={14} className="mt-0.5 shrink-0 text-ink-3" />
                      {x}
                    </span>
                  ))
                ) : (
                  <span className="text-[12.5px] text-ink-3">Everything is narrowed.</span>
                )}
              </Panel>
            </div>
            {scope.data.companies.length ? (
              <Panel title="Companies you may work in" bodyClassName="flex flex-wrap gap-1.5 px-3.5 py-3">
                {scope.data.companies.map((c) => (
                  <span key={c.id} className="rounded-[8px] bg-subtle px-2.5 py-1 text-[12.5px] font-semibold text-ink">
                    {c.name}
                    {c.role ? <span className="font-medium text-ink-3"> · {c.role}</span> : null}
                  </span>
                ))}
              </Panel>
            ) : null}
            {unassigned.length ? (
              <Panel title="Belonging to no company" sub="Shown under every company, so nothing unassigned is lost." bodyClassName="flex flex-col gap-1 px-3.5 py-3">
                {unassigned.map(([what, n]) => (
                  <span key={what} className="text-[12.5px] text-ink">
                    <b className="tabular-nums">{n.toLocaleString()}</b> {what.replace(/_/g, ' ')}
                  </span>
                ))}
              </Panel>
            ) : null}
          </>
        ) : null
      ) : mod.isLoading ? (
        <Spinner />
      ) : mod.error ? (
        <ErrorNote error={mod.error} onRetry={() => void mod.refetch()} />
      ) : mod.data ? (
        <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          {mod.data.why ? <p className="m-0 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">{mod.data.why}</p> : null}
          {mod.data.permissions.map((p) => {
            const yes = p.held || has(perms, p.slug);
            return (
              <div key={p.slug} data-permission={p.slug} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 text-[13px] last:border-b-0">
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', yes ? 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success' : 'bg-subtle text-ink-3')}>
                  <Icon name={yes ? 'check' : 'minus'} size={13} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-ink">{p.name}</b>
                  <span className="font-mono text-[11.5px] text-ink-3">{p.slug}</span>
                </span>
                <span className="text-[12px] text-ink-3">{yes ? 'Granted' : 'Not granted'}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
