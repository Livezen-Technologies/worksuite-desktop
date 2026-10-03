import type { Card, MacContactsStatus } from '@shared/contact-sync';

/**
 * The Mac's own Contacts (CNContactStore), read on the Mac.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEEDS A NATIVE MODULE — NOT IN THIS BUILD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Electron has no Contacts API. Reading CNContactStore, asking for the Contacts permission
 * (NSContactsUsageDescription in Info.plist, `requestAccessForEntityType:`) and following its change history
 * (`CNChangeHistoryFetchRequest`, macOS 10.15+) take a small Objective-C/Swift addon. This file is the interface the
 * sync uses and the permission flow around it; the addon is loaded by name (`worksuite-mac-contacts`) when present.
 * Until it is shipped, `status()` says so plainly and nothing pretends to sync.
 *
 * ICLOUD IS NOT SYNCED TWICE. The Mac's Contacts usually show the iCloud book too, through a CardDAV container. Only
 * LOCAL containers ("On My Mac") are read here — `localOnly()` — and when the person has also connected iCloud, its
 * contacts come only through the iCloud account.
 */
export interface MacContainer {
  id: string;
  name: string;
  /** CNContainerType: local, exchange, cardDAV. */
  type: 'local' | 'exchange' | 'cardDAV' | 'unassigned';
}

export interface MacContact {
  identifier: string;
  containerId: string;
  card: Card;
  /** A version for change detection: the native side's modification stamp or a digest of the record. */
  version: string;
}

export interface MacContactsNative {
  authorizationStatus(): 'granted' | 'denied' | 'not-determined' | 'restricted';
  requestAccess(): Promise<boolean>;
  containers(): MacContainer[];
  contacts(containerIds: string[]): MacContact[];
  /** Change history since a token (base64), or null when the token is unknown: read everything. */
  changes?(token: string | null): { changed: MacContact[]; deleted: string[]; token: string } | null;
  save(containerId: string, identifier: string | null, card: Card): { identifier: string; version: string };
  remove(identifier: string): void;
}

/** The addon's module name, resolved only on macOS. */
const NATIVE = 'worksuite-mac-contacts';

export async function loadNative(platform: NodeJS.Platform = process.platform, load: (id: string) => Promise<unknown> = (id) => import(/* @vite-ignore */ id)): Promise<MacContactsNative | null> {
  if (platform !== 'darwin') return null;
  try {
    const m = (await load(NATIVE)) as { default?: MacContactsNative } & Partial<MacContactsNative>;
    const native = (m.default ?? m) as MacContactsNative;
    return typeof native.authorizationStatus === 'function' ? native : null;
  } catch {
    return null;
  }
}

export function macStatus(native: MacContactsNative | null, platform: NodeJS.Platform = process.platform): MacContactsStatus {
  if (platform !== 'darwin') return { platform: false, native: false, permission: 'unavailable', reason: 'Mac Contacts is only on a Mac.' };
  if (!native) {
    return {
      platform: true,
      native: false,
      permission: 'unavailable',
      reason: 'Reading Mac Contacts needs the native Contacts module, which is not in this version of WorkSuite yet. Connect iCloud instead to sync the contacts you keep in iCloud.',
    };
  }
  const permission = native.authorizationStatus();
  return {
    platform: true,
    native: true,
    permission,
    reason: permission === 'denied' ? 'WorkSuite is not allowed to read your contacts. Allow it in System Settings › Privacy & Security › Contacts.' : permission === 'restricted' ? 'Access to contacts is restricted on this Mac.' : null,
  };
}

/** The containers to read: the Mac's own, never a CardDAV (iCloud) or Exchange one that another account covers. */
export function localOnly(containers: MacContainer[]): MacContainer[] {
  return containers.filter((c) => c.type === 'local' || c.type === 'unassigned');
}
