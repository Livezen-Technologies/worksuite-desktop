import { useEffect, useId, useState } from 'react';
import { waitingSteps, type ConnectRun } from '@shared/discovery';
import { SETUP_LINK_PREFIX, type SetupLinkPayload } from '@shared/trusted-config';
import { app, startAdding } from '../../core/app-state';
import { call, DesktopError, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { hostOf } from '../accounts/labels';
import { ConnectCard, ConnectFrame } from './ConnectFrame';
import { QrScan } from './QrScan';

export interface EnterpriseAddressProps {
  /** An address or setup link to start from. */
  prefill?: string;
}

export function isSetupLink(value: string): boolean {
  return value.trim().toLowerCase().startsWith(SETUP_LINK_PREFIX);
}

/**
 * What is wrong with an address before the desktop is asked, or null: only https (a plain `http://` address is
 * refused here, except this computer's own in a development build — the desktop decides that), and something to go on.
 */
export function addressProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your WorkSuite server’s address or your work email.';
  if (isSetupLink(v)) return null;
  if (/\s/.test(v)) return 'An address has no spaces.';
  if (/^http:\/\//i.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(v)) return 'Only https servers are accepted. Use the https:// address your IT team gave you.';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^https?:\/\//i.test(v)) return 'Only https servers are accepted.';
  if (v.includes('@') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'That work email doesn’t look complete.';
  return null;
}

/** The host the checks screen names while the desktop has not said ("worksuite.abc.com"); the email's domain for an email. */
export function guessHost(input: string): string | null {
  const v = input.trim();
  if (isSetupLink(v)) return null;
  if (v.includes('@') && !v.includes('://')) return v.split('@').pop() || null;
  const host = hostOf(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
  return host || null;
}

/** A run on screen 7 at once, before the first `connect:progress`: every check waiting. */
export function seedRun(runId: string, input: string): ConnectRun {
  return { runId, input, target: 'enterprise', host: guessHost(input), candidates: [], steps: waitingSteps(), state: 'running', server: null, failure: null };
}

/**
 * Starts the checks for `input` (an address, a work email or a setup link): screen 7 follows. A desktop without the
 * discovery pipeline answers UNSUPPORTED, and the address goes the way it always did (`auth:setServer`).
 */
export async function startConnect(input: string): Promise<void> {
  try {
    const { runId } = await call('connect:start', { input, target: 'enterprise' });
    const current = app.get().connect;
    // A `connect:progress` may have arrived before the answer: keep it.
    app.set({ connect: current?.runId === runId ? current : seedRun(runId, input) });
    void call('connect:get', { runId }).then(
      (r) => {
        if (app.get().connect?.runId === r.runId) app.set({ connect: r });
      },
      () => undefined,
    );
  } catch (e) {
    if (e instanceof DesktopError && e.code === 'UNSUPPORTED' && !isSetupLink(input)) {
      await call('auth:setServer', { url: input });
      app.set({ session: { ...app.get().session, adding: null } });
      return;
    }
    throw e;
  }
}

/**
 * Screen 6 — Connect to your organization: the address the IT team gave, or a work email; Scan Server QR Code (or an
 * image of it, or a pasted setup link). Only https. A setup link is read and its server shown before anything
 * connects — it still needs Continue.
 */
export function EnterpriseAddress({ prefill }: EnterpriseAddressProps) {
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const signedIn = useStore(app, (s) => s.auth?.stage === 'ready');
  const [value, setValue] = useState(prefill ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [setup, setSetup] = useState<SetupLinkPayload | null>(null);

  const readSetup = async (link: string) => {
    setSetup(null);
    setError(null);
    try {
      const { payload } = await call('connect:parseSetup', { link });
      setSetup(payload);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // A setup link to start from (a worksuite://setup link, a QR from elsewhere): its server is named before Continue.
  useEffect(() => {
    if (!prefill || !isSetupLink(prefill)) return;
    let live = true;
    call('connect:parseSetup', { link: prefill }).then(
      ({ payload }) => live && setSetup(payload),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [prefill]);

  const submit = async () => {
    const v = value.trim();
    const problem = addressProblem(v);
    setError(problem);
    if (problem) return;
    if (isSetupLink(v) && !setup) {
      await readSetup(v);
      return;
    }
    setBusy(true);
    try {
      await startConnect(v);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConnectFrame title="WorkSuite — Enterprise">
      <ConnectCard width={560}>
        <button type="button" className="self-start text-[13px] font-semibold text-primary hover:underline" onClick={() => startAdding('choose')}>
          ← Back
        </button>
        <h1 className="m-0 text-[28px] font-extrabold text-ink">Connect to your organization</h1>
        <p className="m-0 mb-1.5 text-[14px] text-ink-3">Enter the address your IT team gave you, or your work email.</p>
        <form
          className="flex flex-col gap-3.5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={fieldId} className="text-[13px] font-semibold text-ink">
            WorkSuite server
          </label>
          <input
            id={fieldId}
            value={value}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="url"
            inputMode="url"
            placeholder="https://worksuite.company.com"
            aria-invalid={!!error || undefined}
            aria-describedby={cx(hintId, error && errorId) || undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
              if (setup) setSetup(null);
            }}
            className={cx('h-12 rounded-[10px] border-2 bg-surface px-3.5 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-primary', error ? 'border-danger' : 'border-line')}
          />
          <div id={hintId} className="text-[12px] text-ink-3">
            Examples: <span className="font-mono">https://worksuite.company.com</span> · <span className="font-mono">https://erp.company.lk</span> · <span className="font-mono">you@company.com</span>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="m-0 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          {setup ? (
            <div className="flex items-start gap-3 rounded-[12px] border border-line bg-subtle px-4 py-3 text-[13.5px] text-ink" data-testid="setup-summary">
              <Icon name="qr-code" size={18} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="font-semibold">{setup.name}</div>
                <div className="truncate font-mono text-[12.5px] text-ink-2">{hostOf(setup.server_url)}</div>
                <div className="mt-1 text-[12px] text-ink-3">Setup from your IT team, signed by the server. Check the name and address, then Continue.</div>
              </div>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="lg" loading={busy} className="h-[46px] flex-1 rounded-[10px] text-[15px]">
              Continue
            </Button>
            <Button size="lg" icon="qr-code" className="h-[46px] rounded-[10px]" onClick={() => setScanning(true)}>
              Scan Server QR Code
            </Button>
          </div>
        </form>
        <p className="m-0 mt-1.5 text-[12px] text-ink-3">Only https servers are accepted.{signedIn ? ' Your other accounts stay open.' : ''}</p>
      </ConnectCard>
      {scanning ? (
        <QrScan
          onClose={() => setScanning(false)}
          onLink={(link) => {
            setScanning(false);
            setValue(link);
            void readSetup(link);
          }}
        />
      ) : null}
    </ConnectFrame>
  );
}
