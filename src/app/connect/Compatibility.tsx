import { useState } from 'react';
import type { AccountView } from '@shared/accounts';
import { SERVER_MIN_VERSION, type CompatInfo } from '@shared/discovery';
import type { AuthState } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import { useRestartToUpdate } from '../overlays/UpdateControls';
import { AccountBadge } from '../accounts/AccountBadge';
import { accountName, hostOf } from '../accounts/labels';
import { ConnectFrame } from './ConnectFrame';

export interface CompatibilityProps {
  auth: AuthState;
}

/** What Copy details puts on the clipboard for an administrator. */
export function compatDetails(kind: 'UPDATE_REQUIRED' | 'SERVER_TOO_OLD', compat: CompatInfo | null | undefined, host: string | null): string {
  return [
    `code      ${kind}`,
    host ? `host      ${host}` : null,
    `desktop   ${compat?.installed ?? 'unknown'}`,
    compat?.required ? `required  ${compat.required}` : null,
    `server    ${compat?.serverVersion ?? 'not reported'}`,
    `supported ${compat?.supportedFrom ?? SERVER_MIN_VERSION} and later`,
    `time      ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Update now: restart into a staged update, download one on offer, else look for one (the ENH-02 updater). */
function useUpdateNow(): { run: () => void; busy: boolean; dialog: ReturnType<typeof useRestartToUpdate>['dialog'] } {
  const u = useStore(app, (s) => s.update);
  const restart = useRestartToUpdate();
  const [working, setWorking] = useState(false);
  const run = () => {
    if (u?.state === 'STAGED' || u?.state === 'VERIFIED') {
      void restart.start();
      return;
    }
    setWorking(true);
    const job = u?.availableVersion && (u.state === 'AVAILABLE' || u.state === 'FAILED') ? call('updates:download') : call('updates:check');
    void job
      .then((s) => s && app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setWorking(false));
  };
  return { run, busy: working || restart.busy || u?.state === 'DOWNLOADING' || u?.state === 'CHECKING', dialog: restart.dialog };
}

/** The UPDATE_REQUIRED card: this computer's version against the one the server asks for, and Update now. */
export function UpdateRequiredCard({ name, compat }: { name: string; compat: CompatInfo | null | undefined }) {
  const update = useUpdateNow();
  const u = useStore(app, (s) => s.update);
  const required = compat?.required ?? null;
  return (
    <section className="flex w-[480px] max-w-full flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-10" aria-labelledby="compat-update">
      <div className="text-[12px] font-bold tracking-[1px] text-primary">UPDATE_REQUIRED</div>
      <h1 id="compat-update" className="m-0 text-[24px] font-extrabold text-ink">
        {name} requires WorkSuite Desktop {required ?? 'a newer version'}
        {required ? ' or later' : ''}
      </h1>
      <div className="grid grid-cols-2 gap-2.5 text-[13px] text-ink-2">
        <div className="rounded-[10px] bg-subtle p-3">
          This computer
          <br />
          <b className="font-mono text-[15px] text-ink">{compat?.installed ?? '—'}</b>
        </div>
        <div className="rounded-[10px] bg-selection p-3">
          Required
          <br />
          <b className="font-mono text-[15px] text-ink">{required ?? '—'}</b>
        </div>
      </div>
      <p className="m-0 text-[14px] text-ink-3">Your other accounts keep working. Files already on this computer for {name} stay readable offline.</p>
      <Button variant="primary" size="lg" loading={update.busy} className="h-[46px] rounded-[10px] text-[15px]" onClick={update.run}>
        {u?.state === 'STAGED' || u?.state === 'VERIFIED' ? 'Restart to update' : 'Update now'}
      </Button>
      {u?.state === 'DOWNLOADING' ? <p className="m-0 text-[12.5px] text-ink-3" role="status">Downloading the update…</p> : null}
      {update.dialog}
    </section>
  );
}

/** The SERVER_TOO_OLD card: the server's version against the oldest this Desktop supports; Copy details, Re-run discovery. */
export function ServerTooOldCard({ compat, host, onRerun, rerunning }: { compat: CompatInfo | null | undefined; host: string | null; onRerun?: () => void; rerunning?: boolean }) {
  const copy = () =>
    void navigator.clipboard.writeText(compatDetails('SERVER_TOO_OLD', compat, host)).then(
      () => toast('success', 'Details copied.'),
      () => toast('error', 'Couldn’t copy the details.'),
    );
  return (
    <section className="flex w-[420px] max-w-full flex-col gap-3 rounded-[18px] border border-line bg-surface p-8" aria-labelledby="compat-old">
      <div className="text-[12px] font-bold tracking-[1px] text-warning">SERVER_TOO_OLD</div>
      <h1 id="compat-old" className="m-0 text-[18px] font-bold text-ink">
        This WorkSuite server is older than this Desktop version supports.
      </h1>
      <p className="m-0 text-[14px] text-ink-3">
        Server {compat?.serverVersion ?? 'version unknown'} · Desktop supports {compat?.supportedFrom ?? SERVER_MIN_VERSION} and later. Contact your administrator.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button icon="copy" className="h-10 rounded-[10px]" onClick={copy}>
          Copy details
        </Button>
        {onRerun ? (
          <Button variant="ghost" className="h-10 text-primary" loading={rerunning} onClick={onRerun}>
            Re-run discovery
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** The other accounts, one click away: a version gate on one account never blocks the rest. */
function OtherAccounts({ others }: { others: AccountView[] }) {
  if (!others.length) return null;
  return (
    <div className="flex flex-col items-center gap-2 text-[13px] text-ink-3">
      <span>Open another account</span>
      <div className="flex flex-wrap justify-center gap-2">
        {others.map((a) => (
          <Button key={a.id} onClick={() => void call('accounts:switch', { accountId: a.id }).catch((e) => toast('error', errorMessage(e)))}>
            <AccountBadge account={a} size={20} />
            {a.kind === 'personal' ? 'WorkSuite Cloud' : accountName(a)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Screen 9 — this account's version gates: UPDATE_REQUIRED (the server asks for a newer Desktop: Update now, through
 * the updater) and SERVER_TOO_OLD (the server is older than this Desktop supports: Copy details, Re-run discovery).
 * Only this account is held; the others keep working and stay a click away.
 */
export function Compatibility({ auth }: CompatibilityProps) {
  const accounts = useStore(app, (s) => s.accounts);
  const account = auth.account ?? null;
  const name = account ? accountName(account) : (auth.server?.name ?? 'This server');
  const host = hostOf(account?.serverOrigin ?? auth.server?.origin) || null;
  const [rerunning, setRerunning] = useState(false);
  const others = (accounts?.accounts ?? []).filter((a) => a.id !== account?.id && !a.blockedReason);
  const rerun = account
    ? () => {
        setRerunning(true);
        void call('accounts:rediscover', { accountId: account.id })
          .then((r) => {
            if (r.state === 'ok') toast('success', 'Checked again: the server is supported now.');
            else if (r.failure) toast('error', r.failure.message);
          })
          .catch((e) => toast('error', errorMessage(e)))
          .finally(() => setRerunning(false));
      }
    : undefined;
  return (
    <ConnectFrame title={`WorkSuite — ${account?.kind === 'personal' ? 'Personal' : 'Enterprise'} · ${name}`}>
      <div className="flex max-w-full flex-col items-center gap-6">
        <div className="flex flex-wrap items-center justify-center gap-7">
          {auth.stage === 'server-too-old' ? <ServerTooOldCard compat={auth.compat} host={host} onRerun={rerun} rerunning={rerunning} /> : <UpdateRequiredCard name={name} compat={auth.compat} />}
        </div>
        <OtherAccounts others={others} />
      </div>
    </ConnectFrame>
  );
}
