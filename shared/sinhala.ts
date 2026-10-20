import { z } from 'zod';

/**
 * Sinhala Tools on the desktop (WorkSuite Desktop Sinhala Tools blueprint §6): what the window, the main process and
 * the worker share — the IPC contract (§6.2), the shapes the WorkSuite server answers with (§5, `api/sinhala/*`) and
 * the person's own settings. The engine itself is `@worksuite/sinhala-core` (vendor/sinhala-core), never copied here.
 */

/** The plugin's guid on the Document Server and in WorkSuite Office (blueprint §4). */
export const SINHALA_PLUGIN_GUID = 'asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}';

/** The default clipboard key (blueprint §6.1 Clipboard): Ctrl+Shift+U, ⌘⇧U on a Mac — changeable in Settings. */
export const SINHALA_DEFAULT_SHORTCUT = 'CommandOrControl+Shift+U';

/** The largest text one call converts: the server's limit (`POST api/sinhala/convert`, max 1 MB) in characters. */
export const SINHALA_MAX_TEXT = 500_000;

/** A converted copy of `Report.docx` is `Report (Unicode).docx` (blueprint §6.3), next to the original. */
export function unicodeCopyName(name: string): string {
  const m = /^(.*?)(\.[^.]+)?$/.exec(name);
  const stem = (m?.[1] || name).replace(/ \(Unicode\)$/, '');
  return `${stem} (Unicode)${m?.[2] ?? ''}`;
}

export type SinhalaDirection = 'toUnicode' | 'toLegacy';

/** Why the tools are not offered, or `ok`. Hidden — never an error — when the server or the org says no. */
export type SinhalaAvailability =
  | 'ok'
  /** Not signed in. */
  | 'signed_out'
  /** The server has no `api/sinhala` (404): an older WorkSuite. */
  | 'no_api'
  /** The organisation has Sinhala Tools off. */
  | 'disabled'
  /** The person lacks `sinhala.use` (403). */
  | 'forbidden';

/** The organisation's settings as the desktop uses them (blueprint §7 Org settings). */
export interface SinhalaOrgSettings {
  enabled: boolean;
  defaultProfile: string;
  targetFont: string;
  autoDetectOnPaste: 'prompt' | 'auto' | 'off';
  allowReverse: boolean;
  installFonts: 'ask' | 'always' | 'never';
  /** Personal settings the organisation fixed (`defaultProfile`, `shortcut`, `autoDetectOnPaste`). */
  locked: Array<keyof SinhalaUserSettings>;
}

export const SINHALA_ORG_DEFAULTS: SinhalaOrgSettings = {
  enabled: true,
  defaultProfile: 'fm-abhaya',
  targetFont: 'Noto Sans Sinhala',
  autoDetectOnPaste: 'prompt',
  allowReverse: true,
  installFonts: 'ask',
  locked: [],
};

/** This person's own choices on this computer (Settings › Language & Sinhala). */
export interface SinhalaUserSettings {
  /** A profile id, or 'auto' (detected from the text). */
  defaultProfile: string;
  /** The clipboard key as Electron takes it, or null for none. */
  shortcut: string | null;
  autoDetectOnPaste: 'prompt' | 'auto' | 'off';
}

export const SINHALA_USER_DEFAULTS: SinhalaUserSettings = {
  defaultProfile: 'auto',
  shortcut: SINHALA_DEFAULT_SHORTCUT,
  autoDetectOnPaste: 'prompt',
};

/** A profile as the window sees it: no map, just what to show and pick. */
export interface SinhalaProfileSummary {
  id: string;
  name: string;
  version: string;
  status: 'verified' | 'provisional';
  fontNames: string[];
  sha256: string;
  /** Where this copy came from: the server (checked), the last good copy kept here, or the engine's own. */
  source: 'server' | 'cache' | 'builtin';
  /** Whether a signature was checked (only when the server sends one). */
  signed: boolean;
}

export interface SinhalaProfilesView {
  profiles: SinhalaProfileSummary[];
  /** When profiles last came from the server, or null. */
  syncedAt: string | null;
  /** Profiles the server sent that failed their sha256 or signature: never used. */
  rejected: Array<{ id: string; version: string; reason: string }>;
}

export interface SinhalaStatus {
  availability: SinhalaAvailability;
  /** Converting works offline with the cached or built-in profiles even while the server cannot be reached. */
  offline: boolean;
  org: SinhalaOrgSettings;
  user: SinhalaUserSettings;
  /** The clipboard key while it is held, or null (another app has it, none set, or not available). */
  shortcutHeld: string | null;
  /** Uploads of converted copies waiting for the network. */
  pendingUploads: number;
  engineVersion: string;
}

export interface SinhalaUnmapped {
  offset: number;
  text: string;
  codePoint: string;
}

export interface SinhalaConvertResult {
  text: string;
  unmapped: SinhalaUnmapped[];
  profile: string;
  profileVersion: string;
  direction: SinhalaDirection;
}

export interface SinhalaDetectResult {
  kind: 'unicode' | 'legacy' | 'mixed' | 'latin' | 'empty';
  segments: Array<{ start: number; end: number; kind: 'unicode' | 'legacy' | 'latin' }>;
  profile: string | null;
  confidence: number;
}

export interface SinhalaClipboardResult {
  /** Whether the clipboard was replaced (false: nothing legacy on it, or empty). */
  changed: boolean;
  profile: string | null;
  profileVersion: string | null;
  unmapped: number;
  chars: number;
  ms: number;
}

export type SinhalaJobState = 'queued' | 'running' | 'done' | 'failed' | 'waiting_upload' | 'uploaded' | 'conflict';

/** A document conversion: a server job (online Drive file) or one done here (offline, or a file on this computer). */
export interface SinhalaJob {
  id: string;
  where: 'server' | 'local';
  state: SinhalaJobState;
  name: string;
  profile: string;
  profileVersion: string | null;
  /** Runs converted, runs in a legacy font, characters left unconverted. */
  runsTotal: number;
  runsConverted: number;
  unmappedCount: number;
  /** Before → after of the first changed runs (blueprint WF-SI-02 step 3). */
  preview: Array<{ before: string; after: string }>;
  /** The converted copy on this computer (local jobs). */
  outputName: string | null;
  /** The new Drive version (server jobs, or an upload that went through). */
  resultVersionId: number | null;
  error: string | null;
}

export interface SinhalaFontFamily {
  family: string;
  kind: 'unicode' | 'legacy';
  installed: boolean;
  /** Only fonts the organisation marked distributable are installed on a device (blueprint §7 Fonts). */
  distributable: boolean;
  licence: string | null;
}

export interface SinhalaFontsStatus {
  supported: boolean;
  /** Where fonts go for this person on this OS. */
  dir: string | null;
  families: SinhalaFontFamily[];
  policy: SinhalaOrgSettings['installFonts'];
}

export interface SinhalaDocxResult {
  bytes: Uint8Array;
  runsTotal: number;
  runsConverted: number;
  unmappedCount: number;
  profile: string;
  profileVersion: string;
  preview: Array<{ before: string; after: string }>;
}

// ── the server's answers (`api/sinhala/*`, blueprint §5) ──────────────────

/** A profile as `GET api/sinhala/profiles` sends it: the engine's shape plus an optional Ed25519 signature. */
export const serverProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().max(120),
    version: z.string().max(32),
    status: z.enum(['verified', 'provisional']).catch('provisional'),
    fontNames: z.array(z.string().max(120)).max(64),
    notes: z.string().max(4000).default(''),
    passthrough: z.string().max(512),
    map: z.array(z.tuple([z.string().min(1).max(16), z.string().min(1).max(16)])).max(4096),
    prebase: z.array(z.string().max(4)).max(16),
    compose: z.array(z.tuple([z.string().max(8), z.string().max(4)])).max(64),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().max(200).nullable().optional(),
  })
  .passthrough();
export type ServerProfile = z.infer<typeof serverProfileSchema>;

const orgSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    default_profile: z.string().max(64).optional(),
    target_font: z.string().max(120).optional(),
    auto_detect_on_paste: z.enum(['prompt', 'auto', 'off']).optional(),
    allow_reverse: z.boolean().optional(),
    install_fonts: z.enum(['ask', 'always', 'never']).optional(),
    locked: z.array(z.string().max(40)).max(10).optional(),
  })
  .passthrough();

/** `GET api/sinhala/profiles`: `{profiles}`, or a bare list; `settings` when the server sends the org's settings along. */
export const profilesResponseSchema = z.union([
  z.object({ profiles: z.array(z.unknown()).max(64), settings: orgSettingsSchema.nullable().optional(), enabled: z.boolean().optional() }).passthrough(),
  z.array(z.unknown()).max(64).transform((profiles) => ({ profiles, settings: null, enabled: undefined })),
]);

export function orgSettingsFrom(raw: unknown, enabled?: boolean): SinhalaOrgSettings {
  const p = orgSettingsSchema.safeParse(raw ?? {});
  const s = p.success ? p.data : {};
  const lockable: Array<keyof SinhalaUserSettings> = ['defaultProfile', 'shortcut', 'autoDetectOnPaste'];
  return {
    enabled: s.enabled ?? enabled ?? SINHALA_ORG_DEFAULTS.enabled,
    defaultProfile: s.default_profile ?? SINHALA_ORG_DEFAULTS.defaultProfile,
    targetFont: s.target_font ?? SINHALA_ORG_DEFAULTS.targetFont,
    autoDetectOnPaste: s.auto_detect_on_paste ?? SINHALA_ORG_DEFAULTS.autoDetectOnPaste,
    allowReverse: s.allow_reverse ?? SINHALA_ORG_DEFAULTS.allowReverse,
    installFonts: s.install_fonts ?? SINHALA_ORG_DEFAULTS.installFonts,
    locked: (s.locked ?? []).filter((k): k is keyof SinhalaUserSettings => (lockable as string[]).includes(k)),
  };
}

/** `GET api/sinhala/fonts`: the org's font manifest (blueprint §5). */
export const fontManifestSchema = z.object({
  fonts: z
    .array(
      z
        .object({
          family: z.string().min(1).max(120),
          kind: z.enum(['unicode', 'legacy']),
          licence: z.string().max(400).nullable().optional(),
          distributable: z.boolean().default(false),
          files: z
            .array(z.object({ name: z.string().regex(/^[A-Za-z0-9 ._()-]{1,120}\.(ttf|otf)$/i), url: z.string().max(2048), sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().positive().max(50 * 1024 * 1024).optional() }))
            .max(16)
            .default([]),
        })
        .passthrough(),
    )
    .max(64),
});
export type SinhalaFontManifest = z.infer<typeof fontManifestSchema>;

/** `POST api/sinhala/files/{id}/convert` and `GET api/sinhala/jobs/{id}`. */
export const serverJobSchema = z
  .object({
    id: z.union([z.number(), z.string()]).transform(String),
    status: z.string().max(32),
    profile: z.string().max(64).nullable().optional(),
    profile_version: z.string().max(32).nullable().optional(),
    runs_total: z.number().int().nonnegative().nullable().optional(),
    runs_converted: z.number().int().nonnegative().nullable().optional(),
    unmapped_count: z.number().int().nonnegative().nullable().optional(),
    result_version_id: z.number().int().nullable().optional(),
    error: z.string().max(2000).nullable().optional(),
    preview: z.array(z.object({ before: z.string().max(2000), after: z.string().max(2000) }).passthrough()).max(50).nullable().optional(),
  })
  .passthrough();

// ── the IPC contract (§6.2) ────────────────────────────────────────────────

const none = z.undefined().or(z.null()).optional();
const profileId = z.string().regex(/^(auto|[a-z0-9][a-z0-9-]{0,63})$/);
const text = z.string().max(SINHALA_MAX_TEXT);
const handle = z.string().uuid();
const driveId = z.number().int().positive().max(2 ** 31);
const accelerator = z.string().regex(/^(?:(?:CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super|Meta)\+){1,3}[A-Za-z0-9]$/);

export const sinhalaSettingsPatch = z.strictObject({
  defaultProfile: profileId.optional(),
  shortcut: accelerator.nullable().optional(),
  autoDetectOnPaste: z.enum(['prompt', 'auto', 'off']).optional(),
});
export type SinhalaSettingsPatch = z.infer<typeof sinhalaSettingsPatch>;

export const sinhalaConvertFileInput = z.strictObject({
  source: z.discriminatedUnion('kind', [
    /** A Drive file: the server's job when online, the offline copy here when not (blueprint §6.3). */
    z.strictObject({ kind: z.literal('drive'), fileId: driveId, name: z.string().min(1).max(255).optional() }),
    /** A file on this computer, by the handle `registerDropped` / `pickFile` gave. */
    z.strictObject({ kind: z.literal('local'), handle }),
  ]),
  profile: profileId.optional(),
});
export type SinhalaConvertFileInput = z.infer<typeof sinhalaConvertFileInput>;

const docxBytes = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 100 * 1024 * 1024, 'The document is empty or too large.');

/** Spread into `contract` (shared/ipc/contract.ts), at the blueprint's rates; all need a session. */
export const sinhalaContract = {
  'sinhala:status': { input: none, session: true, rate: 5 },
  'sinhala:detect': { input: z.strictObject({ text, fontNames: z.array(z.string().max(120)).max(8).optional() }), session: true, rate: 30 },
  'sinhala:convert': { input: z.strictObject({ text, profile: profileId.optional(), direction: z.enum(['toUnicode', 'toLegacy']).default('toUnicode') }), session: true, rate: 30 },
  'sinhala:convertFile': { input: sinhalaConvertFileInput, session: true, rate: 2, sensitive: true },
  'sinhala:job': { input: z.strictObject({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }), session: true, rate: 5 },
  'sinhala:profiles': { input: z.strictObject({ refresh: z.boolean().optional() }).optional().or(z.null()), session: true, rate: 2 },
  /** Blueprint `sinhala:fonts:status` / `sinhala:fonts:install` (channel names have one colon). */
  'sinhala:fontsStatus': { input: none, session: true, rate: 1 },
  'sinhala:fontsInstall': { input: z.strictObject({ families: z.array(z.string().min(1).max(120)).max(32).optional() }).optional().or(z.null()), session: true, rate: 1, sensitive: true },
  'sinhala:clipboard': { input: z.strictObject({ profile: profileId.optional() }).optional().or(z.null()), session: true, rate: 5 },
  'sinhala:settings': { input: none, session: true, rate: 5 },
  'sinhala:settingsSet': { input: sinhalaSettingsPatch, session: true, rate: 5 },
  /** The built-in editor's document (Office tab without a Document Server): converted here, given back as bytes. */
  'sinhala:convertDocx': { input: z.strictObject({ bytes: docxBytes, profile: profileId.optional() }), session: true, rate: 2 },
  /** Files from a real drop, as paths turned into handles (the preload's, like files:registerDropped). */
  'sinhala:registerDropped': { input: z.strictObject({ paths: z.array(z.string().min(1).max(4096)).min(1).max(20) }), session: true, rate: 5 },
  'sinhala:pickFile': { input: none, session: true, rate: 2 },
  /** The converted copy of a local job, shown in its folder. */
  'sinhala:reveal': { input: z.strictObject({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }), session: true, rate: 2 },
};

export interface SinhalaLocalFile {
  handle: string;
  name: string;
  size: number;
}

export interface SinhalaOutputs {
  'sinhala:status': SinhalaStatus;
  'sinhala:detect': SinhalaDetectResult;
  'sinhala:convert': SinhalaConvertResult;
  'sinhala:convertFile': { jobId: string };
  'sinhala:job': SinhalaJob;
  'sinhala:profiles': SinhalaProfilesView;
  'sinhala:fontsStatus': SinhalaFontsStatus;
  'sinhala:fontsInstall': SinhalaFontsStatus;
  'sinhala:clipboard': SinhalaClipboardResult;
  'sinhala:settings': SinhalaUserSettings;
  'sinhala:settingsSet': SinhalaUserSettings;
  'sinhala:convertDocx': SinhalaDocxResult;
  'sinhala:registerDropped': { files: SinhalaLocalFile[]; rejected: Array<{ name: string; reason: string }> };
  'sinhala:pickFile': SinhalaLocalFile[];
  'sinhala:reveal': boolean;
}
