import { app, net, utilityProcess, webContents } from 'electron';
import { join } from 'node:path';
import type { LocalAIEvent } from '@shared/local-ai';
import { logger } from '../../main/log';
import type { IpcRouter } from '../../ipc/router';
import { LocalAIModelManager } from './models';
import type { FromWorker } from './protocol';
import { LocalAIRuntime, type WorkerLink } from './runtime';

const log = logger('local-ai');

/**
 * Where the signed model catalog lives on WorkSuite's CDN (LAI-MOD-001). `WS_LOCAL_AI_CATALOG` points a
 * development or staging build at another one; a packaged build uses this address only.
 */
export const LOCAL_AI_CATALOG_URL = 'https://cdn.worksuite.app/local-ai/v1/catalog.json';

/**
 * The Ed25519 keys (SPKI, base64 DER) a catalog may be signed with, by key id (LAI-MOD-002). A new key ships in
 * an app update before the CDN starts using it; `scripts/local-ai-catalog.mjs keygen` makes one. The private key
 * never enters this repository.
 */
export const LOCAL_AI_CATALOG_KEYS: Record<string, string> = {};

export interface LocalAIHostDeps {
  userData: string;
  signedIn: () => boolean;
  /** `ai:localChanged` to every window: models, downloads and the runtime's state. */
  changed: () => void;
}

export interface LocalAIHost {
  register(router: IpcRouter): void;
  senderGone(id: number): void;
  /** Sign-out: the model stops; the model files stay (they are not the person's data). */
  signedOut(): Promise<void>;
  stop(): Promise<void>;
}

function spawnWorker(): WorkerLink {
  const proc = utilityProcess.fork(join(__dirname, 'local-ai-worker.js'), [], { serviceName: 'WorkSuite Local AI', stdio: 'ignore' });
  return {
    post: (m) => proc.postMessage(m),
    onMessage: (cb) => proc.on('message', (m: FromWorker) => cb(m)),
    onExit: (cb) => proc.on('exit', (code) => cb(code)),
    kill: () => void proc.kill(),
  };
}

function devOverrides(): { url: string | null; keys: Record<string, string> } {
  if (app.isPackaged) return { url: null, keys: {} };
  const url = process.env.WS_LOCAL_AI_CATALOG?.trim() || null;
  const key = process.env.WS_LOCAL_AI_CATALOG_KEY?.trim();
  return { url, keys: key ? { dev: key } : {} };
}

export function createLocalAI(deps: LocalAIHostDeps): LocalAIHost {
  const root = join(deps.userData, 'LocalAI', 'models');
  const dev = devOverrides();
  let changeTimer: NodeJS.Timeout | null = null;
  // Downloads report often; the windows hear about it at most every 250 ms.
  const changed = (): void => {
    if (changeTimer) return;
    changeTimer = setTimeout(() => {
      changeTimer = null;
      deps.changed();
    }, 250);
  };
  const models = new LocalAIModelManager({
    root,
    catalogUrl: () => dev.url ?? LOCAL_AI_CATALOG_URL,
    keys: { ...LOCAL_AI_CATALOG_KEYS, ...dev.keys },
    fetch: (url, init) => net.fetch(url, { ...init, cache: 'no-store' }),
    onChange: changed,
  });
  const ready = models.init().catch((e) => log.warn('local ai models not read', { error: String(e) }));
  const runtime = new LocalAIRuntime({
    spawn: spawnWorker,
    models,
    modelsRoot: root,
    emit: (sender, ev: LocalAIEvent) => {
      const wc = webContents.fromId(sender);
      if (wc && !wc.isDestroyed()) wc.send('ai:localEvent', ev);
    },
    onChange: changed,
  });

  let refreshed = false;
  const refreshOnce = (): void => {
    if (refreshed) return;
    refreshed = true;
    void models.refresh().catch(() => undefined);
  };

  return {
    register(router) {
      router.handle('ai:localStatus', async () => {
        await ready;
        refreshOnce();
        return runtime.status(models.catalogState(), await runtime.hardware());
      });
      router.handle('ai:localModels', async () => {
        await ready;
        refreshOnce();
        return models.list(await runtime.hardware());
      });
      router.handle('ai:localRefresh', async () => {
        await ready;
        await models.refresh();
      });
      router.handle('ai:localInstall', async (input) => {
        await ready;
        // The download goes on after this answers; its progress and outcome come as `ai:localChanged`.
        void models.install(input.id).catch((e) => log.warn('local ai model not installed', { id: input.id, error: String(e) }));
      });
      router.handle('ai:localCancelInstall', (input) => models.cancel(input.id, !!input.discard));
      router.handle('ai:localRemove', async (input) => {
        if (runtime.status(models.catalogState(), null).loaded === input.id) await runtime.stop();
        await models.remove(input.id);
      });
      router.handle('ai:localSetDefault', (input) => models.setDefault(input.id));
      router.handle('ai:localCheck', (input) => models.check(input.id));
      router.handle('ai:localAsk', async (input, c) => {
        await ready;
        await runtime.ask(c.sender.id, input);
      });
      router.handle('ai:localCancel', (input) => runtime.cancel(input.id));
      router.handle('ai:localRestart', () => runtime.reset());
    },
    senderGone: (id) => runtime.senderGone(id),
    async signedOut() {
      await runtime.stop();
    },
    async stop() {
      if (changeTimer) clearTimeout(changeTimer);
      await runtime.stop();
    },
  };
}
