import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead, Panel, Seg } from '../../components/PageKit';
import { fetchExplain, fetchModuleAccess, KS } from './admin';

/**
 * My access · Inventory: which of my companies' warehouses I may act in, and
 * why; whether costs reach me; and what I may do here. Read-only and open to
 * everyone in Inventory — it answers a question about me, so it is not
 * behind the administrators' Settings. The warehouse rule is the one worth
 * saying out loud: a warehouse that names nobody is open to everybody, so
 * naming the first person is what closes it.
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

export default function MyAccess() {
  const [tab, setTab] = useState<'scope' | 'perms'>('scope');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const scope = useQuery({ queryKey: KS.explain, queryFn: ({ signal }) => fetchExplain(signal) });
  const mod = useQuery({ queryKey: KS.moduleAccess, queryFn: ({ signal }) => fetchModuleAccess(signal) });
  const held = (mod.data?.permissions ?? []).filter((p) => p.held || has(perms, p.slug)).length;
  const w = scope.data?.warehouses;

  return (
    <div className="flex max-w-[820px] flex-col gap-3.5 px-6 py-5">
      <PageHead title="My access" sub="What you can see and do in Inventory — nothing here changes anything">
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
        ) : w && scope.data ? (
          <>
            <Panel title="Warehouses you can act in" bodyClassName="flex flex-col gap-2 px-4 py-3">
              <b data-reach className="text-[16px] text-ink">
                {w.all ? `All ${w.total.toLocaleString()} of your companies' warehouses` : `${w.count.toLocaleString()} of ${w.total.toLocaleString()}`}
              </b>
              <span className="text-[12.5px] leading-relaxed text-ink-2">{w.why}</span>
              {w.names.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {w.names.map((name) => (
                    <span key={name} className="rounded-[8px] bg-subtle px-2.5 py-1 text-[12.5px] font-semibold text-ink">
                      {name}
                    </span>
                  ))}
                  {w.count > w.names.length ? <span className="px-1 py-1 text-[12px] text-ink-3">and {(w.count - w.names.length).toLocaleString()} more</span> : null}
                </span>
              ) : null}
              <span className="rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">{w.open_note}</span>
            </Panel>
            <Panel title="Cost, valuation and margin" bodyClassName="flex flex-col gap-1.5 px-4 py-3">
              <span className="flex items-center gap-2">
                <span className={cx('rounded-[6px] px-2 py-0.5 text-[11.5px] font-bold', scope.data.cost.held ? 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success' : 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning')}>
                  {scope.data.cost.held ? 'Visible to you' : 'Hidden from you'}
                </span>
              </span>
              <span className="text-[12.5px] leading-relaxed text-ink-2">{scope.data.cost.why}</span>
            </Panel>
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
