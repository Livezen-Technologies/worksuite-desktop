import { createHash } from 'node:crypto';
import type { FetchLike } from '../../../electron/services/http';

/**
 * An in-memory WorkSuite Drive, just enough of it for the sync engine: the
 * folder tree and listing the Files screens read, the file and folder calls,
 * the chunked upload, and the whole sync protocol (SyncController) — with the
 * server's own rules: the protocol serves only the owner's files, a commit
 * against a version that moved on is refused and kept as a conflicted copy,
 * the journal leaves out a device's own writes, and trashing records nothing.
 */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const BLOCK = 4 * 1024 * 1024;

export interface FFolder {
  id: number;
  parent_id: number | null;
  name: string;
  owner_id: number;
  deleted: boolean;
  locked?: boolean;
}
export interface FFile {
  id: number;
  folder_id: number | null;
  name: string;
  owner_id: number;
  bytes: Buffer;
  version: number;
  deleted: boolean;
  readOnly?: boolean;
}

export class FakeDrive {
  folders = new Map<number, FFolder>();
  files = new Map<number, FFile>();
  events: Array<{ seq: number; device: number | null }> = [];
  staged = new Map<string, Buffer>();
  deviceCursor = 0;
  wipeOrdered = false;
  wipedConfirmed = false;
  blockBytesIn = 0;
  blockReads = 0;
  calls: string[] = [];
  /** Runs just before a commit is judged: for a change that lands mid-upload. */
  beforeCommit: ((fileId: number | null) => void) | null = null;
  private nextId = 100;
  readonly me = 7;
  readonly deviceId = 55;
  readonly token = 'device-token-1';

  // ── what "the web" does ────────────────────────────────────────────────
  mkdir(name: string, parent: number | null = null, id = this.nextId++): number {
    this.folders.set(id, { id, parent_id: parent, name, owner_id: this.me, deleted: false });
    return id;
  }
  put(name: string, folder: number | null, content: string | Buffer, owner = this.me): number {
    const id = this.nextId++;
    this.files.set(id, { id, folder_id: folder, name, owner_id: owner, bytes: Buffer.from(content), version: 1, deleted: false });
    this.journal(null);
    return id;
  }
  edit(id: number, content: string | Buffer): void {
    const f = this.files.get(id)!;
    f.bytes = Buffer.from(content);
    f.version++;
    this.journal(null);
  }
  rename(id: number, name: string): void {
    this.files.get(id)!.name = name;
    this.journal(null);
  }
  trash(id: number): void {
    this.files.get(id)!.deleted = true; // like FilesController::delete: nothing journaled
  }
  byName(name: string, folder: number | null = null): FFile | undefined {
    return [...this.files.values()].find((f) => !f.deleted && f.name === name && f.folder_id === folder);
  }
  folderByName(name: string, parent: number | null): FFolder | undefined {
    return [...this.folders.values()].find((f) => !f.deleted && f.name === name && f.parent_id === parent);
  }
  private journal(device: number | null): void {
    this.events.push({ seq: this.events.length + 1, device });
  }

  // ── HTTP ───────────────────────────────────────────────────────────────
  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const q = u.searchParams;
    const path = u.pathname;
    this.calls.push(`${method} ${path}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const ok = (data: unknown, status = 200) => json(status, { status: 'success', message: 'OK', data });
    const fail = (status: number, message: string, data?: unknown) => json(status, { status: 'error', message, ...(data !== undefined ? { data } : {}) });
    const body = (): Record<string, unknown> => (typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {});
    let m: RegExpMatchArray | null;

    if (path.startsWith('/api/sync/') && !path.startsWith('/api/sync/devices')) {
      if (headers.get('x-device-token') !== this.token) return fail(401, 'This device is not authorised. Enrol it again.');
    }

    if (method === 'GET' && path === '/api/drive/tree') {
      const node = (f: FFolder): unknown => ({ id: f.id, parent_id: f.parent_id, name: f.name, is_locked: !!f.locked, owner_id: f.owner_id, access: { owner: true, capabilities: ['open', 'download', 'edit', 'upload_version', 'add_files', 'rename', 'move', 'delete'] }, children: [...this.folders.values()].filter((c) => !c.deleted && c.parent_id === f.id).map(node) });
      return ok({ tree: [...this.folders.values()].filter((f) => !f.deleted && f.parent_id === null).map(node) });
    }
    if (method === 'GET' && path === '/api/drive/list') {
      const fid = q.get('folder_id');
      let set = [...this.files.values()].filter((f) => !f.deleted);
      if (fid) {
        const ids = new Set([Number(fid)]);
        if (q.get('deep')) {
          let grew = true;
          while (grew) {
            grew = false;
            for (const d of this.folders.values()) {
              if (d.parent_id !== null && ids.has(d.parent_id) && !ids.has(d.id)) {
                ids.add(d.id);
                grew = true;
              }
            }
          }
        }
        set = set.filter((f) => f.folder_id !== null && ids.has(f.folder_id));
      } else set = set.filter((f) => f.folder_id === null);
      const per = Number(q.get('per_page') ?? 50);
      const page = Number(q.get('page') ?? 1);
      const rows = set.sort((a, b) => a.id - b.id).slice((page - 1) * per, page * per);
      return ok({
        files: rows.map((f) => ({ id: f.id, name: f.name, size: f.bytes.length, folder_id: f.folder_id, sha256: sha(f.bytes), version: f.version, owner_id: f.owner_id, deleted_at: null, access: { owner: f.owner_id === this.me, can_download: true, capabilities: f.readOnly ? ['open', 'download'] : ['open', 'download', 'edit', 'upload_version', 'rename', 'move', 'delete'] } })),
        total: set.length,
      });
    }
    if (method === 'POST' && path === '/api/folders') {
      const b = body();
      const id = this.mkdir(String(b.name), b.parent_id === null || b.parent_id === undefined ? null : Number(b.parent_id));
      return ok({ id: String(id), name: b.name }, 201);
    }
    if ((m = path.match(/^\/api\/folders\/(\d+)$/))) {
      const f = this.folders.get(Number(m[1]));
      if (!f || f.deleted) return fail(404, 'Folder not found');
      if (method === 'PUT') {
        f.name = String(body().name ?? f.name);
        return ok(f);
      }
      if (method === 'DELETE') {
        f.deleted = true;
        return ok(null);
      }
    }
    if (method === 'POST' && (m = path.match(/^\/api\/drive\/folders\/(\d+)\/move$/))) {
      const f = this.folders.get(Number(m[1]))!;
      const p = body().parent_id;
      f.parent_id = p === null || p === undefined ? null : Number(p);
      return ok(null);
    }
    if ((m = path.match(/^\/api\/files\/(\d+)$/))) {
      const f = this.files.get(Number(m[1]));
      if (!f || f.deleted) return fail(404, 'File not found');
      if (method === 'GET') return ok({ id: f.id, name: f.name, version: f.version, sha256: sha(f.bytes) });
      if (method === 'PUT') {
        const b = body();
        if (typeof b.name === 'string') f.name = b.name;
        if ('folder_id' in b) f.folder_id = b.folder_id === null ? null : Number(b.folder_id);
        this.journal(null);
        return ok(f);
      }
      if (method === 'DELETE') {
        f.deleted = true;
        return ok(null, 200);
      }
    }
    if (method === 'GET' && (m = path.match(/^\/api\/files\/(\d+)\/download$/))) {
      const f = this.files.get(Number(m[1]))!;
      return new Response(new Uint8Array(f.bytes), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }

    // the chunked upload
    if (method === 'POST' && path === '/api/uploads/init') {
      const b = body();
      this.uploads.set('u1', { name: String(b.filename), folder: b.folder_id === null || b.folder_id === undefined ? null : Number(b.folder_id), parts: [], replace: b.replace_file_id ? Number(b.replace_file_id) : null });
      return ok({ upload_id: 'u1', chunk_size: Number(b.chunk_size), total_chunks: Math.ceil(Number(b.total_size) / Number(b.chunk_size)), ...(b.replace_file_id ? { replaces: b.replace_file_id } : {}) });
    }
    if (method === 'POST' && path === '/api/uploads/u1/chunk') {
      const form = init.body as FormData;
      this.uploads.get('u1')!.parts.push(Buffer.from(await (form.get('chunk') as Blob).arrayBuffer()));
      return ok({});
    }
    if (method === 'POST' && path === '/api/uploads/u1/complete') {
      const up = this.uploads.get('u1')!;
      const bytes = Buffer.concat(up.parts);
      if (up.replace) {
        this.edit(up.replace, bytes);
        return ok({ file_id: up.replace });
      }
      return ok({ file_id: this.put(up.name, up.folder, bytes) });
    }

    // the sync protocol
    if (method === 'POST' && path === '/api/sync/hello') {
      if (this.wipeOrdered) return ok({ command: 'wipe', message: 'wipe' });
      return ok({ command: 'sync', device: { id: this.deviceId, name: 'Test Mac', cursor: this.deviceCursor }, head: this.events.length, policy: { max_file_bytes: 5 * 1024 ** 3, blocked_types: ['exe'], ignored_patterns: ['*.bak'], max_devices: 10 } });
    }
    if (method === 'POST' && path === '/api/sync/wiped') {
      this.wipedConfirmed = true;
      return ok({ wiped: true });
    }
    if (method === 'GET' && path === '/api/sync/delta') {
      const since = Number(q.get('since') ?? 0);
      const events = this.events.filter((e) => e.seq > since && e.device !== this.deviceId);
      return ok({ since, cursor: since, more: false, head: this.events.length, events: events.slice(0, Number(q.get('limit') ?? 500)) });
    }
    if (method === 'POST' && path === '/api/sync/ack') {
      this.deviceCursor = Math.max(this.deviceCursor, Number(body().cursor));
      return ok({ cursor: this.deviceCursor });
    }
    if (method === 'POST' && path === '/api/sync/have') {
      const hashes = body().hashes as string[];
      const known = new Set<string>(this.staged.keys());
      for (const f of this.files.values()) for (let i = 0; i < f.bytes.length; i += BLOCK) known.add(sha(f.bytes.subarray(i, i + BLOCK)));
      return ok({ have: hashes.filter((h) => known.has(h)), missing: hashes.filter((h) => !known.has(h)) });
    }
    if (method === 'POST' && path === '/api/sync/block') {
      const bytes = Buffer.from(init.body as Uint8Array);
      if (sha(bytes) !== headers.get('x-block-hash')) return fail(422, 'That block does not match the hash it was sent with');
      this.staged.set(sha(bytes), bytes);
      this.blockBytesIn += bytes.length;
      return ok({ hash: sha(bytes), size: bytes.length, staged: true });
    }
    if (method === 'POST' && path === '/api/sync/commit') {
      const b = body();
      const fileId = b.file_id ? Number(b.file_id) : null;
      this.beforeCommit?.(fileId);
      const parts: Buffer[] = [];
      for (const h of b.blocks as string[]) {
        let part = this.staged.get(h);
        if (!part) for (const f of this.files.values()) for (let i = 0; i < f.bytes.length && !part; i += BLOCK) if (sha(f.bytes.subarray(i, i + BLOCK)) === h) part = f.bytes.subarray(i, i + BLOCK);
        if (!part) return fail(409, 'Block is not on the server.', { missing: h });
        parts.push(part);
      }
      const bytes = Buffer.concat(parts);
      if (b.sha256 && sha(bytes) !== b.sha256) return fail(422, 'The assembled file does not match the checksum');
      if (fileId) {
        const f = this.files.get(fileId);
        if (!f || f.deleted || f.owner_id !== this.me) return fail(404, 'That file no longer exists on the server.');
        if (f.version !== Number(b.base_version)) {
          const dot = f.name.lastIndexOf('.');
          const copyName = `${dot > 0 ? f.name.slice(0, dot) : f.name} (conflicted copy from Test Mac 2026-09-28 10-00)${dot > 0 ? f.name.slice(dot) : ''}`;
          const copy = this.put(copyName, f.folder_id, bytes);
          return fail(409, 'Somebody else changed this file', { conflict: true, conflict_id: 1, copy_file_id: copy, server_version: f.version });
        }
        f.bytes = bytes;
        f.version++;
        this.journal(this.deviceId);
        return ok({ file_id: f.id, version: f.version, size: bytes.length });
      }
      const id = this.nextId++;
      this.files.set(id, { id, folder_id: b.folder_id === null || b.folder_id === undefined ? null : Number(b.folder_id), name: String(b.name), owner_id: this.me, bytes, version: 1, deleted: false });
      this.journal(this.deviceId);
      return ok({ file_id: id, version: 1, size: bytes.length }, 201);
    }
    if (method === 'GET' && (m = path.match(/^\/api\/sync\/files\/(\d+)\/manifest$/))) {
      const f = this.files.get(Number(m[1]));
      if (!f || f.deleted || f.owner_id !== this.me) return fail(404, 'File not found');
      const blocks = [];
      for (let i = 0, idx = 0; i < f.bytes.length; i += BLOCK, idx++) {
        const part = f.bytes.subarray(i, i + BLOCK);
        blocks.push({ idx, offset: i, size: part.length, sha256: sha(part) });
      }
      return ok({ block_size: BLOCK, version: f.version, size: f.bytes.length, blocks, file_id: f.id, name: f.name, sha256: sha(f.bytes) });
    }
    if (method === 'GET' && (m = path.match(/^\/api\/sync\/files\/(\d+)\/block\/(\d+)$/))) {
      const f = this.files.get(Number(m[1]))!;
      this.blockReads++;
      const i = Number(m[2]) * BLOCK;
      return new Response(new Uint8Array(f.bytes.subarray(i, i + BLOCK)), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }
    if (method === 'POST' && path === '/api/sync/session') return ok({ session_id: 1 }, 201);
    if (method === 'POST' && path === '/api/sync/session/1/close') return ok({ closed: true });
    if (method === 'PUT' && path.startsWith('/api/sync/devices/')) return ok({ saved: 1 });

    return fail(404, `No fake for ${method} ${path}`);
  };

  private uploads = new Map<string, { name: string; folder: number | null; parts: Buffer[]; replace: number | null }>();
}
