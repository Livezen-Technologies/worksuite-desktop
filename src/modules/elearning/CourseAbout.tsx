import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { eGet, ePost, errorText, K, labelOf, LESSON_ICON, minutes, newKey, OFFLINE, type CatalogAbout } from './api';
import { Back, EnrolPill, Pill, Refusal, Rich, Section, useEl } from './parts';

/**
 * A course before joining (WF-02): what it is and holds, how it completes,
 * places left, and whether the learner can join — at once when it is open, as
 * a request when it needs approval, or the server's reason why not.
 */
export default function CourseAbout({ id }: { id: number }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.about(id), queryFn: ({ signal }) => eGet<CatalogAbout>(`/catalog/${id}`, undefined, signal) });
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  // One key per press: a second press after a dropped connection is the same request.
  const key = useRef<string | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('This course could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const c = q.data;
  const e = c.enrollment;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.about(id) });
    void qc.invalidateQueries({ queryKey: K.my });
    void qc.invalidateQueries({ queryKey: ['elearning', 'catalog'] });
  };

  const join = async () => {
    if (!el.online) return toast('error', OFFLINE);
    setBusy(true);
    setWhy(null);
    key.current ??= newKey('join');
    try {
      const r = await ePost<CatalogAbout>(`/catalog/${id}/enroll`, {}, key.current);
      key.current = null;
      qc.setQueryData(K.about(id), r.data);
      refresh();
      toast('success', r.message);
      if (r.data.enrollment && r.data.enrollment.status !== 'PENDING_APPROVAL') el.open.course(id);
    } catch (err) {
      key.current = null;
      setWhy(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const takeBack = async () => {
    if (!e) return;
    if (!el.online) return toast('error', OFFLINE);
    setBusy(true);
    try {
      const r = await ePost(`/me/enrollments/${e.id}/withdraw`, {});
      toast('success', r.message);
      refresh();
    } catch (err) {
      setWhy(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const lessons = c.outline.reduce((n, s) => n + s.lessons.length, 0);

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={() => el.go('catalog')} label="Catalogue" />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12px] font-semibold text-ink-3">{c.code}</div>
          <h1 className="m-0 text-[22px] font-bold text-ink">{c.title}</h1>
          {c.summary ? <p className="mt-1 mb-0 text-[13.5px] text-ink-2">{c.summary}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
            <Pill tone="blue">{labelOf(el.options.course_types, c.course_type)}</Pill>
            {c.category ? <span>{c.category.name}</span> : null}
            {c.level ? <span>· {c.level}</span> : null}
            {c.estimated_minutes ? <span>· {minutes(c.estimated_minutes)}</span> : null}
            <span>· {lessons} lessons</span>
            {c.instructor ? <span>· {c.instructor.name}</span> : null}
          </div>
        </div>
        <div className="flex w-[280px] shrink-0 flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
          {e ? (
            <>
              <EnrolPill status={e.status} overdue={e.overdue} />
              {e.status === 'PENDING_APPROVAL' ? (
                <>
                  <p className="m-0 text-[12.5px] text-ink-2">Your request to join is waiting for approval.</p>
                  <Button variant="ghost" loading={busy} disabled={!el.online} onClick={() => void takeBack()}>
                    Take the request back
                  </Button>
                </>
              ) : (
                <Button variant="primary" icon="play" onClick={() => el.open.course(id)}>
                  Open the course
                </Button>
              )}
            </>
          ) : c.can_enroll ? (
            <>
              <p className="m-0 text-[12.5px] text-ink-2">{c.requires_approval ? 'Joining needs approval: your request goes to your manager.' : 'Open to join — you can start at once.'}</p>
              <Button variant="primary" icon={c.requires_approval ? 'send' : 'plus'} loading={busy} disabled={!el.online} onClick={() => void join()}>
                {c.requires_approval ? 'Ask to join' : 'Join the course'}
              </Button>
            </>
          ) : (
            <Refusal text={c.why_not ?? 'This course cannot be joined from the catalogue.'} />
          )}
          {c.places_left !== null ? <p className="m-0 text-[12px] text-ink-3">{c.places_left} of {c.capacity} places left</p> : null}
          {why ? <Refusal text={why} /> : null}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {c.description ? (
            <Section title="About this course">
              <Rich html={c.description} />
            </Section>
          ) : null}
          {c.objectives?.length ? (
            <Section title="What you will learn">
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink">
                {c.objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title="Outline">
            {c.outline.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">No lessons yet.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {c.outline.map((s) => (
                  <li key={s.id}>
                    <b className="text-[13px] text-ink">{s.title}</b>
                    <ul className="mt-1 mb-0 flex list-none flex-col gap-1 p-0">
                      {s.lessons.map((l) => (
                        <li key={l.id} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                          <Icon name={LESSON_ICON[l.lesson_type] ?? 'file'} size={14} className="shrink-0 text-ink-3" />
                          <span className="min-w-0 flex-1 truncate">{l.title}</span>
                          {!l.is_mandatory ? <span className="text-ink-3">Optional</span> : null}
                          {l.duration_min ? <span className="text-ink-3 tabular-nums">{minutes(l.duration_min)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
        <Section title="To complete it">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink-2">
            {c.completion.map((x, i) => (
              <li key={i}>{x.label}</li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
