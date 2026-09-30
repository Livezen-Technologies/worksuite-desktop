import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { OFFICE_KIND_LABELS, officeKind, officeRoute, type OfficeDocSource } from '@shared/office';
import { apiGet, apiUrl, request } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { detachTab, navigate, setCloseGuard } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Button, ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import type { BetterEditorApi, PreparedFile } from './better/BetterEditor';
import { betterFormat } from './better/format';
import { openInApp } from './local';

const BetterEditor = lazy(() => import('./better/BetterEditor'));

/** Where a built-in editor tab's document comes from, and so where Save puts it. */
export type EditorSource = { kind: 'drive'; fileId: number } | { kind: 'offline'; fileId: number; name: string } | OfficeDocSource;

interface FileInfo {
  id: number;
  name: string;
  extension?: string | null;
  version?: number | null;
  folder_id?: number | null;
  access?: Record<string, boolean> | null;
}

type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';

/** `POST /api/files/{id}/versions`: the edited bytes as the file's next version. */
export async function saveVersion(fileId: number, name: string, bytes: Uint8Array, baseVersion: number | null): Promise<number | null> {
  const form = new FormData();
  form.set('file', new Blob([bytes as BlobPart]), name);
  if (baseVersion) form.set('base_version', String(baseVersion));
  const r = await request<{ current?: { version?: number }; version?: number }>('POST', `/api/files/${fileId}/versions`, { body: form });
  return Number(r.data?.current?.version ?? r.data?.version ?? 0) || null;
}

/** The document's bytes, from wherever the tab's source says. */
export async function loadBytes(source: EditorSource): Promise<Uint8Array> {
  if (source.kind === 'local') return new Uint8Array(await call('office:readFile', { handle: source.handle }));
  if (source.kind === 'offline') return new Uint8Array(await call('office:readOffline', { fileId: source.fileId }));
  const path = source.kind === 'drive' ? `/api/files/${source.fileId}/download` : source.path;
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(res.status === 403 ? 'You may not download this file, so it cannot be opened here.' : `The file could not be read (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * An Office file in WorkSuite's built-in editor (BetterOffice) — the local runtime of a WorkSuite DOC / Sheet /
 * Slides tab: a Drive file with no Document Server to edit it, a file from this computer, or one another module
 * shows (a mail attachment, a tender's document). Save puts it back where it came from: a new Drive version, the
 * file on this computer, or — for an attachment, which has nowhere to go back to — a new file in My files. Save a
 * copy writes it where the person chooses.
 */
export function BuiltinEditor({ tabKey, source, routeName, active, notice }: { tabKey: string; source: EditorSource; routeName: string | null; active: boolean; notice?: string | null }) {
  const qc = useQueryClient();
  const author = useStore(app, (s) => s.auth?.user?.name ?? null);
  const drive = source.kind === 'drive' ? source.fileId : null;
  const info = useQuery({ queryKey: ['office', 'builtin-info', drive], enabled: drive !== null, queryFn: () => apiGet<FileInfo>(`/api/files/${drive}`), staleTime: 0, gcTime: 0, retry: false });
  const name = info.data?.name ?? (source.kind === 'drive' ? routeName : source.name) ?? 'Document';
  const format = betterFormat(name, info.data?.extension);
  const kind = officeKind(name, info.data?.extension);
  const canEdit = source.kind !== 'drive' || !info.data?.access || info.data.access.edit !== false;
  useTabTitle(name);

  const sourceKey = source.kind === 'drive' ? `d${source.fileId}` : source.kind === 'offline' ? `o${source.fileId}` : source.kind === 'local' ? `l${source.handle}` : `a${source.path}`;
  const prepared = useQuery({
    queryKey: ['office', 'builtin-file', sourceKey],
    enabled: (drive === null || !!info.data) && !!format,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<PreparedFile> => {
      const bytes = await loadBytes(source);
      const { prepareFile } = await import('./better/BetterEditor');
      return prepareFile(bytes, format!);
    },
  });

  const [state, setState] = useState<SaveState>('saved');
  const [version, setVersion] = useState<number | null>(null);
  const api = useRef<BetterEditorApi | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const base = version ?? info.data?.version ?? null;

  /** An attachment saved into My files: from then on the tab is that Drive file. */
  const toDrive = useCallback(
    async (bytes: Uint8Array) => {
      const r = await uploadBlob(new Blob([bytes as BlobPart]), name, { kind: 'files', folderId: null });
      void qc.invalidateQueries({ queryKey: ['files'] });
      toast('success', `“${name}” saved to My files.`, r.fileId ? { label: 'Open it', run: () => navigate(officeRoute(r.fileId!, { name }), app.get().organizationId) } : undefined);
    },
    [name, qc],
  );

  const upload = useCallback(
    (bytes: Uint8Array) => {
      const run = async () => {
        setState('saving');
        try {
          if (source.kind === 'drive') {
            const v = await saveVersion(source.fileId, name, bytes, base);
            setVersion(v ?? (base ? base + 1 : null));
            void qc.invalidateQueries({ queryKey: ['files'] });
          } else if (source.kind === 'offline') {
            await call('office:writeOffline', { fileId: source.fileId, bytes: new Uint8Array(bytes) });
          } else if (source.kind === 'local') {
            await call('office:writeFile', { handle: source.handle, bytes: new Uint8Array(bytes) });
          } else {
            await toDrive(bytes);
          }
          setState('saved');
        } catch (e) {
          setState('failed');
          toast('error', `Not saved: ${errorMessage(e)}`);
          throw e;
        }
      };
      const next = (saving.current ?? Promise.resolve()).then(run, run);
      saving.current = next.catch(() => undefined);
      return next;
    },
    [base, name, qc, source, toDrive],
  );
  const save = useCallback(async () => {
    if (!api.current) return;
    await upload(await api.current.serialize());
  }, [upload]);
  const saveCopy = async () => {
    if (!api.current) return;
    try {
      const r = await call('office:saveCopy', { name, bytes: new Uint8Array(await api.current.serialize()) });
      if (r) toast('success', `A copy was saved as “${r.name}”.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const saveToDrive = async () => {
    if (!api.current) return;
    try {
      await toDrive(await api.current.serialize());
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // Closing the tab with changes saves them first (an attachment's go to My files: nothing is lost).
  const dirty = state === 'unsaved' || state === 'failed';
  useEffect(() => {
    setCloseGuard(tabKey, () => (dirty && canEdit ? save().catch(() => undefined) : null));
    return () => setCloseGuard(tabKey, null);
  }, [tabKey, dirty, canEdit, save]);

  const onReady = useCallback((a: BetterEditorApi | null) => {
    api.current = a;
  }, []);
  const installed = () => (drive !== null ? void openInApp({ id: drive, name, folderId: info.data?.folder_id ?? null, version: base ?? 0 }, 'default') : void saveCopy());

  if ((drive !== null && info.isLoading) || (format && prepared.isLoading)) return <Spinner label="Opening the document…" />;
  const problem = info.error ?? prepared.error ?? (!format && (drive === null || info.data) ? new Error('The built-in editor opens .docx, .xlsx and .pptx files. Open this one in an installed app.') : null);
  if (problem || !prepared.data) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col gap-3 p-8">
        <ErrorNote error={new Error(errorMessage(problem))} onRetry={() => void (info.error ? info.refetch() : prepared.refetch())} />
        {drive !== null ? (
          <Button className="self-start" onClick={installed}>
            Open in the installed app
          </Button>
        ) : null}
      </div>
    );
  }
  const where = source.kind === 'drive' ? (base ? `Saved · v${base}` : 'Saved') : source.kind === 'offline' ? 'Saved on this computer · goes to your Drive when you are online' : source.kind === 'local' ? 'Saved on this computer' : 'Not in your Drive';
  const label = !canEdit ? 'Read-only' : state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes' : state === 'failed' ? 'Not saved' : where;
  return (
    <div className="flex h-full min-h-0 flex-col" data-active={active || undefined}>
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3.5">
        <FileBadge name={name} size={26} />
        {kind ? <span className="shrink-0 text-[12px] font-bold text-primary">{OFFICE_KIND_LABELS[kind]}</span> : null}
        <b className="min-w-0 truncate text-[13.5px] font-semibold text-ink">{name}</b>
        <span className={cx('shrink-0 text-[12px]', state === 'failed' ? 'text-danger' : state === 'unsaved' ? 'text-warning' : 'text-ink-3')}>{label}</span>
        <span className="flex-1" />
        {source.kind === 'api' || source.kind === 'local' ? (
          <Button size="sm" icon="upload" onClick={() => void saveToDrive()} title="Save this document as a new file in My files">
            Save to Drive
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void saveCopy()} title="Save a copy on this computer">
          Save a copy
        </Button>
        <Button size="sm" icon="external" onClick={() => void detachTab(tabKey)} title="Move this document to a window of its own (changes are saved first)">
          New window
        </Button>
        {canEdit && source.kind !== 'api' ? (
          <Button size="sm" variant="primary" disabled={state === 'saving' || state === 'saved'} onClick={() => void save().catch(() => undefined)}>
            Save
          </Button>
        ) : null}
      </header>
      {notice ? <div role="status" className="shrink-0 border-b border-line bg-warning-bg px-3.5 py-1.5 text-[12px] text-ink-2">{notice}</div> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white text-[#111]">
        <Suspense fallback={<Spinner label="Starting the editor…" />}>
          <BetterEditor
            file={prepared.data}
            name={name}
            readOnly={!canEdit}
            author={author}
            onSave={(bytes) => void upload(bytes).catch(() => undefined)}
            onChange={() => setState((s) => (s === 'saving' ? s : 'unsaved'))}
            onError={(e) => toast('error', errorMessage(e))}
            onReady={onReady}
          />
        </Suspense>
      </div>
    </div>
  );
}
