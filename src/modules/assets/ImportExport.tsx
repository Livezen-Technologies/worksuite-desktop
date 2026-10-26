import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { refusal } from '../finance/api';
import { importAssets, parseCsv, type Company, type ImportResult } from './api';
import { exportRegister } from './Register';
import { Badge, Btn, Card, Field, Note, NotYet, PageHead, Table, input, td } from './parts';

/**
 * Import & export (D21, T-10). A register file is chosen in the system's open dialog and read on this computer — nothing
 * is sent until the check: the server's dry run says which rows are ready, which it fixed (a category matched, a default
 * life) and which it skips (a serial already used, a bad date). Import sends the same rows; all of them save together
 * or none do. Labels can be printed for what was made. Export saves the register as CSV. Needs Assets 1.1 for import.
 */
export const COLUMNS = ['name', 'category', 'brand', 'model', 'serial_number', 'barcode', 'purchase_date', 'purchase_price', 'currency', 'branch', 'room', 'condition', 'life_months'];

export default function ImportExport({ org, companies, onLabels }: { org: number; companies: Company[]; onLabels: (ids: number[]) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; folder: string; rows: Array<Record<string, string>>; head: string[] } | null>(null);
  const [company, setCompany] = useState(org || companies[0]?.id || 0);
  const [location, setLocation] = useState('');
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [none, setNone] = useState(false);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    try {
      const f = await call('assets:openFile', { title: 'Choose a register file' });
      if (!f) return;
      const p = parseCsv(f.text);
      if (!p.head.includes('name')) return toast('error', 'The first row must name the columns, with a "name" column.');
      setFile({ name: f.name, folder: f.folder, rows: p.rows, head: p.head });
      setCheck(null);
      setNone(false);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const send = async (dry: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const rows = location.trim() ? file.rows.map((r) => ({ branch: location.trim(), ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '')) })) : file.rows;
      const r = await importAssets({ rows, org_id: company, apply: !dry });
      if (r === null) return setNone(true);
      if (dry) setCheck(r);
      else {
        void qc.invalidateQueries({ queryKey: ['assets'] });
        const ids = r.created ?? [];
        toast('success', `${ids.length} assets added, ${r.updated?.length ?? 0} updated.`);
        setFile(null);
        setCheck(null);
        if (ids.length) onLabels(ids);
      }
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const doExport = async () => {
    setBusy(true);
    try {
      if (await exportRegister({ org: org || undefined })) toast('success', 'Register saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const issues = (check?.rows ?? []).filter((r) => r.errors?.length || r.warnings?.length || r.action === 'skip');
  const s = check?.summary;
  const importable = s && !s.error ? s.create + s.update : 0;

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
        <PageHead title={file ? `Check: ${file.name}` : 'Import & export'} sub={file ? `${file.rows.length} rows · from ${file.folder}` : 'A CSV or tab-separated file; save an Excel sheet as CSV first'}>
          <Btn onClick={() => void choose()}>{file ? 'Change file' : 'Choose file…'}</Btn>
          <Btn disabled={busy} onClick={() => void doExport()}>Export register</Btn>
        </PageHead>
        {none ? <Card><NotYet what="Importing assets" /></Card> : null}
        {file && !check ? (
          <Card title="First rows">
            <Table head={file.head.slice(0, 7)}>
              {file.rows.slice(0, 6).map((r, i) => (
                <tr key={i}>{file.head.slice(0, 7).map((h) => <td key={h} className={td}>{r[h]}</td>)}</tr>
              ))}
            </Table>
            <p className="m-0 px-3.5 py-2 text-[11.5px] text-ink-3">{`Columns read: ${file.head.join(', ')}. Known: ${COLUMNS.join(', ')}.`}</p>
          </Card>
        ) : null}
        {check ? (
          <>
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              <Badge status="approved">{`${s?.create ?? 0} new`}</Badge>
              <Badge status="pending">{`${s?.update ?? 0} updates`}</Badge>
              <Badge status="rejected">{`${s?.error ?? 0} with errors`}</Badge>
            </div>
            <Card>
              <Table head={['Row', 'Asset', 'Found', 'Action']}>
                {issues.map((r) => (
                  <tr key={r.row}>
                    <td className={td}>{r.row}</td>
                    <td className={td}>{r.asset_code ?? file?.rows[r.row - 2]?.name ?? ''}</td>
                    <td className="border-b border-line/70 px-2.5 py-2">{[...(r.errors ?? []), ...(r.warnings ?? [])].join(' · ')}</td>
                    <td className={td}><Badge status={r.errors?.length ? 'rejected' : 'pending'}>{r.errors?.length ? 'Error' : r.action === 'update' ? 'Update' : r.action === 'skip' ? 'Skip' : 'Warning'}</Badge></td>
                  </tr>
                ))}
              </Table>
              {!issues.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Every row is ready.</p> : null}
            </Card>
          </>
        ) : null}
      </div>
      <aside aria-label="Import settings" className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">Import settings</h2>
        <Field label="Company">
          <select className={input} value={company} onChange={(e) => (setCompany(Number(e.target.value)), setCheck(null))}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Default location"><input className={input} value={location} onChange={(e) => (setLocation(e.target.value), setCheck(null))} /></Field>
        {!check ? (
          <Btn primary disabled={!file || busy || !company} onClick={() => void send(true)}>Check the file</Btn>
        ) : (
          <>
            <Note>{importable ? `All ${importable} rows save together, or none do.` : 'Fix the rows with errors in the file and check it again — nothing is imported while one has an error.'}</Note>
            <Btn primary disabled={busy || !importable} onClick={() => void send(false)}>{`Import ${importable} assets`}</Btn>
          </>
        )}
        <p className="m-0 text-[11px] text-ink-3">File read on this computer — nothing is uploaded until you check it.</p>
      </aside>
    </div>
  );
}
