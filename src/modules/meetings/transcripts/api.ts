/**
 * Meeting transcripts on the server (worksuite-desktop#81): `/api/meetings/{id}/transcripts`, `/api/meetings/transcripts/{t}`.
 */
export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  /** Empty when nobody could tell who spoke. */
  speaker: string;
  text: string;
  /** The speech was unclear; the words may be wrong. */
  uncertain: boolean;
}

export type TranscriptStatus = 'active' | 'processing' | 'ready' | 'failed' | 'cancelled';
export type TranscriptFormat = 'link' | 'pdf' | 'txt';

export interface AutoEmail {
  enabled: boolean;
  participant_ids: number[];
  format: TranscriptFormat;
}

export interface Transcript {
  id: number;
  meeting_id: number;
  recording_id: number | null;
  source: 'live' | 'recording';
  language: 'en' | 'si' | 'ta';
  status: TranscriptStatus;
  engine: 'local' | 'online' | null;
  progress: number;
  version: number;
  error: string | null;
  segments_count: number;
  auto_email: AutoEmail;
  auto_emailed_at: string | null;
  created_by: number | null;
  started_at: string | null;
  ended_at: string | null;
  edited_at: string | null;
  can: { correct: boolean; email: boolean };
  formats: TranscriptFormat[];
  segments?: TranscriptSegment[];
}

export interface Recipient {
  participant_id: number;
  name: string;
  email: string | null;
  allowed: boolean;
  why: string | null;
}

export interface Delivery {
  id: number;
  name: string;
  email: string;
  format: TranscriptFormat;
  version: number;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  automatic: boolean;
  sent_at: string | null;
}

export const UNIDENTIFIED = 'Unidentified speaker';

/** 01:02:03 */
export function stamp(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/** The transcript as text, as the minutes are drafted from it and as it is copied. */
export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${stamp(s.start_ms)}] ${s.speaker || UNIDENTIFIED}: ${s.text}${s.uncertain ? ' (unclear)' : ''}`).join('\n');
}
