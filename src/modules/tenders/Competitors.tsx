import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { createCompetitor, deleteCompetitor, fieldErrors, fetchCompetitors, K, KC, lowestBid, money, updateCompetitor, type Competitor, type CompetitorDraft } from './api';

/**
 * Competitors: who else bid on a submitted tender, and at what price. The
 * server opens it once the tender is submitted, sorts it and says who may
 * change it; the lowest bid is marked. A refusal of a field is shown under
 * that field.
 */
export default function Competitors({ id }: { id: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KC.competitors(id), queryFn: ({ signal }) => fetchCompetitors(id, signal) });
  const [sheet, setSheet] = useState<'new' | Competitor | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KC.competitors(id) });
    void qc.invalidateQueries({ queryKey: K.tender(id) });
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  if (!data.available) return <Empty text={data.reason ?? 'Competitors can be recorded once the tender is submitted.'} />;
  const list = [...data.competitors].sort((a, b) => Number(a.bid_price) - Number(b.bid_price));
  const lowest = lowestBid(list);
  const edit = data.can.edit;

  const remove = async (c: Competitor) => {
    setBusy(true);
    try {
      await deleteCompetitor(id, c.id);
      toast('success', `${c.company_name} was removed.`);
      setDeleting(null);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-[13.5px] text-ink">{list.length ? `${list.length} ${list.length === 1 ? 'competitor' : 'competitors'}` : 'No competitors recorded'}</b>
          <span className="text-[12px] text-ink-3">Other bidders and their prices, lowest first.</span>
        </span>
        {edit ? (
          <button type="button" className={btnPrimary} onClick={() => setSheet('new')}>
            <Icon name="plus" size={15} /> Add competitor
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        {list.length ? (
          <table className="w-full text-[12.5px]" aria-label="Competitors">
            <thead>
              <tr className="border-b border-line text-start text-[11.5px] text-ink-3">
                <th className="px-3.5 py-2 text-start font-semibold">Company</th>
                <th className="px-3.5 py-2 text-end font-semibold">Bid price</th>
                <th className="px-3.5 py-2 text-start font-semibold">Remarks</th>
                <th className="px-3.5 py-2 text-start font-semibold">Recorded</th>
                {edit ? <th className="px-3.5 py-2" aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} data-competitor={c.id} data-lowest={c.id === lowest ? '1' : undefined} className={cx('border-b border-line/60 last:border-b-0', c.id === lowest && 'bg-[rgb(var(--ws-success-rgb,22_163_74)/.08)]')}>
                  <td className="px-3.5 py-2 text-ink">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b>{c.company_name}</b>
                      {c.id === lowest ? <Pill tone="green">Lowest</Pill> : null}
                    </span>
                  </td>
                  <td className="px-3.5 py-2 text-end text-ink tabular-nums">{money(c.bid_price, c.currency)}</td>
                  <td className="px-3.5 py-2 text-ink-2">{c.remarks ?? '—'}</td>
                  <td className="px-3.5 py-2 text-ink-3">{[c.updated_by?.name ?? c.created_by?.name, dateLabel(c.updated_at ?? c.created_at)].filter(Boolean).join(' · ')}</td>
                  {edit ? (
                    <td className="px-3.5 py-2 text-end">
                      {deleting === c.id ? (
                        <span className="inline-flex items-center gap-1.5" role="group" aria-label="Confirm delete">
                          <span className="text-ink">Delete {c.company_name}?</span>
                          <button type="button" className={btnSmall + ' !text-danger'} disabled={busy} onClick={() => void remove(c)}>
                            Delete
                          </button>
                          <button type="button" className={btnSmall} onClick={() => setDeleting(null)}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          <button type="button" aria-label={`Edit ${c.company_name}`} title="Edit" className={cx(btnSmall, '!h-7 !w-7 justify-center !px-0')} onClick={() => setSheet(c)}>
                            <Icon name="compose" size={13} />
                          </button>
                          <button type="button" aria-label={`Delete ${c.company_name}`} title="Delete" className={cx(btnSmall, '!h-7 !w-7 justify-center !px-0 !text-danger')} onClick={() => setDeleting(c.id)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text={edit ? 'No competitors yet. Add the other bidders as the results come in.' : 'No competitors yet.'} />
        )}
      </div>
      {sheet ? <CompetitorSheet tenderId={id} currency={data.currency} competitor={sheet === 'new' ? null : sheet} onClose={() => setSheet(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function CompetitorSheet({ tenderId, currency, competitor, onClose, onSaved }: { tenderId: number; currency: string; competitor: Competitor | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<CompetitorDraft>({
    company_name: competitor?.company_name ?? '',
    bid_price: competitor?.bid_price ?? '',
    currency: competitor?.currency ?? currency,
    remarks: competitor?.remarks ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CompetitorDraft) => (e: { target: { value: string } }) => (setD({ ...d, [k]: e.target.value }), setErrors({ ...errors, [k]: '' }));

  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      if (competitor) await updateCompetitor(tenderId, competitor.id, d);
      else await createCompetitor(tenderId, d);
      toast('success', competitor ? 'Saved.' : `${d.company_name.trim()} was added.`);
      onSaved();
      onClose();
    } catch (x) {
      const f = fieldErrors(x);
      if (f) setErrors(f);
      else setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  const err = (k: string) => (errors[k] ? <span className="text-[11.5px] font-medium text-danger">{errors[k]}</span> : null);

  return (
    <Sheet
      title={competitor ? `Edit ${competitor.company_name}` : 'Add competitor'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !d.company_name.trim() || !d.bid_price.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Field label="Company">
        <input aria-label="Company" autoFocus value={d.company_name} maxLength={200} onChange={set('company_name')} className={input} />
        {err('company_name')}
      </Field>
      <div className="grid grid-cols-[1fr_110px] gap-2.5">
        <Field label="Bid price">
          <input aria-label="Bid price" inputMode="decimal" value={d.bid_price} onChange={set('bid_price')} placeholder="e.g. 12500000" className={input} />
          {err('bid_price')}
        </Field>
        <Field label="Currency">
          <input aria-label="Currency" value={d.currency} maxLength={3} onChange={set('currency')} className={input} />
          {err('currency')}
        </Field>
      </div>
      <Field label="Remarks">
        <textarea aria-label="Remarks" value={d.remarks} maxLength={2000} rows={3} onChange={set('remarks')} className={cx(input, '!h-auto py-2')} />
        {err('remarks')}
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
