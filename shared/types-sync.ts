

/** Drive sync on this computer: folders, issues, activity, conflicts, devices and policy. Re-exported by shared/types.ts (audit D-G13). */

/*
 * Drive sync (Phase 2; WorkSuite Drive FR-SYN-01…06, WF-15). A Drive folder
 * kept in step with a folder on this computer.
 */

/** Which way changes travel. The server's `sync_roots.mode` uses the same words. */
export type SyncMode = 'two_way' | 'upload_only' | 'download_only';

export type SyncFolderState = 'idle' | 'scanning' | 'syncing' | 'paused' | 'waiting' | 'error';

/** Something one pass could not do, and why — shown against the folder until a pass clears it. */
export interface SyncIssue {
  path: string;
  kind: 'skipped' | 'conflict' | 'error';
  message: string;
  /** When it happened (conflicts are shown for a day, whatever passes follow). */
  at?: string;
}

export interface SyncFolder {
  id: string;
  /** The Drive folder; null is the whole of My Drive. */
  folderId: number | null;
  folderName: string;
  /** Where it is on this computer (display only: the renderer never hands a path back). */
  localPath: string;
  mode: SyncMode;
  paused: boolean;
  state: SyncFolderState;
  /** What the pass under way still has to do. */
  pending: { up: number; down: number };
  /** What is on this computer and in step. */
  files: number;
  bytes: number;
  lastSyncAt: string | null;
  error: string | null;
  issues: SyncIssue[];
  /** Deletions held back until somebody confirms them (see DriveSync's deletion guard). */
  heldDeletions: { side: 'computer' | 'drive'; count: number } | null;
}

export interface SyncActivity {
  at: string;
  folderId: string;
  action: 'uploaded' | 'downloaded' | 'deleted-here' | 'deleted-in-drive' | 'moved' | 'conflict' | 'folder';
  path: string;
}

export interface SyncStatus {
  /** Policy and permission allow Drive sync on this computer. */
  available: boolean;
  /** Why not, in words for the person. */
  reason: string | null;
  state: 'off' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error' | 'disconnected' | 'blocked';
  message: string | null;
  /** Every folder paused from this computer. */
  paused: boolean;
  folders: SyncFolder[];
  activity: SyncActivity[];
  lastSyncAt: string | null;
  /** Where a new folder goes unless the person chooses elsewhere. */
  defaultRoot: string;
  /** Changes whenever what is on this computer changes; per-file answers are cached on it. */
  revision: number;
  /** This computer's id among the sync devices (the server's), once it has said hello. */
  deviceId: number | null;
}

export type SyncItemState = 'synced' | 'pending' | 'online' | 'conflict' | 'skipped';

/** Per-item answers for the rows on screen (the SYNC column, and "On this Mac" in Details). */
export interface SyncLookup {
  files: Record<string, { state: SyncItemState; path: string | null }>;
  folders: Record<string, { state: SyncItemState; path: string | null; syncFolderId: string | null; root: boolean }>;
}

/** A sync conflict the server holds open (Drive ENH-03 DSK-03): both versions kept, one to be made current. */
export interface DriveConflict {
  id: number;
  fileId: number;
  fileName: string;
  copyFileId: number | null;
  copyName: string | null;
  deviceName: string | null;
  baseVersion: number;
  serverVersion: number;
  serverSize: number | null;
  localSize: number | null;
  serverUpdatedAt: string | null;
  createdAt: string | null;
}

/** A synced picture on this computer, for the image editor (ENH-03 DSK-02). */
export interface LocalImageInfo {
  synced: boolean;
  version: number | null;
  canUpload: boolean;
  paused: boolean;
  pending: { baseVersion: number; savedAt: string; state: 'waiting' | 'conflict' | 'recipe-pending'; copyName: string | null; willBe: number } | null;
}

/** An offline edit's progress, as the image editor hears it. */
export interface LocalImageEvent {
  fileId: number;
  state: 'uploaded' | 'conflict' | 'saved';
  version?: number;
  copyId?: number | null;
}

/** A sync device as `/api/sync/devices` lists it. */
export interface SyncDevice {
  id: number;
  name: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  status: 'active' | 'paused' | 'disconnected' | 'wipe_pending' | 'wiped' | string;
  storageUsed: number;
  fileCount: number;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  wipeOrderedAt: string | null;
}

/** The sync policy the server applies (`SyncEngine::policy`). */
export interface SyncPolicy {
  max_devices: number;
  max_file_bytes: number;
  upload_kbps: number;
  download_kbps: number;
  blocked_types: string[];
  ignored_patterns: string[];
  allow_offline: boolean;
  require_encryption: boolean;
  block_size: number;
}
