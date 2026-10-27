import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Section } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { codeOf, day, errorData, errorText, K, money, nice, pGet, pPost, stamp, type Audit, type AuditScreen, type Blocker } from './api';
import { Facts, NoAccess, Refusal, usePms } from './parts';
import { auditReportHtml, printPage } from './print';
import type { Screen } from './routes';

/** Where a blocker's record opens (the server names it by type and id). */
export function blockerTarget(b: Pick<Blocker, 'ref_type' | 'ref_id'>): Exclude<Screen, { kind: 'view' }> | null {
  if (!b.ref_id) return null;
  switch (b.ref_type) {
    case 'reservation':
      return { kind: 'reservation', id: b.ref_id };
    case 'stay':
      return { kind: 'stay', id: b.ref_id, folio: null };
    case 'folio':
      return { kind: 'folio', id: b.ref_id };
    case 'cashier':
      return { kind: 'shift', id: b.ref_id };
    default:
      return null;
  }
}

/** The report of an audit, as the server kept it. */
function Report({ audit }: { audit: Audit }) {
  const pms = usePms();
  const r = audit.report;
  if (!r) return <p className="m-0 text-[13px] text-ink-3">No report for this date.</p>;
  const cur = r.currency;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Occupancy', `${r.rooms.occupancy_pct} %`],
          ['ADR', money(r.rooms.adr, cur)],
          ['RevPAR', money(r.rooms.revpar, cur)],
          ['Rooms sold', `${r.rooms.sold} of ${r.rooms.available}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[10px] border border-line bg-surface px-3 py-2">
            <div className="text-[10.5px] font-bold tracking-[.5px] text-ink-3 uppercase">{k}</div>
            <div className="text-[16px] font-extrabold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Facts rows={Object.entries(r.revenue).map(([k, v]) => [`Revenue · ${nice(k)}`, money(v, cur)] as [string, string])} />
        <Facts rows={[...Object.entries(r.taxes).map(([k, v]) => [k, money(v, cur)] as [string, string]), ['Taxes', money(r.tax_total, cur)]]} />
        <Facts rows={Object.entries(r.movements).map(([k, v]) => [nice(k), String(v)] as [string, string])} />
      </div>
      <Button size="sm" icon="printer" className="self-start" onClick={() => void printPage({ title: `Night audit ${r.business_date}`, html: auditReportHtml(audit, pms.property.name), kind: 'report' }).catch((e) => toast('error', errorText(e)))}>
        Print the report
      </Button>
    </div>
  );
}

/**
 * The night audit (§13.1, AC-10, AC-11): the business date, the pre-close
 * checks with their counts and links (PMS-NA-002), each blocker resolved or —
 * by the general manager, with a reason — overridden (NA-003), then Run: the
 * server's ten steps, each resumable from the one that failed (NA-005), the
 * room charges posted once whatever happens (NA-004), and the report. Only one
 * press runs it; a second desk is told it is running.
 */
export default function NightAudit() {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const reads = pms.mayAny('pms.night_audit.execute', 'pms.night_audit.override', 'pms.reports.view');
  const q = useQuery({
    queryKey: K.audit(pid),
    queryFn: ({ signal }) => pGet<AuditScreen>(`/properties/${pid}/night-audit`, undefined, signal),
    enabled: reads,
    refetchInterval: (query) => (query.state.data?.audit?.status === 'running' ? 4000 : false),
  });
  const [past, setPast] = useState<number | null>(null);
  const old = useQuery({ queryKey: K.auditRun(past ?? 0), queryFn: ({ signal }) => pGet<{ audit: Audit; blockers: Blocker[] }>(`/night-audits/${past}`, undefined, signal), enabled: !!past });
  const [override, setOverride] = useState<Blocker | null>(null);
  const [busy, setBusy] = useState<'run' | 'check' | 'override' | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!reads) return <NoAccess what="The night audit is shown to night auditors, the general manager and people who read reports." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The night audit could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const a = d.audit;
  const bd = d.business_date;
  const open = d.blockers.filter((b) => b.status === 'open');
  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.audit(pid) });
    void qc.invalidateQueries({ queryKey: ['pms', 'options'] });
    void qc.invalidateQueries({ queryKey: K.live });
  };

  const run = async () => {
    setBusy('run');
    setRefusal(null);
    try {
      const r = await pPost<{ audit: Audit }>(`/properties/${pid}/night-audit/run`);
      toast('success', r.message);
    } catch (e) {
      const code = codeOf(e);
      const extra = errorData<{ step?: string; blockers?: Blocker[] }>(e);
      setRefusal(
        code === 'step_failed'
          ? `${errorText(e)}${extra?.step ? ` (step: ${nice(extra.step)})` : ''} Resume it once the cause is put right: it carries on from that step, and nothing posted is posted twice.`
          : code === 'running'
            ? `${errorText(e)} It is being run from another desk.`
            : errorText(e, 'The night audit did not run.'),
      );
    } finally {
      setBusy(null);
      reload();
    }
  };
  const check = async () => {
    setBusy('check');
    setRefusal(null);
    try {
      await pPost(`/properties/${pid}/night-audit/check`);
    } catch (e) {
      setRefusal(errorText(e));
    } finally {
      setBusy(null);
      reload();
    }
  };
  const overrideIt = async (b: Blocker, reason: string) => {
    setBusy('override');
    setRefusal(null);
    try {
      const r = await pPost(`/night-audit-blockers/${b.id}/override`, { reason });
      toast('success', r.message);
      setOverride(null);
    } catch (e) {
      setRefusal(errorText(e, 'The blocker was not overridden.'));
      setOverride(null);
    } finally {
      setBusy(null);
      reload();
    }
  };

  const status = a?.status ?? 'pending';
  const runLabel = status === 'failed' ? 'Resume the audit' : 'Run the night audit';
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Night audit" sub={`${pms.property.name} · closing ${bd.business_date ? day(bd.business_date, true) : '—'}`}>
        {pms.mayAny('pms.night_audit.execute', 'pms.night_audit.override') ? (
          <Button icon="refresh" loading={busy === 'check'} disabled={!pms.online || status === 'running'} onClick={() => void check()}>
            Check again
          </Button>
        ) : null}
        {pms.may('pms.night_audit.execute') ? (
          <Button variant="primary" icon="moon" loading={busy === 'run'} disabled={!d.can_start || !pms.online || status === 'running' || status === 'completed'} title={d.can_start ? undefined : 'Every blocker is resolved or overridden first'} onClick={() => void run()}>
            {runLabel}
          </Button>
        ) : null}
      </PageHead>
      {refusal ? <Refusal text={refusal} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Business date">
          <Facts
            rows={[
              ['Business date', bd.business_date ? day(bd.business_date, true) : '—'],
              ['Status', bd.status_label ?? '—'],
              ['Calendar date', day(bd.calendar_date, true)],
              ['Behind the calendar', bd.days_behind > 0 ? `${bd.days_behind} day(s)` : 'No'],
              ['Night audit time', bd.night_audit_time ?? '—'],
              ['Last closed', bd.last_closed ? day(bd.last_closed, true) : '—'],
            ]}
          />
        </Section>
        <Section title="Before closing">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {d.checks.map((c) => (
              <li key={c.kind} className="flex items-center gap-2">
                <Icon name={c.open ? 'warning' : 'check-circle'} size={14} className={c.open ? 'text-warning' : 'text-success'} />
                <span className="min-w-0 flex-1">{c.label}</span>
                <b className={cx('tabular-nums', c.open ? 'text-warning' : 'text-ink-3')}>{c.open}</b>
                {c.overridden ? <span className="text-[11.5px] text-ink-3">{c.overridden} overridden</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {open.length ? (
        <Section title={`Blockers (${open.length})`}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {open.map((b) => {
              const t = blockerTarget(b);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span className="rounded-[6px] bg-warning-bg px-1.5 py-0.5 text-[11px] font-semibold text-warning">{b.kind_label}</span>
                  <span className="min-w-0 flex-1">{b.text}</span>
                  {t ? (
                    <Button size="sm" onClick={() => pms.open(t)}>
                      Open
                    </Button>
                  ) : null}
                  {pms.may('pms.night_audit.override') ? (
                    <Button size="sm" variant="ghost" disabled={!pms.online} onClick={() => setOverride(b)}>
                      Override
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {a ? (
        <Section title={`Audit of ${day(a.business_date, true)} · ${a.status_label}${a.attempts > 1 ? ` · attempt ${a.attempts}` : ''}`}>
          <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {a.steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <Icon name={s.done ? 'check-circle' : s.failed ? 'x-circle' : a.current_step === s.key && a.status === 'running' ? 'spinner' : 'clock'} size={14} className={cx(s.done ? 'text-success' : s.failed ? 'text-danger' : 'text-ink-3', a.current_step === s.key && a.status === 'running' && 'animate-spin-slow')} />
                <span className={cx(s.failed && 'font-semibold text-danger')}>{s.label}</span>
              </li>
            ))}
          </ol>
          {a.failure ? <p className="mt-2 mb-0 text-[12.5px] text-danger">{a.failure}</p> : null}
          {a.started_at ? (
            <p className="mt-2 mb-0 text-[12px] text-ink-3">
              Started {stamp(a.started_at)}
              {a.started_by ? ` by ${a.started_by}` : ''}
              {a.completed_at ? ` · completed ${stamp(a.completed_at)}` : ''}
            </p>
          ) : null}
          {a.report ? (
            <div className="mt-3">
              <Report audit={a} />
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="Earlier audits">
        {d.history.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">None yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {d.history.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => setPast(past === h.id ? null : h.id)} className={cx('rounded-[8px] border px-2 py-1 text-[12px]', past === h.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
                  {day(h.business_date)} · {h.status}
                </button>
              </li>
            ))}
          </ul>
        )}
        {past ? <div className="mt-3">{old.isLoading ? <Spinner /> : old.data ? <Report audit={old.data.audit} /> : old.error ? <ErrorNote error={old.error} /> : null}</div> : null}
      </Section>

      {override ? (
        <Ask
          title={`Override: ${override.kind_label}`}
          text={`${override.text} — the day closes past it; the override and its reason are audited.`}
          fields={[{ name: 'reason', label: 'Reason', required: true }]}
          confirm="Override"
          busy={busy === 'override'}
          onClose={() => setOverride(null)}
          onSubmit={(v) => void overrideIt(override, v.reason ?? '')}
        />
      ) : null}
    </div>
  );
}
