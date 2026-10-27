/**
 * Pinned verification keys.
 *
 * RELEASE_PUBLIC_KEY verifies the self-hosted release manifests of
 * scripts/release-manifest.mjs (WF-25). Its private half is held offline by
 * Livezen Technologies and never enters this repository — see
 * scripts/release-keygen.mjs. The app no longer reads those manifests: it
 * asks the WorkSuite Update Center, whose keys are in update-center.ts.
 *
 * POLICY_PUBLIC_KEY verifies signed desktop policies from /desktop/v1. It is
 * set from the WS_POLICY_PUBLIC_KEY secret at build time. With no key here and
 * none on the account (its trusted `discovery_key`), a release build refuses
 * every desktop policy and keeps the last valid one (POLICY_UNSIGNED_REFUSED,
 * audit D-G05); a development build applies it as `signed: false`, shown so in
 * Diagnostics.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALYr1uZg/wxzQFyeAqaaDny7fEl8wuDP3W6N8jiNEGvQ=
-----END PUBLIC KEY-----`;

// Injected at build time (MAIN_VITE_POLICY_PUBLIC_KEY), never read from the
// runtime environment: a key that could be swapped at launch is not pinned.
export const POLICY_PUBLIC_KEY: string | null = (import.meta.env.MAIN_VITE_POLICY_PUBLIC_KEY as string | undefined) || null;
