import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import type { CallPerson } from '../../calls/ui/people';
import { meet } from '../session';
import { remote } from './controller';
import { ANNOT_COLORS, colorFor, drawStroke, pictureRect, pointers, type AnnotKind, type AnnotStroke } from './pointers';

/**
 * Pointing at and drawing on somebody's shared screen (RC-PTR-01…03, RC08):
 * Pointer and Annotate beside the shared screen, the tool rail, and the
 * overlay that paints everybody's pointers and marks over the picture — on
 * this screen only; the sharer's computer is not changed. Off while this
 * person controls that screen: their mouse is the controller's then.
 */

const TOOLS: Array<{ id: AnnotKind; label: string; icon: string }> = [
  { id: 'pen', label: 'Pen', icon: 'pen' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow-draw' },
  { id: 'rect', label: 'Rectangle', icon: 'square' },
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'highlight', label: 'Highlight', icon: 'highlighter' },
];

export function PointerLayer({ sharer }: { sharer: CallPerson }) {
  useSyncExternalStore(pointers.subscribe, pointers.snapshot);
  useSyncExternalStore(remote.subscribe, remote.snapshot);
  const room = meet.room;
  const me = room?.localParticipant.identity ?? '';
  const share = remote.state?.shares.find((s) => s.identity === sharer.id) ?? null;
  const controlling = remote.session?.sharer.identity === sharer.id;
  const pointerOk = !!share?.availability.pointer;
  const annotateOk = !!share?.availability.annotate;
  const [mode, setMode] = useState<'off' | 'pointer' | 'annotate'>('off');
  const [tool, setTool] = useState<AnnotKind>('pen');
  const [color, setColor] = useState(() => colorFor(me));
  const marks = share ? pointers.of(share.id) : null;
  const annotOn = marks?.annotOn ?? true;

  // Not allowed any more, controlling now, or the sharer switched annotation off: the mode goes too.
  const effective = controlling || !share ? 'off' : mode === 'pointer' && !pointerOk ? 'off' : mode === 'annotate' && (!annotateOk || !annotOn) ? 'off' : mode;
  if (effective !== mode) setMode(effective);

  if (!share || !marks) return null;
  return (
    <>
      <Overlay shareId={share.id} me={me} mode={effective} tool={tool} color={color} annotOn={annotOn} strokes={marks.strokes} lasers={marks.lasers} />
      {!controlling && (pointerOk || annotateOk) ? (
        <div className="absolute top-3 right-3 z-[3] flex gap-1.5 text-[12.5px]">
          {pointerOk ? (
            <StageButton icon="pointer" pressed={effective === 'pointer'} onClick={() => setMode(effective === 'pointer' ? 'off' : 'pointer')} title="Point at the shared screen — everyone sees your name">
              {effective === 'pointer' ? 'Pointer on' : 'Pointer'}
            </StageButton>
          ) : null}
          {annotateOk ? (
            <StageButton icon="pen" pressed={effective === 'annotate'} disabled={!annotOn} onClick={() => setMode(effective === 'annotate' ? 'off' : 'annotate')} title={annotOn ? 'Draw over the shared screen — theirs is not changed' : `${sharer.name} turned annotations off`}>
              Annotate
            </StageButton>
          ) : null}
        </div>
      ) : null}
      {effective === 'annotate' ? (
        <div className="absolute top-1/2 left-3 z-[3] flex -translate-y-1/2 flex-col items-center gap-1 rounded-[14px] bg-[rgba(7,12,26,.88)] p-1.5 shadow-xl" role="toolbar" aria-label="Annotation tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              title={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              className={cx('no-drag rounded-[9px] p-1.5', tool === t.id ? 'bg-[#3B5BDB] text-white' : 'text-[#AFC0E8] hover:bg-white/10')}
            >
              <Icon name={t.icon} size={17} />
            </button>
          ))}
          <span className="my-1 h-px w-6 bg-white/15" />
          {ANNOT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={cx('no-drag my-0.5 h-4.5 w-4.5 rounded-full', color === c && 'ring-2 ring-white ring-offset-2 ring-offset-[#070C1A]')}
            />
          ))}
        </div>
      ) : null}
      {marks.strokes.some((s) => s.by === me) ? (
        <div className="absolute right-3 bottom-[88px] z-[3]">
          <StageButton icon="eraser" onClick={() => pointers.clearMine(room, share.id, me)}>
            Clear mine
          </StageButton>
        </div>
      ) : null}
    </>
  );
}

function StageButton({ icon, pressed, disabled, title, onClick, children }: { icon: string; pressed?: boolean; disabled?: boolean; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cx('no-drag flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 font-semibold shadow-lg disabled:opacity-40', pressed ? 'bg-[#3B5BDB] text-white' : 'bg-[rgba(11,18,38,.85)] text-[#E6ECFA] hover:bg-[rgba(22,37,79,.95)]')}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

function Overlay({ shareId, me, mode, tool, color, annotOn, strokes, lasers }: {
  shareId: number;
  me: string;
  mode: 'off' | 'pointer' | 'annotate';
  tool: AnnotKind;
  color: string;
  annotOn: boolean;
  strokes: AnnotStroke[];
  lasers: Record<string, { x: number; y: number; name: string }>;
}) {
  const room = meet.room;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<AnnotStroke | null>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [typing, setTyping] = useState<{ x: number; y: number; value: string } | null>(null);

  // Exactly over the picture, not the letterboxed box around it.
  useLayoutEffect(() => {
    const stage = box.current?.parentElement;
    if (!stage) return undefined;
    const measure = () => {
      const video = stage.querySelector('video');
      const r = stage.getBoundingClientRect();
      setRect(pictureRect({ width: r.width, height: r.height }, video?.videoWidth ?? 0, video?.videoHeight ?? 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    const video = stage.querySelector('video');
    video?.addEventListener('resize', measure);
    video?.addEventListener('loadedmetadata', measure);
    const t = window.setInterval(measure, 2_000);
    return () => {
      ro.disconnect();
      video?.removeEventListener('resize', measure);
      video?.removeEventListener('loadedmetadata', measure);
      window.clearInterval(t);
    };
  }, [shareId]);

  const repaint = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!annotOn) return;
    for (const s of strokes) drawStroke(ctx, s, c.width, c.height);
    if (drawing.current) drawStroke(ctx, drawing.current, c.width, c.height);
  }, [strokes, annotOn]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    repaint();
  }, [rect, repaint]);

  /** Where on the picture, 0–1; null for an event that says nowhere. */
  const pos = (e: React.PointerEvent): [number, number] | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return Number.isFinite(x) && Number.isFinite(y) ? [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] : null;
  };
  const place = () => {
    const t = typing;
    setTyping(null);
    const value = t?.value.trim().slice(0, 120);
    if (!t || !value) return;
    pointers.draw(room, shareId, { id: `${me}-${Date.now()}`, by: me, kind: 'text', text: value, color, width: 4, points: [[t.x, t.y]] });
  };

  return (
    <div ref={box} className="pointer-events-none absolute z-[2]" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} data-testid="pointer-layer">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {mode !== 'off' ? (
        <div
          className={cx('pointer-events-auto absolute inset-0 touch-none', mode === 'pointer' ? 'cursor-none' : 'cursor-crosshair')}
          aria-label={mode === 'pointer' ? 'Point at the shared screen' : 'Draw on the shared screen'}
          onPointerMove={(e) => {
            const p = pos(e);
            if (!p) return;
            const [x, y] = p;
            if (mode === 'pointer') {
              pointers.point(room, shareId, me, x, y, room?.localParticipant.name || 'Someone');
            } else if (drawing.current) {
              const d = drawing.current;
              if (d.kind === 'pen' || d.kind === 'highlight') {
                if (d.points.length < 2_000) d.points.push([x, y]);
              } else d.points = [d.points[0]!, [x, y]];
              repaint();
            }
          }}
          onPointerDown={(e) => {
            const p = mode === 'annotate' ? pos(e) : null;
            if (!p) return;
            if (tool === 'text') {
              setTyping({ x: p[0], y: p[1], value: '' });
              return;
            }
            e.currentTarget.setPointerCapture?.(e.pointerId);
            drawing.current = { id: `${me}-${Date.now()}`, by: me, kind: tool, color, width: 3, points: [p] };
            repaint();
          }}
          onPointerUp={() => {
            const s = drawing.current;
            drawing.current = null;
            if (s) pointers.draw(room, shareId, s);
          }}
          onPointerLeave={() => mode === 'pointer' && pointers.unpoint(shareId, me)}
        />
      ) : null}
      {typing ? (
        <input
          autoFocus
          aria-label="Text to place on the shared screen"
          maxLength={120}
          value={typing.value}
          onChange={(e) => setTyping({ ...typing, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') place();
            else if (e.key === 'Escape') setTyping(null);
          }}
          onBlur={place}
          placeholder="Type, then Enter"
          className="pointer-events-auto absolute h-7 w-56 rounded-[6px] border border-white/40 bg-[rgba(7,12,26,.9)] px-2 text-[12.5px] text-white outline-none"
          style={{ left: `${typing.x * 100}%`, top: `${typing.y * 100}%` }}
        />
      ) : null}
      {Object.entries(lasers).map(([id, l]) => (
        <span key={id} className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5" style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}>
          <span className="h-4 w-4 rounded-full ring-4 ring-white/30" style={{ background: colorFor(id) }} />
          <span className="rounded px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-white" style={{ background: colorFor(id) }}>
            {l.name}
          </span>
        </span>
      ))}
    </div>
  );
}
