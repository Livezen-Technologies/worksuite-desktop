import { describe, expect, it, vi } from 'vitest';
import {
  linuxPolicyPath,
  MAC_DOMAIN,
  OfficeAiPolicySync,
  parseOfficeAiPolicy,
  SOURCE,
  WIN_KEY,
  type OfficeAiPolicyDeps,
} from '../../../electron/services/office-ai-policy';

const POLICY = {
  managed: true,
  features: { stt: true, suggestions: true, correction: true, translate: false, tts: false, assistant: true },
  cloudAllowed: false,
  approvedModels: ['whisper-small-q5', 'qwen2.5-3b-instruct-q4_k_m'],
  maxMemMB: 4096,
  gpuAllowed: true,
  orgDictionaryUrl: 'https://app.worksuite.lk/api/ai/org-dictionary?org_id=7',
  offlineOnly: false,
};

function make(platform: NodeJS.Platform, over: Partial<OfficeAiPolicyDeps> = {}) {
  const files = new Map<string, string>();
  const runs: Array<[string, string[]]> = [];
  const deps: OfficeAiPolicyDeps = {
    platform,
    env: {},
    home: '/home/ann',
    fetchPolicy: async () => POLICY,
    run: async (file, args) => {
      runs.push([file, args]);
      if (args[0] === 'read' || args[0] === 'query') throw new Error('does not exist');
      return '';
    },
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, d) => void files.set(p, d),
    removeFile: async (p) => void files.delete(p),
    log: { info: vi.fn(), warn: vi.fn() },
    ...over,
  };
  return { svc: new OfficeAiPolicySync(deps), files, runs };
}

describe('Office Local AI policy pass-through (W10)', () => {
  it('accepts exactly the GET /v1/policy shape and refuses anything else', () => {
    expect(parseOfficeAiPolicy(POLICY)).toEqual(POLICY);
    expect(parseOfficeAiPolicy({ ...POLICY, offlineOnly: undefined })?.offlineOnly).toBe(false);
    expect(parseOfficeAiPolicy({ ...POLICY, features: { ...POLICY.features, stt: 'yes' } })).toBeNull();
    expect(parseOfficeAiPolicy({ ...POLICY, approvedModels: ['Not An Id'] })).toBeNull();
    expect(parseOfficeAiPolicy({ ...POLICY, orgDictionaryUrl: 'http://plain' })).toBeNull();
    expect(parseOfficeAiPolicy({ ...POLICY, maxMemMB: -1 })).toBeNull();
    expect(parseOfficeAiPolicy(null)).toBeNull();
  });

  it('writes ~/.config/worksuite/office/policy.json on Linux, honouring XDG_CONFIG_HOME', async () => {
    const { svc, files } = make('linux');
    expect(await svc.sync()).toEqual({ status: 'written' });
    const doc = JSON.parse(files.get('/home/ann/.config/worksuite/office/policy.json')!);
    expect(doc.source).toBe(SOURCE);
    expect(doc.ai).toEqual(POLICY);
    expect(linuxPolicyPath({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/ann')).toBe('/x/cfg/worksuite/office/policy.json');
    expect(await svc.sync()).toEqual({ status: 'unchanged' });
  });

  it('never overwrites or removes a policy device management deployed', async () => {
    const path = '/home/ann/.config/worksuite/office/policy.json';
    const { svc, files } = make('linux');
    files.set(path, JSON.stringify({ source: 'mdm', ai: { managed: true } }));
    expect((await svc.sync()).status).toBe('skipped-managed-elsewhere');
    expect((await svc.clear()).status).toBe('skipped-managed-elsewhere');
    expect(JSON.parse(files.get(path)!).source).toBe('mdm');
  });

  it('writes the lk.worksuite.office AI keys with defaults on macOS', async () => {
    const { svc, runs } = make('darwin');
    await svc.sync();
    const writes = runs.filter(([f, a]) => f === 'defaults' && a[0] === 'write').map(([, a]) => a);
    expect(writes.every((a) => a[1] === MAC_DOMAIN)).toBe(true);
    expect(writes).toContainEqual(['write', MAC_DOMAIN, 'AIFeatureTranslate', '-bool', 'false']);
    expect(writes).toContainEqual(['write', MAC_DOMAIN, 'AIApprovedModels', '-array', 'whisper-small-q5', 'qwen2.5-3b-instruct-q4_k_m']);
    expect(writes).toContainEqual(['write', MAC_DOMAIN, 'AIMaxMemMB', '-int', '4096']);
    expect(writes).toContainEqual(['write', MAC_DOMAIN, 'AISource', '-string', SOURCE]);
  });

  it('writes HKCU\\Software\\Policies\\WorkSuite\\Office\\AI on Windows', async () => {
    const { svc, runs } = make('win32');
    await svc.sync();
    const adds = runs.filter(([f, a]) => f === 'reg' && a[0] === 'add').map(([, a]) => a);
    expect(adds.every((a) => a[1] === WIN_KEY)).toBe(true);
    expect(adds).toContainEqual(['add', WIN_KEY, '/v', 'FeatureTts', '/t', 'REG_DWORD', '/d', '0', '/f']);
    expect(adds).toContainEqual(['add', WIN_KEY, '/v', 'ApprovedModels', '/t', 'REG_MULTI_SZ', '/d', 'whisper-small-q5\\0qwen2.5-3b-instruct-q4_k_m', '/f']);
  });

  it('keeps the last policy when the server cannot answer or answers oddly, and clears for an unmanaged company', async () => {
    const path = '/home/ann/.config/worksuite/office/policy.json';
    const a = make('linux', { fetchPolicy: async () => { throw new Error('404'); } });
    expect(await a.svc.sync()).toEqual({ status: 'kept', reason: 'unavailable' });

    const b = make('linux', { fetchPolicy: async () => ({ managed: true }) });
    expect(await b.svc.sync()).toEqual({ status: 'kept', reason: 'invalid' });

    let answer: unknown = POLICY;
    const c = make('linux', { fetchPolicy: async () => answer });
    await c.svc.sync();
    expect(c.files.has(path)).toBe(true);
    answer = { ...POLICY, managed: false };
    expect((await c.svc.sync()).status).toBe('cleared');
    expect(c.files.has(path)).toBe(false);
  });
});
