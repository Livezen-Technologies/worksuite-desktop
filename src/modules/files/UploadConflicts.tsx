import { useState } from 'react';
import { bytes, relative } from '../../core/time';
import { Button, FileBadge, Modal } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';

/**
 * A file being uploaded has the name of one already in the folder: replace it
 * (it becomes a new version; the one there now stays in its history) or keep
 * both (the upload takes the next free "name (n).ext"), or skip it. Asked once
 * per clash, with "do the same for the rest" when more are waiting.
 */
export interface UploadConflict {
  /** The name as it is being uploaded. */
  name: string;
  file_id: number;
  /** The name of the file already there (the same, but perhaps in another case). */
  existing: string;
  size: number;
  updated_at: string | null;
  can_replace: boolean;
  free_name: string;
}

export type ConflictChoice = { how: 'replace'; fileId: number } | { how: 'both'; name: string } | { how: 'skip' };

export function UploadConflicts({ conflicts, folderName, onDone, onCancel }: {
  conflicts: UploadConflict[];
  folderName: string;
  /** One choice per conflict, in the same order. */
  onDone: (choices: ConflictChoice[]) => void;
  onCancel: () => void;
}) {
  const [at, setAt] = useState(0);
  const [choices, setChoices] = useState<ConflictChoice[]>([]);
  const [all, setAll] = useState(false);
  const c = conflicts[at]!;
  const left = conflicts.length - at - 1;

  const choose = (how: 'replace' | 'both' | 'skip') => {
    const one = (x: UploadConflict): ConflictChoice =>
      // Replacing is only for files this person may edit; the rest are kept side by side.
      how === 'replace' && x.can_replace ? { how: 'replace', fileId: x.file_id } : how === 'skip' ? { how: 'skip' } : { how: 'both', name: x.free_name };
    const next = all ? [...choices, ...conflicts.slice(at).map(one)] : [...choices, one(c)];
    if (next.length >= conflicts.length) return onDone(next);
    setChoices(next);
    setAt(at + 1);
  };

  return (
    <Modal
      title="Replace or keep both?"
      onClose={onCancel}
      width={500}
      footer={
        <>
          <Button onClick={onCancel}>Cancel upload</Button>
          <span className="flex-1" />
          <Button onClick={() => choose('skip')}>Skip</Button>
          <Button onClick={() => choose('both')}>Keep both</Button>
          <Button variant="primary" disabled={!c.can_replace && !all} onClick={() => choose('replace')} title={c.can_replace ? undefined : 'You can’t change this file; keep both instead'}>
            Replace
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]" data-upload-conflict>
        <p className="m-0 text-ink">
          A file named <b>“{c.existing}”</b> is already in <b>{folderName}</b>.
          {conflicts.length > 1 ? <span className="text-ink-3"> ({at + 1} of {conflicts.length})</span> : null}
        </p>
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-well px-3 py-2.5">
          <FileBadge name={c.existing} size={36} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{c.existing}</b>
            <span className="text-[12px] text-ink-3">
              {bytes(c.size)}
              {c.updated_at ? ` · changed ${relative(c.updated_at)}` : ''}
            </span>
          </span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px] text-ink-2">
          <li>
            <b className="text-ink">Replace</b> — the upload becomes the new version; the one there now stays in its version history.
            {!c.can_replace ? <span className="text-ink-3"> You can’t change this file, so it can only be kept alongside.</span> : null}
          </li>
          <li>
            <b className="text-ink">Keep both</b> — the upload is saved as <b className="text-ink">“{c.free_name}”</b>.
          </li>
          <li>
            <b className="text-ink">Skip</b> — this file is not uploaded.
          </li>
        </ul>
        {left > 0 ? (
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} />
            Do the same for the other {left} {left === 1 ? 'file' : 'files'} with a name already here
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
