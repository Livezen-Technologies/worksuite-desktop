import { ApiError } from '../../../../core/api';

/**
 * A refusal's field messages (worksuite-desktop#260): the server's `errors`, field → its sentence, or a list of them
 * with the first one meant, so each is shown under its own field rather than in a toast. Keys stay as the server wrote
 * them (`website_name`, `numbers.1.phone`); nothing at all for any other failure.
 */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.status < 400 || e.status >= 500 || !e.data || typeof e.data !== 'object' || Array.isArray(e.data)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.data as Record<string, unknown>)) {
    const first = Array.isArray(v) ? v.find((x) => typeof x === 'string') : v;
    if (typeof first === 'string' && first.trim()) out[k] = first.trim();
  }
  return out;
}
