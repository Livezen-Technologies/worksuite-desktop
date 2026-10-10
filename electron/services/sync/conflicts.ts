import type { DriveConflict } from '@shared/types';
import { isDesktopError } from '../../main/errors';
import type { HttpClient } from '../http';

/**
 * Drive's sync conflicts (ENH-03 DSK-03): the ones the server holds open for this person, and deciding them.
 *
 * Asked as `/api/drive/conflicts` (the Drive SRS's route); a server that only has the older `/api/sync/conflicts`
 * answers there instead. The main process asks, under the session: `/api/sync/*` never reaches a page.
 */
const ROUTES = ['/api/drive/conflicts', '/api/sync/conflicts'] as const;

async function either<T>(fn: (base: string) => Promise<T>): Promise<T> {
  try {
    return await fn(ROUTES[0]);
  } catch (e) {
    if (isDesktopError(e) && (e.code === 'NOT_FOUND' || e.status === 404 || e.status === 405) && !String(e.message).toLowerCase().includes('conflict not found')) return fn(ROUTES[1]);
    throw e;
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function conflictOf(x: Record<string, unknown>): DriveConflict {
  return {
    id: Number(x.id),
    fileId: Number(x.file_id),
    fileName: str(x.file_name) ?? `File ${String(x.file_id)}`,
    copyFileId: num(x.copy_file_id),
    copyName: str(x.copy_name),
    deviceName: str(x.device_name),
    baseVersion: Number(x.base_version ?? 0),
    serverVersion: Number(x.server_version ?? 0),
    serverSize: num(x.server_size),
    localSize: num(x.local_size),
    serverUpdatedAt: str(x.server_updated_at),
    createdAt: str(x.created_at),
  };
}

export async function listConflicts(http: HttpClient): Promise<DriveConflict[]> {
  const d = await either((base) => http.get<{ conflicts?: Array<Record<string, unknown>> }>(base));
  return (d.conflicts ?? []).map(conflictOf);
}

export async function resolveConflict(http: HttpClient, id: number, resolution: 'keep_mine' | 'keep_server' | 'keep_both' | 'dismiss'): Promise<{ message: string }> {
  const d = await either((base) => http.post<{ message?: string }>(`${base}/${id}/resolve`, { resolution }));
  return { message: str(d?.message) ?? 'Done.' };
}
