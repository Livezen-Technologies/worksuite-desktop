import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { callUi } from '../calls/ui/state';
import { useMeetT } from './i18n';
import { meet, type Stroke } from './session';

const COLORS = ['#151A2D', '#23349E', '#B42318', '#1F7A4D', '#B45309'];

/**
 * The shared board: strokes drawn here reach everyone in the meeting at
 * once. It lives in the panel, or on the main stage (`stage`), where it can
 * go full screen with the rest of the meeting; the people stay in the
 * corner. Strokes are kept as fractions of the board, so they land in the
 * same place at any size, and the board redraws whenever it is resized.
 *
 * With drawing turned off for participants (worksuite-desktop#91) they see
 * the board and why they cannot draw on it; the tools are gone.
 */
export function Whiteboard({ stage }: { stage?: boolean }) {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const t = useMeetT();
  const canDraw = meet.mayDraw;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[1]!);
  const [eraser, setEraser] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const drawing = useRef<Stroke | null>(null);
  const strokes = meet.strokes;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setBox({ width: Math.round(e.contentRect.width), height: Math.round(e.contentRect.height) });
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !box.width || !box.height) return;
    const { width, height } = box;
    c.width = Math.round(width * devicePixelRatio);
    c.height = Math.round(height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)));
      ctx.stroke();
    }
  }, [strokes, box]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const line = (from: [number, number], to: [number, number], s: Stroke) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(from[0] * box.width, from[1] * box.height);
    ctx.lineTo(to[0] * box.width, to[1] * box.height);
    ctx.stroke();
  };
  const tool = (on: boolean) => cx('flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold', on ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle');

  const toolbar = (
    <div className={cx('flex flex-wrap items-center gap-1.5', stage && 'rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,.25)]')}>
      {canDraw ? (
        <>
          <button type="button" aria-pressed={!eraser} onClick={() => setEraser(false)} className={tool(!eraser)}>
            <Icon name="compose" size={14} />
            Pen
          </button>
          <button type="button" aria-pressed={eraser} onClick={() => setEraser(true)} className={tool(eraser)}>
            <Icon name="eraser" size={14} />
            Eraser
          </button>
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c && !eraser} onClick={() => (setColor(c), setEraser(false))} className={cx('h-6 w-6 rounded-full border-2 ring-1 ring-line', color === c && !eraser ? 'border-primary' : 'border-transparent')} style={{ background: c }} />
          ))}
        </>
      ) : (
        <span role="status" className="text-[12px] text-ink-2">
          {t('hc.off.whiteboard')}
        </span>
      )}
      <span className={stage ? 'mx-1 h-6 w-px bg-line' : 'flex-1'} />
      {canDraw ? (
        <button type="button" onClick={() => meet.draw(null)} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12px] font-semibold text-ink hover:bg-subtle">
          Clear board
        </button>
      ) : null}
      {stage ? (
        <button type="button" onClick={() => callUi.set({ boardOnStage: false, panelOpen: true, panelTab: 'Board' })} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12px] font-semibold text-ink hover:bg-subtle">
          <Icon name="panel-close" size={14} />
          Back to the panel
        </button>
      ) : (
        <button type="button" onClick={() => callUi.set({ boardOnStage: true, panelOpen: false })} title="Put the board on the main stage — then Full screen makes it fill the screen" className="flex h-8 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover">
          <Icon name="fullscreen" size={14} />
          On stage
        </button>
      )}
    </div>
  );

  return (
    <div className={cx('flex h-full flex-col gap-2', stage ? 'relative bg-[#E9ECF4] p-3 pb-[88px]' : 'p-3')}>
      {stage ? <div className="absolute top-5 left-5 z-[15]">{toolbar}</div> : null}
      <canvas
        ref={canvas}
        aria-label="Whiteboard"
        className={cx('min-h-0 w-full flex-1 touch-none bg-white', stage ? 'rounded-[12px] shadow-[0_4px_20px_rgba(15,27,61,.15)]' : 'rounded-[10px] border border-line')}
        style={{ cursor: !canDraw ? 'default' : eraser ? 'cell' : 'crosshair' }}
        onPointerDown={(e) => {
          if (!canDraw) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = { color: eraser ? '#FFFFFF' : color, width: eraser ? (stage ? 28 : 18) : 3, points: [at(e)] };
        }}
        onPointerMove={(e) => {
          const s = drawing.current;
          if (!s) return;
          const p = at(e);
          line(s.points[s.points.length - 1]!, p, s);
          s.points.push(p);
        }}
        onPointerUp={() => {
          const s = drawing.current;
          drawing.current = null;
          if (s && s.points.length > 1) meet.draw(s);
        }}
      />
      {!stage ? toolbar : null}
    </div>
  );
}
