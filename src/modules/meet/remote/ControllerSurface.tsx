import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { app } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { bytes } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { useStore } from '../../../core/store';
import { Icon } from '../../../components/Icon';
import { Button, Modal, TextField, cx } from '../../../components/ui';
import { useNow } from '../../calls/parts';
import type { CallPerson } from '../../calls/ui/people';
import { offerFor, pauseText, type ControlSession, type RemoteFile, type Share } from './api';
import { remote, type Prompts, type Waiting } from './controller';
import { buttonName, pointOn, wheelDelta } from './input';
import { platformName, specialKeys } from './specialKeys';
import { Checkbox } from '../../../components/Checkbox';

/**
 * Remote control over another person's shared screen, in the meeting window
 * (WS-MEET-ENH-01 RC02, RC05, RC07). Under the "is sharing" label: Request
 * control, or the server's reason it can't be asked for, or this computer's
 * policy; the wait for an answer with its countdown; and while controlling,
 * the state, the special keys and Release control. Over the picture, a
 * surface that takes the mouse and — while it has focus — the keyboard.
 */
export function RemoteControlLayer({ sharer }: { sharer: CallPerson }) {
  useSyncExternalStore(remote.subscribe, remote.snapshot);
  const policy = useStore(app, (s) => s.bootstrap?.policy?.remote_control_controller);
  const share = remote.state?.shares.find((s) => s.identity === sharer.id);
  const session = remote.session?.sharer.identity === sharer.id ? remote.session : null;
  const track = session ? sharer.screen : null;
  useEffect(() => remote.watch(track), [track]);

  // The session that just ended, for this share (RC07): shown until it is
  // dismissed or control is asked for again, rather than as a toast that is
  // gone before it has been read.
  const ended = remote.ended && share && remote.ended.shareId === share.id ? remote.ended : null;

  return (
    <>
      {session ? <ControlSurface session={session} /> : null}
      <div className="absolute top-12 left-3 z-[3] flex max-w-[min(640px,70%)] flex-col items-start gap-2 text-[12.5px] text-stage-ink">
        {session ? <SessionBar session={session} share={share} /> : <RequestBar share={share} policyOff={policy === 'disabled'} />}
      </div>
      {!session && ended ? <EndedCard ended={ended} canAsk={policy !== 'disabled' && !!share?.availability.can_request} /> : null}
    </>
  );
}

/**
 * How a control session ended, and what happens next (RC07).
 *
 * The screen is still shared when control ends — that is the whole point of
 * the distinction — so the card says so, with how long the session lasted.
 *
 * It has one button. Dismissing it reveals the Request control bar that was
 * always underneath, which is the only place that asks: it owns the reason
 * and code prompts a company's policy may require, and a second ask path here
 * would be a second set of those to keep in step. The card says where to go
 * rather than becoming another way to go there.
 */
function EndedCard({ ended, canAsk }: { ended: NonNullable<typeof remote.ended>; canAsk: boolean }) {
  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-[4] flex items-center justify-center bg-[rgba(7,12,26,.6)] p-6">
      <div className="max-w-md rounded-[12px] bg-[rgba(15,27,61,.95)] px-5 py-4 text-center shadow-xl">
        <b className="text-[15px] text-white">Remote control ended by {ended.by}</b>
        <p className="mt-1.5 text-[12.5px] text-navy-ink">
          {ended.reason} {ended.sharer}&rsquo;s screen is still shared in the meeting.
          {ended.length ? ` This session lasted ${ended.length}.` : ''}
          {canAsk ? ' You can ask for control again from the bar above the screen.' : ''}
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => remote.clearEnded()}
          className="mt-3 h-9 rounded-[9px] bg-brand-soft px-3.5 text-[13px] font-bold text-white hover:bg-brand-soft"
        >
          Back to the meeting
        </button>
      </div>
    </div>
  );
}

// ── asking ─────────────────────────────────────────────────────────────────

type Ask = { kind: 'first' | 'reason' | 'code'; message: string | null; resolve: (value: string | null) => void };

function RequestBar({ share, policyOff }: { share: Share | undefined; policyOff: boolean }) {
  const [dialog, setDialog] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Ask | null>(null);
  useEffect(() => {
    pending.current = dialog;
  }, [dialog]);
  // Gone with the share: an open question is answered "no".
  useEffect(() => () => pending.current?.resolve(null), []);

  const waiting = share && remote.waiting?.shareId === share.id ? remote.waiting : null;
  if (waiting) return <WaitingNote waiting={waiting} />;
  const offer = offerFor(share, policyOff);
  if (!share || offer.kind === 'none') return null;

  const promptFor = (kind: 'reason' | 'code') => (message: string) => new Promise<string | null>((resolve) => setDialog({ kind, message, resolve }));
  const prompts: Prompts = { reason: promptFor('reason'), code: promptFor('code') };
  const go = async (reason: string) => {
    setBusy(true);
    try {
      await remote.ask(share, reason, prompts);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {offer.kind === 'request' ? (
        <button
          type="button"
          disabled={busy}
          title={offer.hint ?? undefined}
          onClick={() => setDialog({ kind: 'first', message: null, resolve: (reason) => reason !== null && void go(reason) })}
          className="no-drag flex h-8 items-center gap-1.5 rounded-[8px] bg-brand-soft px-3 font-bold text-white shadow-lg hover:bg-blue disabled:opacity-50"
        >
          <Icon name={busy ? 'spinner' : 'monitor'} size={15} className={busy ? 'animate-spin-slow' : undefined} />
          Request control
        </button>
      ) : (
        <div role="note" data-testid="control-reason" className="rounded-[10px] bg-[rgba(11,18,38,.85)] px-3 py-2 text-[12px] text-navy-ink shadow-lg">
          {offer.kind === 'reason' && offer.notes.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {offer.notes.map((n) => (
                <li key={n.text} className="flex items-center gap-2">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', n.ok ? 'bg-green-bright' : 'bg-amber')} />
                  {n.text}
                </li>
              ))}
            </ul>
          ) : (
            offer.text
          )}
        </div>
      )}
      {dialog ? <AskDialog ask={dialog} name={share.name} onDone={(v) => (setDialog(null), dialog.resolve(v))} /> : null}
    </>
  );
}

function WaitingNote({ waiting }: { waiting: Waiting }) {
  const now = useNow(500);
  const left = Math.max(0, Math.ceil((waiting.until - now) / 1000));
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-[10px] bg-[rgba(15,27,61,.92)] py-1.5 pr-1.5 pl-3 shadow-lg">
      <Icon name="spinner" size={15} className="shrink-0 animate-spin-slow" />
      <span>
        <b>Request sent.</b> Waiting for {waiting.name} to allow control… <span className="text-stage-accent">({left} s)</span>
      </span>
      <button type="button" onClick={() => void remote.cancel()} className="no-drag h-7 rounded-[7px] bg-white px-2.5 text-[12px] font-bold text-ink">
        Cancel
      </button>
    </div>
  );
}

/** The reason (optional unless policy asks for one) and the authenticator code, when the server wants them. */
function AskDialog({ ask, name, onDone }: { ask: Ask; name: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState('');
  const required = ask.kind !== 'first';
  const title = ask.kind === 'first' ? `Ask ${name} for control` : ask.kind === 'reason' ? 'Why do you need control?' : "Confirm it's you";
  const submit = () => {
    const v = value.trim();
    if (required && !v) return;
    onDone(v);
  };
  return createPortal(
    <Modal
      title={title}
      onClose={() => onDone(null)}
      width={420}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" disabled={required && !value.trim()} onClick={submit}>
            {ask.kind === 'code' ? 'Confirm' : 'Ask'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 text-[13px] text-ink-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p>{ask.message ?? `${name} chooses whether to allow it, what you may use and for how long. Only they can allow it.`}</p>
        {ask.kind === 'code' ? (
          <TextField label="Authenticator code" value={value} onChange={(e) => setValue(e.target.value)} placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" autoFocus />
        ) : (
          <TextField label={required ? 'Reason' : 'Reason (optional)'} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Reinstall the printer driver" maxLength={500} autoFocus />
        )}
      </form>
    </Modal>,
    document.body,
  );
}

// ── controlling ────────────────────────────────────────────────────────────

function SessionBar({ session, share }: { session: ControlSession; share: Share | undefined }) {
  const [keysOpen, setKeysOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const active = remote.active;
  const paused = session.status === 'CONTROL_PAUSED';
  const platform = share?.device?.platform ?? null;

  useEffect(() => {
    if (!keysOpen) return;
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setKeysOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [keysOpen]);

  return (
    <div className="no-drag flex flex-wrap items-center gap-1.5 rounded-[12px] border border-white/10 bg-[rgba(15,27,61,.92)] p-1.5 pl-3 shadow-[0_12px_32px_rgba(0,0,0,.45)] backdrop-blur">
      <span className="flex items-center gap-1.5 font-semibold">
        <span className={cx('h-2 w-2 rounded-full', active ? 'bg-green-bright' : paused ? 'bg-amber' : 'bg-muted')} />
        {active ? 'Control active' : paused ? 'Paused' : 'Connecting'}
      </span>
      <span className="text-stage-accent">
        · {session.sharer.name}&apos;s {platformName(platform)}
        {remote.rtt !== null ? ` · ${remote.rtt} ms` : ''}
      </span>
      {session.caps.keyboard ? (
        <div ref={menu} className="relative">
          <button type="button" aria-haspopup="menu" aria-expanded={keysOpen} onClick={() => setKeysOpen((v) => !v)} className={cx('flex h-7 items-center gap-1 rounded-[8px] px-2.5 font-semibold hover:bg-white/10', keysOpen && 'bg-white/15')}>
            <Icon name="keyboard" size={14} />
            Special keys
            <Icon name="chevron-down" size={13} />
          </button>
          {keysOpen ? <KeysMenu sharer={session.sharer.name} platform={platform} active={active} onDone={() => setKeysOpen(false)} /> : null}
        </div>
      ) : null}
      {session.caps.file_transfer ? (
        <button type="button" onClick={() => void remote.sendFiles().catch((e) => toast('error', errorMessage(e)))} className="flex h-7 items-center gap-1 rounded-[8px] px-2.5 font-semibold hover:bg-white/10">
          <Icon name="paperclip" size={14} />
          Send a file
        </button>
      ) : null}
      <button type="button" onClick={() => void remote.release()} className="h-7 rounded-[8px] bg-red px-2.5 font-bold text-white hover:bg-red">
        Release control
      </button>
      {remote.offers.length ? <Offers sharer={session.sharer.name} /> : null}
    </div>
  );
}

/** Files the sharer offered this computer (RC06): accept (a program only once confirmed) or decline. */
function Offers({ sharer }: { sharer: string }) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const accept = async (f: RemoteFile, confirmExecutable: boolean) => {
    try {
      const done = await remote.acceptFile(f, confirmExecutable);
      setConfirming(done ? null : f.id);
      if (done) toast('success', `Downloading ${f.name}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <ul className="flex w-full flex-col gap-1 border-t border-white/10 pt-1.5" aria-label={`Files ${sharer} offered you`}>
      {remote.offers.map((f) => (
        <li key={f.id} className="flex items-center gap-2 pl-1">
          <span className="min-w-0 flex-1 truncate">
            <b>{sharer}</b> sends <b title={f.name}>{f.name}</b> · {bytes(f.size)}
            {confirming === f.id ? ' — a program: accept only if you trust it' : f.executable ? ' · a program' : ''}
          </span>
          <button type="button" onClick={() => void accept(f, confirming === f.id)} className="h-7 rounded-[8px] bg-white px-2.5 font-bold text-ink">
            {confirming === f.id ? 'Accept the program' : 'Accept'}
          </button>
          <button type="button" onClick={() => void remote.declineFile(f)} className="h-7 rounded-[8px] px-2.5 font-semibold hover:bg-white/10">
            Decline
          </button>
        </li>
      ))}
    </ul>
  );
}

function KeysMenu({ sharer, platform, active, onDone }: { sharer: string; platform: string | null; active: boolean; onDone: () => void }) {
  const keys = specialKeys(platform);
  return (
    <div role="menu" className="absolute top-[calc(100%+6px)] left-0 z-[50] w-[300px] rounded-[12px] border border-white/10 bg-navy-2 p-1.5 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.5)]">
      <span className="block px-2.5 pt-1.5 pb-1 text-[11px] font-bold tracking-[0.4px] text-stage-accent uppercase">
        Send to {sharer}&apos;s {platformName(platform)}
      </span>
      {keys.available.map((k) => (
        <button key={k.combo} type="button" role="menuitem" disabled={!active} onClick={() => (onDone(), remote.special(k.combo))} className="flex min-h-8 w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left hover:bg-white/10 disabled:opacity-50">
          <span>{k.label}</span>
          <span className="font-mono text-[11.5px] text-stage-accent">{k.hint}</span>
        </button>
      ))}
      <div className="mt-1 flex flex-col gap-1 border-t border-white/10 px-2.5 pt-2 pb-1 text-[11.5px] text-stage-accent">
        {keys.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        <label className="flex items-center gap-2 pt-1 text-stage-ink">
          <Checkbox checked={remote.textMode} onChange={(e) => remote.setTextMode(e.target.checked)} />
          Type as text (for Sinhala, Tamil, Arabic and other layouts)
        </label>
        <p>Keyboard: {remote.textMode ? 'text' : "physical keys · the sharer's layout decides"}</p>
      </div>
    </div>
  );
}

/**
 * The shared picture as an input surface. Coordinates are taken on the
 * picture itself (the video is letterboxed), keys only while this has
 * focus. While control flows, moving the mouse here doesn't bring the call
 * controls back over the bottom of their screen.
 */
function ControlSurface({ session }: { session: ControlSession }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = remote.active;
  const name = session.sharer.name;

  const point = (e: { clientX: number; clientY: number }, clamp = false) => {
    const v = ref.current?.parentElement?.querySelector('video');
    if (!v) return null;
    return pointOn(e.clientX, e.clientY, v.getBoundingClientRect(), v.videoWidth, v.videoHeight, clamp);
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="application"
      aria-label={`${name}'s screen. Click to control it; your keys go to their computer.`}
      data-testid="control-surface"
      className={cx('absolute inset-0 z-[2] outline-none', active && 'cursor-none focus:shadow-[inset_0_0_0_2px_rgba(61,214,140,.55)]')}
      onPointerMove={(e) => {
        if (!remote.active) return;
        e.stopPropagation();
        const p = point(e);
        if (p) remote.move(p);
      }}
      onPointerDown={(e) => {
        ref.current?.focus();
        if (!remote.active) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const p = point(e);
        if (p) remote.button(p, buttonName(e.button), true);
      }}
      onPointerUp={(e) => {
        if (!remote.active) return;
        const p = point(e, true);
        if (p) remote.button(p, buttonName(e.button), false);
      }}
      onWheel={(e) => {
        if (!remote.active) return;
        const p = point(e);
        if (!p) return;
        const d = wheelDelta(e);
        remote.wheel(p, d.dx, d.dy);
      }}
      onContextMenu={(e) => {
        if (remote.active) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (!remote.key(e, true)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyUp={(e) => {
        if (!remote.key(e, false)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onBlur={() => remote.releaseHeld()}
    >
      {!active ? <StateCard session={session} /> : null}
    </div>
  );
}

/** RC07: what the controller sees when control is not flowing, and why. */
function StateCard({ session }: { session: ControlSession }) {
  const sharer = session.sharer.name;
  const [title, body] = remote.problem
    ? ["Control can't start", remote.problem]
    : session.status === 'CONTROL_PAUSED' && session.grant_waiting
      ? ['Resuming control…', `${sharer} resumed control, so the key was changed. Both computers are checking the new grant; nothing is sent until they have.`]
      : session.status === 'CONTROL_PAUSED'
        ? [session.pause_reason === 'protected_app' ? 'Protected screen' : 'Control paused', pauseText(session.pause_reason, sharer)]
        : [`Connecting to ${sharer}'s computer…`, 'Both computers are checking the grant. Nothing is sent until they have.'];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(7,12,26,.6)] p-6" role="status" aria-live="polite">
      <div className="max-w-md rounded-[12px] bg-[rgba(15,27,61,.95)] px-5 py-4 text-center shadow-xl">
        <b className="text-[15px] text-white">{title}</b>
        <p className="mt-1.5 text-[12.5px] text-navy-ink">{body}</p>
      </div>
    </div>
  );
}
