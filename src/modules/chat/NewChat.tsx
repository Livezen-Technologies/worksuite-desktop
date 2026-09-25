import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Modal, Spinner, cx } from '../../components/ui';

interface Person {
  id: number;
  name: string;
  email: string | null;
}

/**
 * Start a conversation: one person opens (or reopens) a direct chat; two or
 * more make a group, which needs a name. The server decides who may be
 * reached (the chat directory is already the caller's own companies).
 */
export function NewChat({ onClose, onOpened }: { onClose: () => void; onOpened: (roomId: number) => void }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Person[] }>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const group = picked.length > 1;
  const needle = q.trim().toLowerCase();
  const list = (people.data?.users ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle)).slice(0, 60);

  const toggle = (p: Person) => setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));

  const start = async () => {
    if (picked.length === 0 || (group && !name.trim())) return;
    setBusy(true);
    try {
      const r = group
        ? await apiPost<{ room_id: number }>('/api/chat/rooms/group', { name: name.trim(), members: picked.map((p) => p.id) })
        : await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: picked[0]!.id });
      await qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      onOpened(r.room_id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New conversation"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={picked.length === 0 || (group && !name.trim())} onClick={() => void start()}>
            {group ? 'Create group' : 'Open chat'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {picked.length ? (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(p)} className="flex items-center gap-1.5 rounded-full bg-selection px-2.5 py-1 text-[12.5px] font-semibold text-ink" aria-label={`Remove ${p.name}`}>
                {p.name} <Icon name="x" size={12} />
              </button>
            ))}
          </div>
        ) : null}
        {group ? (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" aria-label="Group name" maxLength={120} className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary" />
        ) : null}
        <div className="flex h-9 items-center gap-2 rounded-[8px] border border-line px-3 focus-within:border-primary">
          <Icon name="search" size={15} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" autoFocus className="flex-1 bg-transparent text-[13px] outline-none" />
        </div>
        <div className="max-h-72 overflow-y-auto scroll-thin" role="listbox" aria-label="People" aria-multiselectable>
          {people.isLoading ? <Spinner /> : null}
          {list.map((p) => {
            const on = picked.some((x) => x.id === p.id);
            return (
              <button key={p.id} type="button" role="option" aria-selected={on} onClick={() => toggle(p)} className={cx('flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left', on ? 'bg-selection' : 'hover:bg-subtle')}>
                <Avatar name={p.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{p.name}</span>
                  {p.email ? <span className="block truncate text-[12px] text-ink-3">{p.email}</span> : null}
                </span>
                {on ? <Icon name="check" size={16} className="text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
