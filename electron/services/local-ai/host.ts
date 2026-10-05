import { app, net, utilityProcess, webContents } from 'electron';
import { join } from 'node:path';
import type { LocalAIEvent } from '@shared/local-ai';
import { logger } from '../../main/log';
import { createNetFetch } from '../net-fetch';
import type { IpcRouter } from '../../ipc/router';
import { LocalAIModelManager } from './models';
import type { FromWorker } from './protocol';
import { LocalAIRuntime, type WorkerLink } from './runtime';

const log = logger('local-ai');

/**
 * Where the signed model catalog lives on WorkSuite's CDN (LAI-MOD-001) — asked only when the signed-in server has
 * no catalog of its own (`/api/ai/local/catalog`, AI Studio's models) and a key is pinned below. `WS_LOCAL_AI_CATALOG` points a
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
  /** `GET /api/ai/local/catalog` on the signed-in WorkSuite server: AI Studio's models, as files to download. */
  serverCatalog?: () => Promise<unknown>;
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
  const keys = { ...LOCAL_AI_CATALOG_KEYS, ...dev.keys };
  const safeFetch = createNetFetch((o) => net.request(o));
  const models = new LocalAIModelManager({
    root,
    serverCatalog: deps.serverCatalog
      ? () => (deps.signedIn() ? deps.serverCatalog!() : Promise.reject(new Error('Sign in to WorkSuite to see the models you can download.')))
      : undefined,
    // With no key pinned nothing the CDN sent could be trusted, so it is not asked: the page says on-device
    // models are not set up, and the assistant answers through WorkSuite (AI Studio) instead.
    catalogUrl: () => dev.url ?? (Object.keys(keys).length ? LOCAL_AI_CATALOG_URL : null),
    keys,
    // Not `net.fetch`: a response header in UTF-8 must fail this download, never the main process (#253).
    fetch: (url, init) => safeFetch(url, { ...init, cache: 'no-store' }),
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

  /**
   * The readiness check (worksuite-desktop#55): a model that downloaded and matched its checksum is loaded and asked
   * for a word before it is shown as ready — a file this llama.cpp cannot run fails here, with its reason, rather
   * than on the person's first question.
   */
  const test = async (id: string): Promise<boolean> => {
    if (!(await models.path(id))) return false;
    models.testStarted(id);
    try {
      await runtime.probe(id);
      await models.testEnded(id, null);
      return true;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log.warn('local ai model did not pass its readiness check', { id, error: why });
      await models.testEnded(id, why);
      return false;
    }
  };

  let refreshed = false;
  const refreshOnce = (): void => {
    if (refreshed) return;
    // Before sign-in the server's catalog cannot be asked; the first look after it does.
    refreshed = deps.signedIn() || !deps.serverCatalog;
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
        // The download goes on after this answers; its progress and outcome come as `ai:localChanged`. Once it is in
        // place and matches, it is loaded and tried before it shows as ready.
        void models
          .install(input.id)
          .then(() => test(input.id))
          .catch((e) => log.warn('local ai model not installed', { id: input.id, error: String(e) }));
      });
      router.handle('ai:localCancelInstall', (input) => models.cancel(input.id, !!input.discard));
      router.handle('ai:localRemove', async (input) => {
        if (runtime.status(models.catalogState(), null).loaded === input.id) await runtime.stop();
        await models.remove(input.id);
      });
      router.handle('ai:localSetDefault', (input) => models.setDefault(input.id));
      router.handle('ai:localCheck', (input) => models.check(input.id));
      router.handle('ai:localTest', async (input) => {
        await ready;
        return test(input.id);
      });
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
