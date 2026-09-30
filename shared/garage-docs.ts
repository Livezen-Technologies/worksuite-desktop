import { z } from 'zod';

/**
 * The Garage documents the server prints (WS-GARAGE-SRS-001 FR-DOC-02) and
 * its report exports, as the download manager takes them: by what they are,
 * never by a path. The main process builds the address from these parts, so
 * a page can only ever ask for one of these, of a record it names by id.
 *
 * The four documents are pages WorkSuite renders for printing (HTML, images
 * inline); a report is a CSV. Every one is behind the same checks as the
 * screens: the job, estimate or work order must be one the person may see.
 */
const id = z.number().int().positive();

export const GARAGE_REPORTS = ['aging', 'technicians', 'estimate', 'quality', 'parts', 'revenue', 'profitability'] as const;

export const garageDocSchema = z.discriminatedUnion('kind', [
  /** The check-in sheet: condition, damage, photos, the customer's signature (`GET jobs/{id}/checkin/sheet`). */
  z.object({ kind: z.literal('checkin-sheet'), job: id }),
  /** An estimate version as the customer sees it (`GET estimates/{id}/print`). */
  z.object({ kind: z.literal('estimate'), estimate: id }),
  /** A work order's sheet, with the job number to scan at the parts counter (`GET work-orders/{id}/sheet`). */
  z.object({ kind: z.literal('work-order'), workOrder: id }),
  /** The vehicle delivery note, after the handover (`GET jobs/{id}/delivery-note`). */
  z.object({ kind: z.literal('delivery-note'), job: id }),
  /** A report as a CSV, as the Reports screen filtered it (`GET reports/{name}?format=csv`). */
  z.object({
    kind: z.literal('report'),
    report: z.enum(GARAGE_REPORTS),
    query: z
      .object({
        org: z.string().regex(/^\d{1,10}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        branch_id: z.string().regex(/^\d{1,10}$/).optional(),
      })
      .strict(),
  }),
]);

export type GarageDoc = z.infer<typeof garageDocSchema>;

const BASE = '/api/garage/v1';

/** The server's address for a Garage document. */
export function garageDocPath(d: GarageDoc): string {
  switch (d.kind) {
    case 'checkin-sheet':
      return `${BASE}/jobs/${d.job}/checkin/sheet`;
    case 'estimate':
      return `${BASE}/estimates/${d.estimate}/print`;
    case 'work-order':
      return `${BASE}/work-orders/${d.workOrder}/sheet`;
    case 'delivery-note':
      return `${BASE}/jobs/${d.job}/delivery-note`;
    case 'report': {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(d.query)) if (v) q.set(k, v);
      q.set('format', 'csv');
      return `${BASE}/reports/${d.report}?${q.toString()}`;
    }
  }
}
