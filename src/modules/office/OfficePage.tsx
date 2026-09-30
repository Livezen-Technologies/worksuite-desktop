import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { officeExportToken, officeRoute, parseOfficeRoute, type ExternalApp, type OfficeCollaborator, type OfficeLocalCopy, type OfficeMode } from '@shared/office';
import { app, organizationName } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { activate, closeTab, navigate, setCloseGuard, takeCloseReason } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { ui } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Empty, FileBadge, Modal, Spinner, TextField, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import type { DriveFile } from '../files/api';
import type { Item } from '../files/ctx';
import { LinkDialog, SecureLinkDialog, SendToChatDialog } from '../files/Dialogs';
import { PopMenu, below, type MenuItem } from '../files/Menu';
import { ShareDialog } from '../files/Share';
import { clock, convertLegacy, exportDocument, names, restoreVersion, versions, type OfficeRefusal } from './api';
import { EditorSurface } from './EditorSurface';
import { OfficeHome } from './OfficeHome';
import { ClassicEditor } from './ClassicEditor';
import { BuiltinEditor } from './BuiltinEditor';
import { useOfficeRouting } from '../files/office';
import { ConflictDialog, LocalCopyRow, externalApps, openInApp, useLocalCopies } from './local';
import { OfficeSession, type OfficeState } from './session';

/**
 * An Office document in a WorkSuite tab (OO-DSK-001/002): the header — the
 * file's name, the save status ("Saved · 14:32", "Saving…", "Save failed
 * [Retry]"), who else is in it, the mode, Share and ⋯ — and the Document
 * Server's editor below it, in its own isolated view. One tab per document
 * (OO-DSK-004); every button follows the session's `permissions`, and
 * every refusal is the server's own sentence.
 */
export default function OfficePage({ tabId, route, active }: ModuleProps) {
  const parsed = parseOfficeRoute(route);
  // The launcher's Office tile: new documents, templates and the recent ones.
  if (!parsed && /^\/office\/?(?:[?#].*)?$/.test(route)) return <OfficeHome />;
  if (!parsed) return <Empty icon="file-text" title="This is not a document" hint="Open Office documents from Files." />;
  if (parsed.builtin) return <BuiltinEditor key={`b${parsed.fileId}`} tabKey={tabId} fileId={parsed.fileId} routeName={parsed.name} active={active} />;
  return <OfficeTab key={parsed.fileId} tabId={tabId} fileId={parsed.fileId} requested={parsed.mode} routeName={parsed.name} active={active} />;
}

/**
 * Which editor a document gets: the full Office session (the server's Office API) or, on a server with only the
 * EuroOffice editor (`/api/office/config`), that editor — inside the app either way, never the browser.
 */
function OfficeTab({ tabId, fileId, requested, routeName, active }: { tabId: string; fileId: number; requested: OfficeMode | null; routeName: string | null; active: boolean }) {
  const routing = useOfficeRouting();
  if (routing.pending) return <Spinner label="Opening the document…" />;
  if (routing.legacy) return <ClassicEditor tabKey={tabId} fileId={fileId} routeName={routeName} active={active} />;
  return <OfficeDocument tabId={tabId} fileId={fileId} requested={requested} routeName={routeName} active={active} />;
}

export const MODE_LABELS: Record<OfficeMode, string> = {
  EDIT: 'Editing',
  REVIEW: 'Reviewing (changes tracked)',
  COMMENT: 'Commenting',
  VIEW: 'Viewing',
};

const MODE_ORDER: OfficeMode[] = ['EDIT', 'REVIEW', 'COMMENT', 'VIEW'];

/** The header's save status (OO-SAV-020/021): the editor's own state first, the server's for the rest. */
export function saveLine(s: Pick<OfficeState, 'dirty' | 'savedAt' | 'save' | 'mode'>, now = Date.now()): { tone: 'muted' | 'busy' | 'ok' | 'warn' | 'error'; text: string; secondary: string | null; retry: boolean } {
  const v = s.save?.last_version ?? null;
  const secondary = v ? `Version ${v.version}${v.at ? ` · ${clock(v.at, now)}` : ''}${v.by ? ` · ${v.by.name}` : ''}` : null;
  const retry = !!s.save?.retry_available && (s.save?.actions ?? []).includes('retry');
  if (s.save?.state === 'save_failed') return { tone: 'error', text: s.save.message || 'Save failed.', secondary, retry };
  if (s.mode === 'VIEW') return { tone: 'muted', text: 'Read-only', secondary, retry: false };
  if (s.dirty) return { tone: 'busy', text: 'Saving…', secondary, retry: false };
  if (s.save?.state === 'save_pending') return { tone: 'warn', text: s.save.message || 'Saving is delayed.', secondary, retry };
  const at = s.savedAt ?? (v?.at ? Date.parse(v.at) : null);
  return { tone: 'ok', text: at ? `Saved · ${clock(at, now)}` : 'Saved', secondary, retry: false };
}

type Dialog = 'share' | 'secure' | 'link' | 'chat' | 'version' | null;

function OfficeDocument({ tabId, fileId, requested, routeName, active }: { tabId: string; fileId: number; requested: OfficeMode | null; routeName: string | null; active: boolean }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panel, setPanel] = useState<'versions' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const [conflict, setConflict] = useState<OfficeLocalCopy | null>(null);
  const [apps, setApps] = useState<ExternalApp[]>([]);
  const [orgId] = useState(() => app.get().organizationId);
  const [session] = useState(
    () =>
      new OfficeSession(fileId, requested, {
        share: () => setDialog('share'),
        renamed: () => void qc.invalidateQueries({ queryKey: ['files'] }),
        notice: (kind, text, action) => toast(kind, text, action),
        isOffline: () => app.get().status?.network === 'OFFLINE',
        focus: () => activate(tabId),
      }),
  );
  const s = useStore(session.store, (x) => x);
  const network = useStore(app, (x) => x.status?.network ?? 'ONLINE');
  const covered = useStore(ui, (x) => x.overlay !== null || x.dock === 'chat');
  const me = useStore(app, (x) => x.bootstrap?.user.id ?? null);
  const boot = s.boot;
  const name = boot?.file.name ?? routeName ?? 'Document';
  useTabTitle(name);

  // The session lives as long as the tab: open, and close — as an organisation switch when that is why (OO-DSK-060).
  useEffect(() => {
    session.revive();
    void session.open();
    return () => session.close(takeCloseReason(tabId) ?? 'CLOSED');
  }, [session, tabId]);

  // Closing the tab waits for changes to reach the Document Server (OO-DSK-006).
  useEffect(() => {
    setCloseGuard(tabId, () => session.closeGuard());
    return () => setCloseGuard(tabId, null);
  }, [session, tabId]);

  // Back online: try again. Realtime news about this document: a heartbeat now rather than in a minute.
  useEffect(() => {
    if (network !== 'OFFLINE' && s.phase === 'offline') void session.open();
  }, [network, s.phase, session]);
  useEffect(
    () =>
      on<{ type: string; file_id?: number }>('realtime:event', (e) => {
        if (e.type.startsWith('office.') && Number(e.file_id) === fileId) session.poke();
      }),
    [session, fileId],
  );
  // The apps this kind of file opens in here, for ⋯ → Open in.
  const ext = boot?.file.extension ?? '';
  useEffect(() => {
    if (!ext) return;
    let alive = true;
    void externalApps(ext).then((l) => alive && setApps(l));
    return () => {
      alive = false;
    };
  }, [ext]);

  const copies = useLocalCopies().filter((c) => c.fileId === fileId && (c.state === 'changed' || c.state === 'conflict'));
  const p = boot?.permissions;
  const line = saveLine(s);
  const others = s.collaborators.filter((c) => String(c.user.id) !== String(me));
  const editorShown = active && !covered && !dialog && !conflict && !s.convertAsk && !s.closing && s.phase === 'open' && !s.editorProblem;

  const asDriveFile = (): DriveFile => ({ id: fileId, name, size: boot?.file.size ?? 0 }) as DriveFile;
  const item: Item = { type: 'file', f: asDriveFile() };

  const download = () => void call('transfers:download', { fileId: String(fileId), name }).then(() => toast('info', `Downloading “${name}” — see Transfers.`), (e) => toast('error', errorMessage(e)));
  const exportPdf = async (destination: 'DOWNLOAD' | 'DRIVE') => {
    try {
      const r = await exportDocument(fileId, 'pdf', destination);
      if (destination === 'DOWNLOAD') {
        const token = r.download_url ? officeExportToken(r.download_url) : null;
        if (!token) throw new Error('The PDF could not be fetched from the server.');
        await call('transfers:download', { officeExport: token, name: r.file_name ?? name.replace(/\.[^.]+$/, '.pdf') });
        toast('info', `Downloading “${r.file_name ?? 'the PDF'}” — see Transfers.`);
      } else {
        toast('success', `Saved “${r.file?.name ?? 'the PDF'}” to Drive.`, r.file ? { label: 'Show in Files', run: () => navigate(r.file!.folder_id ? `/files?folder=${r.file!.folder_id}` : '/files?view=folder') } : undefined);
        void qc.invalidateQueries({ queryKey: ['files'] });
      }
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const convert = async () => {
    try {
      const r = await convertLegacy(fileId);
      session.dismissConvert();
      toast('success', `Made “${r.file.name}” beside the original, which is kept.`);
      navigate(officeRoute(r.file.id, { mode: 'EDIT', name: r.file.name }), app.get().organizationId);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const openIn = (a: ExternalApp) => void openInApp({ id: fileId, name, folderId: null, version: boot?.file.version ?? 0 }, a.id);

  const menuItems: MenuItem[] = [];
  if (boot && p) {
    if (p.download) menuItems.push({ label: 'Download', icon: 'download', run: download });
    if (p.export) menuItems.push({ label: 'Download as PDF', icon: 'file-text', run: () => void exportPdf('DOWNLOAD') });
    if (p.convert) menuItems.push({ label: 'Save as PDF to Drive', icon: 'cloud', run: () => void exportPdf('DRIVE') });
    if (s.mode === 'EDIT') menuItems.push({ label: 'Save as version…', icon: 'history', run: () => setDialog('version') });
    if (p.version_history) menuItems.push({ label: 'Version history', icon: 'history', run: () => setPanel((x) => (x ? null : 'versions')) });
    if (p.download) {
      menuItems.push({ sep: true });
      for (const a of apps) menuItems.push({ label: `Open in ${a.label}`, icon: 'laptop', run: () => openIn(a) });
    }
    if (boot.format.legacy && p.convert) menuItems.push({ sep: true }, { label: `Convert & Edit as ${(boot.format.upgrade_to ?? 'a modern file').toUpperCase()}…`, icon: 'repeat', run: () => session.store.set({ convertAsk: { status: 422, code: 'OFFICE_LEGACY_CONVERSION_REQUIRED', message: `This legacy file will be converted to ${(boot.format.upgrade_to ?? 'a modern format').toUpperCase()} for editing.`, actions: ['convert_and_edit', 'view_only', 'cancel'], offline: false, details: {} } }) });
    if (s.mode === 'EDIT' && !s.lock) menuItems.push({ sep: true }, { label: 'Keep to myself while I edit', icon: 'lock', run: () => void session.keepToMyself() });
    if (s.lock?.mine) menuItems.push({ sep: true }, { label: 'Let others edit again', icon: 'unlock', run: () => void session.releaseLock() });
    menuItems.push({ sep: true }, { label: 'Reload the editor', icon: 'refresh', run: () => session.reloadEditor() });
  }

  return (
    <div className="flex h-full flex-col bg-ground text-[13px]">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3">
        <FileBadge name={name} size={30} />
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-bold text-ink" title={name}>{name}</h1>
          {orgId ? <div className="truncate text-[11px] text-ink-3">{organizationName(orgId)}</div> : null}
        </div>
        {s.phase === 'open' ? (
          <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-1.5 pl-1 text-[12px]" title={line.secondary ?? undefined}>
            <span className={cx('h-2 w-2 shrink-0 rounded-full', line.tone === 'ok' ? 'bg-success' : line.tone === 'busy' ? 'bg-primary' : line.tone === 'warn' ? 'bg-warning' : line.tone === 'error' ? 'bg-danger' : 'bg-ink-3')} />
            <span className={cx('truncate font-semibold', line.tone === 'error' ? 'text-danger' : line.tone === 'warn' ? 'text-warning' : 'text-ink-2')}>{line.text}</span>
            {line.retry && p?.edit ? (
              <button type="button" onClick={() => void session.retrySave()} className="font-bold text-primary hover:underline">Retry</button>
            ) : null}
            {line.secondary ? <span className="hidden truncate text-ink-3 xl:inline">· {line.secondary}</span> : null}
          </div>
        ) : null}
        <div className="flex-1" />
        {others.length ? <Presence people={others} /> : null}
        {s.lock?.type === 'EXCLUSIVE_EDIT' && s.lock.mine ? <span className="rounded-full bg-selection px-2 py-0.5 text-[11px] font-semibold text-primary">Only you are editing</span> : null}
        {boot && s.phase === 'open' && s.availableModes.length > 1 ? (
          <button type="button" aria-haspopup="menu" disabled={s.busy} onClick={(e) => setModeMenu(below(e.currentTarget, 'right', 240))} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
            {s.mode ? MODE_LABELS[s.mode] : 'Mode'}
            <Icon name="chevron-down" size={13} />
          </button>
        ) : s.mode ? (
          <span className="rounded-[8px] border border-line px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">{MODE_LABELS[s.mode]}</span>
        ) : null}
        {p?.share ? (
          <Button size="sm" variant="primary" icon="users" onClick={() => setDialog('share')}>Share</Button>
        ) : null}
        {menuItems.length ? (
          <button type="button" aria-label="More actions" onClick={(e) => setMenu(below(e.currentTarget, 'right'))} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
            <Icon name="more" size={16} />
          </button>
        ) : null}
      </header>

      {s.phase === 'open' ? <Banners s={s} session={session} copies={copies} onConflict={setConflict} /> : null}

      <div className="relative flex min-h-0 flex-1">
        {s.phase === 'opening' ? <Spinner label="Opening the document…" /> : null}
        {s.phase === 'offline' ? <OfflinePanel fileId={fileId} onRetry={() => void session.open()} /> : null}
        {s.phase === 'refused' || s.phase === 'ended' ? (
          <RefusalPanel
            refusal={s.refusal}
            ended={s.phase === 'ended'}
            onReadOnly={() => void session.open('VIEW')}
            onRetry={() => void session.open()}
            onDownload={download}
            onApps={apps}
            onOpenIn={openIn}
            onVersions={() => setPanel('versions')}
            onBrowser={() => void call('app:openInBrowser', { path: `/files?file=${fileId}` }).catch((e) => toast('error', errorMessage(e)))}
            onClose={() => closeTab(tabId)}
          />
        ) : null}
        {s.phase === 'open' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {s.editorProblem ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <div className="flex max-w-[460px] flex-col items-center gap-3 text-center">
                  <Icon name="alert" size={28} className="text-warning" />
                  <p className="text-[13.5px] font-semibold text-ink">{s.editorProblem}</p>
                  <Button variant="primary" icon="refresh" onClick={() => session.reloadEditor()}>Reload the editor</Button>
                </div>
              </div>
            ) : null}
            <div className={cx('flex min-h-0 flex-1', s.editorProblem && 'hidden')}>
              <EditorSurface session={session} tabKey={tabId} organizationId={orgId} visible={editorShown} />
            </div>
            {s.closing ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-ground/90">
                <Spinner label="Saving changes…" />
              </div>
            ) : null}
            {(covered || dialog || conflict) && active && !s.closing ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] text-ink-3">The document is behind this window.</div>
            ) : null}
          </div>
        ) : null}
        {panel === 'versions' ? <VersionsPanel fileId={fileId} name={name} canRestore={!!p?.restore_version || s.phase !== 'open'} canDownload={p ? p.download : true} onClose={() => setPanel(null)} onRestored={() => session.poke()} /> : null}
      </div>

      {menu ? <PopMenu at={menu} items={menuItems} label={`Actions — ${name}`} onClose={() => setMenu(null)} /> : null}
      {modeMenu ? (
        <PopMenu
          at={modeMenu}
          width={240}
          label="Mode"
          onClose={() => setModeMenu(null)}
          items={MODE_ORDER.filter((m) => s.availableModes.includes(m)).map((m) => ({ label: MODE_LABELS[m], strong: m === s.mode, icon: m === s.mode ? 'check' : undefined, run: () => void session.setMode(m) }))}
        />
      ) : null}
      {dialog === 'share' ? <ShareDialog item={item} onClose={() => setDialog(null)} onSecureLink={() => setDialog('secure')} onPublicLink={() => setDialog('link')} onSendToChat={() => setDialog('chat')} /> : null}
      {dialog === 'secure' ? <SecureLinkDialog file={asDriveFile()} onClose={() => setDialog(null)} onAll={() => (setDialog(null), navigate('/files?view=links'))} /> : null}
      {dialog === 'link' ? <LinkDialog item={item} onClose={() => setDialog(null)} /> : null}
      {dialog === 'chat' ? <SendToChatDialog item={item} onClose={() => setDialog(null)} onOpenChat={(room) => navigate(`/chat?room=${room}`)} /> : null}
      {dialog === 'version' ? <SaveVersionDialog onClose={() => setDialog(null)} onSave={(label, description) => session.saveVersion(label, description)} /> : null}
      {s.convertAsk ? (
        <ConvertDialog
          refusal={s.convertAsk}
          busyConvert={convert}
          onViewOnly={() => {
            session.dismissConvert();
            if (s.phase !== 'open') void session.open('VIEW');
          }}
          onCancel={() => {
            session.dismissConvert();
            if (s.phase !== 'open') closeTab(tabId);
          }}
        />
      ) : null}
      {conflict ? <ConflictDialog copy={copies.find((c) => c.id === conflict.id) ?? conflict} onClose={() => setConflict(null)} onReview={() => session.poke()} /> : null}
    </div>
  );
}

function Presence({ people }: { people: OfficeCollaborator[] }) {
  const editing = people.filter((c) => c.editing).map((c) => c.user.name);
  const viewing = people.filter((c) => !c.editing).map((c) => c.user.name);
  const title = [editing.length ? `Editing: ${editing.join(', ')}` : '', viewing.length ? `Viewing: ${viewing.join(', ')}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-1.5" title={title} aria-label={title}>
      <div className="flex -space-x-2">
        {people.slice(0, 4).map((c) => (
          <span key={c.user.id} className={cx('rounded-full ring-2', c.editing ? 'ring-success' : 'ring-surface')}>
            <Avatar name={c.user.name} size={26} />
          </span>
        ))}
      </div>
      <span className="hidden text-[12px] font-semibold text-ink-2 lg:inline">{editing.length ? `● ${names(editing)}` : `${names(viewing)} viewing`}</span>
    </div>
  );
}

function Banner({ tone, icon, children, action }: { tone: 'info' | 'warn' | 'error'; icon: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={cx('flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[12.5px]', tone === 'info' ? 'border-line bg-selection/60 text-ink' : tone === 'warn' ? 'border-line bg-warning-bg text-warning' : 'border-line bg-danger-bg text-danger')}>
      <Icon name={icon} size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

function Banners({ s, session, copies, onConflict }: { s: OfficeState; session: OfficeSession; copies: OfficeLocalCopy[]; onConflict: (c: OfficeLocalCopy) => void }) {
  return (
    <>
      {s.readOnlyReason && s.mode === 'VIEW' ? (
        <Banner
          tone="info"
          icon="eye"
          action={s.canSwitchToEdit || (s.availableModes.includes('EDIT') && s.readOnlyReason.code === 'default_view') ? <Button size="sm" variant="primary" onClick={() => void session.setMode('EDIT')}>Switch to edit</Button> : undefined}
        >
          {s.readOnlyReason.message}
        </Banner>
      ) : s.canSwitchToEdit ? (
        <Banner tone="info" icon="compose" action={<Button size="sm" variant="primary" onClick={() => void session.setMode('EDIT')}>Switch to edit</Button>}>
          You can edit this document now.
        </Banner>
      ) : null}
      {s.newVersion ? (
        <Banner tone="info" icon="refresh" action={<Button size="sm" onClick={() => void session.renew('newer')}>Open the newer version</Button>}>
          A newer version is available. Your changes are saved first.
        </Banner>
      ) : null}
      {s.save?.state === 'save_failed' || s.save?.state === 'save_pending' ? (
        <Banner tone={s.save.state === 'save_failed' ? 'error' : 'warn'} icon="warning">
          {s.save.message}
        </Banner>
      ) : null}
      {s.reconnecting ? (
        <Banner tone="warn" icon="wifi-off">
          WorkSuite can't be reached. The editor keeps your changes with the Office server; WorkSuite checks again every minute.
        </Banner>
      ) : null}
      {s.downloadBlocked ? (
        <Banner tone="info" icon="download" action={<Button size="sm" onClick={() => session.store.set({ downloadBlocked: false })}>OK</Button>}>
          Downloads from inside the editor are turned off. Use ⋯ → Download or Download as PDF.
        </Banner>
      ) : null}
      {copies.map((c) => (
        <div key={c.id} className="shrink-0 border-b border-line bg-warning-bg/60 px-3 py-1.5 text-[12.5px]">
          <LocalCopyRow copy={c} compact onConflict={onConflict} />
        </div>
      ))}
    </>
  );
}

/** OO-OFF-020: offline, the editor is not offered; the copy on this computer is, when there is one. */
function OfflinePanel({ fileId, onRetry }: { fileId: number; onRetry: () => void }) {
  const q = useQuery({ queryKey: ['office', 'local', fileId], queryFn: () => call('office:localAvailable', { fileId }), staleTime: 5_000 });
  const here = q.data;
  const open = (preview: boolean) => void call('office:openLocal', { fileId, preview }).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-[480px] flex-col items-center gap-3 text-center">
        <Icon name="cloud-off" size={30} className="text-ink-3" />
        <p className="text-[15px] font-bold text-ink">{here?.available ? "You're offline. This file is available on this device." : "You're offline."}</p>
        {here?.available ? (
          <div className="flex gap-2">
            {here.preview ? <Button icon="eye" onClick={() => open(true)}>Preview</Button> : null}
            {here.openInApp ? <Button variant="primary" icon="laptop" onClick={() => open(false)}>Open in External App</Button> : null}
          </div>
        ) : null}
        <p className="text-[12.5px] text-ink-2">WorkSuite Office editing requires a connection.</p>
        {here?.available && !here.synced ? <p className="text-[11.5px] text-ink-3">Changes you make in another app come back as a new version when you are online, after you confirm.</p> : null}
        <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}

/** A refused open or an ended session: the server's sentence, and what it offers (web-api §5). */
function RefusalPanel(props: {
  refusal: OfficeRefusal | null;
  ended: boolean;
  onReadOnly: () => void;
  onRetry: () => void;
  onDownload: () => void;
  onApps: ExternalApp[];
  onOpenIn: (a: ExternalApp) => void;
  onVersions: () => void;
  onBrowser: () => void;
  onClose: () => void;
}) {
  const r = props.refusal;
  const actions = new Set(r?.actions ?? []);
  const fallbackView = r?.details.fallback_mode === 'VIEW' || actions.has('view_only');
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-[500px] flex-col items-center gap-3 text-center">
        <Icon name={props.ended ? 'info' : 'alert'} size={30} className={props.ended ? 'text-ink-3' : 'text-warning'} />
        <p className="text-[14.5px] font-bold text-ink">{r?.message ?? 'This document could not be opened.'}</p>
        {r?.code === 'OFFICE_FILE_TOO_LARGE' && r.details.max_file_size_mb ? <p className="text-[12.5px] text-ink-2">The limit for editing here is {String(r.details.max_file_size_mb)} MB.</p> : null}
        <div className="flex flex-wrap justify-center gap-2">
          {!props.ended && fallbackView ? <Button variant="primary" icon="eye" onClick={props.onReadOnly}>Open read-only</Button> : null}
          {actions.has('retry') ? <Button icon="refresh" onClick={props.onRetry}>Try again</Button> : null}
          {actions.has('download') ? <Button icon="download" onClick={props.onDownload}>Download</Button> : null}
          {actions.has('open_external') ? props.onApps.map((a) => <Button key={a.id} icon="laptop" onClick={() => props.onOpenIn(a)}>Open in {a.label}</Button>) : null}
          {actions.has('restore_previous_version') ? <Button icon="history" onClick={props.onVersions}>Version history</Button> : null}
          {actions.has('preview') ? <Button icon="globe" onClick={props.onBrowser}>Open in the browser</Button> : null}
          <Button onClick={props.onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

/** OO-CNV-030: "This legacy file will be converted to DOCX for editing." [Convert & Edit] [View Only] [Cancel]. */
function ConvertDialog({ refusal, busyConvert, onViewOnly, onCancel }: { refusal: OfficeRefusal; busyConvert: () => Promise<void>; onViewOnly: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const actions = new Set(refusal.actions.length ? refusal.actions : ['convert_and_edit', 'view_only', 'cancel']);
  return (
    <Modal
      title="Convert & Edit"
      onClose={onCancel}
      width={460}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          {actions.has('view_only') ? <Button onClick={onViewOnly}>View Only</Button> : null}
          {actions.has('convert_and_edit') ? (
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void busyConvert().finally(() => setBusy(false));
              }}
            >
              Convert & Edit
            </Button>
          ) : null}
        </>
      }
    >
      <p className="text-[13.5px] text-ink">{refusal.message}</p>
      <p className="mt-2 text-[12.5px] text-ink-2">A new file is made beside the original, which stays as it is.</p>
    </Modal>
  );
}

function SaveVersionDialog({ onClose, onSave }: { onClose: () => void; onSave: (label: string, description: string) => Promise<boolean> }) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await onSave(label.trim(), description.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal
      title="Save as version"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!label.trim()} onClick={() => void save()}>Save version</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Version name" autoFocus maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Final client revision" />
        <TextField label="Description (optional)" maxLength={110} value={description} onChange={(e) => setDescription(e.target.value)} />
        <p className="text-[12px] text-ink-3">A named version is always kept, and never merged with other saves.</p>
      </div>
    </Modal>
  );
}

/** Drive's own version history (OO-VER-011/013): download a version, restore one as the new current version. */
/** "Proposal.docx", version 6 → "Proposal (version 6).docx". */
export function versionFileName(name: string, version: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (version ${version})${name.slice(dot)}` : `${name} (version ${version})`;
}

function VersionsPanel({ fileId, name, canRestore, canDownload, onClose, onRestored }: { fileId: number; name: string; canRestore: boolean; canDownload: boolean; onClose: () => void; onRestored: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['office', 'versions', fileId], queryFn: () => versions(fileId), refetchInterval: 60_000 });
  const [busy, setBusy] = useState<number | null>(null);
  const restore = async (row: number, version: number) => {
    setBusy(row);
    try {
      await restoreVersion(fileId, row);
      toast('success', `Version ${version} is now the current version. Everyone in the document is offered it.`);
      void qc.invalidateQueries({ queryKey: ['office', 'versions', fileId] });
      onRestored();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const rows = q.data ? [{ ...q.data.current, id: undefined, is_head: true }, ...q.data.history.filter((h) => h.version !== q.data!.current.version)] : [];
  return (
    <aside aria-label="Version history" className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <b className="flex-1 text-[13.5px] text-ink">Version history</b>
        <button type="button" aria-label="Close version history" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 scroll-thin">
        {q.isLoading ? <Spinner /> : null}
        {q.error ? <p className="p-2 text-[12.5px] text-danger">{errorMessage(q.error)}</p> : null}
        {rows.map((v) => (
          <div key={`${v.version}:${v.id ?? 'head'}`} className="flex flex-col gap-1 rounded-[9px] px-2.5 py-2 hover:bg-ground">
            <div className="flex items-center gap-2">
              <b className="text-ink">Version {v.version}</b>
              {v.is_head ? <span className="rounded-full bg-success-bg px-1.5 text-[10.5px] font-bold text-success">Current</span> : null}
              <span className="flex-1" />
              {canDownload && v.id ? (
                <button type="button" onClick={() => void call('transfers:download', { version: { fileId, versionId: v.id! }, name: versionFileName(name, v.version) }).then(() => toast('info', 'Downloading — see Transfers.'), (e) => toast('error', errorMessage(e)))} className="text-[12px] font-semibold text-primary hover:underline">
                  Download
                </button>
              ) : null}
              {canRestore && v.id && !v.is_head ? (
                <button type="button" disabled={busy !== null} onClick={() => void restore(v.id!, v.version)} className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50">
                  Restore
                </button>
              ) : null}
            </div>
            <span className="text-[11.5px] text-ink-2">{[v.label, v.author, v.made_at ? clock(v.made_at) : null].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
