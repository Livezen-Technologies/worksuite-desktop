import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { PosLocalState, PosSellInput } from '@shared/pos';
import type { LocalProduct, OpenRegister, TillSettings } from '@shared/pos-local-sale';
import { call } from '../../../core/bridge';
import { Spinner } from '../../../components/ui';
import { useTab } from '../../../core/tab-context';
import { useLocalPos } from '../api';
import { TillContext, posRoute, type PosView } from '../parts';
import { catalogueFromLocal, saleFromLocal, sellToLocal, tillFromLocal } from './adapter';

/**
 * The counter, offline: the POS module's own Register screen, given a `Till` built from this computer's store
 * (adapter.ts) and its fetch-and-write calls pointed at `posLocal:*` for as long as this screen is mounted.
 *
 * Reusing the screen rather than copying it is the whole point — a change to the counter, the cart or the payment
 * panel reaches the offline till on the same day it reaches the server-backed one.
 */
const Register = lazy(() => import('../Register'));

export function OfflineRegister({ state, register, onDone }: { state: PosLocalState; register: OpenRegister; onDone: () => void }) {
  const { query, go } = useTab();
  const [settings, setSettings] = useState<TillSettings | null>(null);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  /** The products by their number, which is how a sale's lines name them. */
  const byNumber = useRef(new Map<number, LocalProduct>());

  useEffect(() => {
    void call('posLocal:settings').then(setSettings, () => undefined);
  }, []);

  /* While this screen is up, the module's own calls read and write this computer's till. */
  useEffect(() => {
    useLocalPos({
      catalogue: async () => {
        const list = await call('posLocal:products', {});
        setProducts(list);
        byNumber.current = new Map(list.map((p) => [p.n, p]));
        const s = settings ?? (await call('posLocal:settings').catch(() => null));
        return catalogueFromLocal(list, s);
      },
      sell: async (input: PosSellInput) => ({
        /* The panel wants the sale it just made, as a sale; nothing is queued and printing is phase 4. */
        sale: saleFromLocal(input, await call('posLocal:sell', sellToLocal(input, byNumber.current)), state.signedIn?.displayName ?? null),
        queued: false,
        printed: null,
      }),
      /* Phase 4 lists the day's sales here; until then the screen shows none rather than the server's. */
      sales: async () => [],
    });
    return () => useLocalPos(null);
  }, [settings]);

  const till = useMemo(
    () => tillFromLocal({ state, register, settings, params: query, go: (view: PosView, p) => go(posRoute(view, p)) }),
    [state, register, settings, query, go],
  );
  void products;
  void onDone;

  return (
    <TillContext.Provider value={till}>
      <Suspense fallback={<Spinner />}>
        <Register active />
      </Suspense>
    </TillContext.Provider>
  );
}
