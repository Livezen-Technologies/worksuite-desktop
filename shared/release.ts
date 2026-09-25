import { z } from 'zod';
import { compareVersions, parseVersion } from './version';
import type { Arch, Platform, UpdateChannel } from './types';

/**
 * Signed release manifest (FR-UPD-01, WF-25). The signature is Ed25519 over
 * the canonical JSON of every other field, made with an offline release key;
 * the public half is pinned in the app. A manifest that does not verify is
 * never acted on.
 */
export const artifactSchema = z.object({
  platform: z.enum(['windows', 'macos', 'linux']),
  arch: z.enum(['x64', 'arm64', 'universal']),
  kind: z.enum(['nsis', 'msi', 'zip', 'dmg', 'pkg', 'appimage', 'deb', 'rpm']),
  url: z.string().min(1).max(2048),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
});

export const manifestSchema = z.object({
  schema: z.literal(1),
  product: z.literal('worksuite-desktop'),
  version: z.string().refine((v) => parseVersion(v) !== null, 'invalid version'),
  channel: z.enum(['stable', 'beta', 'dev', 'org']),
  released_at: z.string(),
  critical: z.boolean().default(false),
  minimum_version: z.string().nullable().optional(),
  min_server_api: z.string().nullable().optional(),
  notes_url: z.string().nullable().optional(),
  artifacts: z.array(artifactSchema).min(1),
  signature: z.string().min(40),
});

export type ReleaseManifest = z.infer<typeof manifestSchema>;
export type ReleaseArtifact = z.infer<typeof artifactSchema>;

/** Which artifact kind this installation can install by itself. */
export function installableKinds(platform: Platform, runningAsAppImage: boolean): ReleaseArtifact['kind'][] {
  switch (platform) {
    case 'windows':
      return ['nsis'];
    case 'macos':
      return ['zip'];
    case 'linux':
      return runningAsAppImage ? ['appimage'] : [];
  }
}

export function selectArtifact(m: ReleaseManifest, platform: Platform, arch: Arch, kinds: ReleaseArtifact['kind'][]): ReleaseArtifact | null {
  const candidates = m.artifacts.filter((a) => a.platform === platform && kinds.includes(a.kind));
  return candidates.find((a) => a.arch === arch) ?? candidates.find((a) => a.arch === 'universal') ?? null;
}

/** Channels a client on `mine` accepts: stable ⊂ beta ⊂ dev; org is its own. */
export function channelAccepts(mine: UpdateChannel, offered: UpdateChannel): boolean {
  if (mine === 'org' || offered === 'org') return mine === offered;
  const rank: Record<Exclude<UpdateChannel, 'org'>, number> = { stable: 0, beta: 1, dev: 2 };
  return rank[offered as Exclude<UpdateChannel, 'org'>] <= rank[mine as Exclude<UpdateChannel, 'org'>];
}

export function isNewer(offered: string, current: string): boolean {
  return compareVersions(offered, current) > 0;
}

/** Resolves an artifact URL relative to the manifest; only https (or the dev server) is allowed. */
export function resolveArtifactUrl(url: string, manifestUrl: string, allowInsecure: boolean): string | null {
  try {
    const u = new URL(url, manifestUrl);
    if (u.protocol === 'https:' || (allowInsecure && u.protocol === 'http:')) return u.toString();
    return null;
  } catch {
    return null;
  }
}

/** Forced-restart warning points before a critical update's deadline (FR-UPD-05). */
export const DEADLINE_WARNINGS_MS = [4 * 3600_000, 3600_000, 10 * 60_000];
