/**
 * A work email's server (Connection & Startup §2 step 1): the addresses to try, in order —
 *  1. DNS TXT `_worksuite.<domain>`: `v=ws1; url=https://…`,
 *  2. `https://worksuite.<domain>`,
 *  3. `https://<domain>`.
 * The pipeline runs every check on each in turn; the first that passes wins. A TXT record only proposes an address:
 * it still has to pass TLS, the document, the signature and the product check like any typed one.
 */

export type ResolveTxt = (name: string) => Promise<string[][]>;

const TXT_TIMEOUT_MS = 5_000;

/** The URL a `v=ws1; url=…` record names, as an https origin, or null. */
export function parseWsTxt(record: string, allowLocalhost = false): string | null {
  const fields = new Map<string, string>();
  for (const part of record.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    fields.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  if (fields.get('v')?.toLowerCase() !== 'ws1') return null;
  const url = fields.get('url');
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) return null;
    if (u.protocol === 'https:') return u.origin;
    if (u.protocol === 'http:' && allowLocalhost && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return u.origin;
    return null;
  } catch {
    return null;
  }
}

export async function emailCandidates(domain: string, resolveTxt: ResolveTxt, opts: { allowLocalhost?: boolean; signal?: AbortSignal } = {}): Promise<string[]> {
  const out: string[] = [];
  try {
    const records = await Promise.race([
      resolveTxt(`_worksuite.${domain}`),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), TXT_TIMEOUT_MS);
        t.unref?.();
        opts.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    ]);
    for (const chunks of records) {
      const origin = parseWsTxt(chunks.join(''), opts.allowLocalhost);
      if (origin && !out.includes(origin)) out.push(origin);
    }
  } catch {
    // No record, or DNS out of reach: the well-known names still get their turn.
  }
  for (const o of [`https://worksuite.${domain}`, `https://${domain}`]) {
    if (!out.includes(o)) out.push(o);
  }
  return out;
}
