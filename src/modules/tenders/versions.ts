import { apiGet, apiPost } from '../../core/api';
import type { OfficeMode } from '@shared/office';

/**
 * A tender document's online editing and version history (the server's
 * `/tenders/documents/{id}/online`, `…/versions`, `…/compare` and
 * `…/versions/{v}/restore`). Each save of the online editor, each Replace and
 * each restore is a version of the document's own Drive file. What a reader
 * may do is the server's answer (`can`, `can_edit`, `mode`).
 */

const int = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const yes = (v: unknown) => v === true || v === 1 || v === '1';

export interface DocOnline {
  id: number;
  file_id: number | null;
  name: string;
  extension: string | null;
  version: number;
  /** The format opens in the online editor at all. */
  online: boolean;
  mode: Extract<OfficeMode, 'EDIT' | 'VIEW'> | null;
  can_edit: boolean;
  coediting: boolean;
  editor_url: string | null;
  /** Why it cannot be opened (or only read), in the server's words. */
  reason: string | null;
}

export function toOnline(d: Record<string, unknown>): DocOnline {
  const mode = d.mode === 'EDIT' || d.mode === 'VIEW' ? d.mode : null;
  return {
    id: int(d.id),
    file_id: intOrNull(d.file_id),
    name: String(d.name ?? ''),
    extension: str(d.extension),
    version: int(d.version) || 1,
    online: yes(d.online),
    mode,
    can_edit: yes(d.can_edit),
    coediting: yes(d.coediting),
    editor_url: str(d.editor_url),
    reason: str(d.reason),
  };
}

export const documentOnline = async (docId: number) => toOnline((await apiGet<Record<string, unknown>>(`/api/tenders/documents/${docId}/online`)) ?? {});

export interface DocVersion {
  version: number;
  size: number | null;
  current: boolean;
  author: string | null;
  made_at: string | null;
  label: string | null;
}

export interface DocVersions {
  id: number;
  title: string;
  file_id: number | null;
  current: number;
  /** The format's words can be compared (text, Word, …). */
  comparable: boolean;
  /** Newest first. */
  versions: DocVersion[];
  can: { view: boolean; download: boolean; restore: boolean; edit: boolean };
}

const author = (v: unknown): string | null => (v && typeof v === 'object' ? str((v as { name?: unknown }).name) : str(v));

export function toVersions(d: Record<string, unknown>): DocVersions {
  const can = (d.can ?? {}) as Record<string, unknown>;
  const versions = (Array.isArray(d.versions) ? (d.versions as Array<Record<string, unknown>>) : [])
    .map((v) => ({ version: int(v.version), size: intOrNull(v.size), current: yes(v.current), author: author(v.author), made_at: str(v.made_at), label: str(v.label) }))
    .filter((v) => v.version > 0)
    .sort((a, b) => b.version - a.version);
  return {
    id: int(d.id),
    title: String(d.title ?? ''),
    file_id: intOrNull(d.file_id),
    current: int(d.current) || (versions[0]?.version ?? 1),
    comparable: yes(d.comparable),
    versions,
    can: { view: yes(can.view), download: yes(can.download), restore: yes(can.restore), edit: yes(can.edit) },
  };
}

export const documentVersions = async (docId: number) => toVersions((await apiGet<Record<string, unknown>>(`/api/tenders/documents/${docId}/versions`)) ?? {});

export interface CompareSide {
  version: number;
  lines: string[];
  truncated: boolean;
}

const side = (s: unknown): CompareSide => {
  const o = (s ?? {}) as Record<string, unknown>;
  return { version: int(o.version), lines: Array.isArray(o.lines) ? o.lines.map((l) => String(l ?? '')) : [], truncated: yes(o.truncated) };
};

/** Two versions' words, a paragraph per line; the older is always `from`. */
export const compareVersions = async (docId: number, a: number, b: number): Promise<{ from: CompareSide; to: CompareSide }> => {
  const [from, to] = a < b ? [a, b] : [b, a];
  const d = (await apiGet<Record<string, unknown>>(`/api/tenders/documents/${docId}/compare`, { from: String(from), to: String(to) })) ?? {};
  return { from: side(d.from), to: side(d.to) };
};

/** Restores a version as the newest one; answers the version it became. */
export const restoreVersion = async (docId: number, version: number): Promise<number> => {
  const d = (await apiPost<Record<string, unknown>>(`/api/tenders/documents/${docId}/versions/${version}/restore`, {})) ?? {};
  return int(d.version);
};

/** "Title (v3).docx" — the name the server gives a version's file. */
export function versionFileName(name: string, version: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (v${version})${name.slice(dot)}` : `${name} (v${version})`;
}
