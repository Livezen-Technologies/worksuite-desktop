import { apiUrl, type Query } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { csvName, toCsv } from './logic';

/**
 * Export as CSV (gap #16): the server's own CSV of a list, with the same
 * filters the list shows (`leads/export`, `accounts/export`,
 * `quotes/export`, `followups/export`, `reports/export`), saved with the
 * desktop's save dialog (`files:saveText`). A server without the export
 * yet gets the rows already on screen instead, and is told so.
 */
export type CsvRows = Array<Array<string | number | null | undefined>>;

export async function exportCrmCsv(path: string, query: Query, what: string, onScreen?: () => CsvRows): Promise<string | null> {
  const name = csvName(what, todayInZone());
  let text: string | null = null;
  let fallback = false;
  try {
    const res = await fetch(apiUrl(path, { ...query, format: 'csv' }), { headers: { Accept: 'text/csv' } });
    if (res.ok && !(res.headers.get('content-type') ?? '').includes('json')) text = await res.text();
    else if ([404, 405, 501].includes(res.status) && onScreen) fallback = true;
    else {
      let message = `The server answered ${res.status}.`;
      try {
        const j = (await res.json()) as { message?: string };
        if (j?.message) message = j.message;
      } catch {
        /* not JSON */
      }
      throw new Error(res.status === 403 ? 'You may not export from the CRM. Ask for CRM export.' : message);
    }
  } catch (e) {
    if (!onScreen || !(e instanceof TypeError)) {
      toast('error', errorMessage(e));
      return null;
    }
    fallback = true;
  }
  if (fallback && onScreen) text = toCsv(onScreen());
  if (text === null) return null;
  try {
    const where = await call('files:saveText', { name, text: text.slice(0, 8_000_000) });
    if (where) toast('success', fallback ? `Saved the rows on screen to ${where} — this server cannot export the whole list yet.` : `Saved to ${where}.`);
    return where;
  } catch (e) {
    toast('error', errorMessage(e));
    return null;
  }
}
