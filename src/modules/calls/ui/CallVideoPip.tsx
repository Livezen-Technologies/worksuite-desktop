import { useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { CallAvatar, VideoView } from '../parts';
import { nearestCorner, pipRect } from './layout';
import type { CallPerson } from './people';
import { callUi } from './state';

/**
 * CallVideoPip: a person's camera over the stage while something else is the
 * main view (a shared screen, the whiteboard) or while one other person
 * fills it. Drag it anywhere; let go and it settles in the nearest corner.
 * Pull the handle on its inner corner to resize. It keeps clear of the
 * controls at the bottom. Hide it, and a small chip brings it back.
 */
export function CallVideoPip({ person, self, stage, inset }: { person: CallPerson | null; self: CallPerson | null; stage: { width: number; height: number }; inset: number }) {
  const ui = useSyncExternalStore(callUi.subscribe, callUi.get);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number; w: number } | null>(null);

  if (!person) return null;
  const rect = pipRect(stage, ui.pipCorner, live ?? ui.pipWidth, inset);

  if (!ui.pipEnabled) {
    return (
      <button type="button" onClick={() => callUi.set({ pipEnabled: true })} className="no-drag absolute top-3 right-3 z-[20] flex h-8 items-center gap-1.5 rounded-full bg-[rgba(11,18,38,.8)] px-3 text-[12px] font-semibold text-stage-ink hover:bg-[rgba(11,18,38,.95)]">
        <Icon name="pip" size={14} />
        Show {person.self ? 'your video' : person.name}
      </button>
    );
  }

  const left = ui.pipCorner === 'tl' || ui.pipCorner === 'bl';
  const upper = ui.pipCorner === 'tl' || ui.pipCorner === 'tr';
  const x = drag?.x ?? rect.x;
  const y = drag?.y ?? rect.y;
  const showSelf = self && ui.selfView && self.camera && self.id !== person.id;

  return (
    <div
      role="group"
      aria-label={`${person.name}'s video — drag to move`}
      className={cx('no-drag group absolute z-[20] touch-none overflow-hidden rounded-[12px] border border-white/15 bg-navy-3 shadow-[0_10px_30px_rgba(0,0,0,.45)]', drag ? 'cursor-grabbing' : 'cursor-grab transition-[left,top] duration-200', person.speaking && 'ring-2 ring-stage-green-bright')}
      style={{ left: x, top: y, width: rect.width, height: rect.height }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y, w: rect.width };
        setDrag({ x: rect.x, y: rect.y });
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || !drag) return;
        setDrag({
          x: Math.max(0, Math.min(stage.width - rect.width, s.x + e.clientX - s.px)),
          y: Math.max(0, Math.min(stage.height - rect.height, s.y + e.clientY - s.py)),
        });
      }}
      onPointerUp={() => {
        if (drag) callUi.set({ pipCorner: nearestCorner(stage, drag.x + rect.width / 2, drag.y + rect.height / 2) });
        start.current = null;
        setDrag(null);
      }}
    >
      {person.camera ? (
        <VideoView track={person.camera} mirror={person.self && ui.mirror} className={cx('h-full w-full', ui.fit === 'fit' ? 'object-contain' : 'object-cover')} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <CallAvatar name={person.self ? 'You' : person.name} size={Math.round(rect.height * 0.42)} glow={person.speaking ? 'speaking' : null} />
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded-[6px] bg-[rgba(11,18,38,.72)] px-1.5 py-0.5 text-[11.5px] font-semibold text-white">
        {person.name}
        {!person.micOn ? ' · muted' : ''}
      </span>
      {showSelf ? (
        <div className="absolute right-1.5 bottom-1.5 h-[27%] w-[27%] overflow-hidden rounded-[7px] border border-white/30">
          <VideoView track={self.camera!} mirror={ui.mirror} className="h-full w-full object-cover" />
        </div>
      ) : null}
      <button type="button" aria-label="Hide this video" title="Hide" onClick={() => callUi.set({ pipEnabled: false })} className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(11,18,38,.7)] text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
        <Icon name="x" size={14} />
      </button>
      {/* The resize handle sits on the corner that faces the middle of the stage. */}
      <span
        aria-hidden
        className={cx('absolute h-4 w-4 opacity-0 group-hover:opacity-100', upper ? 'bottom-0' : 'top-0', left ? 'right-0 cursor-nwse-resize' : 'left-0 cursor-nesw-resize', upper === left ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,.6) 50%)', transform: left ? (upper ? 'none' : 'scaleY(-1)') : upper ? 'scaleX(-1)' : 'scale(-1)' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y, w: rect.width };
          setLive(rect.width);
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || live === null) return;
          const dx = (e.clientX - s.px) * (left ? 1 : -1);
          setLive(s.w + dx);
        }}
        onPointerUp={() => {
          if (live !== null) callUi.set({ pipWidth: live });
          start.current = null;
          setLive(null);
        }}
      />
    </div>
  );
}
