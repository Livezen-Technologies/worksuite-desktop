import type { OfficeDocSource } from '@shared/office';
import { apiGetMeta, apiPost, apiPut, apiUrl } from '../../core/api';
import { call } from '../../core/bridge';
import { uploadBlob } from '../../core/upload';
import type { DriveList } from '../files/api';
import { loadBytes } from './BuiltinEditor';

/**
 * Online, an Office document that is not a Drive file (a mail attachment, a tender's file, a file on this
 * computer) is copied into My files → "WorkSuite copies" and opened in the Document Server's editor, which can
 * only open Drive files. A copy stays linked to where it came from when that can take changes: what is saved in
 * the Drive is written back (`writeBack`) to the file on this computer, or to the tender document as its next
 * version (#393) — so the tender's Download serves what was edited, not the file as it was before.
 */
export const COPIES_FOLDER = 'WorkSuite copies';

let folderId: Promise<number> | null = null;
/** This session's copies, by source, so opening the same attachment again opens the same copy. */
const copies = new Map<string, Promise<{ id: number; name: string }>>();
/** Where a Drive copy's changes go back to. */
export type CopyLink = { kind: 'local'; handle: string; name: string } | { kind: 'tender'; docId: number; path: string; name: string };
/** Drive copies → what they were copied from, when that can take the changes back. */
const links = new Map<number, CopyLink>();

const TENDER_DOCUMENT = /^\/api\/tenders\/documents\/(\d+)\/file$/;

const keyOf = (s: OfficeDocSource) => (s.kind === 'api' ? `a:${s.path}` : `l:${s.handle}`);

async function copiesFolder(): Promise<number> {
  const r = await apiGetMeta<DriveList>('/api/drive/list', { view: 'folder', per_page: 500, counts: 0 });
  const found = (r.data.folders ?? []).find((f) => f.name === COPIES_FOLDER);
  if (found) return Number(found.id);
  const made = await apiPost<{ id: number | string }>('/api/folders', { name: COPIES_FOLDER, parent_id: null });
  return Number(made.id);
}

/** The Drive copy of a document that is not a Drive file, made once per session. */
export function driveCopy(src: OfficeDocSource): Promise<{ id: number; name: string }> {
  const key = keyOf(src);
  const known = copies.get(key);
  if (known) return known;
  const made = (async () => {
    folderId ??= copiesFolder().catch((e: unknown) => {
      folderId = null;
      throw e;
    });
    const folder = await folderId;
    const bytes = await loadBytes(src);
    const up = await uploadBlob(new Blob([bytes as BlobPart]), src.name, { kind: 'files', folderId: String(folder) });
    if (!up.fileId) throw new Error('The copy was uploaded but the server did not say where it is.');
    if (src.kind === 'local') links.set(up.fileId, { kind: 'local', handle: src.handle, name: src.name });
    const tender = src.kind === 'api' ? TENDER_DOCUMENT.exec(src.path) : null;
    if (tender && src.kind === 'api') links.set(up.fileId, { kind: 'tender', docId: Number(tender[1]), path: src.path, name: src.name });
    return { id: up.fileId, name: src.name };
  })();
  copies.set(key, made);
  made.catch(() => copies.delete(key));
  return made;
}

/** What a Drive copy came from and takes its changes back, if anything. */
export function linkedSource(fileId: number): CopyLink | null {
  return links.get(fileId) ?? null;
}

/**
 * Writes the Drive copy's current version back to where it came from: over the file on this computer, or as the
 * tender document's new version (the server files the Drive copy's bytes; `PUT /api/tenders/documents/{id}`).
 * Resolves only once that is stored, so "updated" is never said before it is true.
 */
export async function writeBack(fileId: number): Promise<boolean> {
  const link = links.get(fileId);
  if (!link) return false;
  if (link.kind === 'tender') {
    await apiPut(`/api/tenders/documents/${link.docId}`, { file_id: fileId });
    return true;
  }
  const res = await fetch(apiUrl(`/api/files/${fileId}/download`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`The Drive copy could not be read (${res.status}).`);
  await call('office:writeFile', { handle: link.handle, bytes: new Uint8Array(await res.arrayBuffer()) });
  return true;
}

/** The Document Server saves a little after the editor closes: write back then, and once more to be sure. */
export function writeBackLater(fileId: number): void {
  const link = links.get(fileId);
  if (!link) return;
  for (const ms of [15_000, 45_000]) setTimeout(() => void writeBack(fileId).catch(() => undefined), ms);
  // A tender document can change under us (someone replaces it): the next Open copies its current version afresh.
  if (link.kind === 'tender') setTimeout(() => copies.delete(`a:${link.path}`), 45_000);
}
