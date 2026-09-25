/**
 * Module desktop contract (§15). Every desktop module declares a manifest; the
 * shell validates it before registering routes, quick actions, deep links or
 * shortcuts, and drops a module whose manifest is invalid without showing the
 * user anything (WF-02 exception path).
 */
import { z } from 'zod';

export const CONTRACT_VERSION = 1;

/** The only native capabilities a manifest may request (§15.2, FR-REG-07). */
export const NATIVE_CAPABILITIES = [
  'notifications',
  'printing',
  'camera',
  'microphone',
  'screen-share',
  'file-drop',
  'barcode',
  'hardware',
  'maps',
  'kiosk',
] as const;

export type NativeCapability = (typeof NATIVE_CAPABILITIES)[number];

export const OFFLINE_MODES = ['NONE', 'READ_CACHE', 'DRAFTS', 'PARTIAL_WRITE', 'FULL_OFFLINE'] as const;
export type OfflineMode = (typeof OFFLINE_MODES)[number];

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const manifestSchema = z.object({
  id,
  name: z.string().min(1).max(64),
  icon: z.string().max(64),
  contractVersion: z.number().int(),
  desktop: z.object({ enabled: z.boolean() }),
  offline: z.object({
    mode: z.enum(OFFLINE_MODES),
    entities: z.array(z.string().max(64)).max(64).default([]),
    /** API path prefixes whose GET responses may be served from the local cache. */
    cache: z.array(z.string().regex(/^\/api\/[a-z0-9/_-]+$/)).max(32).default([]),
  }),
  native: z.array(z.string()).max(16).default([]),
  windows: z
    .array(z.object({ id, route: z.string().max(256).optional(), kiosk: z.boolean().optional(), alwaysOnTop: z.boolean().optional() }))
    .max(16)
    .default([]),
  quickActions: z.array(z.object({ id, label: z.string().max(64), route: z.string().max(256).optional() })).max(16).default([]),
  deepLinks: z.array(z.string().max(128)).max(32).default([]),
  fileTypes: z.array(z.string().max(16)).max(16).default([]),
  widgets: z.array(z.object({ id, size: z.enum(['sm', 'md', 'lg']), permission: z.string().max(128).optional() })).max(16).default([]),
  background: z.array(z.string().max(64)).max(8).default([]),
});

export type DesktopManifest = z.infer<typeof manifestSchema>;
export type DesktopManifestInput = z.input<typeof manifestSchema>;

export interface ManifestCheck {
  ok: boolean;
  manifest?: DesktopManifest;
  /** Capabilities that were requested but are not on the allow-list; dropped. */
  dropped: string[];
  error?: string;
}

export function validateManifest(input: unknown): ManifestCheck {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, dropped: [], error: parsed.error.issues[0]?.message ?? 'invalid manifest' };
  const m = parsed.data;
  if (m.contractVersion !== CONTRACT_VERSION) {
    // NFR-MNT-03: incompatible contract versions are rejected gracefully.
    return { ok: false, dropped: [], error: `unsupported contract version ${m.contractVersion}` };
  }
  const allowed = new Set<string>(NATIVE_CAPABILITIES);
  const dropped = m.native.filter((c) => !allowed.has(c));
  if (dropped.length > 0) {
    // FR-REG-07: a manifest asking for something outside the allow-list is
    // rejected, not trimmed — a module that wants more than it may have is
    // not one to half-trust.
    return { ok: false, dropped, error: `capabilities not allowed: ${dropped.join(', ')}` };
  }
  return { ok: true, manifest: m, dropped: [] };
}

export function defineDesktopManifest(m: DesktopManifestInput): DesktopManifestInput {
  return m;
}
