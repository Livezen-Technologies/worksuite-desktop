import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { PageHead } from '../../hr/parts';
import { eGet, ePost, errorText, K, labelOf, newKey, refusal, when, type Category, type Course, type CourseCard, type Paged } from '../api';
import { CourseStatusPill, Field, input, Refusal, useEl } from '../parts';

const PER = 50;

/**
 * Courses the person manages (§5.1): by status, category, type and a search,
 * or only their own; each opens its management page. A new course starts as
 * a draft with the code the server offers from its category.
 */
export default function Courses() {
  const el = useEl();
  const o = el.options;
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [mine, setMine] = useState(!el.can('course_view'));
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [making, setMaking] = useState(false);
  const f = { status, course_type: type, q, mine: mine ? 1 : '', page, per_page: PER };
  const list = useQuery({ queryKey: K.courses(f), queryFn: ({ signal }) => eGet<Paged<CourseCard>>('/courses', f, signal), placeholderData: keepPreviousData });
  const data = list.data;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Courses" sub="Build, review, publish and follow courses.">
        {el.can('course_create') ? (
          <Button variant="primary" icon="plus" disabled={!el.online} onClick={() => setMaking(true)}>
            New course
          </Button>
        ) : null}
      </PageHead>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
          setPage(1);
        }}
      >
        <input aria-label="Search courses" placeholder="Title or code" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} max-w-[260px]`} />
        <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} options={[{ value: '', label: 'Every status' }, ...o.statuses.map((s) => ({ value: s.value, label: s.label })), { value: 'DRAFT,REVIEW,APPROVED', label: 'Not yet published' }]} className="h-9 min-w-[150px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <Select aria-label="Type" value={type} onChange={(e) => (setType(e.target.value), setPage(1))} options={[{ value: '', label: 'Any type' }, ...o.course_types.map((t) => ({ value: t.value, label: t.label }))]} className="h-9 min-w-[150px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={mine} onChange={(e) => (setMine(e.target.checked), setPage(1))} /> Mine only
        </label>
        <Button type="submit" icon="search">
          Search
        </Button>
      </form>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {data ? (
        data.items.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No courses match.</p>
        ) : (
          <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] text-ink-3">
                  <th className="px-3 py-2 font-semibold">Course</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Instructor</th>
                  <th className="px-3 py-2 text-right font-semibold">Lessons</th>
                  <th className="px-3 py-2 text-right font-semibold">Enrolled</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-subtle" onClick={() => el.open.manage(c.id)}>
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.manage(c.id)}>
                        {c.title}
                      </button>
                      <div className="font-mono text-[11px] text-ink-3">
                        {c.code} · v{c.version}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <CourseStatusPill status={c.status} options={o} />
                    </td>
                    <td className="px-3 py-2 text-ink-2">{labelOf(o.course_types, c.course_type)}</td>
                    <td className="px-3 py-2 text-ink-2">{c.category?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-2">{c.instructor?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.lessons}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.enrolled}</td>
                    <td className="px-3 py-2 text-ink-3">{when(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {data && data.meta.pages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-3">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Page {data.meta.page} of {data.meta.pages} · {data.meta.total} courses
          </span>
          <Button size="sm" disabled={page >= data.meta.pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
      {making ? <NewCourse onClose={() => setMaking(false)} /> : null}
    </div>
  );
}

function NewCourse({ onClose }: { onClose: () => void }) {
  const el = useEl();
  const o = el.options;
  const cats = useQuery({ queryKey: K.categories(el.org, false), queryFn: ({ signal }) => eGet<{ items: Category[] }>('/categories', { org: el.org }, signal) });
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('SELF_PACED');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const offer = async (cat: string) => {
    setCategory(cat);
    if (!cat) return;
    try {
      const r = await eGet<{ code: string }>('/courses/code', { category_id: cat });
      setCode((c) => (c.trim() ? c : r.code));
    } catch {
      /* the server offers one when the code is left blank */
    }
  };
  const make = async () => {
    setBusy(true);
    setWhy(null);
    key.current ??= newKey('course');
    try {
      const r = await ePost<Course>('/courses', { title: title.trim(), category_id: category ? Number(category) : null, code: code.trim() || undefined, course_type: type, summary: summary.trim() || undefined, org: el.org }, key.current);
      key.current = null;
      toast('success', r.message);
      onClose();
      el.open.manage(r.data.id, 'builder');
    } catch (e) {
      key.current = null;
      const r = refusal(e);
      setWhy(errorText(e) + (r?.code === 'code_taken' && typeof r.suggestion === 'string' ? ` Try ${r.suggestion}.` : ''));
      if (r?.code === 'code_taken' && typeof r.suggestion === 'string') setCode(r.suggestion);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New course"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void make()}>
            Create the draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <Select aria-label="Category" value={category} onChange={(e) => void offer(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(cats.data?.items ?? []).filter((c) => !c.archived).map((c) => ({ value: String(c.id), label: c.path || c.name }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Code" hint="Offered from the category; unique in the company.">
            <input className={`${input} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
          </Field>
        </div>
        <Field label="Type" hint="The type sets defaults (compliance: assigned only, due in 30 days).">
          <Select aria-label="Course type" value={type} onChange={(e) => setType(e.target.value)} options={o.course_types.map((t) => ({ value: t.value, label: t.label }))} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <Field label="Summary">
          <input className={input} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}
