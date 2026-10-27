import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet, apiGetMeta, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { readableText } from '../../core/rich';
import { useStore } from '../../core/store';
import { dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Sheet } from '../../components/PageKit';
import { ApprovalsPanel, DecideSheet, type Decision } from './Approvals';
import { BarRow, Chips, crmCan, money, moneyFull, StatusBar } from './parts';
import {
  listMeta,
  nameOf,
  OFFLINE_HINT,
  pricingOf,
  PROPOSAL_STATUSES,
  proposalActions,
  proposalWebPath,
  readingTime,
  recordOf,
  rowsOf,
  sectionHtml,
  statusLabel,
  useOnline,
  type PendingApproval,
  type Proposal,
  type ProposalDetail,
  type ProposalEvents,
} from './proposalLogic';
import { useCrmScope } from './scope';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';
import { clickOnKey } from '../../components/press';

/**
 * Proposals (CRM SRS v1.3 §17, desk-proposals): the list for the company the
 * CRM is showing, filtered by status, with how each is being read — opens,
 * last opened, somebody reading it now, open questions — and the selected
 * one previewed on the right: its sections and pricing, the version, who read
 * what for how long, the customer's questions (answered from here), and
 * Remind, Withdraw, Duplicate, Approve or Send back where the server allows.
 * Writing a proposal stays on the web: Open in web takes it there.
 */

const TONE: Record<string, string> = {
  draft: 'bg-subtle text-ink-2',
  pending_approval: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  approved: 'bg-teal-bg text-teal-ink dark:bg-teal/15 dark:text-teal',
  sent: 'bg-selection text-primary',
  viewed: 'bg-violet-bg text-primary dark:text-violet-ink',
  accepted: 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success',
  converted: 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success',
  declined: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
  expired: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  withdrawn: 'bg-subtle text-ink-3',
};

export function DocStatus({ status }: { status: string }) {
  return <span className={cx('inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap', TONE[status] ?? 'bg-subtle text-ink-2')}>{statusLabel(status)}</span>;
}

/** The green "reading now" mark. */
function LiveDot({ label = 'Reading now' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-success-ink dark:text-success" title={label}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-success dark:bg-success" aria-hidden /> now
    </span>
  );
}

const PER_PAGE = 50;
type Filter = '' | Proposal['status'];

export default function Proposals({ openId, onOpen, onOpenDeal, onOpenEstimate }: { openId: number | null; onOpen: (id: number | null) => void; onOpenDeal?: (id: number) => void; onOpenEstimate?: (id: number) => void }) {
  const scope = useCrmScope();
  const online = useOnline();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = crmCan(perms, 'crm.proposals.manage');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Filter>('');
  const [page, setPage] = useState(1);
  const params = { q: q.trim() || undefined, status: status || undefined, ...scope.params, page, per_page: PER_PAGE };
  const list = useQuery({
    queryKey: ['crm', 'proposals', params],
    queryFn: async ({ signal }) => {
      const r = await apiGetMeta<unknown>('/api/crm/proposals', params, signal);
      const rows = rowsOf<Proposal>(r.data, 'proposals');
      return { rows, meta: listMeta(r.data, r.meta, rows.length) };
    },
    refetchInterval: 60_000,
  });
  const rows = list.data?.rows ?? [];
  const meta = list.data?.meta ?? null;
  const count = (s: string) => meta?.counts?.[s] ?? 0;
  const openApproval = (r: PendingApproval) => (r.doc === 'proposal' ? onOpen(r.doc_id) : onOpenEstimate?.(r.doc_id));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 text-[20px] font-bold text-ink">Proposals</h1>
          <span className="text-[12.5px] text-ink-3">{scope.name}</span>
        </div>
        {manage ? (
          <button type="button" className={btnPrimary} disabled={!online} title={online ? 'Proposals are written on the web' : OFFLINE_HINT} onClick={() => void call('app:openInBrowser', { path: '/crm?view=proposals&new=1' }).catch((e) => toast('error', errorMessage(e)))}>
            <Icon name="external" size={14} /> New on web
          </button>
        ) : null}
      </div>
      <ApprovalsPanel className="max-h-[220px] shrink-0" onOpen={openApproval} />
      <div className="flex min-h-0 flex-1 gap-3">
        <section aria-label="Proposals list" className={cx('flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface', openId ? 'w-[560px] shrink-0' : 'min-w-0 flex-1')}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <label className="flex h-[34px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
              <Icon name="search" size={14} className="text-ink-3" />
              <input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Proposal no. or account" aria-label="Search proposals" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
            </label>
            <Chips<Filter>
              label="Status"
              value={status}
              onChange={(v) => (setStatus(v), setPage(1))}
              options={[{ id: '', label: 'All', count: meta?.total ?? null }, ...PROPOSAL_STATUSES.filter(([s]) => s === status || count(s) > 0 || !meta?.counts).map(([s, l]) => ({ id: s as Filter, label: l, count: count(s) || null }))]}
            />
          </div>
          <div role="row" className="flex shrink-0 items-center gap-2 border-b border-line bg-info-soft px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
            <span role="columnheader" className="min-w-0 flex-1">Proposal</span>
            <span role="columnheader" className="w-[118px] shrink-0">Status</span>
            <span role="columnheader" className="w-[84px] shrink-0 text-right">Value</span>
            <span role="columnheader" className="w-[48px] shrink-0 text-right">Opens</span>
            <span role="columnheader" className="w-[86px] shrink-0">Last opened</span>
            <span role="columnheader" className="w-[52px] shrink-0">Now</span>
            <span role="columnheader" className="w-[30px] shrink-0 text-right" title="Open questions">
              <Icon name="message-circle" size={13} label="Questions" />
            </span>
          </div>
          <div role="table" aria-label="Proposals" className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
            {rows.map((r) => {
              const e = r.engagement;
              return (
                <div
                  key={r.id}
                  role="row"
                  tabIndex={0}
                  onKeyDown={clickOnKey}
                  data-proposal={r.id}
                  aria-selected={r.id === openId}
                  onClick={() => onOpen(r.id === openId ? null : r.id)}
                  className={cx('flex cursor-pointer items-center gap-2 border-b border-line/60 px-3 py-2 text-[12.5px]', r.id === openId ? 'bg-selection' : 'hover:bg-subtle')}
                >
                  <span role="cell" className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate font-mono text-ink">{r.number}</b>
                    <span className="truncate text-[11.5px] text-ink-3">{[nameOf(r.account), r.title].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span role="cell" className="w-[118px] shrink-0">
                    <DocStatus status={r.status} />
                  </span>
                  <span role="cell" className="w-[84px] shrink-0 text-right font-semibold text-ink tabular-nums">{money(r.total, null)}</span>
                  <span role="cell" className="w-[48px] shrink-0 text-right text-ink-2 tabular-nums">{e?.opens ?? 0}</span>
                  <span role="cell" className="w-[86px] shrink-0 truncate text-ink-2">{e?.last_opened_at ? relative(e.last_opened_at) : r.sent_at ? 'not opened' : '—'}</span>
                  <span role="cell" className="w-[52px] shrink-0">{e?.viewing_now ? <LiveDot /> : null}</span>
                  <span role="cell" className={cx('w-[30px] shrink-0 text-right font-bold tabular-nums', e?.questions_open ? 'text-danger' : 'text-ink-3')}>{e?.questions_open || ''}</span>
                </div>
              );
            })}
            {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">No proposals match.</p> : null}
          </div>
          <StatusBar
            right={
              <span className="flex gap-2">
                {page > 1 ? (
                  <button type="button" className={btnSmall} onClick={() => setPage(page - 1)}>
                    Newer
                  </button>
                ) : null}
                {meta?.has_more ? (
                  <button type="button" className={btnSmall} onClick={() => setPage(page + 1)}>
                    Older
                  </button>
                ) : null}
              </span>
            }
          >
            {meta ? [`${meta.total} ${meta.total === 1 ? 'proposal' : 'proposals'}`, meta.kpi?.open_value ? `${money(meta.kpi.open_value)} open` : null, meta.kpi?.viewed_rate !== null && meta.kpi?.viewed_rate !== undefined ? `${meta.kpi.viewed_rate}% viewed` : null, meta.kpi?.accepted_rate !== null && meta.kpi?.accepted_rate !== undefined ? `${meta.kpi.accepted_rate}% accepted` : null].filter(Boolean).join(' · ') : null}
          </StatusBar>
        </section>
        {openId ? <ProposalPreview key={openId} id={openId} onClose={() => onOpen(null)} onOpen={onOpen} onOpenDeal={onOpenDeal} onOpenEstimate={onOpenEstimate} /> : null}
      </div>
    </div>
  );
}

/** The right-hand preview of one proposal. */
export function ProposalPreview({ id, onClose, onOpen, onOpenDeal, onOpenEstimate }: { id: number; onClose: () => void; onOpen: (id: number) => void; onOpenDeal?: (id: number) => void; onOpenEstimate?: (id: number) => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = crmCan(perms, 'crm.proposals.manage');
  const q = useQuery({ queryKey: ['crm', 'proposal', id], queryFn: async ({ signal }) => recordOf<ProposalDetail>(await apiGet<unknown>(`/api/crm/proposals/${id}`, undefined, signal), 'proposal'), staleTime: 0, refetchOnMount: 'always' });
  const ev = useQuery({ queryKey: ['crm', 'proposal', id, 'events'], queryFn: ({ signal }) => apiGet<ProposalEvents>(`/api/crm/proposals/${id}/events`, undefined, signal), retry: false, refetchInterval: 60_000 });
  const p = q.data ?? null;
  const act = proposalActions(p, { online, manage });
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const run = async <T,>(fn: () => Promise<T>, done: string | ((r: T) => string), after?: (r: T) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', typeof done === 'string' ? done : done(r));
      refresh();
      after?.(r);
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const duplicate = () =>
    void run(
      async () => recordOf<Proposal>(await apiPost<unknown>(`/api/crm/proposals/${id}/duplicate`), 'proposal'),
      (r) => (r?.number ? `Duplicated as ${r.number}.` : 'Duplicated.'),
      (r) => r?.id && onOpen(r.id),
    );
  const web = () => void call('app:openInBrowser', { path: proposalWebPath(id) }).catch((e) => toast('error', errorMessage(e)));

  if (q.isLoading) return <PreviewFrame onClose={onClose}><Spinner /></PreviewFrame>;
  if (q.error || !p) return <PreviewFrame onClose={onClose}><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></PreviewFrame>;

  const e = p.engagement;
  const events = ev.data;
  const sections = (p.sections ?? []).filter((s) => !s.hidden).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const timeMax = Math.max(1, ...(events?.sections_time ?? []).map((s) => s.seconds));
  const version = p.current_version ? `v${p.current_version}${p.sent_version && p.sent_version !== p.current_version ? ` · sent v${p.sent_version}` : ''}` : null;
  const facts = [nameOf(p.account), nameOf(p.contact), p.sent_at ? `sent ${dateLabel(p.sent_at)}` : null, p.valid_until ? `valid until ${dateLabel(p.valid_until)}` : null, p.owner?.name ? `owner ${p.owner.name}` : null].filter(Boolean);
  const viewers = events?.viewers ?? [];
  const questions = events?.questions ?? [];

  return (
    <PreviewFrame onClose={onClose} label={`Proposal ${p.number}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[18px] font-bold text-ink">
            <span className="font-mono">{p.number}</span>
            <span className="min-w-0 truncate">· {p.title}</span>
            <DocStatus status={p.status} />
            {e?.viewing_now ? <LiveDot /> : null}
          </h2>
          <span className="text-[12.5px] text-ink-3">{facts.join(' · ')}</span>
          <span className="text-[12.5px] text-ink-2">
            {version ? <span data-version>{version}</span> : null}
            {p.deal && onOpenDeal ? (
              <>
                {version ? ' · ' : ''}
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenDeal(p.deal!.id)}>
                  {p.deal.name}
                </button>
              </>
            ) : null}
            {p.estimate_id && onOpenEstimate ? (
              <>
                {' · '}
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenEstimate(p.estimate_id!)}>
                  From its estimate
                </button>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div role="toolbar" aria-label="Proposal actions" className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} disabled={!act.web} title={act.web ? 'Opens on the web' : OFFLINE_HINT} onClick={web}>
          <Icon name="external" size={14} /> {act.edit ? 'Edit on web' : 'Open in web'}
        </button>
        {p.share_url ? (
          <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(p.share_url!).then(() => toast('success', 'Customer link copied.'))}>
            <Icon name="copy" size={14} /> Copy link
          </button>
        ) : null}
        {(p.status === 'sent' || p.status === 'viewed') && p.can?.send !== false ? (
          <button type="button" className={btn} disabled={busy || !act.remind} title={online ? undefined : OFFLINE_HINT} onClick={() => void run(() => apiPost(`/api/crm/proposals/${id}/remind`), `Reminder sent for ${p.number}.`)}>
            <Icon name="bell" size={14} /> Remind
          </button>
        ) : null}
        {manage ? (
          <button type="button" className={btn} disabled={busy || !act.duplicate} title={online ? undefined : OFFLINE_HINT} onClick={duplicate}>
            <Icon name="copy" size={14} /> Duplicate
          </button>
        ) : null}
        {p.status === 'pending_approval' && p.can?.approve ? (
          <>
            <button type="button" className={btnPrimary} disabled={busy || !act.approve} title={online ? undefined : OFFLINE_HINT} onClick={() => setDeciding('approve')}>
              <Icon name="check" size={14} /> Approve
            </button>
            <button type="button" className={btn} disabled={busy || !act.sendBack} title={online ? undefined : OFFLINE_HINT} onClick={() => setDeciding('send_back')}>
              <Icon name="undo" size={14} /> Send back
            </button>
          </>
        ) : null}
        {p.can?.withdraw && !['withdrawn', 'accepted', 'declined'].includes(p.status) ? (
          <button type="button" className={cx(btn, 'text-danger')} disabled={busy || !act.withdraw} title={online ? undefined : OFFLINE_HINT} onClick={() => setWithdrawing(true)}>
            Withdraw
          </button>
        ) : null}
      </div>

      {p.approval && p.approval.status !== 'none' && (p.status === 'pending_approval' || p.approval.status === 'sent_back') ? (
        <div role="note" className={cx('rounded-[8px] border px-3 py-2 text-[12.5px]', p.approval.status === 'sent_back' ? 'border-danger/30 bg-danger-bg text-ink' : 'border-warning-line bg-warning-bg text-ink dark:border-warning/40 dark:bg-warning-bg')}>
          <b>{p.approval.status === 'sent_back' ? 'Sent back' : 'Needs approval'}</b>
          {p.approval.rules.length ? ` — ${p.approval.rules.map((r) => r.label).join('; ')}` : ''}
          {p.approval.note ? <span className="block text-ink-2">“{p.approval.note}”{nameOf(p.approval.decided_by) ? ` — ${nameOf(p.approval.decided_by)}` : ''}</span> : null}
        </div>
      ) : null}

      <StatGrid min={140}>
        <Figure icon="eye" tone="blue" label="Opens" value={`${e?.opens ?? 0}${viewers.length ? ` · ${viewers.length} ${viewers.length === 1 ? 'person' : 'people'}` : ''}`} sub={e?.last_opened_at ? `last ${relative(e.last_opened_at)}` : 'not opened yet'} />
        <Figure icon="clock" tone="violet" label="Time reading" value={readingTime(e?.time_seconds)} />
        <Figure icon="coins" tone="green" label="Total" value={moneyFull(p.total, p.currency)} sub={p.valid_until ? `valid until ${dateLabel(p.valid_until)}` : undefined} />
      </StatGrid>

      <div className="grid gap-2.5 @min-[720px]:grid-cols-2">
        <Box title="Time per section">
          {(events?.sections_time ?? []).length ? (
            <div className="flex flex-col gap-2">
              {events!.sections_time.map((s) => (
                <BarRow key={s.section_id} label={s.title} value={readingTime(s.seconds)} pct={(s.seconds / timeMax) * 100} />
              ))}
            </div>
          ) : (
            <p className="m-0 text-[12.5px] text-ink-3">{ev.isLoading ? 'Loading…' : 'Nothing read yet.'}</p>
          )}
        </Box>
        <Box title="Viewers">
          {viewers.length ? (
            viewers.map((v) => (
              <div key={v.viewer} className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                <span className="min-w-0 truncate text-ink">
                  {v.viewer}
                  <span className="text-ink-3">{[v.device, v.location].filter(Boolean).length ? ` · ${[v.device, v.location].filter(Boolean).join(' · ')}` : ''}</span>
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-3">
                  {v.opens} {v.opens === 1 ? 'open' : 'opens'}
                  {v.last_at ? ` · ${relative(v.last_at)}` : ''}
                </span>
              </div>
            ))
          ) : (
            <p className="m-0 text-[12.5px] text-ink-3">Nobody has opened it yet.</p>
          )}
        </Box>
      </div>

      <Box title={`Questions${e?.questions_open ? ` · ${e.questions_open} open` : ''}`}>
        {questions.length ? questions.map((x) => <Question key={x.id} proposalId={id} q={x} />) : <p className="m-0 text-[12.5px] text-ink-3">No questions from the customer.</p>}
      </Box>

      <Box title="Sections">
        {sections.length ? (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {sections.map((s, i) => (
              <li key={s.id} data-section={s.kind} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  Section {i + 1}
                  {s.locked ? ' · locked' : ''}
                </span>
                <b className="text-[14px] text-ink">{s.title || statusLabel(s.kind)}</b>
                {s.kind === 'pricing' ? <Pricing body={s.body} currency={p.currency} total={p.total} /> : <SectionText body={s.body} />}
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[12.5px] text-ink-3">No sections.</p>
        )}
      </Box>

      {deciding ? <DecideSheet doc="proposal" id={id} number={p.number} decision={deciding} onClose={() => setDeciding(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['crm', 'proposal', id] })} /> : null}
      {withdrawing ? <Withdraw number={p.number} onClose={() => setWithdrawing(false)} onSave={async (reason) => (await run(() => apiPost(`/api/crm/proposals/${id}/withdraw`, reason ? { reason } : {}), `${p.number} withdrawn.`)) && setWithdrawing(false)} /> : null}
    </PreviewFrame>
  );
}

function PreviewFrame({ children, onClose, label = 'Proposal' }: { children: ReactNode; onClose: () => void; label?: string }) {
  return (
    <section aria-label={label} className="@container relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[12px] border border-line bg-surface p-4 scroll-thin">
      <button type="button" aria-label="Close the preview" onClick={onClose} className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
        <Icon name="x" size={14} />
      </button>
      {children}
    </section>
  );
}

function Figure({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: string; tone?: StatTone }) {
  return <StatCard data-figure={label} size="sm" label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-line px-3 py-2.5">
      <b className="text-[13px] text-ink">{title}</b>
      {children}
    </section>
  );
}

function SectionText({ body }: { body: unknown }) {
  const text = readableText(sectionHtml(body));
  if (!text) return null;
  return <p className="m-0 line-clamp-6 text-[12.5px] whitespace-pre-line text-ink-2">{text}</p>;
}

function Pricing({ body, currency, total }: { body: unknown; currency: string; total: number | null }) {
  const pr = pricingOf(body);
  return (
    <div aria-label="Pricing" className="flex flex-col gap-2">
      {pr.packages.length ? (
        <div className="flex flex-wrap gap-2">
          {pr.packages.map((x) => (
            <div key={x.key} className={cx('min-w-[120px] flex-1 rounded-[8px] px-2.5 py-2 text-[12.5px]', x.default ? 'border-2 border-primary' : 'border border-line')}>
              <span className="block text-ink-2">
                {x.name}
                {x.default ? ' · recommended' : ''}
              </span>
              <b className="text-ink tabular-nums">{x.total === null ? '—' : moneyFull(x.total, currency)}</b>
            </div>
          ))}
        </div>
      ) : null}
      <span className="text-[12.5px] text-ink-2">
        {[pr.lines ? `${pr.lines} ${pr.lines === 1 ? 'line' : 'lines'}` : null, pr.optional ? `${pr.optional} optional` : null].filter(Boolean).join(' · ')}
        {pr.lines || pr.optional ? ' · ' : ''}
        Total <b className="text-ink tabular-nums">{moneyFull(total, currency)}</b>
      </span>
    </div>
  );
}

function Question({ proposalId, q }: { proposalId: number; q: ProposalEvents['questions'][number] }) {
  const qc = useQueryClient();
  const online = useOnline();
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/crm/proposals/${proposalId}/questions/${q.id}/reply`, { body: reply.trim() });
      toast('success', 'Reply sent — by email, and on the customer’s page.');
      setReply('');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['crm', 'proposal', proposalId] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-question={q.id} className="flex flex-col gap-1 border-b border-line/60 pb-2 text-[12.5px] last:border-b-0 last:pb-0">
      <span className="text-ink">
        <b>{q.viewer ?? 'Customer'}</b>: {q.body} <span className="text-[11.5px] text-ink-3">· {relative(q.at)}</span>
      </span>
      {q.replies.map((r) => (
        <span key={r.id} className="ml-3 border-l-2 border-line pl-2 text-ink-2">
          <b>{r.by ?? 'You'}</b>: {r.body} <span className="text-[11.5px] text-ink-3">· {relative(r.at)}</span>
        </span>
      ))}
      {open ? (
        <div className="ml-3 flex items-start gap-1.5">
          <textarea autoFocus value={reply} rows={2} maxLength={2000} onChange={(e) => setReply(e.target.value)} aria-label={`Reply to ${q.viewer ?? 'the customer'}`} className={cx(input, 'h-auto py-1.5')} />
          <button type="button" className={btnPrimary} disabled={busy || !online || !reply.trim()} title={online ? undefined : OFFLINE_HINT} onClick={() => void send()}>
            Send
          </button>
        </div>
      ) : (
        <button type="button" className="ml-3 self-start text-[12px] font-semibold text-primary hover:underline disabled:text-ink-3 disabled:no-underline" disabled={!online} title={online ? undefined : OFFLINE_HINT} onClick={() => setOpen(true)}>
          Reply
        </button>
      )}
    </div>
  );
}

function Withdraw({ number, onClose, onSave }: { number: string; onClose: () => void; onSave: (reason: string) => void }) {
  const online = useOnline();
  const [reason, setReason] = useState('');
  return (
    <Sheet
      title={`Withdraw ${number}?`}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} disabled={!online} onClick={() => onSave(reason.trim())}>
            Withdraw
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">The customer’s link stops taking answers and says the proposal was withdrawn.</p>
        <Field label="Why" hint="Optional — kept on the proposal">
          <input autoFocus value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} aria-label="Why it was withdrawn" className={input} />
        </Field>
      </div>
    </Sheet>
  );
}
