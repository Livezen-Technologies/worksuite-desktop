import { useEffect, useState } from 'react';
import type { RemoteControlConsent, RemoteControlView } from '@shared/types';
import { call, errorMessage, isMac, on } from '../core/bridge';
import { apiPost } from '../core/api';
import { bytes } from '../core/time';
import { Button, Spinner, cx } from '../components/ui';
import { Select } from '../components/Select';

/**
 * Remote control's own windows, which the main process opens above
 * everything and leaves out of screen capture (WS-MEET-ENH-01):
 *
 *   #/rc/consent   RC03 — somebody asks to control this computer
 *   #/rc/indicator RC04 — the bar that is up for as long as control lasts
 *   #/rc/pointer   RC-INP-04 — the controller's name beside the pointer, while they move it
 *
 * Allowing and resuming count only when clicked with this computer's own
 * mouse or keyboard: the main process checks that, not this page.
 */
export function RemoteControlWindow({ hash }: { hash: string }) {
  return hash.startsWith('#/rc/consent') ? <ConsentWindow /> : hash.startsWith('#/rc/pointer') ? <PointerTagWindow /> : <IndicatorWindow />;
}

/** The controller's name, in a pill beside the pointer. The window is see-through and clicks pass through it. */
function PointerTagWindow() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const take = (v: RemoteControlView) => setName(v.session?.controller ?? null);
    void call('rc:state').then(take, () => undefined);
    return on<RemoteControlView>('rc:changed', take);
  }, []);
  if (!name) return null;
  return (
    <div className="flex h-full items-start">
      <span className="max-w-full truncate rounded-full bg-[#C8321E] px-2.5 py-1 text-[12px] font-bold text-white shadow-md">{name}</span>
    </div>
  );
}

/** "Ctrl+Alt+Shift+Esc", the way this keyboard writes it. */
export function chordLabel(chord: string, mac = isMac): string {
  if (!mac) return chord;
  const sym: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘', Esc: 'esc' };
  return chord.split('+').map((p) => sym[p] ?? p).join('');
}

/** "4:05" — minutes and seconds. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DURATIONS: Array<{ value: string; label: string }> = [
  { value: 'until_stopped', label: 'Until I stop it' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: 'meeting_end', label: 'Until the meeting ends' },
];

function ConsentWindow() {
  const [c, setC] = useState<RemoteControlConsent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [mouse, setMouse] = useState(true);
  const [keyboard, setKeyboard] = useState(true);
  const [clipboard, setClipboard] = useState(false);
  const [files, setFiles] = useState(false);
  const [duration, setDuration] = useState('until_stopped');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [chord, setChord] = useState('Ctrl+Alt+Shift+Esc');

  useEffect(() => {
    void call('rc:consent').then(
      (x) => {
        setC(x);
        setLeft(x.expiresIn);
      },
      (e) => setError(errorMessage(e)),
    );
    void call('rc:state').then((v) => setChord(v.emergencyChord), () => undefined);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  async function answer(decision: 'allow' | 'allow_5' | 'deny' | 'transfer') {
    setBusy(true);
    setError(null);
    try {
      if (code !== null && code.trim()) {
        await apiPost('/api/meet/control/step-up', { code: code.trim() });
        setCode(null);
      }
      const r = await call('rc:answer', {
        decision,
        caps: { mouse, keyboard, clipboard: clipboard ? (c?.clipboard === 'text_files' ? 'text_files' : 'text') : 'off', file_transfer: files, monitor_switch: false },
        duration: decision === 'allow_5' ? '5' : (duration as 'until_stopped'),
      });
      if (r.stepUp) {
        setCode('');
        setError(r.message ?? 'Enter the code from your authenticator app first.');
        return;
      }
      window.close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!c) {
    return <div className="flex h-full items-center justify-center bg-surface p-6 text-center text-[13px] text-ink-2">{error ?? <Spinner />}</div>;
  }
  const handover = c.kind === 'handover';
  return (
    <div className="flex h-full flex-col bg-surface text-ink" role="alertdialog" aria-labelledby="rc-title" aria-describedby="rc-what">
      <div className="drag flex items-center gap-2 bg-[#B42318] px-4 py-2.5 text-[12.5px] font-bold text-white">
        <span className="h-2 w-2 rounded-full bg-white" /> Remote control request
        <span className="ml-auto font-semibold tabular-nums" aria-label={`${left} seconds left to answer`}>{mmss(left * 1000)}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5 text-[13px]">
        <h1 id="rc-title" className="text-[17px] font-bold leading-snug">
          {handover ? `${c.requester} wants to take over control of your computer` : `${c.requester} wants to control your computer`}
        </h1>
        <p id="rc-what" className="text-ink-2">
          {handover && c.current ? `${c.current} has control now and will lose it. ` : ''}
          They would use your mouse and keyboard on <b className="text-ink">{c.share}</b>, as you see it. You can stop it at any moment.
        </p>
        {c.reason ? <p className="rounded-[9px] bg-subtle px-3 py-2 text-ink-2">“{c.reason}”</p> : null}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-semibold">What they can do</legend>
          <Check checked={mouse} onChange={setMouse} label="Use the mouse" />
          <Check checked={keyboard} onChange={setKeyboard} label="Use the keyboard" />
          {c.clipboard !== 'off' ? <Check checked={clipboard} onChange={setClipboard} label="Put text on my clipboard" /> : null}
          {c.fileTransfer ? <Check checked={files} onChange={setFiles} label="Send me files (I accept each one)" /> : null}
        </fieldset>
        <label className="flex items-center gap-2">
          <span className="font-semibold">For</span>
          <Select value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 flex-1 rounded-[8px] border border-line bg-surface px-2">
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </Select>
        </label>
        {code !== null ? (
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Code from your authenticator app</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="h-9 rounded-[8px] border border-line bg-surface px-2 tracking-widest" autoFocus />
          </label>
        ) : null}
        <p className="rounded-[9px] border border-line px-3 py-2 text-[12px] text-ink-2">
          To stop control at once, press <kbd className="rounded bg-subtle px-1 font-mono text-[11.5px]">{chordLabel(chord)}</kbd>, or Stop on the bar at the top of your screen. Password managers and system prompts pause it by themselves.
        </p>
        {c.locked ? <p className="text-[12.5px] text-warning">Unlock WorkSuite to allow control. You can deny it now.</p> : null}
        {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button onClick={() => void answer('deny')} disabled={busy}>Deny</Button>
        {!handover ? <Button onClick={() => void answer('allow_5')} disabled={busy || c.locked || (!mouse && !keyboard)}>Allow for 5 minutes</Button> : null}
        <Button variant="primary" onClick={() => void answer(handover ? 'transfer' : 'allow')} disabled={busy || c.locked || (!mouse && !keyboard)}>
          {handover ? 'Hand over control' : 'Allow control'}
        </Button>
      </div>
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-primary)]" />
      {label}
    </label>
  );
}

function IndicatorWindow() {
  const [v, setV] = useState<RemoteControlView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  /** An offered program, waiting for "yes, I want this program". */
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    void call('rc:state').then(setV, () => undefined);
    const off = on<RemoteControlView>('rc:changed', setV);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const s = v?.session ?? null;
  if (!v || !s) return <div className="h-full bg-navy" />;
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const paused = s.status === 'CONTROL_PAUSED';
  const answerFile = async (id: number, accept: boolean, confirmExecutable = false) => {
    setError(null);
    try {
      const r = await call('rc:fileAnswer', { id, accept, confirmExecutable });
      if (r.confirmExecutable) setConfirming(id);
      else setConfirming(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const text = error
    ? error
    : paused
      ? `${s.controller} — ${s.pauseText ?? 'Control is paused.'}`
      : s.status === 'CONTROL_APPROVED'
        ? `${s.controller} is connecting…`
        : s.waiting === 'local'
          ? `You're using the mouse — ${s.controller} waits`
          : s.waiting === 'window'
            ? `${s.controller}'s typing waits until the shared window is in front`
            : `${s.controller} is controlling your screen · ${s.capsLabel}`;
  return (
    <div className={cx('flex h-full flex-col text-[12.5px] text-white', paused ? 'bg-[#6B4E0B]' : 'bg-[#B42318]')}>
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-3" role="status" aria-live="polite">
        <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full bg-white', !paused && 'animate-pulse')} />
        <span className="min-w-0 flex-1 truncate font-semibold" title={text}>{text}</span>
        {s.since && !paused ? <span className="tabular-nums opacity-80">{mmss(now - s.since)}</span> : null}
        {v.canSendFiles ? (
          <button type="button" onClick={() => void act(() => call('rc:sendFile', { sessionId: s.id }))} className="h-7 rounded-[7px] bg-white/20 px-2.5 font-bold hover:bg-white/30">Send a file</button>
        ) : null}
        {paused ? (
          <button type="button" onClick={() => void act(() => call('rc:resume', { sessionId: s.id }))} className="h-7 rounded-[7px] bg-white px-2.5 font-bold text-[#151A2D]">Resume</button>
        ) : s.status === 'CONTROL_ACTIVE' ? (
          <button type="button" onClick={() => void act(() => call('rc:pause', { sessionId: s.id }))} className="h-7 rounded-[7px] bg-white/20 px-2.5 font-bold hover:bg-white/30">Pause</button>
        ) : null}
        <button type="button" onClick={() => void act(() => call('rc:stop', { sessionId: s.id }))} className="h-7 rounded-[7px] bg-white px-2.5 font-bold text-[#B42318]" title={`Or press ${chordLabel(v.emergencyChord)}`}>Stop</button>
      </div>
      {v.offers.length ? (
        <ul className="flex flex-col border-t border-white/20 bg-black/15" aria-label="Files offered to you">
          {v.offers.slice(0, 3).map((o) => (
            <li key={o.id} className="flex h-11 items-center gap-2 px-3">
              <span className="min-w-0 flex-1 truncate">
                <b>{o.from}</b> sends <b title={o.name}>{o.name}</b> · {bytes(o.size)}
                {confirming === o.id ? ' — a program: accept only if you trust it' : o.executable ? ' · a program' : ''}
              </span>
              {confirming === o.id ? (
                <button type="button" onClick={() => void answerFile(o.id, true, true)} className="h-7 rounded-[7px] bg-white px-2.5 font-bold text-[#B42318]">Accept the program</button>
              ) : (
                <button type="button" onClick={() => void answerFile(o.id, true)} className="h-7 rounded-[7px] bg-white px-2.5 font-bold text-[#151A2D]">Accept</button>
              )}
              <button type="button" onClick={() => void answerFile(o.id, false)} className="h-7 rounded-[7px] bg-white/20 px-2.5 font-bold hover:bg-white/30">Decline</button>
            </li>
          ))}
          {v.offers.length > 3 ? <li className="h-6 px-3 text-[11.5px] opacity-80">and {v.offers.length - 3} more after these</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
