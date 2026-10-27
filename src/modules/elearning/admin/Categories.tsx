import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, Switch, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { PageHead } from '../../../components/PageKit';
import { eGet, ePost, errorText, K, newKey, type Category } from '../api';
import { area, Field, input, Pill, Refusal, useEl } from '../parts';

/**
 * Categories (§5.6, FR-CAT-01): up to five levels, each with the course-code
 * prefix courses in it take; renamed, moved, reordered among their siblings,
 * archived with everything under them, restored, or deleted while empty.
 */
export default function Categories() {
  const el = useEl();
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: K.categories(el.org, archived), queryFn: ({ signal }) => eGet<{ items: Category[] }>('/categories', { org: el.org, ...(archived ? { archived: 1 } : {}) }, signal) });
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['elearning', 'categories'] });
    void qc.invalidateQueries({ queryKey: ['elearning', 'setup'] });
  };
  const act = async (c: Category, path: string, body: object = {}) => {
    setBusy(c.id);
    try {
      const r = await ePost(path, body);
      toast('success', r.message);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const move = (c: Category, d: -1 | 1) => {
    const siblings = (q.data?.items ?? []).filter((x) => x.parent_id === c.parent_id);
    const i = siblings.findIndex((x) => x.id === c.id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    const ids = siblings.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void act(c, '/categories/reorder', { parent_id: c.parent_id, ids });
  };
  const manage = el.can('settings_manage');

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Categories" sub="Where courses are filed, and the prefix of their codes.">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <Switch checked={archived} onChange={setArchived} label="Show archived" /> Show archived
        </label>
        {manage ? (
          <Button variant="primary" icon="plus" disabled={!el.online} onClick={() => setEditing('new')}>
            New category
          </Button>
        ) : null}
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No categories yet. The set-up wizard adds the fourteen default ones in one step.</p> : null}
      <ul className="m-0 flex max-w-[860px] list-none flex-col gap-1 p-0">
        {(q.data?.items ?? []).map((c) => (
          <li key={c.id} className={cx('flex items-center gap-2 rounded-[10px] border border-line bg-surface py-2 pr-2', c.archived && 'opacity-60')} style={{ paddingLeft: 12 + c.depth * 20 }}>
            <Icon name="tag" size={15} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1">
              <b className="text-[13px] text-ink">{c.label || c.name}</b> {c.code ? <span className="font-mono text-[11px] text-ink-3">{c.code}</span> : null}
              {c.description ? <span className="block truncate text-[12px] text-ink-3">{c.description}</span> : null}
            </span>
            {c.archived ? <Pill tone="grey">Archived</Pill> : null}
            <span className="text-[12px] text-ink-3 tabular-nums">{c.courses} courses</span>
            {manage && el.online ? (
              <span className="flex items-center gap-0.5">
                <button type="button" aria-label={`Move ${c.name} up`} disabled={busy !== null} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle" onClick={() => move(c, -1)}>
                  <Icon name="arrow-up" size={14} />
                </button>
                <button type="button" aria-label={`Move ${c.name} down`} disabled={busy !== null} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle" onClick={() => move(c, 1)}>
                  <Icon name="arrow-down" size={14} />
                </button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                {c.archived ? (
                  <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => void act(c, `/categories/${c.id}/restore`)}>
                    Restore
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => void act(c, `/categories/${c.id}/archive`)}>
                    Archive
                  </Button>
                )}
                {c.courses === 0 ? (
                  <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => void act(c, `/categories/${c.id}/delete`)}>
                    Delete
                  </Button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? <CategoryForm category={editing === 'new' ? null : editing} all={q.data?.items ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
    </div>
  );
}

function CategoryForm({ category, all, onClose, onSaved }: { category: Category | null; all: Category[]; onClose: () => void; onSaved: () => void }) {
  const el = useEl();
  const [name, setName] = useState(category?.name ?? '');
  const [code, setCode] = useState(category?.code ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [parent, setParent] = useState(category?.parent_id ? String(category.parent_id) : '');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const save = async () => {
    setBusy(true);
    setWhy(null);
    const body = { name: name.trim(), code: code.trim().toUpperCase() || null, description: description.trim() || null, parent_id: parent ? Number(parent) : null, org: el.org };
    try {
      if (category) {
        const r = await ePost(`/categories/${category.id}`, body);
        toast('success', r.message);
      } else {
        key.current ??= newKey('category');
        const r = await ePost('/categories', body, key.current);
        key.current = null;
        toast('success', r.message);
      }
      onSaved();
    } catch (e) {
      key.current = null;
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const parents = all.filter((c) => !c.archived && c.id !== category?.id && c.depth < 4);
  return (
    <Modal
      title={category ? `Edit ${category.name}` : 'New category'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Field label="Code prefix" hint="Letters and digits, up to 12 — course codes in it start with this (CYB-101).">
          <input className={`${input} max-w-[180px] font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} />
        </Field>
        <Field label="Inside">
          <Select aria-label="Parent category" value={parent} onChange={(e) => setParent(e.target.value)} options={[{ value: '', label: 'Top level' }, ...parents.map((c) => ({ value: String(c.id), label: c.path || c.name }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <Field label="Description">
          <textarea className={area} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}
