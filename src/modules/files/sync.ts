import { useQuery } from '@tanstack/react-query';
import type { SyncItemState, SyncLookup, SyncStatus } from '@shared/types';
import { app } from '../../core/app-state';
import { call, hasDesktop, platform } from '../../core/bridge';
import { useStore } from '../../core/store';

/**
 * Drive sync, as the Files screens see it: what this computer keeps, and for
 * the rows on screen, whether each is here (the SYNC column; "On this Mac"
 * in Details). The answers come from the main process's index and are cached
 * on its revision, so a row changes the moment its file lands or leaves.
 */

export function useSync(): SyncStatus | null {
  return useStore(app, (s) => s.sync);
}

/** Sync is on offer here: the desktop app, and policy allows it. */
export function useSyncAvailable(): boolean {
  const s = useSync();
  return hasDesktop() && !!s?.available;
}

const EMPTY: SyncLookup = { files: {}, folders: {} };

export function useSyncLookup(files: number[], folders: number[], context: number | null): SyncLookup {
  const s = useSync();
  const on = hasDesktop() && !!s?.available && (s.folders.length ?? 0) > 0 && (files.length > 0 || folders.length > 0);
  const q = useQuery({
    queryKey: ['files', 'sync-lookup', s?.revision ?? 0, context, files.join(','), folders.join(','), s?.folders.map((f) => `${f.id}:${f.state}:${f.paused}`).join('|') ?? ''],
    queryFn: () => call('sync:lookup', { files: files.slice(0, 500), folders: folders.slice(0, 500), context }),
    enabled: on,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  return on ? (q.data ?? EMPTY) : EMPTY;
}

/** "On this Mac", "On this PC", "On this computer". */
export function hereLabel(): string {
  return platform === 'darwin' ? 'On this Mac' : platform === 'win32' ? 'On this PC' : 'On this computer';
}

/** "Show in Finder", "Show in File Explorer", "Show in folder". */
export function revealLabel(): string {
  return platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in File Explorer' : 'Show in folder';
}

export function computerWord(): string {
  return platform === 'darwin' ? 'Mac' : platform === 'win32' ? 'PC' : 'computer';
}

export const SYNC_WORDS: Record<SyncItemState, string> = {
  synced: 'Available offline',
  pending: 'Syncing',
  online: 'Online only',
  conflict: 'Conflicted — both copies kept',
  skipped: 'Not synced',
};
