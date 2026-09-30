import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OfficeLocalCopy } from '@shared/office';
import { apiGetMeta } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { openInOffice } from '../../core/open-document';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import { OFFICE_EXTS, type DriveFile, type DriveList } from '../files/api';
import { openOfficeTab, useOfficeRouting } from '../files/office';
import { TemplateDialog } from '../files/Templates';
import { createDocument } from './api';
import { ConflictDialog, LocalCopyRow, useLocalCopies } from './local';

type Kind = 'document' | 'spreadsheet' | 'presentation';

const NEW: Array<{ kind: Kind; label: string; hint: string; sample: string }> = [
  { kind: 'document', label: 'Document', hint: 'Word · .docx', sample: 'x.docx' },
  { kind: 'spreadsheet', label: 'Spreadsheet', hint: 'Excel · .xlsx', sample: 'x.xlsx' },
  { kind: 'presentation', label: 'Presentation', hint: 'PowerPoint · .pptx', sample: 'x.pptx' },
];

const ext = (f: Pick<DriveFile, 'name' | 'extension'>) => (f.extension || f.name.split('.').pop() || '').toLowerCase();

/** The Office files among a Drive list, newest first, at most `max`. */
export function officeFiles(files: DriveFile[], max = 30): DriveFile[] {
  return files.filter((f) => OFFICE_EXTS.includes(ext(f))).slice(0, max);
}

/**
 * Office (the launcher's tile): start a document, spreadsheet or presentation —
 * blank or from a template — in My files, and get back to the Office files
 * opened lately and the copies being edited in Word, Excel or PowerPoint on
 * this computer. A file opens in WorkSuite's EuroOffice editor, inside the
 * app — never in the browser.
 */
export function OfficeHome() {
  const routing = useOfficeRouting();
  const qc = useQueryClient();
  const copies = useLocalCopies();
  const [templates, setTemplates] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [conflict, setConflict] = useState<OfficeLocalCopy | null>(null);
  const recent = useQuery({
    queryKey: ['files', 'office-recent'],
    queryFn: ({ signal }) => apiGetMeta<DriveList>('/api/drive/list', { view: 'recent', per_page: 100, counts: 0, sort: 'modified', dir: 'desc' }, signal),
    refetchInterval: 120_000,
  });
  const files = officeFiles(recent.data?.data.files ?? []);
  const canCreate = !routing.legacy;

  // A file on this computer: the main process's dialog, then a WorkSuite DOC / Sheet / Slides tab on its handle.
  const openLocal = async () => {
    try {
      for (const f of await call('office:pickFile')) openInOffice({ kind: 'local', handle: f.handle, name: f.name });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  // WorkSuite's editor, inside the app (OfficePage picks the full session or the EuroOffice editor).
  const open = (f: DriveFile) => void openOfficeTab(f);
  const create = async (input: { type?: Kind; template_id?: string }) => {
    try {
      const r = await createDocument({ ...input, folder_id: null });
      toast('success', `“${r.file.name}” created in My files`);
      void qc.invalidateQueries({ queryKey: ['files'] });
      void openOfficeTab(r.file, 'EDIT');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="h-full overflow-auto bg-ground scroll-thin">
      <div className="mx-auto flex max-w-[980px] flex-col gap-6 px-6 py-6">
        <header>
          <h1 className="text-[22px] font-bold text-ink">Office</h1>
          <p className="text-[13px] text-ink-2">Documents, spreadsheets and presentations from your Drive.</p>
        </header>

        <section aria-label="New">
          <h2 className="mb-2 text-[11px] font-bold tracking-[0.6px] text-ink-2 uppercase">New</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {NEW.map((n) => (
              <button
                key={n.kind}
                type="button"
                disabled={!canCreate || busy !== null}
                onClick={() => {
                  setBusy(n.kind);
                  void create({ type: n.kind }).finally(() => setBusy(null));
                }}
                className={cx('flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-left hover:border-primary disabled:opacity-60', busy === n.kind && 'border-primary')}
              >
                <FileBadge name={n.sample} size={36} />
                <span className="min-w-0">
                  <b className="block text-[13.5px] font-semibold text-ink">{n.label}</b>
                  <span className="block text-[11.5px] text-ink-3">{n.hint}</span>
                </span>
              </button>
            ))}
            <button type="button" onClick={() => void openLocal()} className="flex items-center gap-3 rounded-[12px] border border-dashed border-line bg-surface px-4 py-3.5 text-left hover:border-primary">
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-subtle text-ink-2">
                <Icon name="laptop" size={18} />
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-semibold text-ink">Open from this computer</b>
                <span className="block text-[11.5px] text-ink-3">.docx, .xlsx or .pptx, saved in place</span>
              </span>
            </button>
            <button type="button" disabled={!canCreate} onClick={() => setTemplates(true)} className="flex items-center gap-3 rounded-[12px] border border-dashed border-line bg-surface px-4 py-3.5 text-left hover:border-primary disabled:opacity-60">
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-subtle text-ink-2">
                <Icon name="grid" size={18} />
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-semibold text-ink">From a template</b>
                <span className="block text-[11.5px] text-ink-3">Your company’s and WorkSuite’s</span>
              </span>
            </button>
          </div>
          {!canCreate ? <p className="mt-2 text-[12px] text-ink-3">Your WorkSuite server does not create new Office documents yet. Files you open here edit in WorkSuite’s EuroOffice editor and save back to your Drive.</p> : null}
        </section>

        {copies.length ? (
          <section aria-label="On this computer">
            <h2 className="mb-2 text-[11px] font-bold tracking-[0.6px] text-ink-2 uppercase">Open in Word, Excel or PowerPoint</h2>
            <div className="rounded-[12px] border border-line bg-surface">
              {copies.map((c) => (
                <LocalCopyRow key={c.id} copy={c} onConflict={setConflict} />
              ))}
            </div>
          </section>
        ) : null}

        <section aria-label="Recent">
          <h2 className="mb-2 text-[11px] font-bold tracking-[0.6px] text-ink-2 uppercase">Recent</h2>
          {recent.isLoading ? <Spinner /> : null}
          {recent.error ? <ErrorNote error={new Error(errorMessage(recent.error))} onRetry={() => void recent.refetch()} /> : null}
          {recent.data && !files.length ? <p className="text-[12.5px] text-ink-3">Office files you open or edit show up here.</p> : null}
          {files.length ? (
            <ul className="rounded-[12px] border border-line bg-surface">
              {files.map((f) => (
                <li key={f.id} className="border-b border-line/60 last:border-b-0">
                  <button type="button" onClick={() => open(f)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-subtle">
                    <FileBadge name={f.name} size={30} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13px] font-semibold text-ink">{f.name}</b>
                      <span className="block truncate text-[11.5px] text-ink-3">{f.updated_at ? `Changed ${relative(f.updated_at)}` : ''}</span>
                    </span>
                    <span className="text-[12px] font-semibold text-primary">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
      {templates ? <TemplateDialog folderName="My files" onClose={() => setTemplates(false)} onPick={(t) => create({ template_id: t.id })} /> : null}
      {conflict ? <ConflictDialog copy={copies.find((c) => c.id === conflict.id) ?? conflict} onClose={() => setConflict(null)} onReview={(c) => void openOfficeTab({ id: c.fileId, name: c.name }, 'VIEW')} /> : null}
    </div>
  );
}
