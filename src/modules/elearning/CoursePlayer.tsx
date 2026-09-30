import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { OfflineCourse } from '@shared/elearning-offline';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, OfflineNote, Spinner, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { eGetMeta, ePost, errorText, K, LESSON_ICON, minutes, OFFLINE, pct, when, type Taking, type TakingLesson } from './api';
import { Lesson } from './Lesson';
import { useOfflineCourses } from './offline';
import { area, Back, Bar, EnrolPill, Field, Pill, Refusal, Rich, useEl } from './parts';
import { SidePanel } from '../../components/SidePanel';

/**
 * Taking a course (WF-02 steps 4–6, FR-DSH-04): the outline with each lesson's
 * progress and why a locked one is locked, the completion rule as a
 * checklist, the resume point, and the lesson itself beside it. The course
 * can be kept offline here, opened in a window of its own, and — where the
 * server allows — left.
 */
export default function CoursePlayer({ id, lesson }: { id: number; lesson: number | null }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.taking(id), queryFn: ({ signal }) => eGetMeta<Taking>(`/me/courses/${id}`, undefined, signal) });
  const offline = useOfflineCourses();
  const [leaving, setLeaving] = useState(false);
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: K.taking(id) });
    void qc.invalidateQueries({ queryKey: K.my });
  }, [qc, id]);
  const go = useCallback((l: number) => el.open.course(id, l), [el.open, id]);

  if (q.isLoading) return <Spinner label="Opening the course…" />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Back onClick={() => el.go('my')} label="My Learning" />
        <ErrorNote error={q.error ?? new Error('This course could not be opened.')} onRetry={() => void q.refetch()} />
        <Button className="self-start" onClick={() => el.open.about(id)}>
          See the course in the catalogue
        </Button>
      </div>
    );
  }
  const t = q.data.data;
  const all = t.sections.flatMap((s) => s.lessons);
  const card = lesson ? (all.find((l) => l.id === lesson) ?? null) : null;
  const kept = offline.list.find((c) => c.courseId === id) ?? null;
  const e = t.enrollment;
  const mayLeave = !e.is_mandatory && e.enrollment_type === 'SELF' && !['COMPLETED', 'WITHDRAWN'].includes(e.status);

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="elearning-outline" label="the course outline">
        <aside aria-label="Course outline" className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-line bg-surface">
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
            <Back onClick={() => el.go('my')} label="My Learning" />
            <button type="button" className="text-left" onClick={() => el.open.course(id)}>
              <div className="font-mono text-[11px] font-semibold text-ink-3">{t.course.code}</div>
              <b className="line-clamp-2 text-[14.5px] text-ink hover:text-primary">{t.course.title}</b>
            </button>
            <div className="flex items-center gap-2">
              <EnrolPill status={e.status} overdue={e.overdue} />
              <span className="flex-1" />
              <span className="text-[12px] text-ink-3 tabular-nums">{pct(t.progress_percent)}</span>
            </div>
            <Bar value={t.progress_percent} label="Course progress" />
            <span className="text-[11.5px] text-ink-3">
              {t.lessons_done} of {t.lessons_total} lessons{e.due_at ? ` · due ${when(e.due_at)}` : ''}
            </span>
          </div>
          <ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto p-3 scroll-thin">
            {t.sections.map((s) => (
              <li key={s.id}>
                <div className="px-1 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{s.title}</div>
                <ul className="m-0 flex list-none flex-col gap-px p-0">
                  {s.lessons.map((l) => (
                    <li key={l.id}>
                      <OutlineRow l={l} on={lesson === l.id} onOpen={() => go(l.id)} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </aside>
      </SidePanel>
      <section className="flex min-w-0 flex-1 flex-col">
        {q.data.offline ? (
          <div className="border-b border-line bg-surface px-5 py-1.5">
            <OfflineNote cachedAt={q.data.cachedAt} />
          </div>
        ) : null}
        {lesson ? (
          <Lesson key={lesson} courseId={id} id={lesson} card={card} onGo={go} onChanged={refresh} />
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 min-w-0 flex-1 text-[20px] font-bold text-ink">{t.course.title}</h1>
              <Button icon="app-window" onClick={() => el.openWindow(el.route({ course: id, lesson: t.resume?.lesson_id }), t.course.title)} title="Take the course in a window of its own, beside your work">
                Open in a window
              </Button>
              {mayLeave ? (
                <Button variant="ghost" disabled={!el.online} onClick={() => setLeaving(true)}>
                  Leave the course
                </Button>
              ) : null}
            </div>
            {t.resume ? (
              <div className="flex items-center gap-3 rounded-[12px] border border-primary/40 bg-selection p-4">
                <Icon name="play" size={18} className="text-primary" />
                <div className="min-w-0 flex-1">
                  <b className="block text-[13.5px] text-ink">{e.status === 'ENROLLED' ? 'Start with' : 'Pick up where you left off'}</b>
                  <span className="text-[12.5px] text-ink-2">{t.resume.title}</span>
                </div>
                <Button variant="primary" onClick={() => go(t.resume!.lesson_id)}>
                  {e.status === 'ENROLLED' ? 'Start' : 'Resume'}
                </Button>
              </div>
            ) : e.status === 'COMPLETED' ? (
              <div className="rounded-[12px] border border-success/40 bg-success-bg p-4 text-[13px] text-success">
                Completed {when(e.completed_at)}
                {e.final_score !== null ? ` · final score ${pct(e.final_score)}` : ''}.
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[12px] border border-line bg-surface p-4">
                <h2 className="m-0 mb-2 text-[13.5px] font-bold text-ink">To complete the course</h2>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                  {t.completion.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Icon name={c.met ? 'check-circle' : 'minus'} size={16} className={cx('mt-0.5 shrink-0', c.met ? 'text-success' : 'text-ink-3')} />
                      <span className={c.met ? 'text-ink-2' : 'text-ink'}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <KeepOffline courseId={id} title={t.course.title} allowed={t.offline} version={t.course.version} kept={kept} />
            </div>
            {t.course.description ? (
              <div className="rounded-[12px] border border-line bg-surface p-4">
                <Rich html={t.course.description} />
              </div>
            ) : null}
          </div>
        )}
      </section>
      {leaving ? <Leave enrollmentId={e.id} title={t.course.title} onClose={() => setLeaving(false)} onDone={() => { setLeaving(false); refresh(); el.go('my'); }} /> : null}
    </div>
  );
}

function OutlineRow({ l, on, onOpen }: { l: TakingLesson; on: boolean; onOpen: () => void }) {
  const done = l.progress.status === 'COMPLETED';
  const started = l.progress.status === 'IN_PROGRESS';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={on ? 'page' : undefined}
      title={l.locked ? (l.locked_because ?? 'Locked') : undefined}
      className={cx('flex w-full items-start gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px]', on ? 'bg-selection font-semibold text-primary' : 'text-ink hover:bg-subtle', l.locked && 'opacity-70')}
    >
      <Icon name={l.locked ? 'lock' : done ? 'check-circle' : LESSON_ICON[l.lesson_type] ?? 'file'} size={15} className={cx('mt-0.5 shrink-0', done ? 'text-success' : started ? 'text-primary' : 'text-ink-3')} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2">{l.title}</span>
        <span className="block text-[11px] font-normal text-ink-3">
          {l.locked ? l.locked_because : [l.duration_min ? minutes(l.duration_min) : null, !l.is_mandatory ? 'optional' : null, started && l.progress.percent > 0 ? `${Math.round(l.progress.percent)}%` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );
}

/**
 * The course kept on this computer: its lesson files, through the download
 * manager, encrypted, played here. The server decides what may be kept and
 * when it must go.
 */
function KeepOffline({ courseId, title, allowed, version, kept }: { courseId: number; title: string; allowed: boolean; version: number; kept: OfflineCourse | null }) {
  const el = useEl();
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const take = async () => {
    if (!el.online) return toast('error', OFFLINE);
    setBusy(true);
    setWhy(null);
    try {
      const c = await call('elearning:offlineDownload', { courseId, title });
      toast('success', c.files.length ? `Keeping ${c.files.length} lesson files offline — see Transfers.` : 'This course has no lesson files to keep offline.');
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const drop = async () => {
    setBusy(true);
    try {
      await call('elearning:offlineRemove', { courseId });
      toast('success', 'The offline copy was removed.');
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const done = kept?.files.filter((f) => f.state === 'done').length ?? 0;
  const got = kept?.files.reduce((n, f) => n + (f.state === 'done' ? f.bytes : f.kept), 0) ?? 0;
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
      <h2 className="m-0 text-[13.5px] font-bold text-ink">Offline</h2>
      {!allowed && !kept ? (
        <p className="m-0 text-[12.5px] text-ink-3">Your company does not keep courses offline.</p>
      ) : kept ? (
        <>
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Pill tone={kept.state === 'ready' ? 'green' : kept.state === 'downloading' ? 'blue' : 'amber'}>{kept.state === 'ready' ? 'Kept offline' : kept.state === 'downloading' ? 'Downloading' : 'Incomplete'}</Pill>
            <span className="tabular-nums">
              {done} of {kept.files.length} files · {bytes(got)} of {bytes(kept.totalBytes)}
            </span>
          </div>
          {kept.state === 'downloading' ? <Bar value={kept.totalBytes ? (got / kept.totalBytes) * 100 : 0} label="Offline copy" /> : null}
          <p className="m-0 text-[12px] text-ink-3">
            Kept {when(kept.downloadedAt, true)}
            {kept.expiresAt ? ` · until ${when(kept.expiresAt)}` : ''}. Played only inside WorkSuite.
          </p>
          {kept.version !== version ? <Refusal text="The course has changed since it was kept. Update the copy." /> : null}
          <div className="flex flex-wrap gap-2">
            {kept.state !== 'downloading' ? (
              <Button size="sm" icon="refresh" loading={busy} disabled={!el.online || !allowed} onClick={() => void take()}>
                {kept.state === 'ready' ? 'Update' : 'Download again'}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="trash" disabled={busy} onClick={() => void drop()}>
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[12.5px] text-ink-3">Keep this course’s videos and documents on this computer to learn without WorkSuite. They are encrypted and play only here.</p>
          <Button size="sm" icon="download" className="self-start" loading={busy} disabled={!el.online} onClick={() => void take()}>
            Keep offline
          </Button>
        </>
      )}
      {why ? <Refusal text={why} /> : null}
    </div>
  );
}

function Leave({ enrollmentId, title, onClose, onDone }: { enrollmentId: number; title: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const leave = async () => {
    setBusy(true);
    try {
      const r = await ePost(`/me/enrollments/${enrollmentId}/withdraw`, reason.trim() ? { reason: reason.trim() } : {});
      toast('success', r.message);
      onDone();
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Leave ${title}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Stay</Button>
          <Button variant="danger" loading={busy} onClick={() => void leave()}>
            Leave the course
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">Your progress is kept in the course’s history, but the course leaves My Learning.</p>
        <Field label="Why (optional)">
          <textarea className={area} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}
