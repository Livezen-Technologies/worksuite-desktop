import { useQuery } from '@tanstack/react-query';
import { officeRoute, type OfficeActions, type OfficeMode, type OfficeTypes } from '@shared/office';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { officeActions, officeTypes } from '../office/api';
import { extOf, type DriveFile } from './api';

/**
 * Drive's routing for Office files (web-api §6, OO-DRV-010/021/040): what
 * opening one does comes from the server (`/api/files/office/types` for a
 * list, `…/office/actions` for one file). A server without the Office API
 * (it answers 404) keeps the old way: the web's editor, in the browser.
 */
export interface OfficeRouting {
  /** The server's formats, or null while unknown. */
  types: OfficeTypes | null;
  /** The server has no Office API: Office files open on the web, as before. */
  legacy: boolean;
}

export function useOfficeRouting(): OfficeRouting {
  const org = useStore(app, (s) => s.organizationId);
  const q = useQuery({
    queryKey: ['files', 'office-types', org],
    queryFn: ({ signal }) => officeTypes(org, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const legacy = q.error instanceof ApiError && q.error.status === 404;
  return { types: q.data ?? null, legacy };
}

/**
 * Opens an Office file in its tab — the one already open, in this window or
 * another (OO-DSK-004), or a new one. `mode`: only when the person chose
 * (Edit, Open read-only); otherwise the server's default action.
 */
export async function openOfficeTab(f: Pick<DriveFile, 'id' | 'name'>, mode: OfficeMode | null = null): Promise<void> {
  const elsewhere = await call('office:focusFile', { fileId: f.id }).catch(() => false);
  if (!elsewhere) navigate(officeRoute(f.id, { mode, name: f.name }), app.get().organizationId);
}

/** What opening does for this file, by the server's formats: the Office tab, the code editor, or the web's preview. */
export function officeOpenWay(f: Pick<DriveFile, 'name' | 'extension'>, r: OfficeRouting): 'office' | 'code' | 'preview' | 'browser' | null {
  if (r.legacy) return 'browser';
  const fmt = r.types?.formats[extOf(f.name, f.extension)];
  if (!fmt) return null;
  if (fmt.route === 'code_editor') return 'code';
  if (fmt.route !== 'office') return null;
  // An administrator chose "Preview" for this type: Drive's own preview, which for Office files is the web's.
  return fmt.default_action === 'preview' ? 'preview' : 'office';
}

// ── one file's Office actions, for the menus ─────────────────────────────

const actions = new Map<number, { at: number; a: OfficeActions }>();
const asking = new Set<number>();

/** The server's answer for a file, when it is known (asked when the file is chosen or its menu opens). */
export function cachedOfficeActions(id: number): OfficeActions | null {
  const hit = actions.get(id);
  return hit && Date.now() - hit.at < 60_000 ? hit.a : null;
}

export function prefetchOfficeActions(id: number): void {
  if (asking.has(id) || cachedOfficeActions(id)) return;
  asking.add(id);
  void officeActions(id)
    .then((a) => actions.set(id, { at: Date.now(), a }))
    .catch(() => undefined)
    .finally(() => asking.delete(id));
}
