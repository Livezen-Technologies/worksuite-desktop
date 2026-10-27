import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel, parseTs, relative, timeLabel } from '../../core/time';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, Sheet } from '../../components/PageKit';
import { clientLabel, K, useMfa, usePasskeys, useSessions, useSignIns, useTrustedDevices, type PasswordPolicy, type Passkey, type SessionRow, type SignIn, type TrustedDevice } from './api';
import { Card, daysAgo, Head, Note, Pill } from '../../components/CardKit';
import { BackupCodes, CodeBoxes, TwoFactorSheet } from './TwoFactor';

/**
 * Security (AcctSecurity): how I sign in and where I am signed in. Password,
 * two-factor and backup codes, passkeys, the sessions open now, and recent
 * sign-ins with the failed ones. A passkey is added in the browser — it
 * belongs to the web address of WorkSuite, which this app's screens do not
 * have — and named, renamed and revoked here.
 */
export default function Security() {
  const mfa = useMfa();
  const keys = usePasskeys();
  const signIns = useSignIns();
  const [sheet, setSheet] = useState<'password' | 'mfa' | 'off' | 'codes' | null>(null);

  if (mfa.isLoading) return <Spinner />;
  if (mfa.error) return <ErrorNote error={mfa.error} onRetry={() => void mfa.refetch()} />;
  const m = mfa.data!;
  const active = (keys.data?.passkeys ?? []).filter((k) => k.active);
  const policy = keys.data?.policy;
  const failed = signIns.data?.failed_7d ?? 0;
  const lastFailed = signIns.data?.items.find((i) => i.event === 'failed');

  return (
    <div className="flex max-w-[1180px] flex-col gap-4">
      <Head title="Security" sub="How you sign in, and where you’re signed in now." />
      {policy?.required_for_you && active.length === 0 ? (
        <Note tone="amber">
          <b>Your organisation requires a passkey on your account.</b> Add one in your browser: Passkeys › Add passkey.
        </Note>
      ) : null}
      <div aria-label="Security check" className="grid grid-cols-3 gap-3">
        <Check tone={m.enabled ? 'good' : 'warn'} icon={m.enabled ? 'shield-check' : 'shield-alert'} title={m.enabled ? 'Two-factor is on' : 'Two-factor is off'} sub={m.enabled ? 'Authenticator app' : 'A password alone gets in'} />
        {policy?.enabled !== false ? (
          <Check tone={active.length ? 'good' : 'plain'} icon="fingerprint" title={active.length ? `${active.length} passkey${active.length === 1 ? '' : 's'}` : 'No passkeys'} sub={active.length ? 'Sign in without a password' : 'Added in your browser'} />
        ) : null}
        {signIns.data ? (
          <Check
            tone={failed ? 'warn' : 'good'}
            icon={failed ? 'warning' : 'check-circle'}
            title={failed ? `${failed} failed sign-in${failed === 1 ? '' : 's'}` : 'No failed sign-ins'}
            sub={failed && lastFailed ? `${relative(lastFailed.created_at)} · review below` : 'In the last seven days'}
          />
        ) : null}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Password" action={<button type="button" className={btn} onClick={() => setSheet('password')}>Change password</button>}>
            <p className="m-0 -mt-2 text-[12.5px] text-ink-3">{signIns.data?.password_set_at ? `Last changed ${daysAgo(signIns.data.password_set_at)}.` : 'Changing it signs you out everywhere else.'}</p>
          </Card>

          <Card title={<span className="flex items-center gap-2">Two-factor authentication {m.enabled ? <Pill tone="green">On</Pill> : <Pill tone="amber">Off</Pill>}</span>}>
            <p className="m-0 -mt-2 mb-3 text-[12.5px] text-ink-3">{m.enabled ? 'A code from your authenticator app is needed after your password.' : 'Ask for a code from an authenticator app after your password, so a stolen password is not enough.'}</p>
            {m.enabled ? (
              <>
                <div className="flex flex-col rounded-[12px] border border-line">
                  <div className="flex items-center gap-3 px-3.5 py-2.5">
                    <Icon name="mobile" size={17} className="text-ink-3" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="text-[13px] text-ink">Authenticator app</b>
                      <span className="text-[12px] text-ink-3">
                        {m.enrolled_at ? `Added ${dateLabel(m.enrolled_at)}` : 'Added'}
                        {m.last_used_at ? ` · last used ${relative(m.last_used_at)}` : ''}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 border-t border-line px-3.5 py-2.5">
                    <Icon name="key" size={17} className="text-ink-3" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="text-[13px] text-ink">Backup codes</b>
                      <span className={cx('text-[12px]', m.backup_codes <= 2 ? 'font-semibold text-warning' : 'text-ink-3')}>{m.backup_codes} of 10 left</span>
                    </span>
                    <button type="button" className={btn} onClick={() => setSheet('codes')}>
                      New codes
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <button type="button" className={btn} onClick={() => setSheet('off')}>
                    Turn off
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className={btnPrimary} onClick={() => setSheet('mfa')}>
                <Icon name="shield-check" size={15} /> Turn on
              </button>
            )}
          </Card>

          {policy?.enabled !== false ? <Passkeys list={keys.data?.passkeys ?? []} loading={keys.isLoading} max={policy?.max_per_user ?? 0} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Sessions />
          <TrustedDevices />
          {signIns.data ? <SignIns items={signIns.data.items} onPassword={() => setSheet('password')} /> : null}
        </div>
      </div>

      {sheet === 'password' ? <PasswordSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'mfa' ? <TwoFactorSheet onClose={() => setSheet(null)} onDone={() => void mfa.refetch()} /> : null}
      {sheet === 'off' ? <TurnOff onClose={() => setSheet(null)} /> : null}
      {sheet === 'codes' ? <NewCodes onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function Check({ tone, icon, title, sub }: { tone: 'good' | 'warn' | 'plain'; icon: string; title: string; sub: string }) {
  const t = { good: 'bg-success-bg text-success dark:bg-success-bg dark:text-success', warn: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning', plain: 'bg-subtle text-ink-2' }[tone];
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3">
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', t)}>
        <Icon name={icon} size={17} />
      </span>
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-[13.5px] text-ink">{title}</b>
        <span className="truncate text-[12px] text-ink-3">{sub}</span>
      </span>
    </div>
  );
}

// ── password ─────────────────────────────────────────────────────────────

function rules(p: PasswordPolicy | undefined): string {
  if (!p) return '';
  const need = [p.require_upper && 'a capital letter', p.require_lower && 'a small letter', p.require_number && 'a number', p.require_symbol && 'a symbol'].filter(Boolean) as string[];
  const tail = need.length ? `, with ${need.length > 1 ? `${need.slice(0, -1).join(', ')} and ${need[need.length - 1]}` : need[0]}` : '';
  const reuse = p.history_count ? ` Not one of your last ${p.history_count}.` : '';
  return `At least ${p.min_length} characters${tail}.${reuse}`;
}

/**
 * Change password. The server ends every session of the account when the
 * password changes; the app then signs in again with the new one so this
 * computer carries on (`auth:changePassword`), asking for a code when the
 * account has two-factor.
 */
function PasswordSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const org = useStore(app, (s) => s.bootstrap?.user.organizationId);
  const policy = useQuery({ queryKey: [...K.policy, org], queryFn: ({ signal }) => apiGet<PasswordPolicy>('/api/auth/password-policy', org && /^\d+$/.test(org) ? { org_id: org } : undefined, signal) });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const mismatch = again.length > 0 && again !== next;
  const short = policy.data ? next.length > 0 && next.length < policy.data.min_length : false;

  const done = () => {
    void qc.invalidateQueries({ queryKey: K.sessions });
    void qc.invalidateQueries({ queryKey: K.signIns });
  };
  const submit = async () => {
    if (!current || !next || mismatch || short) return;
    setBusy(true);
    try {
      const r = await call('auth:changePassword', { current, next });
      done();
      if (r.outcome === 'mfa') {
        setStep('code');
        return;
      }
      toast(r.outcome === 'renewed' ? 'success' : 'warning', r.outcome === 'renewed' ? 'Password changed. Your other devices are signed out; this one stays signed in.' : 'Password changed. Sign in again here with your new password.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmCode = async (typed = code) => {
    if (typed.length !== 6 || busy) return;
    setBusy(true);
    try {
      await call('auth:renewMfa', { code: typed });
      done();
      toast('success', 'Password changed. Your other devices are signed out; this one stays signed in.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  const later = () => {
    void call('auth:renewCancel');
    toast('warning', 'Password changed. Sign in again here with your new password.');
    onClose();
  };

  if (step === 'code') {
    return (
      <Sheet
        title="Stay signed in here"
        onClose={later}
        footer={
          <>
            <button type="button" className={btn} onClick={later}>
              Sign out instead
            </button>
            <button type="button" className={btnPrimary} disabled={code.length !== 6 || busy} onClick={() => void confirmCode()}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </>
        }
      >
        <p className="m-0 text-[13px] text-ink-2">Your password is changed and every device is signed out. Enter the code from your authenticator app to keep this computer signed in — WorkSuite waits for it here.</p>
        <CodeBoxes value={code} onChange={setCode} onDone={(c) => void confirmCode(c)} disabled={busy} />
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Change password"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!current || !next || !again || mismatch || short || busy} onClick={() => void submit()}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Field label="Current password">
          <input type="password" autoComplete="current-password" autoFocus className={input} value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current password" />
        </Field>
        <Field label="New password" hint={short ? `At least ${policy.data?.min_length} characters.` : rules(policy.data)}>
          <input type="password" autoComplete="new-password" className={input} value={next} onChange={(e) => setNext(e.target.value)} aria-label="New password" />
        </Field>
        <Field label="New password again" hint={mismatch ? 'The two do not match.' : undefined}>
          <input type="password" autoComplete="new-password" className={cx(input, mismatch && 'border-danger')} value={again} onChange={(e) => setAgain(e.target.value)} aria-label="New password again" />
        </Field>
        <Note tone="indigo">Every other device and browser signed in to your account is signed out. This computer stays signed in.</Note>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ── two-factor ───────────────────────────────────────────────────────────

function TurnOff({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const off = async () => {
    setBusy(true);
    try {
      await apiDelete('/api/auth/mfa', { password });
      await qc.invalidateQueries({ queryKey: K.mfa });
      toast('success', 'Two-factor is off.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Turn off two-factor?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="inline-flex h-[34px] items-center rounded-[8px] bg-danger px-3.5 text-[13px] font-bold text-white disabled:opacity-50" disabled={!password || busy} onClick={() => void off()}>
            {busy ? 'Turning off…' : 'Turn off'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Your password alone will get you in again, and your backup codes stop working. Confirm your password.</p>
      <form onSubmit={(e) => (e.preventDefault(), password && void off())}>
        <Field label="Current password">
          <input type="password" autoComplete="current-password" autoFocus className={input} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Current password" />
        </Field>
      </form>
    </Sheet>
  );
}

function NewCodes({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ backup_codes: string[] }>('/api/auth/mfa/backup-codes');
      setCodes(r.backup_codes ?? []);
      await qc.invalidateQueries({ queryKey: K.mfa });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={codes ? 'Your new backup codes' : 'Make new backup codes?'}
      width={520}
      onClose={onClose}
      footer={
        codes ? (
          <button type="button" className={btnPrimary} onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void make()}>
              {busy ? 'Making…' : 'Make new codes'}
            </button>
          </>
        )
      }
    >
      {codes ? (
        <>
          <p className="m-0 text-[13px] text-ink-2">Each code works once. Your old codes no longer work. These are not shown again.</p>
          <BackupCodes codes={codes} />
        </>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">You get ten new codes, and every code you have now stops working.</p>
      )}
    </Sheet>
  );
}

// ── passkeys ─────────────────────────────────────────────────────────────

function Passkeys({ list, loading, max }: { list: Passkey[]; loading: boolean; max: number }) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [revoking, setRevoking] = useState<Passkey | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const active = list.filter((k) => k.active);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: K.passkeys }), qc.invalidateQueries({ queryKey: K.mfa })]);
      toast('success', done);
      setRenaming(null);
      setRevoking(null);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const add = () => void call('app:openInBrowser', { path: '/account/settings?tab=security' });

  return (
    <Card
      title="Passkeys"
      action={
        <button type="button" className={btn} onClick={add} disabled={max > 0 && active.length >= max} title="Opens WorkSuite in your browser. You confirm your WorkSuite password there, then your device makes the passkey.">
          <Icon name="plus" size={15} /> Add passkey <Icon name="external" size={12} className="text-ink-3" />
        </button>
      }
    >
      <p className="m-0 -mt-2 mb-3 text-[12.5px] text-ink-3">Sign in with your fingerprint, face or device PIN. Adding one opens WorkSuite in your browser: confirm your WorkSuite password there — a new way into your account needs it — then Windows Hello, Touch ID or your security key makes the passkey, and it is listed here.</p>
      {loading ? (
        <Spinner />
      ) : active.length === 0 ? (
        <p className="m-0 rounded-[10px] bg-well px-3 py-2.5 text-[12.5px] text-ink-3">No passkeys yet.</p>
      ) : (
        <div className="flex flex-col rounded-[12px] border border-line">
          {active.map((k) => (
            <div key={k.id} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selection text-primary">
                <Icon name={isKey(k) ? 'key' : 'fingerprint'} size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px] text-ink">{k.device_name || 'Passkey'}</b>
                <span className="truncate text-[12px] text-ink-3">
                  {[k.backup_state ? 'Synced' : isKey(k) ? 'Security key' : 'This device only', k.created_at ? `Added ${dateLabel(k.created_at)}` : null, k.last_used_at ? `Last used ${relative(k.last_used_at)}` : 'Never used'].filter(Boolean).join(' · ')}
                </span>
              </span>
              <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => (setName(k.device_name ?? ''), setRenaming(k))}>
                Rename
              </button>
              <button type="button" className="text-[12.5px] font-semibold text-danger hover:underline" onClick={() => setRevoking(k)}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
      {renaming ? (
        <Sheet
          title="Rename passkey"
          width={420}
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={!name.trim() || busy} onClick={() => void run(() => apiPatch(`/api/auth/passkeys/${renaming.id}`, { device_name: name.trim() }), 'Passkey renamed.')}>
                Save
              </button>
            </>
          }
        >
          <Field label="Name">
            <input className={input} autoFocus value={name} maxLength={80} placeholder="MacBook Pro Touch ID" onChange={(e) => setName(e.target.value)} aria-label="Name" />
          </Field>
        </Sheet>
      ) : null}
      {revoking ? (
        <Sheet
          title="Revoke passkey?"
          width={440}
          onClose={() => setRevoking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRevoking(null)}>
                Cancel
              </button>
              <button type="button" className="inline-flex h-[34px] items-center rounded-[8px] bg-danger px-3.5 text-[13px] font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void run(() => apiDelete(`/api/auth/passkeys/${revoking.id}`), 'Passkey revoked.')}>
                Revoke passkey
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">
            You will no longer be able to sign in with “{revoking.device_name || 'this passkey'}”. It stays on your device until you remove it there as well.
          </p>
        </Sheet>
      ) : null}
    </Card>
  );
}

function isKey(k: Passkey): boolean {
  const t = Array.isArray(k.transports) ? k.transports : typeof k.transports === 'string' ? k.transports.split(',') : [];
  return t.includes('usb') || t.includes('nfc');
}

// ── sessions ─────────────────────────────────────────────────────────────

function Sessions() {
  const q = useSessions();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | 'others' | null>(null);
  const rows = q.data?.rows ?? [];
  const sid = q.data?.sid ?? null;
  const mine = rows.find((r) => r.id === sid) ?? null;
  const others = rows.filter((r) => r.id !== sid);
  const out = async (ids: number[], key: number | 'others') => {
    setBusy(key);
    try {
      for (const id of ids) await apiDelete(`/api/auth/sessions/${id}`);
      await qc.invalidateQueries({ queryKey: K.sessions });
      toast('success', ids.length === 1 ? 'Signed out.' : `Signed out of ${ids.length} other sessions.`);
    } catch (e) {
      toast('error', errorMessage(e));
      void qc.invalidateQueries({ queryKey: K.sessions });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      title={
        <span className="flex flex-col">
          Active sessions
          <span className="text-[12.5px] font-medium text-ink-3">Where you’re signed in right now.</span>
        </span>
      }
      action={
        <button type="button" className={btn} disabled={others.length === 0 || busy !== null || sid === null} onClick={() => void out(others.map((r) => r.id), 'others')}>
          {busy === 'others' ? 'Signing out…' : 'Sign out others'}
        </button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col">
          {[...(mine ? [mine] : []), ...others].map((r) => (
            <SessionLine key={r.id} r={r} current={r.id === sid}>
              {r.id === sid ? null : (
                <button type="button" className="text-[12.5px] font-semibold text-danger hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => void out([r.id], r.id)}>
                  Sign out
                </button>
              )}
            </SessionLine>
          ))}
          <p className="m-0 mt-2 text-[11.5px] text-ink-3">A device you sign out has to sign in again, straight away.</p>
        </div>
      )}
    </Card>
  );
}

function SessionLine({ r, current, children }: { r: SessionRow; current: boolean; children: ReactNode }) {
  const c = clientLabel(r);
  return (
    <div data-session={r.id} className="flex items-center gap-3 border-t border-line/70 py-2.5 first:border-t-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2">
        <Icon name={c.kind === 'desktop' ? 'laptop' : c.kind === 'mobile' ? 'mobile' : 'globe'} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <b className="truncate text-[13px] text-ink">{c.label}</b>
          {current ? <Pill tone="green">This device</Pill> : null}
        </span>
        <span className="truncate text-[12px] text-ink-3">
          {r.ip ? `${r.ip} · ` : ''}signed in {relative(r.created_at).toLowerCase() === 'yesterday' ? 'yesterday' : relative(r.created_at)}
        </span>
      </span>
      {children}
    </div>
  );
}

// ── remembered devices ───────────────────────────────────────────────────

/**
 * The computers and browsers this account has verified (worksuite-desktop#301): a sign-in from one of them is not
 * asked for an emailed code or to verify again. Removing one means its next sign-in is verified again; it does not
 * sign it out (Active sessions does that).
 */
function TrustedDevices() {
  const q = useTrustedDevices();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  if (q.data === null) return null;
  const rows = q.data ?? [];
  const remove = async (d: TrustedDevice | null) => {
    setBusy(d ? d.id : 'all');
    try {
      await apiDelete(d ? `/api/auth/devices/${d.id}` : '/api/auth/devices');
      toast('success', d ? 'Device removed. It will be verified again next time.' : 'All remembered devices removed.');
      setConfirmAll(false);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: K.devices });
    }
  };
  return (
    <Card
      title={
        <span className="flex flex-col">
          Remembered devices
          <span className="text-[12.5px] font-medium text-ink-3">Not asked to verify again when you sign in.</span>
        </span>
      }
      action={
        rows.length > 1 ? (
          <button type="button" className={btn} disabled={busy !== null} onClick={() => setConfirmAll(true)}>
            Remove all
          </button>
        ) : null
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">No remembered devices. The next sign-in on a computer or browser asks to verify it.</p>
      ) : (
        <div className="flex flex-col" aria-label="Remembered devices">
          {rows.map((d) => {
            const name = d.label || [d.browser, d.platform].filter(Boolean).join(' on ') || 'A device';
            const mobile = /android|ios|iphone|ipad/i.test(`${d.platform} ${d.label}`);
            return (
              <div key={d.id} data-device={d.id} className="flex items-center gap-3 border-t border-line/70 py-2.5 first:border-t-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2">
                  <Icon name={mobile ? 'mobile' : d.browser ? 'globe' : 'laptop'} size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <b className="truncate text-[13px] text-ink">{name}</b>
                    {d.current ? <Pill tone="green">This computer</Pill> : null}
                  </span>
                  <span className="truncate text-[12px] text-ink-3">
                    {d.last_ip ? `${d.last_ip} · ` : ''}
                    {d.last_seen_at ? `last used ${relative(d.last_seen_at)}` : d.created_at ? `added ${dateLabel(d.created_at)}` : ''}
                    {d.expires_at ? ` · until ${dateLabel(d.expires_at)}` : ''}
                  </span>
                </span>
                <button type="button" className="text-[12.5px] font-semibold text-danger hover:underline disabled:opacity-50" disabled={busy !== null} aria-label={`Remove ${name}`} onClick={() => void remove(d)}>
                  {busy === d.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            );
          })}
          <p className="m-0 mt-2 text-[11.5px] text-ink-3">A removed device is asked to verify again at its next sign-in. To sign it out now, use Active sessions.</p>
        </div>
      )}
      {confirmAll ? (
        <Sheet
          title="Remove all remembered devices?"
          width={440}
          onClose={() => setConfirmAll(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirmAll(false)}>
                Cancel
              </button>
              <button type="button" className="inline-flex h-[34px] items-center rounded-[8px] bg-danger px-3.5 text-[13px] font-bold text-white disabled:opacity-50" disabled={busy !== null} onClick={() => void remove(null)}>
                Remove all
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Every computer and browser, this one included, will be asked to verify again the next time you sign in on it.</p>
        </Sheet>
      ) : null}
    </Card>
  );
}

// ── sign-ins ─────────────────────────────────────────────────────────────

const METHOD: Record<string, string> = { password: 'Password', mfa: 'Password + code', passkey: 'Passkey' };

function SignIns({ items, onPassword }: { items: SignIn[]; onPassword: () => void }) {
  return (
    <Card title="Recent sign-ins">
      {items.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">No sign-ins recorded yet.</p>
      ) : (
        <div className="flex flex-col">
          {items.slice(0, 10).map((s) => {
            const bad = s.event === 'failed';
            const c = clientLabel(s);
            const d = parseTs(s.created_at);
            return (
              <div key={s.id} className="flex items-start gap-3 border-t border-line/70 py-2.5 first:border-t-0">
                <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', bad ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success')}>
                  <Icon name={bad ? 'x' : 'check'} size={13} strokeWidth={2.4} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx('truncate text-[13px] font-semibold', bad ? 'text-danger' : 'text-ink')}>
                    {bad ? (s.method === 'passkey' ? 'Passkey refused' : 'Wrong password') : (METHOD[s.method ?? ''] ?? 'Signed in')} · {c.label}
                  </span>
                  <span className="truncate text-[12px] text-ink-3">
                    {s.ip ?? 'Unknown address'}
                    {bad ? (
                      <>
                        {' · not you? '}
                        <button type="button" onClick={onPassword} className="font-semibold text-primary hover:underline">
                          Change your password
                        </button>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-ink-3 tabular-nums" title={Number.isNaN(d.getTime()) ? undefined : d.toLocaleString()}>
                  {relative(s.created_at)}
                  {['Yesterday'].includes(relative(s.created_at)) ? ` ${timeLabel(s.created_at)}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
