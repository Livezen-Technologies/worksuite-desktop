import { useState, type ReactNode } from 'react';
import { officeRoute } from '@shared/office';
import {
  OFFICE_APP_DOWNLOAD_URL,
  OFFICE_APP_NAME,
  OFFICE_OPEN_KIND_LABELS,
  OFFICE_OPEN_TARGET_LABELS,
  decideOfficeOpen,
  officeOpenKind,
  type OfficeAppStatus,
  type OfficeOpenKind,
  type OfficeOpenTarget,
} from '@shared/office-open';
import { apiUrl } from '../../core/api';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage, hasDesktop } from '../../core/bridge';
import { createStore, useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';
import { PopMenu, below, type MenuAt, type MenuItem } from '../files/Menu';

/**
 * "Open with ▸" for Word, Excel and PowerPoint files, wherever a file shows (worksuite-desktop#322): Files, chat
 * file cards, Mail attachments, Tender documents, Recent. The rules (which kind, the setting, Drive or not, whether
 * WorkSuite Office is here) are shared/office-open.ts's; this file asks the main process, shows the dialogs and
 * does what was decided.
 */

/** A file that may be opened with something, as the module showing it knows it. */
export interface OfficeDoc {
  name: string;
  extension?: string | null;
  /** In Drive: WorkSuite Office saves go back as versions of this file. */
  driveId?: number | null;
  /** Not in Drive: where this server serves it (`/api/…` or `/media/…`), for a copy and for Save to Drive. */
  apiPath?: string | null;
  /** The built-in editor can open it (attachments: .docx, .xlsx and .pptx). Default true. */
  builtinOk?: boolean;
  /** WorkSuite's built-in editor; default: a Drive file's Office tab (the one already open, if it is). */
  openBuiltin?: () => void;
  /** The default app on this computer; default: a Drive file downloaded and opened. */
  openSystem?: () => void;
  /** Copies it into My files and answers the new Drive file's id; default: read from `apiPath` and uploaded. */
  saveToDrive?: () => Promise<number | null>;
  /** More places for the menu after the three (Microsoft Word & co. for a Drive file). */
  more?: MenuItem[];
}

// ── WorkSuite Office here or not ─────────────────────────────────────────

let status: { at: number; s: OfficeAppStatus } | null = null;
const STATUS_TTL = 30_000;

/** Asks the main process (at most every 30 seconds): installing it while WorkSuite runs shows up on the next menu. */
export async function officeAppStatus(fresh = false): Promise<OfficeAppStatus> {
  if (!fresh && status && Date.now() - status.at < STATUS_TTL) return status.s;
  const s: OfficeAppStatus = hasDesktop() ? await call('office:desktopApp').catch(() => ({ installed: false, appName: null, canOpen: false })) : { installed: false, appName: null, canOpen: false };
  status = { at: Date.now(), s };
  return s;
}

/** What is known without asking, for a menu built at once. */
export function knownOfficeAppStatus(): OfficeAppStatus | null {
  return status?.s ?? null;
}

// ── the dialogs ──────────────────────────────────────────────────────────

type Ask = { kind: 'ask'; doc: OfficeDoc; officeKind: OfficeOpenKind; choices: OfficeOpenTarget[] } | { kind: 'missing'; doc: OfficeDoc; fallback: OfficeOpenTarget } | { kind: 'save-first'; doc: OfficeDoc };

const dialogs = createStore<{ ask: Ask | null }>({ ask: null });

// ── opening ──────────────────────────────────────────────────────────────

const orgId = () => {
  const o = app.get().organizationId;
  return o != null && /^\d{1,12}$/.test(String(o)) ? String(o) : null;
};

function openBuiltin(doc: OfficeDoc): void {
  if (doc.openBuiltin) return doc.openBuiltin();
  if (doc.driveId) {
    const id = doc.driveId;
    // Already open in a tab, here or in another window: that tab comes forward.
    void call('office:focusFile', { fileId: id })
      .catch(() => false)
      .then((there) => there || navigate(officeRoute(id, { name: doc.name }), app.get().organizationId));
    return;
  }
  toast('error', `“${doc.name}” cannot be opened in WorkSuite here.`);
}

function openSystem(doc: OfficeDoc): void {
  if (doc.openSystem) return doc.openSystem();
  if (doc.driveId) {
    void call('transfers:download', { fileId: String(doc.driveId), name: doc.name, open: true })
      .then(() => toast('info', `Opening ${doc.name}…`))
      .catch((e) => toast('error', errorMessage(e)));
    return;
  }
  toast('error', `“${doc.name}” cannot be opened on this computer from here.`);
}

async function toDesktopApp(input: { kind: 'drive'; fileId: number; name: string } | { kind: 'copy'; path: string; name: string }, doc: OfficeDoc): Promise<void> {
  try {
    await call('office:openInDesktopApp', { ...input, organizationId: orgId() });
    toast('info', input.kind === 'drive' ? `Opening “${input.name}” in ${OFFICE_APP_NAME}. Saving there saves a new version in Drive.` : `Opening a copy of “${input.name}” in ${OFFICE_APP_NAME}.`);
  } catch (e) {
    // Uninstalled since the menu was built: say so, with Download.
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'UNSUPPORTED') {
      await officeAppStatus(true);
      dialogs.set({ ask: { kind: 'missing', doc, fallback: doc.builtinOk === false ? 'system' : 'builtin' } });
      return;
    }
    toast('error', errorMessage(e));
  }
}

/** Reads a file this server serves and puts it in My files; the new Drive file's id. */
async function uploadFromServer(path: string, name: string): Promise<number | null> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(res.status === 403 ? 'You may not download this file, so it cannot be saved to Drive.' : `The file could not be read (${res.status}).`);
  const r = await uploadBlob(await res.blob(), name, { kind: 'files', folderId: null });
  return r.fileId;
}

/** "Save to Drive first?": into My files, then WorkSuite Office on that Drive file; or a copy only. */
export async function saveThenOpen(doc: OfficeDoc, save: boolean): Promise<void> {
  if (!save) {
    if (!doc.apiPath) return toast('error', `A copy of “${doc.name}” cannot be opened in ${OFFICE_APP_NAME} from here.`);
    return toDesktopApp({ kind: 'copy', path: doc.apiPath, name: doc.name }, doc);
  }
  try {
    const id = doc.saveToDrive ? await doc.saveToDrive() : doc.apiPath ? await uploadFromServer(doc.apiPath, doc.name) : null;
    if (!id) {
      toast('info', `“${doc.name}” is being saved to My files. Open it from Files when it is there.`);
      return;
    }
    toast('success', `“${doc.name}” saved to My files.`);
    await toDesktopApp({ kind: 'drive', fileId: id, name: doc.name }, { ...doc, driveId: id, apiPath: null });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

function run(doc: OfficeDoc, target: OfficeOpenTarget): void {
  if (target === 'builtin') openBuiltin(doc);
  else if (target === 'system') openSystem(doc);
  else if (doc.driveId) void toDesktopApp({ kind: 'drive', fileId: doc.driveId, name: doc.name }, doc);
  else dialogs.set({ ask: { kind: 'save-first', doc } });
}

/**
 * Opens an Office file where the person chose (`chosen`, from Open with) or where Settings › Files says for its kind
 * (a double-click). False when it is not an Office file: the caller opens it its own way.
 */
export async function openOfficeDoc(doc: OfficeDoc, chosen?: OfficeOpenTarget | null): Promise<boolean> {
  const decide = (installed: boolean | null) => decideOfficeOpen({ name: doc.name, extension: doc.extension, inDrive: !!doc.driveId, chosen, prefs: app.get().prefs?.officeOpen, installed, builtinOk: doc.builtinOk });
  let d = decide(knownOfficeAppStatus()?.installed ?? null);
  // The built-in editor and the default app open at once, with no question to the main process first; only
  // WorkSuite Office (or a choice that may be it) waits to hear whether it is installed.
  if (d.kind === 'none') return false;
  if (d.kind === 'open' && d.target !== 'worksuite-office') {
    run(doc, d.target);
    return true;
  }
  d = decide((await officeAppStatus()).installed);
  switch (d.kind) {
    case 'none':
      return false;
    case 'ask':
      dialogs.set({ ask: { kind: 'ask', doc, officeKind: d.officeKind, choices: d.choices } });
      return true;
    case 'not-installed':
      dialogs.set({ ask: { kind: 'missing', doc, fallback: d.fallback } });
      return true;
    case 'save-first':
      dialogs.set({ ask: { kind: 'save-first', doc } });
      return true;
    case 'open':
      run(doc, d.target);
      return true;
  }
}

/** The "Open with" choices for a file (a submenu in Files, the ▾ beside Open elsewhere); empty for a non-Office file. */
export function officeOpenWithItems(doc: OfficeDoc): MenuItem[] {
  if (!officeOpenKind(doc.name, doc.extension)) return [];
  // Asked now, for the next time the menu opens; until then WorkSuite Office is offered and checked when chosen.
  void officeAppStatus();
  const known = knownOfficeAppStatus();
  const items: MenuItem[] = [
    { label: OFFICE_OPEN_TARGET_LABELS['worksuite-office'], icon: 'file-text', hint: known && !known.installed ? 'Not installed' : doc.driveId ? undefined : 'Saves to Drive first', run: () => void openOfficeDoc(doc, 'worksuite-office') },
  ];
  if (doc.builtinOk !== false) items.push({ label: OFFICE_OPEN_TARGET_LABELS.builtin, icon: 'compose', run: () => void openOfficeDoc(doc, 'builtin') });
  items.push({ label: OFFICE_OPEN_TARGET_LABELS.system, icon: 'laptop', run: () => void openOfficeDoc(doc, 'system') });
  if (doc.more?.length) items.push({ sep: true }, ...doc.more);
  return items;
}

/** "Open with" as an item with a submenu, for a menu of its own (Files' right-click). */
export function officeOpenWithMenu(doc: OfficeDoc): MenuItem | null {
  const items = officeOpenWithItems(doc);
  return items.length ? { label: 'Open with', icon: 'external', run: () => undefined, submenu: items } : null;
}

/** A small ▾ beside a file's Open (a mail attachment, a chat file card, a tender's document): its "Open with" menu. */
export function OpenWithButton({ doc, className }: { doc: OfficeDoc; className?: string }) {
  const [at, setAt] = useState<MenuAt | null>(null);
  if (!officeOpenKind(doc.name, doc.extension)) return null;
  return (
    <>
      <button
        type="button"
        aria-label={`Open “${doc.name}” with…`}
        title="Open with…"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setAt(below(e.currentTarget, 'left', 260));
        }}
        className={className ?? 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle'}
      >
        <Icon name="chevron-down" size={14} />
      </button>
      {at ? <PopMenu at={at} items={officeOpenWithItems(doc)} label={`Open “${doc.name}” with`} width={260} onClose={() => setAt(null)} head={<div className="px-2.5 py-1.5 text-[11px] font-bold tracking-[0.6px] text-ink-2">OPEN WITH</div>} /> : null}
    </>
  );
}

/** The right-click menu for a file shown outside Files: the same choices, at the pointer. */
export function useOpenWithMenu(): { menu: ReactNode; openAt: (doc: OfficeDoc, at: MenuAt) => boolean } {
  const [state, setState] = useState<{ doc: OfficeDoc; at: MenuAt } | null>(null);
  return {
    menu: state ? <PopMenu at={state.at} items={officeOpenWithItems(state.doc)} label={`Open “${state.doc.name}” with`} width={260} onClose={() => setState(null)} head={<div className="px-2.5 py-1.5 text-[11px] font-bold tracking-[0.6px] text-ink-2">OPEN WITH</div>} /> : null,
    openAt: (doc, at) => {
      if (!officeOpenKind(doc.name, doc.extension)) return false;
      setState({ doc, at });
      return true;
    },
  };
}

/** The dialogs "Open with" may need, once per window (App). */
export function OfficeOpenHost() {
  const ask = useStore(dialogs, (s) => s.ask);
  const close = () => dialogs.set({ ask: null });
  if (!ask) return null;
  if (ask.kind === 'ask') return <AskDialog key={ask.doc.name} ask={ask} onClose={close} />;
  if (ask.kind === 'missing') {
    return (
      <Modal
        title={`${OFFICE_APP_NAME} isn’t installed`}
        onClose={close}
        width={460}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button onClick={() => (close(), run(ask.doc, ask.fallback))}>{ask.fallback === 'builtin' ? 'Open in app' : 'Open in the default app'}</Button>
            <Button variant="primary" icon="download" onClick={() => (close(), void call('app:openExternal', { url: OFFICE_APP_DOWNLOAD_URL }).catch((e) => toast('error', errorMessage(e))))}>
              Download
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">
          {OFFICE_APP_NAME} is WorkSuite’s desktop editor for Word, Excel and PowerPoint files. Download it to open “{ask.doc.name}” there, with saves going back to WorkSuite Drive.
        </p>
      </Modal>
    );
  }
  return <SaveFirstDialog doc={ask.doc} onClose={close} />;
}

function SaveFirstDialog({ doc, onClose }: { doc: OfficeDoc; onClose: () => void }) {
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null);
  const go = async (save: boolean) => {
    setBusy(save ? 'save' : 'copy');
    await saveThenOpen(doc, save);
    setBusy(null);
    onClose();
  };
  return (
    <Modal
      title="Save to Drive first?"
      onClose={busy ? undefined : onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={() => void go(false)} loading={busy === 'copy'} disabled={!!busy || !doc.apiPath}>
            Open a copy only
          </Button>
          <Button variant="primary" icon="upload" onClick={() => void go(true)} loading={busy === 'save'} disabled={!!busy}>
            Save to Drive &amp; open
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">
        “{doc.name}” isn’t in your Drive. Save it to My files and {OFFICE_APP_NAME} saves your changes there as new versions. A copy opens on its own: your changes stay in {OFFICE_APP_NAME} until you save them somewhere.
      </p>
    </Modal>
  );
}

function AskDialog({ ask, onClose }: { ask: Extract<Ask, { kind: 'ask' }>; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  const known = knownOfficeAppStatus();
  const pick = (t: OfficeOpenTarget) => {
    onClose();
    if (remember) void updatePrefs({ officeOpen: { [ask.officeKind]: t } }).catch((e) => toast('error', errorMessage(e)));
    void openOfficeDoc(ask.doc, t);
  };
  return (
    <Modal title={`Open “${ask.doc.name}” in`} onClose={onClose} width={440}>
      <div className="flex flex-col gap-1.5">
        {ask.choices.map((t) => (
          <button key={t} type="button" onClick={() => pick(t)} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 text-left hover:bg-subtle focus:bg-selection focus:outline-none">
            <Icon name={t === 'worksuite-office' ? 'file-text' : t === 'builtin' ? 'compose' : 'laptop'} size={16} className="text-primary" />
            <span className="flex-1 text-[13px] font-semibold text-ink">{OFFICE_OPEN_TARGET_LABELS[t]}</span>
            {t === 'worksuite-office' && known && !known.installed ? <span className="text-[11.5px] text-ink-3">Not installed</span> : null}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-2">
        <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Always open {OFFICE_OPEN_KIND_LABELS[ask.officeKind].toLowerCase()} this way
      </label>
    </Modal>
  );
}
