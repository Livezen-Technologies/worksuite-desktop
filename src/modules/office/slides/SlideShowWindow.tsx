import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { Spinner, cx } from '../../../components/ui';
import { clampSlide, moveSlide, nextSlide, noteText, slideLabel } from './deck';
import { screenBox } from './fit';
import { showAction, type NavAction } from './keys';
import { channelName, parseShowMessage, type ShowMessage, type ShowRole } from './protocol';
import { openDeck, type Deck } from './render';
import { SlideCanvas } from './SlideCanvas';
import { useElementSize } from './SlidesViewer';
import { CONTROLS_HIDE_MS, controlsShown, formatClock, formatElapsed, timerElapsed, timerPause, timerReset, timerResume, timerStart, uses12Hour, type TimerState } from './timer';

/**
 * A slideshow's windows (worksuite-desktop#321), opened full screen by the main process:
 *  - the slideshow (`/window/slideshow`): the slide as big as the screen takes it at its aspect, black round it, no
 *    app chrome. Click, → or Space next; ← back; Esc ends. Moving the mouse shows a small control bar (back, next,
 *    the slide number, the laser pointer, end) that fades after two seconds.
 *  - the presenter view (`/window/presenter`), on the laptop when the slides are on a second screen: the current and
 *    the next slide, the speaker notes, a timer and the clock.
 * Both get the deck from the window the show was started from, over the show's BroadcastChannel, and keep each
 * other on the same slide.
 */
interface Show {
  deck: Deck | null;
  name: string;
  index: number;
  /** Past the last slide: "End of slide show". */
  ended: boolean;
  black: boolean;
  laser: { x: number; y: number } | null;
  problem: string | null;
  go: (action: NavAction | number) => void;
  setBlack: (on: boolean) => void;
  pointAt: (p: { x: number; y: number } | null) => void;
  end: () => void;
}

const DECK_WAIT_MS = 20_000;

function useShow(id: string, role: ShowRole): Show {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [name, setName] = useState('Presentation');
  const [index, setIndex] = useState(0);
  const [ended, setEnded] = useState(false);
  const [black, setBlackState] = useState(false);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const state = useRef({ index: 0, ended: false, count: 0 });
  const post = useCallback((m: ShowMessage) => channel.current?.postMessage(m), []);

  useEffect(() => {
    const ch = new BroadcastChannel(channelName(id));
    channel.current = ch;
    let opened: Deck | null = null;
    let asked = false;
    let gone = false;
    ch.onmessage = (e: MessageEvent) => {
      const m = parseShowMessage(e.data);
      if (!m) return;
      if (m.t === 'deck' && !asked) {
        asked = true;
        setName(m.name);
        void openDeck(m.bytes).then(
          (d) => {
            if (gone) return d.dispose();
            opened = d;
            const i = clampSlide(m.index, d.count);
            state.current = { index: i, ended: false, count: d.count };
            setIndex(i);
            setDeck(d);
          },
          () => !gone && setProblem('This presentation could not be read.'),
        );
      } else if (m.t === 'gone') setProblem('The presentation is no longer open.');
      else if (m.t === 'goto') {
        state.current.index = clampSlide(m.index, state.current.count);
        state.current.ended = false;
        setIndex(state.current.index);
        setEnded(false);
      } else if (m.t === 'black') setBlackState(m.on);
      else if (m.t === 'laser') setLaser({ x: m.x, y: m.y });
      else if (m.t === 'laserOff') setLaser(null);
      else if (m.t === 'end') void call('slides:close').catch(() => window.close());
    };
    ch.postMessage({ t: 'hello', role } satisfies ShowMessage);
    const wait = setTimeout(() => !asked && !gone && setProblem('The presentation could not be opened for the slideshow.'), DECK_WAIT_MS);
    return () => {
      gone = true;
      clearTimeout(wait);
      ch.close();
      channel.current = null;
      opened?.dispose();
    };
  }, [id, role]);

  const end = useCallback(() => {
    post({ t: 'end', index: state.current.index });
    void call('slides:close').catch(() => window.close());
  }, [post]);

  const go = useCallback(
    (action: NavAction | number) => {
      const s = state.current;
      if (!s.count) return;
      if (action === 'next' && s.index === s.count - 1) {
        // After the last slide, PowerPoint's "End of slide show": one more next ends it.
        if (s.ended) return end();
        s.ended = true;
        setEnded(true);
        return;
      }
      if (action === 'prev' && s.ended) {
        s.ended = false;
        setEnded(false);
        return;
      }
      const i = typeof action === 'number' ? clampSlide(action, s.count) : moveSlide(s.index, s.count, action);
      s.ended = false;
      setEnded(false);
      if (i === s.index) return;
      s.index = i;
      setIndex(i);
      post({ t: 'goto', index: i });
    },
    [end, post],
  );

  // A window closed by the system (unplugged, ⌘W) still tells the others where the show ended.
  useEffect(() => {
    const bye = () => post({ t: 'end', index: state.current.index });
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [post]);

  return {
    deck,
    name,
    index,
    ended,
    black,
    laser,
    problem,
    go,
    end,
    setBlack: (on) => {
      setBlackState(on);
      post({ t: 'black', on });
    },
    pointAt: (p) => {
      setLaser(p);
      post(p ? { t: 'laser', x: p.x, y: p.y } : { t: 'laserOff' });
    },
  };
}

function useShowKeys(show: Show): { laserOn: boolean; setLaserOn: (on: boolean) => void } {
  const [laserOn, setLaserOn] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = showAction(e);
      if (!a) return;
      e.preventDefault();
      if (a.type === 'exit') {
        if (show.black) show.setBlack(false);
        else show.end();
      } else if (a.type === 'laser') {
        setLaserOn((on) => {
          if (on) show.pointAt(null);
          return !on;
        });
      } else if (a.type === 'black') show.setBlack(!show.black);
      else show.go(a.type);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);
  return { laserOn, setLaserOn };
}

function Problem({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 bg-black p-8 text-center text-white">
      <Icon name="alert" size={30} />
      <p className="text-[15px]">{text}</p>
      <button type="button" onClick={onClose} className="h-9 rounded-[8px] border border-white/30 px-4 text-[13px] font-semibold hover:bg-white/10">
        Close (Esc)
      </button>
    </div>
  );
}

function EndCard() {
  return <div className="flex h-full w-full items-center justify-center bg-black text-[15px] text-white/70">End of slide show. Click to exit.</div>;
}

function LaserDot({ at }: { at: { x: number; y: number } }) {
  return <span aria-hidden className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red shadow-[0_0_12px_4px_rgba(255,42,42,.7)]" style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} />;
}

const fraction = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / Math.max(1, r.width);
  const y = (e.clientY - r.top) / Math.max(1, r.height);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
};

/** The slides, full screen. */
export function SlideShowWindow({ id }: { id: string }) {
  const show = useShow(id, 'show');
  const { laserOn, setLaserOn } = useShowKeys(show);
  const [root, screenSize] = useElementSize<HTMLDivElement>();
  const slideEl = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const [hovering, setHovering] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (moved === null) return;
    const t = setTimeout(() => setNow(Date.now()), CONTROLS_HIDE_MS + 20);
    return () => clearTimeout(t);
  }, [moved]);
  const controls = controlsShown(moved, Math.max(now, moved ?? 0), hovering);
  useEffect(() => {
    document.title = show.deck ? `${show.name} — Slideshow` : 'Slideshow';
  }, [show.deck, show.name]);

  if (show.problem) return <Problem text={show.problem} onClose={show.end} />;
  const deck = show.deck;
  const box = deck ? screenBox(screenSize, { width: deck.width, height: deck.height }) : null;
  return (
    <div
      ref={root}
      role="presentation"
      className={cx('relative h-full w-full overflow-hidden bg-black select-none', !controls && 'cursor-none', laserOn && 'cursor-none')}
      onMouseMove={(e) => {
        setMoved(Date.now());
        if (laserOn && slideEl.current) show.pointAt(fraction(e, slideEl.current));
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-show-controls]')) return;
        if (show.ended) show.end();
        else show.go('next');
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        show.go('prev');
      }}
    >
      {!deck ? <Spinner label="Opening the slideshow…" className="h-full text-white/70" /> : null}
      {deck && box && box.width > 0 && !show.ended ? (
        <div ref={slideEl} className="absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          <SlideCanvas deck={deck} index={show.index} width={box.width} label={`${slideLabel(show.index, deck.count)} — ${show.name}`} />
          {show.laser ? <LaserDot at={show.laser} /> : null}
        </div>
      ) : null}
      {show.ended ? <EndCard /> : null}
      {show.black ? <div aria-label="Black screen" className="absolute inset-0 bg-black" /> : null}
      {deck ? (
        <div
          data-show-controls
          role="toolbar"
          aria-label="Slideshow"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className={cx('absolute bottom-6 left-6 flex items-center gap-1 rounded-[12px] bg-black/70 p-1.5 text-white shadow-lg backdrop-blur transition-opacity duration-300', controls ? 'opacity-100' : 'pointer-events-none opacity-0')}
        >
          <ShowButton icon="chevron-left" label="Previous slide (←)" onClick={() => show.go('prev')} />
          <span className="min-w-[88px] px-1 text-center text-[12.5px] font-semibold tabular-nums">{show.ended ? 'End' : `${show.index + 1} / ${deck.count}`}</span>
          <ShowButton icon="chevron-right" label="Next slide (→)" onClick={() => show.go('next')} />
          <ShowButton
            icon="pointer"
            label={laserOn ? 'Laser pointer off (L)' : 'Laser pointer (L)'}
            pressed={laserOn}
            onClick={() => {
              if (laserOn) show.pointAt(null);
              setLaserOn(!laserOn);
            }}
          />
          <ShowButton icon="x" label="End the slideshow (Esc)" onClick={show.end} />
        </div>
      ) : null}
    </div>
  );
}

function ShowButton({ icon, label, onClick, pressed }: { icon: string; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} className={cx('flex h-9 w-9 items-center justify-center rounded-[8px] hover:bg-white/15', pressed && 'bg-red/80 hover:bg-red')}>
      <Icon name={icon} size={17} />
    </button>
  );
}

/** The presenter view, on the laptop's screen. */
export function PresenterWindow({ id }: { id: string }) {
  const show = useShow(id, 'presenter');
  const { laserOn, setLaserOn } = useShowKeys(show);
  const [timer, setTimer] = useState<TimerState>(() => timerStart(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [h12] = useState(uses12Hour);
  const [currentArea, currentSize] = useElementSize<HTMLDivElement>();
  const [nextArea, nextSize] = useElementSize<HTMLDivElement>();
  const slideEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    document.title = 'Presenter view';
  }, []);

  if (show.problem) return <Problem text={show.problem} onClose={show.end} />;
  const deck = show.deck;
  const slide = deck ? { width: deck.width, height: deck.height } : { width: 16, height: 9 };
  const cur = screenBox(currentSize, slide);
  const nxt = screenBox(nextSize, slide);
  const following = deck ? nextSlide(show.index, deck.count) : null;
  const running = timer.since !== null;
  const btn = 'flex h-9 items-center gap-1.5 rounded-[8px] border border-white/15 px-3 text-[13px] font-semibold hover:bg-white/10 disabled:opacity-40';

  return (
    <div className="flex h-full w-full flex-col bg-stage text-stage-ink select-none">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-5">
        <b className="min-w-0 flex-1 truncate text-[14px]">{show.name}</b>
        <div className="flex items-center gap-2" role="timer" aria-label="Time presenting">
          <Icon name="timer" size={16} className="text-white/60" />
          <span className="min-w-[64px] text-[22px] font-bold tabular-nums">{formatElapsed(timerElapsed(timer, now))}</span>
          <button type="button" aria-label={running ? 'Pause the timer' : 'Resume the timer'} title={running ? 'Pause' : 'Resume'} onClick={() => setTimer((t) => (running ? timerPause(t, Date.now()) : timerResume(t, Date.now())))} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10">
            <Icon name={running ? 'pause' : 'play'} size={15} />
          </button>
          <button type="button" aria-label="Reset the timer" title="Reset" onClick={() => setTimer(timerReset(Date.now(), running))} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10">
            <Icon name="refresh" size={15} />
          </button>
        </div>
        <span className="mx-2 h-6 w-px bg-white/15" />
        <div className="flex items-center gap-2" aria-label="Time now">
          <Icon name="clock" size={16} className="text-white/60" />
          <span className="text-[22px] font-bold tabular-nums">{formatClock(new Date(now), h12)}</span>
        </div>
        <button type="button" onClick={show.end} className="ml-3 h-9 rounded-[8px] bg-orange px-4 text-[13px] font-bold text-white hover:brightness-110">
          End show
        </button>
      </div>
      {!deck ? (
        <Spinner label="Opening the presenter view…" className="flex-1 text-white/70" />
      ) : (
        <div className="flex min-h-0 flex-1 gap-5 p-5">
          <div className="flex min-w-0 flex-[3] flex-col gap-2">
            <span className="text-[12px] font-semibold tracking-wide text-white/60 uppercase">{show.ended ? 'End of slide show' : `Current · ${slideLabel(show.index, deck.count)}`}</span>
            <div ref={currentArea} className="relative min-h-0 flex-1">
              {cur.width > 0 && !show.ended ? (
                <div
                  ref={slideEl}
                  className={cx('absolute', laserOn && 'cursor-none')}
                  style={{ left: cur.left, top: cur.top, width: cur.width, height: cur.height }}
                  onMouseMove={(e) => laserOn && slideEl.current && show.pointAt(fraction(e, slideEl.current))}
                  onMouseLeave={() => laserOn && show.pointAt(null)}
                >
                  <SlideCanvas deck={deck} index={show.index} width={cur.width} label={`Current slide, ${show.index + 1}`} />
                  {show.laser ? <LaserDot at={show.laser} /> : null}
                </div>
              ) : null}
              {show.black ? <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-[13px] text-white/70">The screen is black (B)</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={btn} disabled={show.index <= 0 && !show.ended} onClick={() => show.go('prev')}>
                <Icon name="chevron-left" size={15} /> Previous
              </button>
              <button type="button" className={btn} onClick={() => show.go('next')}>
                Next <Icon name="chevron-right" size={15} />
              </button>
              <button
                type="button"
                className={cx(btn, laserOn && 'border-red bg-red/20')}
                aria-pressed={laserOn}
                onClick={() => {
                  if (laserOn) show.pointAt(null);
                  setLaserOn(!laserOn);
                }}
              >
                <Icon name="pointer" size={15} /> Laser pointer
              </button>
              <button type="button" className={btn} aria-pressed={show.black} onClick={() => show.setBlack(!show.black)}>
                <Icon name="monitor" size={15} /> {show.black ? 'Show slides' : 'Black screen'}
              </button>
            </div>
          </div>
          <div className="flex min-w-0 flex-[2] flex-col gap-3">
            <span className="text-[12px] font-semibold tracking-wide text-white/60 uppercase">{following !== null ? `Next · Slide ${following + 1}` : 'Next'}</span>
            <div ref={nextArea} className="relative h-[34%] min-h-[120px] shrink-0">
              {following !== null && nxt.width > 0 ? (
                <div className="absolute" style={{ left: 0, top: nxt.top, width: nxt.width, height: nxt.height }}>
                  <SlideCanvas deck={deck} index={following} width={nxt.width} label={`Next slide, ${following + 1}`} />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[6px] border border-white/10 text-[13px] text-white/50">End of slide show</div>
              )}
            </div>
            <span className="text-[12px] font-semibold tracking-wide text-white/60 uppercase">Notes</span>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-[8px] bg-white/5 p-4 text-[17px] leading-[1.55] whitespace-pre-wrap scroll-thin">
              {noteText(deck.notes, show.index)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
