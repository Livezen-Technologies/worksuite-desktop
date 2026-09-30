import { describe, expect, it } from 'vitest';
import { officeRequestAllowed, officeRoute, officeScriptOrigin, officeSwitchQuestion, parseOfficeRoute, type OpenOfficeDocument } from '@shared/office';

const HOST = 'app://office/host.html';
const DS = 'https://docs.example.com';

/**
 * WorkSuite Office on the desktop (OO-DSK): what the editor view may load and
 * reach, how a document window names its file, and the question before a
 * company switch.
 */
describe('the Document Server the editor view may use', () => {
  it('is the origin of an https api.js the session named', () => {
    expect(officeScriptOrigin('https://docs.example.com/web-apps/apps/api/documents/api.js', false)).toBe(DS);
    expect(officeScriptOrigin('https://docs.example.com:8443/ds/web-apps/apps/api/documents/api.js', false)).toBe('https://docs.example.com:8443');
  });

  it('refuses http (outside a development build), credentials, and anything that is not the editor script', () => {
    expect(officeScriptOrigin('http://docs.local/web-apps/apps/api/documents/api.js', false)).toBeNull();
    expect(officeScriptOrigin('http://docs.local/web-apps/apps/api/documents/api.js', true)).toBe('http://docs.local');
    expect(officeScriptOrigin('https://u:p@docs.example.com/web-apps/apps/api/documents/api.js', false)).toBeNull();
    expect(officeScriptOrigin('https://docs.example.com/evil.js', false)).toBeNull();
    expect(officeScriptOrigin('javascript:alert(1)', true)).toBeNull();
    expect(officeScriptOrigin('not a url', true)).toBeNull();
  });
});

describe('what the editor view may reach', () => {
  it('its own page, the Document Server (pages, socket) and what it makes itself', () => {
    expect(officeRequestAllowed(HOST, DS, HOST)).toBe(true);
    expect(officeRequestAllowed('https://docs.example.com/web-apps/apps/documenteditor/main/index.html?x=1', DS, HOST)).toBe(true);
    expect(officeRequestAllowed('wss://docs.example.com/doc/abc/c/?EIO=4', DS, HOST)).toBe(true);
    expect(officeRequestAllowed('https://docs.example.com:443/fonts/a.woff', DS, HOST)).toBe(true);
    expect(officeRequestAllowed('data:image/png;base64,AAAA', DS, HOST)).toBe(true);
    expect(officeRequestAllowed('blob:https://docs.example.com/1234', DS, HOST)).toBe(true);
  });

  it('nothing else: another site, another port, plain http, WorkSuite itself, the shell', () => {
    expect(officeRequestAllowed('https://evil.example.net/x', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('https://docs.example.com.evil.net/x', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('https://docs.example.com:8443/x', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('http://docs.example.com/x', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('ws://docs.example.com/x', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('blob:https://evil.example.net/1', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('app://bundle/__api/api/auth/me', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('app://office/other.html', DS, HOST)).toBe(false);
    expect(officeRequestAllowed('file:///etc/passwd', DS, HOST)).toBe(false);
  });

  it('a local http Document Server in a development build: http and ws there only', () => {
    expect(officeRequestAllowed('ws://localhost:8080/doc', 'http://localhost:8080', HOST)).toBe(true);
    expect(officeRequestAllowed('https://localhost:8080/doc', 'http://localhost:8080', HOST)).toBe(false);
  });
});

describe("a document window's route", () => {
  it('names the file, and the mode only when the person chose one', () => {
    expect(officeRoute(42)).toBe('/files/office/42');
    expect(officeRoute(42, 'EDIT')).toBe('/files/office/42?mode=EDIT');
    expect(parseOfficeRoute('/files/office/42?mode=EDIT')).toEqual({ fileId: 42, mode: 'EDIT' });
    expect(parseOfficeRoute('/files/office/42')).toEqual({ fileId: 42, mode: null });
  });

  it('ignores a mode it does not know and refuses anything else', () => {
    expect(parseOfficeRoute('/files/office/42?mode=ADMIN')).toEqual({ fileId: 42, mode: null });
    expect(parseOfficeRoute('/files/office/0')).toBeNull();
    expect(parseOfficeRoute('/files/office/abc')).toBeNull();
    expect(parseOfficeRoute('/files?file=42')).toBeNull();
  });
});

describe('"Close documents from Organization A before switching?" (OO-DSK-060)', () => {
  const doc = (over: Partial<OpenOfficeDocument>): OpenOfficeDocument => ({ windowId: 1, fileId: 1, name: 'Proposal.docx', organizationId: 'a', sessionId: 's', dirty: false, ...over });
  const orgs = [
    { id: 'a', name: 'Livezen' },
    { id: 'b', name: 'Garage & Fleet' },
  ];

  it('asks, naming the company and the documents', () => {
    const q = officeSwitchQuestion([doc({}), doc({ windowId: 2, name: 'Budget.xlsx' })], 'b', orgs);
    expect(q?.message).toBe('Close documents from Livezen before switching?');
    expect(q?.detail).toContain('Proposal.docx\nBudget.xlsx');
    expect(q?.detail).not.toContain('Document Server');
  });

  it('says so when something has not reached the Document Server yet', () => {
    expect(officeSwitchQuestion([doc({ dirty: true })], 'b', orgs)?.detail).toContain('not reached the Document Server');
  });

  it('does not ask when the documents are the target company’s, when none are open, or for All organizations', () => {
    expect(officeSwitchQuestion([doc({ organizationId: 'b' })], 'b', orgs)).toBeNull();
    expect(officeSwitchQuestion([], 'b', orgs)).toBeNull();
    expect(officeSwitchQuestion([doc({})], null, orgs)).toBeNull();
  });
});
