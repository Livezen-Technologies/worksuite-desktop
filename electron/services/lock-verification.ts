import { DesktopError } from '../main/errors';

/** Verify the current account before reducing local app-lock protection. */
export async function verifyLockChange(
  identity: () => { id: string | null; email: string | null },
  verifyPassword: (email: string, password: string) => Promise<boolean>,
  password: string | undefined,
): Promise<void> {
  const before = identity();
  if (!before.id || !before.email || !password || !(await verifyPassword(before.email, password)))
    throw new DesktopError('INVALID_CREDENTIALS', 'Verify your WorkSuite password before changing app-lock protection.');
  const after = identity();
  if (before.id !== after.id || before.email !== after.email) throw new DesktopError('SESSION_EXPIRED', 'Your account changed. Try again.');
}
