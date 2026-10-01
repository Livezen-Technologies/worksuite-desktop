import { useEffect, useLayoutEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Button } from '../../../components/ui';
import { createStore } from '../../../core/store';
import { useStore } from '../../../core/store';
import { navigate } from '../../../core/tabs';
import type { Guide } from './guides';

/**
 * Show me (worksuite-desktop#54): a guide walked through on the real screen. It opens the screen, then puts a ring
 * around each step's control with the step beside it — Back, Next, Done, Esc. It only looks: it never clicks, types
 * or saves anything, so following it changes no data. A control that is not on screen (another tab, a dialog not
 * opened yet, no permission to see it) is said, and the step is shown on its own.
 */
const tour = createStore<{ guide: Guide | null; step: number }>({ guide: null, step: 0 });

export function startShowMe(guide: Guide): void {
  navigate(guide.route);
  tour.set({ guide, step: 0 });
}

export function stopShowMe(): void {
  tour.set({ guide: null, step: 0 });
}

/** The control a step points at, when it is on screen and visible. */
function targetOf(id: string | undefined): HTMLElement | null {
  if (!id) return null;
  // Guide ids are the app's own (`sales.new-order`): nothing to escape.
  if (!/^[a-z0-9.-]+$/.test(id)) return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-guide="${id}"]`));
  return all.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

export function ShowMeHost() {
  const { guide, step } = useStore(tour, (s) => s);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = guide?.steps[step];

  // Each step's own screen first; then the control, looked for again as the screen settles.
  useEffect(() => {
    if (s?.route) navigate(s.route);
  }, [s?.route]);
  useLayoutEffect(() => {
    if (!guide) return;
    let alive = true;
    const find = () => {
      if (!alive) return;
      const el = targetOf(s?.target);
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'center' });
      setRect(el ? el.getBoundingClientRect() : null);
    };
    find();
    const t = setInterval(find, 300);
    window.addEventListener('resize', find);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('resize', find);
    };
  }, [guide, s?.target]);
  useEffect(() => {
    if (!guide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopShowMe();
      else if (e.key === 'ArrowRight') tour.set((x) => ({ step: Math.min(x.step + 1, (x.guide?.steps.length ?? 1) - 1) }));
      else if (e.key === 'ArrowLeft') tour.set((x) => ({ step: Math.max(0, x.step - 1) }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guide]);

  if (!guide || !s) return null;
  const last = step === guide.steps.length - 1;
  const pad = 6;
  // The card sits below the control when there is room, above it otherwise; centred when there is no control.
  const below = rect ? rect.bottom + 200 < window.innerHeight : true;
  const cardStyle = rect
    ? { left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)), top: below ? rect.bottom + pad + 10 : undefined, bottom: below ? undefined : window.innerHeight - rect.top + pad + 10 }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="show-me">
      {rect ? (
        <div
          aria-hidden
          className="absolute rounded-[10px] ring-[3px] ring-primary transition-all duration-200"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgb(11 16 32 / 0.35)' }}
        />
      ) : null}
      <div role="dialog" aria-label={`Show me: ${guide.title}`} className="pointer-events-auto absolute w-[360px] rounded-[14px] border border-line bg-surface p-4 shadow-2xl" style={cardStyle}>
        <div className="mb-1 flex items-center gap-2 text-[11.5px] font-bold tracking-[0.4px] text-ink-3 uppercase">
          <Icon name="sparkles" size={13} className="text-primary" /> Show me · {step + 1} of {guide.steps.length}
          <span className="flex-1" />
          <button type="button" aria-label="Close" onClick={stopShowMe} className="rounded p-0.5 text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        </div>
        <p className="text-[13.5px] leading-[1.5] text-ink" aria-live="polite">{s.text}</p>
        {s.target && !rect ? <p className="mt-1.5 text-[12px] text-ink-3">This control is not on screen right now — it may be in a dialog that opens from the step before, or need a permission you do not have.</p> : null}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11.5px] text-ink-3">Nothing is changed by following along.</span>
          <span className="flex-1" />
          <Button size="sm" disabled={step === 0} onClick={() => tour.set({ step: step - 1 })}>
            Back
          </Button>
          <Button size="sm" variant="primary" onClick={() => (last ? stopShowMe() : tour.set({ step: step + 1 }))}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
