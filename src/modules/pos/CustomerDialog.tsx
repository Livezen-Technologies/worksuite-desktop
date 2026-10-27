import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { PosCustomer } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx, initials } from '../../components/ui';
import { cartActions, useCart } from './cart';
import { createCustomer, findCustomers, maxRedeem, readCustomer, storeCredit, type CrmCustomer } from './desk';
import { useT } from './i18n';
import { BADGE, ON, OFF } from './look';
import { Note, PosButton, PosDialog, timeOf, useTillContext } from './parts';
import { formatMoney } from './pricing';

/**
 * The customer on the sale, from CRM (D04, `capabilities.customers`): found by phone (any formatting), name or e-mail
 * through the till's door, or added in one step — and when WorkSuite already has someone like them (409
 * `customer_exists`) the candidates are offered to pick from rather than a duplicate made. The card shows what they
 * spent in twelve months, their visits, tier and points, their store credit, and their last purchases; points can be
 * spent on this sale (`capabilities.loyalty`) up to what the programme allows. Attaching puts the CRM customer on the
 * sale (`customer_id`): the order is theirs and their points move. Online only — offline, the old form takes a name.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The CRM customer as the sale carries them: their id and the words for the screens (never a figure WorkSuite uses). */
export function saleCustomerOf(c: CrmCustomer, tier: string | null): PosCustomer {
  return {
    id: c.id,
    name: c.name.slice(0, 150),
    ...(c.phone ? { phone: c.phone.slice(0, 40) } : {}),
    ...(c.email && EMAIL.test(c.email) && c.email.length <= 150 ? { email: c.email } : {}),
    ...(tier ? { tier: tier.slice(0, 60) } : {}),
    points: c.points,
    ...(c.group ? { group: c.group.slice(0, 60) } : {}),
  };
}

/**
 * `newPhone`: a number the customer gave at the customer display that WorkSuite does not have (#294) — the dialog
 * opens on "New customer" with it filled in.
 */
export default function CustomerDialog({ payable, currency, onClose, newPhone }: { payable: number; currency: string; onClose: () => void; newPhone?: string }) {
  const t = useT();
  const till = useTillContext();
  const cart = useCart();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<number | null>(cart.customer?.id ?? null);
  const [creating, setCreating] = useState(!!newPhone);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(newPhone ?? '');
  const [email, setEmail] = useState('');
  const [candidates, setCandidates] = useState<{ list: CrmCustomer[]; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeem, setRedeem] = useState(cart.redeem ?? '');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  const found = useQuery({ queryKey: ['pos', 'customers', debounced], queryFn: () => findCustomers(debounced), enabled: debounced.length >= 2 && !till.offline, retry: false, staleTime: 30_000 });
  const card = useQuery({ queryKey: ['pos', 'customer', picked], queryFn: () => readCustomer(picked!), enabled: !!picked && !till.offline, retry: false });
  const credit = useQuery({ queryKey: ['pos', 'credit', picked], queryFn: () => storeCredit(picked!), enabled: !!picked && !!till.caps.store_credit && !till.offline, retry: false });
  const c = card.data ?? null;
  const loyal = !!till.caps.loyalty && !!c?.loyalty?.enabled;
  const most = c ? maxRedeem(c.points, c.loyalty, payable) : 0;
  const typed = Math.min(most, Math.max(0, Math.floor(Number(redeem) || 0)));
  const badEmail = !!email.trim() && !EMAIL.test(email.trim());

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await createCustomer({ name, phone, email });
      if ('candidates' in r) setCandidates({ list: r.candidates, message: r.message });
      else {
        setCreating(false);
        setPicked(r.customer.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.cust.failed'));
    } finally {
      setBusy(false);
    }
  }

  function attach() {
    if (!c) return;
    cartActions.customer(saleCustomerOf(c, c.tier));
    cartActions.redeem(loyal && typed > 0 ? String(typed) : '');
    onClose();
  }

  const row = (x: CrmCustomer) => (
    <button key={x.id} type="button" aria-pressed={picked === x.id} onClick={() => setPicked(x.id)} className={cx('flex items-center gap-3 rounded-pos px-3 py-2.5 text-left', picked === x.id ? ON : OFF)}>
      <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold', 'bg-pos-tint-indigo text-pos-tint-indigo-ink')}>{initials(x.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">{x.name}</span>
        <span className="block truncate text-[12px] text-ink-3">{[x.phone, x.email, till.caps.loyalty ? t('pos.cust.points', { n: x.points }) : null].filter(Boolean).join(' · ')}</span>
      </span>
      {x.group ? <span className="shrink-0 rounded-full bg-pos-key px-2.5 py-0.5 text-[11px] font-bold text-ink-2">{x.group}</span> : null}
    </button>
  );

  return (
    <PosDialog label={t('pos.cust.title')} onClose={busy ? undefined : onClose} width={1120} className="h-[min(720px,100%)] flex-row">
      <section className="flex w-[460px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-pos-line p-6 scroll-thin max-lg:w-[380px]">
        <h2 className="text-[20px] font-extrabold">{t('pos.cust.title')}</h2>
        <label className="flex h-touch-md items-center gap-2.5 rounded-[12px] border-2 border-primary bg-pos-panel px-3.5">
          <Icon name="search" size={20} className="text-primary" />
          <input autoFocus={!newPhone} value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} placeholder={t('pos.cust.find')} aria-label={t('pos.cust.find')} className="bare-focus min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </label>
        <p className="text-[12px] text-ink-3">{t('pos.cust.findHint')}</p>
        {found.isFetching ? <p className="text-[13px] text-ink-3">{t('pos.cust.searching')}</p> : null}
        {found.isError ? <Note tone="danger">{found.error instanceof Error ? found.error.message : t('pos.cust.failed')}</Note> : null}
        {found.isSuccess && !found.data.length ? <p className="text-[13px] text-ink-3">{t('pos.cust.noneFound')}</p> : null}
        <div className="flex flex-col gap-2">{(found.data ?? []).map(row)}</div>
        {creating ? (
          <div className="flex flex-col gap-2 rounded-pos bg-pos-key p-3.5">
            <div className="text-[14px] font-bold">{t('pos.cust.new')}</div>
            <input value={name} autoFocus={!!newPhone} onChange={(e) => setName(e.target.value.slice(0, 150))} placeholder={t('pos.cust.name')} aria-label={t('pos.cust.name')} className="h-touch rounded-[10px] bg-pos-panel px-3 text-[14px] outline-none" />
            <input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 40))} placeholder={t('pos.cust.mobile')} aria-label={t('pos.cust.mobile')} inputMode="tel" className="h-touch rounded-[10px] bg-pos-panel px-3 text-[14px] outline-none" />
            <input value={email} onChange={(e) => setEmail(e.target.value.slice(0, 150))} placeholder={t('pos.cust.email')} aria-label={t('pos.cust.email')} inputMode="email" className="h-touch rounded-[10px] bg-pos-panel px-3 text-[14px] outline-none" />
            {badEmail ? <p className="text-[12px] text-danger">{t('pos.cust.badEmail')}</p> : null}
            {candidates ? (
              <div className="flex flex-col gap-2">
                <Note tone="warning">{candidates.message}</Note>
                {candidates.list.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setCandidates(null);
                      setPicked(x.id);
                    }}
                    className={cx('flex items-center gap-3 rounded-[10px] px-3 py-2 text-left', OFF)}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{x.name}</span>
                    <span className="text-[12px] text-ink-3">{[x.phone, x.email].filter(Boolean).join(' · ')}</span>
                    <span className="text-[12px] font-bold text-primary">{t('pos.cust.thisOne')}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <PosButton tone="primary" className="h-touch-md" disabled={busy || !name.trim() || (!phone.trim() && !email.trim()) || badEmail} onClick={() => void add()}>
              {busy ? <Icon name="spinner" size={16} className="animate-spin" /> : <Icon name="user-plus" size={16} />}
              {t('pos.cust.add')}
            </PosButton>
          </div>
        ) : (
          <PosButton className="h-touch-md" onClick={() => setCreating(true)}>
            <Icon name="user-plus" size={18} />
            {t('pos.cust.new')}
          </PosButton>
        )}
        {error ? <Note tone="danger">{error}</Note> : null}
      </section>
      <section className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto p-6 scroll-thin">
        {!picked ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-ink-3">
            <Icon name="user" size={40} />
            <p className="max-w-[360px] text-[14px]">{t('pos.cust.pick')}</p>
          </div>
        ) : card.isError ? (
          <Note tone="danger">{card.error instanceof Error ? card.error.message : t('pos.cust.failed')}</Note>
        ) : !c ? (
          <p className="text-[13px] text-ink-3">{t('pos.cust.reading')}</p>
        ) : (
          <>
            <div className="flex items-center gap-3.5">
              <span className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[18px] font-extrabold', c.tier ? BADGE.gold : 'bg-pos-tint-indigo text-pos-tint-indigo-ink')}>{initials(c.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[20px] font-extrabold">{c.name}</div>
                <div className="truncate text-[13px] text-ink-3">{[c.phone, c.email, c.group].filter(Boolean).join(' · ')}</div>
              </div>
              {c.tier ? <span className={cx('rounded-full px-3 py-1 text-[13px] font-bold', BADGE.gold)}>{c.tier}</span> : null}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                [formatMoney(c.spend_12m, currency), t('pos.cust.spent')],
                [String(c.visits_12m), t('pos.cust.visits')],
                [String(c.points), t('pos.cust.pointsLabel')],
              ].map(([v, k]) => (
                <div key={k} className="rounded-pos bg-pos-key px-4 py-3">
                  <div className="font-mono text-[18px] font-bold">{v}</div>
                  <div className="text-[12px] text-ink-3">{k}</div>
                </div>
              ))}
            </div>
            {c.next_tier ? <p className="text-[12px] text-ink-3">{t('pos.cust.nextTier', { name: c.next_tier.name, n: formatMoney(c.next_tier.spend_to_go, currency) })}</p> : null}
            <p className="text-[13px] text-ink-2">
              {[
                loyal && most > 0 ? t('pos.cust.canRedeem', { n: most, v: formatMoney(most * (c.loyalty?.point_value ?? 0), currency) }) : null,
                till.caps.store_credit && credit.data ? t('pos.cust.credit', { n: formatMoney(credit.data.balance, currency) }) : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
            {loyal && most > 0 ? (
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-bold text-ink-2">{t('pos.cust.redeem')}</span>
                <input
                  value={redeem}
                  inputMode="numeric"
                  onChange={(e) => setRedeem(e.target.value.replace(/\D+/g, '').slice(0, 9))}
                  aria-label={t('pos.cust.redeem')}
                  className="h-touch w-28 rounded-[10px] bg-pos-panel px-3 text-right font-mono text-[15px] shadow-[inset_0_0_0_1px_var(--ws-slate-line)] outline-none"
                />
                <PosButton className="h-touch px-3 text-[13px]" onClick={() => setRedeem(String(most))}>
                  {t('pos.cust.redeemAll')}
                </PosButton>
                {typed > 0 ? <span className="text-[13px] text-ink-3">= {formatMoney(typed * (c.loyalty?.point_value ?? 0), currency)}</span> : null}
              </div>
            ) : null}
            {c.last.length ? (
              <>
                <div className="text-[13px] font-bold text-ink-2">{t('pos.cust.recent')}</div>
                <div className="flex flex-col gap-1.5">
                  {c.last.map((p) => (
                    <div key={p.ref} className="flex items-center gap-3 rounded-[10px] bg-pos-key px-3 py-2 text-[13px]">
                      <span className="font-mono font-bold">{p.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-3">{[timeOf(p.at), p.items.join(', ')].filter(Boolean).join(' · ')}</span>
                      <span className={cx('font-mono', p.voided && 'line-through')}>{formatMoney(p.total)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
        <div className="mt-auto flex gap-2.5 pt-2">
          <PosButton
            className="h-touch-lg w-48"
            onClick={() => {
              cartActions.customer(null);
              onClose();
            }}
          >
            {t('pos.cust.walkIn')}
          </PosButton>
          <PosButton tone="primary" className="h-touch-lg flex-1 text-[16px]" disabled={!c} onClick={attach}>
            {t('pos.cust.attach')}
          </PosButton>
        </div>
      </section>
    </PosDialog>
  );
}
