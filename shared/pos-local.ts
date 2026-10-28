/**
 * WorkSuite POS, offline: the till that works with no WorkSuite server and no WorkSuite Cloud account
 * (ENH-POS-01 §1). Its people are local to this computer, its data is a SQLite file beside the app's, and nothing
 * here needs a network.
 *
 * This file is the rules with no database and no Electron in them — what a role may do, what makes a password
 * acceptable, how a wrong one is answered — so they can be read, tested and reasoned about on their own.
 */

/** What a local person may be. A till has at least one owner; the rest are made by an owner or a manager. */
export const POS_ROLES = ['owner', 'manager', 'cashier'] as const;
export type PosRole = (typeof POS_ROLES)[number];

export const POS_PERMISSIONS = [
  /* Selling */
  'sell',
  'refund',
  'discount',
  'void_line',
  'void_sale',
  'no_sale', // opening the drawer without a sale
  /* The register */
  'open_register',
  'close_register',
  'cash_move', // paying in and paying out
  'count_drawer',
  /* The shop */
  'manage_products',
  'manage_customers',
  'manage_suppliers',
  'view_reports',
  /* The till itself */
  'manage_users',
  'manage_settings',
  'backup_restore',
  'sync_cloud',
] as const;
export type PosPermission = (typeof POS_PERMISSIONS)[number];

/**
 * What each role holds. A cashier sells and takes money; a manager also fixes prices, counts the drawer and reads
 * the day's figures; only an owner makes people, changes the till's settings, restores a backup or connects it to
 * WorkSuite — the four that can lose or leak everything on the machine.
 */
export const ROLE_PERMISSIONS: Record<PosRole, readonly PosPermission[]> = {
  cashier: ['sell', 'no_sale', 'open_register', 'close_register', 'count_drawer'],
  manager: ['sell', 'refund', 'discount', 'void_line', 'void_sale', 'no_sale', 'open_register', 'close_register', 'cash_move', 'count_drawer', 'manage_products', 'manage_customers', 'manage_suppliers', 'view_reports'],
  owner: [...POS_PERMISSIONS],
};

export function may(role: PosRole, permission: PosPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** A local person, as the screens see them. Never carries the password hash. */
export interface PosLocalUser {
  id: string;
  /** What they type to sign in: unique on this till, lower-cased, no spaces. */
  username: string;
  displayName: string;
  role: PosRole;
  /** A suspended person keeps their sales history but cannot sign in. */
  suspended: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  /** Locked until this moment, after too many wrong passwords. */
  lockedUntil: string | null;
}

/** Signing in can fail in ways the screen says differently. */
export type PosSignInRefusal = 'unknown' | 'wrong' | 'locked' | 'suspended';

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/** What is wrong with a username, or null. Trimmed and lower-cased before this. */
export function usernameProblem(name: string): string | null {
  if (!name) return 'Choose a username.';
  if (name.length < 2) return 'A username is at least two characters.';
  if (name.length > 32) return 'A username is at most 32 characters.';
  if (!USERNAME_RE.test(name)) return 'Use letters, digits, a dot, a dash or an underscore, starting with a letter or digit.';
  return null;
}

/**
 * What is wrong with a password, or null. A till is a shared machine in a shop, often with a short PIN by habit;
 * eight characters is the floor, and the three worst habits are refused by name rather than by a score nobody can
 * act on.
 */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length < 8) return 'A password is at least eight characters.';
  if (password.length > 256) return 'A password is at most 256 characters.';
  if (/^(.)\1+$/.test(password)) return 'That is the same character repeated. Choose something else.';
  if (/^(?:0123456789|123456789|12345678|password|qwertyui|abcd1234)$/i.test(password)) return 'That password is too easy to guess.';
  if (username && password.toLowerCase() === username.toLowerCase()) return 'The password cannot be the username.';
  return null;
}

/** Wrong passwords before the account is held, and for how long. Cleared by a successful sign-in. */
export const LOCK_AFTER = 5;
export const LOCK_MS = 5 * 60 * 1000;

/** When an account locks: after LOCK_AFTER wrong tries in a row, for LOCK_MS. Null while it is not locked. */
export function lockUntil(failedAttempts: number, now: number): string | null {
  return failedAttempts >= LOCK_AFTER ? new Date(now + LOCK_MS).toISOString() : null;
}

export function isLocked(lockedUntil: string | null, now: number): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > now;
}

/** How long before an idle till asks for the password again. A shop floor is not a desk. */
export const IDLE_LOCK_MS = 10 * 60 * 1000;

/**
 * The till cannot be left with nobody who can run it: the last owner may not be removed, suspended or demoted.
 * Returns why not, or null.
 */
export function lastOwnerProblem(users: Pick<PosLocalUser, 'id' | 'role' | 'suspended'>[], changing: string, to: { role?: PosRole; suspended?: boolean; removed?: boolean }): string | null {
  const after = users
    .filter((u) => !(to.removed && u.id === changing))
    .map((u) => (u.id === changing ? { ...u, role: to.role ?? u.role, suspended: to.suspended ?? u.suspended } : u));
  if (after.some((u) => u.role === 'owner' && !u.suspended)) return null;
  if (to.removed) return 'This is the only owner left. Make somebody else an owner first.';
  if (to.suspended) return 'This is the only owner left; suspending them would leave nobody who can run the till.';
  return 'This is the only owner left. Make somebody else an owner first.';
}
