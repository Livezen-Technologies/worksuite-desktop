import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

/**
 * What the server says it has (worksuite-desktop#259): its modules' versions and the features they offer, from
 * `GET /api/capabilities` — `{"communication": "2.4.0", "features": ["widget.behaviour", "chat.insights"],
 * "update_url": "/…", "can_update": true}` (docs/BACKEND.md). Screens use it to leave out what the server cannot do
 * rather than open onto "Not on this server yet".
 *
 * A server from before it answers 404, or anything that is not that shape, and the answer is null: every screen then
 * finds out for itself, as before, from its own endpoint's 404. Read once and kept for ten minutes.
 */
export interface ServerCapabilities {
  /** Module versions by module, lower case: `{communication: "2.4.0"}`. */
  versions: Record<string, string>;
  features: ReadonlySet<string>;
  /** Where this person may update the server's modules: a path on this server, only when the server says they may. */
  updatePath: string | null;
}

export const CAPABILITIES_PATH = '/api/capabilities';

const VERSION = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/;
const PATH = /^\/(?!\/)[A-Za-z0-9/_.~%?=&-]*$/;

/** The answer as the app reads it; null for anything without a `features` list. */
export function parseCapabilities(raw: unknown): ServerCapabilities | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.features)) return null;
  const versions: Record<string, string> = {};
  const add = (k: string, v: unknown) => {
    if (typeof v === 'string' && VERSION.test(v.trim())) versions[k.toLowerCase()] = v.trim();
  };
  // Each module's version at the top (`communication`), or under `modules`.
  for (const [k, v] of Object.entries(r)) if (k !== 'features' && k !== 'modules') add(k, v);
  if (r.modules && typeof r.modules === 'object' && !Array.isArray(r.modules)) for (const [k, v] of Object.entries(r.modules as Record<string, unknown>)) add(k, v);
  const features = new Set(r.features.filter((f): f is string => typeof f === 'string' && f.trim() !== '').map((f) => f.trim()));
  const updatePath = r.can_update === true && typeof r.update_url === 'string' && PATH.test(r.update_url) ? r.update_url : null;
  return { versions, features, updatePath };
}

const parts = (v: string) => v.split(/[-+]/)[0]!.split('.').map((n) => Number(n));

/** Whether version `have` is `need` or later: "2.10.0" is later than "2.4"; one that cannot be read is not. */
export function versionAtLeast(have: string | null | undefined, need: string): boolean {
  if (!have || !VERSION.test(have.trim()) || !VERSION.test(need.trim())) return false;
  const a = parts(have.trim());
  const b = parts(need.trim());
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** The server's capabilities; null until read, and from a server without them (a 404, a refusal, another shape). */
export function useServerCapabilities(): ServerCapabilities | null {
  const q = useQuery({
    queryKey: ['server', 'capabilities'],
    queryFn: ({ signal }) => apiGet<unknown>(CAPABILITIES_PATH, undefined, signal),
    select: parseCapabilities,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return q.data ?? null;
}
