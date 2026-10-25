import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { calculateRun, createRun, fetchGroups, fetchPeriods } from './api';

/**
 * New payroll run (D03), ⌘N: the pay group and its open period, the kind of run, then Create & calculate. The
 * server refuses a second regular run for a period, a closed Finance period and the rest — its reason is shown as
 * it said it. A final settlement run is made from its settlement case, so it is not offered here. Esc closes,
 * ⌘↵ creates.
 */
const KINDS: Array<{ id: string; label: string; sub: string }> = [
  { id: 'regular', label: 'Regular', sub: 'Monthly pay for the whole group' },
  { id: 'off_cycle', label: 'Off-cycle', sub: 'Corrections, held staff, late joiners' },
  { id: 'bonus', label: 'Bonus', sub: 'One-time payments only' },
  { id: 'correction', label: 'Correction', sub: 'Puts right a run already paid' },
];

export default function NewRun({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['payroll', 'groups'], queryFn: ({ signal }) => fetchGroups(signal), staleTime: 300_000 });
  const [group, setGroup] = useState(0);
  const g = group || groups.data?.groups.find((x) => x.is_active !== 0 && x.is_active !== false)?.id || 0;
  const periods = useQuery({ queryKey: ['payroll', 'periods', g], queryFn: ({ signal }) => fetchPeriods(g, signal), enabled: g > 0 });
  const open = (periods.data?.periods ?? []).filter((p) => p.status !== 'closed');
  const [period, setPeriod] = useState(0);
  const p = period || open[0]?.id || 0;
  const [kind, setKind] = useState('regular');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!p || busy) return;
    setBusy(true);
    try {
      const r = await createRun(p, kind);
      const id = Number(r.id ?? r.run_id);
      try {
        await calculateRun(id);
      } catch (e) {
        toast('error', refusal(e));
      }
      void qc.invalidateQueries({ queryKey: ['payroll'] });
      onCreated(id);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void create();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const fld = 'flex flex-col gap-[5px] text-[12px] font-semibold text-ink-2';
  const inp = 'h-9 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(15,27,61,0.42)] pt-[110px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-run" className="w-[min(600px,calc(100%-32px))] overflow-hidden rounded-[14px] bg-surface shadow-[0_24px_60px_rgba(15,27,61,0.35)]">
        <div className="flex items-center border-b border-line px-5 pt-4 pb-3">
          <h2 id="new-run" className="m-0 flex-1 text-[17px] font-extrabold text-ink">New payroll run</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-[30px] items-center justify-center text-ink-2 hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <label className={fld}>
              Pay group
              <Select className={inp} value={g} onChange={(e) => (setGroup(Number(e.target.value)), setPeriod(0))}>
                {(groups.data?.groups ?? []).map((x) => (
                  <option key={x.id} value={x.id}>{`${x.name} · ${x.currency}`}</option>
                ))}
              </Select>
            </label>
            <label className={fld}>
              Period
              <Select className={inp} value={p} onChange={(e) => setPeriod(Number(e.target.value))}>
                {open.length ? null : <option value={0}>No open period</option>}
                {open.map((x) => (
                  <option key={x.id} value={x.id}>{`${x.name}${x.payment_date ? ` · pay ${shortDate(x.payment_date)}` : ''}`}</option>
                ))}
              </Select>
            </label>
          </div>
          <div role="radiogroup" aria-label="Run type" className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <label key={k.id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-[9px] border px-3 py-2.5 text-[12.5px]', kind === k.id ? 'border-2 border-primary bg-[#F5F7FF] dark:bg-selection' : 'border-line')}>
                <input type="radio" name="run-kind" checked={kind === k.id} onChange={() => setKind(k.id)} />
                <span>
                  <b className="text-ink">{k.label}</b>
                  <br />
                  <span className="text-[11.5px] text-ink-2">{k.sub}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="m-0 rounded-[9px] border border-line bg-ground px-3 py-2 text-[12px] text-ink-2">The server checks the group, the period and the inputs when the run is created, and calculates it straight away. Anything it finds is on the run's Validation tab.</p>
        </div>
        <div className="flex items-center gap-2 border-t border-line bg-ground px-5 py-3">
          <span className="flex-1 text-[11.5px] text-ink-2">Esc closes · ⌘↵ creates</span>
          <button type="button" onClick={onClose} className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink">
            Cancel
          </button>
          <button type="button" disabled={!p || busy} onClick={() => void create()} className="h-8 rounded-[7px] bg-primary px-3.5 text-[12.5px] font-bold text-white disabled:opacity-50">
            {busy ? 'Creating…' : 'Create & calculate'}
          </button>
        </div>
      </div>
    </div>
  );
}
