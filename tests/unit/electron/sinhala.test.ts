import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinProfiles, profileHash, type Profile } from '@worksuite/sinhala-core';
import { canonicalJson } from '@shared/canonical-json';
import { unicodeCopyName } from '@shared/sinhala';
import { DesktopError } from '../../../electron/main/errors';
import { checkServerProfile, fontsDirFor, SinhalaService, windowsFontValue, type SinhalaDeps } from '../../../electron/services/sinhala';
import { convertDocx, readZip } from '../../../electron/services/sinhala-docx';
import { createZip } from '../../../electron/services/zip';
import { ed25519Key } from '../../../electron/updater/update-center';

/**
 * SinhalaService (Sinhala Tools blueprint §6; AC-SI-05, AC-SI-06): whether the tools are offered, the profile cache and
 * its checks, text and clipboard conversion, offline documents and the queue that uploads them.
 */

// From the engine's golden corpus (worksuite-office sinhala/test/corpus/fm-abhaya.json).
const LEGACY = 'Y%S ,xld rcfha mqj;am;';
const UNICODE = 'ශ්‍රී ලංකා රජයේ පුවත්පත';

const fm = builtinProfiles.find((p) => p.id === 'fm-abhaya')!;
const serverProfiles = () => builtinProfiles.map((p) => JSON.parse(JSON.stringify(p)) as Profile);

function memoryConfig() {
  const m = new Map<string, unknown>();
  return {
    m,
    getConfig: <T,>(k: string) => (m.has(k) ? (JSON.parse(JSON.stringify(m.get(k))) as T) : undefined),
    setConfig: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))),
    deleteConfig: (k: string) => void m.delete(k),
  };
}

function docxWith(runs: Array<{ font: string | null; text: string }>): Buffer {
  const body = runs
    .map((r) => `<w:r>${r.font ? `<w:rPr><w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}"/></w:rPr>` : ''}<w:t>${r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r>`)
    .join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${body}</w:p></w:body></w:document>`;
  return createZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.from(doc) },
    { name: 'word/media/image1.png', data: Buffer.from([1, 2, 3, 4]) },
  ]);
}

interface Harness {
  svc: SinhalaService;
  deps: SinhalaDeps;
  config: ReturnType<typeof memoryConfig>;
  answer: { profiles: () => unknown };
  clip: { text: string };
  keys: Map<string, () => void>;
  toasts: Array<[string, string]>;
  online: { v: boolean };
  locked: { v: boolean };
  uploads: Array<{ fileId: number; path: string; name: string }>;
  newFiles: Array<{ path: string; name: string }>;
  conflict: { v: boolean };
  dir: string;
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sinhala-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function harness(o: { profiles?: () => unknown; keys?: Record<string, string> } = {}): Harness {
  const config = memoryConfig();
  const answer = { profiles: o.profiles ?? (() => ({ profiles: serverProfiles(), settings: { enabled: true } })) };
  const clip = { text: '' };
  const keys = new Map<string, () => void>();
  const toasts: Array<[string, string]> = [];
  const online = { v: true };
  const locked = { v: false };
  const uploads: Harness['uploads'] = [];
  const newFiles: Harness['newFiles'] = [];
  const conflict = { v: false };
  const deps: SinhalaDeps = {
    http: {
      get: async <T,>(path: string) => {
        if (!online.v) throw new DesktopError('NETWORK_UNREACHABLE', 'offline');
        if (path === '/api/sinhala/profiles') return answer.profiles() as T;
        throw new DesktopError('NOT_FOUND', 'no such path', 404);
      },
      post: async () => {
        throw new DesktopError('NETWORK_UNREACHABLE', 'offline');
      },
      download: async () => Buffer.alloc(0),
    },
    config,
    scope: () => 'acct:7',
    online: () => online.v,
    locked: () => locked.v,
    clipboard: { readText: async () => clip.text, writeText: async (t) => void (clip.text = t) },
    shortcuts: {
      register: (acc, fn) => {
        if (keys.has(acc)) return false;
        keys.set(acc, fn);
        return true;
      },
      unregister: (acc) => void keys.delete(acc),
    },
    toast: (kind, text) => void toasts.push([kind, text]),
    changed: () => undefined,
    // The worker's work, done in-process for the test.
    docx: async (req) => {
      const input = req.bytes ?? readFileSync(req.path!);
      const { bytes, stats } = convertDocx(input, { profiles: req.profiles, targetFont: req.targetFont, force: req.force });
      if (req.outPath) {
        writeFileSync(req.outPath, bytes);
        return { stats };
      }
      return { stats, bytes: new Uint8Array(bytes) };
    },
    offlinePath: (fileId) => (fileId === 42 ? { path: join(dir, 'Report.docx'), synced: false } : null),
    uploadVersion: async (fileId, path, name) => {
      if (conflict.v) return 'conflict';
      uploads.push({ fileId, path, name });
      return { version: 3 };
    },
    uploadNew: async (path, name) => void newFiles.push({ path, name }),
    pickFiles: async () => [],
    reveal: () => undefined,
    fetch: async () => new Response(null, { status: 404 }),
    fonts: { platform: 'linux', home: dir },
    run: async () => undefined,
    keys: o.keys ?? {},
    ed25519Key,
  };
  return { svc: new SinhalaService(deps), deps, config, answer, clip, keys, toasts, online, locked, uploads, newFiles, conflict, dir };
}

describe('SinhalaService: whether the tools are offered', () => {
  it('is hidden until the server answers, then follows it', async () => {
    const h = harness();
    expect(h.svc.availability()).toBe('no_api');
    await h.svc.sync();
    expect(h.svc.availability()).toBe('ok');
    h.answer.profiles = () => ({ profiles: serverProfiles(), settings: { enabled: false } });
    await h.svc.sync();
    expect(h.svc.availability()).toBe('disabled');
    expect(() => h.svc.convert(LEGACY)).toThrow(/not available/);
  });

  it('hides the tools on a server without the API (404) or for someone without sinhala.use (403)', async () => {
    const h = harness({ profiles: () => { throw new DesktopError('NOT_FOUND', 'Not found', 404); } });
    await h.svc.sync();
    expect(h.svc.availability()).toBe('no_api');
    h.answer.profiles = () => {
      throw new DesktopError('PERMISSION_DENIED', 'Forbidden', 403);
    };
    await h.svc.sync();
    expect(h.svc.availability()).toBe('forbidden');
    expect(h.svc.status().shortcutHeld).toBeNull();
  });

  it('keeps the last answer and the last good profiles when the server cannot be reached', async () => {
    const h = harness();
    await h.svc.sync();
    h.online.v = false;
    await h.svc.sync();
    expect(h.svc.availability()).toBe('ok');
    expect(h.svc.status().offline).toBe(true);
    expect(h.svc.convert(LEGACY, 'fm-abhaya').text).toBe(UNICODE);
    // A fresh start offline (a new service on the same app database) still has them.
    const again = new SinhalaService(h.deps);
    expect(again.availability()).toBe('ok');
    expect(again.profilesView().profiles.every((p) => p.source === 'cache')).toBe(true);
  });

  it('reads org settings sent with the profiles; a bare list works too', async () => {
    const h = harness({ profiles: () => serverProfiles() });
    await h.svc.sync();
    expect(h.svc.availability()).toBe('ok');
    h.answer.profiles = () => ({ profiles: serverProfiles(), settings: { enabled: true, default_profile: 'dl-manel', target_font: 'Noto Serif Sinhala', allow_reverse: false, locked: ['defaultProfile'] } });
    await h.svc.sync();
    expect(h.svc.org().targetFont).toBe('Noto Serif Sinhala');
    expect(h.svc.user().defaultProfile).toBe('dl-manel');
    expect(() => h.svc.setUser({ defaultProfile: 'kaputa' })).toThrow(/organization/);
    expect(() => h.svc.convert(UNICODE, 'fm-abhaya', 'toLegacy')).toThrow(/does not allow/);
  });
});

describe('profiles: sha256 and signatures (AC-SI-05)', () => {
  it('refuses a tampered profile from the server and falls back to the built-in set', async () => {
    const tampered = serverProfiles().map((p) => (p.id === 'fm-abhaya' ? { ...p, map: p.map.map(([l, u]) => (l === 'l' ? ['l', 'ඛ'] : [l, u])) as Profile['map'] } : p));
    const h = harness({ profiles: () => ({ profiles: tampered, settings: { enabled: true } }) });
    await h.svc.sync();
    const view = h.svc.profilesView();
    expect(view.rejected.map((r) => r.id)).toEqual(['fm-abhaya']);
    expect(view.rejected[0]!.reason).toMatch(/sha256/);
    expect(view.profiles.map((p) => p.id)).not.toContain('fm-abhaya');
    // The tampered map is never kept for offline use.
    const cached = h.config.getConfig<{ profiles: Array<{ id: string }> }>('sinhala.cache:acct:7')!;
    expect(cached.profiles.map((p) => p.id)).not.toContain('fm-abhaya');
  });

  it('refuses a profile cache edited on disk, offline', async () => {
    const h = harness();
    await h.svc.sync();
    const key = 'sinhala.cache:acct:7';
    const cached = h.config.getConfig<{ profiles: Profile[] }>(key)!;
    cached.profiles[0]!.map[0] = [cached.profiles[0]!.map[0]![0], 'X'];
    h.config.setConfig(key, cached);
    h.online.v = false;
    const fresh = new SinhalaService(h.deps);
    const view = fresh.profilesView();
    expect(view.rejected).toHaveLength(1);
    expect(view.profiles.map((p) => p.id)).not.toContain(cached.profiles[0]!.id);
  });

  it('checks an Ed25519 signature when the profile carries one', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64url');
    const keys = { 'ws-test-1': raw };
    const p = { ...serverProfiles()[0]!, key_id: 'ws-test-1' } as Record<string, unknown>;
    p.signature = sign(null, Buffer.from(canonicalJson(p), 'utf8'), privateKey).toString('base64url');
    expect(checkServerProfile(p, keys, ed25519Key).signed).toBe(true);
    // Same sha256, signature over something else: refused.
    const forged = { ...p, signature: sign(null, Buffer.from('other'), privateKey).toString('base64url') };
    expect(() => checkServerProfile(forged, keys, ed25519Key)).toThrow(/signature/);
    // A key this build does not pin: refused.
    expect(() => checkServerProfile({ ...p, key_id: 'ws-other' }, keys, ed25519Key)).toThrow(/unknown key/);
    // No signature: used on its sha256 alone, marked unsigned.
    const { signature: _s, key_id: _k, ...plain } = p;
    expect(checkServerProfile(plain, keys, ed25519Key).signed).toBe(false);
  });

  it('a profile re-hashed after an edit passes its sha256 but not a signature made before', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64url');
    const p = serverProfiles()[0]! as unknown as Record<string, unknown>;
    const signature = sign(null, Buffer.from(canonicalJson(p), 'utf8'), privateKey).toString('base64url');
    const edited = { ...p, notes: 'edited' } as Record<string, unknown>;
    edited.sha256 = profileHash(edited as unknown as Profile);
    expect(() => checkServerProfile({ ...edited, signature }, { k: raw }, ed25519Key)).toThrow(/signature/);
  });
});

describe('text and the clipboard (WF-SI-04, AC-SI-06)', () => {
  it('converts and detects with the profile it names', async () => {
    const h = harness();
    await h.svc.sync();
    const r = h.svc.convert(LEGACY);
    expect(r).toMatchObject({ text: UNICODE, profile: 'fm-abhaya', profileVersion: fm.version, direction: 'toUnicode' });
    expect(h.svc.detect(LEGACY).kind).toBe('legacy');
    expect(h.svc.convert(UNICODE, 'fm-abhaya', 'toLegacy').text).toBe(LEGACY);
  });

  it('converts 10,000 characters on the clipboard in under 200 ms', async () => {
    const h = harness();
    await h.svc.sync();
    let text = '';
    while (text.length < 10_000) text += `${LEGACY} `;
    h.clip.text = text.slice(0, 10_000);
    h.svc.convert('warm up', 'fm-abhaya');
    const t0 = performance.now();
    const r = await h.svc.clipboard();
    const ms = performance.now() - t0;
    expect(r.changed).toBe(true);
    expect(r.chars).toBe(10_000);
    expect(ms).toBeLessThan(200);
    expect(r.ms).toBeLessThan(200);
    expect(h.clip.text.startsWith(UNICODE)).toBe(true);
    expect(h.toasts.at(-1)![1]).toMatch(/FM Abhaya/);
  });

  it('leaves English and Unicode on the clipboard as they are', async () => {
    const h = harness();
    await h.svc.sync();
    h.clip.text = 'The meeting is at 10 in the office';
    expect((await h.svc.clipboard()).changed).toBe(false);
    expect(h.clip.text).toBe('The meeting is at 10 in the office');
    h.clip.text = UNICODE;
    expect((await h.svc.clipboard()).changed).toBe(false);
  });

  it('holds the clipboard key only while available and unlocked, and lets the person change it', async () => {
    const h = harness();
    expect(h.svc.syncKey()).toBeNull();
    await h.svc.sync();
    expect(h.keys.has('CommandOrControl+Shift+U')).toBe(true);
    h.locked.v = true;
    h.svc.syncKey();
    expect(h.keys.size).toBe(0);
    h.locked.v = false;
    h.svc.syncKey();
    h.svc.setUser({ shortcut: 'Alt+Shift+K' });
    expect([...h.keys.keys()]).toEqual(['Alt+Shift+K']);
    h.clip.text = LEGACY;
    h.keys.get('Alt+Shift+K')!();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.clip.text).toBe(UNICODE);
    h.svc.setUser({ shortcut: null });
    expect(h.keys.size).toBe(0);
  });

  it('says when another app holds the key', async () => {
    const h = harness();
    h.keys.set('CommandOrControl+Shift+U', () => undefined);
    await h.svc.sync();
    expect(h.svc.status().shortcutHeld).toBeNull();
  });
});

describe('documents on this computer (WF-SI-03, AC-SI-05)', () => {
  const settle = async (h: Harness, id: string) => {
    for (let i = 0; i < 50; i++) {
      const j = await h.svc.jobStatus(id);
      if (j.state !== 'running' && j.state !== 'queued') return j;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('job did not finish');
  };

  it('converts an offline Drive copy with the cached profiles, saves "name (Unicode).docx" and queues it as a new version', async () => {
    const h = harness();
    await h.svc.sync();
    const original = docxWith([{ font: 'FMAbhaya', text: LEGACY }, { font: 'Arial', text: 'English stays' }]);
    writeFileSync(join(dir, 'Report.docx'), original);
    h.online.v = false;
    const { jobId } = await h.svc.convertFile({ source: { kind: 'drive', fileId: 42, name: 'Report.docx' } });
    const j = await settle(h, jobId);
    expect(j).toMatchObject({ state: 'waiting_upload', outputName: 'Report (Unicode).docx', runsTotal: 1, runsConverted: 1, profile: 'fm-abhaya', profileVersion: fm.version });
    const out = readZip(readFileSync(join(dir, 'Report (Unicode).docx')));
    const xml = out.find((f) => f.name === 'word/document.xml')!.data.toString('utf8');
    expect(xml).toContain(UNICODE);
    expect(xml).toContain('w:ascii="Noto Sans Sinhala"');
    expect(xml).toContain('English stays');
    expect(out.find((f) => f.name === 'word/media/image1.png')!.data).toEqual(Buffer.from([1, 2, 3, 4]));
    // The original is untouched.
    expect(readFileSync(join(dir, 'Report.docx')).equals(original)).toBe(true);
    expect(h.svc.status().pendingUploads).toBe(1);
    expect(h.uploads).toEqual([]);

    h.online.v = true;
    await h.svc.flushUploads();
    expect(h.uploads).toEqual([{ fileId: 42, path: join(dir, 'Report (Unicode).docx'), name: 'Report.docx' }]);
    expect((await h.svc.jobStatus(jobId)).state).toBe('uploaded');
    expect(h.svc.status().pendingUploads).toBe(0);
  });

  it('keeps both on a conflict', async () => {
    const h = harness();
    await h.svc.sync();
    writeFileSync(join(dir, 'Report.docx'), docxWith([{ font: 'FM Abhaya', text: LEGACY }]));
    h.online.v = false;
    const { jobId } = await h.svc.convertFile({ source: { kind: 'drive', fileId: 42 } });
    await settle(h, jobId);
    h.online.v = true;
    h.conflict.v = true;
    await h.svc.flushUploads();
    expect(h.newFiles).toEqual([{ path: join(dir, 'Report (Unicode).docx'), name: 'Report (Unicode).docx' }]);
    expect((await h.svc.jobStatus(jobId)).state).toBe('conflict');
  });

  it('converts a dropped file by its handle, and refuses what is not a .docx', async () => {
    const h = harness();
    await h.svc.sync();
    const path = join(dir, 'Letter.docx');
    writeFileSync(path, docxWith([{ font: 'FMAbhaya', text: LEGACY }]));
    writeFileSync(join(dir, 'notes.txt'), 'hi');
    const reg = await h.svc.registerPaths([path, join(dir, 'notes.txt'), 'relative.docx']);
    expect(reg.files.map((f) => f.name)).toEqual(['Letter.docx']);
    expect(reg.rejected).toHaveLength(2);
    const { jobId } = await h.svc.convertFile({ source: { kind: 'local', handle: reg.files[0]!.handle } });
    const j = await settle(h, jobId);
    expect(j.state).toBe('done');
    expect(existsSync(join(dir, 'Letter (Unicode).docx'))).toBe(true);
    expect(h.svc.status().pendingUploads).toBe(0);
  });

  it('gives the built-in editor its document back converted', async () => {
    const h = harness();
    await h.svc.sync();
    const r = await h.svc.convertDocx(new Uint8Array(docxWith([{ font: 'DL-Manel-bold', text: 'wdKavqj' }])));
    expect(r.runsConverted).toBe(1);
    expect(r.profile).toBe('dl-manel');
    expect(readZip(Buffer.from(r.bytes)).find((f) => f.name === 'word/document.xml')!.data.toString('utf8')).not.toContain('wdKavqj');
  });
});

describe('fonts and names', () => {
  it('puts fonts in the per-user folder of each system (blueprint §6.1 Fonts)', () => {
    expect(fontsDirFor({ platform: 'win32', home: 'C:\\Users\\a', localAppData: 'C:\\Users\\a\\AppData\\Local' })).toContain(join('Microsoft', 'Windows', 'Fonts'));
    expect(fontsDirFor({ platform: 'darwin', home: '/Users/a' })).toBe(join('/Users/a', 'Library', 'Fonts'));
    expect(fontsDirFor({ platform: 'linux', home: '/home/a' })).toBe(join('/home/a', '.local', 'share', 'fonts', 'worksuite'));
    expect(windowsFontValue('Noto Sans Sinhala', 'NotoSansSinhala-Bold.ttf')).toBe('Noto Sans Sinhala Bold (TrueType)');
  });

  it('installs only distributable fonts whose sha256 matches', async () => {
    const h = harness();
    await h.svc.sync();
    const good = Buffer.from('font-bytes');
    const sha = (await import('node:crypto')).createHash('sha256').update(good).digest('hex');
    h.deps.http.get = async <T,>(path: string) =>
      (path === '/api/sinhala/fonts'
        ? { fonts: [
            { family: 'Noto Sans Sinhala', kind: 'unicode', distributable: true, licence: 'OFL-1.1', files: [{ name: 'NotoSansSinhala-Regular.ttf', url: '/api/sinhala/fonts/1/download', sha256: sha }] },
            { family: 'FM Abhaya', kind: 'legacy', distributable: false, files: [{ name: 'FMAbhaya.ttf', url: '/api/sinhala/fonts/2/download', sha256: sha }] },
          ] }
        : { profiles: serverProfiles(), settings: { enabled: true } }) as T;
    h.deps.http.download = async () => good;
    const st = await h.svc.installFonts();
    expect(st.families.find((f) => f.family === 'Noto Sans Sinhala')!.installed).toBe(true);
    expect(st.families.find((f) => f.family === 'FM Abhaya')!.installed).toBe(false);
    expect(existsSync(join(dir, '.local', 'share', 'fonts', 'worksuite', 'FMAbhaya.ttf'))).toBe(false);
  });

  it('refuses a font that does not match its checksum', async () => {
    const h = harness();
    await h.svc.sync();
    h.deps.http.get = async <T,>(path: string) =>
      (path === '/api/sinhala/fonts' ? { fonts: [{ family: 'Noto Sans Sinhala', kind: 'unicode', distributable: true, files: [{ name: 'N.ttf', url: '/f', sha256: '0'.repeat(64) }] }] } : { profiles: serverProfiles() }) as T;
    h.deps.http.download = async () => Buffer.from('evil');
    await expect(h.svc.installFonts()).rejects.toThrow(/checksum/);
    expect(existsSync(join(dir, '.local', 'share', 'fonts', 'worksuite', 'N.ttf'))).toBe(false);
  });

  it('names the converted copy', () => {
    expect(unicodeCopyName('Report.docx')).toBe('Report (Unicode).docx');
    expect(unicodeCopyName('a.b.docx')).toBe('a.b (Unicode).docx');
    expect(unicodeCopyName('Report (Unicode).docx')).toBe('Report (Unicode).docx');
  });
});
