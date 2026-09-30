import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Modal, Spinner, TextField } from '../../components/ui';
import { toast } from '../../core/toasts';
import { get, K, money, refusal, write, type Approval as ApprovalRow } from './api';
import { useT } from './i18n';
import { Failed, Heading, Note, useTill } from './parts';

/**
 * Approvals (§14.2, RM-SEC-010): what the server refused as above the
 * person's limit — a void after the kitchen, a discount, a cash-out — comes
 * with the approval to ask for. A manager answers it with their PIN on this
 * till (the approver is whoever the PIN is), or from their own device; the
 * approval is then used once, by the action that asked for it.
 */
export interface ApprovalAsk {
  action: string;
  amount: string;
  pct?: number;
  subject_type?: string;
  subject_id?: number;
  order_id?: number;
  branch_id?: number;
  reason: string;
  message: string;
}

/** Ask, then take the answer: a PIN here, or a manager's answer elsewhere (asked again every few seconds). */
export function Approval({ ask, onClose, onApproved }: { ask: ApprovalAsk; onClose: () => void; onApproved: (approvalId: number) => void }) {
  const t = useT();
  const till = useTill();
  const [id, setId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = useQuery({
    queryKey: ['restaurant', 'approval', id],
    queryFn: ({ signal }) => get<{ request: ApprovalRow }>(`/approvals/${id}`, {}, signal).then((d) => d.request),
    enabled: !!id,
    refetchInterval: 3_000,
  });
  const status = state.data?.status;
  /* Used once: approved here by PIN, or seen approved from elsewhere — whichever comes first. */
  const fired = useRef(false);
  const done = useRef(onApproved);
  useEffect(() => {
    done.current = onApproved;
  });
  const approved = (approvalId: number) => {
    if (fired.current) return;
    fired.current = true;
    done.current(approvalId);
  };
  useEffect(() => {
    if (id && status === 'approved') approved(id);
  });

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const r = await write<{ request: ApprovalRow }>('/approvals', {
        branch_id: ask.branch_id ?? till.branch,
        action: ask.action,
        amount: ask.amount,
        pct: ask.pct,
        reason: ask.reason,
        subject_type: ask.subject_type,
        subject_id: ask.subject_id,
        order_id: ask.order_id,
        terminal_id: till.pairing.terminal_id,
      });
      setId(r.data.request.id);
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function withPin() {
    if (!id || !pin) return;
    setBusy(true);
    setError(null);
    try {
      await write(`/approvals/${id}/approve`, { pin, note: t('approval.byPin') });
      setPin('');
      approved(id);
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('approval.title')} onClose={onClose} width={480}>
      <div className="flex flex-col gap-3">
        <Note tone="warning">{ask.message}</Note>
        <p className="text-[13px] text-ink-2">{t('approval.what', { amount: money(ask.amount, till.currency) })}</p>
        {!id ? (
          <Button variant="primary" loading={busy} onClick={() => void request()}>
            {t('approval.ask')}
          </Button>
        ) : status === 'rejected' || status === 'expired' || status === 'cancelled' ? (
          <Note tone="danger">{t('approval.no', { status: state.data?.status_label ?? status })}</Note>
        ) : (
          <>
            <p className="text-[13px] text-ink">{t('approval.waiting')}</p>
            <TextField label={t('approval.pin')} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} />
            <Button variant="primary" loading={busy} disabled={pin.length < 4} onClick={() => void withPin()}>
              {t('approval.approveHere')}
            </Button>
          </>
        )}
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

/** Requests the signed-in person may answer, and their own. */
export default function Approvals() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.approvals, queryFn: ({ signal }) => get<{ to_answer: ApprovalRow[]; mine: ApprovalRow[] }>('/approvals', {}, signal), refetchInterval: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(r: ApprovalRow, on: 'approve' | 'reject') {
    setBusy(`${on}-${r.id}`);
    try {
      const res = await write(`/approvals/${r.id}/${on}`, { note: on === 'approve' ? t('approval.fromTill') : t('approval.refusedAtTill') });
      toast('success', res.message ?? t('approval.done'));
      void qc.invalidateQueries({ queryKey: K.approvals });
    } catch (e) {
      toast('error', refusal(e).message);
    } finally {
      setBusy(null);
    }
  }

  if (q.isError) return <div className="p-6"><Failed text={q.error instanceof Error ? q.error.message : t('approval.failed')} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner />;

  return (
    <div className="flex max-w-[820px] flex-col gap-4 p-6">
      <Heading title={t('nav.approvals')} hint={t('approval.hint')} />
      <Card title={t('approval.toAnswer')}>
        {q.data.to_answer.length === 0 ? <p className="text-[13px] text-ink-3">{t('approval.none')}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {q.data.to_answer.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink">
                  {r.action_label} · {money(r.amount)}
                </div>
                <div className="text-[12px] text-ink-2">
                  {r.requested_by_name ?? ''} · {r.reason}
                </div>
              </div>
              <Button size="sm" loading={busy === `reject-${r.id}`} onClick={() => void answer(r, 'reject')}>
                {t('approval.reject')}
              </Button>
              <Button size="sm" variant="primary" loading={busy === `approve-${r.id}`} onClick={() => void answer(r, 'approve')}>
                {t('approval.approve')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('approval.mine')}>
        {q.data.mine.length === 0 ? <p className="text-[13px] text-ink-3">{t('approval.none')}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {q.data.mine.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 text-ink">
                {r.action_label} · {money(r.amount)} · {r.reason}
              </span>
              <span className="text-ink-2">{r.status_label}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
