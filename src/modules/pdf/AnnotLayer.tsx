import { useEffect, useRef, useState } from 'react';
import { MARKUP_KINDS, type PdfAnnotView, type PdfNewAnnot, type PdfRect } from '@shared/pdf';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { css, pdfEdit, styleFor, type AnnotStyle, type AnnotTool } from './edit';

/**
 * One page's annotation layer (stage D2), over the page as the canvas draws
 * it: the annotations there (to select, move, delete), and the tool being
 * used — a drag across text for markup, a box, a line, a freehand drawing,
 * a click for a note or a stamp. Everything is in points from the displayed
 * page's top-left corner, as the engine takes it; `k` is CSS pixels per
 * point at this zoom.
 */
export interface AnnotLayerProps {
  session: string;
  page: number;
  k: number;
  revision: number;
  tool: AnnotTool | null;
  style: AnnotStyle;
  /** Annotating is possible now (the mode and the server allow it). */
  editable: boolean;
  selected: string | null;
  onSelect: (id: string | null, page: number) => void;
  onAnnotations?: (page: number, list: PdfAnnotView[]) => void;
}

type Draft =
  | { kind: 'box'; from: [number, number]; to: [number, number] }
  | { kind: 'ink'; points: Array<[number, number]> }
  | { kind: 'move'; id: string; from: [number, number]; to: [number, number]; rect: PdfRect };

const MOVABLE = new Set(['note', 'square', 'circle', 'text', 'stamp']);
const MIN_BOX = 4;

function norm(a: [number, number], b: [number, number]): PdfRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
}

export function AnnotLayer({ session, page, k, revision, tool, style, editable, selected, onSelect, onAnnotations }: AnnotLayerProps) {
  const [list, setList] = useState<PdfAnnotView[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ask, setAsk] = useState<{ kind: 'note' | 'text'; rect: PdfRect } | null>(null);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const report = useRef(onAnnotations);
  useEffect(() => {
    report.current = onAnnotations;
  });

  // This page's annotations, read again after every change.
  useEffect(() => {
    let live = true;
    pdfEdit.annotations(session, page).then(
      (got) => {
        if (!live) return;
        const l = Array.isArray(got) ? got : [];
        setList(l);
        report.current?.(page, l);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [session, page, revision]);

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  };

  const add = async (annot: Omit<PdfNewAnnot, 'id'>) => {
    try {
      await pdfEdit.add(session, page, annot);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const finish = async (d: Draft) => {
    if (!tool && d.kind !== 'move') return;
    const s = tool ? styleFor(tool, style) : null;
    if (d.kind === 'move') {
      const dx = d.to[0] - d.from[0];
      const dy = d.to[1] - d.from[1];
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      try {
        await pdfEdit.apply(session, { op: 'annot.update', page, id: d.id, rect: [d.rect[0] + dx, d.rect[1] + dy, d.rect[2], d.rect[3]] });
      } catch (e) {
        toast('error', errorMessage(e));
      }
      return;
    }
    if (!tool || !s) return;
    if (d.kind === 'ink') {
      if (d.points.length < 2) return;
      return add({ kind: 'ink', ...s, strokes: [d.points.slice(0, 4000)] });
    }
    const rect = norm(d.from, d.to);
    if (MARKUP_KINDS.includes(tool)) {
      const span = await pdfEdit.textSpan(session, page, d.from, d.to).catch(() => null);
      if (!span?.rects.length) {
        toast('info', 'Drag across the text you want to mark.');
        return;
      }
      return add({ kind: tool, ...s, rects: span.rects });
    }
    if (tool === 'line') {
      if (Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) < MIN_BOX) return;
      return add({ kind: 'line', ...s, strokes: [[d.from, d.to]] });
    }
    if (tool === 'note') return setAsk({ kind: 'note', rect: [d.to[0], d.to[1], 24, 24] });
    if (tool === 'stamp') return add({ kind: 'stamp', ...s, rect: [d.to[0] - 80, d.to[1] - 20, 160, 40], text: style.stamp, fontSize: 18 });
    if (rect[2] < MIN_BOX || rect[3] < MIN_BOX) return;
    if (tool === 'text') return setAsk({ kind: 'text', rect });
    return add({ kind: tool, ...s, rect });
  };

  const drawing = editable && !!tool;
  const preview = (() => {
    if (!draft || draft.kind === 'move' || !tool) return null;
    const c = css(style.color, tool === 'highlight' ? 0.35 : 0.9);
    if (draft.kind === 'ink') return <polyline points={draft.points.map((p) => `${p[0] * k},${p[1] * k}`).join(' ')} fill="none" stroke={c} strokeWidth={Math.max(1, style.width * k)} strokeLinecap="round" strokeLinejoin="round" />;
    const [x, y, w, h] = norm(draft.from, draft.to);
    if (tool === 'line') return <line x1={draft.from[0] * k} y1={draft.from[1] * k} x2={draft.to[0] * k} y2={draft.to[1] * k} stroke={c} strokeWidth={Math.max(1, style.width * k)} />;
    if (tool === 'circle') return <ellipse cx={(x + w / 2) * k} cy={(y + h / 2) * k} rx={(w / 2) * k} ry={(h / 2) * k} fill="none" stroke={c} strokeWidth={Math.max(1, style.width * k)} />;
    if (MARKUP_KINDS.includes(tool)) return <rect x={x * k} y={y * k} width={w * k} height={h * k} fill={css(style.color, 0.18)} stroke={c} strokeDasharray="4 3" />;
    return <rect x={x * k} y={y * k} width={w * k} height={h * k} fill="none" stroke={c} strokeWidth={Math.max(1, style.width * k)} />;
  })();

  return (
    <div
      ref={box}
      data-annot-layer={page}
      className={cx('absolute inset-0', drawing ? (tool === 'ink' ? 'cursor-crosshair' : 'cursor-crosshair') : 'pointer-events-none')}
      onPointerDown={(e) => {
        if (!drawing || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const p = at(e);
        onSelect(null, page);
        setDraft(tool === 'ink' ? { kind: 'ink', points: [p] } : { kind: 'box', from: p, to: p });
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const p = at(e);
        setDraft(draft.kind === 'ink' ? { ...draft, points: [...draft.points, p] } : { ...draft, to: p });
      }}
      onPointerUp={() => {
        const d = draft;
        setDraft(null);
        if (d) void finish(d);
      }}
    >
      {/* The annotations on this page: selectable when annotating, their comment as a tooltip always. */}
      {list.map((a) => {
        const moving = draft?.kind === 'move' && draft.id === a.id ? draft : null;
        const r: PdfRect = moving ? [a.rect[0] + moving.to[0] - moving.from[0], a.rect[1] + moving.to[1] - moving.from[1], a.rect[2], a.rect[3]] : a.rect;
        const isSel = selected === a.id;
        return (
          <button
            key={a.id}
            type="button"
            data-annot={a.id}
            aria-label={`${a.kind === 'other' ? 'Annotation' : a.kind[0]!.toUpperCase() + a.kind.slice(1)}${a.text ? `: ${a.text.slice(0, 80)}` : ''}${a.author ? ` — ${a.author}` : ''}`}
            title={[a.text, a.author].filter(Boolean).join('\n— ') || undefined}
            className={cx('absolute rounded-[2px]', editable && !drawing ? 'pointer-events-auto cursor-pointer hover:outline hover:outline-1 hover:outline-primary' : 'pointer-events-none', isSel && 'outline-2 outline-offset-1 outline-primary', editable && isSel && MOVABLE.has(a.kind) && 'cursor-move')}
            style={{ left: r[0] * k, top: r[1] * k, width: Math.max(6, r[2] * k), height: Math.max(6, r[3] * k) }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(a.id, page);
            }}
            onPointerDown={(e) => {
              if (!editable || drawing || !isSel || !MOVABLE.has(a.kind) || !a.editable) return;
              e.stopPropagation();
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              const p = at(e);
              setDraft({ kind: 'move', id: a.id, from: p, to: p, rect: a.rect });
            }}
            onPointerMove={(e) => {
              if (draft?.kind === 'move' && draft.id === a.id) setDraft({ ...draft, to: at(e) });
            }}
            onPointerUp={(e) => {
              if (draft?.kind !== 'move') return;
              e.stopPropagation();
              const d = draft;
              setDraft(null);
              void finish(d);
            }}
          />
        );
      })}
      {preview ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {preview}
        </svg>
      ) : null}
      {ask ? (
        <div className="pointer-events-auto absolute z-10 w-[260px] rounded-[10px] border border-line bg-surface p-2 shadow-xl" style={{ left: Math.max(4, ask.rect[0] * k), top: (ask.rect[1] + ask.rect[3]) * k + 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            aria-label={ask.kind === 'note' ? 'Note' : 'Text'}
            value={text}
            maxLength={10_000}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            placeholder={ask.kind === 'note' ? 'Write a note…' : 'Type the text…'}
            className="w-full resize-none rounded-[6px] border border-line bg-surface p-1.5 text-[13px] text-ink outline-none focus:border-primary"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" onClick={() => (setAsk(null), setText(''))}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!text.trim()}
              onClick={() => {
                const s = styleFor(ask.kind, style);
                void add(ask.kind === 'note' ? { kind: 'note', ...s, rect: ask.rect, text: text.trim() } : { kind: 'text', ...s, rect: ask.rect, text: text.trim(), fontSize: style.fontSize });
                setAsk(null);
                setText('');
              }}
            >
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
