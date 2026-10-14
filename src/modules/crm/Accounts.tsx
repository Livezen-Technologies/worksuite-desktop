import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Field, input, PageHead, Sheet } from '../hr/parts';
import type { Account, AccountDetail } from './api';
import { TimelineList, useOwners } from './Leads';
import { crmCan, initialsOf, money, moneyFull, stageColour, StatusBar } from './parts';
import { Checkbox } from '../../components/Checkbox';
import { pageOf, statusLine, type PageMeta } from './logic';
import { exportCrmCsv } from './exportCsv';
import { NewDeal } from './Pipeline';
import { ScheduleFollowUp } from './Schedule';
import { CompanyField, orgIdFor, useCrmScope } from './scope';

/**
 * Accounts (CrmAccounts, desk-account): the customers, prospects and
 * partners of the company the CRM is showing, with Export and the StatusBar;
 * and one of them as a Customer 360 page — what is open, what was won, who
 * works there, the deals, quotes, projects and meetings, and its timeline
 * with a note box, plus New deal, New quote and Schedule a follow-up on the
 * account. Type, health and owner are set here; health is set by a person,
 * never guessed. Accounts are the `clients` rows Projects and Meetings use
 * too, and there is no delete.
 */
const TYPES: Array<[string, string]> = [
  ['prospect', 'Prospect'],
  ['customer', 'Customer'],
  ['partner', 'Partner'],
  ['vendor', 'Vendor'],
  ['competitor', 'Competitor'],
  ['other', 'Other'],
];
const HEALTH: Record<string, [string, string]> = {
  good: ['Good', 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success'],
  watch: ['Watch', 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning'],
  at_risk: ['At risk', 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
};

interface AccountList {
  accounts: Account[];
  total?: number;
  page?: number;
  has_more?: boolean;
  meta?: Partial<PageMeta>;
}

function TypeChip({ type }: { type: string }) {
  return <span className="rounded-full bg-selection px-2 py-0.5 text-[11.5px] font-bold text-primary capitalize">{type}</span>;
}

function HealthChip({ health }: { health: string | null }) {
  if (!health) return <span className="text-ink-3">—</span>;
  const [label, cls] = HEALTH[health] ?? [health, 'bg-subtle text-ink-2'];
  return <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', cls)}>{label}</span>;
}

export default function Accounts({ openId, creating, initialQuery = '', onOpen, onNew, onCloseNew, onOpenDeal, onOpenQuote, onNewQuote }: { openId: number | null; creating: boolean; initialQuery?: string; onOpen: (id: number | null) => void; onNew: () => void; onCloseNew: () => void; onOpenDeal: (id: number) => void; onOpenQuote: (id: number) => void; onNewQuote: (accountId: number) => void }) {
  const qc = useQueryClient();
  const scope = useCrmScope();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canEdit = crmCan(perms, 'crm.account');
  const canExport = crmCan(perms, 'crm.export');
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState('');
  const [mine, setMine] = useState(false);
  const params = { q: q.trim() || undefined, type: type || undefined, mine: mine ? 1 : undefined, ...scope.params, per_page: 50 };
  const list = useInfiniteQuery({
    queryKey: ['crm', 'accounts', params],
    queryFn: ({ pageParam, signal }) => apiGet<AccountList>('/api/crm/accounts', { ...params, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const m = pageOf(last, last.accounts.length);
      return m.has_more ? m.page + 1 : undefined;
    },
  });
  const rows = list.data?.pages.flatMap((p) => p.accounts) ?? [];
  const first = list.data?.pages[0];
  const meta = first ? pageOf(first, rows.length) : null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const exportList = () => {
    const { per_page: _perPage, ...filters } = params;
    void exportCrmCsv('/api/crm/accounts/export', filters, 'accounts', () => [
      ['Name', 'Type', 'Health', 'Owner', 'Industry', 'Email', 'Phone', 'Contacts', 'Open deals', 'Open value', 'Currency', 'Last activity'],
      ...rows.map((a) => [a.name, a.account_type, a.health, a.owner_name, a.industry, a.email, a.phone, a.contact_count, a.deal_count, a.open_value, a.currency, a.last_activity_at]),
    ]);
  };

  if (openId) {
    return (
      <>
        <Account360 key={openId} id={openId} onBack={() => onOpen(null)} onChanged={refresh} onOpenDeal={onOpenDeal} onOpenQuote={onOpenQuote} onNewQuote={onNewQuote} />
        {creating && canEdit ? <NewAccount onClose={onCloseNew} onCreated={(id) => (refresh(), onCloseNew(), onOpen(id))} /> : null}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead title="Accounts" sub={scope.name}>
        {canExport ? (
          <button type="button" className={btn} onClick={exportList}>
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            New account
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, contact" aria-label="Search accounts" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <Select label="Type" value={type} onValueChange={setType} options={[{ value: '', label: 'Any type' }, ...TYPES.map(([v, l]) => ({ value: v, label: l }))]} />
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
          <Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Mine only
        </label>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-[#F7F8FB] px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
          <span className="w-[240px] shrink-0">Account</span>
          <span className="w-[100px] shrink-0">Type</span>
          <span className="w-[90px] shrink-0">Health</span>
          <span className="w-[130px] shrink-0">Owner</span>
          <span className="w-[80px] shrink-0 text-right">Contacts</span>
          <span className="w-[90px] shrink-0 text-right">Open deals</span>
          <span className="w-[110px] shrink-0 text-right">Open value</span>
          <span className="min-w-0 flex-1 pl-3">Activity</span>
        </div>
        <div className="min-h-0 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {rows.map((a) => (
            <div key={a.id} data-account={a.id} className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] hover:bg-subtle', openId === a.id && 'bg-selection')} onClick={() => onOpen(a.id)}>
              <span className="flex w-[240px] min-w-0 shrink-0 flex-col">
                <b className="truncate text-ink">{a.name}</b>
                <span className="truncate text-[11.5px] text-ink-3">{[a.industry, a.email ?? a.contact_person].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              <span className="w-[100px] shrink-0">
                <TypeChip type={a.account_type} />
              </span>
              <span className="w-[90px] shrink-0">
                <HealthChip health={a.health} />
              </span>
              <span className={cx('w-[130px] shrink-0 truncate', a.owner_name ? 'text-ink' : 'text-ink-3')}>{a.owner_name ?? 'Nobody'}</span>
              <span className="w-[80px] shrink-0 text-right text-ink tabular-nums">{a.contact_count ?? 0}</span>
              <span className="w-[90px] shrink-0 text-right text-ink tabular-nums">{a.deal_count ?? 0}</span>
              <span className="w-[110px] shrink-0 text-right font-semibold text-ink">{a.open_value ? money(a.open_value, a.currency) : '—'}</span>
              <span className="min-w-0 flex-1 truncate pl-3 text-[12px] text-ink-3">{a.last_activity_at ? relative(a.last_activity_at) : '—'}</span>
            </div>
          ))}
          {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">No accounts match.</p> : null}
        </div>
        <StatusBar
          right={
            list.hasNextPage ? (
              <button type="button" className={btnSmall} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            ) : null
          }
        >
          {meta ? `${rows.length} of ${statusLine(['account', 'accounts'], meta, TYPES.map(([v, l]) => [v, l.toLowerCase() + (v === 'other' ? '' : 's')]))}` : null}
        </StatusBar>
      </div>

      {creating && canEdit ? <NewAccount onClose={onCloseNew} onCreated={(id) => (refresh(), onCloseNew(), onOpen(id))} /> : null}
    </div>
  );
}

function Account360({ id, onBack, onChanged, onOpenDeal, onOpenQuote, onNewQuote }: { id: number; onBack: () => void; onChanged: () => void; onOpenDeal: (id: number) => void; onOpenQuote: (id: number) => void; onNewQuote: (accountId: number) => void }) {
  const qc = useQueryClient();
  const owners = useOwners();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canEdit = crmCan(perms, 'crm.account');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [newDeal, setNewDeal] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const q = useQuery({ queryKey: ['crm', 'account', id], queryFn: ({ signal }) => apiGet<AccountDetail>(`/api/crm/accounts/${id}`, undefined, signal), staleTime: 0, refetchOnMount: 'always' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['crm', 'account', id] });
    onChanged();
  };
  const save = async (patch: Record<string, unknown>, done = 'Saved.') => {
    try {
      await apiPut(`/api/crm/accounts/${id}`, patch);
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const addNote = async () => {
    const title = note.trim();
    if (!title) return;
    try {
      await apiPost(`/api/crm/accounts/${id}/activity`, { kind: 'note', title });
      setNote('');
      toast('success', 'Note added.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const d = q.data;
  const a = d?.account;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button type="button" className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={onBack}>
        <Icon name="back" size={13} /> Accounts
      </button>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d && a ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[10px] bg-[#0F172A] text-[15px] font-bold text-white dark:bg-well">{initialsOf(a.name)}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="m-0 truncate text-[20px] font-bold text-ink">{a.name}</h1>
              <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
                {a.industry ? <span>{a.industry} ·</span> : null}
                <TypeChip type={a.account_type} />
                <HealthChip health={a.health} />
                <span>· {a.owner_name ?? 'Nobody owns it'}</span>
              </span>
            </div>
            <button type="button" className={btn} onClick={() => void call('windows:open', { kind: 'record', route: `/crm?tab=acc&account=${id}`, title: a.name.slice(0, 200) }).catch((e) => toast('error', errorMessage(e)))}>
              <Icon name="external" size={14} /> Open in new window
            </button>
            {crmCan(perms, 'crm.followup.create') ? (
              <button type="button" className={btn} onClick={() => setScheduling(true)}>
                <Icon name="calendar-plus" size={14} /> Schedule follow-up
              </button>
            ) : null}
            {crmCan(perms, 'crm.quote') ? (
              <button type="button" className={btn} onClick={() => onNewQuote(id)}>
                New quote
              </button>
            ) : null}
            {crmCan(perms, 'crm.deal') ? (
              <button type="button" className={btnPrimary} onClick={() => setNewDeal(true)}>
                New deal
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2 min-[1100px]:grid-cols-6">
            <Tile label="Open deals" value={String(d.summary.open_deals)} sub={money(d.summary.open_value, a.currency)} />
            <Tile label="Won" value={money(d.summary.won_value, a.currency)} sub={d.summary.lost_count ? `${d.summary.lost_count} lost` : 'none lost'} />
            <Tile label="Projects" value={String(d.summary.projects)} />
            <Tile label="Open tasks" value={String(d.summary.open_tasks)} />
            <Tile label="Meetings" value={String(d.summary.meetings)} />
            <Tile label="Quotes" value={String(d.summary.quotes)} />
          </div>

          <div className="grid min-h-0 items-start gap-3 min-[1000px]:grid-cols-[1fr_1.2fr]">
            <div className="flex min-w-0 flex-col gap-3">
              <Section title={`Contacts · ${d.contacts.length}`} action={canEdit ? <button type="button" className={btnSmall} onClick={() => setAdding(true)}>Add contact</button> : null}>
                {d.contacts.length ? (
                  d.contacts.map((c) => (
                    <Line
                      key={c.id}
                      title={<>{c.name}{c.is_primary ? <span className="ml-1.5 rounded-full bg-selection px-1.5 text-[10.5px] font-bold text-primary">primary</span> : null}</>}
                      sub={c.job_title ?? undefined}
                      right={c.phone ? <span className="text-[12.5px] text-ink-2 tabular-nums">{c.phone}</span> : c.email ? <a href={`mailto:${c.email}`} className="text-[12.5px] font-semibold text-primary hover:underline">Email</a> : null}
                    />
                  ))
                ) : (
                  <Nothing>No contacts yet.</Nothing>
                )}
              </Section>
              <Section title={`Deals · ${d.deals.length}`}>
                {d.deals.length ? (
                  d.deals.map((x) => (
                    <Line
                      key={x.id}
                      onClick={() => onOpenDeal(x.id)}
                      title={x.name}
                      sub={
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: stageColour(x.colour) }} />
                          {x.stage}
                          {x.close_date ? ` · closes ${dateLabel(x.close_date)}` : ''}
                          {x.owner ? ` · ${x.owner}` : ''}
                        </span>
                      }
                      right={<b className={cx('tabular-nums', x.stage_kind === 'won' ? 'text-[#145C39] dark:text-success' : 'text-ink')}>{moneyFull(x.amount, x.currency)}</b>}
                    />
                  ))
                ) : (
                  <Nothing>No deals.</Nothing>
                )}
              </Section>
              <Section title={`Quotes · ${d.quotes.length}`}>
                {d.quotes.length ? (
                  d.quotes.map((x) => <Line key={x.id} onClick={() => onOpenQuote(x.id)} title={x.quote_no} sub={`${x.status}${x.issued_on ? ` · ${dateLabel(x.issued_on)}` : ''}`} right={<b className="text-ink tabular-nums">{money(x.total, x.currency)}</b>} />)
                ) : (
                  <Nothing>No quotes.</Nothing>
                )}
              </Section>
              {d.projects.length ? (
                <Section title={`Projects · ${d.projects.length}`}>
                  {d.projects.map((x) => (
                    <Line key={x.id} title={x.name} sub={[x.status, x.start_date ? dateLabel(x.start_date) : null].filter(Boolean).join(' · ')} />
                  ))}
                </Section>
              ) : null}
              {d.meetings.length ? (
                <Section title={`Meetings · ${d.meetings.length}`}>
                  {d.meetings.map((x) => (
                    <Line key={x.id} title={x.title} sub={`${dateLabel(x.start_at)} · ${x.status}`} />
                  ))}
                </Section>
              ) : null}
              <Section title="Details">
                <Pairs
                  rows={[
                    ['Email', a.email ? <a href={`mailto:${a.email}`} className="text-primary hover:underline">{a.email}</a> : '—'],
                    ['Phone', a.phone ?? '—'],
                    ['Website', a.website ?? '—'],
                    ['Employees', a.employees ? a.employees.toLocaleString() : '—'],
                    ['Annual revenue', a.annual_revenue ? moneyFull(a.annual_revenue, a.currency) : '—'],
                    ['Billing', [a.billing?.street, a.billing?.city, a.billing?.country].filter(Boolean).join(', ') || '—'],
                  ]}
                />
                {a.notes ? <p className="m-0 border-t border-line/60 px-3 py-2.5 text-[13px] whitespace-pre-wrap text-ink-2">{a.notes}</p> : null}
              </Section>
              {canEdit ? (
                <Section title="Set">
                  <div className="grid grid-cols-3 gap-2 p-3">
                    <Field label="Type">
                      <Select label="Type" value={a.account_type} onValueChange={(v) => void save({ account_type: v }, 'Type changed.')} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} />
                    </Field>
                    <Field label="Health" hint="Set by a person, not guessed">
                      <Select label="Health" value={a.health ?? ''} onValueChange={(v) => void save({ health: v || null }, 'Health set.')} options={[{ value: '', label: 'Not set' }, { value: 'good', label: 'Good' }, { value: 'watch', label: 'Watch' }, { value: 'at_risk', label: 'At risk' }]} />
                    </Field>
                    <Field label="Owner">
                      <Select label="Owner" value={a.owner_id ? String(a.owner_id) : ''} onValueChange={(v) => void save({ owner_id: v ? Number(v) : null }, v ? 'Owner changed.' : 'Unassigned.')} options={[{ value: '', label: 'Nobody' }, ...(owners.data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name })), ...(a.owner_id && !owners.data?.owners.some((o) => o.id === a.owner_id) ? [{ value: String(a.owner_id), label: a.owner_name ?? 'Current owner' }] : [])]} />
                    </Field>
                  </div>
                </Section>
              ) : null}
            </div>
            <Section title="Timeline">
              <div className="flex flex-col gap-2 p-3">
                {canEdit ? (
                  <div className="flex gap-2">
                    <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addNote()} placeholder="Add a note to this customer's file" aria-label="Note" className={input} />
                    <button type="button" className={btn} disabled={!note.trim()} onClick={() => void addNote()}>
                      Add
                    </button>
                  </div>
                ) : null}
                {d.timeline.length ? <TimelineList entries={d.timeline} /> : <Nothing>Nothing has happened here yet.</Nothing>}
              </div>
            </Section>
          </div>
        </>
      ) : null}
      {adding ? <AddContact accountId={id} onClose={() => setAdding(false)} onDone={() => (setAdding(false), refresh())} /> : null}
      {newDeal && a ? <NewDeal account={{ id, name: a.name }} onClose={() => setNewDeal(false)} onCreated={() => (setNewDeal(false), refresh())} /> : null}
      {scheduling && a ? <ScheduleFollowUp subject={{ type: 'account', id, label: a.name }} onClose={() => setScheduling(false)} onDone={() => (setScheduling(false), refresh())} /> : null}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div data-tile={label} className="flex min-w-0 flex-col rounded-[10px] border border-line bg-surface px-3 py-2.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      <b className="truncate text-[17px] text-ink tabular-nums">{value}</b>
      {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <Caps>{title}</Caps>
        <span className="flex-1" />
        {action}
      </div>
      <div className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">{children}</div>
    </section>
  );
}

function Line({ title, sub, right, onClick }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px] text-ink">{title}</b>
        {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
      </span>
      {right}
    </>
  );
  const cls = 'flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left last:border-b-0';
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'hover:bg-subtle')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="m-0 px-3 py-3 text-[12.5px] text-ink-3">{children}</p>;
}

function Pairs({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 px-3 py-2.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="m-0 min-w-0 truncate text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function NewAccount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const scope = useCrmScope();
  const [org, setOrg] = useState('');
  const [f, setF] = useState({ name: '', account_type: 'prospect', industry: '', email: '', phone: '', website: '', billing_street: '', billing_city: '', billing_country: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!f.name.trim() || busy || (scope.needsOrg && !org)) return;
    setBusy(true);
    try {
      const body = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== '')), org_id: orgIdFor(org, scope) };
      const r = await apiPost<{ id: number }>('/api/crm/accounts', body);
      toast('success', 'Account created.');
      onCreated(r.id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New account"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!f.name.trim() || busy || (scope.needsOrg && !org)} onClick={() => void create()}>
            Create account
          </button>
        </>
      }
    >
      <CompanyField scope={scope} value={org} onChange={setOrg} what="account" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" hint="Must be unique in its company — two accounts there cannot share a name" className="col-span-2">
          <input autoFocus value={f.name} onChange={set('name')} aria-label="Name" className={input} />
        </Field>
        <Field label="Type">
          <Select label="Type" value={f.account_type} onValueChange={(v) => setF({ ...f, account_type: v })} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} />
        </Field>
        <Field label="Industry">
          <input value={f.industry} onChange={set('industry')} aria-label="Industry" className={input} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} aria-label="Email" className={input} />
        </Field>
        <Field label="Phone">
          <input value={f.phone} onChange={set('phone')} aria-label="Phone" className={input} />
        </Field>
        <Field label="Website" className="col-span-2">
          <input value={f.website} onChange={set('website')} aria-label="Website" className={input} />
        </Field>
        <Field label="Billing street" className="col-span-2">
          <input value={f.billing_street} onChange={set('billing_street')} aria-label="Billing street" className={input} />
        </Field>
        <Field label="City">
          <input value={f.billing_city} onChange={set('billing_city')} aria-label="City" className={input} />
        </Field>
        <Field label="Country">
          <input value={f.billing_country} onChange={set('billing_country')} aria-label="Country" className={input} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <textarea value={f.notes} onChange={set('notes')} aria-label="Notes" rows={3} className={cx(input, 'h-auto py-2')} />
        </Field>
      </div>
    </Sheet>
  );
}

function AddContact({ accountId, onClose, onDone }: { accountId: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ display_name: '', job_title: '', email: '', phone: '' });
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const add = async () => {
    if (!f.display_name.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/crm/accounts/${accountId}/contacts`, { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== '')), is_primary: primary });
      toast('success', 'Contact added.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Add a contact"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!f.display_name.trim() || busy} onClick={() => void add()}>
            Add contact
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input autoFocus value={f.display_name} onChange={set('display_name')} aria-label="Contact name" className={input} />
        </Field>
        <Field label="Job title">
          <input value={f.job_title} onChange={set('job_title')} aria-label="Job title" className={input} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} aria-label="Contact email" className={input} />
        </Field>
        <Field label="Phone">
          <input value={f.phone} onChange={set('phone')} aria-label="Contact phone" className={input} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
          The main contact for this account
        </label>
      </div>
    </Sheet>
  );
}
