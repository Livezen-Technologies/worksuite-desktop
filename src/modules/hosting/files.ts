import type { Query } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { fetchExport, fetchPrintRenewals, type ExportKind } from './api';

/**
 * Hosting's files on this computer. An export is the server's own file of a list with the list's filters
 * (`export/{kind}?format=csv|xlsx`), saved where the person chooses — CSV through the text save dialog, a workbook
 * as the bytes the server sent. The renewal schedule prints from the server's print page with the desktop's print
 * dialog. An import file is chosen in the system's open dialog and read here; it goes to the server for the dry run.
 */
export async function saveExport(kind: ExportKind, format: 'csv' | 'xlsx', q: Query = {}): Promise<string | null> {
  try {
    const f = await fetchExport(kind, format, q, todayInZone());
    const where = f.csv !== null ? await call('files:saveText', { name: f.name.endsWith('.csv') ? f.name : `${f.name}.csv`, text: f.csv.slice(0, 8_000_000) }) : f.bytes ? (await call('office:saveCopy', { name: f.name, bytes: f.bytes }))?.name ?? null : null;
    if (where) toast('success', format === 'xlsx' && f.csv !== null ? text('The server sent CSV; saved to {where}.', { where }) : text('Saved to {where}.', { where }));
    return where;
  } catch (e) {
    toast('error', errorMessage(e));
    return null;
  }
}

/** A CSV the server sent in an answer (the import's error rows), saved where the person chooses. */
export async function saveCsvText(stem: string, csv: string): Promise<string | null> {
  try {
    const where = await call('files:saveText', { name: `${stem}-${todayInZone()}.csv`, text: csv.slice(0, 8_000_000) });
    if (where) toast('success', text('Saved to {where}.', { where }));
    return where;
  } catch (e) {
    toast('error', errorMessage(e));
    return null;
  }
}

/** The renewal schedule (HDM-IMP-03) in the desktop's print dialog. */
export async function printRenewals(days: number, org?: number): Promise<void> {
  try {
    const html = await fetchPrintRenewals(days, org || undefined);
    await call('print:print', { html: html.slice(0, 5_000_000), title: text('Renewal schedule') });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** A CSV chosen in the system's dialog and read on this computer (at most 5 MB); null when cancelled. */
export async function chooseCsv(): Promise<{ name: string; text: string } | null> {
  const f = await call('assets:openFile', { title: text('Choose a CSV file to import') });
  return f ? { name: f.name, text: f.text } : null;
}
