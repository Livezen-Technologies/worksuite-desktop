import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { PipelineStep, Preferences, UpdateDiagnostics, UpdateStatus } from '@shared/types';
import { CHANNEL_INFO, channelSource, durationLeft, mandatoryView, suggestedFix } from '@shared/updates';
import { app, isLocked, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes, stampDayLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';
import { UpdateActions } from '../../app/screens/UpdateScreens';
import { packageLine } from '../../app/screens/UpdateDialogs';
import { ChannelRow, updateStateLabel } from './UpdatesCard';

/**
 * Settings › Updates (Updates & License design): where updates stand, the four versions that matter, the download
 * with Pause / Resume / Cancel, the verification pipeline, what's new, the update preferences, the channel, and an
 * Update Failed panel with its code and reference. Settings › Updates › Diagnostics checks why an update would not
 * arrive or install.
 */

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub: ReactNode; tone?: 'primary' | 'success' | 'danger' }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-line bg-surface p-4">
      <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      <div className={cx('mt-1 truncate font-mono text-[20px] font-bold', tone === 'primary' ? 'text-primary' : 'text-ink')}>{value}</div>
      <div className={cx('truncate text-[12.5px]', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink-3')}>{sub}</div>
    </div>
  );
}

const STEP_LABEL: Record<PipelineStep['id'], string> = { manifest: 'Manifest', download: 'Download', sha256: 'SHA-256', codesign: 'Code signature', stage: 'Stage' };

export function Pipeline({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="mt-4 grid grid-cols-5 gap-2" aria-label="Verification">
      {steps.map((s) => (
        <li
          key={s.id}
          aria-label={`${STEP_LABEL[s.id]}: ${s.state}`}
          className={cx(
            'min-w-0 rounded-[8px] px-2.5 py-2 text-[12px]',
            s.state === 'done' ? 'bg-success/10' : s.state === 'active' ? 'bg-selection' : s.state === 'failed' ? 'bg-danger-bg' : 'bg-subtle',
          )}
        >
          <div className={cx('font-semibold', s.state === 'done' ? 'text-success' : s.state === 'active' ? 'text-primary' : s.state === 'failed' ? 'text-danger' : 'text-ink-2')}>
            {s.state === 'done' ? '✓ ' : s.state === 'active' ? '● ' : s.state === 'failed' ? '✕ ' : ''}
            {STEP_LABEL[s.id]}
          </div>
          <div className="truncate text-ink-3" title={s.detail}>
            {s.detail}
          </div>
        </li>
      ))}
    </ol>
  );
}

function speedLine(u: UpdateStatus): string {
  const d = u.download;
  if (!d) return '';
  if (d.paused) return 'Paused';
  if (d.retrying) return 'Network lost · retrying';
  const parts = [d.bytesPerSecond ? `${bytes(d.bytesPerSecond)}/s` : null, d.secondsLeft !== null ? `about ${d.secondsLeft < 60 ? `${d.secondsLeft} s` : durationLeft(d.secondsLeft * 1000)} left` : null, d.resumable ? 'resumes after network loss' : null];
  return parts.filter(Boolean).join(' · ');
}

/** The download in progress (or ready, or on offer), with its pipeline. */
function DownloadCard({ u }: { u: UpdateStatus }) {
  const info = useStore(app, (s) => s.info);
  const [working, setWorking] = useState(false);
  const run = (channel: 'updates:pauseDownload' | 'updates:resumeDownload' | 'updates:cancelDownload') => {
    setWorking(true);
    void call(channel)
      .then((s) => app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setWorking(false));
  };
  const moving = u.state === 'DOWNLOADING' || u.state === 'VERIFIED';
  const d = u.download;
  const title = moving ? `Downloading WorkSuite ${u.availableVersion}` : u.state === 'STAGED' ? `WorkSuite ${u.availableVersion} is ready` : `WorkSuite ${u.availableVersion} is available`;
  const line = packageLine(u, info?.platform, info?.arch);
  return (
    <section aria-label="Download" className="rounded-[12px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        {line ? <span className="text-[12.5px] text-ink-3">{line} · full package</span> : null}
        <div className="flex-1" />
        {u.state === 'DOWNLOADING' ? (
          <>
            {d?.paused ? (
              <Button loading={working} onClick={() => run('updates:resumeDownload')}>
                Resume
              </Button>
            ) : (
              <Button loading={working} onClick={() => run('updates:pauseDownload')}>
                Pause
              </Button>
            )}
            <Button disabled={working} onClick={() => run('updates:cancelDownload')}>
              Cancel
            </Button>
          </>
        ) : (
          <UpdateActions />
        )}
      </div>
      {moving || u.state === 'STAGED' ? (
        <>
          <div role="progressbar" aria-label="Download progress" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100} className="mt-4 h-2 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${u.progress}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12.5px]">
            {d ? (
              <span className="font-mono text-ink">
                {bytes(d.received)} / {bytes(d.total)}
              </span>
            ) : null}
            <span className="font-semibold text-ink">{u.progress}%</span>
            <div className="flex-1" />
            <span className="text-ink-3">{speedLine(u)}</span>
          </div>
        </>
      ) : null}
      {u.pipeline ? <Pipeline steps={u.pipeline} /> : null}
    </section>
  );
}

/** Update Failed: what happened, the rollback state, a code and reference, Retry and Copy details. */
export function UpdateFailedPanel({ u }: { u: UpdateStatus }) {
  const f = u.failure!;
  const [working, setWorking] = useState(false);
  const retry = () => {
    setWorking(true);
    const job = u.availableVersion && u.state === 'FAILED' ? call('updates:download') : call('updates:check');
    void job
      .then((s) => s && app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setWorking(false));
  };
  const rollback = { none: 'no rollback needed', ok: 'rollback OK', failed: 'rollback failed', 'not-possible': 'rollback not possible on this computer' }[f.rollback];
  const details = [`Error ${f.code}`, rollback, `ref ${f.ref}`, `version ${f.version ?? 'unknown'}`, `current ${u.currentVersion}`, `channel ${u.channel}`, `at ${f.at}`, f.message].join('\n');
  const copy = () =>
    void navigator.clipboard.writeText(details).then(
      () => toast('success', 'Details copied.'),
      () => toast('error', 'Could not copy the details.'),
    );
  return (
    <section role="alert" aria-label="Update Failed" className="flex items-start gap-4 rounded-[12px] border border-danger/30 bg-danger-bg p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-surface text-danger">
        <Icon name="x-circle" size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[16px] font-bold text-ink">Update Failed</h3>
        <p className="mt-0.5 text-[13.5px] text-ink-2">
          {f.version ? (
            <>
              WorkSuite could not install version <span className="font-mono">{f.version}</span>.{' '}
            </>
          ) : null}
          {f.message}
          {f.rollback === 'ok' || f.rollback === 'none' ? (
            <>
              {' '}
              Version <span className="font-mono">{u.currentVersion}</span> keeps running.
            </>
          ) : null}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">
          Error <span className="font-mono text-danger">{f.code}</span> · {rollback} · ref <span className="font-mono">{f.ref}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Button variant="primary" loading={working} onClick={retry}>
          Retry
        </Button>
        <Button onClick={copy}>Copy details</Button>
      </div>
    </section>
  );
}

function PrefRow({ label, note, checked, disabled, onChange }: { label: string; note?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cx('flex items-start gap-2 py-1 text-[13px]', disabled ? 'text-ink-3' : 'text-ink')}>
      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span>
        {label}
        {note ? <span className="ml-1 text-ink-3">({note})</span> : null}
      </span>
    </label>
  );
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** "Last checked today 09:12 · next check in 5 h 48 m". */
export function checkLine(u: UpdateStatus | null, now: Date): string {
  const last = u?.lastCheckedAt ? new Date(u.lastCheckedAt) : null;
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const lastText = last ? `Last checked ${sameDay(last, now) ? 'today' : last.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time(last)}` : 'Not checked yet';
  const next = u?.nextCheckAt ? Date.parse(u.nextCheckAt) - now.getTime() : null;
  return next !== null && next > 0 ? `${lastText} · next check in ${durationLeft(next)}` : lastText;
}

function Preferences({ prefs, u }: { prefs: Preferences | null; u: UpdateStatus | null }) {
  const now = useNow(60_000);
  const autoLock = isLocked('autoUpdate');
  const set = (patch: Partial<Preferences>) => void updatePrefs(patch).catch((e) => toast('error', errorMessage(e)));
  return (
    <section aria-label="Preferences" className="rounded-[12px] border border-line bg-surface p-5">
      <h3 className="text-[15px] font-bold text-ink">Preferences</h3>
      <div className="mt-2">
        <PrefRow label="Download updates automatically" note={autoLock ? 'policy' : undefined} checked={autoLock ? true : prefs?.autoUpdate !== false} disabled={!!autoLock || !prefs} onChange={(v) => set({ autoUpdate: v })} />
        <PrefRow label="Show What's New after updating" checked={prefs?.updateShowWhatsNew !== false} disabled={!prefs} onChange={(v) => set({ updateShowWhatsNew: v })} />
        <PrefRow label="Install automatically when idle 02:00–04:00" checked={prefs?.updateInstallWhenIdle === true} disabled={!prefs} onChange={(v) => set({ updateInstallWhenIdle: v })} />
        <PrefRow label="Install when quitting" checked={prefs?.updateInstallOnQuit !== false} disabled={!prefs} onChange={(v) => set({ updateInstallOnQuit: v })} />
        <PrefRow label="Update notifications" checked={prefs?.updateNotifications !== false} disabled={!prefs} onChange={(v) => set({ updateNotifications: v })} />
      </div>
      <p className="mt-2 text-[12px] text-ink-3">{checkLine(u, now)}</p>
    </section>
  );
}

function WhatsNewPanel({ u }: { u: UpdateStatus }) {
  const n = u.notes!;
  const r = u.release;
  const meta = [r?.securityFixes !== null && r?.securityFixes !== undefined ? `Security: ${r.securityFixes} fix${r.securityFixes === 1 ? '' : 'es'}` : null, r && (r.knownIssues.length || r.securityFixes !== null) ? `Known issues: ${r.knownIssues.length ? r.knownIssues.join('; ') : 'none'}` : null].filter(Boolean);
  return (
    <section aria-label={`What's new in ${n.version}`} className="rounded-[12px] border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 text-[15px] font-bold text-ink">What&apos;s new in {n.version}</h3>
        {n.url ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary underline" onClick={() => void call('app:openExternal', { url: n.url! })}>
            Full release notes
          </button>
        ) : null}
      </div>
      {n.summary && n.summary !== n.highlights[0] ? <p className="mt-1 text-[13px] text-ink-2">{n.summary}</p> : null}
      {n.highlights.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink">
          {n.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
      {meta.length ? <p className="mt-2 text-[12px] text-ink-3">{meta.join(' · ')}</p> : null}
    </section>
  );
}

const TYPE_WORD: Record<string, string> = { RECOMMENDED: 'Recommended', OPTIONAL: 'Optional', SECURITY: 'Security', CRITICAL: 'Critical', REQUIRED: 'Required' };

export function UpdatesPage({ onDiagnostics }: { onDiagnostics?: () => void }) {
  const u = useStore(app, (s) => s.update);
  const prefs = useStore(app, (s) => s.prefs);
  const policy = useStore(app, (s) => s.bootstrap?.policy ?? null);
  const auto = prefs?.autoUpdate !== false;
  const now = useNow(60_000);
  const [checking, setChecking] = useState(false);
  const state = updateStateLabel(u, auto);
  const m = mandatoryView(u, now);
  const check = () => {
    setChecking(true);
    void call('updates:check')
      .then((s) => s && app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setChecking(false));
  };
  const r = u?.release;
  const latestSub = r ? [r.releaseType ? (TYPE_WORD[r.releaseType] ?? r.releaseType) : null, r.publishedAt ? stampDayLabel(r.publishedAt, 'year') : null].filter(Boolean).join(' · ') : u?.state === 'IDLE' && u.lastCheckedAt ? 'You have the latest' : '—';
  const showDownload = !!u?.availableVersion && ['AVAILABLE', 'DOWNLOADING', 'VERIFIED', 'STAGED'].includes(u.state);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-[22px] font-bold text-ink">Updates</h2>
        <Chip tone={state.tone}>{state.word.toUpperCase()}</Chip>
        <div className="flex-1" />
        <Button loading={checking || u?.state === 'CHECKING'} disabled={u?.state === 'DOWNLOADING' || u?.state === 'INSTALLING'} onClick={check}>
          Check for updates
        </Button>
      </div>
      {u?.failure ? <UpdateFailedPanel u={u} /> : null}
      {state.detail && !u?.failure && u?.state !== 'DOWNLOADING' ? <p className="text-[13px] text-ink-2">{state.detail}</p> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Current version" value={u?.currentVersion ?? '—'} sub={u ? `${u.channel === 'org' ? 'Organization build' : CHANNEL_INFO[u.channel].label} channel` : ''} />
        <Tile label="Latest version" value={u?.availableVersion ?? u?.currentVersion ?? '—'} sub={latestSub} tone={u?.availableVersion ? 'primary' : undefined} />
        <Tile label="Channel" value={<span className="font-sans">{u ? CHANNEL_INFO[u.channel].label : '—'}</span>} sub={channelSource(policy, !!prefs?.updateChannelChosen)} />
        <Tile
          label="Minimum supported"
          value={u?.minimumVersion ?? '—'}
          sub={m.required ? (m.locked ? 'Update required now' : `Update required within ${durationLeft(m.msLeft ?? 0)}`) : u?.minimumVersion ? 'You are supported' : 'No minimum set'}
          tone={m.required ? 'danger' : u?.minimumVersion ? 'success' : undefined}
        />
      </div>
      {showDownload && u ? <DownloadCard u={u} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {u?.notes && u.availableVersion ? (
          <WhatsNewPanel u={u} />
        ) : (
          <section className="rounded-[12px] border border-line bg-surface p-5 text-[13px] text-ink-2">
            <h3 className="text-[15px] font-bold text-ink">What&apos;s new</h3>
            <p className="mt-1">{u?.availableVersion ? 'The Update Center sent no notes for this version.' : 'Nothing new to show: WorkSuite is up to date.'}</p>
          </section>
        )}
        <Preferences prefs={prefs} u={u} />
      </div>
      <section aria-label="Channel" className="rounded-[12px] border border-line bg-surface px-5">
        <ChannelRow u={u} />
        <div className="flex items-center gap-3 py-3.5">
          <span className="flex-1 text-[13px] text-ink-2">Something not right? Diagnostics checks why an update would not arrive or install.</span>
          {onDiagnostics ? (
            <Button icon="stethoscope" onClick={onDiagnostics}>
              Diagnostics
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const STATUS_WORD: Record<UpdateDiagnostics['checks'][number]['status'], { word: string; mark: string; tone: string }> = {
  pass: { word: 'Pass', mark: '✓', tone: 'text-success' },
  low: { word: 'Low', mark: '!', tone: 'text-warning' },
  fail: { word: 'Fail', mark: '✕', tone: 'text-danger' },
  skip: { word: 'Skip', mark: '–', tone: 'text-ink-3' },
};

export function diagnosticsText(r: UpdateDiagnostics, u: UpdateStatus | null): string {
  const width = Math.max(...r.checks.map((c) => c.label.length));
  const fix = suggestedFix(r.checks);
  return [
    'WorkSuite Desktop — Update Diagnostics',
    `Ran ${r.ranAt}`,
    u ? `Version ${u.currentVersion} · channel ${u.channel} · state ${u.state}` : null,
    u?.failure ? `Last failure ${u.failure.code} · ref ${u.failure.ref}` : null,
    '',
    ...r.checks.map((c) => `${STATUS_WORD[c.status].word.toUpperCase().padEnd(4)}  ${c.label.padEnd(width)}  ${c.detail}`),
    '',
    fix ? `Suggested fix: ${fix}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Settings › Updates › Diagnostics. */
export function UpdateDiagnosticsPage() {
  const u = useStore(app, (s) => s.update);
  const q = useQuery({ queryKey: ['updates', 'diagnostics'], queryFn: () => call('updates:diagnostics'), staleTime: 0, gcTime: 0, retry: false });
  const result: UpdateDiagnostics | null = q.data ?? null;
  const running = q.isFetching;
  const run = () => void q.refetch();
  const exportReport = () => {
    if (!result) return;
    void call('updates:exportDiagnostics', { report: diagnosticsText(result, u) })
      .then((path) => path && toast('success', `Saved to ${path}`))
      .catch((e) => toast('error', errorMessage(e)));
  };
  const fix = result ? suggestedFix(result.checks) : null;
  return (
    <div className="space-y-4">
      {u?.failure ? <UpdateFailedPanel u={u} /> : null}
      <section aria-label="Update Diagnostics" className="rounded-[12px] border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[16px] font-bold text-ink">Update Diagnostics</h2>
          {result ? (
            <span className="text-[12.5px] text-ink-3">
              Ran {new Date(result.ranAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} · {result.checks.length} checks
            </span>
          ) : null}
          <div className="flex-1" />
          <Button loading={running} onClick={run}>
            Run again
          </Button>
          <Button disabled={!result} onClick={exportReport}>
            Export report
          </Button>
        </div>
        {result ? (
          <table className="w-full text-[13px]">
            <tbody>
              {result.checks.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className={cx('w-8 py-2.5 pl-5 font-bold', STATUS_WORD[c.status].tone)} aria-hidden>
                    {STATUS_WORD[c.status].mark}
                  </td>
                  <th scope="row" className="py-2.5 pr-4 text-left font-semibold text-ink">
                    {c.label}
                  </th>
                  <td className="py-2.5 pr-4 text-ink-2">{c.detail}</td>
                  <td className={cx('py-2.5 pr-5 text-right font-semibold', STATUS_WORD[c.status].tone)}>{STATUS_WORD[c.status].word}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-4 text-[13px] text-ink-3">{running ? 'Running checks…' : q.error ? errorMessage(q.error) : 'No result yet.'}</p>
        )}
      </section>
      {fix ? (
        <p className="text-[13px] text-ink-2">
          <strong>Suggested fix:</strong> {fix}
        </p>
      ) : result ? (
        <p className="text-[13px] text-ink-2">Every check passed.</p>
      ) : null}
    </div>
  );
}
