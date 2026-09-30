import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { OFFICE_KIND_LABELS, officeKind, type OfficeEditorEventName, type OfficeViewEvent } from '@shared/office';
import { ApiError, apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { ui } from '../../core/ui';
import { detachTab } from '../../core/tabs';
import { Button, ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import { useEditorPlacement } from './EditorSurface';
import { openInApp } from './local';
import { BuiltinEditor } from './BuiltinEditor';
import { betterFormat } from './better/format';

/** `GET /api/office/config/{id}`: the server's EuroOffice editor configuration, signed for the Document Server. */
export interface ClassicConfig {
  ds_url: string;
  config: Record<string, unknown> & { document?: { title?: string; fileType?: string }; editorConfig?: { mode?: string } };
  editable: boolean;
}

/** The Document Server's own script, under its address. */
export function classicApiUrl(dsUrl: string): string {
  return `${dsUrl.replace(/\/+$/, '')}/web-apps/apps/api/documents/api.js`;
}

const EVENTS: OfficeEditorEventName[] = ['onAppReady', 'onDocumentReady', 'onDocumentStateChange', 'onError'];

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));

/**
 * An Office document in WorkSuite's editor on a server that has the EuroOffice
 * editor but not the Office session API (`/api/office/config/{id}`, the web's
 * own editor): the Document Server's editor inside the app, in the same
 * isolated view as the full editor, never the browser. The Document Server
 * saves to WorkSuite as people edit (its callback makes the new version);
 * this tab says when changes are still on their way.
 */
export function ClassicEditor({ tabKey, fileId, routeName, active }: { tabKey: string; fileId: number; routeName: string | null; active: boolean }) {
  const q = useQuery({ queryKey: ['office', 'classic-config', fileId], queryFn: () => apiGet<ClassicConfig>(`/api/office/config/${fileId}`), retry: false, staleTime: 0, gcTime: 0 });
  const [orgId] = useState(() => app.get().organizationId);
  const [viewId, setViewId] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'editing'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [builtin, setBuiltin] = useState(false);
  const covered = useStore(ui, (x) => x.overlay !== null || x.dock === 'chat');
  const ref = useRef<HTMLDivElement>(null);
  const cfg = q.data;
  const name = cfg?.config.document?.title ?? routeName ?? 'Document';
  useTabTitle(name);

  useEffect(() => {
    if (!cfg || builtin) return;
    let gone = false;
    let id: string | null = null;
    call('office:open', {
      key: tabKey,
      fileId,
      sessionId: newId(),
      organizationId: orgId,
      documentServerUrl: cfg.ds_url,
      apiUrl: classicApiUrl(cfg.ds_url),
      config: cfg.config,
      events: EVENTS,
    }).then(
      (r) => {
        if (gone) return void call('office:close', { viewId: r.viewId }).catch(() => undefined);
        id = r.viewId;
        setViewId(r.viewId);
      },
      (e) => !gone && setProblem(errorMessage(e)),
    );
    const off = on<OfficeViewEvent>('office:event', (ev) => {
      if (!id || ev.viewId !== id) return;
      if (ev.type === 'onDocumentReady') setState('ready');
      else if (ev.type === 'onDocumentStateChange') setState((ev.data as { data?: boolean } | boolean | null) && (typeof ev.data === 'boolean' ? ev.data : (ev.data as { data?: boolean }).data) ? 'editing' : 'ready');
      else if (ev.type === 'scriptFailed') setProblem('The Office editor could not be loaded from the Document Server. Check the connection, or ask your administrator to check its address.');
      else if (ev.type === 'crashed') setProblem('The Office editor stopped. Reload to open the document again.');
      else if (ev.type === 'onError') {
        const d = ev.data as { data?: { errorDescription?: string } } | null;
        setProblem(d?.data?.errorDescription ?? 'The Office editor reported a problem.');
      }
    });
    return () => {
      gone = true;
      off();
      if (id) void call('office:close', { viewId: id }).catch(() => undefined);
    };
  }, [builtin, cfg, fileId, orgId, tabKey]);

  useEditorPlacement(ref, viewId, active && !covered && !problem);

  const installed = () => void openInApp({ id: fileId, name, folderId: null, version: 0 }, 'default');

  if (q.isLoading) return <Spinner label="Opening the document…" />;
  // No EuroOffice editor on this server (not set up, or not there at all): WorkSuite's built-in editor instead.
  if (q.error instanceof ApiError && (q.error.status === 503 || q.error.status === 404 || q.error.status === 501)) {
    return <BuiltinEditor tabKey={tabKey} source={{ kind: 'drive', fileId }} routeName={routeName} active={active} notice="The Document Server is not available on your WorkSuite server, so this file is edited in WorkSuite’s built-in editor. It still saves to your Drive." />;
  }
  if (builtin) return <BuiltinEditor tabKey={tabKey} source={{ kind: 'drive', fileId }} routeName={routeName} active={active} notice="The Document Server could not open this file, so it is edited in WorkSuite’s built-in editor. It still saves to your Drive." />;
  if (q.error || problem) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col gap-3 p-8">
        <ErrorNote error={new Error(problem ?? errorMessage(q.error))} onRetry={() => (setProblem(null), void q.refetch())} />
        <p className="text-[12.5px] text-ink-2">You can still open it in Word, Excel or PowerPoint on this computer; your changes are saved back to the Drive.</p>
        <div className="flex gap-2">
          {betterFormat(name) ? (
            <Button variant="primary" onClick={() => setBuiltin(true)}>
              Edit in the built-in editor
            </Button>
          ) : null}
          <Button onClick={installed}>Open in the installed app</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3.5">
        <FileBadge name={name} size={26} />
        {officeKind(name) ? <span className="shrink-0 text-[12px] font-bold text-primary">{OFFICE_KIND_LABELS[officeKind(name)!]}</span> : null}
        <b className="min-w-0 truncate text-[13.5px] font-semibold text-ink">{name}</b>
        <span className={cx('text-[12px]', state === 'editing' ? 'text-warning' : 'text-ink-3')}>
          {!cfg?.editable ? 'Read-only' : state === 'loading' ? 'Opening…' : state === 'editing' ? 'Saving…' : 'Saved to your Drive'}
        </span>
        <span className="flex-1" />
        <Button size="sm" icon="external" onClick={() => void detachTab(tabKey)} title="Move this document to a window of its own">
          New window
        </Button>
        <Button size="sm" onClick={installed}>
          Open in desktop app
        </Button>
      </header>
      <div ref={ref} data-office-editor className="relative min-h-0 min-w-0 flex-1 bg-white" />
    </div>
  );
}
