import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead, Panel, Seg } from '../../components/PageKit';
import { can, fetchModuleAccess, K, type Company } from './api';

/**
 * My access · Tenders: the companies whose bids I can see, and what I may do
 * with them. Read-only, and open to everyone in Tenders — it answers a
 * question about me. The company is a hard boundary here, not only a filter:
 * a tender in a company I do not hold does not open for me, even by its link.
 */
const DOES: Array<[string, string]> = [
  ['tender.view', 'Read tenders, follow them and add notes'],
  ['tender.manage', 'Create, edit and move tenders, and record them as won or lost'],
  ['tender.approve', 'Approve or reject a tender at an approval step'],
  ['tender.settings', 'Set up sources, scoring rules and the module'],
];

export default function MyAccess({ companies }: { companies: Company[] }) {
  const [tab, setTab] = useState<'scope' | 'perms'>('scope');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mod = useQuery({ queryKey: K.access, queryFn: ({ signal }) => fetchModuleAccess(signal) });
  const held = (mod.data?.permissions ?? []).filter((p) => p.held || can(perms, p.slug)).length;

  return (
    <div className="flex max-w-[820px] flex-col gap-3.5 px-6 py-5">
      <PageHead title="My access" sub="What you can see and do in Tenders — nothing here changes anything">
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
        <>
          <p className="m-0 rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
            A tender belongs to one company. You see the tenders of the companies below and no others — a tender in another company does not open for you, even from a link.
          </p>
          <Panel title="Companies whose tenders you can see" bodyClassName="flex flex-wrap gap-1.5 px-3.5 py-3">
            {companies.length ? (
              companies.map((c) => (
                <span key={c.id} className="rounded-[8px] bg-subtle px-2.5 py-1 text-[12.5px] font-semibold text-ink">
                  {c.name}
                  {c.role ? <span className="font-medium text-ink-3"> · {c.role}</span> : null}
                </span>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">None. Ask an administrator to add you to a company.</span>
            )}
          </Panel>
          <Panel title="What you can do" bodyClassName="flex flex-col gap-1 px-3.5 py-3">
            {DOES.map(([slug, what]) => {
              const yes = can(perms, slug);
              return (
                <span key={slug} className={cx('flex items-start gap-2 text-[12.5px]', yes ? 'text-ink' : 'text-ink-3')}>
                  <Icon name={yes ? 'check' : 'minus'} size={14} className={cx('mt-0.5 shrink-0', yes ? 'text-success' : 'text-ink-3')} />
                  {what}
                </span>
              );
            })}
          </Panel>
        </>
      ) : mod.isLoading ? (
        <Spinner />
      ) : mod.error ? (
        <ErrorNote error={mod.error} onRetry={() => void mod.refetch()} />
      ) : mod.data ? (
        <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          {mod.data.why ? <p className="m-0 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">{mod.data.why}</p> : null}
          {mod.data.permissions.map((p) => {
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
      ) : null}
    </div>
  );
}
