import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { OfficeTemplate } from '@shared/office';
import { errorMessage } from '../../core/bridge';
import { Button, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { templates } from '../office/api';

const KINDS: Array<[OfficeTemplate['kind'], string]> = [
  ['document', 'Documents'],
  ['spreadsheet', 'Spreadsheets'],
  ['presentation', 'Presentations'],
];

/**
 * + New → From a template (OO-DRV-051/052): the company's templates and
 * WorkSuite's own, by kind. Choosing one makes a new file from it in this
 * folder — a copy, with no link back to the template — and opens it.
 */
export function TemplateDialog({ folderName, onClose, onPick }: { folderName: string; onClose: () => void; onPick: (t: OfficeTemplate) => Promise<void> }) {
  const q = useQuery({ queryKey: ['files', 'office-templates'], queryFn: () => templates(), staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const list = q.data?.templates ?? [];
  const pick = async (t: OfficeTemplate) => {
    setBusy(t.id);
    try {
      await onPick(t);
      onClose();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="New from a template" onClose={onClose} width={620} footer={<Button onClick={onClose}>Cancel</Button>}>
      <p className="mb-3 text-[12.5px] text-ink-2">The new file goes in {folderName} and opens for editing.</p>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={new Error(errorMessage(q.error))} onRetry={() => void q.refetch()} /> : null}
      {q.data && !list.length ? <p className="text-[12.5px] text-ink-3">There are no templates yet.</p> : null}
      {KINDS.map(([kind, label]) => {
        const rows = list.filter((t) => t.kind === kind);
        if (!rows.length) return null;
        return (
          <section key={kind} className="mb-3">
            <h3 className="mb-1.5 text-[11px] font-bold tracking-[0.6px] text-ink-2 uppercase">{label}</h3>
            <div className="grid grid-cols-2 gap-2">
              {rows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void pick(t)}
                  className={cx('flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left hover:bg-ground disabled:opacity-60', busy === t.id && 'border-primary')}
                >
                  <FileBadge name={`x.${t.extension}`} size={30} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold text-ink">{t.name}</b>
                    <span className="block truncate text-[11.5px] text-ink-3">{[t.category, t.scope === 'organization' ? 'Your company' : 'WorkSuite'].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </Modal>
  );
}
