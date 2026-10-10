import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../../components/Select';
import { Avatar, Button } from '../../../components/ui';
import { qk, read } from '../api';
import { useOrgParam } from '../company';
import { actionWords, fmtDay, pk, preads, projectPath } from '../portfolio';
import { Failed, Loading, Mono, Nothing, PageHead, Panel } from './kit';

/**
 * The Activity log: who did what, newest first, across every project in reach (`/projects/activity`) or one project
 * (its Activity tab). Each row links to its project and, where there is one, opens the task in the panel.
 */

const PER_PAGE = 50;

export function ActivityList({ projectId = null, embedded = false, onGo, onOpenTask, onOffline }: { projectId?: number | null; embedded?: boolean; onGo: (route: string) => void; onOpenTask: (taskId: number) => void; onOffline?: (o: boolean) => void }) {
  useOrgParam();
  const [page, setPage] = useState(1);
  const [projectFilter, setProjectFilter] = useState('');
  const pid = projectId ?? (Number(projectFilter) || null);
  const p = { project_id: pid, page, per_page: PER_PAGE };
  const q = useQuery({ queryKey: pk.activity(p), queryFn: ({ signal }) => preads.activity(p, { signal }), placeholderData: keepPreviousData });
  const projects = useQuery({ queryKey: qk.list, queryFn: ({ signal }) => read.list({ signal }), enabled: !embedded, staleTime: 60_000 });
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline?.(fromCache), [fromCache, onOffline]);
  const d = q.data?.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / (d.per_page || PER_PAGE))) : 1;

  const body = (
    <Panel className="overflow-hidden">
      {q.isLoading ? (
        <Loading />
      ) : !d ? (
        <Failed error={q.error} onRetry={() => void q.refetch()} />
      ) : !d.activity.length ? (
        <Nothing text="Nothing has happened here yet." />
      ) : (
        <>
          <ol aria-label="Activity">
            {d.activity.map((a, i) => (
              <li key={a.id ?? i} className="flex items-start gap-3 border-t border-line/70 px-3.5 py-2 text-[12.5px] first:border-t-0">
                <Avatar name={a.actor ?? 'System'} size={24} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-semibold text-ink">{a.actor ?? 'System'}</span>
                    <span className="text-ink-2">{actionWords(a.action)}</span>
                    {a.task_id ? (
                      <button type="button" onClick={() => onOpenTask(a.task_id!)} className="font-mono text-[11.5px] text-primary hover:underline">
                        {a.task_number ?? `task ${a.task_id}`}
                      </button>
                    ) : null}
                  </div>
                  {a.detail ? <div className="truncate text-[12px] text-ink-3">{a.detail}</div> : null}
                </div>
                {!embedded && a.project_id ? (
                  <button type="button" onClick={() => onGo(projectPath(a.project_id!))} title={a.project ?? undefined} className="shrink-0 font-mono text-[11.5px] text-primary hover:underline">
                    {a.code ?? a.project}
                  </button>
                ) : null}
                <time dateTime={a.at} className="w-28 shrink-0 text-end text-[11.5px] text-ink-3">
                  {fmtDay(a.at)} <Mono>{a.at.slice(11, 16)}</Mono>
                </time>
              </li>
            ))}
          </ol>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-2 border-t border-line px-3.5 py-2 text-[12.5px] text-ink-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                Newer
              </Button>
              <span>
                Page <Mono>{page}</Mono> of <Mono>{pages}</Mono>
              </span>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
                Older
              </Button>
              <span className="ms-auto text-[11.5px] text-ink-3">
                <Mono>{d.total}</Mono> events
              </span>
            </nav>
          ) : null}
        </>
      )}
    </Panel>
  );

  if (embedded) return <div className="px-5 py-3.5">{body}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Activity log"
        actions={
          <Select
            aria-label="Project"
            value={projectFilter}
            onChange={(e) => (setProjectFilter(e.target.value), setPage(1))}
            options={[{ value: '', label: 'Project: all' }, ...(projects.data?.data.projects ?? []).map((x) => ({ value: String(x.id), label: `${x.code} · ${x.name}` }))]}
            className="h-7 min-w-[200px] rounded-[8px] border border-line bg-surface px-2.5 text-[12px]"
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5 scroll-thin">{body}</div>
    </div>
  );
}
