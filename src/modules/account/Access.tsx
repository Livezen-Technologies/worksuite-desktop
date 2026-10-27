import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiGet } from '../../core/api';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { K } from './api';
import { Card, Head, Note, Pill } from '../../components/CardKit';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * My access (`GET /access/me`, the web's /account/access): which modules
 * this account can open, and why — the application assigned or not, and the
 * permissions held. It reports what the server decides and changes nothing.
 * Whose records a module shows is each module's own question (People has
 * its own My access).
 */
interface Row {
  module: string;
  label: string;
  app: string | null;
  app_state: 'n/a' | 'missing' | 'unrestricted' | 'all' | 'assigned' | 'not-assigned';
  prefix: string | null;
  permissions: Array<{ slug: string; name: string; held: boolean }>;
  held: number;
  of: number;
  reachable: boolean;
  visible: boolean;
  enforced: boolean;
  why: string;
}

interface Summary {
  apps_mode: 'unrestricted' | 'all' | 'assigned';
  star: boolean;
  modules: Row[];
  totals: { reachable: number; blocked: number; hidden: number; total: number };
}

const STATE: Record<Row['app_state'], string> = {
  'n/a': 'Part of WorkSuite',
  missing: 'App missing',
  unrestricted: 'Not checked',
  all: 'Administrator',
  assigned: 'Assigned to you',
  'not-assigned': 'Not assigned',
};

export default function Access() {
  const q = useQuery({ queryKey: K.access, queryFn: ({ signal }) => apiGet<Summary>('/api/access/me', undefined, signal) });
  const [find, setFind] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const n = find.trim().toLowerCase();
    const all = [...(q.data?.modules ?? [])].sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.label.localeCompare(b.label));
    return n ? all.filter((r) => r.label.toLowerCase().includes(n) || (r.app ?? '').includes(n) || r.permissions.some((p) => p.slug.includes(n) || p.name.toLowerCase().includes(n))) : all;
  }, [q.data, find]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;

  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <Head title="My access" sub="Which parts of WorkSuite you can open, and why. Nothing here changes anything." />
      <StatGrid min={180}>
        <Stat icon="unlock" label="You can open" value={d.totals.reachable} tone="green" />
        <Stat icon="lock" tone="neutral" label="Not for you" value={d.totals.blocked} />
        <Stat icon="eye-off" label="Hidden, still open" value={d.totals.hidden} tone={d.totals.hidden ? 'amber' : undefined} />
        <Stat icon="grid" tone="blue" label="Modules" value={d.totals.total} />
      </StatGrid>
      {d.star ? <Note tone="amber">You hold the administrator grant, which passes every check — so nothing below can be closed to you. It is not what a normal account sees.</Note> : null}
      {d.apps_mode === 'unrestricted' && !d.star ? <Note tone="amber">No apps are assigned to your account, so the app check is not applied to you and every module shows as open. That is how a new installation starts — it does not mean somebody reviewed your access.</Note> : null}
      {d.totals.hidden > 0 ? <Note tone="amber">{d.totals.hidden} module{d.totals.hidden === 1 ? ' is' : 's are'} left out of your launcher because the app is not assigned to you, but still answer for the permissions you hold. Your permissions remain the real gate.</Note> : null}
      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="search" size={16} className="text-ink-3" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a module or a permission" aria-label="Find a module or a permission" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </div>
        {rows.length === 0 ? <p className="m-0 px-4 py-8 text-center text-[12.5px] text-ink-3">Nothing matches “{find}”.</p> : null}
        {rows.map((r) => {
          const expanded = open === r.module;
          const hidden = r.reachable && !r.visible;
          return (
            <div key={r.module} className="border-b border-line/70 last:border-b-0">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.module)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle">
                <Icon name={!r.reachable ? 'lock' : hidden ? 'eye' : 'check-circle'} size={18} className={cx('shrink-0', !r.reachable ? 'text-ink-3' : hidden ? 'text-warning' : 'text-success')} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className={cx('truncate text-[13.5px]', r.reachable ? 'text-ink' : 'text-ink-2')}>{r.label}</b>
                  <span className="truncate text-[12px] text-ink-3">{r.of > 0 ? `${r.held} of ${r.of} permissions` : 'No permissions of its own'}</span>
                </span>
                <Pill tone={r.app_state === 'missing' ? 'red' : hidden || r.app_state === 'unrestricted' ? 'amber' : r.reachable ? 'green' : 'grey'}>{hidden ? 'Hidden, still open' : STATE[r.app_state]}</Pill>
                <Icon name="chevron-down" size={14} className={cx('shrink-0 text-ink-3 transition-transform', !expanded && '-rotate-90')} />
              </button>
              {expanded ? (
                <div className="bg-well px-4 py-3">
                  <p className="m-0 mb-2.5 text-[12.5px] text-ink-2">{r.why}</p>
                  {r.permissions.length === 0 ? (
                    <p className="m-0 text-[12px] text-ink-3">This module has no permissions of its own, so the app alone decides.</p>
                  ) : (
                    <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0">
                      {r.permissions.map((p) => (
                        <li key={p.slug} className="flex min-w-0 items-center gap-2 text-[12px]">
                          <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', p.held ? 'bg-success' : 'bg-line')} />
                          <span className={cx('truncate', p.held ? 'text-ink' : 'text-ink-3')} title={p.slug}>
                            {p.name || p.slug}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
      <p className="m-0 text-[12px] text-ink-3">Whose records you see inside a module is that module’s own answer — People has its own My access.</p>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone?: StatTone; icon?: string }) {
  return <StatCard label={label} value={value} tone={tone} icon={icon} />;
}
