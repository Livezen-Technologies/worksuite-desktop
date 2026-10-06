import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopAccountsFile, OfficeSignIn, type OfficeSignInDeps } from '../../../electron/services/office-signin';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'state_0123456789abcdef';
const CODE = 'c'.repeat(43);
const LINK = `worksuite://office/signin?client=worksuite-office&server=${encodeURIComponent('https://app.worksuite.lk')}&uid=3&challenge=${CHALLENGE}&state=${STATE}`;
const SAMALI = { origin: 'https://app.worksuite.lk', userId: '3', name: 'Samali Perera', organization: 'Livezen Technologies' };

function setup(over: Partial<OfficeSignInDeps> = {}) {
  let now = 1_000_000;
  const calls = { confirm: [] as Array<{ message: string; detail: string }>, handoff: [] as string[], open: [] as string[], toasts: [] as string[], shown: 0 };
  const deps: OfficeSignInDeps = {
    account: () => SAMALI,
    isLocked: () => false,
    confirm: async (text) => {
      calls.confirm.push(text);
      return true;
    },
    handoff: async (challenge) => {
      calls.handoff.push(challenge);
      return { code: CODE, expires_in: 120 };
    },
    open: async (url) => void calls.open.push(url),
    showMain: () => void calls.shown++,
    toast: (_kind, text) => void calls.toasts.push(text),
    isNotFound: (e) => (e as { code?: string }).code === 'NOT_FOUND',
    log: { info: () => undefined, warn: () => undefined },
    now: () => now,
    ...over,
  };
  return { service: new OfficeSignIn(deps), calls, tick: (ms: number) => void (now += ms) };
}

describe('"Continue as" for WorkSuite Office (worksuite-office#6)', () => {
  it('asks the person, then hands WorkSuite Office a code for its own challenge at its fixed address', async () => {
    const { service, calls } = setup();
    await service.handle(LINK);

    expect(calls.shown).toBe(1);
    expect(calls.confirm[0]!.message).toBe('Sign in to WorkSuite Office as Samali Perera?');
    expect(calls.confirm[0]!.detail).toContain('Livezen Technologies · app.worksuite.lk');
    expect(calls.handoff).toEqual([CHALLENGE]);
    expect(calls.open).toEqual([`worksuiteoffice://auth/callback?code=${CODE}&state=${STATE}`]);
  });

  it('does nothing when the person says no', async () => {
    const { service, calls } = setup({ confirm: async () => false });
    await service.handle(LINK);
    expect(calls.handoff).toEqual([]);
    expect(calls.open).toEqual([]);
  });

  it('never answers for another account or server than the one signed in here', async () => {
    const other = setup({ account: () => ({ ...SAMALI, userId: '8' }) });
    await other.service.handle(LINK);
    const elsewhere = setup({ account: () => ({ ...SAMALI, origin: 'https://other.worksuite.lk' }) });
    await elsewhere.service.handle(LINK);
    for (const { calls } of [other, elsewhere]) {
      expect(calls.confirm).toEqual([]);
      expect(calls.open).toEqual([]);
      expect(calls.toasts[0]).toContain('different WorkSuite account');
    }
  });

  it('asks the person to sign in first when nobody is', async () => {
    const { service, calls } = setup({ account: () => null });
    await service.handle(LINK);
    expect(calls.confirm).toEqual([]);
    expect(calls.toasts[0]).toContain('Sign in to WorkSuite first');
  });

  it('refuses a malformed link and says so', async () => {
    const { service, calls } = setup();
    await service.handle(LINK.replace(CHALLENGE, 'short'));
    expect(calls.confirm).toEqual([]);
    expect(calls.toasts[0]).toContain('could not be used');
  });

  it('asks nothing over the lock screen: it waits, briefly, for the person to unlock', async () => {
    let locked = true;
    const { service, calls, tick } = setup({ isLocked: () => locked });
    await service.handle(LINK);
    expect(calls.shown).toBe(1); // the lock screen
    expect(calls.confirm).toEqual([]);

    locked = false;
    service.unlocked();
    await vi.waitFor(() => expect(calls.open).toHaveLength(1));

    // Unlocking after two minutes is too late; the request is dropped.
    locked = true;
    await service.handle(LINK);
    tick(121_000);
    locked = false;
    service.unlocked();
    await Promise.resolve();
    expect(calls.confirm).toHaveLength(1);
  });

  it('stops if the account changed while the question was open', async () => {
    let account = SAMALI;
    const { service, calls } = setup({
      account: () => account,
      confirm: async () => {
        account = { ...SAMALI, userId: '8' };
        return true;
      },
    });
    await service.handle(LINK);
    expect(calls.handoff).toEqual([]);
    expect(calls.toasts[0]).toContain('Your account changed');
  });

  it('says when the server cannot do it yet, and opens nothing on a failed or empty answer', async () => {
    const old = setup({ handoff: async () => { throw Object.assign(new Error('nope'), { code: 'NOT_FOUND' }); } });
    await old.service.handle(LINK);
    expect(old.calls.toasts[0]).toBe('This WorkSuite server cannot sign in WorkSuite Office yet.');
    const empty = setup({ handoff: async () => ({ code: 'not-a-code' }) });
    await empty.service.handle(LINK);
    for (const { calls } of [old, empty]) expect(calls.open).toEqual([]);
  });

  it('does not stack dialogs for a program opening the link over and over', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const { service, calls } = setup({ confirm: (text) => new Promise((resolve) => { calls.confirm.push(text); answer = resolve; }) });
    const first = service.handle(LINK);
    for (let i = 0; i < 10; i++) await service.handle(LINK);
    expect(calls.confirm).toHaveLength(1);
    answer(false);
    await first;
  });
});

describe('desktop-accounts.json: who WorkSuite Office may offer to continue as', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ws-office-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('names the signed-in person and server, readable by this user only, and is emptied at sign-out', () => {
    const file = join(dir, 'WorkSuite', 'desktop-accounts.json');
    const accounts = new DesktopAccountsFile(file, { warn: () => undefined });

    accounts.update({ server: 'https://app.worksuite.lk', user: { id: '3', name: 'Samali Perera', email: 's@example.com', organization: 'Livezen Technologies' } });
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    expect(doc).toEqual({ version: 1, app: 'WorkSuite Desktop', accounts: [{ server: 'https://app.worksuite.lk', user: { id: '3', name: 'Samali Perera', email: 's@example.com', organization: 'Livezen Technologies' } }] });
    expect(JSON.stringify(doc)).not.toMatch(/token|refresh|secret/i);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);

    accounts.update(null);
    expect(JSON.parse(readFileSync(file, 'utf8')).accounts).toEqual([]);
  });

  it('is not rewritten when nothing it says changed', () => {
    const file = join(dir, 'desktop-accounts.json');
    const accounts = new DesktopAccountsFile(file, { warn: () => undefined });
    accounts.update(null);
    const first = statSync(file).mtimeMs;
    rmSync(file);
    accounts.update(null);
    expect(() => statSync(file)).toThrow();
    expect(first).toBeGreaterThan(0);
  });

  it('keeps going when the folder cannot be written', () => {
    const warn = vi.fn();
    const accounts = new DesktopAccountsFile(join(dir, '\0bad', 'desktop-accounts.json'), { warn });
    expect(() => accounts.update(null)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
