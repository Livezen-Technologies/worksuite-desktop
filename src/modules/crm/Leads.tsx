import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnGood, btnPrimary, btnSmall, Caps, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import type { Lead, LeadDetail, Owner, TimelineEntry } from './api';
import { Chips, crmCan, LeadStatus, money, moneyFull, Rating, StatusBar } from './parts';
import { Checkbox } from '../../components/Checkbox';
import { bulkSummary, isMissing, pageOf, statusLine, type BulkAnswer, type PageMeta } from './logic';
import { exportCrmCsv } from './exportCsv';
import { ScheduleFollowUp } from './Schedule';
import { CompanyField, orgIdFor, useCrmScope } from './scope';

/**
 * Leads (CrmLeads, CrmLeadDrawer, CrmLeadExtras, desk-leads): the list for
 * the company the CRM is showing, with its working views (Late, Due today,
 * Nothing scheduled, Unassigned) and their counts, filters, sorting, the bulk
 * bar (assign, status, schedule a follow-up, delete — W2), the StatusBar
 * tallies (W3) and Export; one lead in a drawer — contact, qualification,
 * why it scored what it did, possible duplicates to merge, status and owner,
 * the next follow-up, notes and its timeline; New lead; and Convert, which
 * makes an account and a contact (and a deal if wanted). A converted lead is
 * read-only.
 */
interface LeadList {
  leads: Lead[];
  total?: number;
  page?: number;
  has_more?: boolean;
  views?: Record<string, number>;
  meta?: Partial<PageMeta>;
}

/** A view's count: the tallies by view key, or the StatusBar's names for the same thing. */
export function viewCount(meta: PageMeta | null | undefined, key: string): number | undefined {
  const c = meta?.counts;
  if (!c || !key) return undefined;
  return c[key] ?? (key === 'none' ? c.no_followup : key === 'overdue' ? c.late : undefined);
}

const VIEWS: Array<{ key: string; label: string; red?: boolean }> = [
  { key: '', label: 'All leads' },
  { key: 'overdue', label: 'Late', red: true },
  { key: 'today', label: 'Due today' },
  { key: 'none', label: 'Nothing scheduled' },
  { key: 'unassigned', label: 'Unassigned' },
];

const SORTS: Array<[string, string]> = [
  ['score', 'Score'],
  ['created', 'Newest'],
  ['name', 'Name'],
  ['company', 'Company'],
  ['value', 'Estimated value'],
  ['activity', 'Last activity'],
];

const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'];

export function useOwners() {
  return useQuery({ queryKey: ['crm', 'owners'], queryFn: ({ signal }) => apiGet<{ owners: Owner[] }>('/api/crm/owners', undefined, signal), staleTime: 5 * 60_000 });
}

export default function Leads({ openId, creating, onOpen, onNew, onCreated, onCloseNew, onOpenDeal, onOpenAccount }: { openId: number | null; creating: boolean; onOpen: (id: number | null) => void; onNew: () => void; onCreated: (id: number) => void; onCloseNew: () => void; onOpenDeal: (id: number) => void; onOpenAccount: (id: number) => void }) {
  const qc = useQueryClient();
  const owners = useOwners();
  const scope = useCrmScope();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canLead = crmCan(perms, 'crm.lead');
  const canManage = crmCan(perms, 'crm.manage');
  const [view, setView] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rating, setRating] = useState('');
  const [owner, setOwner] = useState('');
  const [sort, setSort] = useState('score');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkFollowUp, setBulkFollowUp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canExport = crmCan(perms, 'crm.export');

  const params: Record<string, string | number | undefined> = {
    view: view || undefined,
    q: q.trim() || undefined,
    status: status || undefined,
    rating: rating || undefined,
    mine: owner === 'me' ? 1 : undefined,
    unassigned: owner === 'none' ? 1 : undefined,
    ...scope.params,
    sort,
    dir,
    per_page: 50,
  };
  const list = useInfiniteQuery({
    queryKey: ['crm', 'leads', params],
    queryFn: ({ pageParam, signal }) => apiGet<LeadList>('/api/crm/leads', { ...params, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const m = pageOf(last, last.leads.length);
      return m.has_more ? m.page + 1 : undefined;
    },
  });
  const rows = list.data?.pages.flatMap((p) => p.leads) ?? [];
  const first = list.data?.pages[0];
  const meta = first ? pageOf(first, rows.length) : null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));

  /** One bulk action on the chosen leads (`leads/bulk`); each lead is done or refused on its own. */
  const bulk = async (action: 'assign' | 'status' | 'delete' | 'followup', extra: Record<string, unknown>) => {
    const ids = [...selected];
    try {
      const r = await apiPost<BulkAnswer>('/api/crm/leads/bulk', { ids, action, ...extra });
      const said = bulkSummary(r);
      toast(said.tone, said.text);
    } catch (e) {
      // A server before `leads/bulk` can still reassign, one request for them all.
      if (action === 'assign' && isMissing(e)) {
        try {
          await apiPost('/api/crm/leads/assign', { ids, owner_id: extra.owner_id ?? null });
          toast('success', `Reassigned ${ids.length} ${ids.length === 1 ? 'lead' : 'leads'}.`);
        } catch (e2) {
          toast('error', errorMessage(e2));
          return false;
        }
      } else {
        toast('error', isMissing(e) ? 'This WorkSuite server cannot do that to several leads at once yet.' : errorMessage(e));
        return false;
      }
    }
    setSelected(new Set());
    refresh();
    return true;
  };
  const assign = async () => {
    if (await bulk('assign', { owner_id: assignTo ? Number(assignTo) : null })) setAssignTo(null);
  };
  const exportList = () => {
    const { per_page: _perPage, ...filters } = params;
    void exportCrmCsv('/api/crm/leads/export', filters, 'leads', () => [
      ['Lead no', 'Name', 'Company', 'Email', 'Phone', 'Score', 'Rating', 'Status', 'Owner', 'Next follow-up', 'Estimated value', 'Currency', 'Source', 'Created'],
      ...rows.map((r) => [r.lead_no, r.name, r.company, r.email, r.phone, r.score, r.rating, r.status, r.owner_name, r.next_followup_at, r.est_value, r.currency, r.source, r.created_at]),
    ]);
  };
  const ownerName = (id: string | null) => (id ? (owners.data?.owners.find((o) => String(o.id) === id)?.name ?? 'them') : 'nobody');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead title="Leads" sub={scope.name}>
        {canExport ? (
          <button type="button" className={btn} onClick={exportList} title="Exports this list as it is filtered">
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
        {canLead ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            New lead
          </button>
        ) : null}
      </PageHead>
      <Chips label="Views" value={view} onChange={setView} options={VIEWS.map((v) => ({ id: v.key, label: v.label, count: viewCount(meta, v.key), red: v.red }))} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email, phone" aria-label="Search leads" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <Select label="Status" value={status} onValueChange={setStatus} options={[{ value: '', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
        <Select label="Rating" value={rating} onValueChange={setRating} options={[{ value: '', label: 'Any rating' }, { value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }]} />
        {/* Any, mine or nobody's: the server has no filter for one named owner. */}
        <Select label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Any owner' }, { value: 'me', label: 'Mine' }, { value: 'none', label: 'Unassigned' }]} />
        <Select label="Sort" value={sort} onValueChange={setSort} options={SORTS.map(([v, l]) => ({ value: v, label: `Sort: ${l}` }))} />
        <button type="button" className={cx(btn, 'w-[34px] justify-center px-0')} aria-label={dir === 'desc' ? 'Descending' : 'Ascending'} title={dir === 'desc' ? 'Descending' : 'Ascending'} onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}>
          {dir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      {selected.size && (canManage || canLead) ? (
        <div role="toolbar" aria-label="With the chosen leads" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/40 bg-selection/50 px-3 py-1.5">
          <b className="text-[13px] text-primary">{selected.size} selected</b>
          {canManage ? <Select<string> label="Assign to" placeholder="Assign to…" className="h-[30px]" value={null} onValueChange={(v) => setAssignTo(v === 'none' ? '' : v)} options={[{ value: 'none', label: 'Nobody' }, ...(owners.data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} /> : null}
          {canLead ? <Select<string> label="Change status" placeholder="Status…" className="h-[30px]" value={null} onValueChange={setBulkStatus} options={['new', 'contacted', 'qualified', 'unqualified'].map((x) => ({ value: x, label: x }))} /> : null}
          {crmCan(perms, 'crm.followup.create') ? (
            <button type="button" className={btnSmall} onClick={() => setBulkFollowUp(true)}>
              <Icon name="calendar-plus" size={13} /> Schedule follow-up
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className={cx(btnSmall, 'text-danger')} onClick={() => setDeleting(true)}>
              <Icon name="trash" size={13} /> Delete
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" className={btnSmall} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-[#F7F8FB] px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
          <Checkbox aria-label="Select all" disabled={!canManage && !canLead} checked={all} indeterminate={!all && rows.some((r) => selected.has(r.id))} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
          <span className="w-[210px] shrink-0">Lead</span>
          <span className="w-[140px] shrink-0">Company</span>
          <span className="w-[120px] shrink-0">Score</span>
          <span className="w-[95px] shrink-0">Status</span>
          <span className="w-[110px] shrink-0">Owner</span>
          <span className="w-[150px] shrink-0">Follow-up</span>
          <span className="w-[90px] shrink-0">Value</span>
          <span className="min-w-0 flex-1">Activity</span>
        </div>
        <div className="min-h-0 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {rows.map((r) => (
            <div key={r.id} data-lead={r.id} className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] hover:bg-subtle', selected.has(r.id) && 'bg-[#F4F6FE] dark:bg-selection/40', openId === r.id && 'bg-selection')} onClick={() => onOpen(r.id)}>
              <Checkbox aria-label={`Select ${r.name}`} disabled={!canManage && !canLead} checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} />
              <span className="flex w-[210px] min-w-0 shrink-0 flex-col">
                <b className="truncate text-ink">{r.name}</b>
                <span className="truncate text-[11.5px] text-ink-3">{r.email ?? r.job_title ?? r.phone ?? ''}</span>
              </span>
              <span className="w-[140px] shrink-0 truncate text-ink">{r.company ?? '—'}</span>
              <span className="flex w-[120px] shrink-0 items-center gap-1.5">
                <span className="h-1.5 w-11 overflow-hidden rounded-full bg-subtle">
                  <span className="block h-1.5" style={{ width: `${Math.min(100, r.score)}%`, background: r.score > 70 ? '#1F7A4D' : r.score > 45 ? '#B45309' : '#8A91A6' }} />
                </span>
                <b className="text-[12px] text-ink tabular-nums">{r.score}</b>
                <Rating rating={r.rating} />
              </span>
              <span className="w-[95px] shrink-0">
                <LeadStatus status={r.status} />
              </span>
              <span className={cx('w-[110px] shrink-0 truncate', r.owner_name ? 'text-ink' : 'font-bold text-[#9A4A06] dark:text-warning')}>{r.owner_name ?? 'Unassigned'}</span>
              <span className="flex w-[150px] shrink-0 items-center gap-1.5 text-[12px]">
                <FollowUpCell lead={r} />
              </span>
              <span className="w-[90px] shrink-0 font-semibold text-ink">{r.est_value ? money(r.est_value, r.currency) : '—'}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{relative(r.last_activity_at ?? r.created_at)}</span>
            </div>
          ))}
          {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">No leads match.</p> : null}
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
          {meta ? `${rows.length} of ${statusLine(['lead', 'leads'], meta, [['new', 'new'], ['no_followup', 'with no follow-up'], ['unassigned', 'unassigned']])}` : null}
        </StatusBar>
      </div>

      {openId ? <LeadDrawer key={openId} id={openId} onClose={() => onOpen(null)} onChanged={refresh} onOpenDeal={onOpenDeal} onOpenAccount={onOpenAccount} /> : null}
      {creating && canLead ? <NewLead onClose={onCloseNew} onCreated={(id) => (refresh(), onCreated(id))} /> : null}
      {assignTo !== null ? (
        <Sheet
          title={`Reassign ${selected.size} ${selected.size === 1 ? 'lead' : 'leads'}?`}
          width={400}
          onClose={() => setAssignTo(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAssignTo(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => void assign()}>
                Reassign
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{assignTo ? `They will be owned by ${ownerName(assignTo)}.` : 'They will be unassigned.'}</p>
        </Sheet>
      ) : null}
      {bulkStatus ? <BulkStatus count={selected.size} status={bulkStatus} onClose={() => setBulkStatus(null)} onSave={async (reason) => (await bulk('status', { status: bulkStatus, ...(reason ? { reason } : {}) })) && setBulkStatus(null)} /> : null}
      {bulkFollowUp ? <ScheduleFollowUp subject={null} count={selected.size} submit={async (followup) => (await bulk('followup', { followup })) && setBulkFollowUp(false)} onClose={() => setBulkFollowUp(false)} onDone={() => setBulkFollowUp(false)} /> : null}
      {deleting ? (
        <Sheet
          title={`Delete ${selected.size} ${selected.size === 1 ? 'lead' : 'leads'}?`}
          width={420}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} onClick={() => void bulk('delete', {}).then((ok) => ok && setDeleting(false))}>
                Delete
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Converted leads are kept: the server refuses those, and says so.</p>
        </Sheet>
      ) : null}
    </div>
  );
}

function FollowUpCell({ lead }: { lead: Lead }) {
  if (lead.follow_up === 'none' || !lead.next_followup_at) return <span className="text-ink-3">Nothing scheduled</span>;
  const [label, cls] =
    lead.follow_up === 'overdue'
      ? ['Late', 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger']
      : lead.follow_up === 'due'
        ? ['Due', 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning']
        : ['To come', 'bg-selection text-primary'];
  return (
    <>
      <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', cls)}>{label}</span>
      <span className="truncate text-ink-2">{lead.follow_up === 'due' ? 'Today' : dateLabel(lead.next_followup_at)}</span>
    </>
  );
}

// ── one lead ────────────────────────────────────────────────────────────


const KIND_ICON: Record<string, string> = { call: 'phone', note: 'file-text', email: 'mail', meeting: 'calendar', whatsapp: 'chat', status: 'activity', convert: 'check-circle', merge: 'copy' };

function LeadDrawer({ id, onClose, onChanged, onOpenDeal, onOpenAccount }: { id: number; onClose: () => void; onChanged: () => void; onOpenDeal: (id: number) => void; onOpenAccount: (id: number) => void }) {
  const qc = useQueryClient();
  const owners = useOwners();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const can = { lead: crmCan(perms, 'crm.lead'), manage: crmCan(perms, 'crm.manage'), schedule: crmCan(perms, 'crm.followup.create') };
  const [scheduling, setScheduling] = useState(false);
  const [tab, setTab] = useState<'detail' | 'timeline'>('detail');
  const [converting, setConverting] = useState(false);
  const [merging, setMerging] = useState<{ id: number; name: string } | null>(null);
  const [unqualifying, setUnqualifying] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  // Read afresh each time it opens: a duplicate that arrived a minute ago must show.
  const q = useQuery({ queryKey: ['crm', 'lead', id], queryFn: ({ signal }) => apiGet<LeadDetail>(`/api/crm/leads/${id}`, undefined, signal), staleTime: 0, refetchOnMount: 'always' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['crm', 'lead', id] });
    onChanged();
  };
  const save = async (patch: Record<string, unknown>, done = 'Saved.') => {
    try {
      await apiPut(`/api/crm/leads/${id}`, patch);
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };

  const head = q.data ? (
    <span className="flex min-w-0 flex-col">
      <b className="truncate text-[16px] text-ink">{q.data.lead.name}</b>
      <span className="truncate text-[12.5px] text-ink-3">{[q.data.lead.job_title, q.data.lead.company].filter(Boolean).join(' · ') || q.data.lead.lead_no}</span>
    </span>
  ) : (
    <b className="text-ink">Lead</b>
  );

  return (
    <SidePanel label="Lead" width={540} onClose={onClose} head={head}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <LeadBody
          d={q.data}
          can={can}
          onSchedule={() => setScheduling(true)}
          tab={tab}
          setTab={setTab}
          owners={owners.data?.owners ?? []}
          onConvert={() => setConverting(true)}
          onMerge={setMerging}
          onStatus={(s) => (s === 'unqualified' ? setUnqualifying(true) : void save({ status: s }, `Marked ${s}.`))}
          onOwner={(o) => void save({ owner_id: o ? Number(o) : null }, o ? 'Owner changed.' : 'Unassigned.')}
          notes={editingNotes}
          setNotes={setEditingNotes}
          onSaveNotes={async (v) => (await save({ description: v }, 'Notes saved.')) && setEditingNotes(null)}
          onRecorded={refresh}
          onOpenDeal={onOpenDeal}
          onOpenAccount={onOpenAccount}
        />
      ) : null}
      {converting && q.data ? <Convert lead={q.data.lead} onClose={() => setConverting(false)} onDone={() => (setConverting(false), refresh())} /> : null}
      {merging ? (
        <Sheet
          title="Merge this lead in?"
          width={420}
          onClose={() => setMerging(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setMerging(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() =>
                  void apiPost(`/api/crm/leads/${id}/merge`, { lead_id: merging.id })
                    .then(() => (toast('success', 'Leads merged.'), setMerging(null), refresh()))
                    .catch((e) => toast('error', errorMessage(e)))
                }
              >
                Merge
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Details from “{merging.name}” fill any blanks on this one, its activity moves across, and it is kept as a merged record. This cannot be undone.</p>
        </Sheet>
      ) : null}
      {scheduling && q.data ? <ScheduleFollowUp subject={{ type: 'lead', id: q.data.lead.id, label: [q.data.lead.name, q.data.lead.company].filter(Boolean).join(' · ') }} onClose={() => setScheduling(false)} onDone={() => (setScheduling(false), refresh())} /> : null}
      {unqualifying ? <Unqualify onClose={() => setUnqualifying(false)} onSave={async (why) => (await save({ status: 'unqualified', unqualified_reason: why }, 'Marked unqualified.')) && setUnqualifying(false)} /> : null}
    </SidePanel>
  );
}

function LeadBody({
  d,
  can,
  onSchedule,
  tab,
  setTab,
  owners,
  onConvert,
  onMerge,
  onStatus,
  onOwner,
  notes,
  setNotes,
  onSaveNotes,
  onRecorded,
  onOpenDeal,
  onOpenAccount,
}: {
  d: LeadDetail;
  can: { lead: boolean; manage: boolean; schedule: boolean };
  onSchedule: () => void;
  tab: 'detail' | 'timeline';
  setTab: (t: 'detail' | 'timeline') => void;
  owners: Owner[];
  onConvert: () => void;
  onMerge: (x: { id: number; name: string }) => void;
  onStatus: (s: string) => void;
  onOwner: (o: string) => void;
  notes: string | null;
  setNotes: (v: string | null) => void;
  onSaveNotes: (v: string) => void;
  onRecorded: () => void;
  onOpenDeal: (id: number) => void;
  onOpenAccount: (id: number) => void;
}) {
  const l = d.lead;
  const done = l.converted || l.status === 'converted';
  const reasons = Object.entries(d.score.reasons ?? {}).filter(([, v]) => v !== 0);
  const location = [l.city, l.country].filter(Boolean).join(', ');

  return (
    <>
      <div className="flex items-center gap-2">
        <LeadStatus status={l.status} />
        <Rating rating={l.rating} />
        <span className="flex h-7 items-center gap-1 rounded-full bg-subtle px-2.5 text-[12px] text-ink-2">
          Score <b className="text-ink tabular-nums">{d.score.score}</b>
        </span>
        <span className="flex-1" />
        {!done && can.lead ? (
          <button type="button" className={btnGood} onClick={onConvert}>
            Convert
          </button>
        ) : null}
      </div>
      {done ? (
        <div className="flex items-center gap-2 rounded-[10px] bg-[#F7F8FB] px-3 py-2.5 text-[12.5px] text-ink-2 dark:bg-well">
          <span className="flex-1">This lead was converted. Its details are read-only — the account and contact it became are the record now.</span>
          {l.converted_deal_id ? (
            <button type="button" className={btnSmall} onClick={() => onOpenDeal(l.converted_deal_id!)}>
              Open deal
            </button>
          ) : null}
          {l.converted_account_id ? (
            <button type="button" className={btnSmall} onClick={() => onOpenAccount(l.converted_account_id!)}>
              Open account
            </button>
          ) : null}
        </div>
      ) : null}
      <div role="tablist" className="flex gap-5 border-b border-line">
        {(['detail', 'timeline'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('-mb-px border-b-2 py-2.5 font-semibold', tab === t ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink')}>
            {t === 'detail' ? 'Detail' : `Timeline (${d.timeline.length})`}
          </button>
        ))}
      </div>
      {tab === 'detail' ? (
        <>
          {d.duplicates.length && !done ? (
            <div className="flex flex-col gap-2 rounded-[10px] bg-[#FFF7E6] px-3 py-2.5 dark:bg-warning-bg">
              <b className="text-[12.5px] text-[#8A4B00] dark:text-warning">
                {d.duplicates.length} possible {d.duplicates.length === 1 ? 'duplicate' : 'duplicates'}
              </b>
              {d.duplicates.map((x) => (
                <div key={x.id} className="flex items-center gap-2 text-[12.5px]">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">{x.name}</b>
                    <span className="truncate text-[11.5px] text-ink-3">
                      {x.confidence} · {x.why}
                    </span>
                  </span>
                  {can.manage ? (
                    <button type="button" className={btnSmall} onClick={() => onMerge({ id: x.id, name: x.name })}>
                      Merge
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <section>
            <Caps>Contact</Caps>
            <Pairs rows={[['Email', l.email], ['Phone', l.phone], ['Website', l.website ? <button type="button" className="text-primary underline" onClick={() => void call('app:openExternal', { url: /^https?:\/\//.test(l.website!) ? l.website! : `https://${l.website}` }).catch(() => undefined)}>{l.website}</button> : null], ['Location', location || null]]} />
          </section>
          <section>
            <Caps>Qualification</Caps>
            <Pairs rows={[['Company', l.company], ['Job title', l.job_title], ['Industry', l.industry], ['Employees', l.employees ? String(l.employees) : null], ['Estimated value', l.est_value ? moneyFull(l.est_value, l.currency) : null], ['Source', l.source], ...(l.unqualified_reason ? ([['Unqualified because', l.unqualified_reason]] as Array<[string, ReactNode]>) : [])]} />
          </section>
          <section>
            <Caps>Why this score</Caps>
            {reasons.length ? (
              <div className="flex flex-col rounded-[10px] border border-line">
                {reasons.map(([k, v]) => (
                  <div key={k} className="flex items-center border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                    <span className="flex-1 text-ink-2">{k}</span>
                    <b className={v > 0 ? 'text-[#145C39] dark:text-success' : 'text-danger'}>{v > 0 ? `+${v}` : v}</b>
                  </div>
                ))}
                <div className="flex items-center bg-well px-3 py-1.5 text-[12.5px]">
                  <b className="flex-1 text-ink">Total</b>
                  <b className="text-ink">{d.score.score} / 100</b>
                </div>
              </div>
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">Nothing is known about this lead yet, so there is nothing to score.</p>
            )}
          </section>
          {!done ? (
            <section>
              <div className="flex items-center">
                <Caps>Next follow-up</Caps>
                <span className="flex-1" />
                {can.schedule ? (
                  <button type="button" className="mb-1 text-[12px] font-semibold text-primary hover:underline" onClick={onSchedule}>
                    Schedule a follow-up
                  </button>
                ) : null}
              </div>
              <p className="m-0 flex items-center gap-2 text-[12.5px] text-ink-2">
                <FollowUpCell lead={l} />
              </p>
            </section>
          ) : null}
          {!done && can.lead ? (
            <section>
              <Caps>Change</Caps>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Status">
                  <Select label="Status" value={l.status} onValueChange={onStatus} options={['new', 'contacted', 'qualified', 'unqualified'].map((s) => ({ value: s, label: s }))} />
                </Field>
                <Field label="Owner">
                  <Select label="Owner" value={l.owner_id ? String(l.owner_id) : ''} onValueChange={onOwner} options={[{ value: '', label: 'Unassigned' }, ...owners.map((o) => ({ value: String(o.id), label: o.name }))]} />
                </Field>
              </div>
            </section>
          ) : null}
          <section>
            <div className="flex items-center">
              <Caps>Notes</Caps>
              <span className="flex-1" />
              {!done && can.lead && notes === null ? (
                <button type="button" className="mb-1 text-[12px] font-semibold text-primary hover:underline" onClick={() => setNotes(l.description ?? '')}>
                  Edit
                </button>
              ) : null}
            </div>
            {notes !== null ? (
              <div className="flex flex-col gap-2">
                <textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={cx(input, 'h-auto py-2')} />
                <div className="flex justify-end gap-2">
                  <button type="button" className={btnSmall} onClick={() => setNotes(null)}>
                    Cancel
                  </button>
                  <button type="button" className={cx(btnSmall, 'border-primary bg-primary text-white hover:bg-primary-hover')} onClick={() => onSaveNotes(notes)}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="m-0 text-[12.5px] whitespace-pre-line text-ink-2">{l.description || 'No notes.'}</p>
            )}
          </section>
        </>
      ) : (
        <Timeline leadId={l.id} entries={d.timeline} readOnly={done || !can.lead} onRecorded={onRecorded} />
      )}
    </>
  );
}

function Pairs({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col border-b border-line/60 py-1.5">
          <span className="text-[11.5px] text-ink-3">{k}</span>
          <span className="truncate font-semibold text-ink select-text">{v === null || v === undefined || v === '' ? '—' : v}</span>
        </div>
      ))}
    </div>
  );
}

export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <p className="m-0 text-[12.5px] text-ink-3">Nothing recorded yet.</p>;
  return (
    <div className="flex flex-col">
      {entries.map((t) => (
        <div key={t.id} className="flex gap-2.5 border-b border-line/60 py-2 last:border-b-0">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2">
            <Icon name={KIND_ICON[t.kind] ?? 'activity'} size={14} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[12.5px] text-ink">{t.title}</b>
            {t.body ? <span className="text-[12px] whitespace-pre-line text-ink-2">{t.body}</span> : null}
            <span className="text-[11.5px] text-ink-3">
              {t.author ?? 'System'} · {relative(t.at)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Record a call, note, email, meeting or WhatsApp on the lead. A call or meeting re-scores it. */
function Timeline({ leadId, entries, readOnly, onRecorded }: { leadId: number; entries: TimelineEntry[]; readOnly: boolean; onRecorded: () => void }) {
  const [kind, setKind] = useState('call');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const record = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/crm/leads/${leadId}/activity`, { kind, title: title.trim(), body: body.trim() || null });
      toast('success', 'Recorded.');
      setTitle('');
      setBody('');
      onRecorded();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {!readOnly ? (
        <div className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
          <div className="flex gap-2">
            <Select label="Kind" value={kind} onValueChange={setKind} options={[{ value: 'call', label: 'Call' }, { value: 'note', label: 'Note' }, { value: 'email', label: 'Email' }, { value: 'meeting', label: 'Meeting' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
            <input aria-label="What happened?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What happened?" className={input} maxLength={200} />
          </div>
          <textarea aria-label="Details" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" rows={2} className={cx(input, 'h-auto py-2')} />
          <div className="flex items-center">
            <span className="flex-1 text-[11.5px] text-ink-3">Logging a call or meeting re-scores the lead.</span>
            <button type="button" className={btnPrimary} disabled={!title.trim() || busy} onClick={() => void record()}>
              Record
            </button>
          </div>
        </div>
      ) : null}
      <TimelineList entries={entries} />
    </div>
  );
}

function Unqualify({ onClose, onSave }: { onClose: () => void; onSave: (why: string) => void }) {
  const [why, setWhy] = useState('');
  return (
    <Sheet
      title="Why is this lead unqualified?"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!why.trim()} onClick={() => onSave(why.trim())}>
            OK
          </button>
        </>
      }
    >
      <input autoFocus aria-label="Why?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="No budget this year" className={input} maxLength={255} />
    </Sheet>
  );
}

function Convert({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const [withDeal, setWithDeal] = useState(true);
  const [name, setName] = useState(lead.company ? `${lead.company} — new business` : `${lead.name} — new business`);
  const [amount, setAmount] = useState(lead.est_value ? String(lead.est_value) : '');
  const [close, setClose] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/crm/leads/${lead.id}/convert`, { create_deal: withDeal, deal_name: name, amount: amount === '' ? null : Number(amount), close_date: close || null });
      toast('success', 'Lead converted.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Convert ${lead.name}`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || (withDeal && !name.trim())} onClick={() => void run()}>
            {busy ? 'Converting…' : 'Convert'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">This creates an account and a contact from the lead. If an account with the same name already exists it is reused rather than duplicated, and the lead’s activity moves onto it.</p>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <Checkbox checked={withDeal} onChange={(e) => setWithDeal(e.target.checked)} />
        Also open a deal
      </label>
      {withDeal ? (
        <>
          <Field label="Deal name">
            <input aria-label="Deal name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Amount" hint={lead.est_value ? 'From the estimated value' : undefined}>
              <input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" className={input} />
            </Field>
            <Field label="Expected close">
              <input aria-label="Expected close" type="date" value={close} onChange={(e) => setClose(e.target.value)} className={input} />
            </Field>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

/** Change the status of the chosen leads; Unqualified asks why, once for them all. */
function BulkStatus({ count, status, onClose, onSave }: { count: number; status: string; onClose: () => void; onSave: (reason: string) => void }) {
  const [why, setWhy] = useState('');
  const needs = status === 'unqualified';
  return (
    <Sheet
      title={`Mark ${count} ${count === 1 ? 'lead' : 'leads'} ${status}?`}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={needs && !why.trim()} onClick={() => onSave(why.trim())}>
            Change status
          </button>
        </>
      }
    >
      {needs ? <input autoFocus aria-label="Why are they unqualified?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="No budget this year" className={input} maxLength={255} /> : <p className="m-0 text-[13px] text-ink-2">Converted leads keep their status.</p>}
    </Sheet>
  );
}

// ── new lead ────────────────────────────────────────────────────────────

function NewLead({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  // With several companies and "All organizations" showing, the server needs to be told which one files it.
  const scope = useCrmScope();
  const [org, setOrg] = useState('');
  const needsOrg = scope.needsOrg;
  const [f, setF] = useState({ first_name: '', last_name: '', company: '', job_title: '', email: '', phone: '', source: '', industry: '', employees: '', est_value: '', city: '', country: '', description: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = !!(f.first_name.trim() || f.last_name.trim() || f.company.trim()) && (!needsOrg || !!org);
  const create = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await apiPost<{ lead: { id: number } }>('/api/crm/leads', { ...f, employees: f.employees ? Number(f.employees) : null, est_value: f.est_value ? Number(f.est_value) : null, org_id: orgIdFor(org, scope) });
      toast('success', 'Lead created.');
      onCreated(Number(r.lead.id));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, hint?: string, extra?: { type?: string; inputMode?: 'numeric' | 'decimal' }) => (
    <Field label={label} hint={hint}>
      <input aria-label={label} value={f[k]} onChange={set(k)} className={input} type={extra?.type} inputMode={extra?.inputMode} />
    </Field>
  );
  return (
    <SidePanel
      label="New lead"
      width={480}
      onClose={onClose}
      head={
        <span className="flex flex-col">
          <b className="text-[16px] text-ink">New lead</b>
          <span className="text-[12.5px] text-ink-3">A name or a company is enough to start</span>
        </span>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), void create())}>
        <CompanyField scope={scope} value={org} onChange={setOrg} what="lead" />
        <div className="grid grid-cols-2 gap-2.5">
          {field('first_name', 'First name')}
          {field('last_name', 'Last name')}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {field('company', 'Company')}
          {field('job_title', 'Job title', 'Seniority counts towards the score')}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {field('email', 'Email', 'A work address scores higher than a free one', { type: 'email' })}
          {field('phone', 'Phone')}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {field('source', 'Source', 'Where it came from')}
          {field('industry', 'Industry')}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {field('employees', 'Employees', undefined, { inputMode: 'numeric' })}
          {field('est_value', 'Estimated value', undefined, { inputMode: 'decimal' })}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {field('city', 'City')}
          {field('country', 'Country')}
        </div>
        <Field label="Notes">
          <textarea aria-label="Notes" value={f.description} onChange={set('description')} rows={3} className={cx(input, 'h-auto py-2')} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Create lead'}
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
