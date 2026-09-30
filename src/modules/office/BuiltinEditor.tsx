import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiUrl, request } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { detachTab, setCloseGuard } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import type { BetterEditorApi, PreparedFile } from './better/BetterEditor';
import { betterFormat } from './better/format';
import { openInApp } from './local';

const BetterEditor = lazy(() => import('./better/BetterEditor'));

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

/**
 * An Office file in WorkSuite's built-in editor (BetterOffice): for when there is no Document Server to edit it
 * with and no Office app on this computer. The file is read from the Drive, edited here in WebAssembly, and saved
 * back as a new version — with Save, the editor's own Save (Ctrl/⌘ S), and when the tab closes.
 */
export function BuiltinEditor({ tabKey, fileId, routeName, active }: { tabKey: string; fileId: number; routeName: string | null; active: boolean }) {
  const qc = useQueryClient();
  const author = useStore(app, (s) => s.auth?.user?.name ?? null);
  const info = useQuery({ queryKey: ['office', 'builtin-info', fileId], queryFn: () => apiGet<FileInfo>(`/api/files/${fileId}`), staleTime: 0, gcTime: 0, retry: false });
  const name = info.data?.name ?? routeName ?? 'Document';
  const format = betterFormat(name, info.data?.extension);
  const canEdit = info.data?.access ? info.data.access.edit !== false : true;
  useTabTitle(name);

  const prepared = useQuery({
    queryKey: ['office', 'builtin-file', fileId],
    enabled: !!info.data && !!format,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<PreparedFile> => {
      const res = await fetch(apiUrl(`/api/files/${fileId}/download`));
      if (!res.ok) throw new Error(res.status === 403 ? 'You may not download this file, so it cannot be opened here.' : `The file could not be read (${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { prepareFile } = await import('./better/BetterEditor');
      return prepareFile(bytes, format!);
    },
  });

  const [state, setState] = useState<SaveState>('saved');
  const [version, setVersion] = useState<number | null>(null);
  const api = useRef<BetterEditorApi | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const base = version ?? info.data?.version ?? null;

  const upload = useCallback(
    (bytes: Uint8Array) => {
      const run = async () => {
        setState('saving');
        try {
          const v = await saveVersion(fileId, name, bytes, base);
          setVersion(v ?? (base ? base + 1 : null));
          setState('saved');
          void qc.invalidateQueries({ queryKey: ['files'] });
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
    [base, fileId, name, qc],
  );
  const save = useCallback(async () => {
    if (!api.current) return;
    await upload(await api.current.serialize());
  }, [upload]);

  // Closing the tab with changes saves them first.
  const dirty = state === 'unsaved' || state === 'failed';
  useEffect(() => {
    setCloseGuard(tabKey, () => (dirty && canEdit ? save().catch(() => undefined) : null));
    return () => setCloseGuard(tabKey, null);
  }, [tabKey, dirty, canEdit, save]);

  const onReady = useCallback((a: BetterEditorApi | null) => {
    api.current = a;
  }, []);
  const installed = () => void openInApp({ id: fileId, name, folderId: info.data?.folder_id ?? null, version: base ?? 0 }, 'default');

  if (info.isLoading || (format && prepared.isLoading)) return <Spinner label="Opening the document…" />;
  const problem = info.error ?? prepared.error ?? (!format && info.data ? new Error('The built-in editor opens .docx, .xlsx and .pptx files. Open this one in an installed app.') : null);
  if (problem || !prepared.data) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col gap-3 p-8">
        <ErrorNote error={new Error(errorMessage(problem))} onRetry={() => void (info.error ? info.refetch() : prepared.refetch())} />
        <Button className="self-start" onClick={installed}>
          Open in the installed app
        </Button>
      </div>
    );
  }
  const label = !canEdit ? 'Read-only' : state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes' : state === 'failed' ? 'Not saved' : base ? `Saved · v${base}` : 'Saved';
  return (
    <div className="flex h-full min-h-0 flex-col" data-active={active || undefined}>
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3.5">
        <FileBadge name={name} size={26} />
        <b className="min-w-0 truncate text-[13.5px] font-semibold text-ink">{name}</b>
        <span className={cx('text-[12px]', state === 'failed' ? 'text-danger' : state === 'unsaved' ? 'text-warning' : 'text-ink-3')}>{label}</span>
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-3" title="Edited inside WorkSuite by BetterOffice">
          Built-in editor
        </span>
        <span className="flex-1" />
        <Button size="sm" icon="external" onClick={() => void detachTab(tabKey)} title="Move this document to a window of its own (unsaved changes are saved first)">
          New window
        </Button>
        {canEdit ? (
          <Button size="sm" variant="primary" disabled={state === 'saving' || state === 'saved'} onClick={() => void save().catch(() => undefined)}>
            Save
          </Button>
        ) : null}
      </header>
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
