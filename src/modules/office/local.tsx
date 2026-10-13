import { useEffect, useState } from 'react';
import { EXTERNAL_APP_LABELS, microsoftAppFor, type ExternalApp, type ExternalAppId, type OfficeLocalCopy, type OfficeUploadHow } from '@shared/office';
import { call, errorMessage, hasDesktop, on } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, cx } from '../../components/ui';
import { StorageFullDialog } from './StorageFullDialog';

/**
 * Office files opened in another app on this computer (OO-DSK-050,
 * OO-OFF-030/040): Word, Excel, PowerPoint or the default app. The copy is
 * the download manager's; the main process watches it (office-external.ts)
 * and, when it changes, the person decides — nothing goes back to Drive on
 * its own, and a newer cloud version is never overwritten without asking.
 */

const appsByKind = new Map<string, ExternalApp[]>();

function kindOf(extension: string): string {
  return microsoftAppFor(extension) ?? 'other';
}

/** The apps a file of this kind opens in here (found once, then remembered for the menus). */
export async function externalApps(extension: string): Promise<ExternalApp[]> {
  const k = kindOf(extension);
  const hit = appsByKind.get(k);
  if (hit) return hit;
  if (!hasDesktop()) return [];
  const list = await call('office:externalApps', { extension: extension.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) }).catch(() => [] as ExternalApp[]);
  appsByKind.set(k, list);
  return list;
}

/** What `externalApps` found already, for a menu built without waiting; the default app until then. */
export function knownApps(extension: string): ExternalApp[] {
  return appsByKind.get(kindOf(extension)) ?? [{ id: 'default', label: EXTERNAL_APP_LABELS.default }];
}

export function appLabel(id: ExternalAppId): string {
  return EXTERNAL_APP_LABELS[id];
}

/** Opens a Drive file in another app here: sync's copy if sync keeps it, else a fresh download. */
export async function openInApp(file: { id: number; name: string; folderId: number | null; version: number }, app: ExternalAppId): Promise<void> {
  try {
    const c = await call('office:openExternal', { fileId: file.id, name: file.name, folderId: file.folderId, version: file.version, app });
    toast(
      'info',
      c.syncOwned
        ? `Opening “${file.name}” from your synced folder. Drive sync brings your changes back.`
        : c.state === 'downloading'
          ? `Downloading “${file.name}” to open in ${appLabel(app)}. When you save it there, WorkSuite asks before uploading it.`
          : `Opening “${file.name}” in ${appLabel(app)}.`,
    );
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

export function useLocalCopies(): OfficeLocalCopy[] {
  const [list, setList] = useState<OfficeLocalCopy[]>([]);
  useEffect(() => {
    if (!hasDesktop()) return;
    let alive = true;
    call('office:localCopies').then(
      (l) => alive && setList(l),
      () => undefined,
    );
    const off = on<OfficeLocalCopy[]>('office:localChanged', (l) => setList(l));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}

/**
 * Takes a copy back as the person chose; a conflict comes back to be decided, never resolved here. `quota`: the
 * account's storage is full — the copy waits on this computer and goes up when there is room (screen 13).
 */
export async function uploadCopy(copy: OfficeLocalCopy, how: OfficeUploadHow): Promise<'uploaded' | 'conflict' | 'queued' | 'failed' | 'quota'> {
  try {
    const r = await call('office:uploadLocal', { id: copy.id, how });
    if (r.state === 'uploaded') toast('success', `“${copy.name}” is now version ${r.version ?? 'the latest'} in Drive.`);
    if (r.state === 'queued') toast('info', `Uploading your copy of “${copy.name}” as a new file beside it — see Transfers.`);
    return r.state;
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'QUOTA_EXCEEDED') return 'quota';
    toast('error', errorMessage(e));
    return 'failed';
  }
}

/**
 * OO-OFF-030: "The cloud file changed while you were editing." — Keep Both,
 * Review, Upload as New Version, Cancel (only those the server offered).
 */
export function ConflictDialog({ copy, onClose, onReview }: { copy: OfficeLocalCopy; onClose: () => void; onReview: (copy: OfficeLocalCopy) => void }) {
  const [busy, setBusy] = useState<OfficeUploadHow | null>(null);
  const c = copy.conflict;
  const offered = new Set(c?.actions ?? ['keep_both', 'review', 'upload_as_new_version', 'cancel']);
  const go = async (how: OfficeUploadHow) => {
    setBusy(how);
    const r = await uploadCopy(copy, how);
    setBusy(null);
    if (r === 'uploaded' || r === 'queued') onClose();
  };
  return (
    <Modal
      title="The cloud file changed"
      onClose={onClose}
      width={520}
      footer={
        <>
          {offered.has('cancel') ? <Button onClick={onClose}>Cancel</Button> : null}
          {offered.has('review') ? (
            <Button icon="eye" onClick={() => (onReview(copy), onClose())}>
              Review
            </Button>
          ) : null}
          {offered.has('keep_both') ? (
            <Button icon="copy" loading={busy === 'keep_both'} disabled={!!busy} onClick={() => void go('keep_both')}>
              Keep Both
            </Button>
          ) : null}
          {offered.has('upload_as_new_version') ? (
            <Button variant="primary" icon="upload" loading={busy === 'new_version'} disabled={!!busy} onClick={() => void go('new_version')}>
              Upload as New Version
            </Button>
          ) : null}
        </>
      }
    >
      <p className="text-[13.5px] font-semibold text-ink">{c?.message ?? 'The cloud file changed while you were editing.'}</p>
      <p className="mt-2 text-[12.5px] text-ink-2">
        You edited “{copy.name}” from version {c?.baseVersion ?? copy.baseVersion}; Drive now has version {c?.serverVersion ?? '—'}. Nothing has been replaced.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
        {offered.has('keep_both') ? <li><b className="text-ink">Keep Both</b> — your copy goes up as a new file beside it.</li> : null}
        {offered.has('review') ? <li><b className="text-ink">Review</b> — open the cloud version first; your copy waits here.</li> : null}
        {offered.has('upload_as_new_version') ? <li><b className="text-ink">Upload as New Version</b> — your copy becomes the newest version; the others stay in the history.</li> : null}
      </ul>
    </Modal>
  );
}

const WORDS: Record<OfficeLocalCopy['state'], string> = {
  downloading: 'Downloading…',
  open: 'Open in another app',
  changed: 'Changed on this computer',
  uploading: 'Uploading…',
  uploaded: 'Up to date in Drive',
  conflict: 'The cloud file changed',
  failed: 'Could not open',
  missing: 'Moved or deleted here',
  quota: 'Waiting for room in your storage',
};

/** A copy that wants the person: changed, in conflict, uploading or failed. */
export function needsAttention(c: OfficeLocalCopy): boolean {
  return !c.syncOwned && (c.state === 'changed' || c.state === 'conflict' || c.state === 'uploading' || c.state === 'failed' || c.state === 'quota');
}

/** One copy's line with its actions (the Files tray and the document's banner). */
export function LocalCopyRow({ copy, onConflict, compact }: { copy: OfficeLocalCopy; onConflict: (c: OfficeLocalCopy) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const upload = async () => {
    setBusy(true);
    const r = await uploadCopy(copy, 'version');
    setBusy(false);
    if (r === 'conflict') onConflict(copy);
    if (r === 'quota') setFull(true);
  };
  return (
    <div className={cx('flex items-center gap-2', compact ? '' : 'rounded-[9px] border border-line px-2.5 py-2')}>
      <Icon name="laptop" size={15} className="shrink-0 text-ink-2" />
      <div className="min-w-0 flex-1">
        {compact ? null : <b className="block truncate font-semibold text-ink" title={copy.name}>{copy.name}</b>}
        <span className={cx('text-[11.5px]', copy.state === 'conflict' || copy.state === 'failed' ? 'text-danger' : 'text-ink-2')}>
          {copy.error && copy.state !== 'conflict' ? copy.error : `${WORDS[copy.state]} · from version ${copy.baseVersion}`}
        </span>
      </div>
      {copy.state === 'changed' ? (
        <Button size="sm" variant="primary" icon="upload" loading={busy} onClick={() => void upload()}>
          Upload as new version
        </Button>
      ) : null}
      {copy.state === 'conflict' ? (
        <Button size="sm" variant="primary" onClick={() => onConflict(copy)}>
          Decide…
        </Button>
      ) : null}
      {copy.state === 'quota' ? (
        <Button size="sm" onClick={() => setFull(true)}>
          Storage full…
        </Button>
      ) : null}
      {full ? <StorageFullDialog copy={copy} onClose={() => setFull(false)} /> : null}
      <button type="button" aria-label={`Show “${copy.name}” in its folder`} title="Show in folder" onClick={() => void call('office:revealLocal', { id: copy.id }).catch((e) => toast('error', errorMessage(e)))} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle">
        <Icon name="folder-open" size={14} />
      </button>
      <button type="button" aria-label={`Stop watching “${copy.name}”`} title="Stop watching this copy (the file stays where it is)" onClick={() => void call('office:forgetLocal', { id: copy.id }).catch(() => undefined)} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** Files, bottom right: copies edited in other apps that are waiting for a decision. */
export function LocalCopiesTray({ onReview }: { onReview: (c: OfficeLocalCopy) => void }) {
  const copies = useLocalCopies().filter(needsAttention);
  const [conflict, setConflict] = useState<OfficeLocalCopy | null>(null);
  if (!copies.length && !conflict) return null;
  return (
    <>
      {copies.length ? (
        <section aria-label="Edited on this computer" className="no-drag flex w-[380px] flex-col gap-2 rounded-[14px] border border-line bg-surface p-3 text-[12.5px] shadow-[0_18px_44px_rgb(var(--ws-shadow-rgb)/.22)]">
          <b className="text-ink">Edited on this computer</b>
          {copies.slice(0, 4).map((c) => (
            <LocalCopyRow key={c.id} copy={c} onConflict={setConflict} />
          ))}
        </section>
      ) : null}
      {conflict ? <ConflictDialog copy={copies.find((c) => c.id === conflict.id) ?? conflict} onClose={() => setConflict(null)} onReview={onReview} /> : null}
    </>
  );
}
