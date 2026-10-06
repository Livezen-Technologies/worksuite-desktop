import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PosProduct } from '@shared/pos';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button, TextField } from '../../components/ui';
import { toast } from '../../core/toasts';
import { customerOf, findInCatalogue, lookupProduct, openDrawer, PK, refreshCatalogue, useCartPrice, useCatalogue, useSales } from './api';
import { useBarcodeScanner } from './barcode';
import CartPane from './CartPane';
import CashMove from './CashMove';
import { activeSale, cartActions, discountPct, MAX_OPEN, useCart, useCarts, type CartState } from './cart';
import CategoryPicker from './CategoryPicker';
import { publish } from './display';
import { useT } from './i18n';
import { BigAmount, Keypad } from './Keypad';
import { press } from './keypad';
import { HeldDialog, HoldDialog, OpenSalesDialog } from './OpenSales';
import { clampPage, GRID_PAGE, LIST_PAGE, pushRecent } from './paging';
import { Note, PosButton, PosDialog, useTillContext } from './parts';
import { estimateCart } from './pricing';
import ProductGrid, { type GridView, type QuickAction } from './ProductGrid';
import ReturnDialog from './ReturnDialog';
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

type Dialog = 'customer' | 'discount' | 'category' | 'open' | 'held' | 'hold' | 'cash' | 'return' | null;

export default function Register({ active }: { active: boolean }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const catalogue = useCatalogue();
  const cart = useCart();
  const all = useCarts();
  const [q, setQ] = useState('');
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
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const today = useSales({ since }, dialog === 'category');

  /** What a sale not on screen comes to: the catalogue's preview. */
  const totalOf = useCallback(
    (c: CartState) => (c.lines.length ? estimateCart(c.lines, byId, discountPct(c, till.discount.allowed, till.discount.ceiling), till.discount.ceiling, currency).cart.total : 0),
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
  useBarcodeScanner(active && !paying && !dialog, (code) => void onScan(code));

  // The customer display follows the sale on screen.
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
  const size = view === 'grid' ? GRID_PAGE : LIST_PAGE;
  const where = JSON.stringify([q, category, view]);
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
  const recentShown = useMemo(() => recent.filter((c) => catalogue.data?.categories.includes(c) || products.some((p) => p.category === c)), [recent, catalogue.data, products]);

  const canSell = !!till.company?.can.sell;
  const payable = !!session && canSell && !!price.cart && !price.error && !price.pending && cart.lines.length > 0;

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

  const sale = activeSale(all);
  const actions: QuickAction[] = [
    { id: 'hold', label: t('pos.hold'), icon: 'pause', disabled: !cart.lines.length, onClick: () => setDialog('hold') },
    { id: 'recall', label: all.held.length ? t('pos.recallN', { n: all.held.length }) : t('pos.recall'), icon: 'history', onClick: () => setDialog('held') },
    { id: 'return', label: t('pos.return'), icon: 'undo', onClick: () => setDialog('return') },
    { id: 'discount', label: t('pos.discountShort'), icon: 'tag', disabled: !till.discount.allowed || !cart.lines.length, title: till.discount.allowed ? undefined : t('pos.noDiscountRight'), onClick: () => setDialog('discount') },
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

  const empty = !catalogue.data ? (
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
            const exact = findInCatalogue(products, q);
            const only = filtered.length === 1 ? filtered[0] : null;
            const hit = exact ?? only;
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
      {dialog === 'customer' ? <CustomerForm onClose={() => setDialog(null)} /> : null}
      {dialog === 'discount' ? <DiscountDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'hold' ? <HoldDialog id={sale.id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'held' ? <HeldDialog totalOf={totalOf} onClose={() => setDialog(null)} /> : null}
      {dialog === 'open' ? <OpenSalesDialog totalOf={totalOf} onClose={() => setDialog(null)} /> : null}
      {dialog === 'category' && catalogue.data ? (
        <CategoryPicker
          categories={catalogue.data.categories}
          products={products}
          sales={today.data ?? []}
          current={category}
          onPick={pickCategory}
          onAdd={(p) => add(p.id)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** The cashier's discount on the sale on screen, in percent, typed on the pad — never past their ceiling. */
function DiscountDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const cart = useCart();
  const [typed, setTyped] = useState(cart.discount);
  const ceiling = till.discount.ceiling;
  const apply = () => {
    cartActions.discount(typed, ceiling);
    onClose();
  };
  return (
    <PosDialog label={t('pos.discountTitle')} onClose={onClose} width={640} className="gap-4 p-7">
      <div>
        <h2 className="text-[20px] font-extrabold">{t('pos.discountTitle')}</h2>
        <p className="text-[13px] text-ink-3">{ceiling ? t('pos.discountMax', { n: ceiling }) : t('pos.discountHint')}</p>
      </div>
      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-3">
          <BigAmount autoFocus value={typed} onChange={(v) => setTyped(v)} rules={{ decimals: 2, digits: 3 }} aria-label={t('pos.discount')} placeholder="0" />
          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 20].filter((n) => !ceiling || n <= ceiling).map((n) => (
              <PosButton key={n} className="h-touch-md flex-1 text-[16px]" onClick={() => setTyped(String(n))}>
                {n}%
              </PosButton>
            ))}
          </div>
          <PosButton tone="danger" className="h-touch-md" onClick={() => setTyped('')}>
            {t('pos.discountNone')}
          </PosButton>
        </div>
        <Keypad className="w-[260px]" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back']} onKey={(k) => setTyped((v) => press(v, k, { decimals: 2, digits: 3 }))} />
      </div>
      <div className="flex gap-2.5">
        <PosButton className="h-touch-lg w-40" onClick={onClose}>
          {t('pos.cancel')}
        </PosButton>
        <PosButton tone="primary" className="h-touch-lg flex-1 text-[16px]" onClick={apply}>
          {t('pos.discountApply', { n: Math.min(Number(typed) || 0, ceiling ?? 100) })}
        </PosButton>
      </div>
    </PosDialog>
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
