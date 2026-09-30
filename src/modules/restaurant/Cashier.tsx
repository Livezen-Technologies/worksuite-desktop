import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Modal, Spinner, TextField } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { get, K, money, needsApproval, refusal, write, type CashierSession, type Money } from './api';
import { Approval, type ApprovalAsk } from './Approvals';
import { useT } from './i18n';
import { Failed, Heading, Note, ReasonField, useTill } from './parts';

/**
 * The cashier session (§8.5): opened on the till's Point of Sale register
 * with a float; cash put in or taken out (out is a cash adjustment, within
 * the person's limit or approved); a no-sale that opens the drawer with a
 * reason; the X report while open; and the close on a count, with the
 * variance the server works out — above the branch's threshold it needs an
 * approval. Every payment at the till goes through the session that is open.
 */
interface Report {
  kind: 'X' | 'Z';
  session: CashierSession;
  opening_float: Money;
  cash_taken: Money;
  change_given: Money;
  cash_put_in: Money;
  cash_taken_out: Money;
  expected_cash: Money | null;
  counted_cash: Money | null;
  variance: Money | null;
  sales: { count: number; total: Money };
  tenders: Array<{ method: string; count: number; amount: Money }>;
}

type Dialog = null | 'open' | 'in' | 'out' | 'nosale' | 'close';

export default function Cashier() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);

  const mine = useQuery({ queryKey: K.cashier, queryFn: ({ signal }) => get<{ session: CashierSession | null }>('/cashier-sessions/mine', {}, signal).then((d) => d.session) });
  const s = mine.data ?? null;
  const report = useQuery({ queryKey: [...K.cashier, 'report', s?.id], queryFn: ({ signal }) => get<{ report: Report }>(`/cashier-sessions/${s!.id}`, {}, signal).then((d) => d.report), enabled: !!s, refetchInterval: 30_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.cashier });
    void qc.invalidateQueries({ queryKey: K.pos(till.branch) });
  };
  const cur = s?.currency ?? till.currency;

  if (mine.isError) return <div className="p-6"><Failed text={mine.error instanceof Error ? mine.error.message : t('cashier.failed')} onRetry={() => void mine.refetch()} /></div>;
  if (mine.isLoading) return <Spinner />;

  return (
    <div className="flex max-w-[860px] flex-col gap-4 p-6">
      <Heading title={t('cashier.title')} hint={s ? t('cashier.openSince', { at: s.opened_at ? new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' }) : t('cashier.none')} />
      {!s ? (
        <Card>
          <p className="mb-3 text-[13px] text-ink-2">{t('cashier.openHint')}</p>
          <Button variant="primary" icon="unlock" disabled={!till.can('cashier_open')} onClick={() => setDialog('open')}>
            {t('cashier.open')}
          </Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button icon="plus" disabled={s.status !== 'open'} onClick={() => setDialog('in')}>{t('cashier.cashIn')}</Button>
            <Button icon="minus" disabled={s.status !== 'open'} onClick={() => setDialog('out')}>{t('cashier.cashOut')}</Button>
            <Button icon="unlock" disabled={s.status !== 'open' || !till.can('cashdrawer_nosale')} onClick={() => setDialog('nosale')}>{t('cashier.noSale')}</Button>
            <Button variant="danger" icon="lock" onClick={() => setDialog('close')}>{t('cashier.close')}</Button>
          </div>
          {report.data ? (
            <Card title={t('cashier.report', { kind: report.data.kind })}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                <Fig label={t('cashier.float')} value={money(report.data.opening_float, cur)} />
                <Fig label={t('cashier.sales')} value={`${report.data.sales.count} · ${money(report.data.sales.total, cur)}`} />
                <Fig label={t('cashier.cashTaken')} value={money(report.data.cash_taken, cur)} />
                <Fig label={t('cashier.changeGiven')} value={money(report.data.change_given, cur)} />
                <Fig label={t('cashier.putIn')} value={money(report.data.cash_put_in, cur)} />
                <Fig label={t('cashier.takenOut')} value={money(report.data.cash_taken_out, cur)} />
                {report.data.expected_cash !== null ? <Fig label={t('cashier.expected')} value={money(report.data.expected_cash, cur)} /> : null}
              </dl>
              {report.data.tenders.length ? (
                <ul className="mt-3 flex flex-col gap-0.5 border-t border-line pt-2 text-[13px]">
                  {report.data.tenders.map((x) => (
                    <li key={x.method} className="flex gap-2">
                      <span className="flex-1 text-ink-2">{t(`tender.${x.method}` as never)}</span>
                      <span className="tabular-nums">
                        {x.count} · {money(x.amount, cur)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : report.isLoading ? (
            <Spinner />
          ) : null}
        </>
      )}
      {dialog ? <CashDialog kind={dialog} session={s} currency={cur} onClose={() => setDialog(null)} onDone={refresh} /> : null}
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function CashDialog({ kind, session, currency, onClose, onDone }: { kind: Exclude<Dialog, null>; session: CashierSession | null; currency: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<ApprovalAsk | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const needsReason = kind === 'in' || kind === 'out' || kind === 'nosale';
  const needsAmount = kind !== 'nosale';

  async function run(approvalId?: number) {
    setBusy(true);
    setError(null);
    try {
      const a = Number(amount || 0).toFixed(2);
      const extra = approvalId ? { approval_id: approvalId } : {};
      if (kind === 'open') {
        await write('/cashier-sessions', { branch_id: till.branch, terminal_id: till.pairing.terminal_id, pos_register_id: till.pairing.pos_register_id ?? undefined, opening_float: a });
      } else if (kind === 'in' || kind === 'out') {
        await write(`/cashier-sessions/${session!.id}/cash`, { direction: kind, amount: a, reason: reason.trim(), ...extra });
        if (kind === 'out' || kind === 'in') void call('restaurant:openDrawer').catch(() => undefined);
      } else if (kind === 'nosale') {
        await write(`/cashier-sessions/${session!.id}/no-sale`, { reason: reason.trim() });
        const o = await call('restaurant:openDrawer');
        if (!o.ok) toast('warning', o.message);
      } else {
        if (session!.status === 'open') await write(`/cashier-sessions/${session!.id}/start_close`, {});
        const r = await write<{ variance?: Money; expected?: Money }>(`/cashier-sessions/${session!.id}/close`, { counted_cash: a, reason: reason.trim() || undefined, ...extra });
        onDone();
        setResult(r.data?.variance !== undefined && r.data.variance !== null ? t('cashier.closedVariance', { variance: money(r.data.variance, currency) }) : (r.message ?? t('cashier.closed')));
        return;
      }
      toast('success', t('cashier.saved'));
      onDone();
      onClose();
    } catch (e) {
      const f = refusal(e);
      if (needsApproval(f) && f.approval) setAsk({ ...f.approval, reason: reason.trim() || t('cashier.variance'), message: f.message });
      else setError(f.message);
    } finally {
      setBusy(false);
    }
  }

  if (ask) return <Approval ask={ask} onClose={onClose} onApproved={(id) => { setAsk(null); void run(id); }} />;

  const title = { open: t('cashier.open'), in: t('cashier.cashIn'), out: t('cashier.cashOut'), nosale: t('cashier.noSale'), close: t('cashier.close') }[kind];
  if (result) {
    return (
      <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}>
        <p className="text-[14px] text-ink">{result}</p>
      </Modal>
    );
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={kind === 'close' ? 'danger' : 'primary'} loading={busy} disabled={(needsAmount && amount === '') || (needsReason && !reason.trim())} onClick={() => void run()}>
            {title}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kind === 'close' ? <Note tone="muted">{t('cashier.closeHint')}</Note> : null}
        {needsAmount ? <TextField label={kind === 'open' ? t('cashier.float') : kind === 'close' ? t('cashier.counted') : t('pay.amount')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /> : null}
        {needsReason || kind === 'close' ? <ReasonField label={kind === 'close' ? t('cashier.varianceWhy') : t('cashier.why')} value={reason} onChange={setReason} /> : null}
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}
