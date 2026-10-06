import { useEffect, useState } from 'react';
import { createStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { closeDisplay, openDisplay } from './api';

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

/**
 * Phase 2 adds, where the sale names a CRM customer: their name (a greeting), their tier and points — never their
 * contact details — and what promotions saved.
 */
export type DisplayState =
  | { kind: 'idle'; shop: string | null }
  | {
      kind: 'cart';
      shop: string | null;
      currency: string;
      lines: DisplayLine[];
      discount: number;
      tax: number;
      total: number;
      provisional: boolean;
      customer?: string;
      tier?: string;
      points?: number;
    }
  | { kind: 'paid'; shop: string | null; currency: string; total: number; paid: number; change: number; customer?: string; points?: { earned: number; balance: number | null } };

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

/** Whether this window opened the customer display (the till bar's menu, the till's devices). */
export const displayWindow = createStore<{ open: boolean }>({ open: false });

/** Open the customer display (on the second screen when there is one), or close it. */
export async function toggleCustomerDisplay(): Promise<void> {
  try {
    if (displayWindow.get().open) {
      await closeDisplay();
      displayWindow.set({ open: false });
    } else {
      const r = await openDisplay();
      displayWindow.set({ open: r.opened });
      if (!r.secondary) toast('info', 'Only one screen is connected: the customer display opened as a window. Move it to the customer’s screen.');
    }
  } catch (e) {
    toast('error', e instanceof Error ? e.message : 'The customer display could not be opened.');
  }
}
