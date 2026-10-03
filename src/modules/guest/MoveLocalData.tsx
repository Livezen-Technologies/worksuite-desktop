import { useEffect, useState } from 'react';
import type { MoveOffer, MoveResult } from '@shared/local-workspace';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { queryClient } from '../../core/query';
import { moveAnswered } from '../../core/session';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Button, Modal } from '../../components/ui';

const KINDS = { note: 'Note', task: 'Task', event: 'Event', contact: 'Contact' } as const;

/**
 * Signed in from guest mode (#149): move the Local Profile's notes, tasks, contacts and events into this account, or
 * keep them on this device. Moving reports each item it could not move and can be tried again; nothing is lost.
 */
export function MoveLocalData() {
  const due = useStore(app, (s) => s.session.moveOffer && s.auth?.stage === 'ready');
  const [offer, setOffer] = useState<MoveOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!due) return;
    let live = true;
    void call('local:moveOffer').then(
      (next) => {
        if (!live) return;
        if (next) setOffer(next);
        else moveAnswered();
      },
      () => live && moveAnswered(),
    );
    return () => {
      live = false;
    };
  }, [due]);
  if (!due || !offer) return null;

  const close = () => {
    setOffer(null);
    setResult(null);
    moveAnswered();
  };
  const keep = async () => {
    await call('local:keep').catch(() => undefined);
    close();
  };
  const move = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await call('local:move');
      void queryClient.invalidateQueries();
      if (!r.failures.length) {
        toast('success', text('Moved {count} items to your WorkSuite account.', { count: r.moved }));
        close();
      } else setResult(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={result ? text('Some items were not moved') : text('Move your local data?')}
      onClose={busy ? undefined : () => void keep()}
      width={480}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => void keep()}>
            {result ? 'Keep the rest on this device' : 'Keep on this device only'}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void move()}>
            {result ? 'Try again' : 'Move data'}
          </Button>
        </>
      }
    >
      {result ? (
        <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
          <p>{text('{moved} moved. These are still on this device, with a backup kept until your account confirms every item:', { moved: result.moved })}</p>
          <ul className="max-h-[220px] overflow-y-auto rounded-[8px] border border-line" aria-label={text('Items not moved')}>
            {result.failures.map((f, i) => (
              <li key={`${f.kind}:${i}`} className="border-b border-line px-3 py-2 last:border-0">
                <b className="text-ink">{f.title}</b> · {text(KINDS[f.kind])}
                <div className="text-[12.5px] text-danger">{f.message}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
          <p className="font-semibold text-ink">Move your local notes, tasks, contacts and calendar events to your WorkSuite account?</p>
          <p>{text('{notes} notes, {tasks} tasks, {contacts} contacts and {events} events are saved in your Local Profile on this device.', { notes: offer.notes, tasks: offer.tasks, contacts: offer.contacts, events: offer.events })}</p>
          <p>A backup stays on this device until your account confirms every item. If you keep them here, they stay in your Local Profile.</p>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
