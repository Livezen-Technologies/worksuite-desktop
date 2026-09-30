import { BrowserWindow } from 'electron';
import type { IpcRouter } from '../../ipc/router';
import type { Database } from '../db';
import { listPrinters } from '../print';
import type { HttpClient } from '../http';
import type { SecureStore } from '../secure-store';
import type { Vault } from '../vault';
import { RestaurantPrintAgent } from './print-agent';
import { RestaurantSync } from './sync';
import { RestaurantTerminal } from './terminal';

/**
 * Restaurant Manager on this computer: the paired terminal and its key
 * (terminal.ts), the copy and the outbox (sync.ts), and the print agent
 * (print-agent.ts), made together so electron/main/index.ts wires one thing.
 */
export interface RestaurantDeps {
  db: Database;
  vault: () => Vault;
  http: HttpClient;
  secrets: Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix'>;
  origin: () => string | null;
  /** The signed-in person, when they may use the Restaurant app. */
  user: () => string | null;
  caps: () => { offlineCache: boolean; offlineQueue: 'allowed' | 'drafts_only' | 'disabled' };
  appVersion: string;
  notify: (n: { id: string; title: string; body: string; link: string }) => void;
  changed: () => void;
}

export interface Restaurant {
  terminal: RestaurantTerminal;
  sync: RestaurantSync;
  print: RestaurantPrintAgent;
  start(): void;
  stop(): void;
  /** The key header for a Restaurant API path the proxy forwards, or null. */
  headers(path: string): Record<string, string> | null;
  signedOut(user: string): void;
  forgetAll(): void;
  /** The `restaurant:*` IPC channels. */
  register(router: IpcRouter): void;
}

export function createRestaurant(d: RestaurantDeps): Restaurant {
  const terminal = new RestaurantTerminal(d.secrets, d.http, d.origin);
  /* The agent runs in the background: any of the app's windows can list the printers. */
  const anyWindow = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  const print: RestaurantPrintAgent = new RestaurantPrintAgent({
    config: d.db,
    http: d.http,
    origin: d.origin,
    terminal: () => terminal.pairing(),
    terminalKey: () => terminal.key(),
    active: () => d.user() !== null,
    installed: async () => (await listPrinters(anyWindow())).map((p) => p.name),
    changed: d.changed,
  });
  const sync = new RestaurantSync({
    db: d.db,
    vault: d.vault,
    http: d.http,
    origin: d.origin,
    user: d.user,
    terminal: () => terminal.pairing(),
    terminalKey: () => terminal.key(),
    caps: d.caps,
    appVersion: d.appVersion,
    printers: () => print.printers(),
    agent: () => print.status(),
    notify: d.notify,
    changed: d.changed,
  });
  return {
    terminal,
    sync,
    print,
    start() {
      sync.start();
      print.start();
    },
    stop() {
      sync.stop();
      print.stop();
    },
    headers(path) {
      const key = terminal.keyFor(path);
      return key ? { 'X-Terminal-Key': key } : null;
    },
    signedOut(user) {
      sync.signedOut(user);
    },
    forgetAll() {
      terminal.forgetAll();
      sync.forgetAll();
      print.forgetAll();
    },
    register(router) {
      const installed = async (sender: Electron.WebContents) => (await listPrinters(BrowserWindow.fromWebContents(sender))).map((p) => p.name);
      router.handle('restaurant:pairing', () => terminal.pairing());
      router.handle('restaurant:pair', async (input) => {
        const r = await terminal.pair(input);
        void sync.sync();
        void print.tick();
        d.changed();
        return r;
      });
      router.handle('restaurant:unpair', async (input) => {
        const origin = d.origin();
        const t = terminal.pairing();
        const dropped = origin && t ? sync.forgetTerminal(origin, t.terminal_id, input.discard === true) : 0;
        const r = await terminal.unpair(input.revoke === true);
        d.changed();
        return { ...r, dropped };
      });
      router.handle('restaurant:status', () => sync.status());
      router.handle('restaurant:syncNow', () => sync.sync());
      router.handle('restaurant:copy', () => sync.copy());
      router.handle('restaurant:outbox', () => sync.outbox());
      router.handle('restaurant:outboxAdd', (input) => sync.add(input));
      router.handle('restaurant:outboxResolve', (input) => sync.resolve(input.id, input.action));
      router.handle('restaurant:printSettings', () => print.settings());
      router.handle('restaurant:printSettingsSet', async (input, c) => {
        const next = print.update(input, await installed(c.sender));
        /* A printer just mapped prints what already waits for it. */
        if (next.agent) void print.tick();
        return next;
      });
      router.handle('restaurant:printJobs', () => print.jobs());
      router.handle('restaurant:printNow', () => print.tick());
      router.handle('restaurant:printTest', async (input, c) => print.test(input.printer_id, await installed(c.sender)));
      router.handle('restaurant:printText', async (input, c) => print.text(input.text, input.printer_id ?? null, input.copies ?? 1, await installed(c.sender)));
      router.handle('restaurant:openDrawer', async (_i, c) => print.drawer(await installed(c.sender)));
    },
  };
}
