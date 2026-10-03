import type { BusyReport } from '@shared/types';
import { call, on } from './bridge';
import { flushDrafts } from './drafts';
import { flushTabs } from './tabs';

/**
 * Update & restart (worksuite-desktop#205), this window's part.
 *
 * Before WorkSuite restarts for an update, main asks every window (`update:prepare`) to write its drafts (mail,
 * chat, notes — anything typed in an editor that keeps a draft) and its open tabs now, rather than when their
 * debounce runs out, and to say when that is done. The same tabs and windows come back after the restart.
 */
export async function prepareForRestart(token: string): Promise<void> {
  await flushDrafts().catch(() => undefined);
  await flushTabs().catch(() => undefined);
  await call('updates:prepared', { token }).catch(() => undefined);
}

export function wireUpdatePrepare(): () => void {
  return on<{ token: string }>('update:prepare', (m) => void prepareForRestart(m.token));
}

/**
 * Installs the downloaded update and restarts. Not forced, the main process refuses over work in progress and
 * says what (`busy`); forced, the person has answered that question already.
 */
export async function restartToUpdate(force: boolean): Promise<{ started: boolean; busy: BusyReport | null; message: string | null }> {
  const r = await call('updates:installNow', { force });
  return { started: !!r?.started, busy: r?.busy ?? null, message: r?.message ?? null };
}
