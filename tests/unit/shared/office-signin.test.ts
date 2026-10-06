import { describe, expect, it } from 'vitest';
import { isOfficeSignInLink, officeCallback, parseOfficeSignIn } from '@shared/office-signin';
import { parseDeepLink } from '@shared/deeplink';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'state_0123456789abcdef';
const link = (q: string) => `worksuite://office/signin?${q}`;
const good = `client=worksuite-office&server=${encodeURIComponent('https://app.worksuite.lk')}&uid=3&challenge=${CHALLENGE}&state=${STATE}`;
const reason = (raw: string) => {
  const r = parseOfficeSignIn(raw);
  return r.ok ? 'accepted' : r.reason;
};

describe('WorkSuite Office asking to use this sign-in (worksuite-office#6)', () => {
  it('reads the request WorkSuite Office sends', () => {
    const r = parseOfficeSignIn(link(good));
    expect(r).toEqual({ ok: true, request: { server: 'https://app.worksuite.lk', uid: '3', challenge: CHALLENGE, state: STATE } });
    expect(parseOfficeSignIn(`worksuite:///office/signin?${good}`).ok).toBe(true);
  });

  it('is told apart from a link to a document, which the link grammar would open', () => {
    expect(isOfficeSignInLink(link(good))).toBe(true);
    expect(isOfficeSignInLink('worksuite://office/signin')).toBe(true);
    expect(isOfficeSignInLink('worksuite://office/12')).toBe(false);
    expect(isOfficeSignInLink('worksuite://office/signin-not')).toBe(false);
    expect(parseDeepLink('worksuite://office/signin').ok).toBe(true); // why it is matched first
  });

  it('refuses anything it was not built from, without saying more than why', () => {
    expect(reason('worksuite://office/signin')).toBe('no-query');
    expect(reason(link(good.replace('worksuite-office', 'something-else')))).toBe('client');
    expect(reason(link(good.replace(CHALLENGE, 'short')))).toBe('challenge');
    expect(reason(link(good.replace(STATE, 'tiny')))).toBe('state');
    expect(reason(link(good.replace('uid=3', 'uid=3%3Bx')))).toBe('uid');
    expect(reason(link(`${good}&redirect=https%3A%2F%2Fevil.example`))).toBe('unknown-param');
    expect(reason(link(`${good}&state=${STATE}`))).toBe('duplicate-param');
    expect(reason(link('x'.repeat(2100)))).toBe('too-long');
  });

  it('only for a WorkSuite server at an https address, and only its origin', () => {
    const server = (s: string) => link(good.replace(encodeURIComponent('https://app.worksuite.lk'), encodeURIComponent(s)));
    expect(reason(server('http://app.worksuite.lk'))).toBe('server');
    expect(reason(server('https://user:pass@app.worksuite.lk'))).toBe('server');
    expect(reason(server('https://app.worksuite.lk/files'))).toBe('server');
    expect(reason(server('javascript:alert(1)'))).toBe('server');
    expect(parseOfficeSignIn(server('https://APP.worksuite.lk:8443')).ok && (parseOfficeSignIn(server('https://APP.worksuite.lk:8443')) as { request: { server: string } }).request.server).toBe('https://app.worksuite.lk:8443');
  });

  it('sends the code only to WorkSuite Office, escaping what it carries', () => {
    expect(officeCallback('a&b', 's=1')).toBe('worksuiteoffice://auth/callback?code=a%26b&state=s%3D1');
  });
});
