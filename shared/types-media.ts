

/** Local recordings and speech-to-text models. Re-exported by shared/types.ts (audit D-G13). */

/** A meeting recorded on this computer, through its steps (worksuite-desktop#68). */
export type LocalRecordingState = 'starting' | 'recording' | 'processing' | 'uploading' | 'ready' | 'failed';

export interface LocalRecording {
  id: string;
  /** The meeting's uuid. */
  meeting: string;
  title: string;
  state: LocalRecordingState;
  /** What went wrong, in a sentence, with what to do. */
  error: string | null;
  /** The step Retry starts again from. */
  failedAt: 'recording' | 'processing' | 'uploading' | 'registering' | null;
  /** Written so far. */
  bytes: number;
  /** Uploaded so far, while uploading. */
  uploaded: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  /** The file's name in the local folder, while it is kept. */
  fileName: string | null;
  /** The copy in the recorder's Drive, once there and checked. */
  driveFileId: number | null;
  /** When the local copy will be deleted, when the retention setting says so. */
  deleteAfter: string | null;
  /** Recovered after WorkSuite closed while it was recording. */
  recovered: boolean;
  /** When it entered the step it is in (worksuite-desktop#89): a step that goes on far too long is said to be stuck. */
  stepAt?: string | null;
  /** Its upload in the transfer queue, while there is one: its progress, Pause, Resume and Cancel are the queue's. */
  transferId?: string | null;
  /**
   * Why its file cannot be used (worksuite-desktop#240): nothing was recorded because Screen Recording permission
   * was off, no video reached the file, or the file is not a whole video. Trying again cannot fix any of these, so it
   * is never offered Try again — only Delete, and Fix permission when that is the cause.
   */
  problem?: LocalRecordingProblem | null;
}

/** Why a recording made here cannot be used, when trying again would not help (worksuite-desktop#240). */
export type LocalRecordingProblem = 'screen-permission' | 'no-video' | 'unplayable';

/** Whether this computer lets WorkSuite record the screen (macOS Screen Recording); elsewhere there is no such gate. */
export type ScreenRecordingAccess = 'granted' | 'missing' | 'not_required';

/** What a piece of speech said, when, and whether it was unclear (worksuite-desktop#81). */
export interface SpeechSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  uncertain: boolean;
}

/** A whisper.cpp model the server lists for this computer (G-11, `GET /api/ai/local/speech-catalog`). */
export interface SpeechCatalogModel {
  id: string;
  name: string;
  bytes: number;
  recommendedFor: string[];
  languages: string[];
  installed: boolean;
}

/**
 * Local speech as the company sets it (G-11, Q-05): off by default; `preferred` when the company wants transcripts
 * made on the computer first, `required` when online transcription is switched off.
 */
export interface SpeechCatalog {
  preferred: boolean;
  required: boolean;
  models: SpeechCatalogModel[];
  error: string | null;
}

/** Whether this computer can transcribe on its own, and if not why. */
export interface SpeechStatus {
  local: { ready: boolean; model: { name: string; size: number } | null; why: string | null };
}
