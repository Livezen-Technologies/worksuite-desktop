/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Ed25519 public key (PEM) for signed desktop policies; set at build time. */
  readonly MAIN_VITE_POLICY_PUBLIC_KEY?: string;
}
