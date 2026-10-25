import { useState } from 'react';
import { createStore, useStore } from '../../core/store';
import { Modal } from '../../components/ui';
import { refusal } from '../finance/api';
import { isStepUpRequired, stepUp } from './api';
import { Note, btn, btnPrimary } from './parts';

/**
 * Step-up (Cheque 1.2, `POST /api/cheque/step-up`): with the company's "step up for high-risk actions" on, a reprint
 * request, a cancel or void after printing and the CFO-band approval answer 428 STEP_UP_REQUIRED until the request
 * carries a fresh single-use token. This asks the person for their password or authenticator code, gets the token,
 * and the action is sent once more with it. The password goes to WorkSuite only and is not kept.
 */
interface Pending { why: string; resolve: (token: string | null) => void }
const store = createStore<{ pending: Pending | null }>({ pending: null });

/** Ask for a step-up; null when the person cancels. */
export function askStepUp(why: string): Promise<string | null> {
  return new Promise((resolve) => {
    store.get().pending?.resolve(null);
    store.set({ pending: { why, resolve } });
  });
}

/** The answer to the step-up being asked: the token, or null when the person cancelled. */
export function answerStepUp(token: string | null): void {
  const p = store.get().pending;
  store.set({ pending: null });
  p?.resolve(token);
}

/** Run an action; if the server asks for a step-up, ask the person and run it once more with the token. */
export async function withStepUp<T>(why: string, run: (token?: string) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isStepUpRequired(e)) throw e;
    const token = await askStepUp(why);
    if (!token) throw e;
    return run(token);
  }
}

/** Mounted once in the Cheque Manager shell. */
export function StepUpHost() {
  const pending = useStore(store, (s) => s.pending);
  if (!pending) return null;
  return <StepUpDialog key={pending.why} pending={pending} />;
}

function StepUpDialog({ pending }: { pending: Pending }) {
  const [how, setHow] = useState<'password' | 'code'>('password');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = (token: string | null) => answerStepUp(token);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await stepUp(how === 'password' ? { current_password: value } : { totp_code: value.replace(/\s/g, '') });
      done(r.token);
    } catch (e) {
      setErr(refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const ok = how === 'password' ? value.length > 0 : /^\d{6,8}$/.test(value.replace(/\s/g, ''));
  return (
    <Modal
      title="Confirm it is you"
      onClose={() => done(null)}
      width={440}
      footer={
        <>
          <button type="button" className={btn} onClick={() => done(null)}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!ok || busy} onClick={() => void go()}>{busy ? 'Checking…' : 'Confirm'}</button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">{`${pending.why} needs a fresh check of who is at this computer. WorkSuite gives a one-time pass for five minutes.`}</p>
      <div role="radiogroup" aria-label="How to confirm" className="mt-3 inline-flex overflow-hidden rounded-[7px] border border-line text-[12px] font-semibold">
        {(['password', 'code'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={how === k} onClick={() => (setHow(k), setValue(''))} className={how === k ? 'bg-primary px-2.5 py-1 text-white' : 'bg-surface px-2.5 py-1 text-ink-2 hover:bg-subtle'}>
            {k === 'password' ? 'Password' : 'Authenticator code'}
          </button>
        ))}
      </div>
      <input
        autoFocus
        aria-label={how === 'password' ? 'Your password' : 'Authenticator code'}
        type={how === 'password' ? 'password' : 'text'}
        inputMode={how === 'code' ? 'numeric' : undefined}
        autoComplete={how === 'password' ? 'current-password' : 'one-time-code'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && ok && !busy) void go(); }}
        className="mt-3 h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary"
      />
      {err ? <div className="mt-2"><Note tone="err">{err}</Note></div> : null}
    </Modal>
  );
}
