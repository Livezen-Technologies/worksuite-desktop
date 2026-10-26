import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { importApply, importPreview, type ImportKind, type ImportPreview, type ImportResult, type Org } from './api';
import { chooseCsv, saveCsvText } from './files';
import type { Nav } from './HostingShell';
import { Btn, Card, Chip, Field, Kpi, Note, PageHead, Pills, Table, input, td, useReadOnly } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * Import domains or servers from a CSV (HDM-IMP-02, WF-10, the W13 board's steps): choose the file in the system's
 * dialog, the server guesses which column is which (change it here), and `POST import/preview` answers the dry run —
 * what would be added, updated, skipped and why, and the rows with errors. Nothing is saved until **Apply**, which
 * sends the file again (`POST import/apply`): the server plans afresh and writes what the plan says now. A synced
 * row only takes the company's own fields. The error rows come back as a CSV to save.
 */
type Step = 'file' | 'preview' | 'done';
const ACTION: Record<string, { tone: string; label: string }> = { add: { tone: 'green', label: 'Add' }, update: { tone: 'amber', label: 'Update' }, skip: { tone: 'grey', label: 'Skip' }, error: { tone: 'red', label: 'Error' } };

/** "expires_on" → "Expires on". */
export const fieldLabel = (f: string) => (f === 'ipv4' ? 'IPv4' : f === 'ipv6' ? 'IPv6' : f === 'os' ? 'OS' : f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
/** How many changes Apply makes: added and updated rows. */
export const changes = (p: Pick<ImportPreview, 'counts'>) => p.counts.add + p.counts.update;

export default function ImportCsv({ companies, org, nav }: { companies: Org[]; org: number; nav: Nav }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ImportKind>('domain');
  const [company, setCompany] = useState(org || companies[0]?.id || 0);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const step: Step = done ? 'done' : plan ? 'preview' : 'file';

  const preview = async (f: { name: string; text: string } | null, m?: Record<string, string>) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await importPreview(f, kind, company, m);
      setPlan(p);
      setMap(p.map);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    setErr(null);
    try {
      const f = await chooseCsv();
      if (!f) return;
      setFile(f);
      setMap({});
      setPlan(null);
      await preview(f);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const apply = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await importApply(file, kind, company, map);
      setDone(r);
      void qc.invalidateQueries({ queryKey: ['hosting'] });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const restart = () => (setFile(null), setPlan(null), setDone(null), setMap({}), setErr(null));
  const companyName = companies.find((c) => c.id === company)?.name;

  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <PageHead
        title={kind === 'domain' ? 'Import domains' : 'Import servers'}
        sub={file ? [file.name, plan ? text('{n} rows', { n: plan.rows.length }) : null, companyName ? text('into {company}', { company: companyName }) : null, step !== 'done' ? text('nothing is saved until you apply') : null].filter(Boolean).join(' · ') : 'A CSV file with a header row, at most 5 MB. Save an Excel sheet as CSV first.'}
      />
      <ol aria-label="Steps" className="m-0 flex list-none gap-4 p-0 text-[12px] text-ink-3">
        {(['file', 'preview', 'done'] as Step[]).map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined} className={cx(s === step && 'font-bold text-ink')}>
            {`${i + 1} ${s === 'file' ? text('Choose the file') : s === 'preview' ? text('Check the dry run') : text('Done')}`}
          </li>
        ))}
      </ol>
      {ro ? <Note tone="warn">Importing needs a connection.</Note> : null}
      {step === 'file' ? (
        <Card>
          <div className="flex flex-col gap-3 p-4">
            <Pills<ImportKind> label="What" value={kind} onChange={setKind} options={[{ id: 'domain', label: text('Domains') }, { id: 'server', label: text('Servers') }]} />
            {companies.length > 1 ? (
              <Field label="Company" className="max-w-[320px]">
                <Select aria-label="Company" value={company} onChange={(e) => setCompany(Number(e.target.value))} className={input}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <p className="m-0 text-[12.5px] text-ink-2">{kind === 'domain' ? text('Columns such as Domain, Registrar, Expiry, Auto renew, Customer, Project, Notes, Tags, Price and Currency are recognised; you can match the others next.') : text('Columns such as Name, Kind, Provider, Location, IP, OS, Plan, Expiry, Cost, Currency, Period, Customer and Project are recognised; you can match the others next.')}</p>
            <div>
              <Btn primary disabled={ro || busy || !company} onClick={() => void choose()}>
                {busy ? 'Reading…' : 'Choose a CSV file…'}
              </Btn>
            </div>
          </div>
        </Card>
      ) : null}
      {step === 'preview' && plan ? (
        <>
          <StatGrid min={180}>
            <Kpi icon="plus" tone="green" label="Will be added" value={plan.counts.add} />
            <Kpi icon="refresh" tone="blue" label="Will be updated" value={plan.counts.update} />
            <Kpi icon="ban" tone="neutral" label="Skipped" value={plan.counts.skip} />
            <Kpi icon="x-circle" label="Errors" value={plan.counts.error} tone={plan.counts.error ? 'warn' : undefined} />
          </StatGrid>
          <Card title="Match columns">
            <div className="grid grid-cols-2 gap-3 px-3.5 pb-3 md:grid-cols-4">
              {plan.headers.map((h, i) => (
                <Field key={`${i}-${h}`} label={h || text('Column {n}', { n: i + 1 })}>
                  <Select
                    aria-label={text('Field for {column}', { column: h || i + 1 })}
                    value={map[String(i)] ?? ''}
                    onChange={(e) => {
                      const next = Object.fromEntries(Object.entries(map).filter(([k, f]) => k !== String(i) && f !== e.target.value));
                      if (e.target.value) next[String(i)] = e.target.value;
                      setMap(next);
                    }}
                    className={input}
                  >
                    <option value="">{text('Not imported')}</option>
                    {plan.fields.map((f) => (
                      <option key={f} value={f}>
                        {text(fieldLabel(f))}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3.5 pb-3">
              <Btn disabled={busy || !Object.values(map).includes('name')} onClick={() => void preview(file, map)}>
                Check again with these columns
              </Btn>
              {!Object.values(map).includes('name') ? <span className="text-[12px] text-[#B42318]">Match one column to the name.</span> : null}
            </div>
          </Card>
          <Card title="Dry run">
            {busy ? <Spinner /> : (
              <Table head={['Row', 'Name', 'Action', 'Note']} label="Dry run">
                {plan.rows.slice(0, 500).map((r) => (
                  <tr key={r.line}>
                    <td className={cx(td, 'tabular-nums text-ink-3')}>{r.line}</td>
                    <td className={cx(td, 'font-semibold')}>{r.name || '—'}</td>
                    <td className={td}>
                      <Chip tone={ACTION[r.action]?.tone ?? 'grey'}>{text(ACTION[r.action]?.label ?? r.action)}</Chip>
                    </td>
                    <td className={cx(td, 'whitespace-normal text-ink-2')}>{r.why || (r.action === 'update' ? Object.keys(r.fields).map(fieldLabel).join(', ') : '')}</td>
                  </tr>
                ))}
              </Table>
            )}
            {plan.rows.length > 500 ? <p className="m-0 px-3.5 py-2 text-[11.5px] text-ink-3">{text('The first 500 of {n} rows.', { n: plan.rows.length })}</p> : null}
          </Card>
          <div className="flex justify-end gap-2">
            <Btn onClick={restart}>Back</Btn>
            <Btn primary disabled={ro || busy || !changes(plan)} onClick={() => void apply()}>
              {text('Apply {n} changes', { n: changes(plan) })}
            </Btn>
          </div>
        </>
      ) : null}
      {step === 'done' && done ? (
        <Card>
          <div className="flex flex-col gap-3 p-4">
            <Note tone={done.errors || done.failed ? 'warn' : 'ok'}>{done.message ?? text('{added} added, {updated} updated, {skipped} skipped, {errors} with errors.', { added: done.added, updated: done.updated, skipped: done.skipped, errors: done.errors + done.failed })}</Note>
            <div className="flex flex-wrap gap-2">
              {done.error_csv ? <Btn onClick={() => void saveCsvText(`hosting-import-errors`, done.error_csv!)}>{text('Download the {n} error rows', { n: done.errors })}</Btn> : null}
              <Btn onClick={restart}>Import another file</Btn>
              <Btn primary onClick={() => nav.to(kind === 'domain' ? 'domains' : 'servers')}>
                {kind === 'domain' ? 'Open Domains' : 'Open Servers'}
              </Btn>
            </div>
          </div>
        </Card>
      ) : null}
      {err ? <Note tone="error">{err}</Note> : null}
    </div>
  );
}
