import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiGet, apiPost, request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { dayLong } from './dates';
import { btn, btnPrimary, Empty, Field, humanise, input, PageHead, Panel, Sheet, StatusChip } from './parts';
import { Events, lastDay, Trail, type ResEvent, type ResignationShape, type Round } from './resignationParts';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

/**
 * My resignation (HrSelfService "My resignation"; the web's MyResignation):
 * starting one only saves a draft — nothing is sent until I submit, having
 * read and accepted the company's current terms. Once sent, it shows where
 * it stands in the approval chain, and I may withdraw it (after approval
 * that becomes a request of its own, which HR decides).
 */
interface Mine {
  linked: boolean;
  person?: { name: string; employment_type: string | null; service: string | null; company: string | null };
  today?: string;
  rule?: { name: string; notice_days: number; allow_early_release: boolean; allow_immediate: boolean; immediate_needs_reason: boolean; letter_required: boolean } | null;
  terms?: { id: number; version: number; title: string; body: string } | null;
  types?: Record<string, string>;
  ready?: { ok: boolean; missing: string[] };
  resignation?: (ResignationShape & { editable: boolean; notice: { required: number | null; minimum: string | null; requested: string | null; provided: number | null; shortfall: number | null } | null; waiting_on: string | null; trail: Round[]; withdrawal_trail: Round[]; events: ResEvent[] }) | null;
  history?: ResignationShape[];
  can_generate_letter?: boolean;
}

export default function MyResignation() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr', 'my-resignation'], queryFn: ({ signal }) => apiGet<Mine>('/api/hr/me/resignation', undefined, signal), retry: false });
  const set = (data: Mine) => qc.setQueryData(['hr', 'my-resignation'], data);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data!;
  if (!m.linked) return <Empty text="Your login is not linked to an employee record, so there is nothing to resign from here." />;
  const r = m.resignation ?? null;

  return (
    <div className="flex max-w-[1000px] flex-col gap-3.5">
      <PageHead title="My resignation" sub="Starting one only saves a draft — nothing is sent until you submit." />
      {!m.ready?.ok && (!r || r.editable) ? (
        <div className="rounded-[12px] border border-warning-line bg-warning-bg px-4 py-3 text-[12.5px] text-warning-strong dark:border-warning/40 dark:text-warning">
          <b>You cannot send a resignation from here yet.</b> {m.ready?.missing.join(' ')} HR can sort this out.
        </div>
      ) : null}
      {!r || r.editable ? <Draft m={m} onSaved={set} /> : <Sent m={m} onSaved={set} />}
      {m.history?.length ? (
        <Panel title="Earlier">
          {m.history.map((h) => (
            <div key={h.id} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-ink">
                {h.type_label} · last day {dayLong(lastDay(h))}
              </span>
              <StatusChip>{h.status_label}</StatusChip>
            </div>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

function Draft({ m, onSaved }: { m: Mine; onSaved: (d: Mine) => void }) {
  const r = m.resignation ?? null;
  const [type, setType] = useState(r?.type ?? 'normal');
  const [day, setDay] = useState(r?.requested_last_working_date ?? '');
  const [reason, setReason] = useState(r?.reason ?? '');
  const [comments, setComments] = useState(r?.comments ?? '');
  const [early, setEarly] = useState(!!r?.early_release_requested);
  const [accepted, setAccepted] = useState(false);
  const [terms, setTerms] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const returned = r?.status === 'returned' ? r.trail[0]?.steps.find((s) => s.status === 'returned') : undefined;

  const save = async (quiet = false): Promise<Mine | null> => {
    try {
      const d = await apiPost<Mine>('/api/hr/me/resignation', { type, reason, comments, requested_last_working_date: day, early_release_requested: early });
      onSaved(d);
      if (!quiet) toast('success', 'Draft saved. Nothing has been sent.');
      return d;
    } catch (e) {
      toast('error', errorMessage(e));
      return null;
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (!(await save(true))) return;
      const d = await apiPost<Mine>('/api/hr/me/resignation/submit', { terms_id: m.terms?.id, terms_accepted: accepted });
      onSaved(d);
      toast('success', 'Resignation submitted.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      if (!r && !(await save(true))) return;
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await request<Mine>('POST', '/api/hr/me/resignation/letter', { body: form });
      onSaved(res.data);
      toast('success', 'Letter attached.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    setBusy(true);
    try {
      if (!(await save(true))) return;
      onSaved(await apiPost<Mine>('/api/hr/me/resignation/letter/generate', {}));
      toast('success', 'A letter was written from your answers and attached.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={r ? (r.status === 'returned' ? 'Your resignation — returned for changes' : 'Your draft') : 'Start a resignation'} bodyClassName="flex flex-col gap-3 px-4 py-3.5">
      {returned ? (
        <div className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-strong dark:text-warning">
          {returned.decided_by?.name ?? returned.name} returned it{returned.comment ? `: “${returned.comment}”` : '.'}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-[10px] bg-ground px-3 py-2.5 text-[12.5px] text-ink-2">
          <b className="text-ink">Your employment</b>
          <br />
          {humanise(m.person?.employment_type ?? '') || '—'}
          {m.person?.service ? ` · ${m.person.service}` : ''}
        </div>
        <div className="rounded-[10px] bg-ground px-3 py-2.5 text-[12.5px] text-ink-2">
          <b className="text-ink">Notice that applies to you</b>
          <br />
          {m.rule ? `${m.rule.notice_days} days` : 'No rule covers you yet'}
          {r?.notice?.minimum ? ` · earliest last day ${dayLong(r.notice.minimum)}` : ''}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Kind of resignation">
          <Select aria-label="Kind of resignation" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {Object.entries(m.types ?? {})
              .filter(([k]) => k !== 'immediate' || m.rule?.allow_immediate !== false)
              .map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Proposed last working day" hint={r?.notice?.shortfall ? `${r.notice.shortfall} days short of your notice.` : undefined}>
          <input type="date" aria-label="Proposed last working day" value={day} min={m.today} onChange={(e) => setDay(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="Reason">
        <textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={input + ' !h-[64px] resize-none py-2'} />
      </Field>
      <Field label="Comments">
        <textarea aria-label="Comments" value={comments} onChange={(e) => setComments(e.target.value)} className={input + ' !h-[54px] resize-none py-2'} />
      </Field>
      <Field label={`Letter${m.rule?.letter_required ? ' (required)' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={picker}
            type="file"
            hidden
            aria-label="Choose a letter"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
          {r?.letter ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('transfers:download', { hrLetter: 'mine', name: r.letter!.filename, open: true })}>
              {r.letter.filename}
            </button>
          ) : null}
          <button type="button" disabled={busy} className={btn} onClick={() => picker.current?.click()}>
            {r?.letter ? 'Replace…' : 'Choose a file…'}
          </button>
          {m.can_generate_letter ? (
            <button type="button" disabled={busy} className={btn} onClick={() => void generate()}>
              Write one for me
            </button>
          ) : null}
        </div>
      </Field>
      {m.rule?.allow_early_release ? (
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={early} onChange={(e) => setEarly(e.target.checked)} />
          Ask for early release — to leave before the notice runs out
        </label>
      ) : null}
      {m.terms ? (
        <label className="flex items-start gap-2 text-[12.5px] text-ink">
          <Checkbox aria-label="I accept the resignation terms" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-[2px]" />
          <span>
            I have read and agree to these resignation{' '}
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTerms(true)}>
              terms and conditions
            </button>{' '}
            (version {m.terms.version}).
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
        {r ? (
          <button type="button" className={btn + ' mr-auto'} onClick={() => setCancelling(true)}>
            Cancel draft
          </button>
        ) : null}
        <button type="button" disabled={busy} className={btn} onClick={() => void save()}>
          Save draft
        </button>
        <button type="button" disabled={busy || !m.ready?.ok || !accepted || !day} title={!accepted ? 'Accept the terms first' : undefined} className={btnPrimary} onClick={() => void submit()}>
          Submit resignation
        </button>
      </div>
      {terms && m.terms ? (
        <Sheet title={m.terms.title || 'Resignation terms'} width={600} onClose={() => setTerms(false)} footer={<button type="button" className={btnPrimary} onClick={() => (setAccepted(true), setTerms(false))}>I accept these terms</button>}>
          <div className="text-[13px] whitespace-pre-wrap text-ink">{m.terms.body}</div>
        </Sheet>
      ) : null}
      {cancelling ? <Withdraw label="Cancel this draft?" action="Cancel draft" onClose={() => setCancelling(false)} onDone={(d) => (setCancelling(false), onSaved(d))} /> : null}
    </Panel>
  );
}

function Sent({ m, onSaved }: { m: Mine; onSaved: (d: Mine) => void }) {
  const r = m.resignation!;
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawal = r.status === 'withdrawal_requested';
  return (
    <div className="grid grid-cols-[1.2fr_1fr] gap-3">
      <Panel title="Your resignation" bodyClassName="flex flex-col gap-2 px-4 py-3.5 text-[12.5px] text-ink-2">
        <span className="flex items-center gap-2">
          <b className="text-[14px] text-ink">{r.type_label}</b>
          <StatusChip>{r.status_label}</StatusChip>
        </span>
        <span>
          Last working day <b className="text-ink">{dayLong(lastDay(r))}</b>
          {r.approved_last_working_date && r.approved_last_working_date !== r.requested_last_working_date ? ` (you asked for ${dayLong(r.requested_last_working_date)})` : ''}
        </span>
        {r.waiting_on ? <span>Waiting on {r.waiting_on}.</span> : null}
        {r.reason ? <span className="whitespace-pre-wrap text-ink">{r.reason}</span> : null}
        {withdrawal ? <span className="font-semibold text-ink">You asked to withdraw it{r.withdrawal_reason ? `: “${r.withdrawal_reason}”` : ''}. HR decides.</span> : null}
        {r.status === 'submitted' || r.status === 'approved' ? (
          <button type="button" className={btn + ' self-start'} onClick={() => setWithdrawing(true)}>
            {r.status === 'approved' ? 'Ask to withdraw it' : 'Withdraw it'}
          </button>
        ) : null}
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title={withdrawal ? 'Approval · withdrawal' : 'Approval'}>
          <Trail round={(withdrawal ? r.withdrawal_trail : r.trail)[0]} />
        </Panel>
        <Panel title="Events" bodyClassName="px-3.5 py-2.5">
          <Events events={r.events.slice().reverse()} />
        </Panel>
      </div>
      {withdrawing ? <Withdraw label={r.status === 'approved' ? 'Ask to withdraw your resignation?' : 'Withdraw your resignation?'} action={r.status === 'approved' ? 'Send the request' : 'Withdraw'} onClose={() => setWithdrawing(false)} onDone={(d) => (setWithdrawing(false), onSaved(d))} /> : null}
    </div>
  );
}

function Withdraw({ label, action, onClose, onDone }: { label: string; action: string; onClose: () => void; onDone: (d: Mine) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const d = await apiPost<Mine>('/api/hr/me/resignation/withdraw', { reason: reason.trim() });
      toast('success', 'Done.');
      onDone(d);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={label}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Not now
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void run()}>
            {action}
          </button>
        </>
      }
    >
      <Field label="Why?" hint="Optional for a draft.">
        <input aria-label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
      </Field>
    </Sheet>
  );
}
