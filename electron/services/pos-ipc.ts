import { BrowserWindow, type WebContents } from 'electron';
import type { PosPrintOutcome } from '@shared/pos';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { IpcRouter } from '../ipc/router';
import type { WindowManager } from '../windows/manager';
import type { Database } from './db';
import type { HttpClient } from './http';
import { PosDesk } from './pos-desk';
import { closeDisplay, openDisplay } from './pos-display';
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
  const till = new PosTill({ db: d.db, vault: d.vault, http: d.http, desk, origin: d.origin, caps: d.caps, changed: d.changed });
  const print = new PosPrint({ config: d.db, origin: d.origin });

  const guard = (): void => {
    if (!d.allowed()) throw new DesktopError('APP_ACCESS_DENIED', "You don't have access to POS.");
  };
  const installed = async (sender: WebContents) => (await listPrinters(BrowserWindow.fromWebContents(sender))).map((p) => p.name);
  const tillName = () => desk.pairing()?.terminal.name ?? null;

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
      const r = await desk.pair(input.terminal_id, input.take_over === true);
      if (before && origin && before.terminal.id !== input.terminal_id) till.forgetTill(origin, before.terminal.id);
      d.changed();
      void till.sync();
      return { status: till.status(), message: r.message };
    });
    router.handle('pos:forget', (input) => {
      const p = desk.pairing();
      const origin = d.origin();
      if (!p || !origin) return till.status();
      const pending = till.pending();
      if (pending > 0 && input?.discard !== true) {
        throw new DesktopError('CONFLICT', `${pending} sale(s) have not reached WorkSuite yet. Forgetting the till drops them.`);
      }
      till.forgetTill(origin, p.terminal.id);
      desk.forget();
      d.changed();
      return till.status();
    });
    router.handle('pos:catalogue', () => {
      guard();
      return till.catalogue();
    });
    router.handle('pos:catalogueRefresh', () => {
      guard();
      return till.refreshCatalogue();
    });
    router.handle('pos:sell', async (input, c) => {
      guard();
      const cashier = d.cashier();
      if (!cashier) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to sell.');
      const r = await till.sell(input, cashier);
      const cash = r.sale.tenders.some((t) => t.method === 'cash');
      let printed: PosPrintOutcome | null = null;
      try {
        if (print.settings().auto_print) printed = await print.receipt(r.sale, await installed(c.sender), { till: tillName(), kick: cash });
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
      return till.resolve(input.ref, input.action);
    });
    router.handle('pos:printSettings', () => print.settings());
    router.handle('pos:printSettingsSet', async (input, c) => print.update(input, await installed(c.sender)));
    router.handle('pos:printReceipt', async (input, c) => {
      const sale = till.sale(input.ref);
      if (!sale) throw new DesktopError('NOT_FOUND', 'That sale is not on this till.');
      return print.receipt(sale, await installed(c.sender), { till: tillName(), reprint: input.reprint !== false });
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
  }

  return {
    desk,
    till,
    print,
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
    },
  };
}

export type PosService = ReturnType<typeof createPos>;
