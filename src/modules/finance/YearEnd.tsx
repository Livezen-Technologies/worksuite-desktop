import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, PageHead } from '../../components/PageKit';
import { HeadLink, Pill } from '../../components/ListKit';
import { can, fetchPeriods, K, longDate, money, refusal, shortDate, type FiscalYear } from './api';
import {
  approveRefusal,
  approveVersion,
  BLOCKER_GO,
  currentVersion,
  fetchYearEnd,
  generatedByMe,
  generateVersion,
  kindWord,
  KC,
  lockYear,
  openYearEnd,
  plural,
  reopenYear,
  setCloseTask,
  TASK_GO,
  type Blocker,
  type CloseTask,
  type CloseVersion,
  type YearEndData,
} from './close';
import { Caps, ConfirmSheet, GoRow, LoadFailed, Notice, ReasonSheet } from '../../components/RecordKit';
import type { FinanceView, ScreenProps } from './Rail';
import { Checkbox } from '../../components/Checkbox';

/**
 * Year-end close.
 *
 * THE BLOCKERS ARE THE SCREEN. Generating a set of accounts is arithmetic the
 * ledger already does. What this page is for is the list of reasons the year
 * cannot be signed — each a state somebody reached by doing ordinary work and
 * forgetting to finish, and none of which makes the statements LOOK wrong. So
 * the blockers are above the versions, each with the screen that clears it,
 * and Approve is absent rather than disabled while any remain: a disabled
 * button invites people to work out how to enable it.
 *
 * A version is a photograph, not a query: it says today what it said when it
 * was generated. Nobody approves their own — the server refuses whoever
 * generated a version, and refuses again if the books have moved since.
 * Locking freezes the signed document; it does not close the year's periods,
 * which is a separate act on Periods.
 *
 * The workspace opens on the server's open year unless another is chosen. At
 * a year end the next year is usually already added and open, so the choice
 * is offered — and the older, finished year pointed out.
 */
type Asking = 'generate' | 'lock' | 'reopen' | { approve: CloseVersion } | null;

export default function YearEnd({ company, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const myName = useStore(app, (s) => s.auth?.user?.name ?? null);
  const myId = useStore(app, (s) => s.auth?.user?.id ?? null);
  const mayRead = can(perms, 'finance.reports.view');
  const maySign = can(perms, 'finance.journal.approve');
  const on = mayRead && company.has_books;
  const yearsQ = useQuery({ queryKey: K.periods(company.id), queryFn: ({ signal }) => fetchPeriods(company.id, signal), enabled: on, retry: false });
  const [chosen, setChosen] = useState<number | null>(null);
  const years = yearsQ.data?.years ?? [];
  const pick = years.find((y) => y.id === chosen) ?? null;
  const win = pick ? { from: pick.starts_on, to: pick.ends_on } : null;
  const q = useQuery({ queryKey: KC.yearend(company.id, win?.from, win?.to), queryFn: ({ signal }) => fetchYearEnd(company.id, win, signal), enabled: on, retry: false });
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState('');
  const [refused, setRefused] = useState<{ id: number; lines: string[] } | null>(null);

  if (!company.has_books) return <p className="m-6 text-[13px] text-ink-2">{company.name} has no general ledger yet.</p>;
  if (!mayRead) return <NeedsReports onGo={onGo} />;
  if (q.isLoading) return <Spinner />;
  if (q.error instanceof ApiError && q.error.forbidden) return <NeedsReports onGo={onGo} said={q.error.message} />;
  if (q.error || !q.data) return <LoadFailed what="The close workspace" onRetry={() => void q.refetch()} />;

  const d = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: [...K.company(company.id), 'yearend'] });
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      if (done) toast('success', done);
      setAsking(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy('');
    }
  };

  const picker = years.length > 1 ? <YearPicker years={years} value={pick?.id ?? d.year?.id ?? null} onPick={setChosen} /> : null;
  const today = todayInZone();
  // An earlier year that has ended and is still open — at a year end, usually the one being closed.
  const behind = d.year && d.year.ends_on >= today ? years.filter((y) => y.status === 'open' && y.ends_on < today && y.id !== d.year!.id) : [];
  const behindNote = behind.length ? (
    <Notice tone="grey" className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1">
        {behind.map((y) => y.name).join(' and ')} ended on {longDate(behind[behind.length - 1]!.ends_on)} and {behind.length === 1 ? 'is' : 'are'} still open. The workspace opens on the newest open year; if {behind.length === 1 ? 'that one' : 'one of those'} is the year being closed, switch to it.
      </span>
      <button type="button" className={btnSmall} onClick={() => setChosen(behind[behind.length - 1]!.id)}>
        Close {behind[behind.length - 1]!.name} instead
      </button>
    </Notice>
  ) : null;

  if (!d.report) {
    return (
      <div className="mx-auto flex max-w-[760px] flex-col items-start gap-3 px-6 py-9">
        <h1 className="m-0 text-[21px] font-bold text-ink">Year-end close</h1>
        <p className="m-0 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">
          {d.year ? (
            <>
              Opening the close workspace for <b className="text-ink">{d.year.name}</b> ({longDate(d.year.starts_on)} to {longDate(d.year.ends_on)}) creates the checklist and lets you generate a version of the accounts. It writes no journal.
            </>
          ) : (
            'This company has no financial year to close.'
          )}
        </p>
        {picker}
        {behindNote}
        {d.year ? (
          <button type="button" className={btnPrimary} disabled={busy !== ''} onClick={() => void run('open', () => openYearEnd(company.id, win), 'Close workspace opened.')}>
            {busy === 'open' ? 'Opening…' : 'Open the close workspace'}
          </button>
        ) : null}
      </div>
    );
  }

  const report = d.report;
  const locked = report.status === 'locked';
  const cur = d.base_currency ?? company.base_currency ?? '';
  const latest = currentVersion(d.versions);
  const me = d.me ?? (myId && /^\d+$/.test(myId) ? Number(myId) : null);

  const approve = async (v: CloseVersion) => {
    setBusy(`ap${v.id}`);
    setRefused(null);
    try {
      await approveVersion(company.id, v.id);
      toast('success', `v${v.version_no} approved. ${d.year?.name ?? 'The year'} is signed.`);
      setAsking(null);
      refresh();
    } catch (e) {
      // Kept on the version, not in a toast: "the books have changed" is an instruction, and it should stay on screen.
      setRefused({ id: v.id, lines: approveRefusal(e) });
      setAsking(null);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title={report.title}
        sub={
          <>
            {d.year ? `${longDate(d.year.starts_on)} to ${longDate(d.year.ends_on)}` : null} · figures in {cur}
          </>
        }
      >
        <ReportPill status={report.status} />
        {picker}
        {!locked ? (
          <button type="button" className={d.versions.length ? btn : btnPrimary} disabled={busy !== ''} onClick={() => (d.versions.length ? setAsking('generate') : void run('gen', () => generateVersion(company.id, report.id, null), 'Version 1 generated.'))}>
            {busy === 'gen' ? 'Generating…' : 'Generate a version'}
          </button>
        ) : null}
        {locked && maySign ? (
          <button type="button" className={btn} disabled={busy !== ''} onClick={() => setAsking('reopen')}>
            <Icon name="unlock" size={14} /> Reopen…
          </button>
        ) : null}
        {report.status === 'approved' && maySign ? (
          <button type="button" className={btnPrimary} disabled={busy !== ''} onClick={() => setAsking('lock')}>
            <Icon name="lock" size={14} /> Lock
          </button>
        ) : null}
      </PageHead>
      {behindNote}

      <Readiness ok={d.readiness.ok} blockers={d.readiness.blockers} warnings={d.readiness.warnings} onGo={onGo} />

      <Checklist tasks={d.tasks} locked={locked} busy={busy} onGo={onGo} onSet={(t, status) => void run(`t${t.id}`, () => setCloseTask(company.id, t.id, status), '')} />

      <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="border-b border-line px-4 py-2.5">
          <Caps>Versions</Caps>
          <span className="text-[12px] text-ink-3">Each is a photograph of the accounts when it was generated — it says today what it said then. Nothing edits a version, and nothing deletes one.</span>
        </div>
        {d.versions.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-[12.5px] text-ink-3">No version has been generated yet. Generating one writes no journal — it photographs the accounts as they stand.</p>
        ) : (
          d.versions.map((v) => (
            <VersionRow
              key={v.id}
              v={v}
              cur={cur}
              current={v === latest}
              mine={generatedByMe(v, me, myName)}
              approvable={v.status === 'generated' && !locked && maySign}
              ready={d.readiness.ok}
              busy={busy}
              refused={refused?.id === v.id ? refused.lines : null}
              onApprove={() => setAsking({ approve: v })}
            />
          ))
        )}
      </section>
      {latest && !latest.balanced ? <p className="m-0 text-[12.5px] font-semibold text-danger">The current version does not balance. Do not issue it.</p> : null}

      {report.status === 'approved' || locked ? (
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <GoRow
            title={locked ? 'The signed version is frozen. The year’s periods are not closed.' : 'Locking freezes the signed version. It does not close the year’s periods.'}
            sub="Every module can still post into the year until its periods are closed — a separate and larger decision, made on Periods."
            onClick={() => onGo('periods')}
          />
        </section>
      ) : null}

      <History history={d.history} />

      {asking === 'generate' ? (
        <ReasonSheet
          title="Why a new version?"
          body={
            latest && latest.status === 'approved'
              ? `v${latest.version_no} was approved and stays standing — it was signed, and history is not tidied. The new version sits beside it, and needs approving in its own right.`
              : latest
                ? `It supersedes v${latest.version_no}, which has not been approved. The reason is kept on the new version, where the next reader will see it.`
                : 'The reason is kept on the new version.'
          }
          label="What changed since the last one?"
          action="Generate"
          busy={busy === 'gen'}
          onOk={(reason) => void run('gen', () => generateVersion(company.id, report.id, reason), `Version ${(d.versions[0]?.version_no ?? 0) + 1} generated.`)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'lock' ? (
        <ConfirmSheet
          title="Lock the year?"
          body="The approved version is frozen. This does not close the accounting period — every module can still post — it freezes the document that was signed."
          action="Lock it"
          busy={busy === 'lock'}
          onYes={() => void run('lock', () => lockYear(company.id, report.id), `${d.year?.name ?? 'The year'} is locked.`)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'reopen' ? (
        <ReasonSheet
          title="Reopen this year?"
          body="A locked year that reopens without a reason is indistinguishable at audit from one that was never locked. The reason goes into the history below."
          label="Why is it being reopened?"
          action="Reopen"
          danger
          busy={busy === 'reopen'}
          onOk={(reason) => void run('reopen', () => reopenYear(company.id, report.id, reason), `${d.year?.name ?? 'The year'} is reopened.`)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking && typeof asking === 'object' ? (
        <ConfirmSheet
          title={`Approve v${asking.approve.version_no}?`}
          body={
            <>
              This signs {d.year?.name ?? 'the year'} as it stood when v{asking.approve.version_no} was generated: {figure(asking.approve.net_profit, cur, 'profit')}, {figure(asking.approve.total_assets, cur, 'assets')}. The server checks again that nothing blocks it and that the books have not changed since.
            </>
          }
          action="Approve"
          busy={busy === `ap${asking.approve.id}`}
          onYes={() => void approve(asking.approve)}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

const figure = (v: string | null, cur: string, what: string) => (v === null ? `${what} not recorded` : `${what} ${money(v, cur)}`);

function NeedsReports({ onGo, said }: { onGo: (v: FinanceView) => void; said?: string }) {
  return (
    <div className="m-6 flex max-w-[620px] flex-col items-start gap-2.5">
      <Notice tone="grey">
        {said ? <b className="block">{said}</b> : null}
        The close workspace shows the year’s statements and what blocks them, so it is read with <code className="font-mono text-[11.5px]">finance.reports.view</code>, which you do not hold. Approving and locking a year is <code className="font-mono text-[11.5px]">finance.journal.approve</code>.
      </Notice>
      <button type="button" className={btn} onClick={() => onGo('myaccess')}>
        See what you hold
      </button>
    </div>
  );
}

function YearPicker({ years, value, onPick }: { years: FiscalYear[]; value: number | null; onPick: (id: number) => void }) {
  return (
    <span className="w-[210px]">
      <Select
        aria-label="Year to close"
        value={value}
        onValueChange={onPick}
        options={[...years].reverse().map((y) => ({ value: y.id, label: y.name, hint: `${shortDate(y.starts_on)} – ${shortDate(y.ends_on)} · ${y.status}` }))}
        className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
      />
    </span>
  );
}

const REPORT_TONE: Record<string, 'grey' | 'green' | 'blue'> = { draft: 'grey', approved: 'green', locked: 'blue' };

function ReportPill({ status }: { status: string }) {
  return <Pill tone={REPORT_TONE[status] ?? 'grey'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Pill>;
}

/** The blockers, above everything, each with the screen that clears it. */
function Readiness({ ok, blockers, warnings, onGo }: { ok: boolean; blockers: Blocker[]; warnings: Blocker[]; onGo: (v: FinanceView) => void }) {
  const item = (b: Blocker, i: number, warning: boolean) => {
    const go = BLOCKER_GO[b.kind];
    return (
      <li key={`${warning ? 'w' : 'b'}${i}`} className={cx('flex flex-wrap items-baseline gap-x-2 gap-y-1', warning && 'text-[12px] opacity-90')}>
        <span className="shrink-0">
          <Pill tone={warning ? 'grey' : 'amber'}>{warning ? 'worth knowing' : kindWord(b.kind)}</Pill>
        </span>
        <span className="min-w-0 flex-1">{b.detail}</span>
        {go ? <HeadLink onClick={() => onGo(go.view)}>Open {go.label}</HeadLink> : b.kind === 'task' ? <span className="text-[11.5px] opacity-75">Tick it on the checklist below.</span> : null}
      </li>
    );
  };
  return (
    <Notice tone={ok ? 'green' : 'amber'}>
      <div className="flex items-start gap-2">
        <Icon name={ok ? 'check-circle' : 'warning'} size={17} className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <b className="text-[13px]">{ok ? 'Nothing is blocking approval.' : `${plural(blockers.length, 'thing')} must be finished before this year can be signed.`}</b>
          {blockers.length || warnings.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {blockers.map((b, i) => item(b, i, false))}
              {warnings.map((w, i) => item(w, i, true))}
            </ul>
          ) : null}
        </div>
      </div>
    </Notice>
  );
}

function Checklist({ tasks, locked, busy, onGo, onSet }: { tasks: CloseTask[]; locked: boolean; busy: string; onGo: (v: FinanceView) => void; onSet: (t: CloseTask, status: 'open' | 'done' | 'skipped') => void }) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="border-b border-line px-4 py-2.5">
        <Caps>Close checklist</Caps>
        <span className="text-[12px] text-ink-3">Deliberately short, and every item a real gate with a real screen behind it. A required task can be done but not skipped.</span>
      </div>
      {tasks.map((t) => {
        const done = t.status === 'done';
        const skipped = t.status === 'skipped';
        const go = TASK_GO[t.code];
        const off = locked || busy !== '';
        return (
          <div key={t.id} className="flex items-start gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0">
            <Checkbox aria-label={t.title} checked={done} disabled={off} onChange={() => onSet(t, done ? 'open' : 'done')} className="mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={cx('text-[13px] font-semibold', done || skipped ? 'text-ink-3 line-through' : 'text-ink')}>{t.title}</span>
                {!t.required ? <Pill tone="grey">does not block signing</Pill> : null}
                {skipped ? <Pill tone="grey">Skipped</Pill> : null}
              </span>
              {t.detail ? <span className="text-[12px] text-ink-3">{t.detail}</span> : null}
              {t.note ? <span className="text-[12px] text-ink-2">{t.note}</span> : null}
              {t.completed_by_name && (done || skipped) ? (
                <span className="text-[11.5px] text-ink-3">
                  {skipped ? 'Skipped by' : 'Done by'} {t.completed_by_name}
                  {t.completed_at ? ` on ${shortDate(t.completed_at)}` : ''}
                </span>
              ) : null}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              {go && !done && !skipped ? <HeadLink onClick={() => onGo(go.view)}>Open {go.label}</HeadLink> : null}
              {!t.required && !locked && t.status === 'open' ? (
                <button type="button" className={btnSmall} disabled={off} onClick={() => onSet(t, 'skipped')}>
                  Skip
                </button>
              ) : null}
              {skipped && !locked ? (
                <button type="button" className={btnSmall} disabled={off} onClick={() => onSet(t, 'open')}>
                  Undo skip
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
    </section>
  );
}

const VERSION_TONE: Record<string, 'blue' | 'green' | 'grey'> = { generated: 'blue', approved: 'green', superseded: 'grey' };

function VersionRow({ v, cur, current, mine, approvable, ready, busy, refused, onApprove }: { v: CloseVersion; cur: string; current: boolean; mine: boolean; approvable: boolean; ready: boolean; busy: string; refused: string[] | null; onApprove: () => void }) {
  return (
    <div className={cx('flex flex-col gap-1 border-b border-line/60 px-4 py-3 last:border-b-0', v.status === 'superseded' && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[13.5px] text-ink tabular-nums">v{v.version_no}</b>
        <Pill tone={VERSION_TONE[v.status] ?? 'grey'}>{v.status.charAt(0).toUpperCase() + v.status.slice(1)}</Pill>
        {!v.balanced ? <Pill tone="red">does not balance</Pill> : null}
        {current && v.status !== 'superseded' ? <span className="text-[11.5px] text-ink-3">current</span> : null}
        <span className="ml-auto text-[13px] text-ink-2 tabular-nums">
          Profit <b className="text-ink">{v.net_profit === null ? '—' : money(v.net_profit, cur)}</b> · Assets <b className="text-ink">{v.total_assets === null ? '—' : money(v.total_assets, cur)}</b>
        </span>
      </div>
      <span className="text-[12px] text-ink-3">
        {v.generated_by_name ?? 'Somebody'} generated it{v.generated_at ? ` on ${shortDate(v.generated_at)}` : ''} · over {plural(v.journal_count, 'journal')}, to #{v.max_journal_id ?? '—'}
        {v.approved_by_name ? ` · approved by ${v.approved_by_name}${v.approved_at ? ` on ${shortDate(v.approved_at)}` : ''}` : ''}
      </span>
      {v.reason ? <span className="text-[12px] text-ink-2">Reason: {v.reason}</span> : null}
      {approvable ? (
        !ready ? (
          <span className="text-[12px] text-ink-3">Approving waits until nothing above is blocking.</span>
        ) : mine ? (
          <span className="text-[12px] text-ink-2">You generated this version, so somebody else has to approve it. That separation is the point of the approval, not an obstacle to it.</span>
        ) : (
          <span className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" className={btnPrimary} disabled={busy !== ''} onClick={onApprove}>
              {busy === `ap${v.id}` ? 'Approving…' : `Approve v${v.version_no}`}
            </button>
            <span className="text-[12px] text-ink-3">Whoever generated a version cannot approve it.</span>
          </span>
        )
      ) : null}
      {refused ? (
        <Notice tone="red" className="mt-1">
          <b>Not approved.</b> {refused[0]}
          {refused.length > 1 ? (
            <ul className="mt-1 mb-0 pl-4">
              {refused.slice(1).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}

const ACTION_WORD: Record<string, string> = { generated: 'Generated', approved: 'Approved', locked: 'Locked', reopened: 'Reopened' };

function History({ history }: { history: YearEndData['history'] }) {
  if (!history.length) return null;
  return (
    <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <Caps className="border-b border-line px-4 py-2.5">History</Caps>
      {history.map((h, i) => (
        <div key={i} className="flex flex-wrap gap-x-2 border-b border-line/60 px-4 py-2 text-[12.5px] last:border-b-0">
          <b className="text-ink">{ACTION_WORD[h.action] ?? h.action}</b>
          <span className="text-ink-2">{h.actor_name ?? 'Somebody'}</span>
          <span className="text-ink-3">{shortDate(h.created_at)}</span>
          {h.note ? <span className="min-w-0 flex-1 text-ink-2">— {h.note}</span> : null}
        </div>
      ))}
    </section>
  );
}

