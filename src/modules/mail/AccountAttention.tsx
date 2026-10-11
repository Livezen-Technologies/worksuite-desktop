import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, TextField } from '../../components/ui';
import { AddMailbox } from './AddMailbox';
import { mailKeys } from './api';
import { forgetMailbox } from './localFirst';
import { isAttemptId, startBody, summaryLine, type OAuthStart } from './oauth';
import { openSignInUrl, watchAttempt } from './OAuthSignIn';
import { accountTitle, accountsNeedingAttention, issueText } from './safety';
import type { Mailbox } from './types';

/**
 * An account that needs the person (worksuite-desktop#338): a bar at the top of the list — "Microsoft 365
 * (name@company.com) needs attention · Reconnect · Remove" — while every other account goes on as usual. Reconnect
 * is the sign-in again for an OAuth account, the password for one that has one, and setting the account up again
 * for one saved half-finished (no address or server); Remove takes it out of WorkSuite and its mail off this computer.
 */

/** The OAuth provider to sign in with: the account's own, or — a sign-in that never finished saved none — its kind's. */
export function oauthProviderOf(b: Pick<Mailbox, 'auth_type' | 'oauth_provider' | 'provider'>): string | null {
  if (b.oauth_provider) return b.oauth_provider;
  if (b.auth_type !== 'oauth') return null;
  if (/gmail|google/i.test(b.provider ?? '')) return 'google';
  if (/microsoft|office|outlook|365/i.test(b.provider ?? '')) return 'microsoft';
  return null;
}

/** Sign in again in the browser; the mailbox picks up from where it stopped (Settings › Mail › Accounts, and the bar). */
export async function signInAgain(b: Mailbox, provider: string, qc: QueryClient): Promise<void> {
  try {
    const r = await apiPost<OAuthStart>(`/api/mail/oauth/${provider}/start`, startBody(b.email));
    const refused = await openSignInUrl(r.url, provider);
    if (refused) return void toast('error', `${refused.message} ${refused.next_step ?? ''} (${text('Reference ID {id}', { id: refused.ref ?? '' })})`);
    toast('info', text('Sign in again in your browser. The mailbox picks up from where it stopped; nothing else changes.'));
    // Then say how it went — the steps and, if it failed, why — rather than leaving the card to find out.
    if (isAttemptId(r.attempt))
      watchAttempt(r.attempt, (a) => {
        const line = summaryLine(a);
        toast(line.kind, line.text);
        if (a.status === 'connected') void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
      });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** How Reconnect goes for this account. */
export function reconnectKind(b: Mailbox): 'oauth' | 'password' | 'setup' {
  const code = b.health?.code ?? null;
  if (oauthProviderOf(b)) return 'oauth';
  if (code === 'missing_email' || code === 'missing_host') return 'setup';
  return 'password';
}

/** Remove the account from WorkSuite, with its mail kept on this computer; the provider keeps the mail. */
export async function removeAccount(b: Pick<Mailbox, 'id'>, qc: QueryClient): Promise<boolean> {
  try {
    await apiDelete(`/api/mail/mailboxes/${b.id}`);
    await forgetMailbox(b.id);
    void qc.invalidateQueries({ queryKey: ['mail'] });
    toast('success', text('Removed from WorkSuite. The mail stays with the provider.'));
    return true;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

export function AccountAttention({ boxes }: { boxes: Mailbox[] }) {
  const qc = useQueryClient();
  const broken = accountsNeedingAttention(boxes);
  const [password, setPassword] = useState<Mailbox | null>(null);
  const [setup, setSetup] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!broken.length) return null;
  const reconnect = (b: Mailbox) => {
    const kind = reconnectKind(b);
    if (kind === 'oauth') return void signInAgain(b, oauthProviderOf(b)!, qc);
    if (kind === 'setup') return setSetup(true);
    setPassword(b);
  };
  return (
    <>
      <div role="alert" aria-label={text('Accounts that need attention')} className="flex shrink-0 flex-col border-b border-line bg-danger-bg">
        {broken.map((b) => (
          <div key={b.id} data-account={b.id} className="flex items-center gap-3 px-4 py-2 text-[13px] text-danger">
            <Icon name="warning" size={15} />
            <span className="min-w-0 flex-1">
              <b>{text('{account} needs attention', { account: accountTitle(b) })}</b>
              <span className="ml-1.5 text-ink-2">{b.health?.code ? issueText(b.health.code) : null}</span>
            </span>
            {removing === b.id ? (
              <>
                <span className="text-[12.5px] text-ink-2">{text('Remove it from WorkSuite on every computer?')}</span>
                <Button size="sm" variant="danger" loading={busy} onClick={() => {
                  setBusy(true);
                  void removeAccount(b, qc).finally(() => {
                    setBusy(false);
                    setRemoving(null);
                  });
                }}>
                  {text('Remove for good')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                  {text('Cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="primary" onClick={() => reconnect(b)}>
                  {text('Reconnect')}
                </Button>
                <Button size="sm" variant="ghost" className="!text-danger hover:!bg-danger/10" onClick={() => setRemoving(b.id)}>
                  {text('Remove')}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      {password ? <RepairPassword box={password} onClose={() => setPassword(null)} /> : null}
      {setup ? <AddMailbox onClose={() => setSetup(false)} /> : null}
    </>
  );
}

/** The password again, for an account whose server refused the saved one; the server settings stay as they are. */
export function RepairPassword({ box, onClose }: { box: Mailbox; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/mail/mailboxes/${box.id}`, { password });
      void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
      toast('success', text('{email} signs in again.', { email: box.email }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Repair {email}', { email: box.email })}
      labelledBy="mail-repair-title"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!password} onClick={() => void save()}>
            Test and save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <p className="text-[13px] text-ink-2">{box.last_error ? box.last_error : text('The mail server refused the saved password.')} {text('Enter the current password; the server settings stay as they are.')}</p>
        <TextField type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error ? <ErrorNote error={error} /> : null}
      </div>
    </Modal>
  );
}
