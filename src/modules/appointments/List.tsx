import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { addDays, fetchList, K, money, saveCsv, today, toCsv, type Appointment } from './api';
import { Chips, Head, input, StatusPill, td, th, useDesk, useMove, useNow } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * D05 · Appointments list: queues (Today, Next 7 days, Pending, Late, Deposit due, Cancelled and no-shows), stylist and
 * service filters, and the keyboard: ↑ ↓ to move, Enter to open, Space to select, C to check in the selected. Export
 * saves what is shown as CSV. The rows are the server's, a page of 14 at a time.
 */
type Queue = 'today' | 'week' | 'pending' | 'late' | 'deposit' | 'closed';
const PER = 14;

export default function List({ active }: { active: boolean }) {
  const desk = useDesk();
  const move = useMove();
  const [queue, setQueue] = useState<Queue>('week');
  const [provider, setProvider] = useState<number | null>(null);
  const [service, setService] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [paged, setPaged] = useState({ k: '', p: 0 });
  const [cursorAt, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const t = today();
  const range = queue === 'today' || queue === 'late' ? { from: t, to: t } : queue === 'closed' ? { from: addDays(t, -30), to: t } : { from: t, to: addDays(t, 6) };
  const q = useQuery({
    queryKey: K.range({ ...range, list: 1, provider, loc: desk.location, text }),
    queryFn: ({ signal }) => fetchList({ ...range, provider, location: desk.location, q: text.trim() || undefined }, signal),
  });
  const now = useNow();
  const rows = useMemo(() => {
    const all = (q.data?.items ?? []).filter((a) => !service || a.service.id === service);
    const by: Record<Queue, (a: Appointment) => boolean> = {
      today: (a) => a.status !== 'cancelled',
      week: (a) => a.status !== 'cancelled' && a.status !== 'no_show',
      pending: (a) => a.status === 'pending',
      late: (a) => (a.status === 'pending' || a.status === 'confirmed') && Date.parse(a.starts_at) < now,
      deposit: (a) => !!a.deposit && a.deposit.outstanding > 0,
      closed: (a) => a.status === 'cancelled' || a.status === 'no_show',
    };
    return all.filter(by[queue]).sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  }, [q.data, queue, service, now]);
  // A new queue or filter starts at page one.
  const fkey = `${queue}|${provider}|${service}|${text}`;
  const page = paged.k === fkey ? paged.p : 0;
  const setPage = (f: (p: number) => number) => setPaged({ k: fkey, p: f(page) });
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const shown = rows.slice(page * PER, page * PER + PER);
  const tableRef = useRef<HTMLTableElement>(null);

  const cursor = Math.min(cursorAt, Math.max(0, shown.length - 1));

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]') || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const a = shown[cursor];
      if (e.key === 'ArrowDown') setCursor((c) => Math.min(shown.length - 1, c + 1));
      else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
      else if (e.key === 'Enter' && a) desk.open(a.id);
      else if (e.key === ' ' && a) setPicked((p) => { const n = new Set(p); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; });
      else if ((e.key === 'c' || e.key === 'C') && a) {
        const targets = picked.size ? shown.filter((x) => picked.has(x.id)) : [a];
        for (const x of targets) if (x.next.some((n) => n.status === 'checked_in' && n.allowed)) void move(x, 'checked_in');
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, shown, cursor, picked, desk, move]);

  const exportCsv = async () => {
    const head = ['When', 'Number', 'Client', 'Service', 'Stylist', 'Location', 'Status', 'Deposit due', 'Deposit held'];
    const body = rows.map((a) => [`${a.local.date} ${a.local.start}`, a.number, a.customer.name, a.service.name, a.provider.name, a.location.name, a.status_label, a.deposit?.due ?? '', a.deposit?.held ?? '']);
    const where = await saveCsv(`appointments-${range.from}-${range.to}.csv`, toCsv(head, body));
    if (where) toast('success', `Saved to ${where}`);
  };

  const count = (f: (a: Appointment) => boolean) => (q.data?.items ?? []).filter(f).length || null;
  return (
    <div>
      <Head title="Appointments" sub={q.data?.truncated ? 'More than the server sends at once — narrow the filters.' : undefined}>
        <Button variant="secondary" icon="download" disabled={!rows.length} onClick={() => void exportCsv()}>Export</Button>
      </Head>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chips
          label="Queue"
          value={queue}
          onChange={setQueue}
          options={[
            { id: 'today', label: 'Today' },
            { id: 'week', label: 'Next 7 days' },
            { id: 'pending', label: 'Pending', n: count((a) => a.status === 'pending') },
            { id: 'late', label: 'Late' },
            { id: 'deposit', label: 'Deposit due', n: count((a) => !!a.deposit && a.deposit.outstanding > 0) },
            { id: 'closed', label: 'Cancelled & no-shows' },
          ]}
        />
        <span className="flex-1" />
        <input className={cx(input, 'w-[200px]')} placeholder="Search client or number" aria-label="Search" value={text} onChange={(e) => setText(e.target.value)} />
        <select className={cx(input, 'w-auto')} aria-label="Stylist" value={provider ?? ''} onChange={(e) => setProvider(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Every stylist</option>
          {(desk.options?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={cx(input, 'w-auto')} aria-label="Service" value={service ?? ''} onChange={(e) => setService(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Every service</option>
          {(desk.options?.services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
        <table ref={tableRef} className="w-full border-collapse text-[12.5px] text-ink" aria-label="Appointments">
          <thead>
            <tr>
              <th className={th} aria-label="Selected" />
              {['When ↑', 'Number', 'Client', 'Service', 'Stylist', 'Location', 'Status', 'Deposit'].map((h) => <th key={h} className={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((a, i) => (
              <tr tabIndex={0} onKeyDown={clickOnKey} key={a.id} aria-selected={i === cursor} onClick={() => (setCursor(i), desk.open(a.id))} className={cx('cursor-pointer', i === cursor ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={td}>
                  <Checkbox aria-label={`Select ${a.number}`} checked={picked.has(a.id)} onClick={(e) => e.stopPropagation()} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} />
                </td>
                <td className={cx(td, 'tabular-nums')}>{`${a.local.date === t ? 'Today' : a.local.date} ${a.local.start}`}</td>
                <td className={cx(td, 'font-mono text-[11.5px]')}>{a.number}</td>
                <td className={cx(td, 'font-semibold')}>{a.customer.name}</td>
                <td className={td}>{a.service.name}</td>
                <td className={td}>{a.provider.name}</td>
                <td className={td}>{a.location.name}</td>
                <td className={td}><StatusPill a={a} /></td>
                <td className={td}>{a.deposit ? (a.deposit.outstanding > 0 ? `${money(a.deposit.outstanding, a.deposit.currency)} due` : `${money(a.deposit.held, a.deposit.currency)} held`) : '—'}</td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={9} className="px-3 py-6 text-center text-[12.5px] text-ink-3">{q.isPending ? 'Reading…' : q.isError ? 'The list could not be read.' : 'Nothing here.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-3">
        <span>{rows.length ? `${page * PER + 1}–${Math.min(rows.length, page * PER + PER)} of ${rows.length}` : ''}</span>
        <span className="flex-1">↑ ↓ to move · Enter to open · Space to select · C check in</span>
        <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
        <span>{`Page ${page + 1} of ${pages}`}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>›</Button>
      </div>
    </div>
  );
}
