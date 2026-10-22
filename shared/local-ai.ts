import { z } from 'zod';

/**
 * WorkSuite Local AI (WS-SRS-LAI), desktop: models run on this computer by llama.cpp in the `ws-local-ai`
 * utility process. Shared shapes: the model catalog (a signed manifest from WorkSuite's CDN, LAI-MOD / LAI-DL),
 * the installed models, the hardware tier (LAI-HW), and a generation request streamed back to the window.
 */

// ── the catalog (LAI-MOD-001…006) ─────────────────────────────────────────

export const LOCAL_AI_TIERS = ['minimal', 'basic', 'good', 'strong'] as const;
export type LocalAITier = (typeof LOCAL_AI_TIERS)[number];

export const localModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
  version: z.string().regex(/^[0-9A-Za-z._-]{1,32}$/),
  name: z.string().min(1).max(80),
  family: z.string().max(40),
  purpose: z.enum(['chat', 'embedding', 'router']),
  /** The GGUF file on the CDN (https only). */
  url: z.string().url().refine((u) => u.startsWith('https://'), 'https only'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  quantization: z.string().max(20),
  contextLength: z.number().int().positive(),
  /** Memory the model needs to run (weights + a working context), for the tier check. */
  minMemoryBytes: z.number().int().positive(),
  tiers: z.array(z.enum(LOCAL_AI_TIERS)).min(1),
  /** Recommended for these tiers (the onboarding default). */
  recommendedFor: z.array(z.enum(LOCAL_AI_TIERS)).default([]),
  license: z.object({ id: z.string().max(40), name: z.string().max(120), url: z.string().url() }),
  /** Notices the licence requires be shown to the person using the model (e.g. Gemma's), shown before and after download. */
  notice: z.string().max(2000).optional(),
  languages: z.array(z.string().max(12)).max(60).default([]),
  toolCalling: z.boolean().default(false),
});
export type LocalModel = z.infer<typeof localModelSchema>;

/** The catalog body. It is signed (Ed25519) as a whole; `LocalAICatalogEnvelope` carries body and signature. */
export const localCatalogSchema = z.object({
  schema: z.literal(1),
  issuedAt: z.string(),
  /** A catalog older than this is refused (a replayed old catalog cannot resurrect a withdrawn model). */
  expiresAt: z.string(),
  models: z.array(localModelSchema).max(100),
});
export type LocalAICatalog = z.infer<typeof localCatalogSchema>;

export const localCatalogEnvelopeSchema = z.object({
  /** The catalog JSON exactly as signed (a string, so no re-serialisation can change the bytes). */
  body: z.string().max(512 * 1024),
  /** base64 Ed25519 signature of `body` (UTF-8). */
  signature: z.string().regex(/^[A-Za-z0-9+/=]{80,100}$/),
  /** Which pinned key signed it. */
  keyId: z.string().regex(/^[a-z0-9-]{1,40}$/),
});
export type LocalAICatalogEnvelope = z.infer<typeof localCatalogEnvelopeSchema>;

// ── this computer (LAI-HW) ───────────────────────────────────────────────

export interface LocalAIHardware {
  platform: string;
  arch: string;
  memoryBytes: number;
  freeDiskBytes: number | null;
  cpuCores: number;
  /** The llama.cpp backend in use: metal, cuda, vulkan, or false for CPU only. */
  gpu: string | false;
  vramBytes: number;
  tier: LocalAITier;
}

/** A tier from memory (unified memory counts as GPU memory on Apple silicon). Thresholds per LAI-HW (to be tuned by benchmarks, OQ-05). */
export function tierFor(memoryBytes: number, vramBytes: number, gpu: string | false): LocalAITier {
  const gb = memoryBytes / 1024 ** 3;
  const vgb = vramBytes / 1024 ** 3;
  if (gb >= 32 || (gpu && vgb >= 10)) return 'strong';
  if (gb >= 16 || (gpu && vgb >= 6)) return 'good';
  if (gb >= 8) return 'basic';
  return 'minimal';
}

// ── state ───────────────────────────────────────────────────────────────

export type LocalModelState = 'available' | 'downloading' | 'paused' | 'verifying' | 'installed' | 'failed';

/**
 * Whether an installed model has been loaded and has answered on this computer (worksuite-desktop#55): a file that
 * matches its checksum can still be one this llama.cpp cannot run, so "Ready to use" waits for a real answer.
 * `untested` is a model installed before the check existed; it is still offered, and can be tested.
 */
export type LocalModelReadiness = 'untested' | 'testing' | 'ready' | 'failed';

export interface LocalModelView {
  model: LocalModel;
  state: LocalModelState;
  /** Bytes downloaded so far (downloading / paused). */
  received: number;
  error: string | null;
  /** Fits this computer's tier. */
  fits: boolean;
  recommended: boolean;
  isDefault: boolean;
  readiness: LocalModelReadiness;
  /** Why the readiness check failed. */
  readinessError: string | null;
  /** How fast the download has gone over the last 20 seconds, while downloading; null until it can tell. */
  bytesPerSecond?: number | null;
}

export type LocalRuntimeState = 'off' | 'starting' | 'ready' | 'loading' | 'busy' | 'error';

export interface LocalAIStatus {
  runtime: LocalRuntimeState;
  error: string | null;
  /** The model loaded in the runtime, if any. */
  loaded: string | null;
  hardware: LocalAIHardware | null;
  /** The catalog could not be fetched or verified: the reason, in words. */
  catalogError: string | null;
  catalogAt: string | null;
  /** Where the server's catalogue came from (G-02): `{server, cdn?}` model counts; null when from the app's CDN. */
  catalogSources?: Record<string, number> | null;
}

// ── requests (LAI-CORE, LAI-CHAT, LAI-WRT) ─────────────────────────────────

export const localMessageSchema = z.strictObject({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(200_000) });

export const localRequestSchema = z.strictObject({
  /** The window's id for this request (events carry it back). */
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  messages: z.array(localMessageSchema).min(1).max(200),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type LocalAIRequest = z.infer<typeof localRequestSchema>;

/** Streamed to the window that asked: text as it comes, then done (or an error). */
export type LocalAIEvent =
  | { id: string; type: 'chunk'; text: string }
  | { id: string; type: 'done'; text: string; tokens: number; ms: number; cancelled: boolean }
  | { id: string; type: 'error'; message: string };
