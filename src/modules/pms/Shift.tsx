import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Section } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { day, errorText, K, pGet, type Payment, type Shift } from './api';
import { ShiftFacts } from './Cashier';
import { Money, NoAccess, usePms } from './parts';
import { printPage, shiftReportHtml } from './print';

/** One cashier shift with the payments it took (`/pms/cashier/<id>`, a night-audit blocker's link). */
export default function ShiftScreen({ id }: { id: number }) {
  const pms = usePms();
  const reads = pms.mayAny('pms.cashier.open', 'pms.cashier.close', 'pms.payment.view');
  const q = useQuery({ queryKey: K.shift(id), queryFn: ({ signal }) => pGet<{ session: Shift; payments: Payment[] }>(`/cashier-sessions/${id}`, undefined, signal), enabled: reads });
  const s = q.data?.session;
  useEffect(() => {
    if (s) pms.adopt(s.property_id);
  }, [s, pms]);
  if (!reads) return <NoAccess what="Cashier shifts are shown to cashiers and to people who may see payments." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !s) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The shift could not be loaded.')} /></div>;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={`Shift · ${s.cashier ?? ''}`} sub={`${s.terminal} · ${day(s.business_date, true)} · ${s.status_label}`}>
        <Button variant="ghost" icon="back" onClick={() => pms.go('cashier')}>
          Cashier
        </Button>
        <Button icon="printer" onClick={() => void printPage({ title: `Cashier shift ${s.business_date}`, html: shiftReportHtml(s, pms.property.name), kind: 'report' }).catch((e) => toast('error', errorText(e)))}>
          Print
        </Button>
      </PageHead>
      <Section title="Figures">
        <ShiftFacts s={s} />
      </Section>
      <Section title="Payments">
        {(q.data?.payments ?? []).length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">None.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
            {q.data!.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {p.kind_label} · {p.method_label} · {p.status_label}
                  {p.by ? ` · ${p.by}` : ''}
                </span>
                {p.folio_id ? (
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'folio', id: p.folio_id! })}>
                    Folio
                  </button>
                ) : null}
                <Money amount={p.amount} currency={p.currency} className="font-semibold" />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
