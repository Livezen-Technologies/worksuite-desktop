import { BrowserWindow, net } from 'electron';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { IpcRouter } from '../../ipc/router';
import { listPrinters } from '../print';
import type { HttpClient } from '../http';
import type { SecureStore } from '../secure-store';
import { fileSecrets, PrintGateway, type DeviceSecrets } from './gateway';
import { LabelHost } from './host';

/**
 * Label Studio on this computer (WS-LABEL-SRS-001 FR-DSK, FR-GWY): the print host for the signed-in person
 * (host.ts) and the Print Gateway (gateway.ts), both over CorePrintService (core-print.ts), made together so
 * electron/main/index.ts wires one thing. The renderer reaches them only through the `label:*` and `labelGateway:*`
 * channels below; it never sees a printer's bytes (FR-DSK-03).
 */
export interface LabelDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  http: HttpClient;
  secrets: Pick<SecureStore, 'get' | 'set' | 'delete' | 'getStatus'>;
  origin: () => string | null;
  /** Signed in, and may use Label Studio. */
  active: () => boolean;
  installId: () => string;
  userData: string;
  version: string;
  /** Started with `--print-gateway`. */
  headless: boolean;
  setHeadless: (on: boolean) => void;
  autostart: () => boolean;
  changed: (which: 'host' | 'gateway') => void;
}

export interface Label {
  host: LabelHost;
  gateway: PrintGateway;
  start(): void;
  stop(): void;
  forgetAll(): void;
  register(router: IpcRouter): void;
}

/** Printers need a webContents to be listed; a headless gateway has no window, so it borrows a hidden one. */
async function osPrinters() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  if (win) return listPrinters(win);
  const hidden = new BrowserWindow({ show: false, width: 10, height: 10, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    return await listPrinters(hidden);
  } finally {
    hidden.destroy();
  }
}

export function createLabel(d: LabelDeps): Label {
  const host = new LabelHost({
    config: d.config,
    http: d.http,
    origin: d.origin,
    active: d.active,
    installId: d.installId,
    computerName: () => hostname().slice(0, 80) || 'This computer',
    version: d.version,
    osPrinters,
    changed: () => d.changed('host'),
  });
  // The device key in the OS key store; with none (a headless Linux box), a file only this user reads (§16).
  const secrets: DeviceSecrets = d.secrets.getStatus().persistent
    ? { get: (n) => d.secrets.get(n), set: (n, v) => d.secrets.set(n, v), delete: (n) => d.secrets.delete(n), where: () => 'os' }
    : fileSecrets(join(d.userData, 'print-gateway', 'device.json'));
  const gateway = new PrintGateway({
    config: d.config,
    secrets,
    fetch: (url, init) => net.fetch(url, init as RequestInit),
    // The gateway hosts this computer's own printers: the OS queues and the LAN printers added in D04.
    localPrinters: async () => (d.origin() ? host.printers() : (await osPrinters()).map((p) => ({ key: `os:${p.name}`, name: p.displayName, connection: 'spooler' as const, address: p.name, port: null, language: 'unknown' as const, isDefault: p.isDefault, serverId: null, approved: false, state: 'unknown' as const, stateAt: null, message: null }))),
    version: d.version,
    headless: d.headless,
    autostart: d.autostart,
    changed: () => d.changed('gateway'),
  });
  return {
    host,
    gateway,
    start() {
      host.start();
      gateway.start();
    },
    stop() {
      host.stop();
      gateway.stop();
    },
    forgetAll() {
      host.forgetAll();
    },
    register(router) {
      router.handle('label:listPrinters', () => host.printers());
      router.handle('label:send', (input) => host.core.send(input.job_id));
      router.handle('label:status', () => host.status());
      router.handle('label:cancel', (input) => host.core.cancel(input.job_id));
      router.handle('label:discover', () => host.discover());
      router.handle('label:settings', () => host.settings());
      router.handle('label:settingsSet', (input) => host.update(input));
      router.handle('label:register', () => host.register());
      router.handle('label:resolve', (input) => host.core.resolve(input.job_id, input.decision, input.last_printed));
      router.handle('labelGateway:status', () => gateway.status());
      router.handle('labelGateway:pair', (input) => gateway.pair(input));
      router.handle('labelGateway:unpair', () => gateway.unpair());
      router.handle('labelGateway:headless', (input) => {
        d.setHeadless(input.enabled);
        return gateway.status();
      });
    },
  };
}
