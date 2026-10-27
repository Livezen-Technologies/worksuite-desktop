import qrcode from 'qrcode-generator';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { btn, btnPrimary } from '../hr/parts';
import { Note } from './parts';

/**
 * Turn on two-factor authentication (AcctTwoFactor): scan the key into an
 * authenticator app, prove it with a code, then keep the backup codes. The
 * design opens with "confirm your password"; the server's setup does not ask
 * for one (being signed in is its check, as on the web), so that step is not
 * shown — a password box that nothing checks would only look like security.
 */

/** A QR code as SVG squares, drawn here: the key never leaves this computer. */
export function Qr({ text, size = 188 }: { text: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push([c, r]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="QR code for your authenticator app" className="shrink-0 rounded-[12px] bg-white shadow-[0_0_0_1px_var(--color-line)]">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#151A2D" />
      ))}
    </svg>
  );
}

/** Six boxes for a six-digit code; typing or pasting moves along. */
export function CodeBoxes({ value, onChange, onDone, disabled }: { value: string; onChange: (v: string) => void; onDone?: (code: string) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const set = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length > 1) {
      const next = (value.slice(0, i) + digits).slice(0, 6);
      onChange(next);
      refs.current[Math.min(5, next.length)]?.focus();
      if (next.length === 6) onDone?.(next);
      return;
    }
    const chars = value.padEnd(6, ' ').split('');
    chars[i] = digits || ' ';
    const next = chars.join('').replace(/\s+$/, '');
    onChange(next);
    if (digits && i < 5) refs.current[i + 1]?.focus();
    if (next.length === 6 && digits) onDone?.(next);
  };
  return (
    <div className="flex items-center gap-2">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="flex items-center gap-2">
          {i === 3 ? <span className="text-ink-3">–</span> : null}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`Digit ${i + 1}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={disabled}
            value={value[i]?.trim() ?? ''}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !value[i]?.trim() && i > 0) refs.current[i - 1]?.focus();
              if (e.key === 'Enter' && value.length === 6) onDone?.(value);
            }}
            className="h-12 w-10 rounded-[10px] border border-line bg-surface text-center font-mono text-[20px] font-semibold text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--color-selection)]"
          />
        </span>
      ))}
    </div>
  );
}

/** The ten codes, with Save and Copy. Each works once. */
export function BackupCodes({ codes }: { codes: string[] }) {
  const text = `WorkSuite backup codes\nEach code works once. Keep them somewhere safe, away from your phone.\n\n${codes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-[12px] bg-well px-5 py-4 font-mono text-[14px] font-semibold text-ink select-text">
        {codes.map((c, i) => (
          <span key={c}>
            <span className="mr-2 text-ink-3">{i + 1}.</span>
            {c}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => void call('files:saveText', { name: 'WorkSuite backup codes.txt', text }).then((p) => p && toast('success', 'Backup codes saved.')).catch((e) => toast('error', errorMessage(e)))}>
          <Icon name="download" size={15} /> Save as a file
        </button>
        <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(codes.join('\n')).then(() => toast('success', 'Backup codes copied.'))}>
          <Icon name="copy" size={15} /> Copy
        </button>
      </div>
    </div>
  );
}

export function TwoFactorSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiPost<{ secret: string; uri: string }>('/api/auth/mfa/setup')
      .then((r) => live && setSetup(r))
      .catch((e) => live && setFailed(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  // The code as typed: a paste finishes before `code` is updated, so it is passed in.
  const verify = async (typed = code) => {
    if (typed.length !== 6 || busy) return;
    setBusy(true);
    try {
      const r = await apiPost<{ backup_codes: string[] }>('/api/auth/mfa/confirm', { code: typed });
      setCodes(r.backup_codes ?? []);
      setStep(2);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const key = setup?.secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() ?? '';
  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,27,61,.45)] p-6" onMouseDown={(e) => e.target === e.currentTarget && step === 1 && onClose()}>
      <section role="dialog" aria-modal="true" aria-label="Turn on two-factor authentication" className="animate-in flex max-h-full w-[700px] max-w-full flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.3)]">
        <div className="flex items-start px-6 pt-5">
          <div className="flex-1">
            <h2 className="m-0 text-[18px] font-bold text-ink">Turn on two-factor authentication</h2>
            <span className="text-[12.5px] text-ink-3">Step {step} of 2</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>
        <ol aria-label="Two-factor" className="m-0 grid list-none grid-cols-2 gap-3 px-6 pt-4 pb-1">
          {['Scan and verify', 'Save backup codes'].map((l, i) => (
            <li key={l} className="flex flex-col gap-1.5">
              <span className={cx('h-1 rounded-full', i < step ? 'bg-primary' : 'bg-line')} />
              <span className={cx('text-[12px]', i + 1 === step ? 'font-bold text-ink' : i < step ? 'font-semibold text-ink' : 'font-semibold text-ink-3')}>{l}</span>
            </li>
          ))}
        </ol>
        <div className="min-h-0 overflow-y-auto px-6 py-5 scroll-thin">
          {step === 1 ? (
            failed ? (
              <Note tone="red">{failed}</Note>
            ) : !setup ? (
              <div className="py-10 text-center text-[12.5px] text-ink-3">Making your key…</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex gap-6">
                  <Qr text={setup.uri} />
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div>
                      <b className="text-[14px] text-ink">Scan this with your authenticator app</b>
                      <p className="m-0 text-[12.5px] text-ink-3">Google Authenticator, Microsoft Authenticator, 1Password and the like. Then enter the six-digit code it shows.</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[12px] font-semibold text-ink-2">Can’t scan it? Enter this key</span>
                      <div className="flex items-center gap-2 rounded-[10px] bg-well px-3 py-2">
                        <span data-testid="mfa-secret" className="min-w-0 flex-1 font-mono text-[13px] font-semibold tracking-[.5px] break-all text-ink select-text">
                          {key}
                        </span>
                        <button type="button" aria-label="Copy key" title="Copy key" onClick={() => void navigator.clipboard.writeText(setup.secret).then(() => toast('success', 'Key copied.'))} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
                          <Icon name="copy" size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12px] font-semibold text-ink-2">Six-digit code</span>
                      <CodeBoxes value={code} onChange={setCode} onDone={(c) => void verify(c)} disabled={busy} />
                    </div>
                  </div>
                </div>
                <Note tone="amber">Keep your phone with you. Losing your authenticator means using a backup code to get back in.</Note>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <b className="text-[14px] text-ink">Save your backup codes</b>
                <p className="m-0 text-[12.5px] text-ink-3">Each code works once. Keep them somewhere safe, away from your phone. They are not shown again.</p>
              </div>
              <BackupCodes codes={codes} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-rail px-6 py-3.5 dark:bg-well">
          {step === 1 ? (
            <>
              <button type="button" className={btn} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={!setup || code.length !== 6 || busy} onClick={() => void verify()}>
                {busy ? 'Checking…' : 'Verify and continue'}
              </button>
            </>
          ) : (
            <button type="button" className={btnPrimary} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
