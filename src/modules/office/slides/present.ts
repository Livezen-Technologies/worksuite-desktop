import { call, errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { channelName, parseShowMessage, type ShowMessage } from './protocol';

/**
 * Starting a slideshow (worksuite-desktop#321) from the window the deck is open in. The main process opens the
 * slideshow full screen (and the presenter view, with a second screen); those windows ask this one for the deck over
 * the show's BroadcastChannel. This window keeps answering — and hears where the show ended — for as long as the show
 * is up, even when the viewer it was started from has closed.
 */
export interface PresentOptions {
  name: string;
  bytes: Uint8Array;
  start: number;
  /** Told the slide the show ended on, to carry on from there. */
  onEnd?: (index: number) => void;
}

interface Hosted {
  channel: BroadcastChannel;
  timer: ReturnType<typeof setTimeout> | null;
}

let current: Hosted | null = null;

/** No window asked for the deck in this long: the show did not open. */
const HELLO_TIMEOUT_MS = 30_000;

function stop(): void {
  if (!current) return;
  if (current.timer) clearTimeout(current.timer);
  current.channel.close();
  current = null;
}

export async function present(opts: PresentOptions): Promise<boolean> {
  stop();
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const channel = new BroadcastChannel(channelName(id));
  const hosted: Hosted = { channel, timer: null };
  current = hosted;
  let index = opts.start;
  let greeted = false;
  channel.onmessage = (e: MessageEvent) => {
    const m = parseShowMessage(e.data);
    if (!m) return;
    if (m.t === 'hello') {
      greeted = true;
      const reply: ShowMessage = { t: 'deck', name: opts.name, bytes: opts.bytes, index };
      channel.postMessage(reply);
    } else if (m.t === 'goto') index = m.index;
    else if (m.t === 'end') {
      if (current === hosted) stop();
      opts.onEnd?.(m.index);
    }
  };
  hosted.timer = setTimeout(() => {
    if (!greeted && current === hosted) stop();
  }, HELLO_TIMEOUT_MS);
  try {
    await call('slides:present', { id, presenter: true });
    return true;
  } catch (e) {
    if (current === hosted) stop();
    toast('error', `The slideshow could not start: ${errorMessage(e)}`);
    return false;
  }
}

/** Whether a show this window started is up. */
export const presenting = (): boolean => current !== null;
