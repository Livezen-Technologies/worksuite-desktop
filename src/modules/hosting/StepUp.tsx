import { useState } from 'react';
import { Modal } from '../../components/ui';
import { text } from '../../core/i18n';
import { createStore, useStore } from '../../core/store';
import { needsStepUp, stepUpMethods, type StepUpProof } from './api';
import { Btn, Note, input } from './parts';

/**
 * "Confirm it's you" (HDM-SEC-05). Renew, the transfer code, register and power off are sent as they are first; with
 * no confirmation in the last ten minutes the server answers 428 `errors.step_up` (ReAuth::require), and the SAME
 * request is sent once more with the person's password or authenticator code in its body. The server remembers a
 * success for ten minutes; nothing is kept here. A wrong password is the server's 428/422 again, shown in the dialog.
 */
interface Pending {
  why: string;
  methods: Array<'password' | 'totp'>;
  error: string | null;
  resolve: (proof: StepUpProof | null) => void;
}
const store = createStore<{ pending: Pending | null }>({ pending: null });

/** Ask for the proof; null when the person cancels. */
export function askStepUp(why: string, methods: Array<'password' | 'totp'> = ['password'], error: string | null = null): Promise<StepUpProof | null> {
  return new Promise((resolve) => {
    store.get().pending?.resolve(null);
    store.set({ pending: { why, methods, error, resolve } });
  });
}

export function answerStepUp(proof: StepUpProof | null): void {
  const p = store.get().pending;
  store.set({ pending: null });
  p?.resolve(proof);
}

/**
 * Run an action; while the server asks for a step-up, ask the person and send it again with the proof. A cancelled
 * dialog throws the server's refusal, so the caller's error handling says what did not happen.
 */
export async function withStepUp<T>(why: string, run: (proof?: StepUpProof) => Promise<T>): Promise<T> {
  let proof: StepUpProof | undefined;
  let error: string | null = null;
  for (let tries = 0; ; tries++) {
    try {
      return await run(proof);
    } catch (e) {
      if (!needsStepUp(e) || tries >= 3) throw e;
      if (proof) error = (e as Error).message || text('That did not confirm it is you. Try again.');
      const p = await askStepUp(why, stepUpMethods(e), error);
      if (!p) throw e;
      proof = p;
    }
  }
}

/** Mounted once in the Hosting shell. */
export function StepUpHost() {
  const pending = useStore(store, (s) => s.pending);
  if (!pending) return null;
  return <StepUpDialog key={`${pending.why}:${pending.error ?? ''}`} pending={pending} />;
}

function StepUpDialog({ pending }: { pending: Pending }) {
  const [how, setHow] = useState<'password' | 'totp'>(pending.methods[0] ?? 'password');
  const [value, setValue] = useState('');
  const code = value.replace(/\s/g, '');
  const ok = how === 'password' ? value.length > 0 : /^\d{6,8}$/.test(code);
  const go = () => ok && answerStepUp(how === 'password' ? { current_password: value } : { totp_code: code });
  return (
    <Modal
      title={text('Confirm it’s you')}
      onClose={() => answerStepUp(null)}
      width={440}
      footer={
        <>
          <Btn onClick={() => answerStepUp(null)}>Cancel</Btn>
          <Btn primary disabled={!ok} onClick={go}>
            Confirm
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">{text('{what} needs you to confirm it is you. WorkSuite remembers it for ten minutes.', { what: pending.why })}</p>
        {pending.methods.length > 1 ? (
          <div role="radiogroup" aria-label={text('How to confirm')} className="inline-flex w-fit overflow-hidden rounded-[7px] border border-line text-[12px] font-semibold">
            {pending.methods.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={how === k} onClick={() => (setHow(k), setValue(''))} className={how === k ? 'bg-primary px-2.5 py-1 text-white' : 'bg-surface px-2.5 py-1 text-ink-2 hover:bg-subtle'}>
                {k === 'password' ? text('Password') : text('Authenticator code')}
              </button>
            ))}
          </div>
        ) : null}
        <input
          autoFocus
          aria-label={how === 'password' ? text('Your password') : text('Authenticator code')}
          type={how === 'password' ? 'password' : 'text'}
          inputMode={how === 'totp' ? 'numeric' : undefined}
          autoComplete={how === 'password' ? 'current-password' : 'one-time-code'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go();
          }}
          className={input}
        />
        {pending.error ? <Note tone="error">{pending.error}</Note> : null}
      </div>
    </Modal>
  );
}
