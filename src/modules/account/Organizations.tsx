import { useCallback, useEffect, useState } from 'react';
import type { CloudInvitations } from '@shared/cloud';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner } from '../../components/ui';
import { Card, Head } from '../../components/CardKit';

/**
 * Joining an organisation from the app (personal → organisation workspace): the invitations waiting for you, with Join
 * and Decline, and the organisations your verified address may ask to join. A joined organisation appears in the
 * workspace switcher, its data kept apart from your personal workspace. WorkSuite Cloud accounts only.
 */
export default function Organizations() {
  const [data, setData] = useState<CloudInvitations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    call('cloud:invitations').then(
      (d) => {
        setError(null);
        setData(d);
      },
      (e) => setError(errorMessage(e)),
    );
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      if (accept) {
        const org = await call('cloud:acceptInvitation', { id });
        toast('success', `You joined ${org.name}. Switch to it from the workspace switcher.`);
      } else {
        await call('cloud:declineInvitation', { id });
        toast('info', 'Invitation declined.');
      }
      load();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Head title="Organizations" sub="Join an organization's workspace. Its files, chats and calendars stay separate from your personal workspace." />
      <Card title="Invitations for you">
        {error ? (
          <div role="alert" className="flex items-center gap-3 text-[13px] text-danger">
            {error}
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <Spinner />
        ) : data.invitations.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No invitations right now. When an organization invites your email address, it shows here.</p>
        ) : (
          <ul aria-label="Invitations" className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {data.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">{i.organization}</div>
                  <div className="text-[12.5px] text-ink-3">
                    As {i.role.toLowerCase()}
                    {i.invitedBy ? ` · invited by ${i.invitedBy}` : ''}
                    {i.expiresAt ? ` · until ${new Date(i.expiresAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <Button size="sm" disabled={busy !== null} onClick={() => void act(i.id, false)}>
                  Decline
                </Button>
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void act(i.id, true)} aria-label={`Join ${i.organization}`}>
                  {busy === i.id ? <Spinner /> : 'Join'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data && data.joinable.length ? (
        <Card title="Organizations you can ask to join">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px] text-ink">
            {data.joinable.map((o) => (
              <li key={o.id}>
                {o.name}
                {o.requested ? <span className="ml-2 text-[12px] text-ink-3">Request sent</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 mb-0 text-[12.5px] text-ink-3">These use your email address&apos;s domain. Ask from the WorkSuite Cloud portal; an administrator approves.</p>
        </Card>
      ) : null}
    </div>
  );
}
