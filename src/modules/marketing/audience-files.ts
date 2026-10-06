import { ApiError, apiUrl, type Query } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';

/**
 * Files the server builds for the Audience screens — the contact list and the
 * consent ledger as CSV (MKT-IMP-05, MKT-CON-07), and an import's refused rows
 * with their reasons (MKT-IMP-04) — saved on this computer.
 *
 * The server writes the file and audits the export; this only carries its
 * bytes to a place the person picks. The rejected rows are the answer to a
 * POST of the very spreadsheet being imported, so the file cannot be fetched
 * again by address the way the download manager fetches others: the bytes are
 * read here and handed to the main process's Save dialog.
 *
 * An organization can forbid saving WorkSuite's files on a computer
 * (`desktop.downloads`); the buttons say so and stay off rather than fail.
 */

/** Whether this person's organization lets files be saved from WorkSuite on this computer. */
export function useMaySave(): boolean {
  return useStore(app, (s) => {
    const p = s.bootstrap?.permissions;
    return !p || p.includes('*') || p.includes('desktop.downloads');
  });
}

export const SAVE_REFUSED = 'Your organization does not allow saving WorkSuite files on this computer.';

/** What a file request is: a GET by address and filters, or a POST of a form (the spreadsheet itself). */
export type FileRequest = { method: 'GET'; path: string; query?: Query } | { method: 'POST'; path: string; body: FormData };

/**
 * Fetch a file the server builds and offer to save it. Answers the name it was
 * saved under, or null when the person cancelled the dialog. A refusal from
 * the server (a JSON answer instead of a file) is thrown as that refusal.
 */
export async function saveServerFile(req: FileRequest, name: string): Promise<string | null> {
  const res = await fetch(apiUrl(req.path, req.method === 'GET' ? req.query : undefined), {
    method: req.method,
    body: req.method === 'POST' ? req.body : undefined,
    headers: { Accept: 'text/csv, application/json' },
  });
  // A file comes back as itself; an envelope means the server said something instead.
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('json')) {
    let message = `The server answered ${res.status}.`;
    try {
      const j = (await res.json()) as { message?: unknown };
      if (typeof j?.message === 'string' && j.message) message = j.message;
    } catch {
      /* No body to read: the status says it. */
    }
    throw new ApiError(res.status, message, null);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new ApiError(res.status, 'The server sent an empty file.', null);
  const saved = await call('office:saveCopy', { name: name.replace(/[/\\]/g, '-').slice(0, 200) || 'marketing.csv', bytes });
  return saved?.name ?? null;
}
