import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localCatalogEnvelopeSchema, localCatalogSchema, type LocalAICatalog, type LocalAIHardware, type LocalModel, type LocalModelState, type LocalModelView } from '@shared/local-ai';

/**
 * LocalAIModelManager (LAI-MOD, LAI-DL, LAI-MGR), desktop.
 *
 * The catalog comes from the signed-in WorkSuite server — AI Studio's models, each pinned by size and SHA-256 —
 * or, from a server without one, from WorkSuite's CDN as an envelope: the catalog JSON exactly as signed, and an
 * Ed25519 signature by one of the keys pinned in this app, refused unless the signature holds and it has not
 * expired (LAI-MOD-002). The last good one is kept for offline use. A model is downloaded from the catalog's
 * https address into `<root>/<id>/<version>/model.gguf.part`, resumed where it stopped (HTTP Range, LAI-DL-003),
 * checked against the catalog's size and SHA-256 before it is renamed into place (LAI-DL-004), and never loaded
 * otherwise. The renderer never sees a path.
 */
export interface ModelManagerDeps {
  root: string;
  /**
   * The catalog from the WorkSuite server the person is signed in to (`GET /api/ai/local/catalog`): the models
   * the workspace offers on AI Studio, each with its file's address, size and SHA-256. Trusted as every other
   * answer from that server is — the authenticated session — and asked before the CDN. Absent, or answering
   * 404 (an older server, or switched off there), the CDN's signed catalog is used.
   */
  serverCatalog?: () => Promise<unknown>;
  catalogUrl: () => string | null;
  /** keyId → Ed25519 public key (SPKI, base64 DER). */
  keys: Record<string, string>;
  fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
  now?: () => number;
  onChange?: () => void;
}

interface Download {
  abort: AbortController;
  received: number;
  state: Extract<LocalModelState, 'downloading' | 'verifying'>;
  done: Promise<void>;
}

const FREE_SPACE_MARGIN = 512 * 1024 * 1024;

export class LocalAIModelManager {
  private catalog: LocalAICatalog | null = null;
  private catalogAt: string | null = null;
  private catalogError: string | null = null;
  private downloads = new Map<string, Download>();
  private failures = new Map<string, string>();
  private paused = new Set<string>();
  private settings: { defaultModel: string | null } = { defaultModel: null };

  constructor(private readonly deps: ModelManagerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private changed(): void {
    this.deps.onChange?.();
  }

  private dir(m: Pick<LocalModel, 'id' | 'version'>): string {
    return join(this.deps.root, m.id, m.version);
  }

  /** Reads what was kept: the last verified catalog and the settings. */
  async init(): Promise<void> {
    await mkdir(this.deps.root, { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(await readFile(join(this.deps.root, 'catalog.json'), 'utf8')) as { source?: unknown; catalog?: unknown };
      if (raw && raw.source === 'server') this.acceptServer(raw.catalog, false);
      else this.accept(raw, false);
    } catch {
      /* no catalog yet */
    }
    try {
      const s = JSON.parse(await readFile(join(this.deps.root, 'settings.json'), 'utf8')) as { defaultModel?: unknown };
      this.settings.defaultModel = typeof s.defaultModel === 'string' ? s.defaultModel : null;
    } catch {
      /* defaults */
    }
  }

  /** Checks an envelope: the signature by a pinned key, the catalog's shape and its expiry. */
  verify(raw: unknown): LocalAICatalog {
    const env = localCatalogEnvelopeSchema.parse(raw);
    const key = this.deps.keys[env.keyId];
    if (!key) throw new Error('The model catalog is signed by a key this app does not know.');
    const ok = verifySignature(null, Buffer.from(env.body, 'utf8'), createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(env.signature, 'base64'));
    if (!ok) throw new Error('The model catalog’s signature does not match: it was not published by WorkSuite, or it was changed.');
    const catalog = localCatalogSchema.parse(JSON.parse(env.body));
    if (Date.parse(catalog.expiresAt) <= this.now()) throw new Error('The model catalog has expired.');
    return catalog;
  }

  private accept(raw: unknown, fresh: boolean): void {
    this.catalog = this.verify(raw);
    this.catalogAt = fresh ? new Date(this.now()).toISOString() : (this.catalogAt ?? this.catalog.issuedAt);
    this.catalogError = null;
  }

  /** A catalog from the signed-in WorkSuite server: its shape and its expiry (the server is the trust, not a key). */
  private acceptServer(raw: unknown, fresh: boolean): void {
    const catalog = localCatalogSchema.parse(raw);
    if (Date.parse(catalog.expiresAt) <= this.now()) throw new Error('The model catalog has expired.');
    this.catalog = catalog;
    this.catalogAt = fresh ? new Date(this.now()).toISOString() : (this.catalogAt ?? catalog.issuedAt);
    this.catalogError = null;
  }

  /**
   * Asks the WorkSuite server for AI Studio's models. True when it answered with a catalog; false when there is
   * none to ask or it has none (404), so the CDN is tried. Anything else is reported and the kept catalog stays.
   */
  private async refreshFromServer(): Promise<boolean> {
    if (!this.deps.serverCatalog) return false;
    let got: unknown;
    try {
      got = await this.deps.serverCatalog();
    } catch (e) {
      if ((e as { status?: unknown })?.status === 404) return false;
      this.catalogError = e instanceof Error ? e.message : String(e);
      return true;
    }
    const body = got as { catalog?: unknown; problems?: Record<string, string> };
    try {
      this.acceptServer(body?.catalog, true);
      await writeFile(join(this.deps.root, 'catalog.json'), JSON.stringify({ source: 'server', catalog: body.catalog }), { mode: 0o600 });
      const problems = Object.entries(body.problems ?? {});
      if (!this.catalog?.models.length && problems.length) {
        this.catalogError = `None of AI Studio's models could be found to download — ${problems.map(([n, why]) => `${n}: ${why}`).join('; ')}`;
      }
    } catch (e) {
      this.catalogError = e instanceof Error ? e.message : String(e);
    }
    return true;
  }

  /** Fetches the catalog — from the WorkSuite server, else the CDN; on any failure the kept one stays and the reason is reported. */
  async refresh(): Promise<void> {
    if (await this.refreshFromServer()) {
      this.changed();
      return;
    }
    const url = this.deps.catalogUrl();
    if (!url) {
      this.catalogError = 'Your WorkSuite server does not offer models to download yet. The assistant still answers through WorkSuite.';
      this.changed();
      return;
    }
    try {
      const res = await this.deps.fetch(url);
      if (!res.ok) throw new Error(`The model catalog could not be fetched (${res.status}).`);
      const raw = (await res.json()) as unknown;
      this.accept(raw, true);
      await writeFile(join(this.deps.root, 'catalog.json'), JSON.stringify(raw), { mode: 0o600 });
    } catch (e) {
      this.catalogError = e instanceof Error ? e.message : String(e);
    }
    this.changed();
  }

  catalogState(): { at: string | null; error: string | null } {
    return { at: this.catalogAt, error: this.catalogError };
  }

  private find(id: string): LocalModel {
    const m = this.catalog?.models.find((x) => x.id === id);
    if (!m) throw new Error('That model is not in the catalog.');
    return m;
  }

  private async installed(m: LocalModel): Promise<boolean> {
    return !!(await stat(join(this.dir(m), 'model.gguf')).catch(() => null));
  }

  private async partial(m: LocalModel): Promise<number> {
    return (await stat(join(this.dir(m), 'model.gguf.part')).catch(() => null))?.size ?? 0;
  }

  /** Every catalog model with its state on this computer, and whether it suits it (LAI-MGR-001, LAI-HW-003). */
  async list(hw: LocalAIHardware | null): Promise<LocalModelView[]> {
    const out: LocalModelView[] = [];
    for (const model of this.catalog?.models ?? []) {
      const d = this.downloads.get(model.id);
      const isInstalled = !d && (await this.installed(model));
      const part = d ? d.received : await this.partial(model);
      const state: LocalModelState = d ? d.state : isInstalled ? 'installed' : this.failures.has(model.id) ? 'failed' : part > 0 ? 'paused' : 'available';
      const fits = !hw || (model.tiers.includes(hw.tier) && model.minMemoryBytes <= Math.max(hw.memoryBytes, hw.vramBytes));
      out.push({ model, state, received: state === 'installed' ? model.bytes : part, error: this.failures.get(model.id) ?? null, fits, recommended: !!hw && model.recommendedFor.includes(hw.tier), isDefault: this.settings.defaultModel === model.id });
    }
    return out;
  }

  /** Downloads a model, resuming a partial file, then verifies it (resolves once it is installed). */
  install(id: string): Promise<void> {
    const m = this.find(id);
    const running = this.downloads.get(id);
    if (running) return running.done;
    this.failures.delete(id);
    this.paused.delete(id);
    const abort = new AbortController();
    const d: Download = { abort, received: 0, state: 'downloading', done: Promise.resolve() };
    d.done = this.fetchModel(m, d)
      .catch(async (e: unknown) => {
        if (abort.signal.aborted) return;
        this.failures.set(id, e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        this.downloads.delete(id);
        this.changed();
      });
    this.downloads.set(id, d);
    this.changed();
    return d.done;
  }

  private async fetchModel(m: LocalModel, d: Download): Promise<void> {
    const dir = this.dir(m);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const part = join(dir, 'model.gguf.part');
    let have = await this.partial(m);
    if (have > m.bytes) {
      await rm(part, { force: true });
      have = 0;
    }
    // Room for the rest, and some to spare (LAI-DL-006).
    const fs = await statfs(dir).catch(() => null);
    if (fs && fs.bavail * fs.bsize < m.bytes - have + FREE_SPACE_MARGIN) throw new Error(`Not enough free space: ${m.name} needs ${Math.ceil((m.bytes - have) / 1024 ** 2)} MB more.`);
    if (have < m.bytes) {
      const res = await this.deps.fetch(m.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: d.abort.signal });
      if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
      // A server that ignores the range sends the whole file: start again from the beginning.
      if (have && res.status !== 206) have = 0;
      d.received = have;
      const out = createWriteStream(part, { flags: have ? 'a' : 'w', mode: 0o600 });
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
          d.received += value.byteLength;
          if (d.received > m.bytes) throw new Error('The download is larger than the catalog says.');
          this.changed();
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
    }
    d.state = 'verifying';
    this.changed();
    const size = (await stat(part)).size;
    const sha = await sha256(part);
    if (size !== m.bytes || sha !== m.sha256) {
      await rm(part, { force: true });
      throw new Error('The downloaded model does not match the catalog, so it was not installed.');
    }
    await rename(part, join(dir, 'model.gguf'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...m, installedAt: new Date(this.now()).toISOString() }, null, 1), { mode: 0o600 });
    if (!this.settings.defaultModel && m.purpose === 'chat') await this.setDefault(m.id);
  }

  /** Stops a download, keeping what came (resumed later); `discard` removes it. */
  async cancel(id: string, discard = false): Promise<void> {
    const d = this.downloads.get(id);
    if (d) {
      d.abort.abort();
      await d.done;
    }
    if (discard) await rm(join(this.deps.root, id), { recursive: true, force: true });
    else this.paused.add(id);
    this.changed();
  }

  async remove(id: string): Promise<void> {
    await this.cancel(id, true);
    this.failures.delete(id);
    if (this.settings.defaultModel === id) await this.setDefault(null);
    this.changed();
  }

  /** Checks an installed model's file against the catalog again (LAI-MGR-004). */
  async check(id: string): Promise<boolean> {
    const m = this.find(id);
    const p = join(this.dir(m), 'model.gguf');
    const ok = (await stat(p).catch(() => null))?.size === m.bytes && (await sha256(p)) === m.sha256;
    if (!ok) this.failures.set(id, 'The installed file no longer matches the catalog. Remove it and download it again.');
    this.changed();
    return ok;
  }

  async setDefault(id: string | null): Promise<void> {
    if (id) this.find(id);
    this.settings.defaultModel = id;
    await writeFile(join(this.deps.root, 'settings.json'), JSON.stringify(this.settings), { mode: 0o600 });
    this.changed();
  }

  defaultModel(): string | null {
    return this.settings.defaultModel;
  }

  /** The verified file for the runtime (main process only; never sent to a page). */
  async path(id: string): Promise<string | null> {
    const m = this.catalog?.models.find((x) => x.id === id);
    if (!m || !(await this.installed(m))) return null;
    return join(this.dir(m), 'model.gguf');
  }
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}
