import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PosProduct } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { Button, IconButton, Modal, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { customerOf, findInCatalogue, lookupProduct, PK, refreshCatalogue, useCartPrice, useCatalogue } from './api';
import { useBarcodeScanner } from './barcode';
import { cartActions, discountPct, itemCount, useCart } from './cart';
import { publish } from './display';
import { useT } from './i18n';
import { MoneyLine, Note, useTillContext } from './parts';
import { formatMoney } from './pricing';
import Tender from './TenderPanel';

/**
 * The register: the products (the catalogue copy, searched as you type, by category), a scanner's barcodes wherever
 * the keyboard's focus is, and the cart — quantities, the customer, the cashier's discount where they may give one —
 * with its price: WorkSuite's whenever it answers, the catalogue's preview meanwhile and offline (marked so). Pay opens
 * the tender. The customer display follows the cart.
 *
 * No drawer, no sale (WorkSuite's rule on every door, `drawer_closed`): with no register open at this till nothing can
 * be put in the cart — a pick or a scan says to open the register, and the cart asks for it with the way there.
 */
const SHOWN = 240;

export default function Register({ active }: { active: boolean }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const catalogue = useCatalogue();
  const cart = useCart();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [extras, setExtras] = useState<Map<number, PosProduct>>(new Map());
  const [paying, setPaying] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const products = useMemo(() => catalogue.data?.products ?? [], [catalogue.data]);
  const byId = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p] as const));
    for (const [id, p] of extras) if (!m.has(id)) m.set(id, p);
    return m;
  }, [products, extras]);
  const pct = discountPct(cart, till.discount.allowed, till.discount.ceiling);
  const currency = till.currency || catalogue.data?.currency || '';
  const org = till.company?.id ?? null;
  const price = useCartPrice(cart.lines, pct, byId, currency, till.discount.ceiling, till.caps, !till.offline, org);
  const session = till.session;
  // No drawer, no sale: nothing goes in the cart until a register is open here.
  const add = useCallback(
    (id: number): boolean => {
      if (!session) {
        toast('warning', t('pos.noDrawerShort'));
        return false;
      }
      cartActions.add(id);
      return true;
    },
    [session, t],
  );
  // What the server said it can do; unknown (options not read yet) tries POS's catalogue first.
  const capable = till.options ? !!till.caps.catalogue : undefined;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCatalogue(capable);
      void qc.invalidateQueries({ queryKey: PK.catalogue });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The catalogue could not be read.');
    } finally {
      setRefreshing(false);
    }
  }, [qc, capable]);

  // A till with no copy yet takes one as soon as WorkSuite answers.
  const asked = useRef(false);
  useEffect(() => {
    if (catalogue.isSuccess && !catalogue.data && !till.offline && !asked.current) {
      asked.current = true;
      void refresh();
    }
  }, [catalogue.isSuccess, catalogue.data, till.offline, refresh]);

  const onScan = useCallback(
    async (code: string) => {
      if (!session) {
        toast('warning', t('pos.noDrawerShort'));
        return;
      }
      const hit = findInCatalogue([...byId.values()], code);
      if (hit) {
        add(hit.id);
        return;
      }
      if (till.offline) {
        toast('warning', `No product in this till’s catalogue has the code ${code}.`);
        return;
      }
      try {
        const p = await lookupProduct(code, till.caps, org);
        if (!p || !p.id) {
          toast('warning', `No product has the code ${code}.`);
          return;
        }
        setExtras((m) => new Map(m).set(p.id, p));
        add(p.id);
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'WorkSuite could not look that code up.');
      }
    },
    [byId, till.offline, till.caps, org, session, add, t],
  );
  useBarcodeScanner(active && !paying && !customerOpen, (code) => void onScan(code));

  // The customer display follows the cart.
  const shop = till.company?.name ?? null;
  useEffect(() => {
    if (paying) return;
    const c = price.cart;
    if (!c || !cart.lines.length) publish({ kind: 'idle', shop });
    else publish({ kind: 'cart', shop, currency, lines: c.lines.map((l) => ({ name: l.name, quantity: l.quantity, total: l.total })), discount: c.discount, tax: c.tax, total: c.total, provisional: price.source === 'estimate' });
  }, [price.cart, price.source, cart.lines.length, currency, shop, paying]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category) && (!needle || p.name.toLowerCase().includes(needle) || p.code?.toLowerCase().includes(needle) || p.barcode?.includes(needle)));
  }, [products, q, category]);

  const canSell = !!till.company?.can.sell;

  return (
    <div className="flex h-full min-h-[560px]">
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-4" aria-label="Products">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q.trim()) {
                  const exact = findInCatalogue(products, q);
                  const only = filtered.length === 1 ? filtered[0] : null;
                  const hit = exact ?? only;
                  if (hit) {
                    if (add(hit.id)) setQ('');
                  } else void onScan(q.trim()).then(() => setQ(''));
                }
              }}
              placeholder={t('pos.search')}
              aria-label={t('pos.search')}
              className="h-10 w-full rounded-[10px] border border-line bg-surface pr-3 pl-9 text-[14px] text-ink outline-none focus:border-primary"
            />
          </label>
          <IconButton icon="refresh" label={t('pos.refreshCatalogue')} disabled={till.offline || refreshing} onClick={() => void refresh()} />
        </div>
        {catalogue.data?.categories.length ? (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
            {[null, ...catalogue.data.categories].map((c) => (
              <button
                key={c ?? '*'}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => setCategory(c)}
                className={cx('h-7 rounded-full px-3 text-[12px] font-semibold', category === c ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}
              >
                {c ?? t('pos.all')}
              </button>
            ))}
          </div>
        ) : null}
        {!catalogue.data ? (
          <Note action={<Button size="sm" loading={refreshing} disabled={till.offline} onClick={() => void refresh()}>{t('pos.refreshCatalogue')}</Button>}>{t('pos.noCatalogue')}</Note>
        ) : filtered.length === 0 ? (
          <Note>{t('pos.noProducts')}</Note>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 overflow-y-auto pb-2 scroll-thin">
            {filtered.slice(0, SHOWN).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => add(p.id)}
                aria-disabled={!session || undefined}
                className="flex min-h-[78px] flex-col items-start justify-between gap-1 rounded-[10px] border border-line bg-surface p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-subtle"
              >
                <span className="line-clamp-2 text-[13px] leading-tight font-semibold text-ink">{p.name}</span>
                <span className="flex w-full items-baseline justify-between gap-1 text-[12px]">
                  <span className="truncate text-ink-3">{p.code ?? ''}</span>
                  <span className="font-bold text-ink tabular-nums">{formatMoney(p.price)}</span>
                </span>
              </button>
            ))}
            {filtered.length > SHOWN ? <div className="col-span-full py-2 text-center text-[12px] text-ink-3">{filtered.length - SHOWN} more — search to narrow.</div> : null}
          </div>
        )}
      </section>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface" aria-label={t('pos.cart')}>
        <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h2 className="text-[15px] font-bold text-ink">
            {t('pos.cart')} {cart.lines.length ? <span className="text-ink-3">· {itemCount(cart)}</span> : null}
          </h2>
          {cart.lines.length ? (
            <Button size="sm" variant="ghost" onClick={() => cartActions.clear()}>
              {t('pos.clear')}
            </Button>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 scroll-thin">
          {cart.lines.length === 0 && !session ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
              <Icon name="banknote" size={28} className="text-warning" />
              <p className="text-[13.5px] font-semibold text-ink">{t('pos.noDrawer')}</p>
              <Button variant="primary" onClick={() => till.go('shift')}>
                {t('pos.openShift')}
              </Button>
            </div>
          ) : cart.lines.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-3">{t('pos.cartEmpty')}</p>
          ) : null}
          <ul className="flex flex-col divide-y divide-line">
            {cart.lines.map((l) => {
              const p = byId.get(l.product_id);
              const priced = price.cart?.lines.find((x) => x.product_id === l.product_id);
              return (
                <li key={l.product_id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{p?.name ?? `#${l.product_id}`}</div>
                    <div className="text-[12px] text-ink-3 tabular-nums">
                      {formatMoney(priced?.unit_price ?? p?.price)}
                      {priced?.discount_pct ? ` −${priced.discount_pct}%` : ''}
                    </div>
                  </div>
                  <IconButton icon="minus" label={`One fewer ${p?.name ?? ''}`} size={14} onClick={() => cartActions.qty(l.product_id, l.quantity - 1)} />
                  <input
                    aria-label={`${t('pos.qty')} ${p?.name ?? ''}`}
                    inputMode="decimal"
                    value={String(l.quantity)}
                    onChange={(e) => cartActions.qty(l.product_id, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                    className="h-7 w-12 rounded-[6px] border border-line bg-surface text-center text-[13px] tabular-nums outline-none focus:border-primary"
                  />
                  <IconButton icon="plus" label={`One more ${p?.name ?? ''}`} size={14} onClick={() => cartActions.add(l.product_id)} />
                  <span className="w-20 text-right text-[13px] font-semibold tabular-nums">{formatMoney(priced?.total)}</span>
                  <IconButton icon="trash" label={t('pos.remove')} size={14} onClick={() => cartActions.remove(l.product_id)} />
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={() => setCustomerOpen(true)} className="flex items-center gap-2 rounded-[8px] px-1 py-1 text-left text-[13px] text-ink-2 hover:bg-subtle">
            <Icon name="user" size={15} />
            <span className="flex-1 truncate">{cart.customer ? [cart.customer.name, cart.customer.phone, cart.customer.email].filter(Boolean).join(' · ') : t('pos.walkIn')}</span>
            <span className="text-[12px] font-semibold text-primary">{cart.customer ? 'Change' : t('pos.addCustomer')}</span>
          </button>
          {till.discount.allowed ? (
            <label className="flex items-center justify-between gap-2 text-[13px] text-ink-2">
              <span>
                {t('pos.discount')}
                {till.discount.ceiling ? <span className="text-ink-3"> (max {till.discount.ceiling}%)</span> : null}
              </span>
              <input inputMode="decimal" value={cart.discount} onChange={(e) => cartActions.discount(e.target.value, till.discount.ceiling)} aria-label={t('pos.discount')} className="h-7 w-20 rounded-[6px] border border-line bg-surface px-2 text-right tabular-nums outline-none focus:border-primary" />
            </label>
          ) : null}
          {price.cart ? (
            <div className="flex flex-col gap-0.5">
              <MoneyLine label={t('pos.subtotal')} value={price.cart.subtotal} />
              {price.cart.discount ? <MoneyLine label={t('pos.discount')} value={-price.cart.discount} /> : null}
              <MoneyLine label={t('pos.tax')} value={price.cart.tax} />
              <MoneyLine label={t('pos.total')} value={price.cart.total} currency={currency} strong />
              <span className={cx('text-[11.5px]', price.source === 'server' ? 'text-success' : 'text-ink-3')}>
                {price.pending ? t('pos.pricing') : price.source === 'server' ? t('pos.priceServer') : t('pos.priceEstimate')}
              </span>
            </div>
          ) : null}
          {price.error ? <Note tone="danger">{price.error}</Note> : null}
          {!session && cart.lines.length ? (
            <Note tone="warning" action={<Button size="sm" onClick={() => till.go('shift')}>{t('pos.openShift')}</Button>}>
              {t('pos.noDrawer')}
            </Note>
          ) : !canSell ? (
            <Note tone="warning">You may not sell at this till (pos.sale.create).</Note>
          ) : null}
          <Button variant="primary" size="lg" icon="banknote" disabled={!session || !canSell || !price.cart || !!price.error || price.pending || cart.lines.length === 0} onClick={() => setPaying(true)}>
            {t('pos.pay')} {price.cart ? formatMoney(price.cart.total, currency) : ''}
          </Button>
        </div>
      </aside>

      {paying && price.cart && session ? (
        <Tender
          cart={price.cart}
          source={price.source}
          currency={currency}
          session={session}
          customer={customerOf(cart.customer)}
          catalogueVersion={catalogue.data?.version ?? null}
          onClose={() => setPaying(false)}
          onDone={() => {
            cartActions.clear();
            setPaying(false);
            search.current?.focus();
          }}
        />
      ) : null}
      {customerOpen ? <CustomerForm onClose={() => setCustomerOpen(false)} /> : null}
    </div>
  );
}

/** The customer on the sale: a name, a phone number, an e-mail address — any of them, or none (a walk-in). */
function CustomerForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const cart = useCart();
  const [name, setName] = useState(cart.customer?.name ?? '');
  const [phone, setPhone] = useState(cart.customer?.phone ?? '');
  const [email, setEmail] = useState(cart.customer?.email ?? '');
  const badEmail = !!email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const needsName = !!phone.trim() && !name.trim() && !email.trim();
  return (
    <Modal
      title={t('pos.customer')}
      onClose={onClose}
      footer={
        <>
          <Button
            onClick={() => {
              cartActions.customer(null);
              onClose();
            }}
          >
            {t('pos.walkIn')}
          </Button>
          <Button
            variant="primary"
            disabled={badEmail || needsName}
            onClick={() => {
              cartActions.customer({ name: name.slice(0, 150), phone: phone.slice(0, 40), email: email.slice(0, 150) });
              onClose();
            }}
          >
            {t('pos.addCustomer')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={150} />
        <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" error={needsName ? 'Give their name or e-mail address with the phone number.' : null} />
        <TextField label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={150} inputMode="email" error={badEmail ? 'That is not an e-mail address.' : null} />
        <p className="text-[12px] text-ink-3">WorkSuite matches the customer by e-mail, then by name; a new one is added to Sales & Orders.</p>
      </div>
    </Modal>
  );
}
