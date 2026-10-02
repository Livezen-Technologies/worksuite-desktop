import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { dateLabel } from '../../core/time';
import { Chip, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import type { MeetPoll, MeetQuestion } from '../meet/api';
import { PollResults } from '../meet/Activities';
import { useMeetT } from '../meet/i18n';
import type { Detail } from './api';

/** `GET /api/meetings/{id}/qa-polls`: what the meeting's room kept, as this person may see it. */
export interface QaPolls {
  questions: MeetQuestion[];
  polls: MeetPoll[];
  /** The organiser, host and co-hosts: hidden questions, unshared polls and who asked are in it. */
  full: boolean;
}

/**
 * Q&A & Polls (worksuite-desktop#92), in the meeting's details: the questions
 * asked in its Meet room, with their answers, and its polls with their
 * results. The people who ran the meeting see everything, hidden questions and
 * polls never shared included; everybody else what the room showed them —
 * never who asked anonymously, and no poll whose results were not shared.
 */
export function QaPollsTab({ d }: { d: Detail }) {
  const t = useMeetT();
  const id = d.meeting.id;
  const q = useQuery({ queryKey: ['meetings', id, 'qa-polls'], queryFn: ({ signal }) => apiGet<QaPolls>(`/api/meetings/${id}/qa-polls`, undefined, signal), enabled: !!d.meeting.meet_uuid });
  if (!d.meeting.meet_uuid) return <Empty icon="help" title="No Q&A or polls" hint="Questions and polls are kept for meetings held in WorkSuite Meet." />;
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const data = q.data ?? { questions: [], polls: [], full: false };
  return (
    <div className="flex flex-col gap-5 text-[12.5px]">
      {data.full ? <p className="rounded-[9px] bg-subtle px-2.5 py-2 text-ink-2">You ran this meeting: hidden questions, polls that were not shared, and who asked anonymous questions are shown to you. Participants see only what the room showed them.</p> : null}
      <section className="flex flex-col gap-2" aria-label={t('act.qa')}>
        <h2 className="text-[15px] font-bold text-ink">{t('act.qa')}</h2>
        {data.questions.length ? (
          <ul className="flex flex-col gap-2">
            {data.questions.map((x) => (
              <li key={x.id} className={cx('flex flex-col gap-1 rounded-[10px] border border-line p-2.5', x.hidden && 'border-dashed opacity-75')}>
                <p className="whitespace-pre-wrap break-words text-ink selectable">{x.text}</p>
                <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                  {x.author ?? t('act.anonymous')}
                  {x.anonymous && x.author ? <Chip>{t('act.anonymous')}</Chip> : null}
                  <span>· {t('act.upvotes', { n: x.votes })}</span>
                  {x.created_at ? <span>· {dateLabel(x.created_at)}</span> : null}
                  {x.status === 'answered' ? <Chip tone="success">{t('act.answered')}</Chip> : null}
                  {x.hidden ? <Chip tone="warning">{t('act.hidden')}</Chip> : null}
                </span>
                {x.answer ? (
                  <p className="rounded-[8px] bg-subtle px-2 py-1.5 text-ink-2">
                    <b className="text-ink">{x.answered_by ? t('act.answeredBy', { name: x.answered_by }) : t('act.answered')}</b> · {x.answer}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-3">{t('act.noQuestions')}</p>
        )}
      </section>
      <section className="flex flex-col gap-2" aria-label={t('act.polls')}>
        <h2 className="text-[15px] font-bold text-ink">{t('act.polls')}</h2>
        {data.polls.length ? (
          data.polls.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
              <div className="flex items-start gap-2">
                <b className="min-w-0 flex-1 break-words text-ink">{p.question}</b>
                <Chip tone={p.status === 'live' ? 'success' : p.status === 'draft' ? 'warning' : 'muted'}>{t(p.status === 'live' ? 'act.live' : p.status === 'draft' ? 'act.draft' : 'act.closed')}</Chip>
              </div>
              <span className="text-[11.5px] text-ink-3">
                {t(p.kind === 'single' ? 'act.single' : 'act.multiple')} · {t('act.voters', { n: p.voters })} · {p.anonymous ? t('act.pollAnonymousChoice') : 'Not anonymous'}
                {data.full ? ` · ${p.shared ? t('act.resultsShared') : 'Results not shared'}` : ''}
              </span>
              <PollResults poll={p} />
            </div>
          ))
        ) : (
          <p className="text-ink-3">{t('act.noPolls')}</p>
        )}
      </section>
    </div>
  );
}
