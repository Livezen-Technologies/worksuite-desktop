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
  /** The person lacks `sinhala.use` (status `NO_PERMISSION`). */
  | 'forbidden';

/**
 * `GET api/sinhala/status`'s `reason`, as the server sends it. SINHALA_UNAVAILABLE (the server's engine is down) does
 * not hide the desktop's tools — this computer has its own engine — only the server's document jobs.
 */
export type SinhalaServerReason = 'NO_PERMISSION' | 'DISABLED_FOR_ORGANIZATION' | 'SINHALA_UNAVAILABLE';

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
  /** The server's engine answers (`status.worker.ok`): its document jobs can run. False also while offline. */
  serverEngine: boolean;
  /** What the server converts as documents (`status.formats`: docx, pptx). */
  serverFormats: string[];
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

/**
 * A job's state. The server's own (SinhalaJobs: queued → running → preview → done | rejected; no_change; failed;
 * conflict) as it sends them, and two of this computer's: `waiting_upload` (converted offline, waiting for the
 * network) and `uploaded`.
 */
export type SinhalaJobState = 'queued' | 'running' | 'preview' | 'done' | 'rejected' | 'no_change' | 'failed' | 'conflict' | 'waiting_upload' | 'uploaded';

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
  /** Before → after of the first changed runs (blueprint WF-SI-02 step 3; the server's `preview.samples`). */
  preview: Array<{ part?: string; before: string; after: string }>;
  /** Paragraphs the conversion changes (server jobs). */
  paragraphsChanged: number | null;
  /** A server job waiting for Accept or Reject from this person (`can_accept`): nothing is saved until Accept. */
  canAccept: boolean;
  /** Unmapped sequences, most frequent first (server jobs). */
  unmapped: Array<{ sequence: string; codePoint: string; count: number; firstOffset: number }>;
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
  preview: Array<{ part?: string; before: string; after: string }>;
}

// ── the server's answers (`api/sinhala/*`, WorkSuite app/Modules/Sinhala) ───

const settingValue = <T extends string>(values: readonly T[], fallback: T) => z.string().transform((v): T => ((values as readonly string[]).includes(v) ? (v as T) : fallback));

/** `GET api/sinhala/status` (any signed-in user): whether this person may see the tools, why not, the org's settings. */
export const statusResponseSchema = z
  .object({
    available: z.boolean(),
    reason: z.string().max(64).nullable().optional(),
    enabled: z.boolean().optional(),
    worker: z.object({ ok: z.boolean() }).passthrough().nullable().optional(),
    plugin_guid: z.string().max(80).optional(),
    default_profile: z.string().max(64).nullable().optional(),
    enabled_profiles: z.array(z.string().max(64)).max(64).optional(),
    target_font: z.string().max(120).optional(),
    allow_reverse: z.boolean().optional(),
    auto_detect_on_paste: settingValue(['prompt', 'auto', 'off'] as const, 'prompt').optional(),
    max_file_mb: z.number().optional(),
    formats: z.array(z.string().max(16)).max(16).optional(),
  })
  .passthrough();
export type SinhalaServerStatus = z.infer<typeof statusResponseSchema>;

/** The org settings the desktop uses, from `status` (and `fonts`' `desktop_install_fonts`). The server locks nothing. */
export function orgSettingsFrom(st: SinhalaServerStatus | null, installFonts?: string | null): SinhalaOrgSettings {
  const fonts = (['ask', 'always', 'never'] as const).find((v) => v === installFonts);
  return {
    enabled: st?.enabled ?? SINHALA_ORG_DEFAULTS.enabled,
    defaultProfile: st?.default_profile || SINHALA_ORG_DEFAULTS.defaultProfile,
    targetFont: st?.target_font || SINHALA_ORG_DEFAULTS.targetFont,
    autoDetectOnPaste: st?.auto_detect_on_paste ?? SINHALA_ORG_DEFAULTS.autoDetectOnPaste,
    allowReverse: st?.allow_reverse ?? SINHALA_ORG_DEFAULTS.allowReverse,
    installFonts: fonts ?? SINHALA_ORG_DEFAULTS.installFonts,
    locked: [],
  };
}

/**
 * One entry of `GET api/sinhala/profiles?include=map` (SinhalaProfiles::current): the listing's fields, and `profile`
 * — the engine's own profile JSON, `sha256` inside — which is what is checked and cached. `signature` is null until
 * the server signs profiles.
 */
export const serverProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().max(120),
    version: z.string().max(32),
    status: z.string().max(32).optional(),
    direction: z.string().max(16).optional(),
    font_names: z.array(z.string().max(120)).max(64).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().max(200).nullable().optional(),
    key_id: z.string().max(64).nullable().optional(),
    source_commit: z.string().max(64).nullable().optional(),
    profile: z.unknown().optional(),
  })
  .passthrough();
export type ServerProfile = z.infer<typeof serverProfileSchema>;

/** `GET api/sinhala/profiles`. */
export const profilesResponseSchema = z
  .object({ profiles: z.array(z.unknown()).max(64), default_profile: z.string().max(64).nullable().optional(), synced_at: z.string().max(40).nullable().optional() })
  .passthrough();

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const serverFont = z
  .object({
    id: z.number().int().optional(),
    family: z.string().min(1).max(120),
    kind: z.enum(['unicode', 'legacy']),
    profile: z.string().max(64).nullable().optional(),
    version: z.string().max(32).nullable().optional(),
    licence: z.string().max(400).nullable().optional(),
    distributable: z.boolean().default(false),
    /** The release archive (a .zip) for a distributable font, and its sha256. */
    download_url: z.string().max(2048).nullable().optional(),
    sha256: sha.nullable().optional(),
    /** Path inside the archive → that file's sha256 (fonts and licence texts). */
    files: z.record(z.string().max(300), sha).nullable().optional(),
    organization: z.boolean().optional(),
  })
  .passthrough();
export type SinhalaServerFont = z.infer<typeof serverFont>;

/** `GET api/sinhala/fonts` (SinhalaFonts::forOrg plus `desktop_install_fonts`). */
export const fontManifestSchema = z
  .object({
    unicode: z.array(serverFont).max(64).default([]),
    legacy: z.array(serverFont).max(64).default([]),
    target_font: z.string().max(120).optional(),
    desktop_install_fonts: z.string().max(16).optional(),
  })
  .passthrough();
export type SinhalaFontManifest = z.infer<typeof fontManifestSchema>;

/** A job as `POST files/{id}/convert` (202), `GET jobs/{id}` and `POST jobs/{id}/accept|reject` send it (SinhalaJobs::present). */
export const serverJobSchema = z
  .object({
    id: z.number().int(),
    status: z.string().max(32),
    file_id: z.number().int().optional(),
    file_name: z.string().max(255).nullable().optional(),
    source_version: z.number().int().nullable().optional(),
    result_version: z.number().int().nullable().optional(),
    profile: z.string().max(64).nullable().optional(),
    profile_version: z.string().max(80).nullable().optional(),
    runs_total: z.number().int().nonnegative().nullable().optional(),
    runs_converted: z.number().int().nonnegative().nullable().optional(),
    unmapped_count: z.number().int().nonnegative().nullable().optional(),
    unmapped: z
      .array(z.object({ profile: z.string().nullable().optional(), sequence: z.string().max(64), code_point: z.string().max(64), count: z.number().int(), first_offset: z.number().int() }).passthrough())
      .max(500)
      .nullable()
      .optional(),
    preview: z
      .object({
        paragraphs_changed: z.number().int().nullable().optional(),
        samples: z.array(z.object({ part: z.string().max(80).optional(), before: z.string().max(2000), after: z.string().max(2000) }).passthrough()).max(50).nullable().optional(),
        target_font: z.string().max(120).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    error: z.string().max(2000).nullable().optional(),
    can_accept: z.boolean().optional(),
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
  /** A server job's preview, saved as the file's new version (`POST jobs/{id}/accept`); 409 when the file moved on. */
  'sinhala:jobAccept': { input: z.strictObject({ jobId: z.string().regex(/^s-\d{1,12}$/) }), session: true, rate: 2, sensitive: true },
  /** A server job's preview, dropped (`POST jobs/{id}/reject`): nothing changes. */
  'sinhala:jobReject': { input: z.strictObject({ jobId: z.string().regex(/^s-\d{1,12}$/) }), session: true, rate: 2 },
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
  'sinhala:jobAccept': SinhalaJob;
  'sinhala:jobReject': SinhalaJob;
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
