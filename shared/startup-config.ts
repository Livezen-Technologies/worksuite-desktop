import { z } from 'zod';

/**
 * The startup screen's shape, as the server publishes it (Admin Center → Desktop Management → Authentication &
 * Login Settings). It rides in the discovery document's `startup` block, so it arrives signed by the same key as
 * the rest of the document, is cached with it for offline starts, and an older Desktop that knows nothing of it
 * simply ignores an unknown field.
 *
 * Nothing here is a security boundary on its own: a method hidden from the screen is also refused by the server
 * that publishes the config. This decides what is *shown*, in what order, and with which words. [ENH-AUTH-01 §1-3]
 */

/** Every login method an administrator can turn on or off. The first four are routes, the rest are credentials. */
export const STARTUP_METHODS = ['personal', 'enterprise', 'guest', 'meeting', 'email', 'google', 'microsoft', 'apple', 'passkey', 'sso'] as const;
export type StartupMethod = (typeof STARTUP_METHODS)[number];

/** The credential methods shown on the Personal welcome screen, in their default order. */
export const CREDENTIAL_METHODS = ['email', 'google', 'microsoft', 'apple', 'passkey'] as const satisfies readonly StartupMethod[];

/** How `Create Free Account` behaves: in the app (the account is made here) or in the browser (OneAuth's page). */
export type SignupMode = 'in_app' | 'browser' | 'off';

const text = z.string().trim().max(400).nullish();

export const startupConfigV1 = z.looseObject({
  /** Rises with every publish. Desktop keeps the highest it has seen, so a stale cache cannot undo a change. */
  config_version: z.number().int().nonnegative().default(0),
  published_at: z.string().max(40).nullish(),
  methods: z
    .looseObject({
      personal: z.boolean().default(true),
      enterprise: z.boolean().default(true),
      guest: z.boolean().default(true),
      meeting: z.boolean().default(true),
      email: z.boolean().default(true),
      google: z.boolean().default(true),
      microsoft: z.boolean().default(true),
      apple: z.boolean().default(true),
      passkey: z.boolean().default(true),
      sso: z.boolean().default(true),
    })
    .default({ personal: true, enterprise: true, guest: true, meeting: true, email: true, google: true, microsoft: true, apple: true, passkey: true, sso: true }),
  /** The credential buttons' order; anything missing keeps its default place, anything unknown is dropped. */
  order: z.array(z.enum(CREDENTIAL_METHODS)).max(CREDENTIAL_METHODS.length).default([]),
  /** The method the screen starts on. Ignored when that method is off. */
  default_method: z.enum(CREDENTIAL_METHODS).nullish(),
  signup: z.looseObject({ mode: z.enum(['in_app', 'browser', 'off']).default('browser') }).default({ mode: 'browser' }),
  /** Words on the screen. Null means "use the built-in English". */
  text: z.looseObject({ title: text, subtitle: text, personal_card: text, enterprise_card: text, footer: text }).default({}),
  /** The language the startup screen opens in, when the person has not chosen one. */
  language: z.string().max(8).nullish(),
  /** The mark and accent the screen wears. A logo that is not https is dropped: it would never load anyway. */
  branding: z
    .looseObject({
      logo: z
        .string()
        .max(2048)
        .nullish()
        .transform((v) => (v && /^https:\/\//i.test(v) ? v : null)),
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullish()
        .catch(null),
    })
    .default({ logo: null, accent: null }),
});

export type StartupConfig = z.infer<typeof startupConfigV1>;

export const DEFAULT_STARTUP: StartupConfig = startupConfigV1.parse({});

/** What local policy (managed.json, policy.json, the registry, a setup link) says. Local always wins. */
export interface LocalStartupPolicy {
  allowPersonal?: boolean;
  allowEnterprise?: boolean;
  guestAvailable?: boolean;
}

/** Reads the `startup` block out of a discovery document, falling back to the defaults on anything unusable. */
export function readStartupConfig(doc: unknown): StartupConfig {
  const block = (doc as { startup?: unknown } | null)?.startup;
  if (!block || typeof block !== 'object') return DEFAULT_STARTUP;
  const parsed = startupConfigV1.safeParse(block);
  return parsed.success ? withSafety(parsed.data) : DEFAULT_STARTUP;
}

/**
 * The rule that keeps an administrator from locking everyone out: at least one way in has to survive. If every
 * credential method was turned off, email comes back; if neither Personal nor Enterprise is left, Personal does.
 * The server refuses such a configuration too — this is the second line, for a cache written by an older server.
 */
export function withSafety(cfg: StartupConfig): StartupConfig {
  const methods = { ...cfg.methods };
  if (!CREDENTIAL_METHODS.some((m) => methods[m])) methods.email = true;
  if (!methods.personal && !methods.enterprise) methods.personal = true;
  return { ...cfg, methods };
}

/** Local policy over published config: an enterprise install's own rules cannot be loosened from the cloud. */
export function mergeStartup(remote: StartupConfig, local: LocalStartupPolicy | null | undefined): StartupConfig {
  if (!local) return withSafety(remote);
  const methods = { ...remote.methods };
  if (local.allowPersonal === false) methods.personal = false;
  if (local.allowEnterprise === false) methods.enterprise = false;
  if (local.guestAvailable === false) methods.guest = false;
  return withSafety({ ...remote, methods });
}

/** The credential buttons to show, in the published order, with the default method first when it is one of them. */
export function visibleCredentials(cfg: StartupConfig): StartupMethod[] {
  const ordered = [...cfg.order, ...CREDENTIAL_METHODS.filter((m) => !cfg.order.includes(m))];
  const on = ordered.filter((m) => cfg.methods[m]);
  const first = cfg.default_method && on.includes(cfg.default_method) ? cfg.default_method : null;
  return first ? [first, ...on.filter((m) => m !== first)] : on;
}

/** Whether `Create Free Account` is offered at all, and where it happens. */
export function signupMode(cfg: StartupConfig, serverAllowsSignup: boolean): SignupMode {
  if (!serverAllowsSignup) return 'off';
  return cfg.signup.mode;
}
