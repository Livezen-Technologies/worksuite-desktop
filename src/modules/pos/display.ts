import { useEffect, useState } from 'react';

/**
 * What the customer display shows, sent from the register over a BroadcastChannel: both are windows of this app, on
 * its own origin and session, so the cart never leaves the computer and no IPC channel is needed for it. The display
 * says hello when it opens and the register answers with where the sale stands.
 */
export interface DisplayLine {
  name: string;
  quantity: number;
  total: number;
}

export type DisplayState =
  | { kind: 'idle'; shop: string | null }
  | { kind: 'cart'; shop: string | null; currency: string; lines: DisplayLine[]; discount: number; tax: number; total: number; provisional: boolean }
  | { kind: 'paid'; shop: string | null; currency: string; total: number; paid: number; change: number };

const NAME = 'worksuite-pos-display';

type Message = { type: 'state'; state: DisplayState } | { type: 'hello' };

let channel: BroadcastChannel | null = null;
let last: DisplayState = { kind: 'idle', shop: null };

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(NAME);
  // (Under Node — the unit tests — a channel would otherwise hold the process open.)
  (channel as { unref?: () => void }).unref?.();
  channel.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'hello') channel?.postMessage({ type: 'state', state: last } satisfies Message);
  };
  return channel;
}

/** The register: tell the display what to show now. */
export function publish(state: DisplayState): void {
  last = state;
  open()?.postMessage({ type: 'state', state } satisfies Message);
}

/** The display: what the register last said. */
export function useDisplayState(): DisplayState {
  const [state, setState] = useState<DisplayState>({ kind: 'idle', shop: null });
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel(NAME);
    c.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.type === 'state') setState(e.data.state);
    };
    c.postMessage({ type: 'hello' } satisfies Message);
    return () => c.close();
  }, []);
  return state;
}
