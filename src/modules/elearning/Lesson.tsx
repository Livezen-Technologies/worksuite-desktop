import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { offlineLessonUrl } from '@shared/elearning-offline';
import { FileViewer } from '../../components/FileViewer';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { apiUrl } from '../../core/api';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { eGet, ePost, errorText, K, LESSON_ICON, OFFLINE, PlayedRanges, refusalCode, saveLessonFile, sendBeat, unreachable, when, type Beat, type BeatAnswer, type OpenLesson, type Progress, type TakingLesson } from './api';
import { keptFile, useOfflineCourses } from './offline';
import { Bar, Pill, Refusal, Rich, useEl } from './parts';

/** How often the player reports what was played, read or viewed (the server counts active time up to its idle gap between beats). */
const BEAT_MS = 15_000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * One lesson, as the learner takes it (§5.4, §5.5, WF-02 steps 4–6).
 * Opening it asks the server (`GET me/lessons/{id}`), which starts it and its
 * credit clock, or answers 423 with why it is locked. What happens next is
 * reported as it happens — ranges played, pages viewed, reading to the end —
 * and the server says when the lesson is complete. A lesson kept offline
 * plays from this computer's copy; its progress waits in the offline queue.
 */
export function Lesson({ courseId, id, card, onGo, onChanged }: { courseId: number; id: number; card: TakingLesson | null; onGo: (lesson: number) => void; onChanged: () => void }) {
  const el = useEl();
  const q = useQuery({ queryKey: K.lesson(id), queryFn: ({ signal }) => eGet<OpenLesson>(`/me/lessons/${id}`, undefined, signal), retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const offline = useOfflineCourses();
  const kept = keptFile(offline.list, courseId, id);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = q.data;
  const lesson = data?.lesson ?? null;
  const shown = progress ?? data?.progress ?? card?.progress ?? null;
  const prev = data?.previous_lesson_id ?? null;
  const next = data?.next_lesson_id ?? null;

  // Alt+← / Alt+→: the lesson before and after.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault();
        onGo(prev);
      } else if (e.key === 'ArrowRight' && next) {
        e.preventDefault();
        onGo(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onGo]);

  const shownStatus = useRef<string | null>(null);
  useEffect(() => {
    shownStatus.current = data?.progress.status ?? card?.progress.status ?? null;
  }, [data, card]);

  const answered = useCallback(
    (a: BeatAnswer | null, queued: boolean) => {
      if (queued) {
        setNote('Offline — progress is kept and sent when WorkSuite is back.');
        return;
      }
      if (!a) return;
      setProgress(a.progress);
      if (a.trimmed) setNote('Some of what was played was not counted: it came faster than the time since you opened the lesson allows.');
      else if (a.duration_known === false) setNote('This video’s length is not known yet, so watching it cannot complete the lesson. Tell the course’s instructor.');
      if (a.progress.status === 'COMPLETED' && shownStatus.current !== 'COMPLETED') {
        toast('success', 'Lesson complete.');
        onChanged();
      }
      shownStatus.current = a.progress.status;
    },
    [onChanged],
  );

  const beat = useCallback(
    async (b: Beat) => {
      try {
        const r = await sendBeat(id, b, `Progress in ${lesson?.title ?? card?.title ?? 'a lesson'}`);
        answered(r.answer, r.queued);
      } catch (e) {
        if (refusalCode(e) === 'locked') setNote(errorText(e));
      }
    },
    [id, lesson, card, answered],
  );

  const markDone = async () => {
    if (!el.online) return toast('error', OFFLINE);
    setBusy(true);
    try {
      const r = await ePost<{ progress: Progress }>(`/me/lessons/${id}/complete`, {});
      setProgress(r.data.progress);
      toast('success', r.message);
      onChanged();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const locked = q.error && refusalCode(q.error) === 'locked';
  // Offline and never opened here: the course's outline and the kept copy are enough to play it.
  const fallback = !data && q.error && unreachable(q.error) && card && kept ? card : null;
  const l = lesson ?? fallback;

  if (q.isLoading) return <Spinner label="Opening the lesson…" />;
  if (locked) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="flex items-center gap-2 text-ink">
          <Icon name="lock" size={18} />
          <b className="text-[15px]">{card?.title ?? 'This lesson'} is not open yet</b>
        </div>
        <Refusal text={errorText(q.error)} />
      </div>
    );
  }
  if (!l) return <div className="p-6"><ErrorNote error={q.error ?? new Error('This lesson could not be opened.')} onRetry={() => void q.refetch()} /></div>;

  const type = l.lesson_type;
  const file = lesson?.file ?? null;
  const localSrc = kept ? offlineLessonUrl(courseId, id) : null;
  const rule = l.completion_rule;
  const done = shown?.status === 'COMPLETED';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-3">
        <Icon name={LESSON_ICON[type] ?? 'file'} size={18} className="text-ink-3" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-[16px] font-bold text-ink">{l.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <span>Completes by: {l.rule_label}</span>
            {!l.is_mandatory ? <span>· Optional</span> : null}
            {kept ? <Pill tone="green">Kept offline</Pill> : null}
          </div>
        </div>
        {done ? (
          <Pill tone="green">Complete</Pill>
        ) : rule === 'MANUAL' ? (
          <Button variant="primary" icon="check" loading={busy} disabled={!el.online} title={el.online ? undefined : OFFLINE} onClick={() => void markDone()}>
            Mark complete
          </Button>
        ) : null}
        <Button size="sm" icon="chevron-left" disabled={!prev} onClick={() => prev && onGo(prev)} title="The lesson before (Alt+←)">
          Previous
        </Button>
        <Button size="sm" disabled={!next} onClick={() => next && onGo(next)} title="The lesson after (Alt+→)">
          Next <Icon name="chevron-right" size={14} />
        </Button>
      </header>
      {shown && shown.status !== 'NOT_STARTED' && !done && shown.percent > 0 ? (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-5 py-1.5 text-[12px] text-ink-3">
          <Bar value={shown.percent} label="Lesson progress" className="max-w-[240px] flex-1" />
          <span className="tabular-nums">{Math.round(shown.percent)}%</span>
        </div>
      ) : null}
      {note ? <div className="border-b border-line bg-warning-bg px-5 py-1.5 text-[12.5px] text-warning">{note}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {type === 'VIDEO' || type === 'AUDIO' ? (
          file && file.status !== 'ready' && !localSrc ? (
            <Unready file={file} />
          ) : (
            <Player key={id} audio={type === 'AUDIO'} src={localSrc ?? (file?.urls.source ? apiUrl(file.urls.source) : null)} poster={file?.urls.poster ? apiUrl(file.urls.poster) : undefined} tracks={localSrc ? [] : (file?.tracks ?? [])} resumeAt={Number(shown?.position) || 0} onBeat={beat} />
          )
        ) : type === 'ARTICLE' ? (
          <Article key={id} html={lesson?.body ?? null} onBeat={beat} />
        ) : type === 'PDF' || type === 'IMAGE' || type === 'OFFICE_DOC' || type === 'PRESENTATION' ? (
          file && file.status !== 'ready' && !localSrc ? (
            <Unready file={file} />
          ) : (
            <Document
              key={id}
              name={file?.name ?? kept?.file.name ?? l.title}
              path={file?.urls.view ?? file?.urls.source ?? ''}
              url={localSrc ?? undefined}
              countPages={type !== 'IMAGE'}
              onBeat={beat}
              onSave={file?.urls.download ? () => void saveLessonFile(file.urls.download!, file.name).then(() => toast('success', 'Saving a copy to your downloads — see Transfers.'), (e) => toast('error', errorText(e))) : undefined}
            />
          )
        ) : type === 'LINK' ? (
          <LinkLesson url={lesson?.url ?? null} manual={rule === 'MANUAL' && !done} />
        ) : type === 'QUIZ' ? (
          <div className="flex flex-col gap-3 p-6">
            <p className="m-0 text-[13.5px] text-ink-2">{lesson?.assessment ? `${lesson.assessment.questions} questions · pass mark ${lesson.assessment.pass_mark}%${lesson.assessment.time_limit_min ? ` · ${lesson.assessment.time_limit_min} minutes` : ''}` : 'A quiz.'}</p>
            {lesson?.assessment ? (
              <Button variant="primary" icon="list-todo" className="self-start" onClick={() => el.open.quiz(lesson.assessment!.id)}>
                Open the quiz
              </Button>
            ) : null}
          </div>
        ) : type === 'ASSIGNMENT' ? (
          <div className="flex flex-col gap-3 p-6">
            {lesson?.assignment?.due_at ? <p className="m-0 text-[13.5px] text-ink-2">Due {when(lesson.assignment.due_at, true)}</p> : null}
            {lesson?.assignment ? (
              <Button variant="primary" icon="upload" className="self-start" onClick={() => el.open.task(lesson.assignment!.id)}>
                Open the assignment
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="p-6 text-[13px] text-ink-3">This kind of lesson opens in a later version of eLearning.</p>
        )}
      </div>
      {file?.urls.download && (type === 'VIDEO' || type === 'AUDIO') ? (
        <footer className="flex items-center gap-2 border-t border-line bg-surface px-5 py-2">
          <span className="flex-1 text-[12px] text-ink-3">This lesson allows downloading.</span>
          <Button size="sm" icon="download" onClick={() => void saveLessonFile(file.urls.download!, file.name).then(() => toast('success', 'Saving a copy to your downloads — see Transfers.'), (e) => toast('error', errorText(e)))}>
            Save a copy
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function Unready({ file }: { file: { status: string; message?: string } }) {
  const text = file.message ?? (file.status === 'processing' ? 'This file is still being prepared. Try again in a few minutes.' : 'This file cannot be shown. Tell the course’s instructor.');
  return (
    <div className="p-6">
      <Refusal text={text} />
    </div>
  );
}

/**
 * The video or audio player (FR-VID-02): resumes where the learner left off,
 * speeds 0.5×–2×, captions, full screen and picture-in-picture (the
 * element's own controls). What is actually played is reported as ranges
 * every few seconds and whenever playback stops; a seek plays nothing.
 */
function Player({ src, poster, tracks, resumeAt, audio, onBeat }: { src: string | null; poster?: string; tracks: Array<{ id: number; label: string | null; lang: string | null; kind: string; is_default: boolean; url: string }>; resumeAt: number; audio: boolean; onBeat: (b: Beat) => Promise<void> }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const played = useRef(new PlayedRanges());
  // The playhead as last seen: the last beat, on leaving the lesson, is sent after the element has gone.
  const at = useRef(0);
  const [rate, setRate] = useState(1);
  const send = useCallback(() => {
    const ranges = played.current.take();
    if (ranges.length === 0) return;
    void onBeat({ ranges, position: Math.round(at.current * 10) / 10 });
  }, [onBeat]);

  useEffect(() => {
    const ranges = played.current;
    const t = setInterval(send, BEAT_MS);
    return () => {
      clearInterval(t);
      ranges.close();
      send();
    };
  }, [send]);

  if (!src) return <div className="p-6"><Refusal text="This recording has no version this computer can play yet. Try again later." /></div>;
  const common = {
    ref,
    src,
    controls: true,
    preload: 'metadata' as const,
    controlsList: 'nodownload',
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onLoadedMetadata: () => {
      const m = ref.current;
      if (m && resumeAt > 0 && resumeAt < (m.duration || Infinity) - 2) m.currentTime = resumeAt;
      if (m) m.playbackRate = rate;
    },
    onTimeUpdate: () => {
      const m = ref.current;
      if (!m) return;
      at.current = m.currentTime;
      if (!m.paused && !m.seeking) played.current.tick(m.currentTime, performance.now(), m.playbackRate);
    },
    onSeeking: () => played.current.close(),
    onPause: () => {
      played.current.close();
      send();
    },
    onEnded: () => {
      played.current.close();
      send();
    },
  };
  return (
    <div className="flex flex-col gap-2 p-5">
      {audio ? (
        <audio {...common} className="w-full" aria-label="Lesson audio" />
      ) : (
        <video {...common} poster={poster} className="max-h-[70vh] w-full rounded-[10px] bg-black" aria-label="Lesson video">
          {tracks.map((t) => (
            <track key={t.id} kind={t.kind === 'subtitles' ? 'subtitles' : 'captions'} src={apiUrl(t.url)} srcLang={t.lang ?? undefined} label={t.label ?? t.lang ?? 'Captions'} default={t.is_default} />
          ))}
        </video>
      )}
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <span>Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={rate === s}
            onClick={() => {
              setRate(s);
              if (ref.current) ref.current.playbackRate = s;
            }}
            className={cx('h-6 rounded-[6px] px-1.5 font-semibold tabular-nums', rate === s ? 'bg-selection text-primary' : 'hover:bg-subtle')}
          >
            {s}×
          </button>
        ))}
        <span className="flex-1" />
        <span>Only what you play counts — skipping ahead does not.</span>
      </div>
    </div>
  );
}

/** An article: read, and reported as read when its end has been reached (with the time spent, counted on the server). */
function Article({ html, onBeat }: { html: string | null; onBeat: (b: Beat) => Promise<void> }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  const position = () => {
    const b = box.current?.parentElement;
    if (!b) return '0';
    const max = b.scrollHeight - b.clientHeight;
    return String(max > 0 ? Math.round((b.scrollTop / max) * 100) : 100);
  };
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !reached.current) {
        reached.current = true;
        void onBeat({ scrolled_to_end: true, position: position() });
      }
    });
    io.observe(el);
    // Time with the article open counts (between beats, up to the server's idle gap); reaching the end is sent once and kept.
    const t = setInterval(() => void onBeat({ position: position() }), BEAT_MS);
    return () => {
      io.disconnect();
      clearInterval(t);
    };
  }, [onBeat]);
  return (
    <div ref={box} className="mx-auto max-w-[760px] px-6 py-6">
      {html ? <Rich html={html} /> : <p className="text-[13px] text-ink-3">This article is not available offline.</p>}
      <div ref={end} className="h-px" aria-hidden />
    </div>
  );
}

/** A document or picture, viewed in the app; each PDF page seen is reported. */
function Document({ name, path, url, countPages, onBeat, onSave }: { name: string; path: string; url?: string; countPages: boolean; onBeat: (b: Beat) => Promise<void>; onSave?: () => void }) {
  const seen = useRef(new Set<number>());
  const waiting = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    timer.current = null;
    const pages = waiting.current;
    waiting.current = [];
    if (pages.length) void onBeat({ pages, position: pages[pages.length - 1] });
  }, [onBeat]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
    },
    [flush],
  );
  const onPage = useCallback(
    (n: number) => {
      if (!countPages || seen.current.has(n)) return;
      seen.current.add(n);
      waiting.current.push(n);
      if (!timer.current) timer.current = setTimeout(flush, 2000);
    },
    [countPages, flush],
  );
  if (!path && !url) return <div className="p-6"><Refusal text="This file is not available." /></div>;
  return (
    <div className="h-full min-h-[480px]">
      <FileViewer path={path} url={url} name={name} onPage={onPage} onSave={onSave} />
    </div>
  );
}

function LinkLesson({ url, manual }: { url: string | null; manual: boolean }) {
  if (!url) return <p className="p-6 text-[13px] text-ink-3">The link is not available offline.</p>;
  return (
    <div className="flex flex-col gap-3 p-6">
      <p className="m-0 text-[13.5px] break-all text-ink-2">{url}</p>
      <Button variant="primary" icon="external" className="self-start" onClick={() => void call('app:openExternal', { url }).catch((e) => toast('error', errorText(e)))}>
        Open the link
      </Button>
      {manual ? <p className="m-0 text-[12.5px] text-ink-3">When you have been through it, press Mark complete.</p> : null}
    </div>
  );
}
