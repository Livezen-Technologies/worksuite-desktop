import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PosDisplayMedia } from '@shared/pos';
import { hideWindowBar } from '../../app/windowChrome';
import { toE164 } from '../../core/phone';
import { useTabTitle } from '../../core/tab-context';
import { displayMedia } from './api';
import { useDisplayChannel, type DisplayLine, type DisplayMatch, type DisplayState, type Message, type PhoneResult } from './display';
import { useT } from './i18n';
import { Mark } from './parts';
import { formatMoney } from './pricing';

/**
 * The customer display (`/pos/display`), facing the customer (worksuite-desktop#294).
 *
 * - **Idle** (no sale): the company's promotions full screen, its logo and name in the top corner; with none, the logo
 *   on its brand colour and a welcome.
 * - **A sale in progress**: the promotions on the start half; on the end half the cart — quantity, name (two lines at
 *   most), unit price and line total, scrolled to the newest line — and fixed under it the subtotal, discount, tax and
 *   what the customer pays. With a touch screen, WorkSuite in reach and a server that looks numbers up, an "Enter your
 *   phone number" button opens a numpad; once a customer is on the sale, a greeting with their masked name and "Not
 *   you?".
 * - **Payment**: the amount due, what has been paid and the change, as the cashier takes the tenders.
 * - **Complete**: thank you and the change; back to idle after a few seconds.
 *
 * It reads nothing but what the register sends it (display.ts) and the pictures this till keeps (`pos:displayMedia`).
 * Every customer it ever names arrives masked ("Has*****a M."): never a whole name, an e-mail, an address or a
 * purchase. The pictures keep showing offline; the phone button hides while WorkSuite cannot be reached.
 */
export const DONE_MS = 6_000;
export const NUMPAD_IDLE_MS = 30_000;
const MEDIA_POLL_MS = 5 * 60_000;

/** What the display shows for a state, a completed sale turning idle after `DONE_MS`. Pure. */
export function viewOf(state: DisplayState, doneFor: number): 'idle' | 'cart' | 'pay' | 'done' {
  if (state.kind === 'paid') return doneFor >= DONE_MS ? 'idle' : 'done';
  if (state.kind === 'cart') return state.lines.length ? 'cart' : 'idle';
  return state.kind;
}

/** Whether the customer may give their number now: a sale on screen, nobody on it yet, touch, and the register's word. Pure. */
export function phoneOffered(state: DisplayState, touch: boolean): boolean {
  return state.kind === 'cart' && state.lines.length > 0 && state.phone === true && touch && !state.customer;
}

/** The next picture of the slider. Pure. */
export function nextSlide(at: number, count: number): number {
  return count > 1 ? (at + 1) % count : 0;
}

/** The pictures and the till's word on touch, read when the display opens and every few minutes. */
function useMedia(): PosDisplayMedia | null {
  const [m, setM] = useState<PosDisplayMedia | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      displayMedia().then(
        (x) => {
          if (live) setM((have) => (have && have.version === x.version && have.touch === x.touch && have.slides.length === x.slides.length ? have : x));
        },
        () => undefined,
      );
    void read();
    const h = setInterval(read, MEDIA_POLL_MS);
    return () => {
      live = false;
      clearInterval(h);
    };
  }, []);
  return m;
}

/** How long the current completed sale has been on screen: 0, or `DONE_MS` once it has been there that long. */
function useDoneFor(state: DisplayState): number {
  // The same sale said again (the register answering a hello) does not start the count again.
  const key = state.kind === 'paid' ? JSON.stringify(state) : null;
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    const h = setTimeout(() => setExpired(key), DONE_MS);
    return () => clearTimeout(h);
  }, [key]);
  return key && expired === key ? DONE_MS : 0;
}

export default function CustomerDisplay() {
  const t = useT();
  useTabTitle(t('pos.display'));
  useEffect(() => hideWindowBar(), []);
  const media = useMedia();
  const [result, setResult] = useState<{ ticket: string; result: PhoneResult } | null>(null);
  const [entry, setEntry] = useState(false);
  const touch = media?.touch === true;
  const onOther = useCallback((m: Message) => {
    // The cashier asked: the numpad opens — shown only where a sale is on screen and the customer can touch it.
    if (m.type === 'ask') setEntry(true);
    else if (m.type === 'phoneResult') setResult({ ticket: m.ticket, result: m.result });
    // The sale ended, or somebody is on it now: the numpad goes.
    else if (m.type === 'state' && (m.state.kind !== 'cart' || m.state.customer)) setEntry(false);
  }, []);
  const { state, send } = useDisplayChannel(onOther);
  const doneFor = useDoneFor(state);
  const view = viewOf(state, doneFor);

  // Tell the register whether this screen takes touch: its "Ask for the phone number" needs it.
  useEffect(() => {
    send({ type: 'touch', touch });
    // `state`: the register may have opened after this display; it hears it with the next change.
  }, [touch, state.kind, send]);

  const shop = media?.company || state.shop || '';
  const offered = phoneOffered(state, touch);

  // The logo and name over the pictures; with none, the fallback shows them itself.
  const brand = !media?.slides.length ? null : (
    <div className="absolute start-[clamp(16px,2.4vw,36px)] top-[clamp(16px,2.4vw,36px)] z-10 flex max-w-[70%] items-center gap-3 rounded-[14px] bg-black/35 px-3.5 py-2.5 text-white backdrop-blur-sm">
      {media?.logo ? <img src={media.logo} alt="" className="h-[clamp(24px,2.6vw,40px)] w-auto max-w-[160px] object-contain" /> : <Mark size={28} />}
      <span className="truncate text-[clamp(15px,1.7vw,24px)] font-extrabold">{shop}</span>
    </div>
  );

  const promo = (full: boolean) => <Promotions media={media} shop={shop} full={full} />;

  if (view === 'idle') {
    return (
      <div className="relative h-full overflow-hidden bg-navy text-white" data-view="idle">
        {promo(true)}
        {brand}
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-navy" data-view={view}>
      <div className="relative min-w-0 flex-1">
        {promo(false)}
        {brand}
      </div>
      <div className="no-drag relative flex w-1/2 min-w-0 flex-col bg-white text-navy">
        {view === 'done' && state.kind === 'paid' ? (
          <Done state={state} />
        ) : state.kind === 'cart' || state.kind === 'pay' ? (
          <Cart state={state} offered={offered} onPhone={() => setEntry(true)} onNotMe={() => send({ type: 'notMe' })} />
        ) : null}
        {entry && touch && state.kind === 'cart' && state.lines.length > 0 && !state.customer ? (
          <PhoneEntry
            result={result}
            onSubmit={(ticket, phone) => {
              setResult(null);
              send({ type: 'phone', ticket, phone });
            }}
            onConfirm={(ticket, id) => send({ type: 'confirm', ticket, id })}
            onNewNumber={(ticket, phone) => send({ type: 'newNumber', ticket, phone })}
            onClose={() => {
              setEntry(false);
              setResult(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── The promotions ──────────────────────────────────────────────────── */

/**
 * The pictures, one after the other — every `interval` seconds, fading or sliding (from the end side, in either
 * direction of writing) — each filling the panel without distortion (cropped, never stretched). With none, the logo
 * on the brand colour.
 */
export function Promotions({ media, shop, full }: { media: PosDisplayMedia | null; shop: string; full: boolean }) {
  const t = useT();
  const slides = media?.slides ?? [];
  if (!slides.length) {
    const bg: CSSProperties = media?.accent ? { background: `linear-gradient(135deg, ${media.accent}, var(--ws-navy))` } : {};
    return (
      <div className="drag flex h-full flex-col items-center justify-center gap-6 bg-navy p-10 text-center text-white" style={bg} data-promo="fallback">
        {media?.logo ? <img src={media.logo} alt={shop} className="max-h-[38%] max-w-[60%] object-contain" /> : <Mark size={full ? 160 : 112} />}
        {full ? <div className="text-[clamp(32px,4.5vw,64px)] font-extrabold">{t('pos.cd.welcome')}</div> : null}
        {shop ? <div className="text-[clamp(18px,2vw,30px)] font-bold text-white/80">{shop}</div> : null}
      </div>
    );
  }

  // A new set of pictures starts again at the first.
  return <Slides key={`${media?.version ?? ''}|${slides.length}|${media?.interval ?? 8}`} slides={slides} interval={media?.interval ?? 8} fade={media?.transition !== 'slide'} />;
}

function Slides({ slides, interval, fade }: { slides: PosDisplayMedia['slides']; interval: number; fade: boolean }) {
  const [at, setAt] = useState(0);
  const count = slides.length;
  useEffect(() => {
    if (count < 2) return;
    const h = setInterval(() => setAt((i) => nextSlide(i, count)), Math.max(3, interval) * 1000);
    return () => clearInterval(h);
  }, [count, interval]);
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  return (
    <div className="drag relative h-full overflow-hidden bg-navy" data-promo="slides" data-at={at}>
      {slides.map((s, i) => {
        const style: CSSProperties = fade
          ? { opacity: i === at ? 1 : 0, transition: 'opacity 700ms ease' }
          : { transform: `translateX(${(i - at) * 100 * (rtl ? -1 : 1)}%)`, transition: 'transform 700ms ease' };
        return <img key={s.id} src={s.src} alt={s.title ?? ''} aria-hidden={i !== at} className="absolute inset-0 h-full w-full object-cover" style={style} />;
      })}
    </div>
  );
}

/* ── The cart ────────────────────────────────────────────────────────── */

function Cart({ state, offered, onPhone, onNotMe }: { state: Extract<DisplayState, { kind: 'cart' | 'pay' }>; offered: boolean; onPhone: () => void; onNotMe: () => void }) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const lines = state.lines;
  // The newest line in view: lines are added at the end.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, lines[lines.length - 1]?.quantity]); // eslint-disable-line react-hooks/exhaustive-deps
  const money = (n: number) => formatMoney(n);
  const pay = state.kind === 'pay';

  return (
    <>
      <div className="flex min-h-[72px] items-center justify-between gap-3 border-b border-[#e2e8f0] px-[clamp(16px,2vw,32px)] py-3">
        {state.customer ? (
          <>
            <div className="min-w-0 truncate text-[clamp(18px,2vw,28px)] font-extrabold" data-greeting>
              {t('pos.cd.hello', { name: state.customer })}
            </div>
            {state.kind === 'cart' ? (
              <button type="button" onClick={onNotMe} className="shrink-0 rounded-full px-4 py-2 text-[clamp(14px,1.3vw,18px)] font-bold text-[#475569] underline">
                {t('pos.cd.notYou')}
              </button>
            ) : null}
          </>
        ) : offered ? (
          <button type="button" onClick={onPhone} className="flex h-[clamp(52px,5vw,72px)] w-full items-center justify-center gap-3 rounded-[16px] bg-[#0A6CFF] px-5 text-[clamp(17px,1.8vw,26px)] font-extrabold text-white">
            {t('pos.cd.phone.button')}
          </button>
        ) : (
          <div className="text-[clamp(18px,2vw,28px)] font-extrabold">{t('pos.cd.yourItems')}</div>
        )}
      </div>
      <ul ref={list} className="min-h-0 flex-1 overflow-y-auto px-[clamp(16px,2vw,32px)] scroll-thin" aria-label={t('pos.cd.yourItems')}>
        {lines.map((l, i) => (
          <Line key={i} line={l} money={money} each={(n) => t('pos.cd.each', { n })} />
        ))}
      </ul>
      <div className="shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] px-[clamp(16px,2vw,32px)] py-4 text-[clamp(14px,1.4vw,20px)]">
        <Row label={t('pos.cd.subtotal')} value={money(state.subtotal)} />
        {state.discount ? <Row label={t('pos.cd.discount')} value={`−${money(state.discount)}`} /> : null}
        <Row label={t('pos.cd.tax')} value={money(state.tax)} />
        {pay ? (
          <>
            <Row label={t('pos.cd.amountDue')} value={`${state.currency} ${money(state.total)}`} strong />
            <Row label={t('pos.cd.paidSoFar')} value={money(state.paid)} />
            {state.due > 0 ? <Big label={t('pos.cd.stillDue')} value={`${state.currency} ${money(state.due)}`} /> : <Big label={t('pos.cd.change')} value={`${state.currency} ${money(state.change)}`} tone="change" />}
          </>
        ) : (
          <>
            <Big label={t('pos.cd.youPay')} value={`${state.currency} ${money(state.total)}`} />
            {state.kind === 'cart' && (state.points != null || state.tier) ? (
              <div className="mt-2 text-[clamp(13px,1.2vw,17px)] text-[#475569]">{[state.tier, state.points != null ? t('pos.cd.points', { n: state.points }) : null].filter(Boolean).join(' · ')}</div>
            ) : null}
            {state.kind === 'cart' && state.provisional ? <div className="mt-1 text-[clamp(12px,1.1vw,15px)] text-[#64748b]">{t('pos.provisional')}</div> : null}
          </>
        )}
      </div>
    </>
  );
}

function Line({ line, money, each }: { line: DisplayLine; money: (n: number) => string; each: (n: string) => string }) {
  return (
    <li className="flex items-start gap-3 border-b border-[#f1f5f9] py-[clamp(8px,1vw,14px)]">
      <span className="w-[3.2em] shrink-0 font-mono text-[clamp(15px,1.5vw,22px)] font-bold tabular-nums">{line.quantity}×</span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[clamp(15px,1.5vw,22px)] font-semibold break-words">{line.name}</span>
        {line.price != null ? <span className="block font-mono text-[clamp(12px,1.1vw,16px)] text-[#64748b] tabular-nums">{each(money(line.price))}</span> : null}
      </span>
      <span className="shrink-0 font-mono text-[clamp(15px,1.5vw,22px)] font-bold tabular-nums">{money(line.total)}</span>
    </li>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-0.5 ${strong ? 'font-bold' : 'text-[#475569]'}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function Big({ label, value, tone }: { label: string; value: string; tone?: 'change' }) {
  return (
    <div className={`mt-2 flex items-end justify-between gap-4 rounded-[16px] px-4 py-3 ${tone === 'change' ? 'bg-[#7FD8DF]' : 'bg-navy text-white'}`}>
      <span className="text-[clamp(16px,1.7vw,24px)] font-bold">{label}</span>
      <span className="font-mono text-[clamp(30px,3.8vw,60px)] leading-none font-bold tabular-nums" data-total>
        {value}
      </span>
    </div>
  );
}

function Done({ state }: { state: Extract<DisplayState, { kind: 'paid' }> }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 p-[clamp(20px,3vw,48px)]">
      <div className="text-[clamp(32px,4vw,60px)] font-extrabold">{t('pos.cd.thanks')}</div>
      {state.customer ? <div className="text-[clamp(18px,2vw,28px)] font-bold">{t('pos.cd.hello', { name: state.customer })}</div> : null}
      <div className="text-[clamp(14px,1.5vw,20px)] text-[#64748b]">{t('pos.cd.total', { n: formatMoney(state.total, state.currency) })}</div>
      <div className="text-[clamp(14px,1.5vw,20px)] text-[#64748b]">{t('pos.cd.paid', { n: formatMoney(state.paid, state.currency) })}</div>
      {state.points ? (
        <div className="text-[clamp(14px,1.5vw,20px)] font-bold text-primary">
          {[state.points.earned ? t('pos.cd.earned', { n: state.points.earned }) : null, state.points.balance != null ? t('pos.cd.points', { n: state.points.balance }) : null].filter(Boolean).join(' · ')}
        </div>
      ) : null}
      <div className="rounded-[16px] bg-[#7FD8DF] px-5 py-4">
        <div className="text-[clamp(16px,1.7vw,22px)] font-bold">{t('pos.cd.change')}</div>
        <div className="font-mono text-[clamp(36px,4.6vw,72px)] leading-none font-bold tabular-nums">{formatMoney(state.change)}</div>
      </div>
      <div className="text-[clamp(14px,1.5vw,20px)] text-[#64748b]">{t('pos.cd.comeAgain')}</div>
    </div>
  );
}

/* ── The phone number ────────────────────────────────────────────────── */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/** A number typed on the numpad, kept to digits and one leading `+`, at most 15 digits. Pure. */
export function typePhone(v: string, key: (typeof KEYS)[number] | '+'): string {
  if (key === 'clear') return '';
  if (key === 'back') return v.slice(0, -1);
  if (key === '+') return v ? v : '+';
  return v.replace(/\D/g, '').length >= 15 ? v : v + key;
}

let tickets = 0;
const ticketOf = () => `${Date.now().toString(36)}-${++tickets}`;

/**
 * The numpad, over the cart: the customer types their number (as they would give it — with its leading 0, or with
 * +94), it is checked as WorkSuite's customers' numbers are (Sri Lanka by default), and the register looks it up. One
 * match: their masked name, Confirm / Not me. Several: the masked names to pick from. None: "Continue with this
 * number", which asks the cashier to add them. Closed and cleared after 30 s of nobody touching it.
 */
export function PhoneEntry({
  result,
  onSubmit,
  onConfirm,
  onNewNumber,
  onClose,
}: {
  result: { ticket: string; result: PhoneResult } | null;
  onSubmit: (ticket: string, phone: string) => void;
  onConfirm: (ticket: string, id: number) => void;
  onNewNumber: (ticket: string, phone: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const [asked, setAsked] = useState<{ ticket: string; phone: string } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState(0);
  const poke = () => setTouched((n) => n + 1);

  // Nobody touched it for a while: closed, and the number cleared with it.
  useEffect(() => {
    const h = setTimeout(onClose, sent ? 4_000 : NUMPAD_IDLE_MS);
    return () => clearTimeout(h);
  }, [touched, sent, result, onClose]);

  const answer = result && asked && result.ticket === asked.ticket ? result.result : null;
  const matches: DisplayMatch[] = answer?.kind === 'matches' ? answer.items : [];
  const one = matches.length === 1 ? matches[0]! : null;
  const chosen = one ?? matches.find((m) => m.id === picked) ?? null;

  const submit = () => {
    poke();
    const e164 = toE164(typed);
    if (!e164) {
      setBad(true);
      return;
    }
    setBad(false);
    setPicked(null);
    const ticket = ticketOf();
    setAsked({ ticket, phone: e164 });
    onSubmit(ticket, e164);
  };
  const again = () => {
    poke();
    setAsked(null);
    setPicked(null);
    setTyped('');
  };

  let body: ReactNode;
  if (sent) {
    body = <p className="text-center text-[clamp(20px,2.2vw,30px)] font-extrabold">{t('pos.cd.phone.sent')}</p>;
  } else if (asked && !answer) {
    body = <p className="text-center text-[clamp(18px,2vw,26px)] font-bold text-[#475569]">{t('pos.cd.phone.looking')}</p>;
  } else if (answer?.kind === 'error') {
    body = (
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="text-[clamp(18px,2vw,26px)] font-bold">{t(answer.reason === 'throttled' ? 'pos.cd.phone.busy' : 'pos.cd.phone.error')}</p>
        <Choice onClick={onClose}>{t('pos.cd.phone.cancel')}</Choice>
      </div>
    );
  } else if (answer?.kind === 'none' || (answer?.kind === 'matches' && matches.length === 0)) {
    body = (
      <div className="flex flex-col items-stretch gap-4 text-center">
        <p className="text-[clamp(18px,2vw,26px)] font-bold">{t('pos.cd.phone.none')}</p>
        <Choice
          primary
          onClick={() => {
            poke();
            onNewNumber(asked!.ticket, asked!.phone);
            setSent(true);
          }}
        >
          {t('pos.cd.phone.continue')}
        </Choice>
        <Choice onClick={again}>{t('pos.cd.phone.retry')}</Choice>
      </div>
    );
  } else if (answer?.kind === 'matches') {
    body = (
      <div className="flex flex-col items-stretch gap-4">
        <p className="text-center text-[clamp(18px,2vw,26px)] font-bold">{t(one ? 'pos.cd.phone.isThisYou' : 'pos.cd.phone.pick')}</p>
        {one ? (
          <div className="rounded-[16px] bg-[#EEF1FB] px-5 py-4 text-center text-[clamp(22px,2.6vw,36px)] font-extrabold" data-masked>
            {one.masked}
          </div>
        ) : (
          <div className="flex flex-col gap-2" role="listbox" aria-label={t('pos.cd.phone.pick')}>
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={picked === m.id}
                data-masked
                onClick={() => {
                  poke();
                  setPicked(m.id);
                }}
                className={`rounded-[14px] px-5 py-3 text-[clamp(18px,2vw,28px)] font-extrabold ${picked === m.id ? 'bg-[#0A6CFF] text-white' : 'bg-[#EEF1FB]'}`}
              >
                {m.masked}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <Choice onClick={again}>{t('pos.cd.phone.notMe')}</Choice>
          <Choice
            primary
            disabled={!chosen}
            onClick={() => {
              if (!chosen) return;
              onConfirm(asked!.ticket, chosen.id);
              onClose();
            }}
          >
            {t('pos.cd.phone.confirm')}
          </Choice>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-stretch gap-3">
        <div className={`rounded-[14px] border-2 px-4 py-3 text-center font-mono text-[clamp(26px,3vw,44px)] font-bold tracking-wider tabular-nums ${bad ? 'border-[#dc2626]' : 'border-[#cbd5e1]'}`} dir="ltr" aria-live="polite" data-typed>
          {typed || ' '}
        </div>
        {bad ? <p className="text-center text-[clamp(14px,1.4vw,18px)] font-bold text-[#dc2626]">{t('pos.cd.phone.invalid')}</p> : <p className="text-center text-[clamp(13px,1.3vw,17px)] text-[#64748b]">{t('pos.cd.phone.hint')}</p>}
        <div className="grid grid-cols-3 gap-2" dir="ltr">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-label={k === 'clear' ? t('pos.cd.phone.clear') : k === 'back' ? t('pos.cd.phone.back') : k}
              onClick={() => {
                poke();
                setBad(false);
                setTyped((v) => typePhone(v, k));
              }}
              className="h-[clamp(52px,6.5vh,80px)] rounded-[14px] bg-[#EEF1FB] text-[clamp(22px,2.4vw,34px)] font-bold active:bg-[#dbe3f8]"
            >
              {k === 'clear' ? 'C' : k === 'back' ? '⌫' : k}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <Choice onClick={onClose}>{t('pos.cd.phone.cancel')}</Choice>
          <Choice primary disabled={!typed} onClick={submit}>
            {t('pos.cd.phone.submit')}
          </Choice>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-center gap-4 bg-white/97 p-[clamp(16px,2.4vw,40px)]" role="dialog" aria-label={t('pos.cd.phone.title')} onPointerDown={poke}>
      <h2 className="text-center text-[clamp(22px,2.4vw,34px)] font-extrabold">{t('pos.cd.phone.title')}</h2>
      {body}
    </div>
  );
}

function Choice({ children, onClick, primary = false, disabled = false }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-[clamp(52px,6vh,76px)] flex-1 rounded-[14px] px-4 text-[clamp(16px,1.7vw,24px)] font-extrabold disabled:opacity-40 ${primary ? 'bg-[#0A6CFF] text-white' : 'bg-[#e2e8f0] text-navy'}`}
    >
      {children}
    </button>
  );
}

/** For tests: the numpad's keys. */
export const NUMPAD_KEYS = KEYS;
