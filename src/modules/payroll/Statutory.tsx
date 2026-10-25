import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Spinner } from '../../components/ui';
import { shortDate } from '../finance/api';
import { fetchPacks, fetchReport, STATUTORY } from './api';
import { Badge, Card, NotYet, Pills, Table, td, tdr } from './parts';
import { saveReportCsv, ReportTable } from './Reports';
import { GratuityProvisionCard } from './PayrollExtras';
import { useReadOnly } from './parts';

/**
 * Statutory (D11): this run's contribution and tax schedules (EPF, ETF, APIT — `reports/statutory`) and the
 * statutory rule packs with their versions. The schedules are the server's; Save file… writes the rows it sent.
 */
type Tab = 'returns' | 'packs' | 'gratuity';

export default function Statutory({ runId }: { runId: number | null }) {
  const [tab, setTab] = useState<Tab>('returns');
  const ro = useReadOnly();
  const [cls, setCls] = useState(STATUTORY[0]!.cls);
  const rep = useQuery({ queryKey: ['payroll', 'statutory', runId, cls], queryFn: ({ signal }) => fetchReport('statutory', runId, { class: cls }, signal), enabled: tab === 'returns' });
  const packs = useQuery({ queryKey: ['payroll', 'packs'], queryFn: ({ signal }) => fetchPacks(signal), enabled: tab === 'packs' });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="m-0 text-[21px] font-extrabold text-ink">Statutory</h1>
        <div className="mt-0.5 text-[12px] text-ink-2">Returns and rule packs</div>
      </div>
      <Pills label="Statutory" value={tab} onChange={setTab} options={[{ id: 'returns', label: 'Returns' }, { id: 'packs', label: 'Rule packs' }, { id: 'gratuity', label: 'Gratuity' }]} />
      {tab === 'returns' ? (
        <>
          <Pills label="Return" value={cls} onChange={setCls} options={STATUTORY.map((s) => ({ id: s.cls, label: s.label }))} />
          <Card title={STATUTORY.find((s) => s.cls === cls)?.label} action={rep.data ? <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => void saveReportCsv(rep.data!, `${cls}-${rep.data!.run?.period_name ?? 'return'}`)}>Save file…</button> : null}>
            {rep.isLoading ? <Spinner /> : rep.error ? <div className="p-3"><ErrorNote error={rep.error} /></div> : rep.data === null ? <NotYet what="Statutory schedules" /> : rep.data ? <ReportTable r={rep.data} /> : null}
            <p className="m-0 px-3.5 py-2 text-[11px] text-ink-2">Save a return only when it matches the posted payable account. Record the portal reference after filing.</p>
          </Card>
        </>
      ) : tab === 'gratuity' ? (
        <GratuityProvisionCard ro={ro} />
      ) : (
        <Card title="Rule packs">
          {packs.isLoading ? <Spinner /> : packs.error ? <div className="p-3"><ErrorNote error={packs.error} /></div> : packs.data === null ? <NotYet what="Rule packs" /> : (
            <Table head={['Pack', 'Class', 'From', 'To', ['Rate', 'r'], 'Checksum', '']}>
              {(packs.data?.packs ?? []).flatMap((p) =>
                p.versions.map((v, i) => (
                  <tr key={v.id}>
                    <td className={td}>{i === 0 ? <b>{p.name}</b> : ''}</td>
                    <td className={td}>{p.class}</td>
                    <td className={td}>{shortDate(v.effective_from)}</td>
                    <td className={td}>{v.effective_to ? shortDate(v.effective_to) : '—'}</td>
                    <td className={tdr}>{v.rate ?? ''}</td>
                    <td className={`${td} font-mono text-[11px]`}>{v.checksum ? `${v.checksum.slice(0, 4)}…${v.checksum.slice(-4)}` : ''}</td>
                    <td className={td}>{!v.effective_to ? <Badge status="active">Active</Badge> : null}</td>
                  </tr>
                )),
              )}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
