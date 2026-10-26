import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { PageHead } from '../hr/parts';
import { eGetMeta, K, when, type LearningItem, type MyLearning as Data } from './api';
import { CourseTile, Pill, Section, Tile, WorkPill, useEl } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * My Learning (§4.3, FR-DSH-04): where to pick up, what was assigned and by
 * when, what waits for approval, the quizzes and assignments still open, what
 * was finished, and a few courses to consider — each with the server's own
 * reason. Read from the last copy when WorkSuite cannot be reached.
 */
export default function MyLearning() {
  const el = useEl();
  const q = useQuery({ queryKey: K.my, queryFn: ({ signal }) => eGetMeta<Data>('/me/learning', undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('My Learning could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data.data;
  const c = d.counters;
  const continuing = new Set(d.continue.map((x) => x.id));
  const moreInProgress = d.in_progress.filter((x) => !continuing.has(x.id));
  const resume = (x: LearningItem) => el.open.course(x.id, x.resume_lesson_id);
  const nothing = d.continue.length + d.assigned.length + d.in_progress.length + d.pending.length + d.history.length === 0;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="My Learning" sub="Your courses, what is due, and where you left off.">
        {q.data.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        <Button icon="book-open" onClick={() => el.go('catalog')}>
          Browse the catalogue
        </Button>
      </PageHead>
      <StatGrid min={190}>
        <Tile icon="clipboard-list" tone="blue" label="Assigned" value={String(c.assigned)} />
        <Tile icon="book-open" tone="violet" label="In progress" value={String(c.in_progress)} />
        <Tile icon="graduation-cap" tone="green" label="Completed" value={String(c.completed)} />
        <Tile icon="alert" tone={c.overdue ? 'red' : 'neutral'} label="Overdue" value={String(c.overdue)} />
        <Tile icon="hourglass" tone="amber" label="Waiting for approval" value={String(c.pending)} />
      </StatGrid>

      {nothing ? (
        <Section title="Nothing here yet">
          <p className="m-0 text-[13px] text-ink-2">Courses you join or are given appear here. Find one in the catalogue.</p>
        </Section>
      ) : null}

      {d.continue.length ? (
        <Section title="Continue learning">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.continue.map((x) => (
              <CourseTile key={x.id} course={x} onOpen={() => el.open.course(x.id)}>
                <Button size="sm" variant="primary" icon="play" onClick={() => resume(x)}>
                  Resume
                </Button>
              </CourseTile>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {d.deadlines.length ? (
          <Section title="Upcoming deadlines">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {d.deadlines.map((x) => (
                <li key={`${x.kind}${x.course_id}`} className="flex items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.course(x.course_id)}>
                    {x.title}
                  </button>
                  {x.is_mandatory ? <Pill tone="amber">Mandatory</Pill> : null}
                  <span className={cx('shrink-0 tabular-nums', x.overdue ? 'font-semibold text-danger' : 'text-ink-3')}>{x.overdue ? `Overdue since ${when(x.due_at)}` : `Due ${when(x.due_at)}`}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {d.assessments.length || d.assignments.length ? (
          <Section title="Quizzes and assignments">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {d.assessments.map((a) => (
                <li key={`q${a.id}`} className="flex items-center gap-2">
                  <Icon name="list-todo" size={15} className="shrink-0 text-ink-3" />
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.quiz(a.id)}>
                    {a.title} <span className="font-normal text-ink-3">· {a.course_title}</span>
                  </button>
                  {a.pending ? <Pill tone="amber">Being graded</Pill> : a.attempts_left !== null ? <span className="shrink-0 text-ink-3">{a.attempts_left} left</span> : null}
                  {a.due_at ? <span className="shrink-0 text-ink-3 tabular-nums">Due {when(a.due_at)}</span> : null}
                </li>
              ))}
              {d.assignments.map((a) => (
                <li key={`a${a.id}`} className="flex items-center gap-2">
                  <Icon name="upload" size={15} className="shrink-0 text-ink-3" />
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.task(a.id)}>
                    {a.title} <span className="font-normal text-ink-3">· {a.course_title}</span>
                  </button>
                  {a.status ? <WorkPill status={a.status} /> : null}
                  {a.due_at ? <span className="shrink-0 text-ink-3 tabular-nums">Due {when(a.due_at)}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      {d.assigned.length ? <List title="Assigned to you" items={d.assigned} onOpen={(x) => el.open.course(x.id)} /> : null}
      {moreInProgress.length ? <List title="In progress" items={moreInProgress} onOpen={(x) => el.open.course(x.id)} /> : null}
      {d.pending.length ? (
        <Section title="Waiting for approval">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.pending.map((x) => (
              <CourseTile key={x.id} course={x} onOpen={() => el.open.about(x.id)} />
            ))}
          </div>
        </Section>
      ) : null}
      {d.recommended.length ? (
        <Section title="Recommended for you">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.recommended.map((x) => (
              <CourseTile key={x.id} course={x} reason={x.reason} onOpen={() => el.open.about(x.id)} />
            ))}
          </div>
        </Section>
      ) : null}
      {d.history.length ? <List title="Completed" items={d.history} onOpen={(x) => el.open.course(x.id)} /> : null}
      <p className="m-0 text-[12px] text-ink-3">Certificates, live classes and learning paths arrive in a later phase of eLearning.</p>
    </div>
  );
}

function List({ title, items, onOpen }: { title: string; items: LearningItem[]; onOpen: (x: LearningItem) => void }) {
  return (
    <Section title={title}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((x) => (
          <CourseTile key={x.id} course={x} onOpen={() => onOpen(x)} />
        ))}
      </div>
    </Section>
  );
}
