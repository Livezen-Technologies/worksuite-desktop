/**
 * Pinned verification keys.
 *
 * RELEASE_PUBLIC_KEY verifies release manifests (WF-25). Its private half is
 * held offline by Livezen Technologies and never enters this repository —
 * see scripts/release-keygen.mjs.
 *
 * POLICY_PUBLIC_KEY verifies signed desktop policies from /desktop/v1. The
 * existing WorkSuite API does not sign policies, so it is empty until the
 * server gains a policy-signing key; unsigned policies are then applied as
 * `signed: false` and shown so in Diagnostics.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALYr1uZg/wxzQFyeAqaaDny7fEl8wuDP3W6N8jiNEGvQ=
-----END PUBLIC KEY-----`;

// Injected at build time (MAIN_VITE_POLICY_PUBLIC_KEY), never read from the
// runtime environment: a key that could be swapped at launch is not pinned.
export const POLICY_PUBLIC_KEY: string | null = (import.meta.env.MAIN_VITE_POLICY_PUBLIC_KEY as string | undefined) || null;
