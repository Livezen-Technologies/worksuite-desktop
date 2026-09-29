import { z } from 'zod';

/**
 * eLearning's offline copies on this computer (WS-ELN-SRS-001 P1, the server's
 * download manifest): what the renderer may ask the main process, and what it
 * is told. The server decides which files a course may take offline, which of
 * them may never leave the app (`protected`), and when a copy must go
 * (`POST me/downloads/validate`); the main process fetches, keeps and serves
 * the copies, encrypted, inside the profile. A page never names a path or an
 * address: it names a course, and a lesson in it.
 */

const id = z.number().int().positive().max(2_147_483_647);

export const elearningCourseRef = z.object({ courseId: id });
export const elearningDownloadInput = z.object({ courseId: id, title: z.string().min(1).max(200) });

/** A signed media token from a lesson's `file.urls.download` (`/media/{token}?download=1`), saved where the person keeps downloads. */
export const ELEARNING_MEDIA_TOKEN = /^[A-Za-z0-9_\-~.]{8,512}$/;

export type OfflineFileState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface OfflineLessonFile {
  lessonId: number;
  fileId: number;
  name: string;
  mime: string | null;
  bytes: number;
  /** The lesson does not allow downloading: the copy is for playing inside WorkSuite only. */
  protected: boolean;
  state: OfflineFileState;
  /** Bytes kept so far. */
  kept: number;
  error: string | null;
}

export interface OfflineCourse {
  courseId: number;
  title: string;
  /** The course version and builder revision the copy was made from. */
  version: number;
  revision: number;
  totalBytes: number;
  files: OfflineLessonFile[];
  /** The licence's end (the course's own end date); the copy is removed then, online or not. */
  expiresAt: string | null;
  downloadedAt: string;
  /** When the server last said the copy may stay. */
  validatedAt: string | null;
  /** ready = every file kept; downloading; partial = some failed or were stopped. */
  state: 'ready' | 'downloading' | 'partial';
}

export interface OfflineValidation {
  kept: number[];
  /** Courses whose copies were removed, and why. */
  removed: Array<{ courseId: number; reason: 'ended' | 'expired' }>;
  /** False when the server could not be asked (offline): only expired licences were applied. */
  asked: boolean;
}

/** Where a kept lesson file is played from: the app's own origin, served by the main process (decrypted as it is read). */
export function offlineLessonUrl(courseId: number, lessonId: number): string {
  return `app://bundle/__local/elearning/${courseId}/${lessonId}`;
}

/** The course and lesson a `/__local/elearning/…` address names, or null. */
export function parseOfflinePath(path: string): { courseId: number; lessonId: number } | null {
  const m = /^\/elearning\/(\d{1,10})\/(\d{1,10})$/.exec(path);
  if (!m) return null;
  const courseId = Number(m[1]);
  const lessonId = Number(m[2]);
  return courseId > 0 && lessonId > 0 ? { courseId, lessonId } : null;
}

/** A licence past its end: the copy goes, whether or not the server can be asked. */
export function licenceEnded(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(expiresAt) ? expiresAt : `${expiresAt.replace(' ', 'T')}Z`);
  return Number.isFinite(t) && t <= now;
}
