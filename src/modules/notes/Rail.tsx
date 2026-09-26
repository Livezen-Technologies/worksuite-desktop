import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, cx } from '../../components/ui';
import { NOTEBOOK_COLORS, VIEWS, type Notebook, type Section, type View } from './api';

export type Place = { view: View } | { notebook: number } | { section: number };

const row = (active: boolean, indent: number) => cx('group flex h-[29px] w-full items-center gap-1.5 rounded-[7px] pr-2 text-left text-[13px]', active ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle', indent === 1 ? 'pl-5' : indent === 2 ? 'pl-9' : 'pl-1');

/** The views and your notebooks (NotesMain, left), with sections inside each. */
export function Rail({ place, counts, notebooks, sections, onPlace, onNew }: { place: Place; counts: Record<string, number>; notebooks: Notebook[]; sections: Section[]; onPlace: (p: Place) => void; onNew: () => void }) {
  const qc = useQueryClient();
  const [closed, setClosed] = useState<number[]>([]);
  const [naming, setNaming] = useState<{ kind: 'notebook'; id: number | null; name: string; section?: string } | { kind: 'section'; id: number | null; notebook: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'notebook' | 'section'; id: number; name: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notes'] });
  const is = (p: Place) => JSON.stringify(p) === JSON.stringify(place);

  const save = async () => {
    if (!naming || !naming.name.trim()) return;
    try {
      if (naming.kind === 'notebook') {
        if (naming.id) await apiPut(`/api/notebooks/${naming.id}`, { name: naming.name.trim() });
        else {
          const r = await apiPost<{ id: number }>('/api/notebooks', { name: naming.name.trim(), color: NOTEBOOK_COLORS[notebooks.length % NOTEBOOK_COLORS.length] });
          if (naming.section?.trim()) {
            const s = await apiPost<{ id: number }>(`/api/notebooks/${r.id}/sections`, { name: naming.section.trim() });
            onPlace({ section: s.id });
          } else onPlace({ notebook: r.id });
        }
      } else if (naming.id) await apiPut(`/api/note-sections/${naming.id}`, { name: naming.name.trim() });
      else {
        const s = await apiPost<{ id: number }>(`/api/notebooks/${naming.notebook}/sections`, { name: naming.name.trim() });
        onPlace({ section: s.id });
      }
      setNaming(null);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const d = deleting;
    setDeleting(null);
    try {
      await apiDelete(d.kind === 'notebook' ? `/api/notebooks/${d.id}` : `/api/note-sections/${d.id}`);
      toast('success', d.kind === 'notebook' ? 'Notebook deleted. Its notes are still there, in no notebook.' : 'Section deleted. Its notes stay in the notebook.');
      onPlace({ view: 'all' });
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const tools = (edit: () => void, del: () => void, label: string) => (
    <span className="absolute top-1 right-1 hidden gap-0.5 group-focus-within:flex group-hover:flex">
      <button type="button" aria-label={`Rename ${label}`} title="Rename" onClick={edit} className="flex h-[21px] w-[21px] items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-ink"><Icon name="compose" size={12} /></button>
      <button type="button" aria-label={`Delete ${label}`} title="Delete" onClick={del} className="flex h-[21px] w-[21px] items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-danger"><Icon name="trash" size={12} /></button>
    </span>
  );

  return (
    <nav aria-label="Notebooks" className="flex w-[236px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface px-2.5 py-3.5 scroll-thin">
      <button type="button" onClick={onNew} title="New note (N)" className="mb-2.5 flex h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] bg-primary font-bold text-white hover:bg-primary-hover">
        <Icon name="plus" size={16} /> New note
      </button>
      {VIEWS.map((v) => (
        <button key={v.id} type="button" aria-current={is({ view: v.id }) ? 'page' : undefined} onClick={() => onPlace({ view: v.id })} className={row(is({ view: v.id }), 0)}>
          <span className="w-2.5" />
          <span className="flex-1 truncate">{v.label}</span>
          <span className="text-[11.5px] text-ink-3">{counts[v.id] || ''}</span>
        </button>
      ))}
      <div className="mx-2 mt-2.5 mb-0.5 flex items-center text-[10.5px] font-bold tracking-[0.6px] text-ink-3">
        <span className="flex-1">NOTEBOOKS</span>
        <button type="button" aria-label="New notebook" title="New notebook" onClick={() => setNaming({ kind: 'notebook', id: null, name: '', section: '' })} className="text-[14px] text-primary hover:opacity-80">+</button>
      </div>
      {notebooks.length === 0 ? <span className="px-2 py-1 text-[12px] text-ink-3">Notebooks group notes by team, project or anything else.</span> : null}
      {notebooks.map((nb) => {
        const open = !closed.includes(nb.id);
        const own = sections.filter((s) => s.notebook_id === nb.id);
        return (
          <div key={nb.id}>
            <div className="group relative flex items-center">
              <button type="button" aria-label={open ? `Fold ${nb.name}` : `Open ${nb.name}`} aria-expanded={open} onClick={() => setClosed(open ? [...closed, nb.id] : closed.filter((x) => x !== nb.id))} className={cx('absolute left-0.5 z-10 w-3.5 text-[10px] text-ink-3', !own.length && 'invisible')}>
                {open ? '▾' : '▸'}
              </button>
              <button type="button" aria-current={is({ notebook: nb.id }) ? 'page' : undefined} onClick={() => onPlace({ notebook: nb.id })} className={row(is({ notebook: nb.id }), 1)}>
                <span className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: nb.color ?? '#23349E' }} />
                <span className="min-w-0 flex-1 truncate font-bold">{nb.name}</span>
                <span className="text-[11.5px] font-normal text-ink-3 group-focus-within:invisible group-hover:invisible">{nb.count || ''}</span>
              </button>
              {tools(() => setNaming({ kind: 'notebook', id: nb.id, name: nb.name }), () => setDeleting({ kind: 'notebook', id: nb.id, name: nb.name }), nb.name)}
            </div>
            {open
              ? own.map((s) => (
                  <div key={s.id} className="group relative">
                    <button type="button" aria-current={is({ section: s.id }) ? 'page' : undefined} onClick={() => onPlace({ section: s.id })} className={row(is({ section: s.id }), 2)}>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="text-[11.5px] font-normal text-ink-3 group-focus-within:invisible group-hover:invisible">{s.count || ''}</span>
                    </button>
                    {tools(() => setNaming({ kind: 'section', id: s.id, notebook: nb.id, name: s.name }), () => setDeleting({ kind: 'section', id: s.id, name: s.name }), s.name)}
                  </div>
                ))
              : null}
            {open ? (
              <button type="button" onClick={() => setNaming({ kind: 'section', id: null, notebook: nb.id, name: '' })} className="flex h-[26px] w-full items-center pl-9 text-left text-[12px] font-semibold text-primary opacity-70 hover:opacity-100">
                + New section
              </button>
            ) : null}
          </div>
        );
      })}
      {naming ? (
        <Modal
          title={naming.kind === 'notebook' ? (naming.id ? 'Rename notebook' : 'New notebook') : naming.id ? 'Rename section' : 'New section'}
          onClose={() => setNaming(null)}
          width={360}
          footer={
            <>
              <Button onClick={() => setNaming(null)}>Cancel</Button>
              <Button variant="primary" disabled={!naming.name.trim()} onClick={() => void save()}>{naming.id ? 'Save' : 'Create'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-[13px]">
            <input autoFocus value={naming.name} maxLength={150} onChange={(e) => setNaming({ ...naming, name: e.target.value } as typeof naming)} onKeyDown={(e) => e.key === 'Enter' && void save()} aria-label={naming.kind === 'notebook' ? 'Notebook name' : 'Section name'} placeholder={naming.kind === 'notebook' ? 'Notebook name' : 'Section name'} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary" />
            {naming.kind === 'notebook' && !naming.id ? (
              <input value={naming.section ?? ''} maxLength={120} onChange={(e) => setNaming({ ...naming, section: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} aria-label="First section name" placeholder="Section name (optional)" className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary" />
            ) : null}
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title={`Delete “${deleting.name}”?`}
          onClose={() => setDeleting(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Keep it</Button>
              <Button variant="danger" onClick={() => void remove()}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">{deleting.kind === 'notebook' ? 'The notebook goes; its notes stay, in no notebook.' : 'The section goes; its notes stay in the notebook.'}</p>
        </Modal>
      ) : null}
    </nav>
  );
}
