import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { call } from '../../../core/bridge';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Panel } from '../../hr/parts';
import { amount, OFFLINE_WRITE, refusalOf } from '../api';
import {
  addLine,
  carryDeferred,
  currentVersion,
  decideDiscount,
  declinedSafety,
  fetchAdditional,
  fetchEstimate,
  KB1,
  lookupParts,
  newLink,
  newVersion,
  openEstimate,
  previewDecisions,
  pullRecommendations,
  recallVersion,
  recordApproval,
  recordChanges,
  removeLine,
  revokeLink,
  sendVersion,
  undecided,
  updateLine,
  updateVersion,
  useEstimateOptions,
  withdrawAdditional,
  type EstimateAnswer,
  type EstimateOptions,
  type Line,
  type Version,
} from '../api-b1';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';
import { SignaturePad } from './SignaturePad';

/**
 * The estimate (SRS §15, §28.6, FR-EST-01..08, FR-APR-01..06, WF-07/08/13),
 * stage B1. Every figure is the server's: lines are priced by Billing and
 * Inventory, totals come back with each answer, and "what if these were
 * approved" is asked of `preview`. A version once sent never changes; a new
 * one is made instead. Sending hands back the customer's link and a ready
 * message once — the server sends nothing itself, so the advisor copies it or
 * opens it in their mail or WhatsApp. The customer's answer given by phone, in
 * person or by email is recorded here by those who may.
 */
const DECISION_TONE: Record<string, 'green' | 'red' | 'grey' | 'blue' | 'amber'> = { approved: 'green', executed: 'green', invoiced: 'green', rejected: 'red', deferred: 'grey', proposed: 'blue' };
const VERSION_TONE = (s: string): 'green' | 'amber' | 'red' | 'grey' | 'blue' => (s === 'approved' || s === 'partially_approved' ? 'green' : s === 'rejected' || s === 'expired' ? 'red' : s === 'superseded' ? 'grey' : s === 'draft' ? 'blue' : 'amber');
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '');
const who = (p: unknown) => (p && typeof p === 'object' && 'name' in p ? String((p as { name: unknown }).name ?? '') : typeof p === 'string' ? p : '');

export default function Estimate({ job, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB1.estimate(job.id), queryFn: ({ signal }) => fetchEstimate(job.id, signal), refetchOnMount: 'always' });
  const opts = useEstimateOptions();
  const extra = useQuery({ queryKey: KB1.additional(job.id), queryFn: ({ signal }) => fetchAdditional(job.id, signal) });
  const [picked, setPicked] = useState<number | null>(null);
  const [ask, setAsk] = useState<null | { kind: 'line'; line: Line | null } | { kind: 'send' } | { kind: 'decision' } | { kind: 'changes' } | { kind: 'version' } | { kind: 'discount'; decision: 'reject' | 'return' } | { kind: 'withdraw'; id: number }>(null);
  const [handed, setHanded] = useState<{ url: string; text: string; expires: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const settle = (a: EstimateAnswer | null) => {
    if (a?.estimate) qc.setQueryData(KB1.estimate(job.id), { estimate: a.estimate });
    void qc.invalidateQueries({ queryKey: KB1.estimate(job.id) });
    void qc.invalidateQueries({ queryKey: KB1.additional(job.id) });
    onChanged();
  };
  const run = async (key: string, fn: () => Promise<{ data: EstimateAnswer; message?: string | null }>, done: string): Promise<EstimateAnswer | null> => {
    if (!online) {
      toast('error', OFFLINE_WRITE);
      return null;
    }
    setBusy(key);
    try {
      const r = await fn();
      toast('success', r.message || done);
      for (const w of r.data.warnings ?? []) toast('warning', w);
      settle(r.data);
      return r.data;
    } catch (e) {
      toast('error', refusalOf(e).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const tab = q.data.estimate;
  const co = opts.data?.companies.find((c) => c.id === job.org_id);
  const finished = ['draft', 'completed', 'cancelled'].includes(job.status);

  if (!tab.estimate)
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-2">{job.status === 'draft' ? 'The estimate is prepared once the vehicle is checked in.' : 'No estimate yet.'}</p>
        {tab.can.create && !finished ? (
          <button type="button" className={cx(btnPrimary, 'self-start')} disabled={!online || !!busy} onClick={() => void run('open', () => openEstimate(job.id), 'Estimate opened.')}>
            <Icon name="receipt" size={15} /> Open the estimate
          </button>
        ) : null}
        <Recommendations tab={tab} busy={!!busy} online={online} onPull={() => void run('pull', () => pullRecommendations(job.id), 'Added.')} />
      </div>
    );

  const v = currentVersion(tab, picked);
  const draft = !!v?.editable && v.status === 'draft';
  const recs = tab.recommendations.diagnostics.length + tab.recommendations.inspection.filter((x) => !x.on_estimate).length;

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Estimate" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px]">
        <b className="text-[14px] text-ink">{tab.estimate.number}</b>
        <span className="text-ink-2">
          Estimate {amount(tab.totals.estimate, tab.estimate.currency)}
          {tab.totals.approved ? ` · approved ${amount(tab.totals.approved, tab.estimate.currency)}` : ''}
        </span>
        <span className="flex-1" />
        {tab.versions.length > 1 ? (
          <Select aria-label="Version" value={String(v?.id ?? '')} onValueChange={(x) => setPicked(Number(x))} options={tab.versions.map((x) => ({ value: String(x.id), label: `${x.label} · ${x.status_label}` }))} />
        ) : null}
        {tab.can.create && v?.latest && !draft && !finished ? (
          <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'version' })}>
            <Icon name="plus" size={13} /> New version
          </button>
        ) : null}
      </section>

      {v ? (
        <section aria-label={v.label} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <b className="text-ink">{v.label}</b>
            <Pill tone={VERSION_TONE(v.status)}>{v.status_label}</Pill>
            <Pill tone="grey">{v.kind_label}</Pill>
            <span className="text-[12px] text-ink-3">{[v.sent_at ? `sent ${stamp(v.sent_at)}${v.sent_channel ? ` (${opts.data?.channels[v.sent_channel] ?? v.sent_channel})` : ''}` : null, v.viewed_at ? `opened ${stamp(v.viewed_at)}` : null, v.valid_until ? `valid until ${dateLabel(v.valid_until)}` : null].filter(Boolean).join(' · ')}</span>
          </div>
          {v.change_summary ? <p className="m-0 px-4 text-[12.5px] text-ink-2">{v.change_summary}</p> : null}
          <LineTable v={v} options={opts.data} editable={draft && tab.can.edit && online} onEdit={(line) => setAsk({ kind: 'line', line })} onRemove={(line) => void run(`rm:${line.id}`, () => removeLine(line.id), 'Line removed.')} />
          <Totals v={v} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            {draft && tab.can.edit ? (
              <>
                <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'line', line: null })}>
                  <Icon name="plus" size={13} /> Add a line
                </button>
                {tab.can.create && recs ? (
                  <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void run('pull', () => pullRecommendations(job.id), 'Added.')}>
                    Pull what was found ({recs})
                  </button>
                ) : null}
              </>
            ) : null}
            <span className="flex-1" />
            {v.status === 'pending_internal_approval' ? (
              <>
                <span className="text-[12px] text-warning">Waiting for a discount decision{v.discount_approval?.asked_by ? ` (asked by ${v.discount_approval.asked_by})` : ''}.</span>
                {v.discount_approval?.may_decide ? (
                  <>
                    <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void run('disc', () => decideDiscount(v.id, { decision: 'approve' }), 'Discount approved; the estimate is sent.')}>
                      Approve the discount
                    </button>
                    <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'discount', decision: 'return' })}>
                      Return
                    </button>
                    <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'discount', decision: 'reject' })}>
                      Reject
                    </button>
                  </>
                ) : null}
                {tab.can.send || tab.can.create ? (
                  <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void run('recall', () => recallVersion(v.id), 'Taken back to draft.')}>
                    Take it back
                  </button>
                ) : null}
              </>
            ) : null}
            {(v.status === 'sent' || v.status === 'viewed') && v.latest ? (
              <>
                {tab.can.record_decision ? (
                  <>
                    <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'changes' })}>
                      Customer asks for changes
                    </button>
                    <button type="button" className={btnPrimary} disabled={!online} onClick={() => setAsk({ kind: 'decision' })}>
                      <Icon name="check" size={15} /> Record the customer’s answer
                    </button>
                  </>
                ) : null}
                {tab.can.send ? (
                  <button
                    type="button"
                    className={btnSmall}
                    disabled={!online || !!busy}
                    onClick={() =>
                      void run('link', () => newLink(v.id), 'A new link is ready.').then((a) => a?.link && setHanded({ url: a.link.url, text: a.text ?? a.link.url, expires: a.link.expires_at }))
                    }
                  >
                    New link
                  </button>
                ) : null}
              </>
            ) : null}
            {draft && v.latest && tab.can.send ? (
              <button type="button" className={btnPrimary} disabled={!online || !v.lines.length} onClick={() => setAsk({ kind: 'send' })}>
                <Icon name="send" size={15} /> Send to the customer
              </button>
            ) : null}
          </div>
          {v.approvals.length ? (
            <div className="border-t border-line px-4 py-2.5 text-[12.5px]">
              <b className="text-ink">The customer’s answers</b>
              {v.approvals.map((a) => (
                <div key={a.id} className="flex flex-wrap gap-2 py-1 text-ink-2">
                  <span className="text-ink-3">{stamp(a.decided_at)}</span>
                  <b className="text-ink">{a.approver_name ?? 'The customer'}</b>
                  <span>
                    {a.method_label} · {a.outcome.replace(/_/g, ' ')}
                  </span>
                  {a.safety_acknowledged ? <Pill tone="amber">Safety acknowledged</Pill> : null}
                  {a.signed ? <Pill tone="green">Signed</Pill> : null}
                  {a.comment ? <span className="w-full text-ink-3">“{a.comment}”</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          {v.links.length && tab.can.send ? (
            <div className="border-t border-line px-4 py-2.5 text-[12.5px]">
              <b className="text-ink">Links</b>
              {v.links.map((l) => (
                <div key={l.id} className="flex items-center gap-2 py-1 text-ink-2">
                  <span className="flex-1">
                    Made {stamp(l.created_at)}
                    {who(l.by) ? ` by ${who(l.by)}` : ''} · {l.uses} {l.uses === 1 ? 'visit' : 'visits'} · {l.live ? `works until ${dateLabel(l.expires_at)}` : l.revoked_at ? 'taken back' : 'expired'}
                  </span>
                  {l.live ? (
                    <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void run(`rev:${l.id}`, () => revokeLink(l.id), 'The link no longer works.')}>
                      Take it back
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <Recommendations tab={tab} busy={!!busy} online={online && tab.can.create && draft} onPull={() => void run('pull', () => pullRecommendations(job.id), 'Added.')} />

      {tab.deferred_elsewhere.length ? (
        <Panel title="Left for later on earlier visits" sub="Offer it again on this estimate">
          {tab.deferred_elsewhere.map((l) => (
            <div key={l.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
              {l.vhc ? <span className={cx('h-2 w-2 rounded-full', l.vhc === 'red' ? 'bg-danger' : l.vhc === 'amber' ? 'bg-warning' : 'bg-success')} /> : null}
              <span className="min-w-0 flex-1 truncate text-ink">{l.description}</span>
              <span className="text-ink-3">{l.job_number}</span>
              {tab.can.create && draft ? (
                <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void run(`carry:${l.id}`, () => carryDeferred(job.id, l.id), 'Offered again.')}>
                  Add
                </button>
              ) : null}
            </div>
          ))}
        </Panel>
      ) : null}

      {extra.data?.items.length ? (
        <Panel title="Additional work" sub="Found while the work was being done">
          {extra.data.items.map((w) => (
            <div key={w.id} className="flex flex-col gap-0.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="flex items-center gap-2">
                <b className="min-w-0 flex-1 text-ink">{w.finding}</b>
                {w.work_order ? <span className="text-ink-3">{w.work_order.code}</span> : null}
                <Pill tone={w.status === 'approved' ? 'green' : w.status === 'declined' || w.status === 'withdrawn' ? 'grey' : 'amber'}>{w.status_label}</Pill>
                {w.status === 'proposed' && tab.can.edit ? (
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'withdraw', id: w.id })}>
                    Withdraw
                  </button>
                ) : null}
              </span>
              <span className="text-ink-3">{w.lines.map((l) => `${l.description}${l.total ? ` (${amount(l.total, tab.estimate?.currency)})` : ''}`).join('; ')}</span>
              {w.customer_ack ? <span className="text-ink-2">{w.customer_ack}</span> : null}
            </div>
          ))}
        </Panel>
      ) : null}

      {ask?.kind === 'line' && v ? <LineSheet v={v} line={ask.line} options={opts.data} company={co} onClose={() => setAsk(null)} onSave={(body) => void run('line', () => (ask.line ? updateLine(ask.line.id, body) : addLine(v.id, body)), ask.line ? 'Line saved.' : 'Line added.').then((a) => a && setAsk(null))} /> : null}
      {ask?.kind === 'send' && v ? (
        <SendSheet
          v={v}
          options={opts.data}
          overLimit={!!co && !co.may_override_discount && v.lines.some((l) => Number(l.discount_pct) > Number(tab.discount_limit_pct))}
          onClose={() => setAsk(null)}
          onSend={(channel, summary) =>
            void run('send', () => sendVersion(v.id, { channel, ...(summary ? { change_summary: summary } : {}) }), 'Sent.').then((a) => {
              if (!a) return;
              setAsk(null);
              if (a.link) setHanded({ url: a.link.url, text: a.text ?? a.link.url, expires: a.link.expires_at });
            })
          }
        />
      ) : null}
      {ask?.kind === 'decision' && v ? <DecisionSheet v={v} options={opts.data} signatureRequired={!!co?.signature_required} customer={job.customer?.name ?? ''} onClose={() => setAsk(null)} onSave={(body) => void run('decide', () => recordApproval(v.id, body), 'The customer’s answer is recorded.').then((a) => a && setAsk(null))} /> : null}
      {ask?.kind === 'changes' && v ? <ChangesSheet options={opts.data} customer={job.customer?.name ?? ''} onClose={() => setAsk(null)} onSave={(body) => void run('changes', () => recordChanges(v.id, body), 'Recorded: the customer asked for changes.').then((a) => a && setAsk(null))} /> : null}
      {ask?.kind === 'version' && tab.estimate ? <TextSheet title="New version" label="What changes, for the customer" onClose={() => setAsk(null)} onSave={(t) => void run('version', () => newVersion(tab.estimate!.id, t), 'A new version is ready to edit.').then((a) => a && (setAsk(null), setPicked(a.version_id ?? null)))} /> : null}
      {ask?.kind === 'discount' && v ? <TextSheet title={ask.decision === 'reject' ? 'Reject the discount' : 'Return to the advisor'} label="Why" required onClose={() => setAsk(null)} onSave={(t) => void run('disc', () => decideDiscount(v.id, { decision: ask.decision, comment: t }), 'Back with the advisor.').then((a) => a && setAsk(null))} /> : null}
      {ask?.kind === 'withdraw' ? (
        <TextSheet
          title="Withdraw the additional work"
          label="Why"
          required
          onClose={() => setAsk(null)}
          onSave={(t) => {
            if (!online) return toast('error', OFFLINE_WRITE);
            void withdrawAdditional(ask.id, t).then(
              (r) => (toast('success', r.message || 'Withdrawn.'), (r.data.warnings ?? []).forEach((w) => toast('warning', w)), setAsk(null), settle(null)),
              (e) => toast('error', refusalOf(e).message),
            );
          }}
        />
      ) : null}
      {handed ? <LinkSheet handed={handed} phone={job.customer?.phone ?? null} email={job.customer?.email ?? null} onClose={() => setHanded(null)} /> : null}
      {draft && v && tab.can.edit ? <SummaryEditor v={v} online={online} onSave={(t) => void run('summary', () => updateVersion(v.id, t), 'Saved.')} /> : null}
    </div>
  );
}

function LineTable({ v, options, editable, onEdit, onRemove }: { v: Version; options: EstimateOptions | undefined; editable: boolean; onEdit: (l: Line) => void; onRemove: (l: Line) => void }) {
  if (!v.lines.length) return <p className="m-0 px-4 py-3 text-[12.5px] text-ink-3">No lines yet.</p>;
  return (
    <div className="overflow-x-auto px-4 scroll-thin" role="table" aria-label="Lines">
      <div role="row" className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_70px_110px_60px_110px_120px_60px] gap-2 border-b border-line pb-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        <span role="columnheader">Line</span>
        <span role="columnheader">Qty</span>
        <span role="columnheader">Unit price</span>
        <span role="columnheader">Disc.</span>
        <span role="columnheader">Total</span>
        <span role="columnheader">Decision</span>
        <span />
      </div>
      {v.lines.map((l) => (
        <div key={l.id} role="row" className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_70px_110px_60px_110px_120px_60px] items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
          <span className="flex min-w-0 flex-col" role="cell">
            <span className="flex items-center gap-1.5">
              {l.vhc ? <span title={`Health check: ${l.vhc}`} className={cx('h-2 w-2 shrink-0 rounded-full', l.vhc === 'red' ? 'bg-danger' : l.vhc === 'amber' ? 'bg-warning' : 'bg-success')} /> : null}
              <b className="truncate text-ink">{l.description}</b>
              {l.safety ? <Pill tone="red">Safety</Pill> : null}
            </span>
            <span className="truncate text-[11.5px] text-ink-3">
              {[l.type_label, l.source !== 'manual' ? (options?.sources[l.source] ?? l.source) : null, l.payer !== 'customer' ? `paid by ${options?.payers[l.payer] ?? l.payer}` : null, l.availability ? l.availability.label : null].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span role="cell" className="tabular-nums">
            {l.labour_hours ? `${l.labour_hours} h` : `${l.qty}${l.unit ? ` ${l.unit}` : ''}`}
          </span>
          <span role="cell" className="tabular-nums">
            {amount(l.unit_price)}
          </span>
          <span role="cell" className="tabular-nums">
            {Number(l.discount_pct) ? `${l.discount_pct}%` : '—'}
          </span>
          <b role="cell" className="text-ink tabular-nums">
            {amount(l.total)}
          </b>
          <span role="cell">
            <Pill tone={DECISION_TONE[l.decision] ?? 'grey'}>{l.decision_label}</Pill>
          </span>
          <span role="cell" className="flex justify-end gap-1">
            {editable ? (
              <>
                <button type="button" aria-label={`Edit ${l.description}`} className="text-ink-3 hover:text-ink" onClick={() => onEdit(l)}>
                  <Icon name="compose" size={14} />
                </button>
                <button type="button" aria-label={`Remove ${l.description}`} className="text-ink-3 hover:text-danger" onClick={() => onRemove(l)}>
                  <Icon name="trash" size={14} />
                </button>
              </>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function Totals({ v }: { v: Version }) {
  const payers = Object.entries(v.by_payer ?? {});
  return (
    <dl className="m-0 flex flex-wrap justify-end gap-x-6 gap-y-1 px-4 text-[12.5px]">
      {(
        [
          ['Subtotal', v.totals.subtotal],
          ['Discount', v.totals.discount],
          ['Tax', v.totals.tax],
          ['Total', v.totals.total],
          ...(v.totals.approved !== null ? [['Approved', v.totals.approved] as [string, string]] : []),
        ] as Array<[string, string]>
      ).map(([k, x]) => (
        <div key={k} className="flex flex-col items-end">
          <dt className="text-[11.5px] text-ink-3">{k}</dt>
          <dd className={cx('m-0 tabular-nums', k === 'Total' || k === 'Approved' ? 'font-bold text-ink' : 'text-ink-2')}>{amount(x, k === 'Total' ? v.currency : null)}</dd>
        </div>
      ))}
      {payers.length > 1 ? <div className="w-full text-right text-[11.5px] text-ink-3">{payers.map(([p, x]) => `${p}: ${amount(x)}`).join(' · ')}</div> : null}
    </dl>
  );
}

function Recommendations({ tab, busy, online, onPull }: { tab: { recommendations: { diagnostics: Array<{ id: number; complaint: string | null; recommended_repair: string | null }>; inspection: Array<{ id: number; label: string; result: string | null; on_estimate: boolean }> } }; busy: boolean; online: boolean; onPull: () => void }) {
  const d = tab.recommendations.diagnostics;
  const i = tab.recommendations.inspection.filter((x) => !x.on_estimate);
  if (!d.length && !i.length) return null;
  return (
    <Panel
      title="Found, not on the estimate yet"
      action={
        online ? (
          <button type="button" className={btnSmall} disabled={busy} onClick={onPull}>
            Pull them all
          </button>
        ) : null
      }
    >
      {d.map((x) => (
        <div key={`d${x.id}`} className="border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
          <b className="text-ink">{x.recommended_repair ?? x.complaint}</b> <span className="text-ink-3">· diagnosis</span>
        </div>
      ))}
      {i.map((x) => (
        <div key={`i${x.id}`} className="border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
          <b className="text-ink">{x.label}</b> <span className="text-ink-3">· inspection {x.result ?? ''}</span>
        </div>
      ))}
    </Panel>
  );
}

/** The body of a line for `POST versions/{id}/lines` / `PATCH estimate-lines/{id}`: only what its type takes (prices of parts and labour are the server's). */
export function lineBody(f: { line_type: string; description: string; product_id: number | null; qty: string; unit_price: string; labour_hours: string; labor_rate_id: string; discount_pct: string; tax_rate_ids: number[]; coverage: string; payer: string; safety: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = { line_type: f.line_type, description: f.description.trim() || null, discount_pct: f.discount_pct.trim() || '0', tax_rate_ids: f.tax_rate_ids, coverage: f.coverage || 'none', payer: f.payer || 'customer', safety: f.safety };
  if (f.line_type === 'labour') {
    body.labour_hours = f.labour_hours.trim();
    if (f.labor_rate_id) body.labor_rate_id = Number(f.labor_rate_id);
  } else if (f.product_id) {
    body.product_id = f.product_id;
    body.qty = f.qty.trim() || '1';
  } else {
    body.qty = f.qty.trim() || '1';
    body.unit_price = f.unit_price.trim();
  }
  return body;
}

function LineSheet({ v, line, options, company, onClose, onSave }: { v: Version; line: Line | null; options: EstimateOptions | undefined; company: EstimateOptions['companies'][number] | undefined; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState(() => ({
    line_type: line?.line_type ?? 'service',
    description: line?.description ?? '',
    product_id: line?.product_id ?? null,
    product: line?.product_id ? line.description : '',
    qty: line ? String(Number(line.qty)) : '1',
    unit_price: line ? String(Number(line.unit_price)) : '',
    labour_hours: line?.labour_hours ?? '',
    labor_rate_id: line?.labor_rate_id ? String(line.labor_rate_id) : '',
    discount_pct: line ? String(Number(line.discount_pct)) : '0',
    tax_rate_ids: line?.tax_rate_ids ?? (company?.tax_rates.filter((t) => t.is_default).map((t) => t.id) ?? []),
    coverage: line?.coverage ?? 'none',
    payer: line?.payer ?? 'customer',
    safety: line?.safety ?? false,
  }));
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Array<{ id: number; name: string; code: string | null; on_hand: number | null }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  useEffect(() => {
    if (term.trim().length < 2) return;
    const ctl = new AbortController();
    const h = setTimeout(() => {
      lookupParts(term.trim(), ctl.signal).then(
        (r) => (setHits(r.products ?? []), setNote(null)),
        (e) => !ctl.signal.aborted && setNote(refusalOf(e).status === 403 ? 'Finding a part needs the Inventory app.' : refusalOf(e).message),
      );
    }, 250);
    return () => {
      clearTimeout(h);
      ctl.abort();
    };
  }, [term]);
  const isPart = f.line_type === 'part' || (f.line_type === 'consumable' && !!f.product_id);
  const ready = f.line_type === 'labour' ? !!f.labour_hours.trim() : isPart ? !!f.product_id : !!f.description.trim() && f.unit_price.trim() !== '';
  return (
    <Modal
      title={line ? 'Edit the line' : `Add a line to ${v.label}`}
      width={620}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!ready} onClick={() => onSave(lineBody(f))}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type">
            <Select aria-label="Line type" value={f.line_type} onValueChange={(t) => set({ line_type: t, product_id: t === 'part' || t === 'consumable' ? f.product_id : null })} options={Object.entries(options?.line_types ?? { service: 'Service', labour: 'Labour', part: 'Part' }).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Description">
            <input aria-label="Description" value={f.description} onChange={(e) => set({ description: e.target.value })} className={input} maxLength={500} />
          </Field>
        </div>
        {f.line_type === 'part' || f.line_type === 'consumable' ? (
          <Field label="Part" hint="Priced by Inventory for the branch.">
            {f.product_id ? (
              <span className="flex items-center gap-2">
                <b className="min-w-0 flex-1 truncate">{f.product || `#${f.product_id}`}</b>
                <button type="button" className={btnSmall} onClick={() => set({ product_id: null, product: '' })}>
                  Change
                </button>
              </span>
            ) : (
              <>
                <input aria-label="Find a part" placeholder="Find a part by name or code" value={term} onChange={(e) => setTerm(e.target.value)} className={input} />
                {note ? <span className="text-[12px] text-warning">{note}</span> : null}
                {term.trim().length >= 2 && hits.length ? (
                  <div className="flex max-h-[140px] flex-col overflow-y-auto rounded-[8px] border border-line scroll-thin">
                    {hits.slice(0, 20).map((h) => (
                      <button key={h.id} type="button" className="px-2.5 py-1.5 text-left text-[12.5px] hover:bg-subtle" onClick={() => (set({ product_id: h.id, product: h.name, description: f.description || h.name }), setTerm(''))}>
                        {h.name} {h.code ? <span className="text-ink-3">· {h.code}</span> : null} {h.on_hand !== null ? <span className="text-ink-3">· {h.on_hand} on hand</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </Field>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          {f.line_type === 'labour' ? (
            <>
              <Field label="Hours">
                <input aria-label="Hours" inputMode="decimal" value={f.labour_hours} onChange={(e) => set({ labour_hours: e.target.value.replace(/[^\d.]/g, '') })} className={input} />
              </Field>
              <Field label="Rate" className="col-span-2">
                <Select aria-label="Labour rate" value={f.labor_rate_id} onValueChange={(x) => set({ labor_rate_id: x })} options={[{ value: '', label: 'The branch’s rate' }, ...(company?.labour_rates ?? []).map((r) => ({ value: String(r.id), label: `${r.name} · ${amount(r.amount, r.currency)}` }))]} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Qty">
                <input aria-label="Quantity" inputMode="decimal" value={f.qty} onChange={(e) => set({ qty: e.target.value.replace(/[^\d.]/g, '') })} className={input} />
              </Field>
              {!isPart ? (
                <Field label="Unit price">
                  <input aria-label="Unit price" inputMode="decimal" value={f.unit_price} onChange={(e) => set({ unit_price: e.target.value.replace(/[^\d.]/g, '') })} className={input} />
                </Field>
              ) : null}
            </>
          )}
          <Field label="Discount %" hint={company ? `Up to ${Number(company.my_discount_limit_pct)}% without approval` : undefined}>
            <input aria-label="Discount" inputMode="decimal" value={f.discount_pct} onChange={(e) => set({ discount_pct: e.target.value.replace(/[^\d.]/g, '') })} className={input} />
          </Field>
        </div>
        {company?.tax_rates.length ? (
          <Field label="Tax">
            <div className="flex flex-wrap gap-3 text-[12.5px] font-medium">
              {company.tax_rates.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={f.tax_rate_ids.includes(t.id)} onChange={(e) => set({ tax_rate_ids: e.target.checked ? [...f.tax_rate_ids, t.id] : f.tax_rate_ids.filter((x) => x !== t.id) })} /> {t.name}
                </label>
              ))}
            </div>
          </Field>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Covered by">
            <Select aria-label="Coverage" value={f.coverage} onValueChange={(c) => set({ coverage: c })} options={Object.entries(options?.coverage ?? { none: 'Nothing' }).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Paid by">
            <Select aria-label="Payer" value={f.payer} onValueChange={(p) => set({ payer: p })} options={Object.entries(options?.payers ?? { customer: 'Customer' }).map(([value, label]) => ({ value, label }))} />
          </Field>
          <label className="flex items-end gap-1.5 pb-2 text-[12.5px] font-semibold">
            <input type="checkbox" checked={f.safety} onChange={(e) => set({ safety: e.target.checked })} /> Safety
          </label>
        </div>
      </div>
    </Modal>
  );
}

function SendSheet({ v, options, overLimit, onClose, onSend }: { v: Version; options: EstimateOptions | undefined; overLimit: boolean; onClose: () => void; onSend: (channel: string, summary: string) => void }) {
  const [channel, setChannel] = useState('link');
  const [summary, setSummary] = useState(v.change_summary ?? '');
  return (
    <Modal
      title={`Send ${v.label}`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => onSend(channel, summary.trim())}>
            {overLimit ? 'Ask for the discount' : 'Send'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="How it reaches the customer" hint="WorkSuite makes the link and a message; you send it — nothing is sent by the server itself.">
          <Select aria-label="Channel" value={channel} onValueChange={setChannel} options={Object.entries(options?.channels ?? { link: 'Secure link' }).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="What changed (optional)">
          <input aria-label="Change summary" value={summary} onChange={(e) => setSummary(e.target.value)} className={input} maxLength={500} />
        </Field>
        {overLimit ? <p className="m-0 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">A discount is above your limit: it goes to an approver first, and is sent once they agree.</p> : null}
        <p className="m-0 text-[12px] text-ink-3">Once sent, this version does not change. Changes make a new version.</p>
      </div>
    </Modal>
  );
}

function LinkSheet({ handed, phone, email, onClose }: { handed: { url: string; text: string; expires: string | null }; phone: string | null; email: string | null; onClose: () => void }) {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  const open = (url: string) => void call('app:openExternal', { url }).catch(() => toast('error', 'That could not be opened.'));
  return (
    <Modal title="The customer’s link" width={560} onClose={onClose} footer={<button type="button" className={btnPrimary} onClick={onClose}>Done</button>}>
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        <p className="m-0 rounded-[9px] bg-warning-bg px-3 py-2 text-warning">Shown once: copy it or send it now. A new link can be made later; it replaces this one.</p>
        <textarea aria-label="Message for the customer" readOnly value={handed.text} rows={4} className={cx(input, 'h-auto py-2')} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(handed.text).then(() => toast('success', 'Message copied.'))}>
            <Icon name="copy" size={13} /> Copy the message
          </button>
          <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(handed.url).then(() => toast('success', 'Link copied.'))}>
            <Icon name="link" size={13} /> Copy the link
          </button>
          <button type="button" className={btnSmall} onClick={() => open(`mailto:${email ?? ''}?subject=${encodeURIComponent('Your estimate')}&body=${encodeURIComponent(handed.text)}`)}>
            <Icon name="mail" size={13} /> Email
          </button>
          <button type="button" className={btnSmall} onClick={() => open(`https://wa.me/${digits}?text=${encodeURIComponent(handed.text)}`)}>
            <Icon name="phone" size={13} /> WhatsApp
          </button>
        </div>
        {handed.expires ? <span className="text-ink-3">Works until {dateLabel(handed.expires)}.</span> : null}
      </div>
    </Modal>
  );
}

/** The body of `POST versions/{id}/approvals` (FR-APR-06). */
export function approvalBody(f: { method: string; approver: string; note: string; picks: Record<number, string>; followUp: Record<number, string>; ack: boolean; signature: string | null }): Record<string, unknown> {
  return {
    method: f.method,
    approver_name: f.approver.trim(),
    note: f.note.trim(),
    lines: Object.entries(f.picks).map(([id, decision]) => ({ id: Number(id), decision, ...(decision === 'deferred' && f.followUp[Number(id)] ? { follow_up_on: f.followUp[Number(id)] } : {}) })),
    ...(f.ack ? { acknowledge_safety: true } : {}),
    ...(f.signature ? { signature: { name: f.approver.trim(), image: f.signature } } : {}),
  };
}

function DecisionSheet({ v, options, signatureRequired, customer, onClose, onSave }: { v: Version; options: EstimateOptions | undefined; signatureRequired: boolean; customer: string; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [method, setMethod] = useState('phone');
  const [approver, setApprover] = useState(customer);
  const [note, setNote] = useState('');
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [followUp, setFollowUp] = useState<Record<number, string>>({});
  const [ack, setAck] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [total, setTotal] = useState<string | null>(null);
  const open = undecided(v, picks);
  const safety = declinedSafety(v, picks);
  const key = JSON.stringify(picks);
  useEffect(() => {
    const lines = Object.entries(JSON.parse(key) as Record<string, string>).map(([id, decision]) => ({ id: Number(id), decision }));
    if (!lines.length) return;
    let gone = false;
    const h = setTimeout(() => {
      previewDecisions(v.id, lines).then(
        (r) => !gone && setTotal(r.data.approved.total),
        () => undefined,
      );
    }, 250);
    return () => {
      gone = true;
      clearTimeout(h);
    };
  }, [key, v.id]);
  const ready = !open.length && !!approver.trim() && !!note.trim() && (!safety.length || ack) && (!signatureRequired || !!signature);
  const choices: Array<[string, string]> = [
    ['approved', options?.decisions.approved ?? 'Approve'],
    ['rejected', options?.decisions.rejected ?? 'Reject'],
    ['deferred', options?.decisions.deferred ?? 'Later'],
  ];
  return (
    <Modal
      title={`The customer’s answer on ${v.label}`}
      width={720}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-ink-2">{total !== null ? `Approved total ${amount(total, v.currency)}` : 'Choose for every line.'}</span>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!ready} onClick={() => onSave(approvalBody({ method, approver, note, picks, followUp, ack, signature }))}>
            Record
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        <div className="grid grid-cols-2 gap-2">
          <Field label="How they answered">
            <Select aria-label="Method" value={method} onValueChange={setMethod} options={Object.entries(options?.staff_methods ?? { phone: 'Phone', in_person: 'In person', email: 'Email' }).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Who answered">
            <input aria-label="Who answered" value={approver} onChange={(e) => setApprover(e.target.value)} className={input} maxLength={150} />
          </Field>
        </div>
        {v.lines.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 border-b border-line/70 py-1.5">
            <span className="min-w-0 flex-1">
              <b className="text-ink">{l.description}</b> <span className="text-ink-3">{amount(l.total)}</span> {l.safety || l.vhc === 'red' ? <Pill tone="red">Safety</Pill> : null}
            </span>
            <div role="radiogroup" aria-label={`${l.description} decision`} className="flex gap-1">
              {choices.map(([d, label]) => (
                <button key={d} type="button" role="radio" aria-checked={picks[l.id] === d} onClick={() => setPicks((p) => ({ ...p, [l.id]: d }))} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', picks[l.id] === d ? (d === 'approved' ? 'bg-[#1F7A4D] text-white' : d === 'rejected' ? 'bg-danger text-white' : 'bg-ink-2 text-white') : 'border border-line bg-surface text-ink-2')}>
                  {label}
                </button>
              ))}
            </div>
            {picks[l.id] === 'deferred' ? <input aria-label={`${l.description} follow up on`} type="date" value={followUp[l.id] ?? ''} onChange={(e) => setFollowUp((x) => ({ ...x, [l.id]: e.target.value }))} className={cx(input, 'h-7 w-[150px]')} /> : null}
          </div>
        ))}
        {safety.length ? (
          <label className="flex items-start gap-2 rounded-[9px] bg-warning-bg px-3 py-2 font-semibold text-warning">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" /> The customer was told that {safety.map((l) => l.description).join(', ')} {safety.length === 1 ? 'needs' : 'need'} attention now for safety, and declined it.
          </label>
        ) : null}
        <Field label="Note" hint="What was said, and when.">
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={cx(input, 'h-auto py-2')} maxLength={1000} />
        </Field>
        {method === 'in_person' || signatureRequired ? (
          <Field label={signatureRequired ? 'Signature' : 'Signature (optional)'}>
            <SignaturePad onChange={setSignature} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function ChangesSheet({ options, customer, onClose, onSave }: { options: EstimateOptions | undefined; customer: string; onClose: () => void; onSave: (body: { method: string; approver_name: string; comment: string }) => void }) {
  const [method, setMethod] = useState('phone');
  const [approver, setApprover] = useState(customer);
  const [comment, setComment] = useState('');
  return (
    <Modal
      title="The customer asks for changes"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!approver.trim() || !comment.trim()} onClick={() => onSave({ method, approver_name: approver.trim(), comment: comment.trim() })}>
            Record
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Select aria-label="Method" value={method} onValueChange={setMethod} options={Object.entries(options?.staff_methods ?? { phone: 'Phone' }).map(([value, label]) => ({ value, label }))} />
        <input aria-label="Who asked" value={approver} onChange={(e) => setApprover(e.target.value)} className={input} maxLength={150} />
        <textarea aria-label="What they want changed" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} maxLength={1000} />
      </div>
    </Modal>
  );
}

function TextSheet({ title, label, required, onClose, onSave }: { title: string; label: string; required?: boolean; onClose: () => void; onSave: (text: string) => void }) {
  const [t, setT] = useState('');
  return (
    <Modal
      title={title}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={required && !t.trim()} onClick={() => onSave(t.trim())}>
            {title}
          </button>
        </>
      }
    >
      <Field label={label}>
        <input autoFocus aria-label={label} value={t} onChange={(e) => setT(e.target.value)} className={input} maxLength={500} />
      </Field>
    </Modal>
  );
}

function SummaryEditor({ v, online, onSave }: { v: Version; online: boolean; onSave: (t: string) => void }) {
  const [t, setT] = useState(v.change_summary ?? '');
  return (
    <Panel title="What changes in this version" sub="The customer reads it with the estimate.">
      <div className="flex gap-2 p-3.5">
        <input aria-label="Change summary" value={t} onChange={(e) => setT(e.target.value)} className={input} maxLength={500} />
        <button type="button" className={btnSmall} disabled={!online || t === (v.change_summary ?? '')} onClick={() => onSave(t)}>
          Save
        </button>
      </div>
    </Panel>
  );
}
