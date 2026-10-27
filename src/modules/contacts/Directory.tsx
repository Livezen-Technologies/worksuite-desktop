import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useStore } from '../../core/store';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { initials, type DirectoryPerson } from './api';

const COLORS = ['#23349E', '#B45309', '#0E7C86', '#1F7A4D', '#7C3AED', '#DB2777', '#15803D', '#0F766E'];
type Seg = 'all' | 'new' | 'saved';

/** Everyone who works here (ContactsDirectory); one click saves a person to your contacts. */
export function Directory({ onNewGroup, onNew }: { onNewGroup: () => void; onNew: () => void }) {
  const qc = useQueryClient();
  const orgs = useStore(app, (s) => s.bootstrap?.organizations ?? []);
  const [q, setQ] = useState('');
  const [seg, setSeg] = useState<Seg>('all');
  const [adding, setAdding] = useState<number | null>(null);
  const people = useQuery({ queryKey: ['contacts', 'directory'], queryFn: ({ signal }) => apiGet<DirectoryPerson[]>('/api/contacts/directory', undefined, signal) });
  const all = people.data ?? [];
  const term = q.trim().toLowerCase();
  const shown = all.filter((u) => (!term || `${u.name} ${u.email ?? ''}`.toLowerCase().includes(term)) && (seg === 'all' || (seg === 'saved' ? u.saved : !u.saved && !u.is_me)));
  const saved = all.filter((u) => u.saved).length;
  const where = orgs.length === 1 ? orgs[0]!.name : 'the directory';

  const add = async (u: DirectoryPerson) => {
    setAdding(u.id);
    try {
      await apiPost('/api/contacts', { display_name: u.name, work_email: u.email ?? '', mobile: u.phone ?? '', type: 'employee', user_id: u.id });
      qc.setQueryData<DirectoryPerson[]>(['contacts', 'directory'], (old) => old?.map((x) => (x.id === u.id ? { ...x, saved: true } : x)));
      toast('success', `${u.name} added to contacts`);
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-6 pt-5">
        <div className="flex flex-1 flex-col gap-0.5">
          <h1 className="text-[22px] font-bold tracking-[-0.3px] text-ink">Company directory</h1>
          <span className="text-[12.5px] text-ink-3">{people.isSuccess ? `${all.length} ${all.length === 1 ? 'person' : 'people'} in ${where} · ${saved} saved to your contacts` : ' '}</span>
        </div>
        <button type="button" onClick={onNewGroup} className="flex h-9 items-center gap-[7px] rounded-[10px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle">
          <Icon name="users" size={15} /> New group
        </button>
        <button type="button" onClick={onNew} className="flex h-9 items-center gap-[7px] rounded-[10px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover">
          <Icon name="plus" size={15} /> New contact
        </button>
      </div>
      <div className="flex items-center gap-2.5 px-6 pt-4 pb-3.5">
        <label className="flex h-[38px] max-w-[420px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-ink-3 focus-within:border-primary">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search directory…" aria-label="Search directory" className="flex-1 bg-transparent text-[13px] text-ink outline-none bare-focus" />
        </label>
        <div role="group" aria-label="Show" className="ml-auto flex rounded-[10px] bg-subtle p-[3px]">
          {(
            [
              ['all', 'Everyone'],
              ['new', 'Not saved'],
              ['saved', 'Saved'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={seg === k} onClick={() => setSeg(k)} className={cx('h-[30px] rounded-[8px] px-3 text-[12.5px] font-semibold', seg === k ? 'bg-surface text-primary shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.12)]' : 'text-ink-2')}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 scroll-thin">
        {people.isLoading ? <Spinner /> : null}
        {people.error && !people.data ? <ErrorNote error={people.error} onRetry={() => void people.refetch()} /> : null}
        <div role="list" aria-label="People" className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {shown.map((u) => (
            <div key={u.id} role="listitem" aria-label={u.name} className="flex h-[76px] items-center gap-3 rounded-[14px] border border-line bg-surface pr-3 pl-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ background: COLORS[u.id % COLORS.length] }}>
                {initials(u.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <b className="truncate text-[13px] text-ink">
                  {u.name}
                  {u.is_me ? <span className="font-medium text-ink-3"> (you)</span> : null}
                </b>
                <span className="truncate text-[11.5px] text-ink-3">{u.email}</span>
              </span>
              {u.saved ? (
                <span className="flex h-[26px] shrink-0 items-center gap-1 rounded-[13px] bg-success-bg px-[9px] text-[11.5px] font-bold text-success">
                  <Icon name="check" size={12} /> Saved
                </span>
              ) : !u.is_me ? (
                <button type="button" aria-label={`Add ${u.name} to contacts`} disabled={adding === u.id} onClick={() => void add(u)} className="flex h-[30px] shrink-0 items-center gap-1 rounded-[8px] border border-info-line bg-selection px-2.5 text-[12px] font-bold text-primary hover:brightness-95 disabled:opacity-50 dark:border-line">
                  <Icon name="plus" size={13} /> Add
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {people.isSuccess && !shown.length ? <div className="p-20 text-center text-[13px] text-ink-3">{term ? `No one in the directory matches “${q.trim()}”.` : seg === 'saved' ? 'No one from the directory is saved yet.' : 'Everyone is saved already.'}</div> : null}
      </div>
    </div>
  );
}
