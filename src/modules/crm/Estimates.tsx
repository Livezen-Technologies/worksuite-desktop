import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import { DecideSheet, type Decision } from './Approvals';
import { DocStatus } from './Proposals';
import { moneyFull, StatusBar } from './parts';
import { ESTIMATE_STATUSES, estimateActions, estimateWebPath, listMeta, OFFLINE_HINT, recordOf, rowsOf, useOnline, type Estimate, type EstimateDetail } from './proposalLogic';
import { useCrmScope } from './scope';

/**
 * Estimates (CRM SRS v1.3 §17): the list for the company the CRM is showing,
 * and one estimate read-only — its range or lines and packages, cost and
 * margin where the server shows them, the approval it is waiting for — with
 * Send (email, link, WhatsApp or PDF), Convert to a quote or a proposal, and
 * Approve or Send back for an approver. Writing one stays on the web: Edit on
 * web opens it there.
 */

const PER_PAGE = 50;

/** "LKR 400k – 600k · 70% sure", or the total. */
export function estimateValue(e: Pick<Estimate, 'mode' | 'range_from' | 'range_to' | 'confidence_pct' | 'total' | 'currency'>): string {
  if (e.mode === 'range' && (e.range_from !== null || e.range_to !== null)) return `${moneyFull(e.range_from, e.currency)} – ${moneyFull(e.range_to, null)}`;
  return moneyFull(e.total, e.currency);
}

export default function Estimates({ openId, onOpen, onOpenQuote, onOpenProposal, onOpenRecord }: { openId: number | null; onOpen: (id: number | null) => void; onOpenQuote: (id: number) => void; onOpenProposal: (id: number) => void; onOpenRecord?: (r: { type: string; id: number }) => void }) {
  const scope = useCrmScope();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const params = { q: q.trim() || undefined, status: status || undefined, ...scope.params, page, per_page: PER_PAGE };
  const list = useQuery({
    queryKey: ['crm', 'estimates', params],
    queryFn: async ({ signal }) => {
      const r = await apiGetMeta<unknown>('/api/crm/estimates', params, signal);
      const rows = rowsOf<Estimate>(r.data, 'estimates');
      return { rows, meta: listMeta(r.data, r.meta, rows.length) };
    },
    enabled: !openId,
  });
  if (openId) return <EstimateView key={openId} id={openId} onBack={() => onOpen(null)} onOpenQuote={onOpenQuote} onOpenProposal={onOpenProposal} onOpenRecord={onOpenRecord} />;
  const rows = list.data?.rows ?? [];
  const meta = list.data?.meta ?? null;
  const count = (s: string) => meta?.counts?.[s] ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead title="Estimates" sub={scope.name} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Estimate no., title or customer" aria-label="Search estimates" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <Select label="Status" value={status} onValueChange={(v) => (setStatus(v), setPage(1))} options={[{ value: '', label: 'Any status' }, ...ESTIMATE_STATUSES.map(([v, l]) => ({ value: v, label: l }))]} />
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-[#F7F8FB] px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
          <span className="w-[110px] shrink-0">Estimate</span>
          <span className="min-w-0 flex-1">Title · for</span>
          <span className="w-[130px] shrink-0">Status</span>
          <span className="w-[110px] shrink-0">Valid until</span>
          <span className="w-[200px] shrink-0 text-right">Value</span>
        </div>
        <div className="min-h-0 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {rows.map((r) => (
            <div key={r.id} data-estimate={r.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] hover:bg-subtle" onClick={() => onOpen(r.id)}>
              <b className="w-[110px] shrink-0 truncate font-mono text-ink">{r.number}</b>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ink">{r.title}</span>
                <span className="truncate text-[11.5px] text-ink-3">{r.subject?.label ?? '—'}</span>
              </span>
              <span className="w-[130px] shrink-0">
                <DocStatus status={r.status} />
              </span>
              <span className="w-[110px] shrink-0 text-ink-2">{r.valid_until ? dateLabel(r.valid_until) : '—'}</span>
              <b className="w-[200px] shrink-0 truncate text-right text-ink tabular-nums">{estimateValue(r)}</b>
            </div>
          ))}
          {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">No estimates match.</p> : null}
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
          {meta ? [`${meta.total} ${meta.total === 1 ? 'estimate' : 'estimates'}`, ...ESTIMATE_STATUSES.filter(([s]) => count(s)).map(([s, l]) => `${count(s)} ${l.toLowerCase()}`)].join(' · ') : null}
        </StatusBar>
      </div>
    </div>
  );
}

function EstimateView({ id, onBack, onOpenQuote, onOpenProposal, onOpenRecord }: { id: number; onBack: () => void; onOpenQuote: (id: number) => void; onOpenProposal: (id: number) => void; onOpenRecord?: (r: { type: string; id: number }) => void }) {
  const online = useOnline();
  const q = useQuery({ queryKey: ['crm', 'estimate', id], queryFn: async ({ signal }) => recordOf<EstimateDetail>(await apiGet<unknown>(`/api/crm/estimates/${id}`, undefined, signal), 'estimate'), staleTime: 0, refetchOnMount: 'always' });
  const e = q.data ?? null;
  const act = estimateActions(e, { online });
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const openConverted = (c: { type: string; id: number }) => (c.type === 'quote' ? onOpenQuote(c.id) : onOpenProposal(c.id));

  return (
    <div className="@container flex min-h-0 flex-1 flex-col gap-3">
      <button type="button" className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={onBack}>
        <Icon name="back" size={13} /> Estimates
      </button>
      {q.isLoading ? <Spinner /> : q.error || !e ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {e ? (
        <>
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="m-0 flex flex-wrap items-center gap-2 text-[20px] font-bold text-ink">
                <span className="font-mono">{e.number}</span>
                <span className="min-w-0 truncate">· {e.title}</span>
                <DocStatus status={e.status} />
              </h1>
              <span className="text-[12.5px] text-ink-3">
                {e.subject && onOpenRecord ? (
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenRecord({ type: e.subject!.type, id: e.subject!.id })}>
                    {e.subject.label ?? e.subject.type}
                  </button>
                ) : (
                  (e.subject?.label ?? 'No customer')
                )}
                {[e.owner?.name ? `owner ${e.owner.name}` : null, e.valid_until ? `valid until ${dateLabel(e.valid_until)}` : null, e.revision ? `revision ${e.revision}` : null].filter(Boolean).map((f) => ` · ${f}`).join('')}
              </span>
            </div>
            <div role="toolbar" aria-label="Estimate actions" className="flex flex-wrap gap-1.5">
              <button type="button" className={btn} disabled={!act.web} title={act.web ? 'Opens on the web' : OFFLINE_HINT} onClick={() => void call('app:openInBrowser', { path: estimateWebPath(id) }).catch((x) => toast('error', errorMessage(x)))}>
                <Icon name="external" size={14} /> {act.edit ? 'Edit on web' : 'Open in web'}
              </button>
              {e.can?.send ? (
                <button type="button" className={btn} disabled={!act.send} title={online ? undefined : OFFLINE_HINT} onClick={() => setSending(true)}>
                  <Icon name="send" size={14} /> Send
                </button>
              ) : null}
              {e.can?.convert && !e.converted ? (
                <button type="button" className={btnPrimary} disabled={!act.convert} title={online ? undefined : OFFLINE_HINT} onClick={() => setConverting(true)}>
                  <Icon name="repeat" size={14} /> Convert
                </button>
              ) : null}
              {e.converted ? (
                <button type="button" className={btn} onClick={() => openConverted(e.converted!)}>
                  <Icon name="file-text" size={14} /> {e.converted.type === 'quote' ? 'Quote' : 'Proposal'} {e.converted.number}
                </button>
              ) : null}
              {e.status === 'pending_approval' && e.can?.approve ? (
                <>
                  <button type="button" className={btnPrimary} disabled={!act.approve} title={online ? undefined : OFFLINE_HINT} onClick={() => setDeciding('approve')}>
                    <Icon name="check" size={14} /> Approve
                  </button>
                  <button type="button" className={btn} disabled={!act.approve} title={online ? undefined : OFFLINE_HINT} onClick={() => setDeciding('send_back')}>
                    <Icon name="undo" size={14} /> Send back
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {e.approval && (e.status === 'pending_approval' || e.approval.status === 'sent_back') ? (
            <div role="note" className="rounded-[8px] border border-[#F5C77E] bg-[#FFF8EB] px-3 py-2 text-[12.5px] text-ink dark:border-warning/40 dark:bg-warning-bg">
              <b>{e.approval.status === 'sent_back' ? 'Sent back' : 'Needs approval before it is sent'}</b>
              {e.approval.rules.length ? ` — ${e.approval.rules.map((r) => r.label).join('; ')}` : ''}
              {e.approval.note ? <span className="block text-ink-2">“{e.approval.note}”</span> : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5 @min-[760px]:grid-cols-4">
            <Fig label={e.mode === 'range' ? 'Range' : 'Total'} value={estimateValue(e)} sub={e.mode === 'range' && e.mid !== null ? `mid ${moneyFull(e.mid, e.currency)}` : undefined} />
            {e.confidence_pct !== null ? <Fig label="Confidence" value={`${e.confidence_pct}%`} /> : null}
            {e.cost !== undefined && e.cost !== null ? <Fig label="Cost" value={moneyFull(e.cost, e.currency)} /> : null}
            {e.margin !== undefined && e.margin !== null ? <Fig label="Margin" value={moneyFull(e.margin, e.currency)} sub={e.margin_pct !== null && e.margin_pct !== undefined ? `${e.margin_pct}%` : undefined} /> : null}
          </div>

          {e.packages?.length ? (
            <div aria-label="Packages" className="flex flex-wrap gap-2">
              {e.packages.map((p) => (
                <div key={p.key} className={cx('min-w-[160px] flex-1 rounded-[10px] bg-surface px-3 py-2.5 text-[12.5px]', p.default ? 'border-2 border-primary' : 'border border-line')}>
                  <span className="block text-ink-2">
                    {p.name}
                    {p.default ? ' · default' : ''}
                  </span>
                  <b className="text-[15px] text-ink tabular-nums">{moneyFull(p.total, e.currency)}</b>
                </div>
              ))}
            </div>
          ) : null}

          {e.lines?.length ? (
            <div role="table" aria-label="Lines" className="overflow-x-auto rounded-[10px] border border-line bg-surface">
              <div role="row" className="flex min-w-[640px] items-center gap-2 border-b border-line bg-[#F7F8FB] px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
                <span role="columnheader" className="min-w-[180px] flex-1">Description</span>
                <span role="columnheader" className="w-[60px] shrink-0 text-right">Qty</span>
                <span role="columnheader" className="w-[120px] shrink-0 text-right">Rate</span>
                <span role="columnheader" className="w-[64px] shrink-0 text-right">Disc %</span>
                <span role="columnheader" className="w-[136px] shrink-0 text-right">Amount</span>
              </div>
              {e.lines.map((l) => (
                <div role="row" key={l.id} className="flex min-w-[640px] items-center gap-2 border-b border-line/60 px-3 py-2 text-[13px] last:border-b-0">
                  <span role="cell" className="min-w-[180px] flex-1 text-ink">
                    {l.description}
                    {l.package ? <span className="text-ink-3"> · {l.package}</span> : null}
                    {l.optional ? <span className="text-ink-3"> · optional</span> : null}
                  </span>
                  <span role="cell" className="w-[60px] shrink-0 text-right text-ink-2 tabular-nums">{l.qty}</span>
                  <span role="cell" className="w-[120px] shrink-0 text-right text-ink-2 tabular-nums">{moneyFull(l.unit_price)}</span>
                  <span role="cell" className="w-[64px] shrink-0 text-right text-ink-2 tabular-nums">{l.discount_pct || 0}</span>
                  <b role="cell" className="w-[136px] shrink-0 text-right text-ink tabular-nums">{moneyFull(l.line_total)}</b>
                </div>
              ))}
            </div>
          ) : null}

          {e.assumptions ? (
            <Field label="Assumptions">
              <p className="m-0 text-[13px] whitespace-pre-wrap text-ink-2">{e.assumptions}</p>
            </Field>
          ) : null}
          {e.share_url ? (
            <p className="m-0 flex items-center gap-2 text-[12.5px] text-ink-2">
              Customer link: <span className="truncate font-mono">{e.share_url}</span>
              <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(e.share_url!).then(() => toast('success', 'Customer link copied.'))}>
                <Icon name="copy" size={13} className="mr-1" /> Copy
              </button>
            </p>
          ) : null}

          {sending ? <SendEstimate estimate={e} onClose={() => setSending(false)} /> : null}
          {converting ? <ConvertEstimate estimate={e} onClose={() => setConverting(false)} onConverted={openConverted} /> : null}
          {deciding ? <DecideSheet doc="estimate" id={id} number={e.number} decision={deciding} onClose={() => setDeciding(null)} /> : null}
        </>
      ) : null}
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div data-figure={label} className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
      <span className="text-[12px] font-semibold text-ink-3">{label}</span>
      <b className="truncate text-[17px] text-ink tabular-nums">{value}</b>
      {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
    </div>
  );
}

type Channel = 'email' | 'link' | 'whatsapp' | 'pdf';

/** Send (`estimates/{id}/send`): a rule that needs approval answers 409 `approval_required`, and the estimate waits for it. */
export function SendEstimate({ estimate, onClose }: { estimate: Pick<Estimate, 'id' | 'number'>; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const [channel, setChannel] = useState<Channel>('email');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ share_url?: string; whatsapp_url?: string; pdf_url?: string } | null>(null);
  const send = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ share_url?: string; whatsapp_url?: string; pdf_url?: string }>(`/api/crm/estimates/${estimate.id}/send`, { channel, ...(to.trim() ? { to: to.trim() } : {}), ...(message.trim() ? { message: message.trim() } : {}) });
      toast('success', channel === 'email' ? `${estimate.number} emailed.` : `${estimate.number} is ready to share.`);
      setSent(r ?? {});
      void qc.invalidateQueries({ queryKey: ['crm'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'approval_required') {
        toast('info', `${estimate.number} needs approval first — it has been sent to the approver.`);
        void qc.invalidateQueries({ queryKey: ['crm'] });
        onClose();
      } else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Send ${estimate.number}`}
      width={460}
      onClose={onClose}
      footer={
        sent ? (
          <button type="button" className={btnPrimary} onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !online || (channel === 'email' && !to.trim())} title={online ? undefined : OFFLINE_HINT} onClick={() => void send()}>
              Send
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col gap-2 text-[13px] text-ink-2">
          <p className="m-0">Sent. The customer’s link:</p>
          {sent.share_url ? (
            <p className="m-0 flex items-center gap-2">
              <span className="min-w-0 truncate font-mono text-ink">{sent.share_url}</span>
              <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(sent.share_url!).then(() => toast('success', 'Customer link copied.'))}>
                Copy
              </button>
            </p>
          ) : null}
          {sent.whatsapp_url ? (
            <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(sent.whatsapp_url!).then(() => toast('success', 'WhatsApp link copied.'))}>
              Copy the WhatsApp link
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="How">
            <Select<Channel> label="How" value={channel} onValueChange={setChannel} options={[{ value: 'email', label: 'Email' }, { value: 'link', label: 'A link to share' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'pdf', label: 'PDF' }]} />
          </Field>
          {channel === 'email' || channel === 'whatsapp' ? (
            <Field label={channel === 'email' ? 'To' : 'Phone (optional)'}>
              <input value={to} maxLength={255} onChange={(e) => setTo(e.target.value)} aria-label="To" className={input} />
            </Field>
          ) : null}
          <Field label="Message" hint="Optional">
            <textarea value={message} maxLength={2000} rows={3} onChange={(e) => setMessage(e.target.value)} aria-label="Message" className={cx(input, 'h-auto py-2')} />
          </Field>
          {!online ? <p className="m-0 text-[12px] text-danger">{OFFLINE_HINT}</p> : null}
        </div>
      )}
    </Sheet>
  );
}

/** Convert (`estimates/{id}/convert`): to a quote or a proposal; an estimate on a lead converts the lead to a deal first, when asked (409 `lead_needs_deal`). */
export function ConvertEstimate({ estimate, onClose, onConverted }: { estimate: Pick<Estimate, 'id' | 'number' | 'subject'>; onClose: () => void; onConverted: (c: { type: string; id: number }) => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const onLead = estimate.subject?.type === 'lead';
  const [to, setTo] = useState<'quote' | 'proposal'>('quote');
  const [convertLead, setConvertLead] = useState(onLead);
  const [needsDeal, setNeedsDeal] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ type: 'quote' | 'proposal'; id: number; number: string }>(`/api/crm/estimates/${estimate.id}/convert`, { to, ...(onLead || needsDeal ? { convert_lead: convertLead } : {}) });
      toast('success', `${estimate.number} converted to ${r.type === 'quote' ? 'quote' : 'proposal'} ${r.number}.`);
      void qc.invalidateQueries({ queryKey: ['crm'] });
      onClose();
      onConverted({ type: r.type ?? to, id: r.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'lead_needs_deal') {
        setNeedsDeal(true);
        setConvertLead(true);
        toast('info', 'This estimate is on a lead: it becomes a deal first. Tick the box to go ahead.');
      } else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Convert ${estimate.number}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !online || (needsDeal && !convertLead)} title={online ? undefined : OFFLINE_HINT} onClick={() => void save()}>
            Convert
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Into">
          <Select<'quote' | 'proposal'> label="Into" value={to} onValueChange={setTo} options={[{ value: 'quote', label: 'A quote' }, { value: 'proposal', label: 'A proposal (from the default template)' }]} />
        </Field>
        {onLead || needsDeal ? (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={convertLead} onChange={(ev) => setConvertLead(ev.target.checked)} />
            Convert the lead to a deal first
          </label>
        ) : null}
        <p className="m-0 text-[12.5px] text-ink-3">The two are linked both ways; the estimate is marked converted.</p>
      </div>
    </Sheet>
  );
}
