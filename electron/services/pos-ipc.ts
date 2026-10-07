import { BrowserWindow, type WebContents } from 'electron';
import type { PosPrintOutcome } from '@shared/pos';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { IpcRouter } from '../ipc/router';
import type { WindowManager } from '../windows/manager';
import type { Database } from './db';
import type { HttpClient } from './http';
import { PosCartsStore } from './pos-carts';
import { PosDesk } from './pos-desk';
import { closeDisplay, displayTouchSupport, isDisplayWindow, openDisplay, touchOf } from './pos-display';
import { mediaFor, PosDisplayMediaStore } from './pos-display-media';
import { PosPrint } from './pos-print';
import { PosTill } from './pos-till';
import { listPrinters } from './print';
import type { SecureStore } from './secure-store';
import type { Vault } from './vault';

const log = logger('pos');

/**
 * POS in the main process, in one place: the till (pos-desk.ts), its catalogue and sales (pos-till.ts), its printer
 * (pos-print.ts), the customer display (pos-display.ts) and the `pos:*` channels (shared/pos.ts). The app's entry point
 * makes it, registers it on the router and tells it about the session, reconnects and wipes.
 */
export interface PosDeps {
  db: Database;
  vault: () => Vault;
  secrets: Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix'>;
  http: Pick<HttpClient, 'request' | 'raw' | 'url'>;
  windows: Pick<WindowManager, 'open'>;
  origin: () => string | null;
  /** The signed-in person, as the cashier on a sale. */
  cashier: () => { id: number; name: string | null } | null;
  /** Whether the signed-in person may open POS (the app, through every gate). */
  allowed: () => boolean;
  caps: () => { offlineCache: boolean; offlineQueue: 'allowed' | 'drafts_only' | 'disabled' };
  installId: () => string;
  device: () => { name: string; info: string };
  appVersion: string;
  changed: () => void;
}

export function createPos(d: PosDeps) {
  const desk = new PosDesk({ secrets: d.secrets, http: d.http, origin: d.origin, installId: d.installId, device: d.device, appVersion: d.appVersion });
  const till = new PosTill({ db: d.db, vault: d.vault, http: d.http, desk, origin: d.origin, caps: d.caps, changed: d.changed, config: d.db });
  // The company's receipt template (the till's door), when one is published: ESC/POS follows it.
  const print = new PosPrint({ config: d.db, origin: d.origin, template: () => till.template() });
  const scopeOf = (origin: string | null, terminal: number | null | undefined) => (origin && terminal ? `${origin}|${terminal}` : null);
  const carts = new PosCartsStore({ config: d.db, vault: d.vault, scope: () => scopeOf(d.origin(), desk.pairing()?.terminal.id), keep: () => {
      try {
        return d.caps().offlineCache;
      } catch {
        return false;
      }
    },
  });

  // The customer display's promotions and logo (#294), kept like the catalogue: sealed where the policy allows.
  const media = new PosDisplayMediaStore({ db: d.db, vault: d.vault, desk, origin: d.origin, keep: () => d.caps().offlineCache });

  const guard = (): void => {
    if (!d.allowed()) throw new DesktopError('APP_ACCESS_DENIED', "You don't have access to POS.");
  };
  const installed = async (sender: WebContents) => (await listPrinters(BrowserWindow.fromWebContents(sender))).map((p) => p.name);
  const tillName = () => desk.pairing()?.terminal.name ?? null;
  /** What a receipt by the company's template says of the till: its company and code. */
  const tillOf = () => ({ till: tillName(), company: desk.pairing()?.terminal.org_name ?? null, code: desk.pairing()?.terminal.code ?? null });

  function register(router: IpcRouter): void {
    router.handle('pos:till', () => till.status());
    router.handle('pos:pair', async (input) => {
      guard();
      const before = desk.pairing();
      const origin = d.origin();
      // Pairing this computer with ANOTHER till would strand what the first one has not sent (its credential goes).
      if (before && before.terminal.id !== input.terminal_id && till.pending() > 0) {
        throw new DesktopError('CONFLICT', `${till.pending()} sale(s) from ${before.terminal.name} have not reached WorkSuite yet. Send them, or forget this till, before pairing another.`);
      }
      const r = await desk.pair(input.terminal_id, input.take_over === true, input.device_name);
      if (before && origin && before.terminal.id !== input.terminal_id) {
        till.forgetTill(origin, before.terminal.id);
        carts.forget(scopeOf(origin, before.terminal.id)!);
        media.forget(origin, before.terminal.id);
      }
      d.changed();
      void till.sync();
      return { status: till.status(), message: r.message };
    });
    router.handle('pos:forget', async (input) => {
      const p = desk.pairing();
      const origin = d.origin();
      if (!p || !origin) return till.status();
      const pending = till.pending();
      if (pending > 0 && input?.discard !== true) {
        throw new DesktopError('CONFLICT', `${pending} sale(s) have not reached WorkSuite yet. Forgetting the till drops them.`);
      }
      // Phase 2 (`capabilities.device_unpair`): the till handed back on the server too, so it is free to pair again.
      if (input?.unpair) await till.unpair();
      till.forgetTill(origin, p.terminal.id);
      carts.forget(scopeOf(origin, p.terminal.id)!);
      media.forget(origin, p.terminal.id);
      desk.forget();
      d.changed();
      return till.status();
    });
    router.handle('pos:catalogue', () => {
      guard();
      return till.catalogue();
    });
    router.handle('pos:catalogueRefresh', (input) => {
      guard();
      // The display's promotions are read again with the catalogue (#294).
      media.maybeRefresh(true);
      return till.refreshCatalogue(input?.capable);
    });
    router.handle('pos:sell', async (input, c) => {
      guard();
      const cashier = d.cashier();
      if (!cashier) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to sell.');
      const r = await till.sell(input, cashier);
      // A manager's approval is needed first: nothing was sold, nothing is printed.
      if ('needs' in r) return r;
      const cash = r.sale.tenders.some((t) => t.method === 'cash');
      let printed: PosPrintOutcome | null = null;
      try {
        if (print.settings().auto_print) printed = await print.receipt(r.sale, await installed(c.sender), { ...tillOf(), kick: cash });
        else if (cash && print.settings().drawer === 'printer') printed = await print.drawer(await installed(c.sender));
      } catch (e) {
        // The sale stands whatever the printer does; the screen offers a reprint.
        log.warn('pos receipt not printed', { error: String((e as Error)?.message ?? e) });
        printed = { ok: false, printer: print.settings().receipt_printer, message: 'The receipt could not be printed. Reprint it from Sales.' };
      }
      return { ...r, printed };
    });
    router.handle('pos:sales', (input) => till.sales(input ?? {}));
    router.handle('pos:sale', (input) => till.sale(input.ref));
    router.handle('pos:syncNow', () => till.sync());
    router.handle('pos:resolve', (input) => {
      guard();
      return till.resolve(input.ref, input.action, input.session_id);
    });
    router.handle('pos:printSettings', () => print.settings());
    router.handle('pos:printSettingsSet', async (input, c) => print.update(input, await installed(c.sender)));
    router.handle('pos:printReceipt', async (input, c) => {
      const sale = till.sale(input.ref);
      if (!sale) throw new DesktopError('NOT_FOUND', 'That sale is not on this till.');
      const printers = await installed(c.sender);
      const reprint = input.reprint !== false;
      // WorkSuite's receipt where it has one (its figures, refunds, a void); the till's own record otherwise.
      if (input.server && sale.state === 'sent') {
        const r = await till.serverReceipt(sale.ref).catch((e: unknown) => {
          log.info('pos server receipt unavailable, printing the till’s own', { error: String((e as Error)?.message ?? e) });
          return null;
        });
        if (r) return print.serverReceipt(r, printers, { till: tillName(), reprint });
      }
      return print.receipt(sale, printers, { ...tillOf(), reprint });
    });
    router.handle('pos:receipt', async (input) => {
      guard();
      const sale = till.sale(input.ref);
      if (!sale || sale.state !== 'sent') return null;
      return till.serverReceipt(sale.ref);
    });
    router.handle('pos:giveBack', async (input) => {
      guard();
      const cashier = d.cashier();
      if (!cashier) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to refund or void a sale.');
      return till.giveBack(input, cashier);
    });
    router.handle('pos:email', async (input) => {
      guard();
      return till.email(input.ref, input.email);
    });
    router.handle('pos:printReport', async (input, c) => print.report(input, await installed(c.sender)));
    router.handle('pos:printTest', async (_i, c) => print.test(await installed(c.sender)));
    router.handle('pos:openDrawer', async (_i, c) => {
      guard();
      return print.drawer(await installed(c.sender));
    });
    router.handle('pos:displayOpen', () => {
      guard();
      return openDisplay(d.windows);
    });
    router.handle('pos:displayClose', () => closeDisplay());
    // The customer display's own window only (#294): pictures and whether its screen takes touch — nothing of a sale.
    router.handle('pos:displayMedia', async (_i, c) => {
      if (!isDisplayWindow(c.sender)) throw new DesktopError('PERMISSION_DENIED', 'Only the customer display reads this.');
      guard();
      // Nothing kept yet (a till's first display): read it now; otherwise in the background, every half hour.
      const kept = media.kept() ?? (await media.refresh());
      media.maybeRefresh();
      return mediaFor(kept, touchOf(print.settings().display_touch, displayTouchSupport()));
    });
    router.handle('pos:carts', () => {
      guard();
      return carts.read();
    });
    router.handle('pos:cartsSave', (input) => {
      guard();
      return carts.save(input);
    });
    router.handle('pos:desk', (input) => {
      guard();
      return till.desk(input, d.cashier());
    });
    router.handle('pos:approve', (input) => {
      guard();
      const cashier = d.cashier();
      if (!cashier) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to ask for a manager’s approval.');
      return till.approve(input, cashier);
    });
    router.handle('pos:rename', (input) => {
      guard();
      return till.rename(input.device_name);
    });
  }

  return {
    desk,
    till,
    print,
    media,
    register,
    start: () => till.start(),
    stop: () => till.stop(),
    sync: () => void till.sync(),
    pending: () => till.pending(),
    /** A wipe: the till's credential, its copy, its sales and its printer settings. */
    forgetAll: () => {
      desk.forgetAll();
      till.forgetAll();
      print.forgetAll();
      carts.forgetAll();
      media.forgetAll();
    },
  };
}

export type PosService = ReturnType<typeof createPos>;
