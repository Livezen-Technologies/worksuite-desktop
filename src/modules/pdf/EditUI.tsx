import { useState, type ReactNode } from 'react';
import { describeSummary, STAMPS, type PdfAnnotView, type PdfMode, type PdfSessionView } from '@shared/pdf';
import { DesktopError, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal, cx } from '../../components/ui';
import { COLORS, css, pdfEdit, saveLabel, TOOLS, type AnnotStyle, type AnnotTool } from './edit';

/**
 * PDF Studio's editing chrome (stage D2): the mode switch, the save state
 * and its commands, the banners in the server's words, the conflict's
 * choices (§17.2), the Annotate and Organize ribbons and the Comments panel.
 */

const MODE_LABEL: Record<PdfMode, string> = { VIEW: 'View', ANNOTATE: 'Annotate', EDIT: 'Edit' };

/** View / Annotate / Edit, as the server offers them; Edit takes the edit lock, or offers to take it over. */
export function ModeSwitch({ view, onView }: { view: PdfSessionView; onView: (v: PdfSessionView) => void }) {
  const [busy, setBusy] = useState(false);
  const e = view.edit;
  if (e.modes.length < 2 && !e.mayTakeOver) return null;
  const go = async (mode: PdfMode, takeover = false) => {
    setBusy(true);
    try {
      onView(await pdfEdit.mode(view.id, mode, takeover));
    } catch (err) {
      if (err instanceof DesktopError && err.code === 'FILE_LOCKED' && !takeover) {
        toast('warning', err.message, view.edit.mayTakeOver ? { label: 'Take over', run: () => void go(mode, true) } : undefined);
      } else toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="radiogroup" aria-label="Mode" className="flex rounded-[8px] border border-line p-0.5">
      {(['VIEW', 'ANNOTATE', 'EDIT'] as PdfMode[])
        .filter((m) => e.modes.includes(m) || (m === 'EDIT' && e.mayTakeOver))
        .map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={view.mode === m}
            disabled={busy}
            onClick={() => view.mode !== m && void go(m)}
            className={cx('rounded-[6px] px-2.5 py-0.5 text-[12px] font-semibold', view.mode === m ? 'bg-primary text-white' : 'text-ink-2 hover:bg-subtle')}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
    </div>
  );
}

export function SaveState({ view }: { view: PdfSessionView }) {
  const l = saveLabel(view);
  const summary = describeSummary(view.edit.summary);
  return (
    <span title={view.saveState === 'read-only' ? view.readOnly || view.edit.reason || 'Read only' : summary || undefined}>
      <Chip tone={l.tone === 'success' ? 'success' : l.tone === 'warning' ? 'warning' : l.tone === 'danger' ? 'danger' : 'muted'}>
        <Icon name={view.saveState === 'read-only' ? 'eye' : view.saveState === 'saving' ? 'spinner' : view.saveState === 'saved-locally' ? 'cloud-off' : view.saveState === 'unsaved' ? 'pen' : 'check'} size={12} /> {l.text}
      </Chip>
    </span>
  );
}

/** Save (Ctrl/⌘ S) and Save a copy, as this PDF allows; undo and redo beside them. */
export function SaveControls({ view, onView }: { view: PdfSessionView; onView: (v: PdfSessionView) => void }) {
  const e = view.edit;
  const [busy, setBusy] = useState(false);
  if (view.saveState === 'read-only') return null;
  const run = async (fn: () => Promise<PdfSessionView>) => {
    setBusy(true);
    try {
      onView(await fn());
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const dirty = view.saveState === 'unsaved' || view.saveState === 'saved-locally';
  return (
    <>
      <button type="button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!e.undo || busy} onClick={() => void run(() => pdfEdit.undo(view.id))} className="rounded-[6px] p-1 text-ink-2 hover:bg-subtle disabled:opacity-40">
        <Icon name="undo" size={16} />
      </button>
      <button type="button" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!e.redo || busy} onClick={() => void run(() => pdfEdit.redo(view.id))} className="rounded-[6px] p-1 text-ink-2 hover:bg-subtle disabled:opacity-40">
        <Icon name="undo" size={16} className="-scale-x-100" />
      </button>
      {e.canSaveCopy ? (
        <Button size="sm" disabled={busy || view.saveState === 'saving'} onClick={() => void run(() => pdfEdit.save(view.id, 'copy'))} title={e.local ? 'Save as a new file' : 'Save a copy beside it in Drive'}>
          Save a copy
        </Button>
      ) : null}
      {e.canSaveVersion || e.lockLost ? (
        <Button size="sm" variant="primary" icon="disk" loading={busy || view.saveState === 'saving'} disabled={!dirty || (!!e.lockLost && !e.local)} onClick={() => void run(() => pdfEdit.save(view.id, 'version'))} title={e.local ? 'Save (Ctrl/⌘ S)' : 'Save a new version in Drive (Ctrl/⌘ S)'}>
          Save
        </Button>
      ) : null}
    </>
  );
}

function Banner({ tone, icon, children, actions }: { tone: 'info' | 'warning'; icon: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" className={cx('flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px]', tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-selection text-primary')}>
      <Icon name={icon} size={15} />
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  );
}

/** The editing banners: recovered work, a lost lock, a lapsing lock, a newer version, a save waiting, the server's last word. */
export function EditBanners({ view, onView }: { view: PdfSessionView; onView: (v: PdfSessionView) => void }) {
  const e = view.edit;
  const rows: ReactNode[] = [];
  if (e.lockLost) {
    rows.push(
      <Banner key="lost" tone="warning" icon="lock" actions={e.canSaveCopy ? <Button size="sm" onClick={() => void pdfEdit.save(view.id, 'copy').then(onView, (x) => toast('error', errorMessage(x)))}>Save a copy</Button> : null}>
        {e.message ?? 'Your hold on editing this PDF was lost. Your changes are still here.'}
      </Banner>,
    );
  } else if (e.recovered) {
    rows.push(
      <Banner key="rec" tone="info" icon="history" actions={<Button size="sm" onClick={() => void pdfEdit.discard(view.id).then(onView, (x) => toast('error', errorMessage(x)))}>Discard them</Button>}>
        {e.message}
      </Banner>,
    );
  } else if (e.message && !e.conflict) {
    rows.push(
      <Banner key="msg" tone={view.saveState === 'saved-locally' ? 'warning' : 'info'} icon={view.saveState === 'saved-locally' ? 'cloud-off' : 'info'}>
        {e.message}
      </Banner>,
    );
  }
  if (e.lock?.mine && e.lock.warning) rows.push(<Banner key="warn" tone="warning" icon="clock">Your hold on editing ends in {Math.max(1, Math.round((e.lock.expiresInS ?? 60) / 60))} minute(s) unless you keep working. Save your changes.</Banner>);
  if (e.lock && !e.lock.mine && view.mode !== 'EDIT') rows.push(<Banner key="held" tone="info" icon="lock">{e.lock.holder} is editing this PDF{e.lock.device ? ` (${e.lock.device})` : ''}.</Banner>);
  if (e.newVersion && !e.conflict) rows.push(<Banner key="new" tone="info" icon="refresh">A newer version was saved in WorkSuite since you opened this one. Saving will ask what to do.</Banner>);
  return <>{rows}</>;
}

/** §17.2: Drive has a newer version than the one these changes were made on. */
export function ConflictDialog({ view, onView }: { view: PdfSessionView; onView: (v: PdfSessionView) => void }) {
  const c = view.edit.conflict;
  const [busy, setBusy] = useState<string | null>(null);
  if (!c) return null;
  const answer = async (a: 'keep_both' | 'upload_as_new_version' | 'use_cloud') => {
    setBusy(a);
    try {
      onView(await pdfEdit.resolve(view.id, a));
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const when = c.savedAt ? new Date(c.savedAt).toLocaleString() : null;
  return (
    <Modal title="This PDF changed in WorkSuite" width={520}>
      <p className="text-[13px] text-ink">{c.message}</p>
      <p className="mt-2 text-[13px] text-ink-2">
        Your changes were made on version {c.baseVersion}. Version {c.serverVersion} was saved{c.savedBy ? ` by ${c.savedBy}` : ''}
        {when ? ` on ${when}` : ''}.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {view.edit.canSaveCopy ? (
          <Button loading={busy === 'keep_both'} disabled={!!busy} onClick={() => void answer('keep_both')}>
            Keep both — save mine as a copy beside it
          </Button>
        ) : null}
        <Button variant="primary" loading={busy === 'upload_as_new_version'} disabled={!!busy} onClick={() => void answer('upload_as_new_version')}>
          Save mine as the newest version (after reviewing version {c.serverVersion})
        </Button>
        <Button loading={busy === 'use_cloud'} disabled={!!busy} onClick={() => void answer('use_cloud')}>
          Use WorkSuite’s version — discard my changes
        </Button>
      </div>
    </Modal>
  );
}

/** The Annotate ribbon: the tools, the colour and the line width. */
export function AnnotateRibbon({ tool, onTool, style, onStyle, disabled, why, selected, onDelete }: {
  tool: AnnotTool | null;
  onTool: (t: AnnotTool | null) => void;
  style: AnnotStyle;
  onStyle: (s: AnnotStyle) => void;
  disabled: boolean;
  why: string | null;
  selected: boolean;
  onDelete: () => void;
}) {
  return (
    <>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          aria-disabled={disabled || undefined}
          title={disabled ? (why ?? '') : `${t.label} — ${t.key}`}
          onClick={() => !disabled && onTool(tool === t.id ? null : t.id)}
          className={cx('flex h-[52px] min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-1.5 text-[11.5px] font-semibold', disabled ? 'cursor-not-allowed text-ink-3 opacity-50' : tool === t.id ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink')}
        >
          <Icon name={t.icon} size={18} />
          <span className="whitespace-nowrap">{t.label}</span>
        </button>
      ))}
      <span className="mx-1 h-9 w-px shrink-0 bg-line" />
      <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1 px-1">
        {COLORS.map((c) => (
          <button key={c.name} type="button" role="radio" aria-checked={style.color.join() === c.rgb.join()} aria-label={c.name} title={c.name} onClick={() => onStyle({ ...style, color: c.rgb })} className={cx('h-5 w-5 rounded-full border border-line', style.color.join() === c.rgb.join() && 'ring-2 ring-primary ring-offset-1')} style={{ background: css(c.rgb) }} />
        ))}
      </div>
      <label className="flex items-center gap-1 px-1 text-[11.5px] font-semibold text-ink-2">
        Width
        <select aria-label="Line width" value={style.width} onChange={(e) => onStyle({ ...style, width: Number(e.target.value) })} className="h-6 rounded-[6px] border border-line bg-surface px-1 text-ink">
          {[1, 2, 3, 5, 8].map((w) => (
            <option key={w} value={w}>
              {w} pt
            </option>
          ))}
        </select>
      </label>
      {tool === 'stamp' ? (
        <label className="flex items-center gap-1 px-1 text-[11.5px] font-semibold text-ink-2">
          Stamp
          <select aria-label="Stamp" value={style.stamp} onChange={(e) => onStyle({ ...style, stamp: e.target.value })} className="h-6 rounded-[6px] border border-line bg-surface px-1 text-ink">
            {STAMPS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="mx-1 h-9 w-px shrink-0 bg-line" />
      <button type="button" aria-disabled={!selected || undefined} title={selected ? 'Delete the selected annotation (Delete)' : 'Select an annotation first'} onClick={() => selected && onDelete()} className={cx('flex h-[52px] min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-1.5 text-[11.5px] font-semibold', selected ? 'text-ink-2 hover:bg-subtle hover:text-danger' : 'cursor-not-allowed text-ink-3 opacity-50')}>
        <Icon name="trash" size={18} />
        <span>Delete</span>
      </button>
    </>
  );
}

/** The Organize ribbon: acts on the pages selected in the grid. */
export function OrganizeRibbon({ selected, pageCount, disabled, why, onRun }: {
  selected: number[];
  pageCount: number;
  disabled: boolean;
  why: string | null;
  onRun: (action: 'rotate-left' | 'rotate-right' | 'delete' | 'earlier' | 'later' | 'blank' | 'insert' | 'extract') => void;
}) {
  const none = !selected.length;
  const btn = (id: Parameters<typeof onRun>[0], icon: string, label: string, off: boolean, reason: string, extra?: string) => (
    <button
      key={id}
      type="button"
      aria-disabled={disabled || off || undefined}
      title={disabled ? (why ?? '') : off ? reason : label}
      onClick={() => !disabled && !off && onRun(id)}
      className={cx('flex h-[52px] min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-1.5 text-[11.5px] font-semibold', disabled || off ? 'cursor-not-allowed text-ink-3 opacity-50' : 'text-ink-2 hover:bg-subtle hover:text-ink')}
    >
      <Icon name={icon} size={18} className={extra} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
  return (
    <>
      {btn('rotate-left', 'rotate-cw', 'Rotate left', none, 'Select pages first', '-scale-x-100')}
      {btn('rotate-right', 'rotate-cw', 'Rotate right', none, 'Select pages first')}
      {btn('delete', 'trash', 'Delete', none || selected.length >= pageCount, none ? 'Select pages first' : 'A PDF keeps at least one page')}
      <span className="mx-1 h-9 w-px shrink-0 bg-line" />
      {btn('earlier', 'arrow-up', 'Move earlier', none || selected[0] === 0, 'Select pages first')}
      {btn('later', 'arrow-down', 'Move later', none || selected[selected.length - 1] === pageCount - 1, 'Select pages first')}
      <span className="mx-1 h-9 w-px shrink-0 bg-line" />
      {btn('blank', 'file', 'Blank page', false, '')}
      {btn('insert', 'plus', 'Insert from PDF', false, '')}
      {btn('extract', 'download', 'Extract', none, 'Select pages first')}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strike-out', squiggly: 'Squiggle', note: 'Note', ink: 'Drawing', square: 'Rectangle', circle: 'Ellipse', line: 'Line', text: 'Text box', stamp: 'Stamp', other: 'Annotation' };

/** The Comments panel: every annotation on the pages read so far, to go to, answer, change or remove. */
export function CommentsPanel({ view, byPage, selected, onGo, editable }: { view: PdfSessionView; byPage: Map<number, PdfAnnotView[]>; selected: string | null; onGo: (a: PdfAnnotView) => void; editable: boolean }) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const all = [...byPage.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, l]) => l);
  if (!all.length) return <p className="p-4 text-[12.5px] text-ink-3">No comments or markup on the pages shown so far. Scroll through the document to find more.</p>;
  const save = (a: PdfAnnotView, text: string) =>
    void pdfEdit.apply(view.id, { op: 'annot.update', page: a.page, id: a.id, text }).then(
      () => setEditing(null),
      (e) => toast('error', errorMessage(e)),
    );
  return (
    <ul className="h-full overflow-auto p-2 scroll-thin">
      {all.map((a) => (
        <li key={`${a.page}:${a.id}`} className={cx('mb-1.5 rounded-[8px] border p-2 text-[12.5px]', selected === a.id ? 'border-primary bg-selection' : 'border-line')}>
          <button type="button" className="flex w-full items-center gap-1.5 text-left" onClick={() => onGo(a)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-line" style={{ background: a.color ? css(a.color) : 'transparent' }} />
            <b className="text-ink">{KIND_LABEL[a.kind] ?? 'Annotation'}</b>
            <span className="text-ink-3">· page {a.page + 1}</span>
            <span className="flex-1" />
            {a.author ? <span className="truncate text-ink-3">{a.author}</span> : null}
          </button>
          {editing?.id === a.id ? (
            <div className="mt-1.5">
              <textarea aria-label="Comment" value={editing.text} maxLength={10_000} rows={3} autoFocus onChange={(e) => setEditing({ id: a.id, text: e.target.value })} className="w-full resize-none rounded-[6px] border border-line bg-surface p-1.5 text-ink outline-none focus:border-primary" />
              <div className="mt-1 flex justify-end gap-1.5">
                <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={() => save(a, editing.text)}>Save</Button>
              </div>
            </div>
          ) : (
            <>
              {a.text ? <p className="mt-1 whitespace-pre-wrap break-words text-ink-2">{a.text}</p> : null}
              {editable && a.editable ? (
                <div className="mt-1 flex gap-3 text-[12px]">
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing({ id: a.id, text: a.text })}>
                    {a.text ? 'Edit comment' : 'Add a comment'}
                  </button>
                  <button type="button" className="font-semibold text-danger hover:underline" onClick={() => void pdfEdit.apply(view.id, { op: 'annot.remove', page: a.page, id: a.id }).catch((e) => toast('error', errorMessage(e)))}>
                    Delete
                  </button>
                </div>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
