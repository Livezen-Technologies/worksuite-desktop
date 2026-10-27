import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tenderOptionsOf, type PosApprovalNeed, type PosProduct } from '@shared/pos';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button, TextField } from '../../components/ui';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { customerOf, findInCatalogue, lookupProduct, openDrawer, PK, refreshCatalogue, searchProducts, useCartPrice, useCatalogue, useSales } from './api';
import { useBarcodeScanner } from './barcode';
import CartPane from './CartPane';
import CashMove from './CashMove';
import { discountNeed, draftOf } from './adjust';
import { approvalActions, covers, saleDiscount, useSaleApproval } from './approval';
import { activeSale, cartActions, discountAmount, discountPct, MAX_OPEN, redeemOf, useCart, useCarts, type CartState } from './cart';
import { categoryLabel, FAVOURITES, inCategory } from './catalog';
import CategoryPicker from './CategoryPicker';
import CustomerDialog, { saleCustomerOf } from './CustomerDialog';
import { customersByPhone, readCustomer, stockLevels, topSellersToday } from './desk';
import { displayCart, displayTouch, onDisplay, publish, tellDisplay } from './display';
import { createDisplayDesk, type DisplayNotice } from './displayDesk';
import { useT } from './i18n';
import { CouponDialog, DiscountDialog } from './DiscountEditor';
import { HeldDialog, HoldDialog, OpenSalesDialog, useServerHeld } from './OpenSales';
import Override from './Override';
import { clampPage, GRID_PAGE, LIST_PAGE, pushRecent } from './paging';
import { Note, PosButton, PosDialog, useTillContext } from './parts';
import { discountBase, estimateCart, formatMoney, shareOf } from './pricing';
import ProductGrid, { type GridView, type QuickAction } from './ProductGrid';
import ReturnDialog from './ReturnDialog';
import { buildIndex, exact, search as searchIndex, SEARCH_DEBOUNCE_MS } from './search';
import Tender from './TenderPanel';

/**
 * The counter: the products (the catalogue copy, searched as you type, by category, fifteen a page), a scanner's
 * barcodes wherever the keyboard's focus is, and the sale on screen — one of up to five open on this till, as tabs —
 * with its customer, quantities, the cashier's discount where they may give one, and its price: WorkSuite's whenever
 * it answers, the catalogue's preview meanwhile and offline (marked so). Pay (F12) opens the payment, Cash exact
 * takes the total in cash at once. F2 goes to the search, Ctrl+N opens a sale, Ctrl+1…5 switch between them. The
 * customer display follows the sale on screen.
 *
 * No drawer, no sale (WorkSuite's rule on every door, `drawer_closed`): with no register open at this till nothing can
 * be put in the cart — a pick or a scan says to open the register, and the cart asks for it with the way there.
 *
 * Phase 2, each where the server announces it (`options.capabilities`) and only while it answers: the CRM customer
 * and their points (`customers`, `loyalty`), promotions in the price (`promotions`), a discount past the cashier's
 * rights approved by a manager (`approvals`), held sales on WorkSuite (`held`), the company's tenders (`tenders`),
 * groups and favourites in the category picker, today's top sellers and stock on the grid. Offline, or on an older
 * server, the counter is exactly what it was.
 */
const RECENT_KEY = 'pos.recentCategories';
const VIEW_KEY = 'pos.productView';

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function keep(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* A private window or blocked storage: the counter just does not remember it. */
  }
}

type Dialog = 'customer' | 'discount' | 'coupon' | 'category' | 'open' | 'held' | 'hold' | 'cash' | 'return' | 'override' | null;

export default function Register({ active }: { active: boolean }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const catalogue = useCatalogue();
  const cart = useCart();
  const all = useCarts();
  const [q, setQ] = useState('');
  // What the grid is searched by: what was typed, once the cashier pauses (worksuite-desktop#296).
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setSettled(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [q]);
  // Cleared at once; typed, once the cashier pauses.
  const dq = q.trim() ? settled : '';
  const [category, setCategory] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => stored<string[]>(RECENT_KEY, []));
  const [view, setView] = useState<GridView>(() => (stored<string>(VIEW_KEY, 'grid') === 'list' ? 'list' : 'grid'));
  // The page shown, for the search, category and view it was turned in: another of them starts at the first page.
  const [paged, setPaged] = useState<{ where: string; page: number }>({ where: '', page: 0 });
  const [extras, setExtras] = useState<Map<number, PosProduct>>(new Map());
  const [paying, setPaying] = useState<'pay' | 'exact' | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [more, setMore] = useState<HTMLButtonElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const online = !till.offline;
  const caps = till.caps;
  // Stock goes stale in the copy (its version does not change with stock): read again every five minutes.
  const stock = useQuery({ queryKey: ['pos', 'stock'], queryFn: stockLevels, enabled: active && online && !!caps.stock && !!catalogue.data, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: false });
  const products = useMemo(() => {
    const list = catalogue.data?.products ?? [];
    const levels = stock.data;
    if (!levels?.size) return list;
    return list.map((p) => {
      const l = levels.get(p.id);
      return l ? { ...p, stock_state: l.state, stock_available: l.available } : p;
    });
  }, [catalogue.data, stock.data]);
  // The search index, built once per catalogue copy: names, codes, barcodes and categories, a barcode by a map.
  const index = useMemo(() => buildIndex(catalogue.data?.products ?? []), [catalogue.data]);
  const byId = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p] as const));
    for (const [id, p] of extras) if (!m.has(id)) m.set(id, p);
    return m;
  }, [products, extras]);
  const sale = activeSale(all);
  const approval = useSaleApproval(sale.id);
  // A discount past the cashier's rights waits for a manager's approval (online, `capabilities.approvals`).
  const approvalsOn = !!caps.approvals && online;
  // What the cashier's discount comes off (the goods after list discounts and promotions), as the cart was last priced:
  // a fixed amount (#293) is measured against it for the cashier's rights and a manager's approval.
  const [base, setBase] = useState<number | null>(null);
  const disc = saleDiscount(cart, till.discount, approvalsOn, approval, undefined, base);
  const pct = disc.pct;
  const currency = till.currency || catalogue.data?.currency || '';
  const org = till.company?.id ?? null;
  const counter = useMemo(
    () => ({
      ...(caps.customers && cart.customer?.id ? { customer_id: cart.customer.id } : {}),
      ...(caps.coupons && cart.coupon ? { coupon_code: cart.coupon } : {}),
      ...(caps.loyalty && redeemOf(cart) > 0 ? { redeem_points: redeemOf(cart) } : {}),
    }),
    [caps.customers, caps.coupons, caps.loyalty, cart],
  );
  const price = useCartPrice(cart.lines, pct, byId, currency, till.discount.ceiling, caps, online, org, counter, disc.approved, disc.amount ?? null);
  const pricedBase = price.cart ? discountBase(price.cart) : null;
  // Kept as the cart is priced (it does not depend on the cashier's discount): adjusted while rendering, not in an effect.
  if (pricedBase !== null && pricedBase !== base) setBase(pricedBase);
  const heldOnServer = !!caps.held && online;
  const serverHeld = useServerHeld(heldOnServer && active);
  const offered = useMemo(() => tenderOptionsOf(till.company?.tenders) ?? catalogue.data?.tenders ?? null, [till.company, catalogue.data]);
  const tree = catalogue.data?.category_tree;
  const favourites = catalogue.data?.favourites;
  const top = useQuery({ queryKey: ['pos', 'top-sellers'], queryFn: () => topSellersToday(20), enabled: dialog === 'category' && online && !!caps.top_sellers, staleTime: 60_000, retry: false });
  const session = till.session;
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const today = useSales({ since }, dialog === 'category');

  /** What a sale not on screen comes to: the catalogue's preview. */
  const totalOf = useCallback(
    (c: CartState) => (c.lines.length ? estimateCart(c.lines, byId, discountPct(c, till.discount.allowed, till.discount.ceiling), till.discount.ceiling, currency, till.discount.allowed ? discountAmount(c) : null).cart.total : 0),
    [byId, till.discount.allowed, till.discount.ceiling, currency],
  );

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
      const hit = exact(index, code) ?? findInCatalogue([...extras.values()], code);
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
    [index, extras, till.offline, till.caps, org, session, add, t],
  );
  useBarcodeScanner(active && !paying && !dialog, (code) => void onScan(code));

  // The customer display follows the sale on screen: with a CRM customer, a greeting (their name masked — publish masks
  // it), their tier and points; and, where WorkSuite looks numbers up and answers now, the customer's phone entry (#294).
  const shop = till.company?.name ?? null;
  const who = cart.customer;
  const phoneOn = !!caps.display_phone && !!caps.customers && online;
  useEffect(() => {
    if (paying) return;
    const c = price.cart;
    if (!c || !cart.lines.length) publish({ kind: 'idle', shop });
    else
      publish({
        kind: 'cart',
        shop,
        currency,
        ...displayCart(c),
        provisional: price.source === 'estimate',
        phone: phoneOn,
        ...(who?.id && who.name ? { customer: who.name } : {}),
        ...(who?.id && who.tier ? { tier: who.tier } : {}),
        ...(who?.id && caps.loyalty && typeof who.points === 'number' ? { points: who.points } : {}),
      });
  }, [price.cart, price.source, cart.lines.length, currency, shop, paying, who, caps.loyalty, phoneOn]);

  // What the customer does at the display (#294): this register looks the number up and puts them on the sale.
  const touch = useStore(displayTouch, (x) => x.touch);
  const [notice, setNotice] = useState<DisplayNotice | null>(null);
  const [newPhone, setNewPhone] = useState<string | undefined>(undefined);
  const live = useRef({ phoneOn, hasCustomer: !!cart.customer });
  useEffect(() => {
    live.current = { phoneOn, hasCustomer: !!cart.customer };
  }, [phoneOn, cart.customer]);
  useEffect(() => {
    if (!active) return;
    const handle = createDisplayDesk({
      enabled: () => live.current.phoneOn,
      lookup: customersByPhone,
      read: readCustomer,
      attach: (c) => {
        cartActions.customer(saleCustomerOf(c, c.tier));
        cartActions.redeem('');
      },
      detach: () => {
        if (!live.current.hasCustomer) return false;
        cartActions.customer(null);
        return true;
      },
      reply: tellDisplay,
      notice: (n) => {
        if (n.kind === 'notMe') {
          setNotice(null);
          toast('info', t('pos.dp.notMe'));
        } else setNotice(n);
      },
    });
    return onDisplay((m) => void handle(m));
  }, [active, t]);
  const mayAsk = phoneOn && touch && cart.lines.length > 0 && !cart.customer;

  // Searched on the till's own copy, never WorkSuite (worksuite-desktop#296) — except while that copy is empty or still
  // loading and WorkSuite answers: then its own search stands in.
  const copyEmpty = !catalogue.data?.products.length;
  const fallback = copyEmpty && online && !!caps.product_search && dq.trim().length >= 2;
  const server = useQuery({ queryKey: ['pos', 'search', dq.trim(), org], queryFn: ({ signal }) => searchProducts(dq.trim(), org, signal), enabled: active && fallback, staleTime: 30_000, retry: false });
  const filtered = useMemo(() => {
    if (fallback) return server.data ?? [];
    const levels = stock.data;
    const found = dq.trim() ? searchIndex(index, dq).map((p) => (levels?.get(p.id) ? { ...p, stock_state: levels.get(p.id)!.state, stock_available: levels.get(p.id)!.available } : p)) : products;
    return category ? found.filter((p) => inCategory(p, category, tree, favourites)) : found;
  }, [fallback, server.data, index, dq, products, stock.data, category, tree, favourites]);
  const nameOfCategory = useCallback((c: string) => categoryLabel(c, tree, t('pos.cat.favourites')) ?? c, [tree, t]);
  const size = view === 'grid' ? GRID_PAGE : LIST_PAGE;
  const where = JSON.stringify([dq, category, view]);
  const shownPage = clampPage(paged.where === where ? paged.page : 0, filtered.length, size);
  const setPage = useCallback((p: number | ((p: number) => number)) => setPaged((x) => ({ where, page: Math.max(0, typeof p === 'function' ? p(x.where === where ? x.page : 0) : p) })), [where]);

  const pickCategory = (c: string | null) => {
    setCategory(c);
    if (c) {
      const next = pushRecent(recent, c);
      setRecent(next);
      keep(RECENT_KEY, next);
    }
    setDialog(null);
  };
  const recentShown = useMemo(
    () => recent.filter((c) => (c === FAVOURITES ? !!favourites?.length : c.startsWith('#') ? !!categoryLabel(c, tree, '') : catalogue.data?.categories.includes(c) || products.some((p) => p.category === c))),
    [recent, catalogue.data, products, tree, favourites],
  );

  const canSell = !!till.company?.can.sell;
  const payable = !!session && canSell && !!price.cart && !price.error && !price.pending && cart.lines.length > 0 && !disc.needs;
  // What the manager approves: the percentage typed, or the share a fixed amount comes to (#293).
  const typedAmount = discountAmount(cart);
  const typedPct = typedAmount !== null ? shareOf(typedAmount, base ?? 0) : Math.max(0, Math.min(100, Number(cart.discount) || 0));
  const askDiscount: PosApprovalNeed = discountNeed(t, { pct: typedPct, amount: typedAmount }, till.discount, (n) => formatMoney(n, currency));

  // ?new=1 is the shell's "New" (⌘N / Ctrl+N from the menu): another sale.
  const newAsked = till.params.get('new') === '1';
  useEffect(() => {
    if (!newAsked) return;
    if (!cartActions.newSale()) toast('warning', t('pos.open.full', { n: MAX_OPEN }));
    till.go('register');
  }, [newAsked, till, t]);

  // The counter's keys, while it is the tab in front and nothing is open over it.
  useEffect(() => {
    if (!active || paying || dialog) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F2') {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (e.key === 'F12') {
        e.preventDefault();
        if (payable) setPaying('pay');
      } else if (mod && !e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        if (!cartActions.newSale()) toast('warning', t('pos.open.full', { n: MAX_OPEN }));
      } else if (mod && !e.shiftKey && !e.altKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        cartActions.switchIndex(Number(e.key) - 1);
      } else if (e.key === 'PageDown' && e.target === document.body) {
        setPage((p) => p + 1);
      } else if (e.key === 'PageUp' && e.target === document.body) {
        setPage((p) => Math.max(0, p - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, paying, dialog, payable, t, setPage]);

  const heldCount = all.held.length + (heldOnServer ? (serverHeld.data?.items.length ?? 0) : 0);
  const mayDiscount = till.discount.allowed || approvalsOn || (!!caps.coupons && online);
  const actions: QuickAction[] = [
    { id: 'hold', label: t('pos.hold'), icon: 'pause', disabled: !cart.lines.length, onClick: () => setDialog('hold') },
    { id: 'recall', label: heldCount ? t('pos.recallN', { n: heldCount }) : t('pos.recall'), icon: 'history', onClick: () => setDialog('held') },
    { id: 'return', label: t('pos.return'), icon: 'undo', onClick: () => setDialog('return') },
    { id: 'discount', label: t('pos.discountShort'), icon: 'tag', disabled: !mayDiscount || !cart.lines.length, title: mayDiscount ? undefined : t('pos.noDiscountRight'), onClick: () => setDialog('discount') },
    { id: 'customer', label: t('pos.customer'), icon: 'user', onClick: () => setDialog('customer') },
    { id: 'cash', label: t('pos.cashInOut'), icon: 'banknote', title: session ? undefined : t('pos.noDrawerShort'), onClick: () => (session ? setDialog('cash') : till.go('shift')) },
    { id: 'drawer', label: t('pos.openDrawer'), icon: 'box', onClick: () => void openDrawer().then((o) => toast(o.ok ? 'success' : 'warning', o.message), (e: unknown) => toast('error', e instanceof Error ? e.message : 'The drawer did not open.')) },
    {
      id: 'more',
      label: t('pos.more'),
      icon: 'more',
      onClick: (el) => {
        moreRef.current = el;
        setMore(el);
      },
    },
  ];
  const moreSections: MenuSection[] = [
    {
      id: 'sales',
      items: [
        { id: 'new', label: t('pos.newSale'), icon: 'plus', shortcut: 'Ctrl+N', onSelect: () => void (cartActions.newSale() || toast('warning', t('pos.open.full', { n: MAX_OPEN }))) },
        { id: 'open', label: t('pos.open.all'), icon: 'grid', onSelect: () => setDialog('open') },
        { id: 'clear', label: t('pos.clearSale'), icon: 'trash', danger: true, disabled: !cart.lines.length && !cart.customer, onSelect: () => cartActions.clear() },
        // #294: the customer gives their number at the display, on its numpad.
        ...(caps.display_phone ? [{ id: 'askPhone', label: t('pos.dp.ask'), icon: 'phone', disabled: !mayAsk, onSelect: () => tellDisplay({ type: 'ask' }) }] : []),
      ],
    },
    {
      id: 'till',
      items: [
        { id: 'refresh', label: t('pos.refreshCatalogue'), icon: 'refresh', disabled: till.offline || refreshing, onSelect: () => void refresh() },
        { id: 'history', label: t('pos.sales'), icon: 'receipt', onSelect: () => till.go('sales') },
        { id: 'shift', label: t('pos.shift'), icon: 'banknote', onSelect: () => till.go('shift') },
      ],
    },
  ];

  const empty = fallback && server.isFetching && !filtered.length ? (
    <div className="flex-1">
      <Note>{t('pos.search.server')}</Note>
    </div>
  ) : fallback && !filtered.length ? (
    <div className="flex-1">
      <Note>{t('pos.search.serverNone')}</Note>
    </div>
  ) : !catalogue.data && !fallback ? (
    <div className="flex-1">
      <Note action={<Button size="sm" loading={refreshing} disabled={till.offline} onClick={() => void refresh()}>{t('pos.refreshCatalogue')}</Button>}>{t('pos.noCatalogue')}</Note>
    </div>
  ) : filtered.length === 0 ? (
    <div className="flex-1">
      <Note>{t('pos.noProducts')}</Note>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-[560px] bg-pos-ground text-ink">
      <ProductGrid
        search={search}
        q={q}
        onQ={setQ}
        onSearchKey={(e) => {
          if (e.key === 'Enter' && q.trim()) {
            // The exact code or barcode at once; else the one product the search (as typed now) found.
            const only = q === dq && filtered.length === 1 ? filtered[0] : null;
            const hit = exact(index, q) ?? only;
            if (hit) {
              if (add(hit.id)) setQ('');
            } else void onScan(q.trim()).then(() => setQ(''));
          } else if (e.key === 'Escape' && (q || category)) {
            e.stopPropagation();
            setQ('');
            setCategory(null);
          }
        }}
        category={category}
        categoryName={category ? nameOfCategory(category) : null}
        recentName={nameOfCategory}
        org={caps.product_images ? org : null}
        onCategory={pickCategory}
        onPickCategory={() => setDialog('category')}
        recent={recentShown}
        view={view}
        onView={(v) => {
          setView(v);
          keep(VIEW_KEY, v);
        }}
        products={filtered}
        total={products.length}
        page={shownPage}
        onPage={(p) => setPage(clampPage(p, filtered.length, size))}
        onAdd={(p) => {
          if (!extras.has(p.id) && !products.some((x) => x.id === p.id)) setExtras((m) => new Map(m).set(p.id, p));
          add(p.id);
        }}
        disabled={!session}
        actions={actions}
        empty={empty}
      />
      <CartPane
        price={price}
        byId={byId}
        currency={currency}
        totalOf={totalOf}
        canSell={canSell}
        onCustomer={() => setDialog('customer')}
        needsApproval={disc.needs}
        approvedBy={disc.approved !== null ? (approval?.approver ?? '') : null}
        onApproval={() => setDialog('override')}
        onPay={() => setPaying('pay')}
        onCashExact={() => setPaying('exact')}
        onOpenSales={() => setDialog('open')}
      />

      {more ? <Menu sections={moreSections} label={t('pos.more')} anchor={moreRef} prefer="top" align="end" onClose={() => setMore(null)} /> : null}
      {paying && price.cart && session ? (
        <Tender
          key={sale.id}
          cart={price.cart}
          source={price.source}
          currency={currency}
          session={session}
          customer={customerOf(cart.customer)}
          catalogueVersion={catalogue.data?.version ?? null}
          exact={paying === 'exact'}
          offered={offered}
          extras={{
            promotions: !!caps.promotions,
            coupon: caps.coupons ? (cart.coupon ?? null) : null,
            redeem: caps.loyalty ? redeemOf(cart) : 0,
            saleId: sale.id,
            approval: disc.approved !== null ? approval : null,
          }}
          pricing={{ pending: price.pending, error: price.error }}
          onClose={() => setPaying(null)}
          onDone={() => {
            cartActions.paid();
            setPaying(null);
            search.current?.focus();
          }}
        />
      ) : null}
      {dialog === 'return' ? <ReturnDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'cash' && session ? <CashMove session={session} onClose={() => setDialog(null)} /> : null}
      {dialog === 'customer' ? (
        caps.customers && online ? (
          <CustomerDialog
            payable={price.cart?.total ?? 0}
            currency={currency}
            newPhone={newPhone}
            onClose={() => {
              setDialog(null);
              setNewPhone(undefined);
            }}
          />
        ) : (
          <CustomerForm onClose={() => setDialog(null)} />
        )
      ) : null}
      {notice ? (
        <DisplayNoticeBar
          notice={notice}
          onDismiss={() => setNotice(null)}
          onChange={() => {
            setNotice(null);
            setDialog('customer');
          }}
          onCreate={(phone) => {
            setNotice(null);
            setNewPhone(phone);
            setDialog('customer');
          }}
        />
      ) : null}
      {dialog === 'discount' ? (
        <DiscountDialog
          initial={draftOf(cart)}
          base={base ?? (price.cart ? discountBase(price.cart) : 0)}
          currency={currency}
          amountOn={!!caps.discount_amount}
          rights={till.discount}
          approvals={approvalsOn}
          onCancel={() => setDialog(null)}
          onApply={(r) => {
            setDialog(null);
            // The same editor as the payment screen's Add discount (#293): the same result either way.
            if (till.discount.allowed || approvalsOn) cartActions.applyDiscount({ type: r.draft.type, value: r.draft.value, reason: r.draft.reason }, approvalsOn ? null : till.discount.ceiling);
            // Past the cashier's own rights: a manager approves it now (it shows as asked until then).
            if (r.needsApproval && !covers(approval, 'discount', r.pct)) setDialog('override');
          }}
        >
          {caps.coupons && online ? (
            caps.coupon_validate ? (
              <PosButton className="h-touch self-start px-4 text-[14px]" onClick={() => setDialog('coupon')}>
                {cart.coupon ? t('pos.adj.coupon', { code: cart.coupon }) : t('pos.adj.addCoupon')}
              </PosButton>
            ) : (
              <CouponField />
            )
          ) : null}
        </DiscountDialog>
      ) : null}
      {dialog === 'coupon' ? (
        <CouponDialog
          current={cart.coupon ?? null}
          lines={cart.lines}
          org={org}
          customerId={cart.customer?.id ?? null}
          offline={!online}
          onClose={() => setDialog(null)}
          onApplied={(code) => {
            cartActions.coupon(code);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'override' ? (
        <Override
          need={askDiscount}
          reason={cart.discount_reason}
          currency={currency}
          onClose={() => setDialog(null)}
          onApproved={(a) => {
            approvalActions.set(sale.id, a);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'hold' ? <HoldDialog id={sale.id} server={heldOnServer} nameOf={(id) => byId.get(id)?.name ?? null} totalOf={totalOf} onClose={() => setDialog(null)} /> : null}
      {dialog === 'held' ? <HeldDialog totalOf={totalOf} server={heldOnServer} onClose={() => setDialog(null)} /> : null}
      {dialog === 'open' ? <OpenSalesDialog totalOf={totalOf} server={heldOnServer} nameOf={(id) => byId.get(id)?.name ?? null} onClose={() => setDialog(null)} /> : null}
      {dialog === 'category' && catalogue.data ? (
        <CategoryPicker
          categories={catalogue.data.categories}
          products={products}
          sales={today.data ?? []}
          current={category}
          tree={tree}
          favourites={favourites}
          serverTop={top.data ?? null}
          onPick={pickCategory}
          onPoint={setCategory}
          onAdd={(p) => add(p.id)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * What the customer did at the customer display, for the cashier (#294): they confirmed their number — accept, or
 * change the customer — or gave a number WorkSuite does not have — create them, the number filled in.
 */
function DisplayNoticeBar({ notice, onDismiss, onChange, onCreate }: { notice: DisplayNotice; onDismiss: () => void; onChange: () => void; onCreate: (phone: string) => void }) {
  const t = useT();
  if (notice.kind === 'notMe') return null;
  const text = notice.kind === 'confirmed' ? t('pos.dp.confirmed', { name: notice.masked }) : notice.kind === 'new' ? t('pos.dp.newNumber', { phone: notice.phone }) : t('pos.dp.readFailed', { message: notice.message });
  return (
    <div role="status" className="fixed start-1/2 top-4 z-40 flex max-w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-pos bg-navy px-4 py-3 text-white shadow-lg rtl:translate-x-1/2">
      <span className="min-w-0 flex-1 text-[14px] font-semibold">{text}</span>
      {notice.kind === 'confirmed' ? (
        <>
          <PosButton className="h-touch px-4 text-[14px]" onClick={onChange}>
            {t('pos.dp.change')}
          </PosButton>
          <PosButton tone="primary" className="h-touch px-4 text-[14px]" onClick={onDismiss}>
            {t('pos.dp.accept')}
          </PosButton>
        </>
      ) : notice.kind === 'new' ? (
        <>
          <PosButton className="h-touch px-4 text-[14px]" onClick={onDismiss}>
            {t('pos.dp.dismiss')}
          </PosButton>
          <PosButton tone="primary" className="h-touch px-4 text-[14px]" onClick={() => onCreate(notice.phone)}>
            {t('pos.dp.create')}
          </PosButton>
        </>
      ) : (
        <PosButton className="h-touch px-4 text-[14px]" onClick={onDismiss}>
          {t('pos.dp.dismiss')}
        </PosButton>
      )}
    </div>
  );
}

/**
 * The coupon on the sale, typed, for a server that checks it only when it prices the cart (no `coupon_validate`): as it
 * always was. Where WorkSuite checks a coupon on the cart, the bottom bar opens the coupon dialog instead (#293).
 */
function CouponField() {
  const t = useT();
  const cart = useCart();
  return (
    <label className="flex items-center gap-3">
      <span className="text-[13px] font-bold text-ink-2">{t('pos.coupon')}</span>
      <input
        defaultValue={cart.coupon ?? ''}
        maxLength={40}
        onChange={(e) => cartActions.coupon(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40))}
        placeholder={t('pos.couponHint')}
        className="h-touch min-w-0 flex-1 rounded-[10px] bg-pos-panel px-3 font-mono text-[15px] shadow-[inset_0_0_0_1px_var(--ws-slate-line)] outline-none"
      />
    </label>
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
    <PosDialog label={t('pos.customer')} onClose={onClose} width={560} className="gap-4 p-7">
      <h2 className="text-[20px] font-extrabold">{t('pos.customer')}</h2>
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={150} />
        <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" error={needsName ? 'Give their name or e-mail address with the phone number.' : null} />
        <TextField label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={150} inputMode="email" error={badEmail ? 'That is not an e-mail address.' : null} />
        <p className="text-[12px] text-ink-3">WorkSuite matches the customer by e-mail, then by name; a new one is added to Sales & Orders.</p>
      </div>
      <div className="flex gap-2.5">
        <PosButton
          className="h-touch-lg w-48"
          onClick={() => {
            cartActions.customer(null);
            onClose();
          }}
        >
          {t('pos.walkIn')}
        </PosButton>
        <PosButton
          tone="primary"
          className="h-touch-lg flex-1 text-[16px]"
          disabled={badEmail || needsName}
          onClick={() => {
            cartActions.customer({ name: name.slice(0, 150), phone: phone.slice(0, 40), email: email.slice(0, 150) });
            onClose();
          }}
        >
          {t('pos.addCustomer')}
        </PosButton>
      </div>
    </PosDialog>
  );
}
