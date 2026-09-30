import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { createDocument, templates, type OfficeTemplate } from './api';

const KIND_LABEL: Record<string, string> = { document: 'Documents', spreadsheet: 'Spreadsheets', presentation: 'Presentations' };

/**
 * New › From a template (WorkSuite Office): the server's three blanks and the
 * company's own templates; the new file is made in the folder shown and opens
 * straight away to edit.
 */
export function TemplatePicker({ folderId, onClose, onCreated }: { folderId: number | null; onClose: () => void; onCreated: (f: { id: number; name: string }) => void }) {
  const q = useQuery({ queryKey: ['office-templates'], queryFn: templates });
  const [picked, setPicked] = useState<OfficeTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groups = new Map<string, OfficeTemplate[]>();
  for (const t of q.data ?? []) {
    const k = t.kind ?? 'document';
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const create = async (t: OfficeTemplate | null = picked) => {
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createDocument({ template_id: t.id, folder_id: folderId });
      onCreated(r.file);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New from a template"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!picked} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {error ? <ErrorNote error={error} /> : null}
      {[...groups.entries()].map(([kind, list]) => (
        <section key={kind} className="mb-4">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{KIND_LABEL[kind] ?? kind}</h3>
          <div className="grid grid-cols-2 gap-2">
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={picked?.id === t.id}
                onClick={() => setPicked(t)}
                onDoubleClick={() => {
                  setPicked(t);
                  void create(t);
                }}
                className={cx('rounded-[10px] border px-3 py-2 text-left text-[13px]', picked?.id === t.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}
              >
                <span className="block truncate font-semibold text-ink">{t.name}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {t.scope === 'organization' ? 'Your company' : 'Blank'} · .{t.extension}
                  {t.category ? ` · ${t.category}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {q.data && q.data.length === 0 ? <p className="text-[13px] text-ink-2">There are no templates yet.</p> : null}
    </Modal>
  );
}
