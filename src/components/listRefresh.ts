import { text } from '../core/i18n';
import { createStore } from '../core/store';
import { dateLabel, timeLabel } from '../core/time';

/**
 * Pull to refresh and the "↑ 3 new" pill for every list (worksuite-desktop#236): the logic, apart from React.
 *
 * One controller per list. It watches the list's scroller for an overscroll at the very top — an upward wheel or
 * trackpad gesture that began there (never the tail of a flick from further down), or a touch pulled down from
 * there — and checks once the gesture is released past the threshold. It tracks which rows are new since the last
 * render (unknown keys above the rows already known, or rows whose stamp moved on, such as a conversation with a new
 * message), keeps the rows in view where they were when rows are added above them, and says how many arrived while
 * the person was further down. `PullToRefresh.tsx` wires it to a list.
 */

/** How far (px) a pull goes before releasing checks. */
export const PULL_THRESHOLD = 64;
/** The pull shown never goes past this. */
export const PULL_MAX = PULL_THRESHOLD * 1.75;
/** A wheel gesture ends when no wheel event has come for this long (ms): that is its release. */
export const GESTURE_GAP_MS = 180;
/** Wheel and touch distance count for half: the list follows the finger with some resistance. */
export const PULL_DAMPING = 0.5;
/** After a check, rows arriving within this long (ms) still count to it. */
export const SETTLE_MS = 160;
/** "3 new" and "Up to date" stay this long (ms), then the indicator closes. */
export const RESULT_MS = 1500;
/** An error stays this long (ms) unless retried; the list stays usable meanwhile. */
export const ERROR_MS = 8000;
/** New rows are highlighted this long (ms). */
export const HIGHLIGHT_MS = 2200;
/** Within this many px of the top counts as at the top. */
export const TOP_SLOP = 2;

export type RefreshPhase = 'idle' | 'pulling' | 'armed' | 'checking' | 'new' | 'current' | 'error';

export interface RefreshItem {
  key: string;
  /** When the row last changed (a conversation's last message): a later stamp makes a known row new again. */
  stamp?: string | number | null;
}

export interface RefreshSnapshot {
  phase: RefreshPhase;
  /** How far the list is pulled now (px), while pulling. */
  pull: number;
  /** Rows the last check brought. */
  added: number;
  /** Why the last check failed, in words. */
  error: string | null;
  /** When a check from here last succeeded (ms). */
  checkedAt: number | null;
  /** New rows not seen yet, while the list is scrolled down: the pill's count. */
  unseen: number;
  atTop: boolean;
  /** Rows to highlight (and slide in) now. */
  fresh: ReadonlySet<string>;
}

export interface RefreshOptions {
  check: () => Promise<unknown> | unknown;
  /** The pull gesture is on (the setting). The pill, ⌘R/F5 and "Checked…" work either way. */
  pull: boolean;
  errorText: (e: unknown) => string;
}

const EMPTY: ReadonlySet<string> = new Set();

/** The scroller's own distance from the top, as a wheel or touch event finds it. */
function atTopOf(el: HTMLElement): boolean {
  return el.scrollTop <= TOP_SLOP;
}

/** A wheel delta in px, whatever unit the device reports it in. */
export function wheelPixels(deltaY: number, deltaMode: number, page = 600): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * page : deltaY;
}

/** New rows, given what was known: unknown keys above the first row still as it was, and known rows whose stamp moved on. */
export function newRows(items: readonly RefreshItem[], known: ReadonlyMap<string, string | number | null>): string[] {
  const out: string[] = [];
  let above = true;
  for (const it of items) {
    const had = known.has(it.key);
    const before = known.get(it.key);
    const moved = had && it.stamp != null && before != null && String(it.stamp) !== String(before) && (typeof it.stamp === 'number' && typeof before === 'number' ? it.stamp > before : String(it.stamp) > String(before));
    if (!had && above) out.push(it.key);
    else if (moved) out.push(it.key);
    // Rows added further down (the next page) are not new mail.
    if (had && !moved) above = false;
  }
  return out;
}

/** "Checked just now", "Checked 2 min ago", "Checked 3 h ago", or the date and time. */
export function checkedLabel(at: number | null, now: number): string {
  if (at === null) return text('Check now');
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return text('Checked just now');
  if (s < 3600) return text('Checked {n} min ago', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86_400) return text('Checked {n} h ago', { n: Math.floor(s / 3600) });
  const iso = new Date(at).toISOString();
  return text('Checked {when}', { when: `${dateLabel(iso)} ${timeLabel(iso)}` });
}

/** The rows' elements, by their `data-refresh-key`. */
function rowEls(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[data-refresh-key]')];
}

export class ListRefreshController {
  private snap: RefreshSnapshot = { phase: 'idle', pull: 0, added: 0, error: null, checkedAt: null, unseen: 0, atTop: true, fresh: EMPTY };
  private subs = new Set<() => void>();
  private opts: RefreshOptions = { check: () => undefined, pull: true, errorText: () => text('Couldn’t check · Retry') };
  private el: HTMLElement | null = null;
  // The wheel gesture: when its last event came, whether it began at the top going up and has stayed there.
  private lastWheel = -Infinity;
  private gestureOk = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  // The touch gesture.
  private touchY: number | null = null;
  private touchOk = false;
  // A check: only one at a time; rows that arrive from its start count to it.
  private checking = false;
  private startedAt = 0;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  // New rows.
  private known = new Map<string, string | number | null>();
  private view: string | null = null;
  private ready = false;
  private arrivals: Array<{ key: string; at: number }> = [];
  private unseen = new Set<string>();
  private highlight = new Map<string, number>();
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private anchor: { key: string; top: number } | null = null;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };

  readonly get = (): RefreshSnapshot => this.snap;

  configure(opts: RefreshOptions): void {
    this.opts = opts;
    if (!opts.pull && (this.snap.phase === 'pulling' || this.snap.phase === 'armed')) this.set({ phase: 'idle', pull: 0 });
  }

  private set(patch: Partial<RefreshSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.subs) fn();
  }

  // ---- the scroller ------------------------------------------------------------------------------------------

  /** Listen to a scroller; returns the way to stop. The listeners are passive: the native rubber band still runs. */
  attach(el: HTMLElement): () => void {
    this.el = el;
    const wheel = (e: WheelEvent) => this.wheel(wheelPixels(e.deltaY, e.deltaMode, el.clientHeight || 600), Math.abs(e.deltaX) > Math.abs(e.deltaY));
    const start = (e: TouchEvent) => this.touchStart(e.touches.length === 1 ? e.touches[0]!.clientY : null);
    const move = (e: TouchEvent) => this.touchMove(e.touches.length === 1 ? e.touches[0]!.clientY : null);
    const end = () => this.touchEnd();
    const scroll = () => this.scrolled();
    el.addEventListener('wheel', wheel, { passive: true });
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    el.addEventListener('scroll', scroll, { passive: true });
    this.remember();
    if (this.snap.atTop !== atTopOf(el)) this.set({ atTop: atTopOf(el) });
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('scroll', scroll);
      if (this.el === el) this.el = null;
    };
  }

  /** One wheel event: `dy` in px, negative going up. A sideways gesture is not a pull. */
  wheel(dy: number, sideways = false, now = Date.now()): void {
    const el = this.el;
    if (!el || !this.opts.pull || sideways) return;
    const top = atTopOf(el);
    if (now - this.lastWheel > GESTURE_GAP_MS) {
      // A new gesture: a pull only when it begins at the top, going up.
      this.gestureOk = top && dy < 0 && !this.checking;
    } else if (!top) this.gestureOk = false;
    this.lastWheel = now;
    if (!this.gestureOk) {
      if (this.snap.phase === 'pulling' || this.snap.phase === 'armed') this.set({ phase: 'idle', pull: 0 });
      return;
    }
    const pull = Math.max(0, Math.min(PULL_MAX, this.snap.pull + (dy < 0 ? -dy * PULL_DAMPING : -dy)));
    this.pullTo(pull);
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      this.lastWheel = -Infinity;
      this.release();
    }, GESTURE_GAP_MS);
  }

  touchStart(y: number | null): void {
    const el = this.el;
    this.touchY = y;
    this.touchOk = !!el && y !== null && this.opts.pull && atTopOf(el) && !this.checking;
  }

  touchMove(y: number | null): void {
    const el = this.el;
    if (!el || y === null || this.touchY === null || !this.touchOk) return;
    if (!atTopOf(el)) {
      this.touchOk = false;
      if (this.snap.phase === 'pulling' || this.snap.phase === 'armed') this.set({ phase: 'idle', pull: 0 });
      return;
    }
    this.pullTo(Math.max(0, Math.min(PULL_MAX, (y - this.touchY) * PULL_DAMPING)));
  }

  touchEnd(): void {
    if (!this.touchOk) return;
    this.touchOk = false;
    this.touchY = null;
    this.release();
  }

  private pullTo(pull: number): void {
    if (this.checking) return;
    const phase: RefreshPhase = pull >= PULL_THRESHOLD ? 'armed' : pull > 0 ? 'pulling' : this.snap.phase === 'pulling' || this.snap.phase === 'armed' ? 'idle' : this.snap.phase;
    if (phase !== this.snap.phase || pull !== this.snap.pull) this.set({ phase, pull, ...(phase === 'pulling' || phase === 'armed' ? { error: null } : {}) });
  }

  /** The gesture let go: past the threshold it checks, short of it the indicator closes. */
  private release(): void {
    if (this.snap.phase === 'armed') void this.checkNow();
    else if (this.snap.phase === 'pulling') this.set({ phase: 'idle', pull: 0 });
  }

  private scrolled(): void {
    const el = this.el;
    if (!el) return;
    const top = atTopOf(el);
    this.remember();
    // At the top, or with the new rows scrolled into view (half of one at least): seen.
    if (this.unseen.size) {
      if (top) this.unseen.clear();
      else {
        const box = el.getBoundingClientRect();
        for (const row of rowEls(el)) {
          const key = row.dataset.refreshKey;
          if (!key || !this.unseen.has(key)) continue;
          const r = row.getBoundingClientRect();
          const mid = (r.top + r.bottom) / 2;
          if (r.height > 0 && mid >= box.top && mid <= box.bottom) this.unseen.delete(key);
        }
      }
    }
    if (top !== this.snap.atTop || this.unseen.size !== this.snap.unseen) this.set({ atTop: top, unseen: this.unseen.size });
  }

  // ---- checking ----------------------------------------------------------------------------------------------

  /** Check now (a pull, ⌘R/F5, "Checked…", Retry). A second one while one runs does nothing. */
  async checkNow(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.startedAt = Date.now();
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.set({ phase: 'checking', pull: 0, error: null });
    try {
      await this.opts.check();
    } catch (e) {
      this.checking = false;
      this.set({ phase: 'error', error: this.opts.errorText(e) });
      this.phaseTimer = setTimeout(() => this.close('error'), ERROR_MS);
      return;
    }
    // The rows a check brings land a moment after it answers.
    await new Promise<void>((resolve) => {
      this.phaseTimer = setTimeout(resolve, SETTLE_MS);
    });
    const added = this.arrivals.filter((a) => a.at >= this.startedAt).length;
    this.checking = false;
    this.set({ phase: added ? 'new' : 'current', added, checkedAt: Date.now() });
    this.phaseTimer = setTimeout(() => this.close(added ? 'new' : 'current'), RESULT_MS);
  }

  private close(from: RefreshPhase): void {
    this.phaseTimer = null;
    if (this.snap.phase === from) this.set({ phase: 'idle', pull: 0 });
  }

  /** The error's close button. */
  dismiss(): void {
    if (this.snap.phase !== 'error') return;
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.close('error');
  }

  // ---- new rows ----------------------------------------------------------------------------------------------

  /**
   * The rows as they are after a render. `view` says which list they are (a folder, a filter): another list starts
   * over, with nothing new. Called from a layout effect, so the scroll position is corrected before it is painted.
   */
  sync(items: readonly RefreshItem[], view: string, ready: boolean): void {
    if (view !== this.view) {
      this.view = view;
      this.ready = false;
      this.known = new Map();
      this.arrivals = [];
      this.unseen.clear();
      this.highlight.clear();
      if (this.snap.unseen || this.snap.fresh.size) this.set({ unseen: 0, fresh: EMPTY });
    }
    if (!ready) return;
    if (!this.ready) {
      this.ready = true;
      this.known = new Map(items.map((i) => [i.key, i.stamp ?? null]));
      this.remember();
      return;
    }
    const fresh = newRows(items, this.known);
    // Every row seen in this list stays known: one back from an Undo, a search or a filter is not new.
    for (const i of items) this.known.set(i.key, i.stamp ?? null);
    if (!fresh.length) {
      this.remember();
      return;
    }
    const now = Date.now();
    for (const key of fresh) this.arrivals.push({ key, at: now });
    if (this.arrivals.length > 500) this.arrivals = this.arrivals.slice(-200);
    const el = this.el;
    const wasTop = this.snap.atTop || !el;
    if (el && !wasTop) this.restore();
    if (wasTop) this.light(fresh, now);
    else for (const key of fresh) this.unseen.add(key);
    this.remember();
    this.set({ unseen: this.unseen.size, atTop: el ? atTopOf(el) : true });
  }

  /** The pill: to the top, smoothly, and the rows that came meanwhile lit up. */
  showNew(smooth: boolean): void {
    const keys = [...this.unseen];
    this.unseen.clear();
    this.el?.scrollTo?.({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    this.light(keys, Date.now());
    this.set({ unseen: 0 });
  }

  private light(keys: string[], now: number): void {
    for (const k of keys) this.highlight.set(k, now + HIGHLIGHT_MS);
    this.publishLight(now);
  }

  private publishLight(now: number): void {
    for (const [k, until] of this.highlight) if (until <= now) this.highlight.delete(k);
    this.set({ fresh: this.highlight.size ? new Set(this.highlight.keys()) : EMPTY });
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    if (this.highlight.size) {
      const next = Math.min(...this.highlight.values());
      this.highlightTimer = setTimeout(() => this.publishLight(Date.now()), Math.max(16, next - now));
    }
  }

  /** The first row in view and how far it sits from the scroller's top: what stays put when rows come above it. */
  private remember(): void {
    const el = this.el;
    if (!el) return;
    const box = el.getBoundingClientRect();
    for (const row of rowEls(el)) {
      const r = row.getBoundingClientRect();
      if (r.bottom > box.top && row.dataset.refreshKey) {
        this.anchor = { key: row.dataset.refreshKey, top: r.top - box.top };
        return;
      }
    }
    this.anchor = null;
  }

  /** Rows came above the view: move by what they took, so what was being read stays where it was. */
  private restore(): void {
    const el = this.el;
    const a = this.anchor;
    if (!el || !a) return;
    const row = rowEls(el).find((r) => r.dataset.refreshKey === a.key);
    if (!row) return;
    const delta = row.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top;
    if (Math.abs(delta) >= 0.5) el.scrollTop += delta;
  }

  destroy(): void {
    for (const t of [this.releaseTimer, this.phaseTimer, this.highlightTimer]) if (t) clearTimeout(t);
    this.subs.clear();
    this.el = null;
  }
}

// ---- the setting --------------------------------------------------------------------------------------------

/**
 * Pull to refresh on or off, per list, on this computer (Settings › Mail › Appearance & reading › Pull to refresh).
 * On unless turned off. ⌘R/F5, "Checked…" and the pill are not affected.
 */
export type PullList = 'mail' | 'chat' | 'whatsapp' | 'website';
const PREF_KEY = 'ws.pullToRefresh';

function readPullPrefs(): Partial<Record<PullList, boolean>> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as unknown;
    return raw && typeof raw === 'object' ? (raw as Partial<Record<PullList, boolean>>) : {};
  } catch {
    return {};
  }
}

export const pullPrefs = createStore<{ off: Partial<Record<PullList, boolean>> }>({ off: invert(readPullPrefs()) });

function invert(on: Partial<Record<PullList, boolean>>): Partial<Record<PullList, boolean>> {
  const off: Partial<Record<PullList, boolean>> = {};
  for (const [k, v] of Object.entries(on)) if (v === false) off[k as PullList] = true;
  return off;
}

export function pullEnabled(list: PullList): boolean {
  return !pullPrefs.get().off[list];
}

export function setPullEnabled(list: PullList, on: boolean): void {
  const off = { ...pullPrefs.get().off };
  if (on) delete off[list];
  else off[list] = true;
  pullPrefs.set({ off });
  try {
    const stored: Partial<Record<PullList, boolean>> = {};
    for (const k of Object.keys(off)) stored[k as PullList] = false;
    localStorage.setItem(PREF_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked: the choice holds until the app restarts.
  }
}
