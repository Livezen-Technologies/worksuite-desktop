import type { OfficeDocSource } from '@shared/office';
import { apiGetMeta, apiPost, apiUrl } from '../../core/api';
import { call } from '../../core/bridge';
import { uploadBlob } from '../../core/upload';
import type { DriveList } from '../files/api';
import { loadBytes } from './BuiltinEditor';

/**
 * Online, an Office document that is not a Drive file (a mail attachment, a tender's file, a file on this
 * computer) is copied into My files → "WorkSuite copies" and opened in the Document Server's editor, which can
 * only open Drive files. A copy of a file on this computer stays linked to it: what is saved in the Drive is
 * written back to that file (`writeBack`).
 */
export const COPIES_FOLDER = 'WorkSuite copies';

let folderId: Promise<number> | null = null;
/** This session's copies, by source, so opening the same attachment again opens the same copy. */
const copies = new Map<string, Promise<{ id: number; name: string }>>();
/** Drive copies of files on this computer → the file's handle. */
const links = new Map<number, { handle: string; name: string }>();

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
    if (src.kind === 'local') links.set(up.fileId, { handle: src.handle, name: src.name });
    return { id: up.fileId, name: src.name };
  })();
  copies.set(key, made);
  made.catch(() => copies.delete(key));
  return made;
}

/** The file on this computer a Drive copy came from, if it did. */
export function linkedLocal(fileId: number): { handle: string; name: string } | null {
  return links.get(fileId) ?? null;
}

/** Writes the Drive copy's current version back over the file on this computer it came from. */
export async function writeBack(fileId: number): Promise<boolean> {
  const link = links.get(fileId);
  if (!link) return false;
  const res = await fetch(apiUrl(`/api/files/${fileId}/download`));
  if (!res.ok) throw new Error(`The Drive copy could not be read (${res.status}).`);
  await call('office:writeFile', { handle: link.handle, bytes: new Uint8Array(await res.arrayBuffer()) });
  return true;
}

/** The Document Server saves a little after the editor closes: write back then, and once more to be sure. */
export function writeBackLater(fileId: number): void {
  if (!links.has(fileId)) return;
  for (const ms of [15_000, 45_000]) setTimeout(() => void writeBack(fileId).catch(() => undefined), ms);
}
