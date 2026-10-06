import { createStore, useStore } from '../../../core/store';
import { INITIAL, phaseLabel, phone, type Command, type CommandResult, type PhoneState } from './engine';

/**
 * The phone as any window sees it. The main window holds the engine (engine.ts); the compact phone window (D01) and
 * any other window read a mirror of its state and send it commands over `BroadcastChannel('ws-phone')`, which only
 * windows of this app (the same origin, app://bundle) can join. Audio stays in the main window.
 */

const CHANNEL = 'ws-phone';

type Message =
  | { type: 'hello' }
  | { type: 'state'; state: PhoneState }
  | { type: 'cmd'; id: number; command: Command }
  | { type: 'result'; id: number; result: CommandResult };

/** Is this the window that holds the phone? Every window but a secondary one (`#/window/…`). */
export function isHostWindow(hash: string = typeof window !== 'undefined' ? window.location.hash : ''): boolean {
  return !hash.startsWith('#/window/');
}

const host = isHostWindow();
const mirror = createStore<PhoneState>({ ...INITIAL, phase: 'idle' });

let channel: BroadcastChannel | null = null;
let nextId = 1;
const waiting = new Map<number, (r: CommandResult) => void>();

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL);
  return channel;
}

/**
 * In the main window: publish the engine's state to the other windows and run what they ask. Returns the stop.
 * State is sent at most once a frame — a call's quality and timer change often.
 */
export function serveRemote(): () => void {
  const ch = open();
  if (!ch) return () => undefined;
  let queued = false;
  const publish = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      ch.postMessage({ type: 'state', state: phone.state } satisfies Message);
    }, 50);
  };
  const off = phone.store.subscribe(publish);
  const onMessage = (e: MessageEvent<Message>) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello') publish();
    if (m.type === 'cmd' && typeof m.id === 'number' && m.command && typeof m.command === 'object') {
      void phone.run(m.command).then(
        (result) => ch.postMessage({ type: 'result', id: m.id, result } satisfies Message),
        (err: unknown) => ch.postMessage({ type: 'result', id: m.id, result: { ok: false, message: err instanceof Error ? err.message : 'The phone could not do that.' } } satisfies Message),
      );
    }
  };
  ch.addEventListener('message', onMessage);
  publish();
  return () => {
    off();
    ch.removeEventListener('message', onMessage);
  };
}

/** In a secondary window: follow the main window's phone. Returns the stop. */
export function followRemote(): () => void {
  const ch = open();
  if (!ch) return () => undefined;
  const onMessage = (e: MessageEvent<Message>) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state' && m.state) mirror.set(m.state);
    if (m.type === 'result') {
      waiting.get(m.id)?.(m.result);
      waiting.delete(m.id);
    }
  };
  ch.addEventListener('message', onMessage);
  ch.postMessage({ type: 'hello' } satisfies Message);
  return () => ch.removeEventListener('message', onMessage);
}

/** Ask the phone to do something, from whichever window this is. */
export function runPhone(command: Command): Promise<CommandResult> {
  if (host) return phone.run(command);
  const ch = open();
  if (!ch) return Promise.resolve({ ok: false, message: 'The main WorkSuite window is not open.' });
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    ch.postMessage({ type: 'cmd', id, command } satisfies Message);
    setTimeout(() => {
      if (waiting.delete(id)) resolve({ ok: false, message: 'The main WorkSuite window did not answer. Is it still open?' });
    }, 15_000);
  });
}

/** The phone's state, in any window. */
export function usePhoneState<S>(selector: (s: PhoneState) => S): S {
  return useStore(host ? phone.store : mirror, selector);
}

export function phoneState(): PhoneState {
  return host ? phone.state : mirror.get();
}

/**
 * The registration chip's words and tone, from plain values: a selector must return something stable, so the label
 * is made after reading the phase, not inside the selector.
 */
export function usePhaseLabel(): ReturnType<typeof phaseLabel> {
  const phase = usePhoneState((s) => s.phase);
  const extension = usePhoneState((s) => s.extension);
  const talking = usePhoneState((s) => s.lines.some((l) => l.state === 'connected'));
  return phaseLabel({ phase, extension, talking });
}
