import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ago, cardLifetime, type MailAlertAction, type MailAlertCard, type MailAlertRow } from '@shared/mail-alerts';
import { call, errorMessage, on } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

/**
 * New-mail alerts inside WorkSuite (ENH-MAIL-05 D27, MNA-APP-01…05, MNA-A11-01…03).
 *
 * The main process decides that a new email gets a card — WorkSuite in front, Mail not showing that folder — and
 * sends it here (`mail-alert:show`); it takes it away when the message is read, archived, deleted or moved anywhere
 * (`mail-alert:clear`). A card sits at the bottom right, is announced politely (role=status), never takes the
 * keyboard, and goes by itself after 8 s (15 s at high importance) — not while it is hovered, focused or being typed
 * in. Ctrl+Shift+N (⌘⇧N) opens the latest alert. Dismissed, an alert stays in the bell.
 */

interface Shown {
  card: MailAlertCard;
  /** A reply sent from the card waits its undo window: when it goes. */
  sending: { id: string; at: number } | null;
  failed: string | null;
}

/** The latest alert's key: ⌘⇧N on a Mac, Ctrl+Shift+N elsewhere. */
function isLatestKey(e: KeyboardEvent): boolean {
  return e.shiftKey && !e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n';
}

/** A short, quiet chime for a card, when Mail sound is on and the main process says this one may sound. */
function chime(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const audio = new Ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.4);
    osc.onended = () => void audio.close().catch(() => undefined);
  } catch {
    /* no sound here */
  }
}

export function MailAlertCards() {
  const [shown, setShown] = useState<Shown[]>([]);
  const [hasLatest, setHasLatest] = useState(false);
  const region = useRef<HTMLDivElement | null>(null);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    const offs = [
      on<{ card: MailAlertCard; sound?: boolean; update?: boolean }>('mail-alert:show', (p) => {
        if (!p?.card) return;
        setShown((list) => {
          const at = list.findIndex((s) => s.card.id === p.card.id);
          if (at >= 0) return list.map((s, i) => (i === at ? { ...s, card: p.card } : s));
          if (p.update) return list;
          return [{ card: p.card, sending: null, failed: null }, ...list].slice(0, 6);
        });
        if (p.sound && !p.update) chime();
      }),
      on<{ ids?: string[]; all?: boolean; failed?: { key: string; error: string } }>('mail-alert:clear', (p) => {
        if (p?.all) return setShown([]);
        if (p?.failed) {
          const f = p.failed;
          setShown((list) => list.map((s) => (s.card.rows.some((r) => r.key === f.key) ? { ...s, sending: null, failed: f.error } : s)));
          return;
        }
        if (p?.ids?.length) setShown((list) => list.filter((s) => !p.ids!.includes(s.card.id)));
      }),
      on<{ hasLatest?: boolean }>('mail-alert:state', (s) => setHasLatest(!!s?.hasLatest)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Ctrl+Shift+N opens the latest alert (MNA-A11-01): the card in front, or the newest one again. With none, the
  // keys keep their other meaning (Move tab to new window).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isLatestKey(e)) return;
      if (!shownRef.current.length && !hasLatest) return;
      e.preventDefault();
      e.stopPropagation();
      const focusNewest = () => requestAnimationFrame(() => region.current?.querySelector<HTMLElement>('[data-mail-alert]')?.focus());
      if (shownRef.current.length) return focusNewest();
      void call('mailAlert:latest')
        .then((card) => {
          if (!card) return;
          setShown((list) => (list.some((s) => s.card.id === card.id) ? list : [{ card, sending: null, failed: null }, ...list]));
          focusNewest();
        })
        .catch(() => undefined);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hasLatest]);

  const remove = (id: string) => setShown((list) => list.filter((s) => s.card.id !== id));

  const act = async (s: Shown, action: MailAlertAction, row?: MailAlertRow, words?: string) => {
    try {
      const r = await call('mailAlert:action', { id: s.card.id, key: row?.key ?? null, action, text: words ?? null });
      if (r.sending) setShown((list) => list.map((x) => (x.card.id === s.card.id ? { ...x, sending: r.sending ?? null, failed: null } : x)));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  if (!shown.length) return null;
  return (
    <div ref={region} role="region" aria-label={text('New email alerts')} className="pointer-events-none fixed right-5 bottom-10 z-[60] flex w-[400px] max-w-[calc(100vw-40px)] flex-col-reverse gap-2">
      {shown.slice(0, 3).map((s) => (
        <AlertCard
          key={s.card.id}
          shown={s}
          onAct={(action, row, words) => {
            if (action === 'dismiss' || action === 'open' || action === 'open-inbox' || (action === 'reply' && !words)) remove(s.card.id);
            void act(s, action, row, words);
          }}
          onUndo={() => {
            if (!s.sending) return;
            void call('mailAlert:action', { id: s.sending.id, action: 'undo' }).catch(() => undefined);
            remove(s.card.id);
          }}
          onExpire={() => remove(s.card.id)}
        />
      ))}
      {shown.length > 3 ? <p className="pointer-events-auto self-end rounded-full bg-surface px-3 py-1 text-[12px] text-ink-3 shadow-sm">{text('{n} earlier alerts', { n: shown.length - 3 })}</p> : null}
    </div>
  );
}

function AlertCard({ shown, onAct, onUndo, onExpire }: { shown: Shown; onAct: (action: MailAlertAction, row?: MailAlertRow, words?: string) => void; onUndo: () => void; onExpire: () => void }) {
  const { card, sending, failed } = shown;
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [replying, setReplying] = useState(false);
  const [words, setWords] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const left = useRef(cardLifetime(card));
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });
  const single = card.kind === 'single';
  const row = single ? (card.rows[0] ?? null) : null;
  // Stays while it is hovered, focused, typed in or sending (MNA-APP-03/04).
  const held = hover || focused || replying || !!words || !!sending || !!failed;

  useEffect(() => {
    if (held) return;
    const started = Date.now();
    const t = setTimeout(() => expire.current(), left.current);
    return () => {
      clearTimeout(t);
      // Hovered or focused, the time left waits; it never comes back as less than a moment to read it.
      left.current = Math.max(1_500, left.current - (Date.now() - started));
    };
  }, [held]);

  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [sending]);

  const send = () => {
    const t = words.trim();
    if (!t || !row) return;
    onAct('reply', row, t);
    setReplying(false);
    setWords('');
  };
  const onReplyKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setReplying(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };
  const label = single ? text('New email from {sender}', { sender: card.title }) : card.title;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={label}
      tabIndex={-1}
      data-mail-alert={card.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !replying) onAct('dismiss');
      }}
      className="pointer-events-auto flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface text-ink shadow-[0_16px_40px_rgba(15,27,61,.22)] outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:animate-[ws-slide-in_180ms_ease-out]"
    >
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
        <Icon name="bell" size={16} aria-hidden className="shrink-0 text-primary" />
        <b className="min-w-0 flex-1 truncate text-[14px]">{single ? text('WorkSuite Mail') : card.title}</b>
        {card.subtitle ? <span className="truncate text-[11.5px] text-ink-3">{card.subtitle}</span> : null}
        <button type="button" aria-label={text('Dismiss')} title={text('Dismiss')} onClick={() => onAct('dismiss')} className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={14} />
        </button>
      </header>
      {single && row ? (
        <SingleBody card={card} row={row} now={now} onOpen={() => onAct('open', row)} />
      ) : (
        <ul className="flex flex-col">
          {card.rows.map((r) => (
            <GroupRow key={r.key} row={r} level={card.level} now={now} onAct={(a) => onAct(a, r)} />
          ))}
          {card.more ? <li className="border-b border-line px-3.5 py-2 text-[12px] text-ink-3">{text('and {n} more', { n: card.more })}</li> : null}
        </ul>
      )}
      {failed ? (
        <p role="alert" className="flex items-center gap-2 border-t border-line bg-subtle px-3.5 py-2 text-[12.5px] text-danger">
          <Icon name="warning" size={14} aria-hidden />
          <span className="min-w-0 flex-1">{text('Not sent: {reason} It is kept as a draft.', { reason: failed })}</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => row && onAct('reply', row)}>
            {text('Open draft')}
          </button>
        </p>
      ) : sending ? (
        <p className="flex items-center gap-2 border-t border-line bg-subtle px-3.5 py-2 text-[12.5px] text-ink-2">
          <span className="min-w-0 flex-1">{text('Sending your reply in {n} s', { n: Math.max(0, Math.ceil((sending.at - now) / 1000)) })}</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={onUndo}>
            {text('Undo')}
          </button>
        </p>
      ) : replying && row ? (
        <div className="flex flex-col gap-2 border-t border-line px-3.5 py-2.5">
          <textarea
            aria-label={text('Reply to {sender}', { sender: row.sender })}
            placeholder={text('Reply to {sender}', { sender: row.sender })}
            value={words}
            rows={3}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={onReplyKey}
            className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="h-[30px] rounded-[7px] px-3 text-[12px] font-semibold text-ink-2 hover:bg-subtle" onClick={() => setReplying(false)}>
              {text('Cancel')}
            </button>
            <button type="button" disabled={!words.trim()} className="h-[30px] rounded-[7px] bg-primary px-3.5 text-[12px] font-bold text-white disabled:opacity-50" onClick={send}>
              {text('Send')}
            </button>
          </div>
        </div>
      ) : (
        <footer className="flex items-center gap-1.5 border-t border-line bg-subtle/60 px-3.5 py-2.5">
          {single && row ? (
            <>
              {/* Reply keeps its word; the quick actions are icons with their names as tooltips, so the row never
                  wraps at the card's 400 px (a two-line "Mark as read" button). */}
              <CardButton icon="reply" label={text('Reply')} showLabel onClick={() => (card.replyable ? setReplying(true) : onAct('reply', row))} />
              <CardButton icon="mail-open" label={text('Mark as read')} onClick={() => onAct('read', row)} />
              <CardButton icon="archive" label={text('Archive')} onClick={() => onAct('archive', row)} />
              <CardButton icon="flag" label={text('Flag')} onClick={() => onAct('flag', row)} />
              <span className="flex-1" />
              <button type="button" className={PRIMARY} onClick={() => onAct('open', row)}>
                {text('Open')}
              </button>
            </>
          ) : (
            <>
              {card.rows.length ? (
                <button type="button" className={SECONDARY} onClick={() => onAct('read-all')}>
                  <Icon name="mail-open" size={14} aria-hidden className="shrink-0 text-ink-2" />
                  {text('Mark all as read')}
                </button>
              ) : null}
              <span className="flex-1" />
              <button type="button" className={PRIMARY} onClick={() => onAct('open-inbox')}>
                {card.inbox.label === 'Open Inbox' ? text('Open Inbox') : card.inbox.label}
              </button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1';
const SECONDARY = cx('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink transition-colors hover:border-ink-3/40 hover:bg-subtle active:bg-line/60', FOCUS);
const PRIMARY = cx('inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-[8px] bg-primary px-4 text-[12.5px] font-bold text-white shadow-sm transition hover:brightness-110 active:brightness-95', FOCUS);
const ICON_ONLY = cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface text-ink-2 transition-colors hover:border-ink-3/40 hover:bg-subtle hover:text-ink active:bg-line/60', FOCUS);

function CardButton({ icon, label, onClick, showLabel = false }: { icon: string; label: string; onClick: () => void; showLabel?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={showLabel ? SECONDARY : ICON_ONLY}>
      <Icon name={icon} size={15} aria-hidden className={showLabel ? 'shrink-0 text-ink-2' : 'shrink-0'} />
      {showLabel ? label : null}
    </button>
  );
}

/** The words beside a message, never colour alone (MNA-A11-02): High importance, Checked, attachments, External. */
function Tags({ row }: { row: MailAlertRow }) {
  const tags = [row.high ? { id: 'high', icon: 'alert', label: text('High importance'), cls: 'text-danger' } : null, row.checked ? { id: 'checked', icon: 'shield-check', label: text('Checked'), cls: 'text-success' } : null, row.attachments ? { id: 'files', icon: 'paperclip', label: row.attachments === 1 ? text('1 attachment') : text('{n} attachments', { n: row.attachments }), cls: 'text-ink-3' } : null, row.external ? { id: 'external', icon: 'external', label: text('External'), cls: 'text-warning' } : null].filter((t) => t !== null);
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] font-semibold">
      {tags.map((t) => (
        <span key={t.id} className={cx('inline-flex items-center gap-1', t.cls)}>
          <Icon name={t.icon} size={12} aria-hidden />
          {t.label}
        </span>
      ))}
    </span>
  );
}

function Avatar({ row }: { row: MailAlertRow }) {
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11.5px] font-bold text-white">
      {row.initials}
    </span>
  );
}

function SingleBody({ card, row, now, onOpen }: { card: MailAlertCard; row: MailAlertRow; now: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={text('Open the email from {sender}', { sender: row.sender })} className="flex gap-3 px-3.5 py-3 text-left hover:bg-subtle">
      <Avatar row={row} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <b className="min-w-0 flex-1 truncate text-[13px]" title={row.address ?? undefined}>
            {card.level === 'hidden' ? card.title : row.sender}
          </b>
          <span className="shrink-0 text-[11px] text-ink-3">{ago(row.at, now)}</span>
        </span>
        <Tags row={row} />
        {row.subject ? <span className="line-clamp-2 text-[13px] font-semibold">{row.subject}</span> : null}
        {row.preview ? <span className="line-clamp-2 text-[12.5px] text-ink-2">{row.preview}</span> : null}
        <span className="text-[11px] text-ink-3">{row.account}</span>
      </span>
    </button>
  );
}

function GroupRow({ row, level, now, onAct }: { row: MailAlertRow; level: MailAlertCard['level']; now: number; onAct: (a: MailAlertAction) => void }) {
  return (
    <li className="group relative flex gap-3 border-b border-line px-3.5 py-2.5 hover:bg-subtle focus-within:bg-subtle">
      <Avatar row={row} />
      <button type="button" onClick={() => onAct('open')} aria-label={level === 'hidden' ? text('Open the email in {account}', { account: row.account }) : text('Open the email from {sender}', { sender: row.sender })} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="flex items-baseline gap-2">
          <b className="min-w-0 flex-1 truncate text-[12.5px]">{row.sender}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{ago(row.at, now)}</span>
        </span>
        {row.subject ? <span className="truncate text-[12.5px]">{row.subject}</span> : null}
        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
          {row.high ? <span className="font-semibold text-danger">{text('High importance')} ·</span> : null}
          {row.account}
        </span>
      </button>
      {/* Each row keeps its own actions, on hover and on focus (MNA-GRP-01). */}
      {level !== 'hidden' ? (
        <span className="absolute top-1/2 right-2 hidden -translate-y-1/2 items-center gap-0.5 rounded-[8px] border border-line bg-surface p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
          <RowButton icon="reply" label={text('Reply to {sender}', { sender: row.sender })} onClick={() => onAct('reply')} />
          <RowButton icon="mail-open" label={text('Mark as read')} onClick={() => onAct('read')} />
          <RowButton icon="archive" label={text('Archive')} onClick={() => onAct('archive')} />
          <RowButton icon="flag" label={text('Flag')} onClick={() => onAct('flag')} />
        </span>
      ) : null}
    </li>
  );
}

function RowButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle hover:text-ink">
      <Icon name={icon} size={15} />
    </button>
  );
}
