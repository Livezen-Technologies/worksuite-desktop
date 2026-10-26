import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { money, refusal, shortDate } from '../finance/api';
import { Notice, ReasonSheet } from '../finance/parts';
import { PageHead, Panel, THead, Cell, btnBad, btnPrimary, row } from '../hr/parts';
import { approvalBlock, approveRun, fetchPosting, fetchRun, fetchVariance, K, pendingStep, percent, preparerOf, rejectBlock, rejectRun, runTitle } from './api';

/**
 * Approve payroll run (UI-07, WF-06): the checks before a signature — a different person from the preparer
 * (maker-checker, PAY-RUN-08), no blocking issues, the warnings, the variance against the last run — the approval
 * chain, an optional note to the preparer, Approve or Reject with a reason, and the journal it will post.
 * Every figure and every check is the server's; the screen only reads them.
 */
export default function RunApproval({ id, onBack, onDone }: { id: number; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const myName = useStore(app, (s) => s.auth?.user?.name ?? null);
  const d = useQuery({ queryKey: K.run(id), queryFn: ({ signal }) => fetchRun(id, signal) });
  const posting = useQuery({ queryKey: K.posting(id), queryFn: ({ signal }) => fetchPosting(id, signal), retry: false });
  const variance = useQuery({ queryKey: K.variance(id), queryFn: ({ signal }) => fetchVariance(id, signal), retry: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  if (d.isLoading) return <Spinner />;
  if (d.error || !d.data) return <ErrorNote error={d.error} onRetry={() => void d.refetch()} />;
  const data = d.data;
  const { run, counts } = data;
  const approvals = data.approvals ?? [];
  const cur = run.currency ?? '';
  const prep = preparerOf(run, approvals);
  const blocked = approvalBlock(data, me);
  const noReject = rejectBlock(data, me);
  const accepted = data.exceptions.filter((x) => x.severity !== 'blocking' && x.status && x.status !== 'open').length;
  const v = variance.data;
  const total = percent(v?.totals?.pct);
  const over = (v?.components ?? []).filter((l) => l.flagged);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['payroll'] });
  };
  const approve = async () => {
    setBusy(true);
    try {
      // Touch ID first where this computer has it (D07). Elsewhere the server's own rules are the check.
      const v = await call('payroll:verify', { reason: `approve the ${runTitle(run)} payroll` }).catch(() => ({ verified: false, method: 'none' as const }));
      if (v.method === 'touch-id' && !v.verified) {
        toast('error', 'Not approved: Touch ID was not confirmed.');
        return;
      }
      await approveRun(id, pendingStep(approvals), note);
      toast('success', 'Approved.');
      refresh();
      onDone();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const reject = async (reason: string) => {
    setBusy(true);
    try {
      await rejectRun(id, reason);
      toast('success', 'Sent back to the preparer.');
      setRejecting(false);
      refresh();
      onDone();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const lines = posting.data?.lines ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-ink-2 hover:text-ink">
        <Icon name="chevron-left" size={14} /> {runTitle(run)}
      </button>
      <PageHead title="Approve payroll run" sub={runTitle(run)}>
        <button type="button" className={btnBad} disabled={busy || !!noReject} title={noReject ?? undefined} onClick={() => setRejecting(true)}>
          Reject…
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !!blocked} title={blocked ?? undefined} onClick={() => void approve()}>
          {busy ? 'Working…' : 'Approve run'}
        </button>
      </PageHead>
      {blocked && run.status === 'submitted' ? <Notice tone="amber">{blocked}</Notice> : null}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-3">
        <div className="flex flex-col gap-3">
          <Panel title="Before you approve" bodyClassName="flex flex-col gap-2.5 p-3.5">
            <Check ok={prep === null || prep !== me} title="Different person" detail={`${run.prepared_by?.name ? `Prepared by ${run.prepared_by.name}` : prep === null ? 'The server checks who prepared it' : prep === me ? 'You prepared this run' : 'Prepared by somebody else'}${myName ? ` · you are ${myName}` : ''}`} />
            <Check ok={counts.blocking === 0} title={counts.blocking === 0 ? 'No blocking issues' : `${counts.blocking} blocking ${counts.blocking === 1 ? 'issue' : 'issues'}`} detail={counts.blocking === 0 ? 'Nothing stops this run from being paid.' : 'They must be resolved or accepted before anybody can approve.'} />
            <Check ok title={`${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`} detail={accepted ? `${accepted} acknowledged` : counts.warning ? 'Read them on the run before signing.' : 'None raised.'} />
            {v ? (
              <Check ok={!over.length} warn={!!over.length} title={over.length ? over.map((l) => `${l.label} ${percent(l.pct) ?? ''}`.trim()).join(', ') : 'Within the variance threshold'} detail={`Total change ${total ?? '—'}${v.threshold != null ? `, threshold ${percent(v.threshold)?.replace('+', '')}` : ''}`} />
            ) : variance.isLoading ? null : (
              <Check ok warn title="Variance not available" detail="This server does not report the change against the last run yet." />
            )}
          </Panel>

          <Panel title="Approval chain" bodyClassName="flex flex-col gap-2 p-3.5">
            {approvals.length ? (
              approvals.map((a) => (
                <div key={`${a.step}-${a.decided_at ?? ''}`} className="flex items-center gap-2.5 text-[13px]">
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-subtle text-[11.5px] font-bold">{a.step}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <b>{a.label ?? `Step ${a.step}`}</b>
                    {a.decided_by_name ? <span className="text-ink-3">{` · ${a.decided_by_name}`}</span> : null}
                    {a.condition ? <span className="text-ink-3">{` · ${a.condition}`}</span> : null}
                  </span>
                  <span className={cx('text-[12px] font-semibold', a.status === 'approved' ? 'text-success' : a.status === 'rejected' ? 'text-danger' : 'text-ink-2')}>
                    {a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : a.status === 'withdrawn' ? 'Withdrawn' : a.step === pendingStep(approvals) ? 'Waiting' : 'Next'}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">One approval, by somebody who did not prepare the run.</span>
            )}
          </Panel>

          <Panel title="Note to preparer (optional)" bodyClassName="flex flex-col gap-2 p-3.5">
            <textarea aria-label="Note to preparer" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
            <span className="text-[12px] text-ink-3">Approving freezes the results and inputs. Changes after that need a reversal or an off-cycle run.</span>
          </Panel>
        </div>

        <Panel title="Journal preview" sub={posting.data?.posts_on ? `Posts to Finance after final approval · ${shortDate(posting.data.posts_on)}` : 'Posts to Finance after final approval'}>
          {posting.isLoading ? <Spinner /> : posting.error ? <div className="p-3"><ErrorNote error={posting.error} onRetry={() => void posting.refetch()} /></div> : null}
          {posting.data?.problems.length ? (
            <div className="p-3">
              <Notice tone="amber">{posting.data.problems.join(' ')}</Notice>
            </div>
          ) : null}
          {lines.length ? (
            <>
              <THead cols={[['Account', null], ['Role', 170], ['Debit', 130], ['Credit', 130]]} />
              {lines.map((l, i) => (
                <div key={i} className={row}>
                  <Cell w={null}>{[l.account_code, l.account_name].filter(Boolean).join(' ')}</Cell>
                  <Cell w={170} className="font-mono text-[11.5px] text-ink-3">{l.role ?? ''}</Cell>
                  <Cell w={130} className="text-right font-mono text-[12px]">{l.debit && Number(l.debit) ? money(l.debit) : ''}</Cell>
                  <Cell w={130} className="text-right font-mono text-[12px]">{l.credit && Number(l.credit) ? money(l.credit) : ''}</Cell>
                </div>
              ))}
              {posting.data?.totals ? (
                <div className={cx(row, 'font-bold')}>
                  <Cell w={null}>Total</Cell>
                  <Cell w={170} className={posting.data.totals.balanced ? 'text-success' : 'text-danger'}>{posting.data.totals.balanced ? 'Balanced' : 'Not balanced'}</Cell>
                  <Cell w={130} className="text-right font-mono text-[12px]">{money(posting.data.totals.debit, cur)}</Cell>
                  <Cell w={130} className="text-right font-mono text-[12px]">{money(posting.data.totals.credit, cur)}</Cell>
                </div>
              ) : null}
              {posting.data?.source ? <div className="px-3.5 py-2 text-[11.5px] text-ink-3">{`Source ${posting.data.source} (posting it twice has no effect)`}</div> : null}
            </>
          ) : posting.data && !posting.data.problems.length ? (
            <div className="p-3.5 text-[12.5px] text-ink-3">{posting.data.posted ? 'This run is already in the books.' : 'The journal lines are shown once this server previews them. Nothing stops it posting.'}</div>
          ) : null}
        </Panel>
      </div>

      {rejecting ? (
        <ReasonSheet title="Reject this run" body="The run goes back to the preparer as a draft, with your reason." label="Reason" action="Reject run" danger busy={busy} onOk={(r) => void reject(r)} onClose={() => setRejecting(false)} />
      ) : null}
    </div>
  );
}

function Check({ ok, warn, title, detail }: { ok: boolean; warn?: boolean; title: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px]">
      <span className={cx('mt-px flex size-[20px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', warn ? 'bg-warning' : ok ? 'bg-success' : 'bg-danger')} aria-hidden>
        {warn ? '!' : ok ? '✓' : '×'}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-ink">{title}</b>
        <span className="text-[12px] text-ink-3">{detail}</span>
      </span>
    </div>
  );
}
