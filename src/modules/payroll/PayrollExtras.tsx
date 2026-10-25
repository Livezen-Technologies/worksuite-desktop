import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import {
  accrueGratuity, exportEnrolments, fetchGratuity, fetchGroups, fetchStatutoryIds, groupCompanies, importEnrolments, revealStatutoryId, saveStatutoryIds, statutoryIdOk,
  type EnrolmentImport,
} from './api';
import { Badge, Card, NotYet, Table, amt, td, tdr } from './parts';

const is404 = (e: unknown) => [404, 405].includes((e as { status?: number }).status ?? 0);

/** The companies of the person's pay groups, with a picker when there is more than one. */
function useCompany(): [number, (n: number) => void, number[]] {
  const groups = useQuery({ queryKey: ['payroll', 'groups'], queryFn: ({ signal }) => fetchGroups(signal), staleTime: 300_000 });
  const orgs = groupCompanies(groups.data?.groups);
  const [org, setOrg] = useState(0);
  return [org || orgs[0] || 0, setOrg, orgs];
}

function CompanyPick({ org, setOrg, orgs }: { org: number; setOrg: (n: number) => void; orgs: number[] }) {
  if (orgs.length < 2) return null;
  return (
    <Select aria-label="Company" value={org} onChange={(e) => setOrg(Number(e.target.value))} className="h-7 rounded-[7px] border border-line bg-surface px-2 text-[12px] text-ink">
      {orgs.map((o) => <option key={o} value={o}>{`Company ${o}`}</option>)}
    </Select>
  );
}

/**
 * PAY-ASG-06: pay assignments to and from CSV. Export is the server's file; import is checked as a dry run first and
 * nothing is written until the rows are reviewed. A gross on a row becomes a proposed revision a second person approves.
 */
export function AssignmentCsv({ figures, ro }: { figures: boolean; ro: boolean }) {
  const qc = useQueryClient();
  const [org, setOrg, orgs] = useCompany();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [check, setCheck] = useState<EnrolmentImport | null>(null);
  const [busy, setBusy] = useState(false);
  const exp = async (gross: boolean) => {
    setBusy(true);
    try {
      const csv = await exportEnrolments(org, gross);
      if (csv === null) return void toast('error', 'Assignment export needs a newer WorkSuite server (Payroll 1.6).');
      const path = await call('files:saveText', { name: `payroll-assignments-${org}.csv`, text: csv });
      if (path) toast('success', 'Saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async (csv: string, dry: boolean) => {
    setBusy(true);
    try {
      const r = await importEnrolments(org, csv, dry);
      if (dry) setCheck(r);
      else {
        toast('success', `${r.enrolled ?? 0} enrolled · ${r.updated ?? 0} updated${r.proposed ? ` · ${r.proposed} salary changes to approve` : ''}.`);
        setFile(null);
        setCheck(null);
        void qc.invalidateQueries({ queryKey: ['payroll', 'enrolments'] });
      }
    } catch (e) {
      toast('error', is404(e) ? 'Assignment import needs a newer WorkSuite server (Payroll 1.6).' : refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return void toast('error', 'That file is too big to check here.');
    const csv = await f.text();
    setFile({ name: f.name, csv });
    setCheck(null);
    await run(csv, true);
  };
  if (!org) return null;
  return (
    <Card
      title="Assignments as CSV"
      action={
        <span className="flex items-center gap-2 text-[12px]">
          <CompanyPick org={org} setOrg={setOrg} orgs={orgs} />
          <button type="button" disabled={busy} className="font-semibold text-primary hover:underline disabled:opacity-50" onClick={() => void exp(false)}>Export…</button>
          {figures ? <button type="button" disabled={busy} className="font-semibold text-primary hover:underline disabled:opacity-50" onClick={() => void exp(true)}>Export with gross…</button> : null}
          {!ro ? (
            <label className="cursor-pointer font-semibold text-primary hover:underline">
              Import…
              <input type="file" accept=".csv,text/csv" className="hidden" aria-label="Import assignments CSV" onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
          ) : null}
        </span>
      }
    >
      <p className="m-0 px-3.5 pb-2 text-[11.5px] text-ink-2">Columns: employee_no, group_code, pay_basis, tax_status, cost_centre, contributes_epf, contributes_etf, gross, effective_from, reason.</p>
      {file ? (
        <div className="flex flex-col gap-1.5 border-t border-line px-3.5 py-2.5 text-[12.5px]">
          <b>{file.name}</b>
          {busy && !check ? <Spinner /> : check ? (
            <>
              <span>{`${check.valid} rows can be saved · ${check.errors.length} cannot`}</span>
              {check.errors.slice(0, 20).map((x) => <span key={x.row} className="text-danger">{`Row ${x.row}: ${x.error}`}</span>)}
              {check.preview.slice(0, 10).map((x) => <span key={x.row} className="text-ink-2">{`Row ${x.row}: ${x.employee_no} → ${x.group_code} (${x.action})`}</span>)}
              <span className="flex gap-2">
                <button type="button" disabled={busy || ro || check.errors.length > 0 || !check.valid} onClick={() => void run(file.csv, false)} className="rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">{`Save ${check.valid} rows`}</button>
                <button type="button" className="font-semibold text-ink-2 hover:underline" onClick={() => (setFile(null), setCheck(null))}>Discard</button>
              </span>
              {check.errors.length ? <span className="text-[11.5px] text-ink-3">Nothing is saved while any row is wrong. Fix the file and import it again.</span> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Statutory identifiers (G7, PAY-ASG-05): NIC, TIN, EPF/ETF and the UAE numbers, kept encrypted on the server. The list
 * shows the last four only; Reveal asks the server, which records who looked before it answers. A revealed value is
 * shown for a minute and never kept here.
 */
export function StatutoryIdsCard({ employee, ro }: { employee: number; ro: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll', 'statutory-ids', employee], queryFn: ({ signal }) => fetchStatutoryIds(employee, signal) });
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [shown, setShown] = useState<{ kind: string; value: string } | null>(null);
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), 60_000);
    return () => window.clearTimeout(t);
  }, [shown]);
  const save = useMutation({
    mutationFn: (v: Record<string, string>) => saveStatutoryIds(employee, v),
    onSuccess: (r) => {
      toast(r.duplicates?.length ? 'error' : 'success', r.duplicates?.length ? `Saved. Another employee has the same ${r.duplicates.join(', ')}.` : 'Saved.');
      setEdit(null);
      qc.setQueryData(['payroll', 'statutory-ids', employee], r);
    },
    onError: (e) => toast('error', refusal(e)),
  });
  const reveal = useMutation({ mutationFn: (kind: string) => revealStatutoryId(employee, kind), onSuccess: setShown, onError: (e) => toast('error', refusal(e)) });
  if (q.isLoading) return <Card title="Statutory identifiers"><Spinner /></Card>;
  if (q.error) return <Card title="Statutory identifiers"><div className="p-3"><ErrorNote error={q.error} /></div></Card>;
  if (q.data === null) return <Card title="Statutory identifiers"><NotYet what="Statutory identifiers" /></Card>;
  const d = q.data!;
  const bad = edit ? Object.values(edit).some((v) => !statutoryIdOk(v.trim())) : false;
  return (
    <Card
      title="Statutory identifiers"
      action={d.can.edit && !ro && !edit ? <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setEdit({})}>Edit</button> : null}
    >
      <Table head={['Identifier', 'Value', 'Updated', '']}>
        {d.ids.map((x) => (
          <tr key={x.kind}>
            <td className={td}>{x.label}</td>
            <td className={cx(td, 'font-mono')}>
              {edit ? (
                <input aria-label={x.label} placeholder={x.set ? 'Leave blank to keep' : ''} value={edit[x.kind] ?? ''} onChange={(e) => setEdit((s) => ({ ...s, [x.kind]: e.target.value }))} className={cx('h-7 w-[200px] rounded-[7px] border bg-surface px-2 text-[12px] text-ink outline-none', statutoryIdOk((edit[x.kind] ?? '').trim()) ? 'border-line focus:border-primary' : 'border-danger')} />
              ) : shown?.kind === x.kind ? shown.value : x.set ? (x.last4 ?? '••••') : '—'}
            </td>
            <td className={cx(td, 'text-ink-2')}>{x.updated_at ? shortDate(x.updated_at.slice(0, 10)) : ''}</td>
            <td className={td}>
              {!edit && x.set && d.can.reveal ? (
                shown?.kind === x.kind
                  ? <button type="button" className="font-semibold text-ink-2 hover:underline" onClick={() => setShown(null)}>Hide</button>
                  : <button type="button" disabled={reveal.isPending} className="font-semibold text-primary hover:underline" onClick={() => reveal.mutate(x.kind)}>Reveal</button>
              ) : null}
              {edit && x.set ? <button type="button" className="font-semibold text-danger hover:underline" onClick={() => setEdit((s) => ({ ...s, [x.kind]: '' , [`__clear_${x.kind}`]: '1' }))}>Clear</button> : null}
            </td>
          </tr>
        ))}
      </Table>
      {edit ? (
        <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5">
          <button
            type="button"
            disabled={bad || save.isPending}
            onClick={() => {
              const body: Record<string, string> = {};
              for (const x of d.ids) {
                const v = (edit[x.kind] ?? '').trim();
                if (v || edit[`__clear_${x.kind}`]) body[x.kind] = v;
              }
              save.mutate(body);
            }}
            className="rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="text-[12.5px] font-semibold text-ink-2 hover:underline" onClick={() => setEdit(null)}>Cancel</button>
          <span className="text-[11.5px] text-ink-3">Letters, digits, - and / only. Every reveal and change is in the audit log.</span>
        </div>
      ) : (
        <p className="m-0 px-3.5 py-2 text-[11px] text-ink-2">Revealing a number is recorded with your name.</p>
      )}
    </Card>
  );
}

/** PAY-STA-03: the gratuity liability as at a date, per employee, and the accruals posted to Finance. */
export function GratuityProvisionCard({ ro }: { ro: boolean }) {
  const qc = useQueryClient();
  const [org, setOrg, orgs] = useCompany();
  const [asOf, setAsOf] = useState('');
  const q = useQuery({ queryKey: ['payroll', 'gratuity', org, asOf], queryFn: ({ signal }) => fetchGratuity(org, asOf || null, signal), enabled: org > 0 });
  const accrue = useMutation({
    mutationFn: () => accrueGratuity(org, q.data!.as_of),
    onSuccess: (r) => (toast('success', r.accrual.journal_no ? `Accrued as ${r.accrual.journal_no}.` : 'Accrued.'), void qc.invalidateQueries({ queryKey: ['payroll', 'gratuity', org] })),
    onError: (e) => {
      const p = ((e as { data?: { problems?: string[] } }).data?.problems ?? []).join(' ');
      toast('error', p ? `Finance refused it: ${p} Accrue the same date again once it is fixed.` : refusal(e));
      void qc.invalidateQueries({ queryKey: ['payroll', 'gratuity', org] });
    },
  });
  if (!org) return null;
  const d = q.data;
  return (
    <Card
      title={d ? `Gratuity provision · ${amt(d.liability)} as at ${shortDate(d.as_of)}` : 'Gratuity provision'}
      action={
        <span className="flex items-center gap-2">
          <CompanyPick org={org} setOrg={setOrg} orgs={orgs} />
          <input type="date" aria-label="As at" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-7 rounded-[7px] border border-line bg-surface px-2 text-[12px] text-ink" />
          {d?.can.accrue ? <button type="button" disabled={ro || accrue.isPending} onClick={() => accrue.mutate()} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white disabled:opacity-50">{accrue.isPending ? 'Accruing…' : 'Accrue to Finance'}</button> : null}
        </span>
      }
    >
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} /></div> : d === null ? <NotYet what="The gratuity provision" /> : d ? (
        <>
          {d.pack ? <p className="m-0 px-3.5 pb-2 text-[11.5px] text-ink-2">{`Rule pack ${d.pack}. The figures are the server's.`}</p> : <p className="m-0 px-3.5 pb-2 text-[12px] text-ink-3">No gratuity rule pack is set in Payroll settings.</p>}
          <Table head={['Employee', 'Basis', ['Amount', 'r']]}>
            {d.employees.map((e) => (
              <tr key={e.employee_id}>
                <td className={td}>{[e.employee_no, e.name].filter(Boolean).join(' · ')}</td>
                <td className={cx(td, 'whitespace-normal text-ink-2')}>{e.basis ?? ''}</td>
                <td className={tdr}>{amt(e.amount)}</td>
              </tr>
            ))}
          </Table>
          {d.accruals.length ? (
            <>
              <div className="px-3.5 pt-3 pb-1 text-[11px] font-bold tracking-[.6px] text-ink-2 uppercase">Accruals</div>
              <Table head={['As at', ['Liability', 'r'], ['Posted', 'r'], 'Journal', 'Status']}>
                {d.accruals.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{shortDate(a.as_of)}</td>
                    <td className={tdr}>{amt(a.liability)}</td>
                    <td className={tdr}>{amt(a.delta)}</td>
                    <td className={cx(td, 'font-mono text-[11px]')}>{a.journal_no ?? '—'}</td>
                    <td className={cx(td, 'whitespace-normal')}>
                      <Badge status={a.journal_no ? 'done' : 'failed'}>{a.status}</Badge>
                      {a.problems?.length ? <span className="ms-1 text-[11.5px] text-danger">{a.problems.join(' ')}</span> : null}
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
