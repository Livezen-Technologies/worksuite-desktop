import { useRef, useState, type PointerEvent } from 'react';
import { btnSmall } from '../../hr/parts';

/**
 * The customer signs with the mouse, a pen or a touch screen (FR-CHK-06). What
 * is handed over is a PNG data URI of the strokes — well under the server's
 * 400 KB — which the server keeps encrypted and binds to the check-in as it
 * stands (its hash). Nothing is sent until the check-in is saved.
 */
export const PAD = { width: 480, height: 150 };

export function SignaturePad({ onChange, disabled }: { onChange: (png: string | null) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / (r.width || PAD.width)) * PAD.width, y: ((e.clientY - r.top) / (r.height || PAD.height)) * PAD.height };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    canvas.current!.setPointerCapture?.(e.pointerId);
    const p = point(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F1B3D';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const moveTo = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    onChange(canvas.current?.toDataURL('image/png') ?? null);
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, PAD.width, PAD.height);
    setSigned(false);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvas}
        width={PAD.width}
        height={PAD.height}
        aria-label="Signature: sign here with the mouse, a pen or a finger"
        role="img"
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
        onPointerLeave={up}
        className="h-[150px] w-full max-w-[480px] touch-none rounded-[10px] border border-dashed border-line bg-white"
      />
      <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <span className="flex-1">{signed ? 'Signed. It is kept when the check-in is saved.' : 'Sign inside the box.'}</span>
        <button type="button" className={btnSmall} disabled={disabled || !signed} onClick={clear}>
          Clear
        </button>
      </span>
    </div>
  );
}
