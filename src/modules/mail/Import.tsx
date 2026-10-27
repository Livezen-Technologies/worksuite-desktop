import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { bytes, dateLabel, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, Empty, ErrorNote, Spinner, TextField, cx } from '../../components/ui';
import { accountBg } from './parts';
import { SOURCES, accountsFor, folderProgress, importActions, sinceFor, stageWords, timeLeft, type ImportCheck, type ImportDetail, type ImportOptions, type ImportSummary, type SourceKind } from './imports';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * Settings › Mail › Import mail (design D08, MAIL-MIG-20…22, WF-M27): bring
 * mail from an old account into one of the person's WorkSuite mailboxes. The
 * old account is only read; the copy runs on the server, newest first, and
 * the screen follows it — progress, folders, what was left out and why.
 */
export function ImportMail({ openId }: { openId?: number | null }) {
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const list = useQuery({
    queryKey: ['mail', 'imports'],
    queryFn: () => apiGet<{ imports: ImportSummary[] }>('/api/mail/imports'),
    refetchInterval: (q) => (q.state.data?.imports.some((i) => i.stage === 'copying') ? 5000 : false),
    retry: false,
  });
  const imports = list.data?.imports ?? [];
  const [starting, setStarting] = useState(false);
  const current = imports.find((i) => i.id === openId) ?? imports.find((i) => ['copying', 'paused', 'needs_attention'].includes(i.stage)) ?? null;
  const others = imports.filter((i) => i !== current);
  const me = useStore(app, (s) => s.bootstrap?.user?.email ?? null);
  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-bold text-ink">Import my old mail</h2>
          <p className="mt-1 text-[13px] text-ink-2">{me ? text('Copy mail from a previous account into your WorkSuite mailbox, {email} or another. Your old account is only read, never changed.', { email: me }) : text('Copy mail from a previous account into your WorkSuite mailbox. Your old account is only read, never changed.')}</p>
        </div>
        {current && !starting ? (
          <Button variant="primary" icon="plus" onClick={() => setStarting(true)} disabled={offline}>
            New import
          </Button>
        ) : null}
      </div>
      {offline ? <p className="mb-3 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">Importing needs the WorkSuite server. You are offline.</p> : null}
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isSuccess && (!current || starting) ? <NewImport onStarted={() => setStarting(false)} onCancel={current ? () => setStarting(false) : undefined} /> : null}
      {current && !starting ? <ImportProgress summary={current} /> : null}
      {others.length ? (
        <section aria-label={text('Earlier imports')} className="mt-4 overflow-hidden rounded-[12px] border border-line bg-surface">
          <h3 className="border-b border-line px-4 py-2.5 text-[13.5px] font-bold text-ink">Earlier imports</h3>
          <ul role="list">
            {others.map((i) => {
              const w = stageWords(i.stage, i.percent);
              return (
                <li key={i.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{i.name}</span>
                    <span className="block truncate text-[12px] text-ink-3">{text('{n} copied · into {email}', { n: i.copied.toLocaleString(), email: i.mailboxes[0]?.destination ?? '—' })}</span>
                  </span>
                  <Chip tone={w.tone === 'muted' ? 'muted' : w.tone}>{w.label}</Chip>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** Choose the source, sign in (checked before anything is kept), choose what and where, start. */
function NewImport({ onStarted, onCancel }: { onStarted: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['mail', 'import-options'], queryFn: () => apiGet<ImportOptions>('/api/mail/imports/options'), staleTime: 60_000, retry: false });
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [region, setRegion] = useState('com');
  const [organization, setOrganization] = useState(false);
  const [range, setRange] = useState<'all' | '1y' | '3y' | '5y'>('all');
  const [into, setInto] = useState<string>('');
  const [ownFolder, setOwnFolder] = useState(true);
  const [labels, setLabels] = useState(true);
  const [keepSyncing, setKeepSyncing] = useState(false);
  const [checked, setChecked] = useState<ImportCheck | null>(null);
  const [busy, setBusy] = useState<'check' | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (opts.isLoading) return <Spinner />;
  if (opts.error) return <ErrorNote error={opts.error} onRetry={() => void opts.refetch()} />;
  const o = opts.data!;
  const destinations = o.destinations;
  if (destinations.length === 0) return <Empty icon="inbox" title={text('No WorkSuite mailbox to import into yet')} hint={text('Add your WorkSuite Local mailbox first (Accounts & offline › Add a mailbox), then import into it.')} />;

  const source = kind ? SOURCES.find((s) => s.id === kind)! : null;
  const preset = source?.preset ? (o.presets.find((p) => p.key === source.preset) ?? null) : null;
  const signedIn = kind ? (o.accounts_allowed === false ? [] : accountsFor(kind, o.accounts)) : [];
  const allowed = (k: SourceKind) => {
    const s = SOURCES.find((x) => x.id === k)!;
    return (s.preset !== null && o.presets.some((p) => p.key === s.preset)) || (o.accounts_allowed !== false && accountsFor(k, o.accounts).length > 0);
  };
  const usingAccount = account !== null;
  const needsHost = !usingAccount && (kind === 'cpanel' || kind === 'imap');
  const ready = kind !== null && (usingAccount || (preset !== null && /@/.test(address) && password !== '' && (!needsHost || host.trim() !== '')));
  const dest = into || String(destinations[0]!.id);
  const body = () =>
    usingAccount
      ? { connection_id: account }
      : { kind: preset?.key, address: address.trim(), username: username.trim() || undefined, password, host: host.trim() || undefined, port: Number(port) || 993, enc: 'ssl', region, organization };
  const reset = () => {
    setChecked(null);
    setError(null);
  };
  const pick = (k: SourceKind) => {
    setKind(k);
    const acc = o.accounts_allowed === false ? [] : accountsFor(k, o.accounts);
    setAccount(SOURCES.find((s) => s.id === k)!.preset === null || acc.length ? (acc[0]?.id ?? null) : null);
    reset();
  };
  const check = async () => {
    setBusy('check');
    setError(null);
    try {
      setChecked(await apiPost<ImportCheck>('/api/mail/imports/check', { source: body() }));
    } catch (e) {
      setChecked(null);
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const start = async () => {
    setBusy('start');
    setError(null);
    try {
      await apiPost('/api/mail/imports', {
        source: body(),
        destination_connection_id: Number(dest),
        since: sinceFor(range, todayInZone()),
        own_folder: ownFolder,
        skip_labels: kind === 'google' ? !labels : false,
        keep_syncing: keepSyncing,
      });
      toast('success', text('Started. Recent mail arrives first; you can keep working while it copies.'));
      void qc.invalidateQueries({ queryKey: ['mail', 'imports'] });
      onStarted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const label = (signedIn.find((a) => a.id === account)?.email ?? address.trim()) || text('the old account');

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={text('Where is your old mail?')} className="rounded-[12px] border border-line bg-surface p-[18px]">
        <h3 className="mb-3 text-[14.5px] font-bold text-ink">Where is your old mail?</h3>
        <div role="radiogroup" aria-label={text('Where is your old mail?')} className="grid grid-cols-5 gap-2.5">
          {SOURCES.map((s) => {
            const on = kind === s.id;
            const ok = allowed(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!ok}
                title={ok ? undefined : text('Your organization does not allow importing from there.')}
                onClick={() => pick(s.id)}
                className={cx('flex h-[92px] flex-col items-start justify-between rounded-[10px] p-3 text-left disabled:opacity-45', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}
              >
                <span aria-hidden className={cx('flex h-7 w-7 items-center justify-center rounded-[7px] text-[11px] font-bold text-white', accountBg(s.tone))}>
                  {s.badge}
                </span>
                <span>
                  <span className="block text-[13px] font-bold text-ink">{text(s.name)}</span>
                  <span className="block text-[11.5px] text-ink-3">{text(s.hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {kind ? (
        <section aria-label={text('Sign in to the old account')} className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-[18px] text-[13px]">
          {signedIn.length ? (
            <Select
              label={text('Read from')}
              value={account === null ? 'password' : String(account)}
              options={[...signedIn.map((a) => ({ value: String(a.id), label: a.oauth ? text('{email} · signed in, read-only', { email: a.email }) : a.email })), ...(preset ? [{ value: 'password', label: text('Another account, with its password') }] : [])]}
              onValueChange={(v) => {
                setAccount(v === 'password' ? null : Number(v));
                reset();
              }}
            />
          ) : kind === 'microsoft' ? (
            <p className="rounded-[10px] bg-subtle p-3 text-ink-2">Microsoft 365 is read through its sign-in. Add the old account in Accounts & offline (Add a mailbox › Microsoft 365) first; it then appears here, read-only.</p>
          ) : null}
          {!usingAccount && preset ? (
            <>
              <p className="text-[12.5px] text-ink-3">{preset.note}</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField label={text('Email address')} type="email" value={address} onChange={(e) => (setAddress(e.target.value), reset())} autoComplete="off" />
                <TextField label={text('User name (if not the address)')} value={username} onChange={(e) => (setUsername(e.target.value), reset())} autoComplete="off" />
                <TextField label={kind === 'google' || kind === 'zoho' ? text('App password') : text('Password')} type="password" value={password} onChange={(e) => (setPassword(e.target.value), reset())} autoComplete="off" />
                {kind === 'zoho' ? (
                  <Select label={text('Data centre')} value={region} options={o.zoho_regions.map((r) => ({ value: r, label: `zoho.${r}` }))} onValueChange={(v) => (setRegion(String(v)), reset())} />
                ) : null}
                {needsHost ? (
                  <>
                    <TextField label={text('IMAP server')} placeholder="mail.example.com" value={host} onChange={(e) => (setHost(e.target.value), reset())} />
                    <TextField label={text('Port')} inputMode="numeric" value={port} onChange={(e) => (setPort(e.target.value.replace(/\D/g, '').slice(0, 5)), reset())} />
                  </>
                ) : null}
              </div>
              {kind === 'zoho' ? (
                <label className="flex items-center gap-2.5">
                  <Checkbox checked={organization} onChange={(e) => (setOrganization(e.target.checked), reset())} />
                  An organization account (Zoho Workplace)
                </label>
              ) : null}
            </>
          ) : null}
          {kind !== 'microsoft' || signedIn.length ? (
            <div className="flex items-center gap-3">
              <Button onClick={() => void check()} loading={busy === 'check'} disabled={!ready}>
                Check the account
              </Button>
              {checked ? <span className="text-[12.5px] font-semibold text-success">{text('Signed in · {n} messages in {f} folders', { n: checked.total.toLocaleString(), f: checked.folders.length })}</span> : <span className="text-[12px] text-ink-3">Nothing is copied until you start.</span>}
            </div>
          ) : null}
        </section>
      ) : null}

      {checked ? (
        <section aria-label={text('What to copy')} className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-[18px] text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={text('What to copy')}
              value={range}
              options={[
                { value: 'all', label: text('All mail') },
                { value: '1y', label: text('Last year') },
                { value: '3y', label: text('Last 3 years') },
                { value: '5y', label: text('Last 5 years') },
              ]}
              onValueChange={(v) => setRange(v as typeof range)}
            />
            <Select label={text('Put it in')} value={dest} options={destinations.map((d) => ({ value: String(d.id), label: d.email }))} onValueChange={(v) => setInto(String(v))} />
          </div>
          <label className="flex items-center gap-2.5">
            <Checkbox checked={ownFolder} onChange={(e) => setOwnFolder(e.target.checked)} />
            {text('In a folder of its own: Imported › {name}', { name: label })}
          </label>
          {kind === 'google' ? (
            <label className="flex items-center gap-2.5">
              <Checkbox checked={labels} onChange={(e) => setLabels(e.target.checked)} />
              Keep Gmail labels as folders (a message with several labels is copied once)
            </label>
          ) : null}
          <label className="flex items-center gap-2.5">
            <Checkbox checked={keepSyncing} onChange={(e) => setKeepSyncing(e.target.checked)} />
            Keep copying new mail for 30 days
          </label>
          <ul role="list" className="max-h-[160px] overflow-y-auto rounded-[10px] border border-line text-[12.5px] scroll-thin">
            {checked.folders.map((f) => (
              <li key={f.name} className="flex items-center gap-3 border-b border-line px-3 py-1.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                <span className="shrink-0 text-ink-3">{f.skip_reason ? text('Skipped · {why}', { why: f.skip_reason }) : (f.messages ?? 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <ErrorNote error={error} /> : null}
      <div className="flex justify-end gap-2">
        {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
        <Button variant="primary" onClick={() => void start()} loading={busy === 'start'} disabled={!checked}>
          Start import
        </Button>
      </div>
    </div>
  );
}

/** One import as it runs (D08): stage, progress, the numbers, each folder, what was left out. */
function ImportProgress({ summary }: { summary: ImportSummary }) {
  const qc = useQueryClient();
  const live = summary.stage === 'copying';
  const detail = useQuery({
    queryKey: ['mail', 'imports', summary.id],
    queryFn: () => apiGet<ImportDetail>(`/api/mail/imports/${summary.id}`),
    refetchInterval: live ? 5000 : false,
    retry: false,
  });
  const d = detail.data ?? null;
  const s = d ?? summary;
  const w = stageWords(s.stage, s.percent);
  const left = timeLeft(s);
  const [confirm, setConfirm] = useState(false);
  const act = async (action: 'pause' | 'resume' | 'cancel') => {
    try {
      await apiPost(`/api/mail/imports/${summary.id}/${action}`);
      void qc.invalidateQueries({ queryKey: ['mail', 'imports'] });
      toast('success', action === 'pause' ? text('Paused. What was copied stays; resume to carry on.') : action === 'resume' ? text('Resumed. It carries on from where it stopped.') : text('Cancelled. The mail already copied stays.'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setConfirm(false);
    }
  };
  const remaining = Math.max(0, s.found - s.copied - s.skipped - s.failed);
  const box = s.mailboxes[0];
  const problem = s.mailboxes.find((m) => m.error)?.error ?? null;
  return (
    <section aria-label={s.name} className="flex flex-col gap-3.5 rounded-[12px] border border-line bg-surface p-[18px] text-[13px]">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-selection text-primary">
          <span className="text-[13px] font-bold">{(box?.source ?? '?').charAt(0).toUpperCase()}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold text-ink">{box ? `${box.source} → ${box.destination ?? '—'}` : s.name}</span>
          <span className="block truncate text-[12px] text-ink-3">{s.started_at ? text('Read-only access · started {time}', { time: `${dateLabel(s.started_at)} ${timeLabel(s.started_at)}` }) : text('Read-only access')}</span>
        </span>
        <Chip tone={w.tone === 'muted' ? 'muted' : w.tone}>{w.label}</Chip>
        {importActions(s.stage).map((a) =>
          a === 'cancel' ? (
            confirm ? (
              <Button key={a} variant="danger" size="sm" onClick={() => void act('cancel')}>
                Cancel the import
              </Button>
            ) : (
              <Button key={a} variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                Cancel…
              </Button>
            )
          ) : (
            <Button key={a} size="sm" onClick={() => void act(a)}>
              {a === 'pause' ? text('Pause') : text('Resume')}
            </Button>
          ),
        )}
      </div>
      <div role="progressbar" aria-label={text('Import progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.percent} className="h-2 overflow-hidden rounded-full bg-subtle">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${s.percent}%` }} />
      </div>
      <StatGrid min={140}>
        <Stat icon="mail-check" tone="green" k={text('Messages copied')} v={s.copied.toLocaleString()} />
        <Stat icon="inbox" tone="blue" k={text('Remaining')} v={remaining.toLocaleString()} />
        <Stat icon="copy" tone="neutral" k={text('Already here')} v={s.skipped.toLocaleString()} />
        <Stat icon="clock" tone="violet" k={left ? text('Time left') : text('Copied')} v={left ?? bytes(s.bytes)} />
      </StatGrid>
      {problem ? <p className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{problem}</p> : null}
      {d?.folders.length ? (
        <div className="overflow-hidden rounded-[10px] border border-line">
          <div className="flex border-b border-line bg-subtle px-3 py-2 text-[11.5px] font-bold text-ink-3">
            <span className="flex-1">Folder</span>
            <span className="w-[220px]">Goes to</span>
            <span className="w-[120px] text-right">Progress</span>
          </div>
          <ul role="list" className="max-h-[260px] overflow-y-auto scroll-thin">
            {d.folders.map((f, i) => {
              const p = folderProgress(f);
              return (
                <li key={`${f.mailbox_id}:${f.source}:${i}`} className="flex items-center border-b border-line px-3 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-ink">{f.source}</span>
                  <span className="w-[220px] truncate text-ink-2">{f.skip_reason ? text('Skipped') : (f.destination ?? '—').replace(/\//g, ' › ')}</span>
                  <span className={cx('w-[120px] text-right font-semibold', p.tone === 'success' ? 'text-success' : p.tone === 'indigo' ? 'text-primary' : 'text-ink-3')}>{p.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : detail.isLoading ? (
        <Spinner />
      ) : null}
      {d?.not_copied.length ? (
        <details className="rounded-[10px] border border-line px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink">{text('Not copied · {n}', { n: d.not_copied.length })}</summary>
          <ul role="list" className="mt-2 max-h-[180px] overflow-y-auto text-[12px] scroll-thin">
            {d.not_copied.map((n, i) => (
              <li key={i} className="flex gap-3 border-t border-line py-1.5">
                <span className="min-w-0 flex-1 truncate text-ink">{n.subject || text('(no subject)')}</span>
                <span className="shrink-0 text-ink-3">{n.reason ?? n.status}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <span className="text-[12px] text-ink-2">You can close WorkSuite — the import runs on the server and you’ll get a notification when it finishes. New mail keeps arriving as normal.</span>
    </section>
  );
}

function Stat({ k, v, icon, tone }: { k: string; v: string; icon?: string; tone?: StatTone }) {
  return <StatCard size="sm" label={k} value={v} icon={icon} tone={tone} />;
}
