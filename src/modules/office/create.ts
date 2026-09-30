import { ApiError, apiPost } from '../../core/api';
import { uploadBlob } from '../../core/upload';
import { createDocument } from './api';
import docxUrl from './blank/blank.docx?url';
import pptxUrl from './blank/blank.pptx?url';
import xlsxUrl from './blank/blank.xlsx?url';

export type NewKind = 'document' | 'spreadsheet' | 'presentation';

const EXT: Record<NewKind, 'docx' | 'xlsx' | 'pptx'> = { document: 'docx', spreadsheet: 'xlsx', presentation: 'pptx' };
const NAME: Record<NewKind, string> = { document: 'Untitled document', spreadsheet: 'Untitled spreadsheet', presentation: 'Untitled presentation' };
/** Blank OOXML packages (scripts/make-blank-office.py), for a server that can make none itself. */
const BLANK: Record<NewKind, string> = { document: docxUrl, spreadsheet: xlsxUrl, presentation: pptxUrl };

/**
 * A bundled blank file's bytes. Vite inlines a small asset as a `data:` URL, which the app's CSP does not let
 * `fetch` read (`connect-src 'self'`), so those are decoded here; a larger one is fetched from the bundle.
 */
export async function blankBlob(url: string): Promise<Blob> {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return (await fetch(url)).blob();
  const raw = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
  return new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], { type: m[1] || 'application/octet-stream' });
}

/**
 * A new, empty Word, Excel or PowerPoint file in the Drive, made by whatever this server offers: its Office API
 * (`POST /api/files/office/new`), else Drive's own blank documents (`POST /api/files/create`); only a server with
 * neither gets WorkSuite's own blank file uploaded into the folder.
 */
export async function createBlank(kind: NewKind, folderId: number | null, officeApi: boolean): Promise<{ id: number; name: string }> {
  if (officeApi) {
    const r = await createDocument({ type: kind, folder_id: folderId });
    return { id: r.file.id, name: r.file.name };
  }
  const name = `${NAME[kind]}.${EXT[kind]}`;
  try {
    const f = await apiPost<{ id: number; name: string }>('/api/files/create', { type: EXT[kind], name, folder_id: folderId });
    return { id: f.id, name: f.name };
  } catch (e) {
    if (!(e instanceof ApiError) || ![404, 405, 501].includes(e.status)) throw e;
  }
  const blob = await blankBlob(BLANK[kind]);
  const up = await uploadBlob(blob, name, { kind: 'files', folderId: folderId === null ? null : String(folderId) });
  if (!up.fileId) throw new Error('The new file was uploaded but the server did not say where it is. Look for it in My files.');
  return { id: up.fileId, name };
}
