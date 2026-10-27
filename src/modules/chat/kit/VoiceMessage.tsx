import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { readUrl } from '../AttachmentViewer';
import { formatClock } from '../parts';
import { mediaUrl } from '../types';
import type { Look } from './MessageAttachment';
import type { KitFile } from './model';
import { knownVoice, markHeard, readVoice, useHeard, voiceLabel, type VoiceInfo } from './voice';
import { resample, waveformOf } from './waveform';

/**
 * A voice message's player (worksuite-desktop#285), the same in Team Chat, a website chat and WhatsApp:
 * `[▶] ▁▃▆▇▅▂▃▆▇▄▂ 0:12 1×`. The play button is white on the other side's messages, the accent colour on my pale
 * ones (the drawer, WhatsApp) and white again on my indigo one, where the accent would not show. The bars are the
 * recording's loudness, the played part filled in; a click or a drag on them goes to that point. The time is the whole
 * length until it plays, then what is left. The speed goes 1× → 1.5× → 2×. The other side's message carries their
 * avatar with a microphone, and a dot until this person first plays it. Space plays and pauses when it has focus;
 * starting one voice message stops another.
 *
 * The sound streams through a hidden <audio> from the file's own address (the server's ranges, through the app's proxy
 * where it needs the session). An AAC copy (`m4a_url`) plays where the original cannot. Length and loudness come with
 * the message; a message without them has them read from the recording, once (see `readVoice`).
 */

/** Bars drawn: the 64 steps of a waveform fit the bubble as this many, thinner where there is less room. */
const BARS = 36;
const RATES = [1, 1.5, 2] as const;
type Rate = (typeof RATES)[number];
/** The voice message playing now: starting another stops it. */
let current: HTMLAudioElement | null = null;

/** What the player needs of the file. */
export type VoiceFile = Pick<KitFile, 'url' | 'download_url' | 'size'> & Partial<Pick<KitFile, 'duration_ms' | 'waveform' | 'm4a_url' | 'status'>>;

/** The message a voice message is in. */
export interface VoiceOf {
  /** Keys what is known of it and "played here": the kit's message key (`m12`, `w8`), or `wa3` for WhatsApp. */
  key: string;
  /** The client id it was sent with, under which its sender's own measurements wait. */
  alias?: string | null;
  /** The server's word that this person has played it; absent from an older server. */
  listened?: boolean;
  /** Where playing it is noted on the server (Team Chat); left out, it is remembered on this computer only. */
  listenedPath?: string | null;
  /** The other side's avatar, drawn with a microphone badge. */
  avatar?: ReactNode;
}

/** A voice message still on its way: the ring on the play button, Retry when it failed, ✕ to stop it. */
export interface VoiceUpload {
  /** How much has gone, 0–1; null while it waits, is prepared or the server finishes. */
  progress: number | null;
  failed: boolean;
  /** Why it did not go: the Retry button's tooltip. */
  error?: string | null;
  onRetry: () => void;
  /** Stops sending it: only while it is on its way. */
  onCancel?: () => void;
}

/** The ring round the play button: how much has gone, turning while nothing can be said, red when it failed. */
function Ring({ progress, failed }: { progress: number | null; failed: boolean }) {
  const r = 20;
  const round = 2 * Math.PI * r;
  return (
    <svg aria-hidden="true" viewBox="0 0 44 44" className={cx('pointer-events-none absolute -inset-1 h-11 w-11 -rotate-90', progress === null && !failed && 'animate-spin')}>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" className={failed ? 'stroke-danger' : 'stroke-current opacity-20'} />
      {failed ? null : <circle data-ring cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-current" strokeDasharray={round} strokeDashoffset={round * (1 - (progress ?? 0.25))} />}
    </svg>
  );
}

export function VoiceMessage({ file, own, look, of, src, upload }: {
  file: VoiceFile;
  own: boolean;
  look: Look;
  of?: VoiceOf | null;
  /** A recording still on its way plays from its copy on this computer. */
  src?: string | null;
  upload?: VoiceUpload | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Play was pressed; and to go on playing once the next address can (the AAC copy, or another go after a failure).
  const wanted = useRef(false);
  const resume = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState<Rate>(1);
  const [backup, setBackup] = useState(false);
  const [broken, setBroken] = useState(false);
  // The player's own length, where it can tell (an Ogg or MP4; a WebM made in a browser says Infinity).
  const [measured, setMeasured] = useState<number | null>(null);
  const key = of?.key ?? null;
  const [info, setInfo] = useState<VoiceInfo | null>(() => knownVoice(key, of?.alias));
  const heardHere = useHeard(key);

  const sent = waveformOf(file.waveform);
  const ms = file.duration_ms && file.duration_ms > 0 ? file.duration_ms : null;
  const original = src ?? mediaUrl(file.url);
  const copy = mediaUrl(file.m4a_url);
  const playable = backup && copy ? copy : original;
  const readable = src ? null : readUrl(file);
  const missing = !sent || !ms;
  useEffect(() => {
    if (!missing || !key || !readable || info) return;
    let gone = false;
    void readVoice(key, readable, file.size).then((v) => {
      if (!gone && v) setInfo(v);
    });
    return () => {
      gone = true;
    };
  }, [missing, key, readable, file.size, info]);

  const total = (ms ?? (measured ? measured * 1000 : null) ?? info?.ms ?? 0) / 1000;
  const peaks = sent ?? info?.peaks ?? null;
  const bars = peaks ? resample(peaks, BARS) : Array.from({ length: BARS }, () => 0);
  const done = total > 0 ? Math.min(1, pos / total) : 0;
  const clock = playing || pos > 0 ? (total > 0 ? Math.max(0, total - pos) : pos) : total;
  // A length not known yet is not "0:00".
  const shownClock = total > 0 || playing || pos > 0 ? formatClock(clock) : '–:––';
  const waiting = !upload && (file.status === 'processing' || !playable);
  const unheard = !own && !!key && !upload && of?.listened !== true && !heardHere;
  const page = look === 'page';
  // My message in the page look is indigo; everything else here is drawn on a light bubble.
  const onIndigo = page && own;

  const play = () => {
    const a = audio.current;
    if (!a || !playable) return;
    wanted.current = true;
    a.playbackRate = rate;
    void a.play()?.catch(() => undefined);
    if (!own && key) markHeard(key, of?.listenedPath);
  };
  const toggle = () => {
    if (broken) {
      // Another go, from the original again: it plays once it can.
      resume.current = true;
      wanted.current = true;
      setBroken(false);
      setBackup(false);
      audio.current?.load();
      return;
    }
    if (playing) {
      wanted.current = false;
      audio.current?.pause();
    } else play();
  };
  const seek = (fraction: number) => {
    const a = audio.current;
    if (!a || !(total > 0)) return;
    const at = Math.min(1, Math.max(0, fraction)) * total;
    try {
      a.currentTime = at;
    } catch {
      // Not seekable yet: the position shown still moves, and playing starts from the start.
    }
    setPos(at);
  };
  const seekAt = (x: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (r && r.width > 0) seek((x - r.left) / r.width);
  };
  const cycle = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    // A button's own Space presses that button.
    if ((e.key === ' ' || e.key === 'Spacebar') && (target === e.currentTarget || target.getAttribute('role') === 'slider')) {
      e.preventDefault();
      toggle();
    }
  };
  const speed = `${rate}×`;

  const button = upload?.failed ? (
    <button type="button" aria-label="Retry sending the voice message" title={upload.error ?? 'Retry'} onClick={upload.onRetry} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-danger hover:bg-danger-bg">
      <Icon name="rotate-cw" size={16} />
    </button>
  ) : (
    <button
      type="button"
      aria-label={broken ? 'This voice message could not be played. Try again' : playing ? 'Pause the voice message' : 'Play the voice message'}
      title={broken ? 'It could not be played. Try again' : undefined}
      disabled={!playable}
      onClick={toggle}
      className={cx(
        'flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-60',
        onIndigo ? 'bg-white text-primary' : own && !page ? 'bg-primary text-white hover:bg-primary-hover' : 'bg-surface text-primary shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.14)] ring-1 ring-line hover:bg-subtle',
      )}
    >
      <Icon name={broken ? 'alert' : playing ? 'pause' : 'play'} size={16} className={broken || playing ? undefined : 'translate-x-px fill-current'} />
    </button>
  );

  return (
    <div
      data-voice
      role="group"
      tabIndex={0}
      aria-label={voiceLabel(total)}
      onKeyDown={onKey}
      className={cx(
        'flex max-w-full items-center outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        page ? cx('w-[300px] gap-2 rounded-[12px] px-3 py-2', own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink') : 'w-[256px] gap-1.5 rounded-[8px] px-1 py-0.5 text-ink',
      )}
    >
      {of?.avatar && !own ? (
        <span data-voice-avatar className="relative shrink-0">
          {of.avatar}
          <span aria-hidden="true" className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white ring-2 ring-surface">
            <Icon name="mic" size={9} />
          </span>
        </span>
      ) : null}
      <span className={cx('relative flex h-9 w-9 shrink-0 items-center justify-center', onIndigo ? 'text-white' : 'text-primary')}>
        {button}
        {upload || waiting ? <Ring progress={upload ? (upload.failed ? 1 : upload.progress) : null} failed={!!upload?.failed} /> : null}
        {upload ? (
          <span
            role="progressbar"
            aria-label={upload.failed ? 'The voice message was not sent' : 'Sending the voice message'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={upload.progress !== null && !upload.failed ? Math.round(upload.progress * 100) : undefined}
            className="sr-only"
          />
        ) : null}
        {upload && !upload.failed && upload.onCancel ? (
          <button type="button" aria-label="Cancel sending" title="Cancel sending" onClick={upload.onCancel} className="absolute -top-1.5 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface text-ink-2 shadow ring-1 ring-line hover:text-danger">
            <Icon name="x" size={11} />
          </button>
        ) : null}
      </span>
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={text('{at} of {length}', { at: formatClock(pos), length: formatClock(total) })}
        onClick={(e) => seekAt(e.clientX)}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekAt(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : null;
          if (step !== null && total > 0) {
            e.preventDefault();
            seek((pos + step) / total);
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            seek(e.key === 'Home' ? 0 : 1);
          }
        }}
        className="flex h-7 min-w-0 flex-1 cursor-pointer touch-none items-center justify-between gap-px outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {bars.map((v, i) => (
          <span
            key={i}
            data-bar={Math.round(v)}
            className={cx(
              'max-w-[3px] min-w-px flex-1 rounded-full',
              done > 0 && (i + 0.5) / bars.length <= done
                ? onIndigo
                  ? 'bg-white'
                  : cx('bg-primary', own && 'dark:bg-indigo-bright')
                : onIndigo
                  ? 'bg-white/40'
                  : 'bg-muted dark:bg-white/25',
            )}
            style={{ height: `${Math.max(12, peaks ? v : 18)}%` }}
          />
        ))}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <span data-clock className={cx('font-mono text-[11.5px] tabular', onIndigo ? 'text-white/85' : 'text-ink-2')}>
          {shownClock}
        </span>
        {unheard ? <span data-unheard role="img" aria-label="Not played yet" title="Not played yet" className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
      </span>
      <button
        type="button"
        aria-label={text('Playback speed {speed}', { speed })}
        title="Playback speed"
        onClick={cycle}
        className={cx('h-[22px] min-w-[30px] shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular', onIndigo ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-black/[.06] text-ink-2 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15')}
      >
        {speed}
      </button>
      <audio
        ref={audio}
        src={playable ?? undefined}
        preload="metadata"
        className="hidden"
        onPlay={(e) => {
          if (current && current !== e.currentTarget) current.pause();
          current = e.currentTarget;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          wanted.current = false;
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => {
          if (!dragging.current) setPos(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setMeasured(d);
          e.currentTarget.playbackRate = rate;
        }}
        // A WebM learns its length once played through.
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setMeasured(d);
        }}
        onCanPlay={(e) => {
          // The AAC copy, or another go: it plays where play was pressed.
          if (resume.current && wanted.current && e.currentTarget.paused) {
            resume.current = false;
            e.currentTarget.playbackRate = rate;
            void e.currentTarget.play()?.catch(() => undefined);
          }
        }}
        onError={() => {
          if (!backup && copy && copy !== original) {
            resume.current = wanted.current;
            setBackup(true);
          } else {
            wanted.current = false;
            setBroken(true);
            setPlaying(false);
          }
        }}
      />
    </div>
  );
}
