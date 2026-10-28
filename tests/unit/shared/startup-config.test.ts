import { describe, expect, it } from 'vitest';
import { DEFAULT_STARTUP, mergeStartup, readStartupConfig, signupMode, startupConfigV1, visibleCredentials, withSafety } from '@shared/startup-config';

const cfg = (over: Record<string, unknown> = {}) => startupConfigV1.parse(over);

describe('startup config', () => {
  it('defaults to every method on', () => {
    expect(DEFAULT_STARTUP.methods).toMatchObject({ personal: true, enterprise: true, guest: true, meeting: true, email: true, google: true, microsoft: true, apple: true, passkey: true });
    expect(DEFAULT_STARTUP.signup.mode).toBe('browser');
  });

  it('reads the block out of a discovery document, and ignores a broken one', () => {
    expect(readStartupConfig({ startup: { methods: { google: false } } }).methods.google).toBe(false);
    expect(readStartupConfig({ startup: { methods: { google: 'no' } } })).toEqual(DEFAULT_STARTUP);
    expect(readStartupConfig({})).toEqual(DEFAULT_STARTUP);
    expect(readStartupConfig(null)).toEqual(DEFAULT_STARTUP);
  });

  it('keeps one way in when an administrator turns everything off', () => {
    const empty = withSafety(cfg({ methods: { email: false, google: false, microsoft: false, apple: false, passkey: false } }));
    expect(empty.methods.email).toBe(true);
    const neither = withSafety(cfg({ methods: { personal: false, enterprise: false } }));
    expect(neither.methods.personal).toBe(true);
  });

  it('lets local policy switch a method off but never back on', () => {
    const remote = cfg({ methods: { personal: true, enterprise: true, guest: true } });
    expect(mergeStartup(remote, { allowPersonal: false }).methods.personal).toBe(false);
    expect(mergeStartup(remote, { guestAvailable: false }).methods.guest).toBe(false);
    const off = cfg({ methods: { google: false } });
    expect(mergeStartup(off, { allowPersonal: true }).methods.google).toBe(false);
  });

  it('shuts Personal off without locking the screen: Enterprise carries it', () => {
    const merged = mergeStartup(cfg({}), { allowPersonal: false });
    expect(merged.methods.personal).toBe(false);
    expect(merged.methods.enterprise).toBe(true);
  });

  it('orders the buttons as published, default method first', () => {
    const c = cfg({ order: ['passkey', 'google'], methods: { microsoft: false }, default_method: 'google' });
    expect(visibleCredentials(c)).toEqual(['google', 'passkey', 'email', 'apple']);
  });

  it('ignores a default method that is switched off', () => {
    const c = cfg({ methods: { apple: false }, default_method: 'apple' });
    expect(visibleCredentials(c)[0]).toBe('email');
  });

  it('drops a logo that is not https, and a malformed accent', () => {
    expect(cfg({ branding: { logo: 'http://example.com/l.png', accent: '#112233' } }).branding).toEqual({ logo: null, accent: '#112233' });
    expect(cfg({ branding: { logo: 'https://example.com/l.png', accent: 'red' } }).branding).toEqual({ logo: 'https://example.com/l.png', accent: null });
  });

  it('offers sign-up only when the server allows it', () => {
    expect(signupMode(cfg({ signup: { mode: 'in_app' } }), true)).toBe('in_app');
    expect(signupMode(cfg({ signup: { mode: 'in_app' } }), false)).toBe('off');
    expect(signupMode(cfg({ signup: { mode: 'off' } }), true)).toBe('off');
  });
});
