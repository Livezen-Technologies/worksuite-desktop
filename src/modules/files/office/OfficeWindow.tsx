import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { OfficeEditorEvent } from '@shared/office';
import { call, isMac, on, platform } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Avatar, Button, IconButton, Modal, Spinner, TextField, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { convertLegacy, officeApi, type OfficeMode, type OfficeRefusal } from './api';
import { OfficeSession, type EditorLink, type OfficeSessionState } from './OfficeSession';
import { modeLabel, saveLine } from './status';

/**
 * A Drive document in WorkSuite Office, in a window of its own (OO-DSK):
 * WorkSuite's title bar and header — the file, where saving has got to, who
 * else is in it, the modes the server allows, Save version, the document's
 * place in Drive, PDF — and below it the Document Server's editor. The editor
 * is not part of this page: it is the window's editor view, which the main
 * process lays over the placeholder below (`office:bounds`) and takes away
 * while this page shows something on top (a menu, a dialog) or WorkSuite is
 * locked.
 */

const link: EditorLink = {
  send: (cmd) => call('office:editor', cmd),
  onEvent: (cb) => on<OfficeEditorEvent>('office:editorEvent', cb),
};

export function OfficeWindow({ fileId, mode }: { fileId: number; mode: OfficeMode | null }) {
  const [name, setName] = useState<string | null>(null);
  const session = useMemo(
    () =>
      new OfficeSession(fileId, officeApi(platform), link, mode, {
        onRequestClose: () => void call('windows:close'),
        onRequestShare: () => void call('office:showInDrive', { fileId }),
        onTitle: setName,
        onMention: (answer, refusal) => {
          if (refusal) toast('error', refusal.message);
          else if (answer?.needs_share.length) toast('warning', `${answer.needs_share.map((p) => p.name).join(', ')} can’t open this document yet. Share it with them from Drive.`);
          else if (answer?.notified.length) toast('success', `${answer.notified.map((p) => p.name).join(', ')} ${answer.notified.length === 1 ? 'was' : 'were'} told.`);
        },
        onDownloadUrl: (url) => void call('app:openExternal', { url }),
        realtime: (cb) => on('realtime:event', cb),
        onTrack: (info) => void call('office:track', info).catch(() => undefined),
      }),
    [fileId, mode],
  );
  const s = useSyncExternalStore(session.subscribe, session.getState);
  const [menu, setMenu] = useState(false);
  const [versionDialog, setVersionDialog] = useState(false);

  useEffect(() => {
    void session.start();
    return () => session.dispose();
  }, [session]);

  const title = name ?? s.boot?.file.name ?? 'WorkSuite Office';
  useEffect(() => {
    document.title = `${title} — WorkSuite Office`;
  }, [title]);

  // The editor view goes while this page draws over it, and until there is an editor to show.
  const hidden = s.phase !== 'ready' || menu || versionDialog;

  return (
    <div className="flex h-full flex-col bg-ground">
      <div className="drag flex h-10 shrink-0 items-center gap-2 bg-navy text-[13px] text-white" style={{ paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 12 : 140 }}>
        <Icon name="file-text" size={15} className="shrink-0 text-navy-ink" />
        <span className="truncate font-semibold">{title}</span>
        <SaveStatus s={s} onRetry={() => void session.retrySave().catch((r: OfficeRefusal) => toast('error', r.message))} />
      </div>
      {s.boot ? (
        <Header
          s={s}
          menu={menu}
          setMenu={setMenu}
          onMode={(m) => void session.setMode(m).catch((r: OfficeRefusal) => toast('error', r.message))}
          onVersion={() => setVersionDialog(true)}
          onDrive={() => void call('office:showInDrive', { fileId })}
          onPdf={() => void call('transfers:download', { officePdf: fileId, name: pdfName(title) }).catch((e: Error) => toast('error', e.message))}
          onDownload={() => void call('transfers:download', { fileId: String(fileId), name: title }).catch((e: Error) => toast('error', e.message))}
          onBrowser={() => void call('app:openInBrowser', { path: `/editor/${fileId}` })}
        />
      ) : null}
      <Banners s={s} onLoadNewer={() => void session.reload()} onEdit={() => void session.setMode('EDIT').catch((r: OfficeRefusal) => toast('error', r.message))} />
      <EditorPlace hidden={hidden}>
        {s.phase === 'opening' || (s.phase === 'ready' && s.busy) ? <Spinner label="Opening the document…" /> : null}
        {s.phase === 'refused' && s.refusal ? <Refusal fileId={fileId} name={title} refusal={s.refusal} onRetry={(m) => void session.start(m)} /> : null}
        {s.phase === 'ended' ? (
          <Centered icon="info" text={s.ended ?? 'This editing session has ended.'}>
            <Button variant="primary" onClick={() => void session.start()}>
              Open again
            </Button>
            <Button onClick={() => void call('windows:close')}>Close</Button>
          </Centered>
        ) : null}
      </EditorPlace>
      {versionDialog ? (
        <SaveVersion
          onClose={() => setVersionDialog(false)}
          onSave={async (label) => {
            const r = await session.saveNow(label);
            toast(r.state === 'no_changes' ? 'info' : 'success', r.message || (r.state === 'no_changes' ? 'Nothing has changed since the last version.' : `Version “${label}” is being saved.`));
            setVersionDialog(false);
          }}
        />
      ) : null}
    </div>
  );
}

function pdfName(title: string): string {
  return `${title.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.pdf`;
}

/* ───────────────────────── the editor's place ───────────────────────── */

/** The placeholder the editor view is laid over; the main process is told where it is, whenever that changes. */
function EditorPlace({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const rect = r.width > 0 && r.height > 0 ? { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height } : null;
        void call('office:bounds', { rect, hidden }).catch(() => undefined);
      });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [hidden]);
  return (
    <div ref={ref} className="relative min-h-0 flex-1 bg-surface">
      {children}
    </div>
  );
}

/* ───────────────────────── header ───────────────────────── */

function SaveStatus({ s, onRetry }: { s: OfficeSessionState; onRetry: () => void }) {
  const line = saveLine(s);
  if (!line) return null;
  return (
    <span className={cx('no-drag ml-2 flex shrink-0 items-center gap-1.5 text-[12px] font-normal', line.tone === 'danger' ? 'text-[#FCA5A5]' : line.tone === 'warning' ? 'text-[#FCD34D]' : 'text-navy-ink')}>
      {line.text}
      {line.retry ? (
        <button type="button" className="underline hover:text-white" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}

function Header(props: {
  s: OfficeSessionState;
  menu: boolean;
  setMenu: (v: boolean) => void;
  onMode: (m: OfficeMode) => void;
  onVersion: () => void;
  onDrive: () => void;
  onPdf: () => void;
  onDownload: () => void;
  onBrowser: () => void;
}) {
  const { s, menu, setMenu } = props;
  const boot = s.boot!;
  const p = boot.permissions;
  // Everybody in the document now, as the server counts them (this person too).
  const others = s.collaborators;
  const editing = others.filter((c) => c.editing).length;
  const items: Array<{ label: string; icon: string; run: () => void }> = [
    ...(p.export ? [{ label: 'Download as PDF', icon: 'download', run: props.onPdf }] : []),
    ...(p.download ? [{ label: 'Download the file', icon: 'download', run: props.onDownload }] : []),
    { label: 'Show in Drive', icon: 'folder-open', run: props.onDrive },
    { label: 'Open in the browser', icon: 'external', run: props.onBrowser },
  ];
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      {s.availableModes.length > 1 ? (
        <div role="radiogroup" aria-label="Mode" className="flex rounded-[8px] border border-line p-0.5">
          {s.availableModes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={s.mode === m}
              disabled={s.busy}
              onClick={() => props.onMode(m)}
              className={cx('rounded-[6px] px-2.5 py-1 text-[12px] font-semibold', s.mode === m ? 'bg-primary text-white' : 'text-ink-2 hover:bg-subtle')}
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
      ) : s.mode ? (
        <span className="rounded-[6px] bg-subtle px-2 py-1 text-[12px] font-semibold text-ink-2">{modeLabel(s.mode)}</span>
      ) : null}
      <span className="flex-1" />
      {others.length ? (
        <div className="flex items-center gap-1.5" title={others.map((c) => `${c.user.name}${c.editing ? ' (editing)' : ''}`).join('\n')}>
          <div className="flex -space-x-1.5">
            {others.slice(0, 4).map((c) => (
              <Avatar key={c.user.id} name={c.user.name} size={24} className="ring-2 ring-surface" />
            ))}
          </div>
          <span className="text-[12px] text-ink-3">{editing ? `${editing} editing` : `${others.length} here`}</span>
        </div>
      ) : null}
      {s.mode === 'EDIT' && p.edit ? (
        <Button size="sm" icon="history" onClick={props.onVersion}>
          Save version
        </Button>
      ) : null}
      {p.share ? <IconButton icon="users" label="Share (in Drive)" onClick={props.onDrive} /> : null}
      <div className="relative">
        <IconButton icon="more" label="More" active={menu} onClick={() => setMenu(!menu)} />
        {menu ? (
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(false)} />
            <div role="menu" className="absolute right-0 z-50 mt-1 w-56 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
              {items.map((i) => (
                <button
                  key={i.label}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-subtle"
                  onClick={() => {
                    setMenu(false);
                    i.run();
                  }}
                >
                  <Icon name={i.icon} size={15} className="text-ink-3" />
                  {i.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Banners({ s, onLoadNewer, onEdit }: { s: OfficeSessionState; onLoadNewer: () => void; onEdit: () => void }) {
  if (s.phase !== 'ready') return null;
  const rows: Array<{ key: string; tone: 'info' | 'warning'; text: string; action?: { label: string; run: () => void } }> = [];
  if (s.readOnlyReason) rows.push({ key: 'ro', tone: 'info', text: s.readOnlyReason.message });
  if (s.canSwitchToEdit && s.mode === 'VIEW') rows.push({ key: 'edit', tone: 'info', text: 'You can edit this document now.', action: { label: 'Edit', run: onEdit } });
  if (s.newVersion) rows.push({ key: 'new', tone: 'warning', text: 'A newer version of this document is available.', action: { label: 'Load it', run: onLoadNewer } });
  if (s.connection === 'reconnecting') rows.push({ key: 'net', tone: 'warning', text: 'Reconnecting to the Document Server… Keep this window open; your changes are kept.' });
  if (s.notice) rows.push({ key: 'notice', tone: 'info', text: s.notice });
  if (!rows.length) return null;
  return (
    <div className="shrink-0">
      {rows.map((r) => (
        <div key={r.key} role="status" className={cx('flex items-center gap-2 border-b px-4 py-2 text-[13px]', r.tone === 'warning' ? 'border-line bg-warning-bg text-ink' : 'border-line bg-subtle text-ink-2')}>
          <Icon name={r.tone === 'warning' ? 'warning' : 'info'} size={15} />
          <span className="flex-1">{r.text}</span>
          {r.action ? (
            <Button size="sm" onClick={r.action.run}>
              {r.action.label}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── refusals ───────────────────────── */

function Centered({ icon, text, children }: { icon: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Icon name={icon} size={28} className="text-ink-3" />
      <p className="max-w-[520px] text-[14px] text-ink">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Why the document could not be opened, in the server's words, and what may
 * be done instead: only the actions the server offered this person — plus
 * the browser, which is always there. A DOC, XLS or PPT that cannot be edited
 * as it is offers Convert & Edit (a new file beside it) or reading it as it is.
 */
function Refusal({ fileId, name, refusal, onRetry }: { fileId: number; name: string; refusal: OfficeRefusal; onRetry: (mode?: OfficeMode | null) => void }) {
  const [busy, setBusy] = useState(false);
  const has = (a: string) => refusal.actions.includes(a);
  const convert = async () => {
    setBusy(true);
    try {
      const r = await convertLegacy(fileId);
      toast('success', `“${r.file.name}” was made beside “${name}”.`);
      await call('office:open', { fileId: r.file.id, name: r.file.name, mode: 'EDIT' });
      void call('windows:close');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The file could not be converted.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered icon="warning" text={refusal.message}>
      {has('convert_and_edit') ? (
        <Button variant="primary" loading={busy} onClick={() => void convert()}>
          Convert &amp; Edit
        </Button>
      ) : null}
      {has('view_only') || refusal.details.fallback_mode === 'VIEW' ? <Button onClick={() => onRetry('VIEW')}>Open read-only</Button> : null}
      {has('retry') || refusal.status === 0 || refusal.status >= 500 ? <Button onClick={() => onRetry()}>Try again</Button> : null}
      {has('download') ? <Button onClick={() => void call('transfers:download', { fileId: String(fileId), name })}>Download</Button> : null}
      <Button onClick={() => void call('app:openInBrowser', { path: has('preview') ? `/files?file=${fileId}` : `/editor/${fileId}` })}>Open in the browser</Button>
      <Button onClick={() => void call('windows:close')}>Close</Button>
    </Centered>
  );
}

/* ───────────────────────── Save version ───────────────────────── */

function SaveVersion({ onClose, onSave }: { onClose: () => void; onSave: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(label.trim());
    } catch (e) {
      setError((e as OfficeRefusal).message ?? 'The version could not be saved.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Save a version"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!label.trim()} onClick={() => void save()}>
            Save version
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Name" autoFocus value={label} maxLength={120} placeholder="Sent to the client" onChange={(e) => setLabel(e.target.value)} error={error} />
      </form>
      <p className="mt-2 text-[12px] text-ink-3">The document as it is now becomes a version in Drive, with this name.</p>
    </Modal>
  );
}
