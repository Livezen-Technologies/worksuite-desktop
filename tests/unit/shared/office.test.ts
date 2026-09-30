import { describe, expect, it } from 'vitest';
import {
  documentServerOrigin,
  keepBothName,
  microsoftAppFor,
  officeClientType,
  officeCommandSchema,
  officeExportToken,
  officeRoute,
  parseEditorEvent,
  parseOfficeRoute,
} from '../../../shared/office';
import { contract, tabRecordSchema } from '../../../shared/ipc/contract';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../../shared/ipc/channels';
import { APP_PARTS, canOpenApp } from '../../../shared/access';

describe('Office: what the desktop tells the server about itself', () => {
  it('names its OS as the client type (web-api §1)', () => {
    expect(officeClientType('darwin')).toBe('DESKTOP_MAC');
    expect(officeClientType('macos')).toBe('DESKTOP_MAC');
    expect(officeClientType('win32')).toBe('DESKTOP_WIN');
    expect(officeClientType('linux')).toBe('DESKTOP_LINUX');
  });
});

describe('Office: one tab per document (OO-DSK-004)', () => {
  it('routes a document by its Drive id, with the chosen mode and a name to show while it opens', () => {
    const r = officeRoute(42, { mode: 'EDIT', name: "Q4 budget (Ben's copy).xlsx" });
    expect(r.startsWith('/office/42?mode=edit&name=')).toBe(true);
    // The tab store and the window manager accept only their route grammar: parentheses and quotes are encoded.
    expect(tabRecordSchema.safeParse({ id: 't1', route: r, title: 'x', pinned: false, organizationId: null, app: 'office' }).success).toBe(true);
    expect(parseOfficeRoute(r)).toEqual({ fileId: 42, mode: 'EDIT', name: "Q4 budget (Ben's copy).xlsx" });
    expect(parseOfficeRoute('/office/7')).toEqual({ fileId: 7, mode: null, name: null });
    expect(parseOfficeRoute('/office/7?mode=bogus')?.mode).toBeNull();
    expect(parseOfficeRoute('/office/abc')).toBeNull();
    expect(parseOfficeRoute('/files?folder=2')).toBeNull();
  });

  it('is a part of Files: whoever may open Files may open a document tab, nobody else', () => {
    expect(APP_PARTS.office).toBe('files');
    expect(canOpenApp('office', new Set(['files']))).toBe(true);
    expect(canOpenApp('office', new Set(['chat']))).toBe(false);
  });
});

describe('Office: the Document Server an editor may be loaded from (OO-DSK-021)', () => {
  const api = (ds: string) => `${ds.replace(/\/$/, '')}/web-apps/apps/api/documents/api.js`;

  it('takes HTTPS, with the editor script on the Document Server itself, also under a path', () => {
    expect(documentServerOrigin('https://docs.example.com', api('https://docs.example.com'), { allowInsecureLocal: false })).toEqual({ origin: 'https://docs.example.com', apiUrl: api('https://docs.example.com') });
    expect(documentServerOrigin('https://ws.example.com/ds/', api('https://ws.example.com/ds'), { allowInsecureLocal: false })).toMatchObject({ origin: 'https://ws.example.com' });
  });

  it('refuses plain HTTP (except on this computer in a development build), credentials, and a script from anywhere else', () => {
    const insecure = documentServerOrigin('http://docs.example.com', api('http://docs.example.com'), { allowInsecureLocal: true });
    expect('error' in insecure && insecure.error).toMatch(/HTTPS/);
    expect(documentServerOrigin('http://localhost:8085', api('http://localhost:8085'), { allowInsecureLocal: true })).toMatchObject({ origin: 'http://localhost:8085' });
    expect('error' in documentServerOrigin('http://localhost:8085', api('http://localhost:8085'), { allowInsecureLocal: false })).toBe(true);
    expect('error' in documentServerOrigin('https://u:p@docs.example.com', api('https://docs.example.com'), { allowInsecureLocal: false })).toBe(true);
    expect('error' in documentServerOrigin('https://docs.example.com', 'https://evil.example.net/web-apps/apps/api/documents/api.js', { allowInsecureLocal: false })).toBe(true);
    expect('error' in documentServerOrigin('https://docs.example.com', 'https://docs.example.com/other/script.js', { allowInsecureLocal: false })).toBe(true);
    expect('error' in documentServerOrigin('https://docs.example.com/ds', 'https://docs.example.com/web-apps/apps/api/documents/api.js', { allowInsecureLocal: false })).toBe(true);
    expect('error' in documentServerOrigin('https://docs.example.com', `${api('https://docs.example.com')}?x=1`, { allowInsecureLocal: false })).toBe(true);
    expect('error' in documentServerOrigin('not a url', 'x', { allowInsecureLocal: false })).toBe(true);
  });
});

describe("Office: what may cross from the editor's page", () => {
  it('passes the known events with their own shapes only', () => {
    expect(parseEditorEvent({ type: 'onDocumentStateChange', data: true })).toEqual({ type: 'onDocumentStateChange', data: true });
    expect(parseEditorEvent({ type: 'onDocumentReady' })).toEqual({ type: 'onDocumentReady', data: null });
    expect(parseEditorEvent({ type: 'onRequestRename', data: 'Final.docx' })).toEqual({ type: 'onRequestRename', data: 'Final.docx' });
    expect(parseEditorEvent({ type: 'onRequestUsers', data: { c: 'mention', search: 'Sa' } })).toEqual({ type: 'onRequestUsers', data: { c: 'mention', search: 'Sa' } });
    expect(parseEditorEvent({ type: 'require', data: null })).toBeNull();
    expect(parseEditorEvent({ type: 'onDocumentStateChange', data: 'yes' })).toBeNull();
    expect(parseEditorEvent({ type: 'onRequestRename', data: 'x'.repeat(300) })).toBeNull();
    expect(parseEditorEvent(null)).toBeNull();
  });

  it("never lets a mention's comment text through (web-api §4)", () => {
    const ev = parseEditorEvent({ type: 'onRequestSendNotify', data: { emails: ['u3@worksuite.mention'], actionLink: '{"action":{"type":"comment","data":"c1"}}', message: 'Salary figures for Samali' } });
    expect(ev).toEqual({ type: 'onRequestSendNotify', data: { emails: ['u3@worksuite.mention'], actionLink: '{"action":{"type":"comment","data":"c1"}}' } });
    expect(JSON.stringify(ev)).not.toContain('Salary');
  });

  it('accepts only the commands the editor takes', () => {
    expect(officeCommandSchema.safeParse({ type: 'refresh', config: { document: {} } }).success).toBe(true);
    expect(officeCommandSchema.safeParse({ type: 'setUsers', c: 'mention', users: [{ id: '3', name: 'Samali', email: 'u3@worksuite.mention' }] }).success).toBe(true);
    expect(officeCommandSchema.safeParse({ type: 'eval', code: 'alert(1)' }).success).toBe(false);
  });
});

describe('Office: the IPC contract', () => {
  it('declares every Office channel, with events for the tab and the local copies', () => {
    for (const c of ['office:open', 'office:place', 'office:command', 'office:close', 'office:focusFile', 'office:externalApps', 'office:openExternal', 'office:localCopies', 'office:uploadLocal', 'office:forgetLocal', 'office:revealLocal', 'office:localAvailable', 'office:openLocal'] as const) {
      expect(INVOKE_CHANNELS).toContain(c);
      expect(contract[c]).toBeDefined();
    }
    expect(EVENT_CHANNELS).toContain('office:event');
    expect(EVENT_CHANNELS).toContain('office:localChanged');
  });

  it('opens an editor only with a session id, the server’s configuration and known events', () => {
    const ok = {
      key: 't1',
      fileId: 42,
      sessionId: '0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10',
      organizationId: '3',
      documentServerUrl: 'https://docs.example.com',
      apiUrl: 'https://docs.example.com/web-apps/apps/api/documents/api.js',
      config: { document: { key: 'k' }, token: 'eyJ' },
      events: ['onDocumentReady', 'onRequestRename'],
    };
    expect(contract['office:open'].input.safeParse(ok).success).toBe(true);
    expect(contract['office:open'].input.safeParse({ ...ok, events: ['onEverything'] }).success).toBe(false);
    expect(contract['office:open'].input.safeParse({ ...ok, sessionId: '../../x' }).success).toBe(false);
    expect(contract['office:openExternal'].input.safeParse({ fileId: 42, name: 'a.docx', folderId: null, version: 7, app: 'word' }).success).toBe(true);
    expect(contract['office:openExternal'].input.safeParse({ fileId: 42, name: 'a.docx', folderId: null, version: 7, app: '/bin/sh' }).success).toBe(false);
  });

  it("downloads an export by its token, never an address (web-api §8)", () => {
    const token = officeExportToken('https://app.example.com/office/exports/AbC123_-.xyz');
    expect(token).toBe('AbC123_-.xyz');
    expect(officeExportToken('https://app.example.com/api/files/1/download')).toBeNull();
    expect(officeExportToken('https://app.example.com/office/exports/a/../../b')).toBeNull();
    const input = contract['transfers:download'].input;
    expect(input.safeParse({ officeExport: token, name: 'Proposal.pdf' }).success).toBe(true);
    expect(input.safeParse({ officeExport: '../etc', name: 'x.pdf' }).success).toBe(false);
    expect(input.safeParse({ officeExport: token, fileId: '4', name: 'x.pdf' }).success).toBe(false);
  });
});

describe('Office: external apps and copies', () => {
  it('knows which Microsoft app edits what', () => {
    expect(microsoftAppFor('DOCX')).toBe('word');
    expect(microsoftAppFor('rtf')).toBe('word');
    expect(microsoftAppFor('xlsx')).toBe('excel');
    expect(microsoftAppFor('csv')).toBe('excel');
    expect(microsoftAppFor('pptx')).toBe('powerpoint');
    expect(microsoftAppFor('pdf')).toBeNull();
  });

  it('names a Keep Both copy beside the original', () => {
    expect(keepBothName('Proposal.docx')).toBe('Proposal (edited on this computer).docx');
    expect(keepBothName('README')).toBe('README (edited on this computer)');
  });
});
