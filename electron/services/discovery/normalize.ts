import { isIP } from 'node:net';
import { SETUP_LINK_PREFIX } from '@shared/trusted-config';

/**
 * Step 1 of the pipeline: what was typed or scanned (Connection & Startup §2).
 *
 *  - `worksuite://setup?…` → a setup link;
 *  - `name@domain` → a work email (its domain is looked up, email-lookup.ts);
 *  - anything else → an https origin. A bare host gets `https://`; http is refused (HTTPS_REQUIRED) except for
 *    localhost in unpackaged builds; credentials, other schemes and unusable hosts are INVALID_ADDRESS. A path is
 *    dropped: the server is its origin.
 */
export type NormalizedInput =
  | { kind: 'origin'; origin: string }
  | { kind: 'email'; domain: string }
  | { kind: 'setup-link'; link: string }
  | { kind: 'invalid'; code: 'INVALID_ADDRESS' | 'HTTPS_REQUIRED' };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** A DNS host name a server can have: dotted labels (IDN already punycoded by URL), or localhost / an IP. */
export function isHostName(host: string): boolean {
  if (LOCAL_HOSTS.has(host) || isIP(host.replace(/^\[|\]$/g, ''))) return true;
  if (host.length > 253 || !host.includes('.')) return false;
  return host.split('.').every((l) => LABEL.test(l));
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

export function normalizeInput(input: string, opts: { allowLocalhost: boolean }): NormalizedInput {
  const raw = input.trim();
  const invalid = { kind: 'invalid', code: 'INVALID_ADDRESS' } as const;
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return invalid;
  if (raw.toLowerCase().startsWith(SETUP_LINK_PREFIX)) return { kind: 'setup-link', link: raw };

  const email = /^[^@/:]+@([^@/:]+)$/.exec(raw);
  if (email) {
    let domain: string;
    try {
      domain = new URL(`https://${email[1]}`).hostname;
    } catch {
      return invalid;
    }
    return isHostName(domain) && !isLocalHost(domain) && !isIP(domain) ? { kind: 'email', domain } : invalid;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return invalid;
  }
  if (u.username || u.password) return invalid;
  if (!isHostName(u.hostname)) return invalid;
  if (u.protocol === 'http:') {
    return opts.allowLocalhost && isLocalHost(u.hostname) ? { kind: 'origin', origin: u.origin } : { kind: 'invalid', code: 'HTTPS_REQUIRED' };
  }
  if (u.protocol !== 'https:') return invalid;
  return { kind: 'origin', origin: u.origin };
}
