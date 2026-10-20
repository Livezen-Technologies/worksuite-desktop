import { createHash, generateKeyPairSync, sign } from 'node:crypto';
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
/** `GET api/sinhala/profiles?include=map` (SinhalaProfiles::current): the listing, the engine's data under `profile`. */
const listing = (p: Profile, extra: Record<string, unknown> = {}) => ({ id: p.id, name: p.name, version: p.version, status: p.status, direction: 'both', font_names: p.fontNames, sha256: p.sha256, signature: null, source_commit: 'abc', profile: p, ...extra });
const profilesBody = (list: Profile[] = serverProfiles()) => ({ profiles: list.map((p) => listing(p)), default_profile: 'fm-abhaya', synced_at: '2026-10-20T08:00:00+00:00' });
/** `GET api/sinhala/status` (CoreSinhalaService::status). */
const statusBody = (o: Record<string, unknown> = {}) => ({
  available: true, reason: null, enabled: true, can_use: true, can_admin: false, worker: { ok: true, core: '1.0.0', commit: 'abc' }, plugin_guid: 'asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}',
  default_profile: 'fm-abhaya', enabled_profiles: ['fm-abhaya', 'dl-manel', 'kaputa'], target_font: 'Noto Sans Sinhala', allow_reverse: true, auto_detect_on_paste: 'prompt', max_file_mb: 50, formats: ['docx', 'pptx'], ...o,
});

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
  answer: { status: () => unknown; profiles: () => unknown; fonts: () => unknown };
  posts: Array<{ path: string; body: unknown }>;
  postAnswer: { fn: (path: string) => unknown };
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

function harness(o: { profiles?: () => unknown; status?: () => unknown; keys?: Record<string, string> } = {}): Harness {
  const config = memoryConfig();
  const answer = { status: o.status ?? (() => statusBody()), profiles: o.profiles ?? (() => profilesBody()), fonts: (): unknown => ({ unicode: [], legacy: [], target_font: 'Noto Sans Sinhala', desktop_install_fonts: 'ask' }) };
  const posts: Harness['posts'] = [];
  const postAnswer: Harness['postAnswer'] = {
    fn: () => {
      throw new DesktopError('NETWORK_UNREACHABLE', 'offline');
    },
  };
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
      get: async <T,>(path: string, opts?: { query?: Record<string, unknown> }) => {
        if (!online.v) throw new DesktopError('NETWORK_UNREACHABLE', 'offline');
        if (path === '/api/sinhala/status') return answer.status() as T;
        if (path === '/api/sinhala/profiles') {
          expect(opts?.query?.include).toBe('map');
          return answer.profiles() as T;
        }
        if (path === '/api/sinhala/fonts') return answer.fonts() as T;
        if (path.startsWith('/api/sinhala/jobs/')) return postAnswer.fn(path) as T;
        throw new DesktopError('NOT_FOUND', 'no such path', 404);
      },
      post: async <T,>(path: string, body?: unknown) => {
        if (!online.v) throw new DesktopError('NETWORK_UNREACHABLE', 'offline');
        posts.push({ path, body });
        return postAnswer.fn(path) as T;
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
  return { svc: new SinhalaService(deps), deps, config, answer, posts, postAnswer, clip, keys, toasts, online, locked, uploads, newFiles, conflict, dir };
}

describe('SinhalaService: whether the tools are offered', () => {
  it('is hidden until the server answers, then follows it', async () => {
    const h = harness();
    expect(h.svc.availability()).toBe('no_api');
    await h.svc.sync();
    expect(h.svc.availability()).toBe('ok');
    h.answer.status = () => statusBody({ available: false, reason: 'DISABLED_FOR_ORGANIZATION', enabled: false });
    await h.svc.sync();
    expect(h.svc.availability()).toBe('disabled');
    expect(h.svc.profilesView().profiles.every((p) => p.source === 'builtin')).toBe(true);
    expect(() => h.svc.convert(LEGACY)).toThrow(/not available/);
  });

  it('hides the tools on a server without the API (404) or for someone without sinhala.use (NO_PERMISSION)', async () => {
    const h = harness({ status: () => { throw new DesktopError('NOT_FOUND', 'Not found', 404); } });
    await h.svc.sync();
    expect(h.svc.availability()).toBe('no_api');
    h.answer.status = () => statusBody({ available: false, reason: 'NO_PERMISSION', can_use: false });
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

  it('keeps the tools here while only the server’s engine is down (SINHALA_UNAVAILABLE)', async () => {
    const h = harness({ status: () => statusBody({ available: false, reason: 'SINHALA_UNAVAILABLE', worker: { ok: false } }) });
    await h.svc.sync();
    expect(h.svc.availability()).toBe('ok');
    expect(h.svc.status().serverEngine).toBe(false);
    expect(h.svc.convert(LEGACY, 'fm-abhaya').text).toBe(UNICODE);
  });

  it('takes the org settings from status and the font policy from fonts', async () => {
    const h = harness({ status: () => statusBody({ default_profile: 'dl-manel', target_font: 'Noto Serif Sinhala', allow_reverse: false, auto_detect_on_paste: 'off' }) });
    h.answer.fonts = () => ({ unicode: [], legacy: [], target_font: 'Noto Serif Sinhala', desktop_install_fonts: 'never' });
    await h.svc.sync();
    expect(h.svc.org()).toMatchObject({ defaultProfile: 'dl-manel', targetFont: 'Noto Serif Sinhala', allowReverse: false, autoDetectOnPaste: 'off', installFonts: 'never', locked: [] });
    expect(h.svc.status().serverFormats).toEqual(['docx', 'pptx']);
    expect(() => h.svc.convert(UNICODE, 'fm-abhaya', 'toLegacy')).toThrow(/does not allow/);
    await expect(h.svc.installFonts()).rejects.toThrow(/does not install fonts/);
  });
});

describe('profiles: sha256 and signatures (AC-SI-05)', () => {
  it('refuses a tampered profile from the server and falls back to the built-in set', async () => {
    const tampered = serverProfiles().map((p) => (p.id === 'fm-abhaya' ? { ...p, map: p.map.map(([l, u]) => (l === 'l' ? ['l', 'ඛ'] : [l, u])) as Profile['map'] } : p));
    const h = harness({ profiles: () => profilesBody(tampered) });
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
    const cached = h.config.getConfig<{ profiles: Array<{ id: string; profile: Profile }> }>(key)!;
    cached.profiles[0]!.profile.map[0] = [cached.profiles[0]!.profile.map[0]![0], 'X'];
    h.config.setConfig(key, cached);
    h.online.v = false;
    const fresh = new SinhalaService(h.deps);
    const view = fresh.profilesView();
    expect(view.rejected).toHaveLength(1);
    expect(view.profiles.map((p) => p.id)).not.toContain(cached.profiles[0]!.id);
  });

  it('refuses a listing whose sha256 is not its data’s, and one without the data', () => {
    const p = serverProfiles()[0]!;
    expect(() => checkServerProfile(listing(p, { sha256: 'f'.repeat(64) }), {}, ed25519Key)).toThrow(/does not match its data/);
    expect(() => checkServerProfile(listing(p, { profile: undefined }), {}, ed25519Key)).toThrow(/include=map/);
  });

  it('checks an Ed25519 signature when the profile carries one', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64url');
    const keys = { 'ws-test-1': raw };
    const data = serverProfiles()[0]!;
    const signature = sign(null, Buffer.from(canonicalJson({ ...data, key_id: 'ws-test-1' }), 'utf8'), privateKey).toString('base64url');
    const p = listing(data, { key_id: 'ws-test-1', signature }) as Record<string, unknown>;
    expect(checkServerProfile(p, keys, ed25519Key).signed).toBe(true);
    // Same sha256, signature over something else: refused.
    const forged = { ...p, signature: sign(null, Buffer.from('other'), privateKey).toString('base64url') };
    expect(() => checkServerProfile(forged, keys, ed25519Key)).toThrow(/signature/);
    // A key this build does not pin: refused.
    expect(() => checkServerProfile({ ...p, key_id: 'ws-other' }, keys, ed25519Key)).toThrow(/unknown key/);
    // No signature: used on its sha256 alone, marked unsigned.
    expect(checkServerProfile(listing(data), keys, ed25519Key).signed).toBe(false);
  });

  it('a profile re-hashed after an edit passes its sha256 but not a signature made before', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64url');
    const p = serverProfiles()[0]!;
    const signature = sign(null, Buffer.from(canonicalJson(p), 'utf8'), privateKey).toString('base64url');
    const edited = { ...p, notes: 'edited' };
    edited.sha256 = profileHash(edited);
    expect(() => checkServerProfile(listing(edited, { signature }), { k: raw }, ed25519Key)).toThrow(/signature/);
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

  const fontZip = (files: Record<string, Buffer>) => createZip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  it('installs distributable fonts from their release archive, each file checked (GET fonts)', async () => {
    const h = harness();
    await h.svc.sync();
    const regular = Buffer.from('regular-font');
    const ofl = Buffer.from('licence');
    const zip = fontZip({ 'NotoSansSinhala/full/ttf/NotoSansSinhala-Regular.ttf': regular, 'OFL.txt': ofl });
    h.answer.fonts = () => ({
      unicode: [{ id: 1, family: 'Noto Sans Sinhala', kind: 'unicode', profile: null, version: '3.000', licence: 'OFL-1.1', distributable: true, download_url: '/api/files/fonts/noto.zip', sha256: sha(zip), files: { 'NotoSansSinhala/full/ttf/NotoSansSinhala-Regular.ttf': sha(regular), 'OFL.txt': sha(ofl) }, organization: false }],
      legacy: [{ id: 2, family: 'FM Abhaya', kind: 'legacy', profile: 'fm-abhaya', version: null, licence: 'commercial', distributable: false, download_url: null, sha256: null, files: null, organization: false }],
      target_font: 'Noto Sans Sinhala',
      desktop_install_fonts: 'ask',
    });
    h.deps.http.download = async () => zip;
    const st = await h.svc.installFonts();
    expect(st.families.find((f) => f.family === 'Noto Sans Sinhala')).toMatchObject({ installed: true, distributable: true });
    expect(st.families.find((f) => f.family === 'FM Abhaya')).toMatchObject({ installed: false, distributable: false });
    const fontDir = join(dir, '.local', 'share', 'fonts', 'worksuite');
    expect(readFileSync(join(fontDir, 'NotoSansSinhala-Regular.ttf'))).toEqual(regular);
    expect(existsSync(join(fontDir, 'OFL.txt'))).toBe(false);
  });

  it('refuses an archive, or a font in it, that does not match its checksum', async () => {
    const h = harness();
    await h.svc.sync();
    const good = Buffer.from('font');
    const zip = fontZip({ 'N.ttf': Buffer.from('evil') });
    const font = { family: 'Noto Sans Sinhala', kind: 'unicode', distributable: true, download_url: '/f.zip', files: { 'N.ttf': sha(good) } };
    h.answer.fonts = () => ({ unicode: [{ ...font, sha256: '0'.repeat(64) }], legacy: [] });
    h.deps.http.download = async () => zip;
    await expect(h.svc.installFonts()).rejects.toThrow(/checksum/);
    h.answer.fonts = () => ({ unicode: [{ ...font, sha256: sha(zip) }], legacy: [] });
    await expect(h.svc.installFonts()).rejects.toThrow(/N\.ttf does not match/);
    expect(existsSync(join(dir, '.local', 'share', 'fonts', 'worksuite', 'N.ttf'))).toBe(false);
  });

  it('names the converted copy', () => {
    expect(unicodeCopyName('Report.docx')).toBe('Report (Unicode).docx');
    expect(unicodeCopyName('a.b.docx')).toBe('a.b (Unicode).docx');
    expect(unicodeCopyName('Report (Unicode).docx')).toBe('Report (Unicode).docx');
  });
});

describe('Drive documents on the server: preview, then Accept or Reject (WF-SI-02)', () => {
  /** SinhalaJobs::present. */
  const job = (o: Record<string, unknown> = {}) => ({
    id: 7, status: 'preview', file_id: 42, file_name: 'Report.docx', source_version: 3, result_version: null, profile: null, profile_version: 'fm-abhaya@1.0.0',
    runs_total: 4, runs_converted: 4, unmapped_count: 1,
    unmapped: [{ profile: 'fm-abhaya', sequence: '¥', code_point: 'U+00A5', count: 1, first_offset: 12 }],
    preview: { paragraphs_changed: 2, samples: [{ part: 'word/document.xml', before: LEGACY, after: UNICODE }], locations: [], profiles: { 'fm-abhaya': '1.0.0' }, target_font: 'Noto Sans Sinhala' },
    error: null, mine: true, can_accept: true, created_at: '2026-10-20 08:00:00', finished_at: null, ...o,
  });

  it('starts a server job (202), shows its preview, and saves only on Accept', async () => {
    const h = harness();
    await h.svc.sync();
    h.postAnswer.fn = (path) => (path === '/api/sinhala/files/42/convert' ? job({ status: 'queued', can_accept: false, preview: null }) : path.endsWith('/accept') ? job({ status: 'done', result_version: 4, can_accept: false }) : job());
    const { jobId } = await h.svc.convertFile({ source: { kind: 'drive', fileId: 42, name: 'Report.docx' }, profile: 'fm-abhaya' });
    expect(jobId).toBe('s-7');
    expect(h.posts[0]).toEqual({ path: '/api/sinhala/files/42/convert', body: { profile: 'fm-abhaya' } });
    const p = await h.svc.jobStatus(jobId);
    expect(p).toMatchObject({ state: 'preview', canAccept: true, paragraphsChanged: 2, runsConverted: 4, unmappedCount: 1, profileVersion: 'fm-abhaya@1.0.0' });
    expect(p.preview).toEqual([{ part: 'word/document.xml', before: LEGACY, after: UNICODE }]);
    expect(p.unmapped).toEqual([{ sequence: '¥', codePoint: 'U+00A5', count: 1, firstOffset: 12 }]);
    expect(h.posts.some((x) => x.path.endsWith('/accept'))).toBe(false);
    const done = await h.svc.decide(jobId, true);
    expect(h.posts.at(-1)!.path).toBe('/api/sinhala/jobs/7/accept');
    expect(done).toMatchObject({ state: 'done', resultVersionId: 4, canAccept: false });
  });

  it('Reject changes nothing; a 409 on Accept says why and keeps the job as the server has it', async () => {
    const h = harness();
    await h.svc.sync();
    h.postAnswer.fn = (path) => (path.endsWith('/reject') ? job({ status: 'rejected', can_accept: false }) : job());
    const { jobId } = await h.svc.convertFile({ source: { kind: 'drive', fileId: 42 } });
    expect((await h.svc.decide(jobId, false)).state).toBe('rejected');

    const h2 = harness();
    await h2.svc.sync();
    h2.postAnswer.fn = (path) => {
      if (path.endsWith('/accept')) throw new DesktopError('CONFLICT', 'The document was changed after it was converted, so nothing was saved. Convert it again.', 409);
      return path.startsWith('/api/sinhala/jobs/') ? job({ status: 'conflict', can_accept: false }) : job();
    };
    const second = await h2.svc.convertFile({ source: { kind: 'drive', fileId: 42 } });
    await expect(h2.svc.decide(second.jobId, true)).rejects.toThrow(/changed after it was converted/);
    expect((await h2.svc.jobStatus(second.jobId)).state).toBe('conflict');
  });

  it('falls back to the offline copy when the server’s engine is down (503)', async () => {
    const h = harness();
    await h.svc.sync();
    writeFileSync(join(dir, 'Report.docx'), docxWith([{ font: 'FMAbhaya', text: LEGACY }]));
    h.postAnswer.fn = () => {
      throw new DesktopError('SERVER_ERROR', 'Sinhala Tools are unavailable right now', 503);
    };
    const { jobId } = await h.svc.convertFile({ source: { kind: 'drive', fileId: 42 } });
    expect(jobId.startsWith('l-')).toBe(true);
  });

  it('keeps an unknown server status from looking finished', async () => {
    const h = harness();
    await h.svc.sync();
    h.postAnswer.fn = () => job({ status: 'exploded' });
    const { jobId } = await h.svc.convertFile({ source: { kind: 'drive', fileId: 42 } });
    expect((await h.svc.jobStatus(jobId)).state).toBe('failed');
  });
});
