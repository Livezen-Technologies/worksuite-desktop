import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFICE_OPEN_PREFS,
  decideOfficeOpen,
  normalizeOfficeOpenPrefs,
  officeAppLink,
  officeAppServer,
  officeOpenKind,
  parseOfficeAppLink,
  type OfficeOpenRequest,
} from '@shared/office-open';
import { contract } from '@shared/ipc/contract';
import { INVOKE_CHANNELS } from '@shared/ipc/channels';

const req = (r: Partial<OfficeOpenRequest>): OfficeOpenRequest => ({ name: 'Proposal.docx', inDrive: true, prefs: null, installed: true, ...r });

describe('Open with (#322): which files', () => {
  it('knows Word, Excel and PowerPoint files and their OpenDocument cousins, by extension or name', () => {
    for (const n of ['a.docx', 'a.DOC', 'a.docm', 'a.dotx', 'a.odt', 'a.rtf']) expect(officeOpenKind(n)).toBe('doc');
    for (const n of ['a.xlsx', 'a.xls', 'a.xlsm', 'a.xltx', 'a.ods', 'a.csv']) expect(officeOpenKind(n)).toBe('sheet');
    for (const n of ['a.pptx', 'a.ppt', 'a.pptm', 'a.potx', 'a.odp']) expect(officeOpenKind(n)).toBe('slides');
    expect(officeOpenKind('Report', 'XLSX')).toBe('sheet');
    expect(officeOpenKind('a.pdf')).toBeNull();
    expect(officeOpenKind('docx')).toBeNull();
    expect(officeOpenKind('a.png')).toBeNull();
  });
});

describe('Open with (#322): the setting', () => {
  it('is the built-in editor for every kind until chosen, and drops anything unknown', () => {
    expect(normalizeOfficeOpenPrefs(undefined)).toEqual(DEFAULT_OFFICE_OPEN_PREFS);
    expect(normalizeOfficeOpenPrefs({ sheet: 'worksuite-office', slides: 'bogus', doc: 3 })).toEqual({ doc: 'builtin', sheet: 'worksuite-office', slides: 'builtin' });
  });

  it('is what Settings saves, and nothing else', () => {
    const input = contract['settings:set'].input;
    expect(input.safeParse({ officeOpen: { doc: 'ask' } }).success).toBe(true);
    expect(input.safeParse({ officeOpen: { doc: 'worksuite-office', sheet: 'system', slides: 'builtin' } }).success).toBe(true);
    expect(input.safeParse({ officeOpen: { doc: '/Applications/Evil.app' } }).success).toBe(false);
  });
});

describe('Open with (#322): what opening does', () => {
  it('leaves anything that is not an Office file to the caller', () => {
    expect(decideOfficeOpen(req({ name: 'a.pdf' }))).toEqual({ kind: 'none' });
  });

  it('follows the setting per kind on a double-click', () => {
    const prefs = { doc: 'builtin', sheet: 'worksuite-office', slides: 'system' } as const;
    expect(decideOfficeOpen(req({ prefs }))).toEqual({ kind: 'open', officeKind: 'doc', target: 'builtin' });
    expect(decideOfficeOpen(req({ name: 'b.xlsx', prefs }))).toEqual({ kind: 'open', officeKind: 'sheet', target: 'worksuite-office' });
    expect(decideOfficeOpen(req({ name: 'c.pptx', prefs }))).toEqual({ kind: 'open', officeKind: 'slides', target: 'system' });
    expect(decideOfficeOpen(req({}))).toEqual({ kind: 'open', officeKind: 'doc', target: 'builtin' });
  });

  it('takes the choice from Open with over the setting', () => {
    expect(decideOfficeOpen(req({ prefs: { doc: 'system' }, chosen: 'builtin' }))).toEqual({ kind: 'open', officeKind: 'doc', target: 'builtin' });
  });

  it('asks every time when set to, without the built-in editor where it cannot open the file', () => {
    expect(decideOfficeOpen(req({ prefs: { doc: 'ask' } }))).toEqual({ kind: 'ask', officeKind: 'doc', choices: ['builtin', 'worksuite-office', 'system'] });
    expect(decideOfficeOpen(req({ name: 'old.doc', prefs: { doc: 'ask' }, builtinOk: false }))).toEqual({ kind: 'ask', officeKind: 'doc', choices: ['worksuite-office', 'system'] });
  });

  it('offers Download when WorkSuite Office is not installed, with the built-in editor (or the default app) instead', () => {
    expect(decideOfficeOpen(req({ chosen: 'worksuite-office', installed: false }))).toEqual({ kind: 'not-installed', officeKind: 'doc', fallback: 'builtin' });
    expect(decideOfficeOpen(req({ chosen: 'worksuite-office', installed: false, builtinOk: false }))).toEqual({ kind: 'not-installed', officeKind: 'doc', fallback: 'system' });
    // Not known yet: the main process checks again when it is asked to open.
    expect(decideOfficeOpen(req({ chosen: 'worksuite-office', installed: null }))).toEqual({ kind: 'open', officeKind: 'doc', target: 'worksuite-office' });
  });

  it('asks to save a file that is not in Drive first, before WorkSuite Office', () => {
    expect(decideOfficeOpen(req({ chosen: 'worksuite-office', inDrive: false }))).toEqual({ kind: 'save-first', officeKind: 'doc' });
    expect(decideOfficeOpen(req({ prefs: { doc: 'worksuite-office' }, inDrive: false }))).toEqual({ kind: 'save-first', officeKind: 'doc' });
    // Missing beats save-first: there is nothing to save it for.
    expect(decideOfficeOpen(req({ chosen: 'worksuite-office', inDrive: false, installed: false })).kind).toBe('not-installed');
  });

  it('opens a file the built-in editor cannot read in the default app instead', () => {
    expect(decideOfficeOpen(req({ name: 'old.xls', builtinOk: false }))).toEqual({ kind: 'open', officeKind: 'sheet', target: 'system' });
  });
});

describe('Open with (#322): the link to WorkSuite Office', () => {
  const base = { server: 'https://app.worksuite.lk', uid: '3', org: '12', name: 'Q3 plan.docx' };

  it('names a Drive file by its id, so saves go back as its versions', () => {
    const link = officeAppLink({ ...base, doc: { file: 42, mode: 'edit' } });
    expect(link).toBe('worksuiteoffice://open?v=1&server=https%3A%2F%2Fapp.worksuite.lk&uid=3&org=12&file=42&name=Q3%20plan.docx&mode=edit');
    expect(parseOfficeAppLink(link)).toEqual({ ok: true, link: { ...base, doc: { file: 42, mode: 'edit' } } });
  });

  it('names a copy by the path this server serves it at', () => {
    const src = '/api/mail/messages/9/attachments/2?folder=INBOX&dl=1';
    const link = officeAppLink({ ...base, org: null, doc: { src } });
    expect(link.startsWith('worksuiteoffice://open?v=1&')).toBe(true);
    const back = parseOfficeAppLink(link);
    expect(back.ok && back.link.doc).toEqual({ src });
  });

  it('refuses what must not reach another program', () => {
    expect(() => officeAppLink({ ...base, server: 'http://app.worksuite.lk', doc: { file: 1 } })).toThrow('server');
    expect(() => officeAppLink({ ...base, server: 'https://u:p@app.worksuite.lk', doc: { file: 1 } })).toThrow('server');
    expect(() => officeAppLink({ ...base, uid: '3&file=9', doc: { file: 1 } })).toThrow('uid');
    expect(() => officeAppLink({ ...base, doc: { file: -1 } })).toThrow('file');
    expect(() => officeAppLink({ ...base, doc: { src: 'https://evil.example/x' } })).toThrow('src');
    expect(() => officeAppLink({ ...base, doc: { src: '/api/../../etc/passwd' } })).toThrow('src');
    // A name cannot carry a path or a control character.
    const p = parseOfficeAppLink(officeAppLink({ ...base, name: '../../x\u0000.docx', doc: { file: 1 } }));
    expect(p.ok && p.link.name).toBe('..-..-x-.docx');
  });

  it('allows plain http only on this computer', () => {
    expect(officeAppServer('http://localhost:8080')).toBe('http://localhost:8080');
    expect(officeAppServer('http://10.0.0.5')).toBeNull();
    expect(officeAppServer('https://APP.worksuite.lk/')).toBe('https://app.worksuite.lk');
    expect(officeAppServer('https://app.worksuite.lk/files')).toBeNull();
  });

  it('reads back only links it builds', () => {
    const reason = (u: string) => {
      const r = parseOfficeAppLink(u);
      return r.ok ? 'ok' : r.reason;
    };
    const good = 'worksuiteoffice://open?v=1&server=https%3A%2F%2Fapp.worksuite.lk&uid=3&file=42&name=a.docx';
    expect(reason(good)).toBe('ok');
    expect(reason(good.replace('v=1', 'v=2'))).toBe('version');
    expect(reason(`${good}&src=%2Fapi%2Fx`)).toBe('document');
    expect(reason(`${good}&exec=1`)).toBe('unknown-param');
    expect(reason(`${good}&file=43`)).toBe('duplicate-param');
    expect(reason(`${good}&mode=delete`)).toBe('mode');
    expect(reason('worksuiteoffice://auth/callback?code=x')).toBe('not-open');
    expect(reason(`${good}&name=${'x'.repeat(2100)}`)).toBe('too-long');
  });
});

describe('Open with (#322): the IPC contract', () => {
  it('declares the channels, taking a file and never a link', () => {
    expect(INVOKE_CHANNELS).toContain('office:desktopApp');
    expect(INVOKE_CHANNELS).toContain('office:openInDesktopApp');
    const input = contract['office:openInDesktopApp'].input;
    expect(input.safeParse({ kind: 'drive', fileId: 42, name: 'a.docx', mode: 'edit', organizationId: '3' }).success).toBe(true);
    expect(input.safeParse({ kind: 'copy', path: '/media/abcdefgh12345678?download=1', name: 'a.docx' }).success).toBe(true);
    expect(input.safeParse({ kind: 'copy', path: 'https://evil.example/a.docx', name: 'a.docx' }).success).toBe(false);
    expect(input.safeParse({ kind: 'copy', path: '/api/../secret', name: 'a.docx' }).success).toBe(false);
    expect(input.safeParse({ kind: 'drive', fileId: 42, name: 'a.docx', url: 'worksuiteoffice://open?x' }).success).toBe(false);
    expect(input.safeParse({ kind: 'drive', fileId: '42', name: 'a.docx' }).success).toBe(false);
    expect(contract['office:openInDesktopApp'].session).toBe(true);
  });
});
