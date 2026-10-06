import { useSyncExternalStore } from 'react';
import type { PdfSessionView } from '@shared/pdf';

/**
 * PDF Studio's Recent and Starred lists (PRO-HOME-001/002, base PDF-OPEN-002):
 * the PDFs opened here — Drive files, files on this computer and mail
 * attachments — with where they live. Names and routes only, kept in this
 * window's storage per signed-in profile; never a path or the file's bytes.
 * Until the server's GET api/files/pdf/recent arrives (base §12.2) this is
 * this computer's own history; it does not follow the person to Web or Mobile.
 */
export interface RecentPdf {
  route: string;
  name: string;
  kind: PdfSessionView['source']['kind'];
  label: string;
  version: number | null;
  pages: number;
  size: number;
  at: string;
  starred: boolean;
}

const KEY = 'pdf.recent';
const MAX = 50;
let cache: RecentPdf[] | null = null;
const subs = new Set<() => void>();

function read(): RecentPdf[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(v) ? v.filter((x): x is RecentPdf => !!x && typeof x.route === 'string' && typeof x.name === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: RecentPdf[]): void {
  cache = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* a convenience only */
  }
  subs.forEach((f) => f());
}

export function recordOpened(route: string, v: PdfSessionView): void {
  const old = read().find((r) => r.route === route);
  const entry: RecentPdf = {
    route,
    name: v.name,
    kind: v.source.kind,
    label: v.source.label,
    version: v.source.version,
    pages: v.pageCount,
    size: v.size,
    at: new Date().toISOString(),
    starred: old?.starred ?? false,
  };
  write([entry, ...read().filter((r) => r.route !== route)]);
}

export function toggleStar(route: string): void {
  write(read().map((r) => (r.route === route ? { ...r, starred: !r.starred } : r)));
}

export function forget(route: string): void {
  write(read().filter((r) => r.route !== route));
}

export function clearRecent(): void {
  write(read().filter((r) => r.starred));
}

export function useRecent(): RecentPdf[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    read,
    read,
  );
}

/** For tests: forget what was read. */
export function resetRecentCache(): void {
  cache = null;
}
