import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGetMeta } from '../core/api';
import { bytes } from '../core/time';
import { Icon } from './Icon';
import { Button, ErrorNote, FileBadge, Modal, Spinner, cx } from './ui';
import { Checkbox } from './Checkbox';

export interface DriveEntry {
  id: number | string;
  name: string;
}
export interface DriveFileRow extends DriveEntry {
  size: number;
  extension: string | null;
}
interface Browse {
  folder_id: number | null;
  breadcrumb: Array<{ id: number; name: string }>;
  locked: boolean;
  folders: DriveEntry[];
  files: DriveFileRow[];
}

/**
 * Choose files from your Drive: folders open, files tick. What happens to the
 * choice (sent to a conversation, attached to a task) is the caller's.
 */
export function DriveFilePicker({ title, confirmLabel, busy, onChoose, onClose }: { title: string; confirmLabel: string; busy?: boolean; onChoose: (files: DriveFileRow[]) => void; onClose: () => void }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [chosen, setChosen] = useState<DriveFileRow[]>([]);
  const q = useQuery({ queryKey: ['files', 'browse', folder], queryFn: ({ signal }) => apiGetMeta<Browse>('/api/files/browse', { folder_id: folder }, signal) });
  const data = q.data?.data;
  const toggle = (f: DriveFileRow) => setChosen((c) => (c.some((x) => x.id === f.id) ? c.filter((x) => x.id !== f.id) : [...c, f]));
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-ink-3">{chosen.length ? `${chosen.length} chosen` : 'Choose one or more files'}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!chosen.length || busy} loading={busy} onClick={() => onChoose(chosen)}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-[12.5px]">
          <button type="button" onClick={() => setFolder(null)} className={cx('rounded-[6px] px-1.5 py-0.5 hover:bg-subtle', folder === null ? 'font-bold text-ink' : 'text-primary')}>My Drive</button>
          {(data?.breadcrumb ?? []).map((b) => (
            <span key={b.id} className="flex items-center gap-1">
              <Icon name="chevron-right" size={12} className="text-ink-3" />
              <button type="button" onClick={() => setFolder(String(b.id))} className={cx('rounded-[6px] px-1.5 py-0.5 hover:bg-subtle', String(b.id) === folder ? 'font-bold text-ink' : 'text-primary')}>{b.name}</button>
            </span>
          ))}
        </nav>
        <div className="h-[320px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
          {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
          {data?.locked ? <p className="px-3 py-6 text-center text-[12.5px] text-ink-3">This folder is locked. Unlock it in Files first.</p> : null}
          {data && !data.locked && !data.folders.length && !data.files.length ? <p className="px-3 py-6 text-center text-[12.5px] text-ink-3">This folder is empty.</p> : null}
          {(data?.folders ?? []).map((f) => (
            <button key={`d${f.id}`} type="button" onClick={() => setFolder(String(f.id))} className="flex w-full items-center gap-2.5 border-b border-line/60 px-3 py-2 text-left text-[13px] text-ink hover:bg-subtle">
              <Icon name="folder" size={17} className="text-warning" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <Icon name="chevron-right" size={14} className="text-ink-3" />
            </button>
          ))}
          {(data?.files ?? []).map((f) => {
            const on = chosen.some((x) => x.id === f.id);
            return (
              <label key={`f${f.id}`} className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3 py-2 text-[13px]', on ? 'bg-selection' : 'hover:bg-subtle')}>
                <Checkbox checked={on} onChange={() => toggle(f)} aria-label={f.name} />
                <FileBadge name={f.name} size={26} />
                <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                <span className="shrink-0 text-[12px] text-ink-3">{bytes(f.size)}</span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
