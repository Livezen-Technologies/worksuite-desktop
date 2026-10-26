import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { send, withOrg } from './api';
import { Card, Cell, Empty, Field, Kpi, PageHeader, Sheet, THead, btn, btnBad, btnPrimary, btnSmall, input, row } from './parts';
import { companiesWhere, fieldErrors, refusal, type Options } from './types';
import { money, type Budget, type BudgetTotals, type CalendarItem } from './wsd';
import { StatGrid } from '../../components/StatCard';

const TONE: Record<CalendarItem['type'], string> = {
  email: 'bg-primary/15 text-primary', channel: 'bg-success/15 text-success', call: 'bg-warning/20 text-ink', journey: 'bg-[#7C3AED]/15 text-[#6D28D9] dark:text-[#C4B5FD]', event: 'bg-ground text-ink',
};
const WORD: Record<CalendarItem['type'], string> = { email: 'Email', channel: 'WhatsApp / SMS', call: 'Calls', journey: 'Journey', event: 'Event' };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The marketing calendar on the desktop (MKT-PLN-01): everything planned or running in a month, across channels. */
export function MarketingCalendar({ org, options }: { org: string; options: Options }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); });
  const [adding, setAdding] = useState<string | null>(null);
  const last = useMemo(() => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)), [month]);
  const q = useQuery({
    queryKey: ['marketing', 'calendar', org, iso(month)],
    queryFn: ({ signal }) => apiGet<{ items: CalendarItem[]; can: { manage: number[] } }>('/api/marketing/calendar', withOrg(org, { from: iso(month), to: iso(last) }), signal),
  });
  const mayAdd = (q.data?.can.manage ?? []).length > 0;
  const cells = useMemo(() => {
    const out: Array<Date | null> = Array.from({ length: (month.getUTCDay() + 6) % 7 }, () => null);
    for (let d = 1; d <= last.getUTCDate(); d++) out.push(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), d)));
    return out;
  }, [month, last]);
  const on = (d: Date) => (q.data?.items ?? []).filter((i) => i.start.slice(0, 10) <= iso(d) && (i.end ?? i.start).slice(0, 10) >= iso(d) && (i.type !== 'journey' || i.start.slice(0, 10) === iso(d) || d.getUTCDate() === 1));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Planning']} title="Calendar" sub="Everything planned or running, across channels."
        actions={(
          <>
            <button type="button" className={btnSmall} aria-label="Previous month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}><Icon name="chevron-left" size={14} /></button>
            <b className="w-36 text-center text-[13px] text-ink">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
            <button type="button" className={btnSmall} aria-label="Next month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}><Icon name="chevron-right" size={14} /></button>
            {mayAdd ? <button type="button" className={btnPrimary} onClick={() => setAdding(iso(new Date()))}><Icon name="plus" size={15} /> Event</button> : null}
          </>
        )} />
      <div className="flex flex-wrap gap-1.5 text-[11.5px]">{(Object.keys(WORD) as Array<CalendarItem['type']>).map((t) => <span key={t} className={cx('rounded px-2 py-0.5', TONE[t])}>{WORD[t]}</span>)}</div>
      {q.isLoading ? <Spinner label="Loading the calendar…" /> : q.error ? <ErrorNote error={new Error(refusal(q.error, 'The calendar could not be loaded.'))} onRetry={() => void q.refetch()} /> : (
        <div role="grid" aria-label="Marketing calendar" className="grid grid-cols-7 gap-px overflow-hidden rounded-[12px] border border-line bg-line text-[11.5px]">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader" className="bg-ground px-2 py-1 font-bold text-ink-3">{d}</div>)}
          {cells.map((d, i) => (
            <div key={i} role="gridcell" className="min-h-24 bg-surface p-1.5">
              {d ? (
                <>
                  <button type="button" disabled={!mayAdd} className="mb-1 font-bold text-ink-3 enabled:hover:text-primary" aria-label={`Add an event on ${iso(d)}`} onClick={() => setAdding(iso(d))}>{d.getUTCDate()}</button>
                  {on(d).slice(0, 4).map((it) => <div key={`${it.type}-${it.id}`} title={`${WORD[it.type]} · ${it.title} · ${it.status}`} className={cx('mb-0.5 truncate rounded px-1 py-0.5', TONE[it.type])}>{it.title}</div>)}
                  {on(d).length > 4 ? <div className="text-ink-3">+{on(d).length - 4} more</div> : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {adding ? <EventSheet options={options} day={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); void q.refetch(); }} /> : null}
    </div>
  );
}

function EventSheet({ options, day, onClose, onSaved }: { options: Options; day: string; onClose: () => void; onSaved: () => void }) {
  const companies = companiesWhere(options, 'budgets');
  const [f, setF] = useState({ org_id: String(companies[0]?.id ?? ''), title: '', kind: 'event', starts_at: `${day}T09:00`, ends_at: '', notes: '' });

  const save = async () => {
    try {
      await send('POST', '/api/marketing/calendar/events', { ...f, org_id: Number(f.org_id), starts_at: new Date(f.starts_at).toISOString(), ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null });
      onSaved();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  return (
    <Sheet title="Add to the calendar" onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void save()}>Add</button></>}>
      {companies.length > 1 ? <Field label="Company"><Select aria-label="Company" value={f.org_id} onValueChange={(v) => setF({ ...f, org_id: v })} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field> : null}
      <Field label="Title"><input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Kind"><Select aria-label="Kind" value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'event', label: 'Event' }, { value: 'launch', label: 'Launch' }, { value: 'deadline', label: 'Deadline' }, { value: 'other', label: 'Other' }]} /></Field>
      <Field label="Starts"><input type="datetime-local" className={input} value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
      <Field label="Ends (optional)"><input type="datetime-local" className={input} value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></Field>
      <Field label="Notes"><input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Sheet>
  );
}

/** Budgets & ROI on the desktop (MKT-PLN-02): planned against actual, and the server's cost per lead and ROI. */
export function Budgets({ org, options }: { org: string; options: Options }) {
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['marketing', 'budgets', org],
    queryFn: ({ signal }) => apiGet<{ items: Budget[]; totals: BudgetTotals; ref_types: Array<{ value: string; label: string }> }>('/api/marketing/budgets', withOrg(org), signal),
  });
  const may = companiesWhere(options, 'budgets').length > 0;
  const t = q.data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Planning']} title="Budgets & ROI" sub="Planned against actual, cost per lead and return."
        actions={may ? <button type="button" className={btnPrimary} onClick={() => setEditing('new')}><Icon name="plus" size={15} /> Budget</button> : null} />
      {t ? (
        <StatGrid min={180}>
          <Kpi icon="target" tone="blue" label="Planned" value={money(t.planned)} />
          <Kpi icon="wallet" label="Spent" value={money(t.cost)} tone={t.cost > t.planned ? 'red' : undefined} />
          <Kpi icon="user-plus" tone="violet" label="Leads" value={t.leads === null ? '—' : String(t.leads)} />
          <Kpi icon="calculator" tone="cyan" label="Cost per lead" value={money(t.cost_per_lead)} />
          <Kpi icon="trending-up" label="ROI" value={t.roi === null ? '—' : `${t.roi}%`} tone={t.roi === null ? undefined : t.roi < 0 ? 'red' : 'green'} />
        </StatGrid>
      ) : null}
      <Card padded={false}>
        {q.isLoading ? <Spinner label="Loading budgets…" /> : q.error ? <div className="p-4"><ErrorNote error={new Error(refusal(q.error, 'Budgets could not be loaded.'))} onRetry={() => void q.refetch()} /></div> : (
          <div className="overflow-x-auto scroll-thin">
            <div className="min-w-[900px]">
              <THead cols={[['Budget', null], ['Planned', 110], ['Spent', 110], ['Left', 110], ['Leads', 60], ['Cost / lead', 100], ['Revenue', 110], ['ROI', 70]]} />
              {(q.data?.items ?? []).map((b) => (
                <button key={b.id} type="button" disabled={!may} onClick={() => setEditing(b)} className={cx(row, 'w-full text-left enabled:hover:bg-subtle')}>
                  <Cell w={null}><b>{b.name}</b> <span className="text-ink-3">· {b.ref_name ?? b.ref_type}</span></Cell>
                  <Cell w={110} className="text-right tabular-nums">{money(b.planned, b.currency)}</Cell>
                  <Cell w={110} className="text-right tabular-nums">{money(b.cost, b.currency)}</Cell>
                  <Cell w={110} className={cx('text-right tabular-nums', b.remaining < 0 && 'text-danger')}>{money(b.remaining, b.currency)}</Cell>
                  <Cell w={60} className="text-right tabular-nums">{b.leads ?? '—'}</Cell>
                  <Cell w={100} className="text-right tabular-nums">{money(b.cost_per_lead)}</Cell>
                  <Cell w={110} className="text-right tabular-nums">{money(b.revenue)}</Cell>
                  <Cell w={70} className="text-right tabular-nums">{b.roi === null ? '—' : `${b.roi}%`}</Cell>
                </button>
              ))}
              {(q.data?.items ?? []).length === 0 ? <Empty text="No budgets yet." /> : null}
            </div>
          </div>
        )}
      </Card>
      {editing ? <BudgetSheet options={options} budget={editing === 'new' ? null : editing} refTypes={q.data?.ref_types ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void q.refetch(); }} /> : null}
    </div>
  );
}

function BudgetSheet({ options, budget, refTypes, onClose, onSaved }: { options: Options; budget: Budget | null; refTypes: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void }) {
  const companies = companiesWhere(options, 'budgets');
  const [f, setF] = useState({
    org_id: String(budget?.org_id ?? companies[0]?.id ?? ''), name: budget?.name ?? '', ref_type: budget?.ref_type ?? 'other', ref_id: budget?.ref_id ? String(budget.ref_id) : '',
    planned: String(budget?.planned ?? ''), actual: String(budget?.actual_manual ?? ''), currency: budget?.currency ?? '', expense_id: budget?.expense_id ? String(budget.expense_id) : '',
    period_start: budget?.period_start ?? '', period_end: budget?.period_end ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setErrors({});
    const body = { ...f, org_id: Number(f.org_id), ref_id: f.ref_id ? Number(f.ref_id) : null, planned: Number(f.planned || 0), actual: Number(f.actual || 0), expense_id: f.expense_id ? Number(f.expense_id) : null };
    try {
      await (budget ? send('PUT', `/api/marketing/budgets/${budget.id}`, body) : send('POST', '/api/marketing/budgets', body));
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    }
  };

  const remove = async () => {
    if (!budget) return;
    try {
      await send('DELETE', `/api/marketing/budgets/${budget.id}`);
      onSaved();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  const box = (k: keyof typeof f, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={errors[k] ?? hint}><input type={type} className={input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );

  return (
    <Sheet title={budget ? budget.name : 'New budget'} width={540} onClose={onClose}
      footer={<>{budget ? <button type="button" className={btnBad} onClick={() => void remove()}>Delete</button> : null}<button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void save()}>Save</button></>}>
      {!budget && companies.length > 1 ? <Field label="Company"><Select aria-label="Company" value={f.org_id} onValueChange={(v) => setF({ ...f, org_id: v })} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field> : null}
      {box('name', 'Name')}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="For"><Select aria-label="For" value={f.ref_type} onValueChange={(v) => setF({ ...f, ref_type: v })} options={refTypes} /></Field>
        {box('ref_id', 'Campaign number', 'Its id, to work out leads and ROI')}
        {box('planned', 'Planned')}
        {box('actual', 'Actual (typed)', 'Besides the expense claim and send costs')}
        {box('currency', 'Currency')}
        {box('expense_id', 'Expense claim number')}
        {box('period_start', 'From', undefined, 'date')}
        {box('period_end', 'Until', undefined, 'date')}
      </div>
    </Sheet>
  );
}
