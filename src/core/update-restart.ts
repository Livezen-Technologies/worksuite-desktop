import type { BusyReport } from '@shared/types';
import { restartCheck, type RestartCheck } from '@shared/updates';
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

/** What a restart would interrupt now: the question to ask first, if any ("3 changes waiting to sync. Restart anyway?"). */
export async function checkBeforeRestart(): Promise<RestartCheck & { busy: BusyReport | null }> {
  const busy = await call('updates:busy').catch(() => null);
  return { ...restartCheck(busy), busy };
}

/** Installs the downloaded update and restarts (the person has answered any question already). */
export async function restartToUpdate(): Promise<{ started: boolean; message: string | null }> {
  const r = await call('updates:installNow', { force: true });
  return { started: r.started, message: r.message };
}
