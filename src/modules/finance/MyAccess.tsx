import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead, Panel, Seg } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { can, fetchAccess, fetchModuleAccess, K } from './api';
import { Notice } from '../../components/RecordKit';

/**
 * My access · Finance: whose books I can open, and — the reason this exists —
 * why not the others. Being a member of a company is deliberately not enough
 * to reach its ledger (a `member` files expense claims), and a company missing
 * from the picker otherwise reads as a missing company rather than a withheld
 * one. Open to everyone in Finance, and it changes nothing.
 */
export default function MyAccess() {
  const [tab, setTab] = useState<'companies' | 'perms'>('companies');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: K.access, queryFn: ({ signal }) => fetchAccess(signal), retry: false });
  const mod = useQuery({ queryKey: K.moduleAccess, queryFn: ({ signal }) => fetchModuleAccess(signal), retry: false, enabled: tab === 'perms' });
  const list = mod.data?.permissions ?? q.data?.permissions ?? [];
  const held = list.filter((p) => p.held || can(perms, p.slug)).length;

  return (
    <div className="flex max-w-[860px] flex-col gap-3.5 px-6 py-5">
      <PageHead title="My access" sub="Whose books you can open in Finance, and what you may do in them — nothing here changes anything">
        <Seg
          label="My access"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'companies', label: 'Companies' },
            { id: 'perms', label: list.length ? `My permissions · ${held}` : 'My permissions' },
          ]}
        />
      </PageHead>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {tab === 'companies' && q.data ? (
        <>
          <Panel title="Books you can open" bodyClassName="flex flex-col gap-1.5 px-3.5 py-3">
            {q.data.companies.length ? (
              q.data.companies.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <b className="text-ink">{c.name}</b>
                  <Pill tone="grey">{c.role}</Pill>
                  {!c.has_books ? <Pill tone="amber">Books not opened</Pill> : null}
                </div>
              ))
            ) : (
              <span className="text-[13px] text-ink-2">
                None. Finance needs company membership at the {q.data.ledger_roles.map((r, i) => <span key={r}>{i ? ' or ' : ''}<code className="font-mono text-[12px]">{r}</code></span>)} level, and this account has none.
              </span>
            )}
            {q.data.super ? <span className="mt-1 text-[12px] text-ink-3">You hold the super-admin grant, so this is every active company rather than a membership list.</span> : null}
          </Panel>
          {q.data.excluded.length ? (
            <Notice tone="amber">
              <b>
                {q.data.excluded.length} {q.data.excluded.length === 1 ? 'company you belong to' : 'companies you belong to'} whose books you cannot open
              </b>
              <ul className="mt-2 mb-0 flex list-none flex-col gap-2 pl-0">
                {q.data.excluded.map((c) => (
                  <li key={c.id}>
                    <b>{c.name}</b> <span className="ml-1 rounded-[6px] bg-orange-bg px-1.5 py-0.5 text-[11px] dark:bg-warning/20">{c.role}</span>
                    <p className="mt-0.5 mb-0 opacity-90">{c.why}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 mb-0 text-[12px] opacity-90">
                This is not a fault. A company's ledger is not open to everybody who files an expense claim against it, and the role floor keeps that true. It is listed because otherwise the company is simply not there, which reads as missing rather than withheld.
              </p>
            </Notice>
          ) : null}
        </>
      ) : null}
      {tab === 'perms' ? (
        mod.isLoading && !q.data ? (
          <Spinner />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
            <p className="m-0 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
              {mod.data?.why ?? 'Two gates, both checked on every write: the permission says whether you may do this kind of thing at all, and the company list says whose books. Neither is enough alone — a permission without the company check would let one company’s accountant post into another’s.'}
            </p>
            {list.map((p) => {
              const yes = p.held || can(perms, p.slug);
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
        )
      ) : null}
    </div>
  );
}
