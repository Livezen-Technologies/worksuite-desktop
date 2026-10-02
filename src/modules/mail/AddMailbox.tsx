import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, TextField, cx, initials } from '../../components/ui';
import type { Preferences } from '@shared/types';
import { useLocalMailboxes, useOAuthProviders } from './api';
import { accountBg } from './parts';
import type { LocalMailbox } from './types';

/**
 * Add a mailbox (UI-07): a WorkSuite Local mailbox the administrator made
 * (no server, port or password to enter), Microsoft 365 or Google by signing
 * in with them, any IMAP/SMTP account, or POP3 and send-only. The mailboxes
 * already here are left exactly as they are.
 */

export type Kind = 'local' | 'microsoft' | 'google' | 'imap' | 'other';

const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'local', label: 'WorkSuite Local Mail', hint: 'Managed by your admin' },
  { id: 'microsoft', label: 'Microsoft 365', hint: 'Sign in with Microsoft' },
  { id: 'google', label: 'Google Workspace / Gmail', hint: 'Sign in with Google' },
  { id: 'imap', label: 'IMAP / SMTP', hint: 'Any other provider' },
  { id: 'other', label: 'Other', hint: 'POP3, send-only' },
];

export function AddMailbox({ onClose, initial = 'local' }: { onClose: () => void; initial?: Kind }) {
  const [kind, setKind] = useState<Kind>(initial);
  const cacheDays = useStore(app, (s) => s.prefs?.mailCacheDays ?? 30);
  const title = KINDS.find((k) => k.id === kind)!.label;
  return (
    <Modal labelledBy="add-mailbox-title" width={820} onClose={onClose}>
      <div className="-mx-5 -my-4 flex min-h-[520px]">
        <div className="w-[240px] shrink-0 border-r border-line bg-subtle p-3">
          <h2 id="add-mailbox-title" className="px-1 pb-3 pt-1 text-[16px] font-bold text-ink">
            Add a mailbox
          </h2>
          <div role="radiogroup" aria-label="Kind of mailbox" className="flex flex-col gap-1">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)} className={cx('flex items-start gap-2.5 rounded-[10px] border px-3 py-2 text-left', kind === k.id ? 'border-primary bg-surface' : 'border-transparent hover:bg-surface')}>
                <span aria-hidden className={cx('mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2', kind === k.id ? 'border-primary' : 'border-ink-3')}>
                  {kind === k.id ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold text-ink">{k.label}</span>
                  <span className="block text-[12px] text-ink-3">{k.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-5">
          <div className="flex items-center gap-2.5">
            <span className="text-[17px] font-bold text-ink">{title}</span>
            <span className="flex-1" />
            <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="mt-2 min-h-0 flex-1">
            {kind === 'local' ? <LocalPane /> : kind === 'microsoft' || kind === 'google' ? <OAuthPane provider={kind} /> : <ServerPane kind={kind} onDone={onClose} />}
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-[10px] bg-subtle px-3 py-2.5 text-[13px]">
            <span className="text-ink-2">Keep a copy for offline use:</span>
            <Select
              aria-label="Keep a copy for offline use"
              value={cacheDays}
              options={[
                { value: 7, label: text('Last 7 days') },
                { value: 30, label: text('Last 30 days') },
                { value: 90, label: text('Last 90 days') },
                { value: 0, label: text('Headers only') },
              ]}
              onValueChange={(v) => void updatePrefs({ mailCacheDays: v as Preferences['mailCacheDays'] })}
              className="h-8"
            />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">The mailboxes you already have stay exactly as they are.</p>
        </div>
      </div>
    </Modal>
  );
}

function LocalPane() {
  const qc = useQueryClient();
  const list = useLocalMailboxes(true);
  const [asking, setAsking] = useState<LocalMailbox | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connect = async (m: LocalMailbox, pass?: string) => {
    setBusy(m.id);
    setError(null);
    try {
      await apiPost(`/api/mail/local-mailboxes/${m.id}/connect`, pass ? { password: pass } : {});
      setAsking(null);
      setPassword('');
      toast('success', text('{email} is in your Mail.', { email: m.email }));
      void qc.invalidateQueries({ queryKey: ['mail'] });
    } catch (e) {
      const code = e instanceof ApiError ? (e.data as { code?: string } | null)?.code : null;
      if (code === 'needs_password' && !pass) setAsking(m);
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const mailboxes = list.data?.mailboxes ?? [];
  return (
    <div>
      <p className="text-[13.5px] text-ink-2">Mailboxes your administrator created for you. This computer is set up automatically — no server, port or password to enter.</p>
      <h3 className="mt-4 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">Available to you</h3>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {!list.isLoading && !list.error && mailboxes.length === 0 ? <p className="mt-2 text-[13px] text-ink-3">Your administrator has not given you a WorkSuite mailbox yet.</p> : null}
      <ul role="list" className="mt-2 flex flex-col gap-2">
        {mailboxes.map((m) => {
          const added = m.state === 'connected' && m.connection_id !== null;
          const shared = m.account_type === 'shared_mailbox' || m.type === 'shared';
          return (
            <li key={m.id} className="rounded-[12px] border border-line px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span aria-hidden className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-[12.5px] font-bold text-white', accountBg(shared ? 'violet' : m.type === 'user' ? 'blue' : 'teal'))}>{initials(m.display_name || m.email)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-ink">{m.email}</span>
                  <span className="block text-[12.5px] text-ink-3">
                    {shared ? text('Shared mailbox') : m.type === 'user' ? text('Your mailbox') : text('Department mailbox')}
                    {m.quota_mb > 0 ? ` · ${m.quota_mb >= 1024 ? `${Math.round(m.quota_mb / 1024)} GB` : `${m.quota_mb} MB`}` : ''}
                  </span>
                </span>
                {added ? (
                  <span className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-success-bg px-3 text-[13px] font-bold text-success">
                    Added <Icon name="check" size={14} />
                  </span>
                ) : (
                  <Button variant={shared ? 'secondary' : 'primary'} loading={busy === m.id} onClick={() => void connect(m)} aria-label={text('Add {email}', { email: m.email })}>
                    Add
                  </Button>
                )}
              </div>
              {asking?.id === m.id ? (
                <form
                  className="mt-3 flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (password) void connect(m, password);
                  }}
                >
                  <TextField className="flex-1" type="password" label="This mailbox's mail password" hint="Asked once; the Mail app keeps it, encrypted." value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                  <Button type="submit" variant="primary" loading={busy === m.id} disabled={!password}>
                    Add
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <div className="mt-3"><ErrorNote error={error} /></div> : null}
    </div>
  );
}

function OAuthPane({ provider }: { provider: 'microsoft' | 'google' }) {
  const providers = useOAuthProviders(true);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = providers.data?.providers.includes(provider) ?? false;
  const name = provider === 'microsoft' ? 'Microsoft' : 'Google';
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ url: string }>(`/api/mail/oauth/${provider}/start`);
      await call('app:openExternal', { url: r.url });
      setStarted(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="text-[13.5px] text-ink-2">{text('Sign in with {name} in your browser. WorkSuite never sees your password; it keeps a token you can revoke from your {name} account.', { name })}</p>
      {providers.isLoading ? <Spinner /> : null}
      {!providers.isLoading && !ready ? <p className="mt-4 rounded-[10px] bg-warning-bg px-3 py-2 text-[13px] text-warning">{text('Your administrator has not set up signing in with {name} yet. You can still add the account with IMAP / SMTP and an app password.', { name })}</p> : null}
      {ready ? (
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" icon="external" loading={busy} onClick={() => void start()}>
            {text('Sign in with {name}', { name })}
          </Button>
          {started ? <span className="text-[12.5px] text-ink-3">Finish in your browser. The mailbox appears here when you are done.</span> : null}
        </div>
      ) : null}
      {error ? <div className="mt-3"><ErrorNote error={error} /></div> : null}
    </div>
  );
}

interface ServerForm {
  email: string;
  password: string;
  display_name: string;
  imap_host: string;
  imap_port: string;
  imap_enc: string;
  smtp_host: string;
  smtp_port: string;
  smtp_enc: string;
  pop3_host: string;
  pop3_port: string;
  mode: 'pop3' | 'send';
}

/** IMAP/SMTP, or (Other) POP3 or send-only: the settings found from the address, the password, and a test before it is saved. */
function ServerPane({ kind, onDone }: { kind: 'imap' | 'other'; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<ServerForm>({ email: '', password: '', display_name: '', imap_host: '', imap_port: '993', imap_enc: 'ssl', smtp_host: '', smtp_port: '587', smtp_enc: 'starttls', pop3_host: '', pop3_port: '995', mode: 'pop3' });
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ServerForm>) => setF((x) => ({ ...x, ...patch }));
  const discover = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return;
    try {
      const r = await apiGet<{ found: boolean; source: string | null; settings: Record<string, string | number | null> | null }>('/api/mail/mailboxes/discover', { email: f.email });
      if (r.found && r.settings) {
        const s = r.settings;
        set({
          imap_host: String(s.imap_host ?? f.imap_host),
          imap_port: String(s.imap_port ?? f.imap_port),
          imap_enc: String(s.imap_enc ?? f.imap_enc),
          smtp_host: String(s.smtp_host ?? f.smtp_host),
          smtp_port: String(s.smtp_port ?? f.smtp_port),
          smtp_enc: String(s.smtp_enc ?? f.smtp_enc),
          pop3_host: String(s.pop3_host ?? f.pop3_host),
          pop3_port: String(s.pop3_port ?? f.pop3_port),
        });
        setFound(text('Settings found for this address.'));
      } else setFound(text('No settings were found for this address — enter them below.'));
    } catch {
      setFound(null);
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const pop = kind === 'other' && f.mode === 'pop3';
      const sendOnly = kind === 'other' && f.mode === 'send';
      await apiPost('/api/mail/mailboxes', {
        email: f.email.trim(),
        password: f.password,
        display_name: f.display_name.trim() || undefined,
        protocol: pop ? 'pop3' : 'imap',
        imap_host: sendOnly || pop ? '' : f.imap_host.trim(),
        imap_port: sendOnly || pop ? 0 : Number(f.imap_port) || 993,
        imap_enc: f.imap_enc,
        smtp_host: f.smtp_host.trim(),
        smtp_port: Number(f.smtp_port) || 587,
        smtp_enc: f.smtp_enc,
        ...(pop ? { pop3_host: f.pop3_host.trim(), pop3_port: Number(f.pop3_port) || 995 } : {}),
      });
      toast('success', text('{email} is in your Mail.', { email: f.email.trim() }));
      void qc.invalidateQueries({ queryKey: ['mail'] });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const enc = (value: string, onChange: (v: string) => void, label: string) => (
    <Select aria-label={label} value={value} onValueChange={(v) => onChange(String(v))} options={[{ value: 'ssl', label: 'SSL/TLS' }, { value: 'starttls', label: 'STARTTLS' }, { value: 'none', label: text('None') }]} className="h-9" />
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {kind === 'other' ? (
        <div role="radiogroup" aria-label="Kind of account" className="flex gap-2">
          {(['pop3', 'send'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={f.mode === m} onClick={() => set({ mode: m })} className={cx('h-8 rounded-full border px-3 text-[12.5px] font-semibold', f.mode === m ? 'border-ink bg-ink text-surface' : 'border-line text-ink hover:bg-subtle')}>
              {m === 'pop3' ? text('POP3') : text('Send-only (SMTP)')}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Email address" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} onBlur={() => void discover()} autoFocus />
        <TextField label="Password" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} hint="An app password where the provider asks for one." />
      </div>
      <TextField label="Name (optional)" value={f.display_name} onChange={(e) => set({ display_name: e.target.value })} />
      {found ? <p className="text-[12.5px] text-ink-3">{found}</p> : null}
      {kind === 'imap' ? (
        <div className="grid grid-cols-[1fr_90px_130px] items-end gap-2">
          <TextField label="Incoming (IMAP) server" value={f.imap_host} onChange={(e) => set({ imap_host: e.target.value })} />
          <TextField label="Port" inputMode="numeric" value={f.imap_port} onChange={(e) => set({ imap_port: e.target.value })} />
          {enc(f.imap_enc, (v) => set({ imap_enc: v }), text('IMAP security'))}
        </div>
      ) : f.mode === 'pop3' ? (
        <div className="grid grid-cols-[1fr_90px] items-end gap-2">
          <TextField label="Incoming (POP3) server" value={f.pop3_host} onChange={(e) => set({ pop3_host: e.target.value })} />
          <TextField label="Port" inputMode="numeric" value={f.pop3_port} onChange={(e) => set({ pop3_port: e.target.value })} />
        </div>
      ) : null}
      <div className="grid grid-cols-[1fr_90px_130px] items-end gap-2">
        <TextField label="Outgoing (SMTP) server" value={f.smtp_host} onChange={(e) => set({ smtp_host: e.target.value })} />
        <TextField label="Port" inputMode="numeric" value={f.smtp_port} onChange={(e) => set({ smtp_port: e.target.value })} />
        {enc(f.smtp_enc, (v) => set({ smtp_enc: v }), text('SMTP security'))}
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy} disabled={!f.email.trim() || !f.password || !f.smtp_host.trim() || (kind === 'imap' && !f.imap_host.trim())}>
          Test and add
        </Button>
      </div>
    </form>
  );
}
