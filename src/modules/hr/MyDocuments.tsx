import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiPost, request, apiDelete, ApiError } from '../../core/api';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import type { DocList, EmployeeDoc } from './api';
import { dayLong } from './dates';
import { btn, btnPrimary, Cell, Empty, Field, input, PageHead, row, Seg, Sheet, StatusChip, THead } from './parts';

/**
 * My documents (HrDocuments): everything on my employment file that I may
 * see, and what I add to it (visible to me and to HR). Files go up as they
 * are dropped or chosen, with a title, category and expiry; each can be
 * viewed, downloaded, edited, archived or deleted as the server allows.
 */
const SORTS: Array<[string, string]> = [
  ['created_at', 'Date added'],
  ['title', 'Name'],
  ['size', 'Size'],
  ['category', 'Category'],
  ['expires_on', 'Expiry'],
];

export default function MyDocuments() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [sort, setSort] = useState('created_at');
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [adding, setAdding] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<EmployeeDoc | null>(null);
  const [deleting, setDeleting] = useState<EmployeeDoc | null>(null);
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const list = useQuery({
    queryKey: ['hr', 'docs', q, category, status, sort],
    queryFn: ({ signal }) => apiGet<DocList>('/api/hr/me/documents', { q: q.trim() || undefined, category: category || undefined, status, sort, dir: sort === 'created_at' ? 'desc' : 'asc', per_page: 100 }, signal),
  });
  const d = list.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr', 'docs'] });

  const view_ = async (doc: EmployeeDoc) => {
    try {
      const r = await apiPost<{ url: string }>(`/api/hr/me/documents/${doc.id}/link`, { disposition: 'inline' });
      await call('app:openInBrowser', { path: `/${r.url.replace(/^\/+/, '')}` });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const download = async (doc: EmployeeDoc) => {
    try {
      await call('transfers:download', { hrDocument: doc.id, name: doc.filename, open: false });
      toast('success', `Downloading ${doc.filename}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const act = async (doc: EmployeeDoc, what: 'archive' | 'restore' | 'delete') => {
    try {
      if (what === 'delete') await apiDelete(`/api/hr/me/documents/${doc.id}`);
      else await apiPost(`/api/hr/me/documents/${doc.id}/${what}`);
      toast('success', what === 'delete' ? 'Deleted.' : what === 'archive' ? 'Archived.' : 'Restored.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const actions = (doc: EmployeeDoc) => (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] font-semibold text-primary">
      <button type="button" className="hover:underline" onClick={() => void view_(doc)}>View</button>
      <button type="button" className="hover:underline" onClick={() => void download(doc)}>Download</button>
      {d?.rights.rename ? <button type="button" className="hover:underline" onClick={() => setEditing(doc)}>Edit</button> : null}
      {d?.rights.archive ? <button type="button" className="hover:underline" onClick={() => void act(doc, doc.status === 'archived' ? 'restore' : 'archive')}>{doc.status === 'archived' ? 'Restore' : 'Archive'}</button> : null}
      {d?.rights.delete ? <button type="button" className="text-danger hover:underline" onClick={() => setDeleting(doc)}>Delete</button> : null}
    </span>
  );
  const docStatus = (doc: EmployeeDoc) => (doc.status === 'archived' ? 'Archived' : doc.expired ? 'Expired' : 'Active');

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="My documents" sub="Everything on your employment file that you are permitted to see. Documents you add here are visible to you and to HR.">
        {d?.rights.upload !== false ? (
          <button type="button" className={btnPrimary} onClick={() => picker.current?.click()}>
            Add a document
          </button>
        ) : null}
      </PageHead>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Choose documents"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) setAdding(files);
        }}
      />
      {d?.rights.upload !== false ? (
        <button
          type="button"
          onClick={() => picker.current?.click()}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDrag(true);
            }
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length) setAdding(files);
          }}
          className={cx('flex h-16 shrink-0 items-center justify-center rounded-[12px] border-2 border-dashed font-semibold', drag ? 'border-primary bg-selection text-primary' : 'border-[#B8C2DA] bg-surface text-ink-2 dark:border-line')}
        >
          Drag files here, or click to browse
        </button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" aria-label="Search documents" className={input + ' !w-[260px]'} />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={input + ' !w-auto'}>
          <option value="">All categories{d ? ` (${d.counts.active ?? d.total})` : ''}</option>
          {Object.entries(d?.categories ?? {}).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <Seg label="Status" value={status} onChange={setStatus} options={[{ id: 'active', label: 'Active' }, { id: 'archived', label: `Archived${d?.counts.archived ? ` (${d.counts.archived})` : ''}` }]} />
        <span className="flex-1" />
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={input + ' !w-auto'}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              Sort: {l}
            </option>
          ))}
        </select>
        <Seg label="View" value={view} onChange={setView} options={[{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }]} />
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {d && d.linked === false ? <Empty text="Your login is not linked to an employee record, so there is no file to show." /> : null}
      {d && d.linked !== false ? (
        view === 'list' ? (
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <THead cols={[['Document', null], ['Category', 110], ['Size', 70], ['Added', 100], ['By', 120], ['Status', 80], ['', 230]]} />
            {!d.documents.length ? <Empty text={q || category ? 'Nothing matches.' : status === 'archived' ? 'Nothing archived.' : 'No documents yet.'} /> : null}
            {d.documents.map((doc) => (
              <div key={doc.id} className={row}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <FileBadge name={doc.filename} size={26} />
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-ink" title={doc.title}>{doc.title}</b>
                    {doc.expires_on ? <span className={cx('text-[11px]', doc.expired ? 'text-danger' : 'text-ink-3')}>{doc.expired ? 'Expired' : 'Expires'} {dayLong(doc.expires_on)}</span> : null}
                  </span>
                </span>
                <Cell w={110}>{doc.category_label}</Cell>
                <Cell w={70} className="text-ink-3">{doc.size_label || bytes(doc.size)}</Cell>
                <Cell w={100} className="text-ink-3">{dayLong(doc.created_at.slice(0, 10))}</Cell>
                <Cell w={120} className="text-ink-3">{doc.uploaded_by ?? '—'}</Cell>
                <Cell w={80}>
                  <StatusChip>{docStatus(doc)}</StatusChip>
                </Cell>
                <span className="w-[230px] shrink-0">{actions(doc)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
            {!d.documents.length ? <div className="col-span-full"><Empty text="No documents yet." /></div> : null}
            {d.documents.map((doc) => (
              <div key={doc.id} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <FileBadge name={doc.filename} size={34} />
                  <StatusChip className="ml-auto">{docStatus(doc)}</StatusChip>
                </div>
                <b className="truncate text-ink" title={doc.title}>{doc.title}</b>
                <span className="truncate text-[12px] text-ink-3">
                  {doc.category_label} · {doc.size_label || bytes(doc.size)} · {dayLong(doc.created_at.slice(0, 10))}
                </span>
                {actions(doc)}
              </div>
            ))}
          </div>
        )
      ) : null}
      {adding ? <AddDocuments files={adding} categories={d?.categories ?? {}} limits={d?.limits} onClose={() => setAdding(null)} onDone={() => (setAdding(null), refresh())} /> : null}
      {editing ? <EditDocument doc={editing} categories={d?.categories ?? {}} onClose={() => setEditing(null)} onDone={() => (setEditing(null), refresh())} /> : null}
      {deleting ? (
        <Sheet
          title="Delete this document?"
          width={420}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} onClick={() => (setDeleting(null), void act(deleting, 'delete'))}>
                Delete
              </button>
            </>
          }
        >
          <div className="rounded-[9px] bg-subtle px-3 py-2.5 text-ink-2">“{deleting.title}”</div>
          <span className="text-[12.5px] text-ink-3">It is removed from your file and cannot be brought back. Archive it instead to keep it out of the way.</span>
        </Sheet>
      ) : null}
    </div>
  );
}

function AddDocuments({ files, categories, limits, onClose, onDone }: { files: File[]; categories: Record<string, string>; limits?: DocList['limits']; onClose: () => void; onDone: () => void }) {
  const one = files.length === 1;
  const [title, setTitle] = useState(one ? files[0]!.name.replace(/\.[^.]+$/, '') : '');
  const [category, setCategory] = useState(Object.keys(categories).includes('other') ? 'other' : (Object.keys(categories)[0] ?? ''));
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const tooBig = limits ? files.filter((f) => f.size > limits.max_bytes) : [];

  const add = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of files) form.append('files[]', f, f.name);
      if (one && title.trim()) form.append('title', title.trim());
      if (category) form.append('category', category);
      if (expires) form.append('expires_on', expires);
      const r = await request<{ stored: unknown[]; rejected: Array<{ name: string; reason: string }> }>('POST', '/api/hr/me/documents', { body: form });
      const data = r.data;
      if (data.rejected?.length) toast('error', `${data.rejected.map((x) => `${x.name}: ${x.reason}`).join('; ')}`);
      if (data.stored?.length) toast('success', data.stored.length === 1 ? 'Document added.' : `${data.stored.length} documents added.`);
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={one ? 'Add a document' : `Add ${files.length} documents`}
      side
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || tooBig.length === files.length} className={btnPrimary} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </>
      }
    >
      <Field label={one ? 'File' : 'Files'}>
        <div className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-[8px] border border-line px-2.5 py-2 text-[12.5px] font-medium scroll-thin">
          {files.map((f) => (
            <span key={f.name + f.size} className="flex gap-2">
              <Icon name="file" size={14} className="shrink-0 text-ink-3" />
              <b className="min-w-0 flex-1 truncate">{f.name}</b>
              <span className={f.size > (limits?.max_bytes ?? Infinity) ? 'text-danger' : 'text-ink-3'}>{bytes(f.size)}</span>
            </span>
          ))}
        </div>
      </Field>
      {tooBig.length ? <span className="text-[12px] font-semibold text-danger">{tooBig.map((f) => f.name).join(', ')} {tooBig.length === 1 ? 'is' : 'are'} over the {bytes(limits!.max_bytes)} limit and will be refused.</span> : null}
      {one ? (
        <Field label="Title">
          <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Category">
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
            {Object.entries(categories).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expires on">
          <input type="date" aria-label="Expires on" value={expires} onChange={(e) => setExpires(e.target.value)} className={input} />
        </Field>
      </div>
      <span className="text-[11.5px] text-ink-3">Documents you add are visible to you and to HR.</span>
    </Sheet>
  );
}

function EditDocument({ doc, categories, onClose, onDone }: { doc: EmployeeDoc; categories: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [expires, setExpires] = useState(doc.expires_on ?? '');
  const [note, setNote] = useState(doc.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return toast('error', 'A document needs a name.');
    setBusy(true);
    try {
      await request('PATCH', `/api/hr/me/documents/${doc.id}`, { body: { title: title.trim(), category, expires_on: expires || null, note: note.trim() || null } });
      toast('success', 'Saved.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Edit document"
      side
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Title">
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Category">
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
            {Object.entries(categories).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expires on">
          <input type="date" aria-label="Expires on" value={expires} onChange={(e) => setExpires(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="Note">
        <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} className={input + ' !h-[54px] resize-none py-2'} />
      </Field>
    </Sheet>
  );
}
