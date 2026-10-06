import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PosApprovalNeed } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { approveByPin, askManager, askSummary, cancelRequest, DeskError, listApprovers, pollRequest, type Approval, type ManagerRequest } from './desk';
import { useT, type PosKey } from './i18n';
import { Keypad } from './Keypad';
import { ON } from './look';
import { Note, PosButton, PosDialog, useTillContext } from './parts';

/**
 * A manager's override (D09): what needs approving and why WorkSuite asks (the cashier's limit, the company's figure),
 * a reason, the managers who may approve here (`GET approvers` — only those with a PIN can do it at the counter), the
 * manager's PIN on six dots and the keypad, and Approve — which asks WorkSuite for an approval (`POST approvals`) and
 * hands it back for the action to be sent again with it (`approval_id`). Where the server takes requests from afar
 * (`capabilities.remote_approvals`), "Send to a manager" asks every manager who may approve, and the screen waits for
 * one of them (polled every three seconds; a request lapses after ten minutes). The PIN goes to WorkSuite once and is
 * forgotten; an approval lives in memory only. Online only.
 */
const REASONS: Record<string, PosKey[]> = {
  discount: ['pos.ovr.reason.loyal', 'pos.ovr.reason.damaged', 'pos.ovr.reason.match', 'pos.ovr.reason.bulk'],
  refund: ['pos.ret.reason.faulty', 'pos.ret.reason.wrong', 'pos.ret.reason.mind', 'pos.ret.reason.damaged'],
  void: ['pos.ovr.reason.mistake', 'pos.ovr.reason.customerLeft'],
  cash_out: ['pos.ovr.reason.drop', 'pos.ovr.reason.supplier', 'pos.ovr.reason.float'],
  price_override: ['pos.ovr.reason.match'],
};
const TITLE: Record<string, PosKey> = { discount: 'pos.ovr.discount', refund: 'pos.ovr.refund', void: 'pos.ovr.void', cash_out: 'pos.ovr.cashOut', price_override: 'pos.ovr.price' };
const POLL_MS = 3_000;

export default function Override({ need, currency, detail, reason: given, onApproved, onClose }: { need: PosApprovalNeed; currency: string; detail?: ReactNode; reason?: string; onApproved: (a: Approval) => void; onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const ask = need.ask;
  const approvers = useQuery({ queryKey: ['pos', 'approvers'], queryFn: listApprovers, enabled: !till.offline, staleTime: 60_000, retry: false });
  const [picked, setApprover] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState(given ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(need.code === 'approval_required' ? null : need.message);
  const [request, setRequest] = useState<ManagerRequest | null>(null);
  const pending = useRef<number | null>(null);
  const list = useMemo(() => approvers.data ?? [], [approvers.data]);
  // One manager with a PIN: chosen already.
  const withPin = list.filter((a) => a.has_pin);
  const approver = picked ?? (withPin.length === 1 ? withPin[0]!.id : null);
  const chosen = list.find((a) => a.id === approver) ?? null;
  const sum = askSummary(ask, currency);
  const remote = !!till.caps.remote_approvals;

  // A request sent to the managers: asked about every three seconds until one decides (or it lapses).
  useEffect(() => {
    if (!request || request.status !== 'pending') return;
    pending.current = request.id;
    const timer = setInterval(() => {
      pollRequest(request.id, ask).then(
        (r) => {
          setRequest(r);
          if (r.status === 'approved' && r.approval) {
            pending.current = null;
            onApproved(r.approval);
          } else if (r.status !== 'pending') pending.current = null;
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [request, ask, onApproved]);

  // Leaving while a request waits withdraws it.
  useEffect(
    () => () => {
      if (pending.current) void cancelRequest(pending.current).catch(() => undefined);
    },
    [],
  );

  async function approve() {
    if (!chosen || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const a = await approveByPin(chosen.id, pin, ask, reason);
      setPin('');
      onApproved(a);
    } catch (e) {
      setPin('');
      setError(e instanceof DeskError && e.code === 'pin_locked' ? t('pos.ovr.locked', { msg: e.message }) : e instanceof Error ? e.message : t('pos.ovr.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function sendAway() {
    setBusy(true);
    setError(null);
    try {
      setRequest(await askManager(ask, reason));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.ovr.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!request) return;
    pending.current = null;
    await cancelRequest(request.id).catch(() => undefined);
    setRequest(null);
  }

  const dots = Math.max(6, pin.length);
  return (
    <PosDialog label={t('pos.ovr.title')} onClose={busy ? undefined : onClose} width={1040} className="max-h-[min(760px,100%)] flex-row overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto p-7 scroll-thin">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning">
            <Icon name="lock" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-extrabold">{t('pos.ovr.title')}</h2>
            <p className="text-[13px] text-ink-3">{need.message}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-pos bg-pos-key px-4 py-3.5 text-[14px]">
          <div className="flex justify-between gap-3">
            <span className="text-ink-2">{t(TITLE[ask.action] ?? 'pos.ovr.discount')}</span>
            <span className="font-mono font-bold">{sum.what}</span>
          </div>
          {sum.over ? (
            <div className="flex justify-between gap-3 text-[13px] text-ink-3">
              <span>{t(ask.action === 'discount' ? 'pos.ovr.limit' : 'pos.ovr.over')}</span>
              <span className="font-mono">{sum.over}</span>
            </div>
          ) : null}
          {ask.subject ? (
            <div className="flex justify-between gap-3 text-[13px] text-ink-3">
              <span>{t('pos.receipt')}</span>
              <span className="font-mono">{ask.subject}</span>
            </div>
          ) : null}
          {detail}
        </div>
        <div className="text-[13px] font-bold text-ink-2">{t('pos.reason')}</div>
        <div className="flex flex-wrap gap-2">
          {(REASONS[ask.action] ?? []).map((k) => {
            const label = t(k);
            return (
              <button key={k} type="button" aria-pressed={reason === label} onClick={() => setReason(label)} className={cx('h-touch rounded-[12px] px-3.5 text-[13px] font-semibold', reason === label ? `${ON} text-primary` : 'bg-pos-key text-ink')}>
                {label}
              </button>
            );
          })}
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          aria-label={t('pos.reason')}
          placeholder={t('pos.ovr.reasonHint')}
          className="h-touch-md rounded-[12px] bg-pos-panel px-3.5 text-[15px] shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
        />
        <p className="text-[12px] text-ink-3">{t('pos.ovr.recorded')}</p>
        {till.offline ? <Note tone="warning">{t('pos.ovr.offline')}</Note> : null}
        {request ? (
          <Note
            tone={request.status === 'pending' ? 'indigo' : request.status === 'approved' ? 'success' : 'warning'}
            action={
              request.status === 'pending' ? (
                <PosButton className="h-touch px-3 text-[13px]" onClick={() => void withdraw()}>
                  {t('pos.ovr.withdraw')}
                </PosButton>
              ) : undefined
            }
          >
            {request.status === 'pending'
              ? t('pos.ovr.waiting')
              : request.status === 'approved'
                ? t('pos.ovr.approvedBy', { name: request.decided_by ?? '' })
                : request.status === 'denied'
                  ? t('pos.ovr.denied', { name: request.decided_by ?? '', note: request.note ?? '' })
                  : t('pos.ovr.lapsed')}
          </Note>
        ) : null}
        {error ? <Note tone="danger">{error}</Note> : null}
        <div className="mt-auto flex gap-2.5">
          <PosButton className="h-touch-lg w-[160px] text-[15px]" disabled={busy} onClick={onClose}>
            {t('pos.ovr.decline')}
          </PosButton>
          {remote ? (
            <PosButton className="h-touch-lg flex-1 text-[15px]" disabled={busy || till.offline || request?.status === 'pending'} onClick={() => void sendAway()}>
              <Icon name="send" size={18} />
              {t('pos.ovr.send')}
            </PosButton>
          ) : null}
        </div>
      </section>
      <aside className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto bg-pos-ground p-6 scroll-thin">
        <div className="text-[13px] font-bold text-ink-2">{t('pos.ovr.manager')}</div>
        {approvers.isLoading ? <p className="text-[13px] text-ink-3">{t('pos.ovr.finding')}</p> : null}
        {approvers.isError ? <Note tone="danger">{approvers.error instanceof Error ? approvers.error.message : t('pos.ovr.failed')}</Note> : null}
        {approvers.isSuccess && !list.length ? <Note tone="warning">{t('pos.ovr.none')}</Note> : null}
        <div role="radiogroup" aria-label={t('pos.ovr.manager')} className="flex flex-wrap gap-2">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={approver === a.id}
              disabled={!a.has_pin}
              title={a.has_pin ? undefined : t('pos.ovr.noPin')}
              onClick={() => {
                setApprover(a.id);
                setPin('');
              }}
              className={cx('flex h-touch items-center gap-2 rounded-full pr-3.5 pl-1.5 text-[13px] font-semibold disabled:opacity-40', approver === a.id ? `${ON} text-primary` : 'bg-pos-panel text-ink shadow-[inset_0_0_0_1px_var(--pos-line)]')}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pos-tint-indigo text-[12px] font-extrabold text-pos-tint-indigo-ink">{a.initials}</span>
              {a.name}
            </button>
          ))}
        </div>
        <div className="text-[13px] font-bold text-ink-2">{t('pos.ovr.pin')}</div>
        <div className="flex justify-center gap-2.5 py-1" aria-label={t('pos.ovr.pinTyped', { n: pin.length })} role="status">
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} className={cx('h-4 w-4 rounded-full', i < pin.length ? 'bg-pos-bar' : 'bg-pos-panel shadow-[inset_0_0_0_2px_var(--pos-line)]')} />
          ))}
        </div>
        <Keypad
          tone="panel"
          disabled={!chosen || busy || till.offline}
          keys={['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']}
          labels={{ clear: t('pos.reg.clear') }}
          onKey={(k) => setPin((p) => (k === 'clear' ? '' : k === 'back' ? p.slice(0, -1) : /^\d$/.test(k) && p.length < 8 ? p + k : p))}
        />
        <p className="text-center text-[12px] text-ink-3">{t('pos.ovr.pinHint')}</p>
        <PosButton tone="primary" className="mt-auto h-touch-xl shrink-0 rounded-pos-lg text-[17px] font-extrabold" disabled={!chosen || pin.length < 4 || busy || till.offline} onClick={() => void approve()}>
          {busy ? <Icon name="spinner" size={18} className="animate-spin" /> : <Icon name="check" size={18} />}
          {t('pos.ovr.approve')}
        </PosButton>
      </aside>
    </PosDialog>
  );
}
