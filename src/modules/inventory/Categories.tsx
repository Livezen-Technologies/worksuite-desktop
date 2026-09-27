import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnBad, btnPrimary, Field, input, Sheet } from '../hr/parts';
import { createCategory, deleteCategory, fetchCategories, K, parentsFor, treeOf, updateCategory, type Company, type TreeNode } from './api';

/**
 * The categories (InvProductSheet's dialogs): rename in place — it saves as
 * you leave the field — move one under another, taking everything beneath it
 * along, add a sub-category, delete an empty one. A category that still holds
 * products or sub-categories is refused by the server, and the dialog says so
 * before asking.
 */
const sel = 'h-[30px] w-full rounded-[7px] border border-line bg-surface px-2 text-[12.5px] font-medium text-ink';

export default function Categories({ org, companies, onClose }: { org: string; companies: Company[]; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: K.categories(org),
    queryFn: ({ signal }) => fetchCategories(org, signal),
  });
  const tree = useMemo(() => treeOf(q.data ?? []), [q.data]);
  const [adding, setAdding] = useState<{ parent: number | null } | null>(null);
  const [removing, setRemoving] = useState<TreeNode | null>(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState(org || (companies.length === 1 ? String(companies[0]!.id) : ''));
  const [busy, setBusy] = useState(false);
  const pickCompany = !org && companies.length > 1;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['inventory'] });

  const save = async (id: number, patch: { name?: string; parent_id?: number | null }) => {
    try {
      await updateCategory(id, patch);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
      refresh();
    }
  };
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (pickCompany && !company) {
      toast('warning', 'Choose the company it belongs to.');
      return;
    }
    setBusy(true);
    try {
      await createCategory(company, n, null);
      setName('');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        title="Categories"
        width={640}
        onClose={onClose}
        footer={
          <div className="flex w-full items-center gap-2">
            {pickCompany ? (
              <span className="w-[170px] shrink-0">
                <Select
                  aria-label="Company for a new category"
                  value={company}
                  onValueChange={setCompany}
                  placeholder="Company"
                  options={companies.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                  className={sel + ' !h-[34px]'}
                />
              </span>
            ) : null}
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder="Name, then Enter"
              aria-label="New category name"
              maxLength={150}
            />
            <button type="button" className={btnPrimary} disabled={busy || !name.trim()} onClick={() => void add()}>
              Add
            </button>
            <button type="button" className={btn} onClick={onClose}>
              Done
            </button>
          </div>
        }
      >
        <span className="text-[12.5px] text-ink-3">
          {tree.length} {tree.length === 1 ? 'category' : 'categories'}. Renaming saves as you leave the field; moving one takes everything beneath it along.
        </span>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <div role="list" aria-label="Categories" className="flex flex-col">
            {tree.map((c) => (
              <CategoryRow key={`${c.id}-${c.name}-${c.parent_id}`} c={c} tree={tree} onSave={save} onAdd={() => setAdding({ parent: c.id })} onRemove={() => setRemoving(c)} />
            ))}
            {!tree.length ? <span className="py-3 text-center text-[12.5px] text-ink-3">No categories yet. Name one below.</span> : null}
          </div>
        )}
      </Sheet>
      {adding ? <NewCategory org={org} companies={companies} parent={adding.parent} tree={tree} onClose={() => setAdding(null)} /> : null}
      {removing ? <RemoveCategory c={removing} subs={tree.filter((n) => n.parent_id === removing.id).length} onClose={() => setRemoving(null)} onDone={refresh} /> : null}
    </>
  );
}

function CategoryRow({ c, tree, onSave, onAdd, onRemove }: { c: TreeNode; tree: TreeNode[]; onSave: (id: number, patch: { name?: string; parent_id?: number | null }) => Promise<void>; onAdd: () => void; onRemove: () => void }) {
  const [name, setName] = useState(c.name);
  const parents = parentsFor(tree, c.id);
  return (
    <div role="listitem" data-category={c.id} className="flex items-center gap-2 border-b border-line/60 py-1.5 last:border-b-0">
      <span className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: c.level * 18 }}>
        <input
          className={input + ' !h-[30px]'}
          value={name}
          aria-label={`Name of ${c.name}`}
          maxLength={150}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(c.name);
            else if (n !== c.name) void onSave(c.id, { name: n });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
      <span className="w-[44px] shrink-0 text-right text-[12px] text-ink-3 tabular-nums" title="Products filed here, and under it">
        {c.total}
      </span>
      <span className="w-[170px] shrink-0">
        <Select
          aria-label={`Parent of ${c.name}`}
          searchable
          value={c.parent_id === null ? '' : String(c.parent_id)}
          onValueChange={(v) => void onSave(c.id, { parent_id: v ? Number(v) : null })}
          options={[{ value: '', label: '— top level —' }, ...parents.map((p) => ({ value: String(p.id), label: p.name }))]}
          className={sel}
        />
      </span>
      <button type="button" aria-label={`Add a sub-category to ${c.name}`} title="Add a sub-category" onClick={onAdd} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
        <Icon name="plus" size={14} />
      </button>
      <button type="button" aria-label={`Delete ${c.name}`} title="Delete" onClick={onRemove} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-danger-bg hover:text-danger">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** A new category, top-level or under one (the rail's "+" and a row's "+"). */
export function NewCategory({ org, companies = [], parent, tree, onClose }: { org: string; companies?: Company[]; parent: number | null; tree: TreeNode[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [under, setUnder] = useState(parent === null ? '' : String(parent));
  const [company, setCompany] = useState(org || (companies.length === 1 ? String(companies[0]!.id) : ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickCompany = !org && companies.length > 1;
  const add = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the category a name.');
    if (pickCompany && !company) return setError('Choose the company it belongs to.');
    setBusy(true);
    try {
      await createCategory(company, name.trim(), under ? Number(under) : null);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', 'Category added');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New category"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void add()}>
            Add
          </button>
        </>
      }
    >
      {pickCompany ? (
        <Field label="Company">
          <Select
            aria-label="Company"
            value={company}
            onValueChange={setCompany}
            placeholder="Choose a company"
            options={companies.map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
            className={sel + ' !h-[34px]'}
          />
        </Field>
      ) : null}
      <Field label="Name">
        <input
          className={input}
          value={name}
          autoFocus
          maxLength={150}
          aria-label="Category name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
      </Field>
      <Field label="Inside">
        <Select
          aria-label="Inside"
          searchable
          value={under}
          onValueChange={setUnder}
          options={[
            { value: '', label: 'Top level' },
            ...tree.map((c) => ({
              value: String(c.id),
              label: c.name,
              hint: c.level ? tree.find((p) => p.id === c.parent_id)?.name : undefined,
            })),
          ]}
          className={sel + ' !h-[34px]'}
        />
      </Field>
      {error ? (
        <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </span>
      ) : null}
    </Sheet>
  );
}

function RemoveCategory({ c, subs, onClose, onDone }: { c: TreeNode; subs: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = c.product_count;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteCategory(c.id);
      toast('success', 'Category removed');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Delete “${c.name}”?`}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnBad + ' !h-[34px]'} disabled={busy} onClick={() => void go()}>
            Delete
          </button>
        </>
      }
    >
      <span className="text-[13px] text-ink-2">
        {held
          ? `${held} ${held === 1 ? 'product is' : 'products are'} filed here. They will have to be refiled first — this will be refused until they are.`
          : subs
            ? `It holds ${subs} ${subs === 1 ? 'sub-category' : 'sub-categories'}. Move or remove ${subs === 1 ? 'it' : 'them'} first — this will be refused until then.`
            : 'Nothing is filed here. It goes, and nothing else changes.'}
      </span>
      {error ? (
        <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </span>
      ) : null}
    </Sheet>
  );
}
