import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FileViewer } from '../../../components/FileViewer';
import { Icon } from '../../../components/Icon';
import { ErrorNote, Modal, Spinner } from '../../../components/ui';
import { apiUrl } from '../../../core/api';
import { eGet, K, LESSON_ICON, minutes, type Course, type LearnerLesson, type Section } from '../api';
import { Refusal, Rich } from '../parts';

/**
 * Preview as a learner (§5.3): what a learner would see — published, not
 * hidden — with the same signed addresses, and nothing recorded.
 */
export default function Preview({ course }: { course: Course }) {
  const q = useQuery({ queryKey: K.preview(course.id), queryFn: ({ signal }) => eGet<{ preview: true; sections: Array<Section<LearnerLesson>> }>(`/courses/${course.id}/preview`, undefined, signal) });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The preview could not be loaded.')} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex max-w-[860px] flex-col gap-3">
      <Refusal text="Nothing you do here is recorded. Hidden and unpublished lessons are left out, as learners see it." />
      {q.data.sections.map((s) => (
        <section key={s.id} className="rounded-[12px] border border-line bg-surface p-3">
          <b className="text-[13.5px] text-ink">{s.title}</b>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0">
            {s.lessons.map((l) => (
              <li key={l.id}>
                <button type="button" className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={() => setOpen(l.id)}>
                  <Icon name={LESSON_ICON[l.lesson_type] ?? 'file'} size={15} className="text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-ink">{l.title}</span>
                  <span className="text-[12px] text-ink-3">{[l.rule_label, l.duration_min ? minutes(l.duration_min) : null].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open ? <LessonPreview id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** One lesson as a learner would see it, in a dialog. */
export function LessonPreview({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: K.previewLesson(id), queryFn: ({ signal }) => eGet<{ preview: true; lesson: LearnerLesson }>(`/lessons/${id}/preview`, undefined, signal) });
  const l = q.data?.lesson;
  return (
    <Modal title={l ? `Preview · ${l.title}` : 'Preview'} onClose={onClose} width={920}>
      {q.isLoading ? <Spinner /> : q.error || !l ? <ErrorNote error={q.error ?? new Error('The lesson could not be previewed.')} /> : <Content l={l} />}
    </Modal>
  );
}

function Content({ l }: { l: LearnerLesson }) {
  const f = l.file;
  if (f && f.status !== 'ready') return <Refusal text={f.message ?? (f.status === 'processing' ? 'Drive is still preparing this file.' : `The file is ${f.status}.`)} />;
  switch (l.lesson_type) {
    case 'VIDEO':
      return f?.urls.source ? <video src={apiUrl(f.urls.source)} poster={f.urls.poster ? apiUrl(f.urls.poster) : undefined} controls className="max-h-[60vh] w-full rounded-[10px] bg-black" aria-label="Lesson video" /> : <Refusal text="No playable version yet." />;
    case 'AUDIO':
      return f?.urls.source ? <audio src={apiUrl(f.urls.source)} controls className="w-full" aria-label="Lesson audio" /> : <Refusal text="No playable version yet." />;
    case 'ARTICLE':
      return <Rich html={l.body ?? ''} />;
    case 'LINK':
      return <p className="m-0 text-[13px] break-all text-ink">{l.url}</p>;
    case 'QUIZ':
      return <p className="m-0 text-[13px] text-ink-2">{l.assessment ? `${l.assessment.title}: ${l.assessment.questions} questions, pass mark ${l.assessment.pass_mark}%.` : 'A quiz.'}</p>;
    case 'ASSIGNMENT':
      return <p className="m-0 text-[13px] text-ink-2">{l.assignment ? l.assignment.title : 'An assignment.'}</p>;
    default:
      return f?.urls.view ? (
        <div className="h-[60vh]">
          <FileViewer path={f.urls.view} name={f.name} />
        </div>
      ) : (
        <Refusal text="Nothing to show." />
      );
  }
}
