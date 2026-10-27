import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { openRouteInWindow } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Avatar, ErrorNote, Spinner } from '../../components/ui';
import { openMeeting } from '../meet/api';
import { btn, btnPrimary, PageHead } from '../hr/parts';
import { stamp, type Interview } from './api';

/**
 * D03 · my interviews today. Join opens the interview's Meeting the way Meetings does — its Meet room in Meet's own
 * window, or its online link — and the scorecard in a window beside it (D04).
 */
const JOIN_EARLY_MS = 10 * 60_000;

/** Whether Join is offered: online, from ten minutes before the start until its end (an hour when it has none). */
export function joinable(i: Interview, now: number): boolean {
  if (i.format === 'ONSITE' || !(i.meet_uuid || i.online_url || i.meeting_id)) return false;
  if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(i.status)) return false;
  const start = stamp(i.starts_at).getTime();
  const end = i.ends_at ? stamp(i.ends_at).getTime() : start + 3_600_000;
  return now >= start - JOIN_EARLY_MS && now <= end;
}

export function startsIn(i: Interview, now: number): string | null {
  const ms = stamp(i.starts_at).getTime() - now;
  if (ms <= 0) return null;
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `Starts in ${Math.floor(m / 60)} h ${m % 60} m` : `Starts in ${m} m`;
}

export const scorecardRoute = (id: number) => `/recruitment?tab=cards&interview=${id}&solo=1`;

/** The interview's call: its Meet room when it has one, else the Meeting's own room or link. */
export async function joinInterview(i: Interview): Promise<void> {
  let uuid = i.meet_uuid ?? null;
  let url = i.online_url ?? null;
  if (!uuid && !url && i.meeting_id) {
    const m = await apiGet<{ meet_uuid?: string | null; online_url?: string | null }>(`/api/meetings/${i.meeting_id}`);
    uuid = m.meet_uuid ?? null;
    url = m.online_url ?? null;
  }
  if (i.meeting_id) void apiPost(`/api/meetings/${i.meeting_id}/attend`, { action: 'join' }).catch(() => undefined);
  if (uuid) await openMeeting(uuid, i.title ?? i.candidate?.name ?? 'Interview');
  else if (url) await call('app:openExternal', { url });
  else throw new Error('This interview has no call to join.');
}

export default function Today({ data, onScorecard, canEvaluate }: { data: UseQueryResult<Interview[]>; onScorecard: (id: number) => void; canEvaluate: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const list = [...(data.data ?? [])].sort((a, b) => stamp(a.starts_at).getTime() - stamp(b.starts_at).getTime());
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (s: string) => stamp(s).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const open = list.filter((i) => i.my_role !== 'OBSERVER' && i.status === 'COMPLETED' && i.my_evaluation?.status !== 'SUBMITTED').length;

  return (
    <div className="h-full overflow-y-auto px-6 pt-5 pb-6 scroll-thin">
      <PageHead title="Interviews today" sub={`${fmt.format(new Date(now))} · ${list.length} interview${list.length === 1 ? '' : 's'}`} />
      {data.isPending ? <Spinner /> : data.isError ? <ErrorNote error={data.error} onRetry={() => void data.refetch()} /> : !list.length ? (
        <p className="text-[13px] text-ink-2">No interviews today.</p>
      ) : (
        <ul aria-label="Interviews today" className="flex flex-col gap-2">
          {list.map((i) => {
            const observer = i.my_role === 'OBSERVER';
            const soon = startsIn(i, now);
            return (
              <li key={i.id} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-3">
                <span className="w-[52px] shrink-0 text-[14px] font-bold text-ink tabular-nums">{time(i.starts_at)}</span>
                <Avatar name={i.candidate?.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">{i.candidate?.name ?? 'Candidate'}</div>
                  <div className="truncate text-[12px] text-ink-3">{[i.round ?? i.title, i.job?.title].filter(Boolean).join(' · ')}</div>
                </div>
                {observer ? <span className="text-[12px] text-ink-3">You observe</span> : null}
                {joinable(i, now) ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => {
                      joinInterview(i).catch((e) => toast('error', errorMessage(e)));
                      if (!observer && canEvaluate) openRouteInWindow(scorecardRoute(i.id), `Scorecard · ${i.candidate?.name ?? ''}`);
                    }}
                  >
                    Join Meet
                  </button>
                ) : soon ? <span className="text-[12px] text-ink-3">{soon}</span> : null}
                {canEvaluate && !observer ? <button type="button" className={btn} onClick={() => onScorecard(i.id)}>Scorecard</button> : null}
              </li>
            );
          })}
        </ul>
      )}
      {open ? <p className="mt-4 rounded-[10px] bg-yellow-bg px-3 py-2 text-[12.5px] text-orange-ink dark:bg-warning-bg dark:text-warning">{open} scorecard{open === 1 ? ' is' : 's are'} still open — they block candidates from moving on.</p> : null}
    </div>
  );
}
