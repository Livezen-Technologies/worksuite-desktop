import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { DriveFilePicker } from '../../../components/DriveFilePicker';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, Switch, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, LESSON_ICON, minutes, refusalCode, toLocalInput, toUtc, type AssessmentCard, type AssignmentCard, type Course, type Section as Sec, type StaffLesson, type Structure } from '../api';
import { area, Field, input, Pill, Refusal, RichField, useEl } from '../parts';
import { LessonPreview } from './Preview';

const FILE_TYPES = new Set(['VIDEO', 'AUDIO', 'PDF', 'OFFICE_DOC', 'PRESENTATION', 'IMAGE']);
const MEDIA_TONE: Record<string, 'green' | 'amber' | 'red' | 'grey'> = { ready: 'green', processing: 'amber', failed: 'red', quarantined: 'red', missing: 'red' };

/** The order the builder sends: every section and lesson of the course once. */
export function arrangement(sections: Sec[]): Array<{ id: number; lessons: number[] }> {
  return sections.map((s) => ({ id: s.id, lessons: s.lessons.map((l) => l.id) }));
}

/** A lesson moved before another (or to the end of a section): the sections as they would stand. */
export function moveLesson(sections: Sec[], lessonId: number, toSection: number, before: number | null): Sec[] {
  const lesson = sections.flatMap((s) => s.lessons).find((l) => l.id === lessonId);
  if (!lesson || before === lessonId) return sections;
  const out = sections.map((s) => ({ ...s, lessons: s.lessons.filter((l) => l.id !== lessonId) }));
  const target = out.find((s) => s.id === toSection);
  if (!target) return sections;
  const i = before === null ? -1 : target.lessons.findIndex((l) => l.id === before);
  if (i < 0) target.lessons.push({ ...lesson, section_id: toSection });
  else target.lessons.splice(i, 0, { ...lesson, section_id: toSection });
  return out;
}

/**
 * The course builder (§5.3, FR-BLD-01..05): sections and lessons, arranged by
 * dragging or with the arrow buttons — every change sent with the revision
 * it was made on, so two editors never overwrite each other — and each
 * lesson edited with its type's content and completion rule.
 */
export default function Builder({ course }: { course: Course }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.structure(course.id), queryFn: ({ signal }) => eGet<Structure>(`/courses/${course.id}/structure`, undefined, signal) });
  const [lesson, setLesson] = useState<{ section: number; lesson: StaffLesson | null } | null>(null);
  const [section, setSection] = useState<Sec | 'new' | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const may = course.can.edit && el.online;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.structure(course.id) });
    void qc.invalidateQueries({ queryKey: K.course(course.id) });
  };
  const arrange = async (sections: Sec[]) => {
    if (!q.data) return;
    const before = q.data;
    qc.setQueryData(K.structure(course.id), { ...before, sections });
    setBusy(true);
    try {
      const r = await ePost<{ revision: number; sections: Sec[] }>(`/courses/${course.id}/structure`, { sections: arrangement(sections), revision: before.revision });
      qc.setQueryData(K.structure(course.id), { course_id: course.id, revision: r.data.revision, sections: r.data.sections });
      void qc.invalidateQueries({ queryKey: K.course(course.id) });
    } catch (e) {
      qc.setQueryData(K.structure(course.id), before);
      if (refusalCode(e) === 'revision_conflict') setStale(errorText(e));
      else toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (path: string, body: object = {}) => {
    setBusy(true);
    try {
      const r = await ePost(path, body);
      toast('success', r.message);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The outline could not be loaded.')} onRetry={() => void q.refetch()} />;
  const sections = q.data.sections;
  const all = sections.flatMap((s) => s.lessons);
  const moveSection = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void arrange(next);
  };
  const nudge = (s: Sec, l: StaffLesson, d: -1 | 1) => {
    const i = s.lessons.findIndex((x) => x.id === l.id);
    const si = sections.findIndex((x) => x.id === s.id);
    if (d === -1 && i > 0) return void arrange(moveLesson(sections, l.id, s.id, s.lessons[i - 1]!.id));
    if (d === 1 && i < s.lessons.length - 1) return void arrange(moveLesson(sections, l.id, s.id, s.lessons[i + 2]?.id ?? null));
    // Past the end of its section: into the next (or previous) one.
    const other = sections[si + d];
    if (other) void arrange(moveLesson(sections, l.id, other.id, d === 1 ? (other.lessons[0]?.id ?? null) : null));
  };
  const drop = (e: DragEvent, toSection: number, before: number | null) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/x-elearning-lesson'));
    setDragging(null);
    if (id && may) void arrange(moveLesson(sections, id, toSection, before));
  };

  return (
    <div className="flex max-w-[1000px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 min-w-0 flex-1 text-[12.5px] text-ink-3">
          {all.length} lessons in {sections.length} sections · revision {q.data.revision}
          {may ? ' · drag a lesson to move it, or use its arrows' : ''}
        </p>
        {may ? (
          <Button icon="plus" onClick={() => setSection('new')}>
            Add a section
          </Button>
        ) : null}
      </div>
      {stale ? (
        <Refusal text={stale}>
          <button type="button" className="font-semibold underline" onClick={() => (setStale(null), refresh())}>
            Load the latest
          </button>
        </Refusal>
      ) : null}
      {sections.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No sections yet. A course needs at least one visible lesson before it can be reviewed.</p> : null}
      {sections.map((s, si) => (
        <section key={s.id} className={cx('rounded-[12px] border bg-surface', dragging ? 'border-dashed border-primary/60' : 'border-line')} onDragOver={(e) => may && e.preventDefault()} onDrop={(e) => drop(e, s.id, null)}>
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <b className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{s.title}</b>
            {!s.is_published ? <Pill tone="grey">Unpublished</Pill> : null}
            {s.is_hidden ? <Pill tone="grey">Hidden</Pill> : null}
            {may ? (
              <span className="flex items-center gap-0.5">
                <button type="button" aria-label={`Move section ${s.title} up`} disabled={busy || si === 0} onClick={() => moveSection(si, -1)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle disabled:opacity-30">
                  <Icon name="arrow-up" size={14} />
                </button>
                <button type="button" aria-label={`Move section ${s.title} down`} disabled={busy || si === sections.length - 1} onClick={() => moveSection(si, 1)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle disabled:opacity-30">
                  <Icon name="arrow-down" size={14} />
                </button>
                <Button size="sm" variant="ghost" onClick={() => setSection(s)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/sections/${s.id}/duplicate`)}>
                  Duplicate
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/sections/${s.id}/delete`)}>
                  Delete
                </Button>
                <Button size="sm" icon="plus" onClick={() => setLesson({ section: s.id, lesson: null })}>
                  Lesson
                </Button>
              </span>
            ) : null}
          </header>
          <ol className="m-0 flex list-none flex-col p-1.5">
            {s.lessons.length === 0 ? <li className="px-2 py-2 text-[12.5px] text-ink-3">No lessons. {may ? 'Drop one here, or add one.' : ''}</li> : null}
            {s.lessons.map((l) => (
              <li
                key={l.id}
                draggable={may}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/x-elearning-lesson', String(l.id));
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(l.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => may && e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  drop(e, s.id, l.id);
                }}
                className={cx('flex flex-wrap items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-subtle', dragging === l.id && 'opacity-40', may && 'cursor-grab')}
              >
                <Icon name={LESSON_ICON[l.lesson_type] ?? 'file'} size={15} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{l.title}</span>
                  <span className="block text-[11.5px] text-ink-3">
                    {[el.options.lesson_types.find((t) => t.value === l.lesson_type)?.label ?? l.lesson_type, l.rule_label, l.is_mandatory ? null : 'optional', l.duration_min ? minutes(l.duration_min) : null, l.release_at ? 'released later' : null, l.prerequisite_lesson_id ? 'after another lesson' : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {l.media ? <Pill tone={MEDIA_TONE[l.media.status] ?? 'grey'}>{l.media.status === 'processing' ? 'Preparing' : l.media.status.charAt(0).toUpperCase() + l.media.status.slice(1)}</Pill> : null}
                {!l.is_published ? <Pill tone="grey">Unpublished</Pill> : null}
                {l.is_hidden ? <Pill tone="grey">Hidden</Pill> : null}
                <Button size="sm" variant="ghost" icon="eye" onClick={() => setPreview(l.id)}>
                  Preview
                </Button>
                {may ? (
                  <span className="flex items-center gap-0.5">
                    <button type="button" aria-label={`Move ${l.title} up`} disabled={busy} onClick={() => nudge(s, l, -1)} className="rounded-[6px] p-1 text-ink-3 hover:bg-surface">
                      <Icon name="arrow-up" size={14} />
                    </button>
                    <button type="button" aria-label={`Move ${l.title} down`} disabled={busy} onClick={() => nudge(s, l, 1)} className="rounded-[6px] p-1 text-ink-3 hover:bg-surface">
                      <Icon name="arrow-down" size={14} />
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => setLesson({ section: s.id, lesson: l })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/lessons/${l.id}/duplicate`)}>
                      Duplicate
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/lessons/${l.id}/delete`)}>
                      Delete
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {section ? <SectionForm course={course} section={section === 'new' ? null : section} onClose={() => setSection(null)} onSaved={() => (setSection(null), refresh())} /> : null}
      {lesson ? <LessonForm course={course} sectionId={lesson.section} lesson={lesson.lesson} sections={sections} onClose={() => setLesson(null)} onSaved={() => (setLesson(null), refresh())} /> : null}
      {preview ? <LessonPreview id={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function SectionForm({ course, section, onClose, onSaved }: { course: Course; section: Sec | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(section?.title ?? '');
  const [description, setDescription] = useState(section?.description ?? '');
  const [published, setPublished] = useState(section?.is_published ?? true);
  const [hidden, setHidden] = useState(section?.is_hidden ?? false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const body = { title: title.trim(), description: description.trim() || null };
      const r = section ? await ePost(`/sections/${section.id}`, { ...body, is_published: published, is_hidden: hidden }) : await ePost(`/courses/${course.id}/sections`, body);
      toast('success', r.message);
      onSaved();
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={section ? `Edit ${section.title}` : 'Add a section'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Description (optional)">
          <textarea className={area} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        {section ? (
          <div className="flex flex-wrap gap-4 text-[13px] text-ink-2">
            <label className="flex items-center gap-2">
              <Switch checked={published} onChange={setPublished} label="Published" /> Published
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={hidden} onChange={setHidden} label="Hidden" /> Hidden from learners
            </label>
          </div>
        ) : null}
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}

/** A lesson's fields, as its type takes them (the server checks the file, the rule and the loop of prerequisites). */
function LessonForm({ course, sectionId, lesson, sections, onClose, onSaved }: { course: Course; sectionId: number; lesson: StaffLesson | null; sections: Sec[]; onClose: () => void; onSaved: () => void }) {
  const el = useEl();
  const o = el.options;
  const full = useQuery({ queryKey: K.staffLesson(lesson?.id ?? 0), queryFn: ({ signal }) => eGet<StaffLesson>(`/lessons/${lesson!.id}`, undefined, signal), enabled: !!lesson });
  const assessments = useQuery({ queryKey: K.assessments(course.id), queryFn: ({ signal }) => eGet<{ items: AssessmentCard[] }>(`/courses/${course.id}/assessments`, undefined, signal) });
  const assignments = useQuery({ queryKey: K.assignments(course.id), queryFn: ({ signal }) => eGet<{ items: AssignmentCard[] }>(`/courses/${course.id}/assignments`, undefined, signal) });
  if (lesson && full.isLoading) return null;
  return <LessonFields key={full.data?.id ?? 'new'} course={course} sectionId={sectionId} lesson={full.data ?? lesson} sections={sections} assessments={assessments.data?.items ?? []} assignments={assignments.data?.items ?? []} types={o.lesson_types} rules={o.completion_rules} onClose={onClose} onSaved={onSaved} />;
}

function LessonFields({ course, sectionId, lesson, sections, assessments, assignments, types, rules, onClose, onSaved }: {
  course: Course;
  sectionId: number;
  lesson: StaffLesson | null;
  sections: Sec[];
  assessments: AssessmentCard[];
  assignments: AssignmentCard[];
  types: Array<{ value: string; label?: string; rules?: string[]; default_rule?: string; available?: boolean; why?: string }>;
  rules: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState(lesson?.lesson_type ?? 'VIDEO');
  const typeInfo = types.find((t) => t.value === type);
  const [f, setF] = useState({
    section_id: String(lesson?.section_id ?? sectionId),
    title: lesson?.title ?? '',
    completion_rule: lesson?.completion_rule ?? typeInfo?.default_rule ?? '',
    min_seconds: String((lesson?.rule_settings as { min_seconds?: number } | null)?.min_seconds ?? ''),
    pages_pct: String((lesson?.rule_settings as { pages_pct?: number } | null)?.pages_pct ?? ''),
    rule_assessment: String((lesson?.rule_settings as { assessment_id?: number } | null)?.assessment_id ?? ''),
    body: lesson?.body ?? '',
    url: lesson?.url ?? '',
    assessment_id: lesson?.assessment_id ? String(lesson.assessment_id) : '',
    assignment_id: lesson?.assignment_id ? String(lesson.assignment_id) : '',
    is_mandatory: lesson?.is_mandatory ?? true,
    duration_min: lesson?.duration_min ? String(lesson.duration_min) : '',
    page_count: lesson?.page_count ? String(lesson.page_count) : '',
    media_seconds: lesson?.media_seconds ? String(lesson.media_seconds) : '',
    release_at: toLocalInput(lesson?.release_at),
    prerequisite_lesson_id: lesson?.prerequisite_lesson_id ? String(lesson.prerequisite_lesson_id) : '',
    allow_download: lesson?.allow_download ?? false,
    is_published: lesson?.is_published ?? true,
    is_hidden: lesson?.is_hidden ?? false,
  });
  const [file, setFile] = useState<{ id: number; name: string } | null>(lesson?.file_id ? { id: lesson.file_id, name: `Drive file ${lesson.file_id}` } : null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const allowedRules = typeInfo?.rules ?? [];
  const others = sections.flatMap((s) => s.lessons).filter((l) => l.id !== lesson?.id);

  const save = async () => {
    setBusy(true);
    setWhy(null);
    const rs: Record<string, number> = {};
    if (f.completion_rule === 'SCROLL' && f.min_seconds) rs.min_seconds = Number(f.min_seconds);
    if (f.completion_rule === 'PAGES' && f.pages_pct) rs.pages_pct = Number(f.pages_pct);
    if (f.completion_rule === 'PASS_QUIZ' && f.rule_assessment) rs.assessment_id = Number(f.rule_assessment);
    const body: Record<string, unknown> = {
      section_id: Number(f.section_id),
      lesson_type: type,
      title: f.title.trim(),
      completion_rule: f.completion_rule || undefined,
      rule_settings: Object.keys(rs).length ? rs : null,
      is_mandatory: f.is_mandatory,
      duration_min: n(f.duration_min),
      release_at: f.release_at ? toUtc(f.release_at) : null,
      prerequisite_lesson_id: n(f.prerequisite_lesson_id),
      allow_download: f.allow_download,
      is_published: f.is_published,
      is_hidden: f.is_hidden,
    };
    if (type === 'ARTICLE') body.body = f.body;
    if (type === 'LINK') body.url = f.url.trim();
    if (type === 'QUIZ') body.assessment_id = n(f.assessment_id);
    if (type === 'ASSIGNMENT') body.assignment_id = n(f.assignment_id);
    if (FILE_TYPES.has(type)) {
      body.file_id = file?.id ?? null;
      body.page_count = n(f.page_count);
      if (type === 'VIDEO' || type === 'AUDIO') body.media_seconds = n(f.media_seconds);
    }
    try {
      const r = lesson ? await ePost(`/lessons/${lesson.id}`, body) : await ePost(`/courses/${course.id}/lessons`, body);
      toast('success', r.message);
      onSaved();
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={lesson ? `Edit ${lesson.title}` : 'Add a lesson'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Type" hint={types.filter((t) => t.available === false).map((t) => t.why).filter(Boolean).join(' ')}>
          <Select
            aria-label="Lesson type"
            value={type}
            onChange={(e) => {
              const t = types.find((x) => x.value === e.target.value);
              setType(e.target.value);
              set('completion_rule')(t?.default_rule ?? '');
            }}
            options={types.filter((t) => t.available !== false).map((t) => ({ value: t.value, label: t.label ?? t.value }))}
            className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]"
          />
        </Field>
        <Field label="Section">
          <Select aria-label="Section" value={f.section_id} onChange={(e) => set('section_id')(e.target.value)} options={sections.map((s) => ({ value: String(s.id), label: s.title }))} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <Field label="Title" className="md:col-span-2">
          <input className={input} value={f.title} onChange={(e) => set('title')(e.target.value)} maxLength={200} autoFocus />
        </Field>

        {FILE_TYPES.has(type) ? (
          <div className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[12.5px] font-semibold text-ink-2">File from Drive</span>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{file ? file.name : 'None chosen'}</span>
              {lesson?.media ? <Pill tone={MEDIA_TONE[lesson.media.status] ?? 'grey'}>{lesson.media.status}</Pill> : null}
              <Button size="sm" icon="folder" onClick={() => setPicking(true)}>
                {file ? 'Change' : 'Choose'}
              </Button>
            </div>
            <span className="text-[12px] text-ink-3">A file you can open in Drive. Video is prepared by Drive after it is attached; the course publishes once it is ready (or the lesson is hidden).</span>
          </div>
        ) : null}
        {type === 'ARTICLE' ? (
          <div className="md:col-span-2">
            <span className="mb-1 block text-[12.5px] font-semibold text-ink-2">Text</span>
            <RichField initial={lesson?.body ?? ''} label="Article text" minHeight={200} onChange={(h) => set('body')(h)} />
          </div>
        ) : null}
        {type === 'LINK' ? (
          <Field label="Address" className="md:col-span-2">
            <input className={input} placeholder="https://" value={f.url} onChange={(e) => set('url')(e.target.value)} maxLength={2000} />
          </Field>
        ) : null}
        {type === 'QUIZ' ? (
          <Field label="Assessment" hint={assessments.length ? undefined : 'Make an assessment in the Assessments tab first.'}>
            <Select aria-label="Assessment" value={f.assessment_id} onChange={(e) => set('assessment_id')(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...assessments.map((a) => ({ value: String(a.id), label: a.title }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
        ) : null}
        {type === 'ASSIGNMENT' ? (
          <Field label="Assignment" hint={assignments.length ? undefined : 'Make an assignment in the Assignments tab first.'}>
            <Select aria-label="Assignment" value={f.assignment_id} onChange={(e) => set('assignment_id')(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...assignments.map((a) => ({ value: String(a.id), label: a.title }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
        ) : null}

        <Field label="Completes by">
          <Select aria-label="Completion rule" value={f.completion_rule} onChange={(e) => set('completion_rule')(e.target.value)} options={allowedRules.map((r) => ({ value: r, label: rules.find((x) => x.value === r)?.label ?? r }))} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        {f.completion_rule === 'SCROLL' ? (
          <Field label="And at least (seconds)">
            <input type="number" min={0} className={`${input} max-w-[160px]`} value={f.min_seconds} onChange={(e) => set('min_seconds')(e.target.value)} />
          </Field>
        ) : null}
        {f.completion_rule === 'PAGES' ? (
          <Field label="Pages to view (%)">
            <input type="number" min={1} max={100} className={`${input} max-w-[160px]`} value={f.pages_pct} onChange={(e) => set('pages_pct')(e.target.value)} />
          </Field>
        ) : null}
        {f.completion_rule === 'PASS_QUIZ' ? (
          <Field label="The quiz to pass">
            <Select aria-label="Quiz to pass" value={f.rule_assessment} onChange={(e) => set('rule_assessment')(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...assessments.map((a) => ({ value: String(a.id), label: a.title }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
        ) : null}
        {FILE_TYPES.has(type) && type !== 'IMAGE' && type !== 'VIDEO' && type !== 'AUDIO' ? (
          <Field label="Pages" hint="Needed to count pages viewed.">
            <input type="number" min={1} className={`${input} max-w-[160px]`} value={f.page_count} onChange={(e) => set('page_count')(e.target.value)} />
          </Field>
        ) : null}
        {type === 'VIDEO' || type === 'AUDIO' ? (
          <Field label="Length in seconds" hint="Only when Drive cannot read it.">
            <input type="number" min={1} className={`${input} max-w-[160px]`} value={f.media_seconds} onChange={(e) => set('media_seconds')(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Minutes to take it">
          <input type="number" min={0} className={`${input} max-w-[160px]`} value={f.duration_min} onChange={(e) => set('duration_min')(e.target.value)} />
        </Field>
        <Field label="Opens on (optional)">
          <input type="datetime-local" className={input} value={f.release_at} onChange={(e) => set('release_at')(e.target.value)} />
        </Field>
        <Field label="After finishing (optional)">
          <Select aria-label="Prerequisite lesson" value={f.prerequisite_lesson_id} onChange={(e) => set('prerequisite_lesson_id')(e.target.value)} options={[{ value: '', label: 'No lesson first' }, ...others.map((l) => ({ value: String(l.id), label: l.title }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <div className="flex flex-col gap-2 text-[13px] text-ink-2 md:col-span-2">
          <label className="flex items-center gap-2">
            <Switch checked={f.is_mandatory} onChange={(v) => set('is_mandatory')(v)} label="Mandatory" /> Mandatory
          </label>
          {FILE_TYPES.has(type) ? (
            <label className="flex items-center gap-2">
              <Switch checked={f.allow_download} onChange={(v) => set('allow_download')(v)} label="Allow downloading" /> Learners may download the file (otherwise it is only viewed, and offline copies stay inside the app)
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <Switch checked={f.is_published} onChange={(v) => set('is_published')(v)} label="Published" /> Published
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={f.is_hidden} onChange={(v) => set('is_hidden')(v)} label="Hidden" /> Hidden from learners
          </label>
        </div>
        {why ? (
          <div className="md:col-span-2">
            <Refusal text={why} />
          </div>
        ) : null}
      </div>
      {picking ? (
        <DriveFilePicker
          title="Choose the lesson's file"
          confirmLabel="Use this file"
          onClose={() => setPicking(false)}
          onChoose={(rows) => {
            setPicking(false);
            const r = rows[0];
            if (r) setFile({ id: Number(r.id), name: r.name });
          }}
        />
      ) : null}
    </Modal>
  );
}
