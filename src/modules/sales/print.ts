import type { LabelFormat, SalesPrintPatch, SalesPrintOutcome, SalesPrintSettings, SalesSaveReport } from '@shared/sales';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';

/**
 * Printing and saving on this computer (WS-OMS-SRS-001 FR-DSK-06, FR-LBL-06): the main process does it
 * (electron/services/sales-desk.ts), with the printers chosen in Settings › Printers.
 */
export const printSettings = (): Promise<SalesPrintSettings> => call('sales:printSettings');
export const setPrintSettings = (patch: SalesPrintPatch): Promise<SalesPrintSettings> => call('sales:printSettingsSet', patch);
export const printers = () => call('print:printers');

/** A delivery note on the delivery-note printer; the outcome is said in a toast. */
export async function printNote(deliveryId: number): Promise<SalesPrintOutcome | null> {
  try {
    const r = await call('sales:printNote', { delivery_id: deliveryId });
    toast(r.ok ? 'success' : 'error', r.message);
    return r;
  } catch (e) {
    toast('error', errorMessage(e));
    return null;
  }
}

/** A shipment's label on the label printer (raw ZPL or the PDF), silently when set so. */
export async function printLabel(shipmentId: number, o: { reason?: string; format?: LabelFormat; quiet?: boolean } = {}): Promise<SalesPrintOutcome> {
  try {
    const r = await call('sales:printLabel', { shipment_id: shipmentId, ...(o.reason ? { reason: o.reason } : {}), ...(o.format ? { format: o.format } : {}) });
    if (!o.quiet || !r.ok) toast(r.ok ? 'success' : 'error', r.message);
    return r;
  } catch (e) {
    const message = errorMessage(e);
    toast('error', message);
    return { ok: false, printer: null, via: null, message };
  }
}

/** A report as the server's PDF, where the person chooses; "Show in folder" on the toast. */
export async function saveReportPdf(r: SalesSaveReport): Promise<string | null> {
  try {
    const path = await call('sales:saveReport', r);
    if (path) {
      const name = path.split(/[\\/]/).pop() ?? path;
      toast('success', `Saved “${name}”.`, { label: 'Show in folder', run: () => void call('sales:reveal', { path }) });
    }
    return path;
  } catch (e) {
    toast('error', errorMessage(e));
    return null;
  }
}
