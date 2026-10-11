import { useEffect, useState } from 'react';
import { app } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../../components/ui';
import { codeDisplay, expiryLabel, inviteText, joinLink, secondsLeft } from '@shared/support-session';
import { support, type SupportCode } from './api';

/**
 * The support code somebody types to join (WS-MEET-ENH-01 RC11).
 *
 * Nine digits, **once**, for ten minutes — the server's rule, and this dialog
 * is built around it rather than around the digits being pretty. The countdown
 * is not decoration: a code read out over the phone is worthless a minute
 * after it expires, and an agent who can see it running out asks for a new one
 * instead of repeating a dead one. When it does expire the digits stop being
 * offered at all, because a code on screen is a code somebody will read out.
 *
 * The invitation points at the **web** join page, not at a `worksuite://`
 * link: whoever is being helped may not have WorkSuite installed, and that is
 * exactly the person a support code exists for.
 */
export function SupportCodeDialog({ uuid, agent, onClose }: { uuid: string; agent: string | null; onClose: () => void }) {
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? null);
  const [code, setCode] = useState<SupportCode | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await support.code(uuid);

      setCode(c);
      // The expiry is anchored the moment the answer arrives: the server sends
      // how long it has, not when it ends, so anything else would drift.
      setExpiresAt(Date.now() + c.expires_in * 1000);
    } catch (e) {
      setError(errorMessage(e));
      setCode(null);
      setExpiresAt(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let open = true;

    // The dialog asks for exactly one code when it opens; another is asked for
    // by the button, because each new code retires the last one. Out of the
    // effect body in a microtask, as the rest of the app does it: a request
    // that lands synchronously would render twice before anything was drawn.
    queueMicrotask(() => {
      if (open) void make();
    });

    return () => {
      open = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);

    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const left = expiresAt ? secondsLeft(expiresAt, now) : 0;
  const expired = !!expiresAt && left <= 0;
  const link = code && origin ? joinLink(code.code, origin) : null;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', `${what} copied.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <Modal title="Support code" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-ink-2">
          Read this to the person you are helping, or send them the link. They enter it in WorkSuite Meet. It works once, and nobody can see their screen until
          they share it.
        </p>

        {busy && !code ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-[10px] border border-danger/40 bg-danger-bg p-3">
            <p className="flex items-start gap-2 text-ink">
              <Icon name="alert" size={15} className="mt-0.5 text-danger" />
              {error}
            </p>
            <Button className="mt-2" size="sm" onClick={() => void make()}>
              Try again
            </Button>
          </div>
        ) : code ? (
          <>
            <div className={cx('rounded-[12px] border p-4 text-center', expired ? 'border-line bg-subtle' : 'border-primary/40 bg-selection')}>
              {expired ? (
                <p className="text-[14px] font-semibold text-ink-2">This code has expired.</p>
              ) : (
                <>
                  <p className="font-mono text-[30px] leading-none font-bold tracking-[2px] text-ink select-all">{code.display || codeDisplay(code.code)}</p>
                  <p role="status" aria-live="polite" className="mt-2 text-[12.5px] text-ink-2">
                    Expires in {expiryLabel(expiresAt ?? 0, now)} · works once
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon="copy" disabled={expired} onClick={() => void copy(code.display || codeDisplay(code.code), 'Code')}>
                Copy code
              </Button>
              <Button size="sm" variant="ghost" icon="link" disabled={expired || !link} title={link ? undefined : 'No server address is known for this account'} onClick={() => link && void copy(link, 'Invite link')}>
                Copy invite link
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="mail"
                disabled={expired || !origin}
                onClick={() => origin && void copy(inviteText(code.code, origin, agent), 'Invitation')}
              >
                Copy invitation
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" icon="refresh" loading={busy} onClick={() => void make()}>
                New code
              </Button>
            </div>

            <p className="text-[12px] text-ink-3">
              A new code retires this one. {link ? `The link opens ${new URL(link).host} in a browser, so it works for somebody who does not have WorkSuite installed.` : ''}
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
