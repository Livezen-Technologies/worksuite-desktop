/**
 * WorkSuite Board's IPC channels: the offline pack vault, its queue and offline circular responses
 * (shared/board.ts, electron/services/board-vault.ts). Plain data so the sandboxed preload can import it.
 */
export const BOARD_INVOKE_CHANNELS = [
  'board:vaultStatus',
  'board:packDownload',
  'board:packOpen',
  'board:packRemove',
  'board:queueAdd',
  'board:queueList',
  'board:respondOffline',
  'board:sync',
  'board:search',
  'board:verify',
] as const;

export const BOARD_EVENT_CHANNELS = ['board:vaultChanged'] as const;
