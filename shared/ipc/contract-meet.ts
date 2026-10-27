import { ch, none } from './contract-kit';
import { z } from 'zod';
import type { ShareBarState } from '../share-bar';
import type { ActiveCall, ScreenRecordingAccess, LocalRecording, SpeechStatus, SpeechCatalog, SpeechSegment } from '../types';

/** Meet, its recordings and speech, and calls: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const meetContract = {
  /*
   * The sharing bar (WS-MEET-ENH-01 D03). The meeting's own window says what
   * the bar should show; the bar's window asks for the current state when it
   * opens and sends back what was pressed, which main hands to the meeting.
   */
  'meet:barState': ch(
    z.object({
      label: z.string().max(200),
      paused: z.boolean(),
      micOn: z.boolean(),
      cameraOn: z.boolean(),
      unreadChat: z.number().int().min(0).max(999),
      since: z.number().int().min(0),
    }),
    { session: true, rate: 8 },
  ),
  'meet:barRead': ch(none, { session: true, rate: 8 }),
  'meet:barAction': ch(z.object({ id: z.enum(['meet-mute', 'meet-camera', 'meet-chat', 'meet-pause-share', 'meet-stop-share']) }), { session: true, rate: 12 }),
  'calls:active': ch(
    z.object({
      uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).nullable(),
      /** A chat call (hung up on the server when its window closes) or a meeting. */
      kind: z.enum(['call', 'meet']).optional(),
      title: z.string().max(200).optional(),
    }),
    { session: true, rate: 10 },
  ),
  'calls:list': ch(none, { session: true }),

  /*
   * Meetings recorded on this computer (worksuite-desktop#68). The meeting's window records and hands the pieces
   * over; this process writes, finishes and uploads them. A page never names a path: the folder is chosen with the
   * dialog here, and recordings are named by their id.
   */
  'meetrec:preflight': ch(none, { session: true, rate: 10 }),
  'meetrec:start': ch(
    z.object({
      meeting: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
      title: z.string().max(190),
      layout: z.enum(['grid', 'speaker', 'screen']),
      mime: z.string().regex(/^video\/(webm|mp4)(;[A-Za-z0-9=,.\s-]{0,80})?$/),
    }),
    { session: true, rate: 4 },
  ),
  'meetrec:chunk': ch(z.object({ id: z.string().uuid(), data: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 16 * 1024 * 1024, 'A piece is at most 16 MB.') }), { session: true, whileLocked: true, rate: 120 }),
  'meetrec:active': ch(z.object({ id: z.string().uuid() }), { session: true, whileLocked: true, rate: 10 }),
  'meetrec:abort': ch(z.object({ id: z.string().uuid() }), { session: true, whileLocked: true, rate: 10 }),
  'meetrec:stop': ch(z.object({ id: z.string().uuid(), durationMs: z.number().int().min(0).max(24 * 3600 * 1000) }), { session: true, whileLocked: true, rate: 10 }),
  'meetrec:list': ch(none, { session: true }),
  'meetrec:retry': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'meetrec:discard': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'meetrec:reveal': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'meetrec:chooseFolder': ch(none, { session: true, rate: 3 }),
  /** Play the copy on this computer in the system's player (worksuite-desktop#89). */
  'meetrec:open': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10, permission: 'desktop.files.open_external' }),
  /** Downloads of Meet recordings, by the recording's id: the transfer that has (or is getting) each one. */
  'meetrec:downloads': ch(none, { session: true }),

  /*
   * Speech to text on this computer (worksuite-desktop#81). A meeting's window asks; the hidden speech page, loaded
   * with the person's whisper.cpp model, answers through the main process. Pieces are 16 kHz mono WAV.
   */
  'stt:status': ch(none, { session: true }),
  'stt:chooseModel': ch(none, { session: true, rate: 3 }),
  /** The server's speech models (G-11) and the company's local-speech setting; one is downloaded and SHA-256 checked. */
  'stt:catalog': ch(none, { session: true, rate: 10 }),
  'stt:install': ch(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i) }), { session: true, rate: 3 }),
  'stt:removeModel': ch(none, { session: true, rate: 3 }),
  'stt:transcribe': ch(
    z.object({ wav: z.instanceof(Uint8Array).refine((b) => b.byteLength > 44 && b.byteLength <= 12 * 1024 * 1024, 'A piece is at most 12 MB.'), language: z.enum(['en', 'si', 'ta', 'auto']) }),
    { session: true, rate: 120 },
  ),
  'speech:ready': ch(z.object({ ok: z.boolean(), error: z.string().max(500).optional() }), { session: true, rate: 10 }),
  'speech:result': ch(
    z.object({
      id: z.string().uuid(),
      segments: z.array(z.object({ start_ms: z.number().int().min(0), end_ms: z.number().int().min(0), text: z.string().max(4000), uncertain: z.boolean() })).max(1000).optional(),
      error: z.string().max(500).optional(),
    }),
    { session: true, rate: 240 },
  ),
  'calls:focus': ch(z.object({ windowId: z.number().int().positive() }), { session: true }),
};

export interface MeetOutputs {
  'meet:barState': void;
  'meet:barRead': { state: ShareBarState | null };
  'meet:barAction': void;
  'calls:active': void;
  'calls:list': ActiveCall[];
  'meetrec:preflight': { folder: string; free: number | null; ok: boolean; why: string | null; screen?: ScreenRecordingAccess; fix?: 'screen-permission' | null };
  'meetrec:start': { id: string };
  'meetrec:active': void;
  'meetrec:abort': void;
  'meetrec:chunk': void;
  'meetrec:stop': void;
  'meetrec:list': LocalRecording[];
  'meetrec:retry': void;
  'meetrec:discard': void;
  'meetrec:reveal': void;
  'meetrec:chooseFolder': string | null;
  'meetrec:open': boolean;
  'meetrec:downloads': Record<string, string>;
  'stt:status': SpeechStatus;
  'stt:chooseModel': SpeechStatus;
  'stt:catalog': SpeechCatalog;
  'stt:install': SpeechStatus;
  'stt:removeModel': SpeechStatus;
  'stt:transcribe': { segments: SpeechSegment[] };
  'speech:ready': void;
  'speech:result': void;
  'calls:focus': boolean;
}
