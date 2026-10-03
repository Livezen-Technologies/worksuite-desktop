/**
 * What the data-file worker says about a file (ENH-MAIL-03 DMO-DAT-01…04).
 * Shared by the readers, the worker and the main process; nothing here is
 * ever given a path by the renderer.
 */

import type { DataFolder } from '@shared/mail-files';

export type { DataFileKind, DataFolder, MailFileView } from '@shared/mail-files';

export interface DataItem {
  /** The message as RFC 822. */
  raw?: Buffer;
  /** IMAP flags it had: \Seen, \Flagged, \Answered, \Draft. */
  flags: string[];
  /** When it was received or sent, ISO 8601. */
  date: string | null;
  subject?: string;
  /** Not a message to import (an appointment in a mail folder) — counted, not sent. */
  skip?: string;
  /** Could not be read. */
  error?: string;
}

export interface DataBatch {
  items: DataItem[];
  /** Where the next batch starts, or null at the end of the folder. */
  next: number | null;
}

export interface DataFileReader {
  folders(): { folders: DataFolder[]; unreadable: string[] };
  batch(folderId: number, offset: number, limit: number, maxBytes: number): DataBatch;
  close(): void;
}

/** Messages larger than this are not carried (the server's batch limit is 40 MB). */
export const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
