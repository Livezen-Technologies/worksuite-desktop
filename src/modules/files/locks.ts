/**
 * Passwords for locked folders, for this run of the app only (the web keeps
 * them for the browser session). Nothing is written to disk.
 */
const passwords = new Map<number, string>();

export const lockPassword = (id: number) => passwords.get(id) ?? null;
export const rememberPassword = (id: number, pw: string) => void passwords.set(id, pw);
export const forgetPassword = (id: number) => void passwords.delete(id);
