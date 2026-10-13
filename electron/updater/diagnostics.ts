import type { UpdateDiagnosticCheck, UpdateDiagnostics } from '@shared/types';

/**
 * Settings › Updates › Diagnostics: the nine checks that say why an update would not arrive or install, each Pass,
 * Low or Fail (or Skip when it does not apply), from what this computer can find out by itself. Nothing here
 * changes anything; Run again repeats them. A .deb or .rpm install adds three for its package repository
 * (worksuite-desktop#351), whose Fix buttons are the only changes, each behind a password prompt.
 */

export interface UpdateProbe {
  /** The Update Center answered (any HTTP answer), and how long it took. */
  reached: boolean;
  ms: number;
  status: number | null;
  /** The signed answer verified (true), did not (false), or there was none to check (null). */
  verified: boolean | null;
  keyId: string | null;
  reason: string | null;
  /** The package on offer, if any, and whether its download URL answers. */
  pkg: { size: number } | null;
  download: { ok: boolean; status: number | null } | null;
  /** The channel's newest version in the verified answer (the package repository check compares against it). */
  latest?: string | null;
}

export interface UpdateDiagnosticsDeps {
  now: () => Date;
  host: string;
  probe: () => Promise<UpdateProbe>;
  version: string;
  platform: 'windows' | 'macos' | 'linux';
  arch: string;
  /** How this copy was installed, in words ("NSIS per-user", "AppImage", "package manager", "development build"). */
  installType: string;
  required: { minimum: string | null } | null;
  channel: { label: string; source: string; fallback: boolean };
  freeBytes: () => Promise<number | null>;
  /** Whether WorkSuite can replace itself where it is installed; null when it does not update itself. */
  installWritable: () => Promise<{ ok: boolean; detail: string } | null>;
  database: () => { result: string; schema: number | null };
  license: () => { signedIn: boolean; offline: boolean; lastVerifiedAt: string | null };
  /**
   * A .deb or .rpm install (worksuite-desktop#351): the package repository's checks (source file, key, version),
   * given the newest version. Absent elsewhere, so other installs keep the nine checks.
   */
  repo?: (latest: string | null) => Promise<UpdateDiagnosticCheck[]>;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function sizeText(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`;
}

/** Space an update needs here: the download, plus the kept previous version where rollback keeps one. */
export function spaceNeeded(platform: UpdateDiagnosticsDeps['platform'], packageSize: number): { bytes: number; withRollback: boolean } {
  // macOS: the DMG, the app taken out of it, and the previous app kept for rollback. Linux: the image and `.previous`.
  if (platform === 'macos') return { bytes: packageSize * 3, withRollback: true };
  if (platform === 'linux') return { bytes: packageSize * 2, withRollback: true };
  return { bytes: packageSize * 2, withRollback: false };
}

function ago(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export async function runUpdateDiagnostics(d: UpdateDiagnosticsDeps): Promise<UpdateDiagnostics> {
  const checks: UpdateDiagnosticCheck[] = [];
  const probe = await d.probe().catch(
    (): UpdateProbe => ({ reached: false, ms: 0, status: null, verified: null, keyId: null, reason: 'unreachable', pkg: null, download: null }),
  );

  checks.push(
    probe.reached && probe.status !== null && probe.status < 500
      ? { id: 'service', label: 'Update service reachable', status: probe.status < 400 ? 'pass' : 'fail', detail: `${d.host} · ${probe.ms} ms${probe.status >= 400 ? ` · HTTP ${probe.status}` : ''}` }
      : { id: 'service', label: 'Update service reachable', status: 'fail', detail: `${d.host} · ${probe.status ? `HTTP ${probe.status}` : 'not reachable'}` },
  );

  checks.push({
    id: 'version',
    label: 'Current version',
    status: d.required ? 'fail' : 'pass',
    detail: `${d.version} · ${d.platform}-${d.arch} · ${d.installType}${d.required?.minimum ? ` · below the minimum ${d.required.minimum}` : d.required ? ' · no longer supported' : ''}`,
  });

  checks.push({ id: 'channel', label: 'Release channel', status: d.channel.fallback ? 'low' : 'pass', detail: `${d.channel.label} (${d.channel.source})` });

  checks.push(
    probe.verified === true
      ? { id: 'signature', label: 'Manifest signature', status: 'pass', detail: `Ed25519 · key ${probe.keyId ?? 'unknown'}` }
      : probe.verified === false
        ? { id: 'signature', label: 'Manifest signature', status: 'fail', detail: `Not valid (${probe.reason ?? 'unknown'})` }
        : { id: 'signature', label: 'Manifest signature', status: 'skip', detail: 'No answer to check' },
  );

  checks.push(
    !probe.download
      ? { id: 'download', label: 'Download access', status: 'skip', detail: probe.pkg ? 'Not checked' : 'No update on offer' }
      : probe.download.ok
        ? { id: 'download', label: 'Download access', status: 'pass', detail: 'Signed download URL answers' }
        : { id: 'download', label: 'Download access', status: 'fail', detail: probe.download.status ? `HTTP ${probe.download.status}` : 'Not reachable' },
  );

  const free = await d.freeBytes().catch(() => null);
  if (free === null) {
    checks.push({ id: 'disk', label: 'Disk space', status: 'skip', detail: 'Could not be read' });
  } else if (probe.pkg) {
    const need = spaceNeeded(d.platform, probe.pkg.size);
    const status = free < need.bytes ? 'fail' : free < need.bytes + GB ? 'low' : 'pass';
    checks.push({
      id: 'disk',
      label: 'Disk space',
      status,
      detail: `${sizeText(free)} free — ${sizeText(need.bytes)} needed${need.withRollback ? ' incl. rollback copy' : ''}`,
      ...(status !== 'pass' ? { fix: `Free at least ${sizeText(need.bytes + GB - free)} of disk space, then select Retry.` } : {}),
    });
  } else {
    checks.push({ id: 'disk', label: 'Disk space', status: free < GB ? 'low' : 'pass', detail: `${sizeText(free)} free` });
  }

  const w = await d.installWritable().catch(() => ({ ok: false, detail: 'Could not be checked' }));
  checks.push(w ? { id: 'permissions', label: 'Installer permissions', status: w.ok ? 'pass' : 'fail', detail: w.detail } : { id: 'permissions', label: 'Installer permissions', status: 'skip', detail: 'WorkSuite does not update itself here' });

  const db = d.database();
  checks.push({ id: 'database', label: 'Local database', status: db.result === 'ok' ? 'pass' : 'fail', detail: db.result === 'ok' ? `Integrity check passed${db.schema !== null ? ` · schema ${db.schema}` : ''}` : db.result });

  const l = d.license();
  checks.push(
    !l.signedIn
      ? { id: 'license', label: 'License status', status: 'fail', detail: 'Not signed in' }
      : l.offline
        ? { id: 'license', label: 'License status', status: 'low', detail: `Offline · last verified ${ago(l.lastVerifiedAt, d.now())}` }
        : { id: 'license', label: 'License status', status: 'pass', detail: `Signed in · verified ${ago(l.lastVerifiedAt, d.now())}` },
  );

  if (d.repo) checks.push(...(await d.repo(probe.latest ?? null).catch((): UpdateDiagnosticCheck[] => [])));

  return { ranAt: d.now().toISOString(), checks };
}
