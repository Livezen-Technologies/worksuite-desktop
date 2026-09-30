import { z } from 'zod';

/**
 * The Hotel PMS files a person may save on this computer — a guest's
 * document and a report's export (`/api/pms/v1`) — as the `pms:download`
 * channel takes them: by what they are, never by a path. The main process
 * builds the address from these parts, checks the organization's
 * `desktop.downloads` policy itself (the channel's permission, and again in
 * the handler), and hands the address to the download manager, which fetches
 * it signed in, writes it to the downloads folder and records the download
 * in the audit log. The bytes never cross IPC, so a large scan or PDF is no
 * different from a small CSV.
 *
 * The server keeps its own checks: a document needs `pms.guest.view` (and
 * `pms.guest.sensitive_data` for an identity document), an export
 * `pms.reports.export`.
 */
const id = z.number().int().positive().max(2_147_483_647);

/** A report's filters as the Reports screen sends them (`from`, `to`, `room_type_id`, …): short plain values only. */
const reportQuery = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.string().regex(/^[A-Za-z0-9_.:-]{0,64}$/))
  .refine((q) => Object.keys(q).length <= 16, 'too many filters')
  .refine((q) => !('format' in q), 'the format is given on its own');

export const PMS_EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;

export const pmsFileSchema = z.discriminatedUnion('kind', [
  /** A guest's document (`GET guest-documents/{id}`). */
  z.object({ kind: z.literal('guest-document'), document: id }),
  /** A report exported as the server renders it (`GET properties/{id}/reports/{key}?format=`). */
  z.object({ kind: z.literal('report'), property: id, report: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/), format: z.enum(PMS_EXPORT_FORMATS), query: reportQuery }),
]);
export type PmsFile = z.infer<typeof pmsFileSchema>;

export const pmsDownloadInput = z.object({
  file: pmsFileSchema,
  name: z.string().min(1).max(255),
  open: z.boolean().optional(),
});
export type PmsDownloadInput = z.infer<typeof pmsDownloadInput>;

const BASE = '/api/pms/v1';

/** The server's address for a PMS file. */
export function pmsFilePath(f: PmsFile): string {
  switch (f.kind) {
    case 'guest-document':
      return `${BASE}/guest-documents/${f.document}`;
    case 'report': {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(f.query)) if (v) q.set(k, v);
      q.set('format', f.format);
      return `${BASE}/properties/${f.property}/reports/${f.report}?${q.toString()}`;
    }
  }
}
