import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, cx } from '../../components/ui';
import { SCOPES, type Scope, type TaskList } from './api';

const SWATCHES = ['#0E7C86', '#23349E', '#B45309', '#6B3FB5', '#1F7A4D', '#B42318', '#B83280', '#4A5168'];

/** The views and your lists (TaskRail), each with what is still open in it. */
export function Rail({ scope, counts, lists, onScope, onNew }: { scope: Scope; counts: Record<string, number>; lists: TaskList[]; onScope: (s: Scope) => void; onNew: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TaskList | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TaskList | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tasks'] });
  const row = (active: boolean) => cx('flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px]', active ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle');

  return (
    <nav aria-label="Task views and lists" className="flex w-[220px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface px-2.5 py-3.5 scroll-thin">
      <button type="button" data-guide="tasks.new-task" onClick={onNew} title="New task (N)" className="mb-2.5 flex h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] bg-primary font-bold text-white hover:bg-primary-hover">
        <Icon name="plus" size={16} /> New task
      </button>
      {SCOPES.map((s) => (
        <button key={s.id} type="button" aria-current={scope === s.id ? 'page' : undefined} onClick={() => onScope(s.id)} className={row(scope === s.id)}>
          <span className="min-w-0 flex-1 truncate">{s.label}</span>
          {counts[s.id] ? <span className={cx('text-[11.5px] font-bold', s.id === 'overdue' ? 'text-danger' : 'text-ink-2')}>{counts[s.id]}</span> : null}
        </button>
      ))}
      <div className="mx-2 mt-2.5 mb-0.5 flex items-center text-[10.5px] font-bold tracking-[0.6px] text-ink-3">
        <span className="flex-1">LISTS</span>
        <button type="button" onClick={() => setEditing('new')} className="font-bold text-primary hover:underline">+ New list</button>
      </div>
      {lists.length === 0 ? <span className="px-2 py-1 text-[12px] text-ink-3">Lists group tasks by project or area.</span> : null}
      {lists.map((l) => {
        const id: Scope = `list:${l.id}`;
        return (
          <div key={l.id} className="group relative">
            <button type="button" aria-current={scope === id ? 'page' : undefined} onClick={() => onScope(id)} className={row(scope === id)}>
              <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: l.color }} />
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="text-[11.5px] font-bold text-ink-2 group-hover:invisible">{counts[id] || ''}</span>
            </button>
            <span className="invisible absolute top-1 right-1 flex gap-0.5 group-hover:visible">
              <button type="button" aria-label={l.is_favorite ? `Unfavourite ${l.name}` : `Favourite ${l.name}`} title={l.is_favorite ? 'Unfavourite' : 'Favourite (shown first)'} onClick={() => void apiPut(`/api/task-lists/${l.id}`, { is_favorite: !l.is_favorite }).then(refresh, (e) => toast('error', errorMessage(e)))} className={cx('flex h-[22px] w-[22px] items-center justify-center rounded-[5px] hover:bg-surface', l.is_favorite ? 'text-[#B45309]' : 'text-ink-3')}>
                <Icon name="star" size={12} />
              </button>
              <button type="button" aria-label={`Edit ${l.name}`} title="Rename or recolour" onClick={() => setEditing(l)} className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-surface hover:text-ink">
                <Icon name="compose" size={12} />
              </button>
              <button type="button" aria-label={`Delete ${l.name}`} title="Delete the list" onClick={() => setDeleting(l)} className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-surface hover:text-danger">
                <Icon name="trash" size={12} />
              </button>
            </span>
          </div>
        );
      })}
      {editing ? <ListDialog list={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => (setEditing(null), refresh(), id ? onScope(`list:${id}`) : undefined)} /> : null}
      {deleting ? (
        <Modal
          title={`Delete “${deleting.name}”?`}
          onClose={() => setDeleting(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Keep it</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const l = deleting;
                  setDeleting(null);
                  void apiDelete(`/api/task-lists/${l.id}`).then(
                    () => {
                      toast('success', 'List deleted. Its tasks are still there, in no list.');
                      if (scope === `list:${l.id}`) onScope('all');
                      refresh();
                    },
                    (e) => toast('error', errorMessage(e)),
                  );
                }}
              >
                Delete list
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">The list goes; its tasks stay, in no list.</p>
        </Modal>
      ) : null}
    </nav>
  );
}

function ListDialog({ list, onClose, onSaved }: { list: TaskList | null; onClose: () => void; onSaved: (id: number | null) => void }) {
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color && /^#[0-9a-f]{6}$/i.test(list.color) ? list.color : SWATCHES[0]!);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (list) {
        await apiPut(`/api/task-lists/${list.id}`, { name: name.trim() || list.name, color });
        onSaved(null);
      } else {
        const r = await apiPost<{ id: number }>('/api/task-lists', { name: name.trim() || 'Untitled list', color });
        onSaved(r.id);
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={list ? 'Edit list' : 'New list'}
      onClose={onClose}
      width={400}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{list ? 'Save' : 'Create list'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Name
          <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="Garage module" className="h-9 rounded-[8px] border border-line bg-surface px-2.5 font-normal text-ink outline-none focus:border-primary" />
        </label>
        <div className="flex flex-col gap-1 font-semibold text-ink">
          Colour
          <div className="flex gap-1.5" role="radiogroup" aria-label="Colour">
            {SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className="h-[22px] w-[22px] rounded-full" style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
