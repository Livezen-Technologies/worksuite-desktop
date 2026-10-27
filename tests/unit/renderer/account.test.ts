import { describe, expect, it } from 'vitest';
import { resolveWebLink } from '@shared/links';
import { pictureUrl } from '../../../src/components/UserPicture';
import { clientLabel } from '../../../src/modules/account/api';
import { avatarSvg, initialsFrom, normalise } from '../../../src/modules/account/avatarArt';
import { clamp, initial, minScale, MAX_ZOOM, rotate } from '../../../src/modules/account/crop';
import { refusal, typeList } from '../../../src/modules/account/PictureEditor';
import { daysAgo, weekdays } from '../../../src/components/CardKit';
import { zoneFacts } from '../../../src/modules/account/Profile';

/**
 * My account: where the web's account links land, how a session is named,
 * which pictures load, and the small rules behind the screens.
 */
describe('web links to the account', () => {
  it('open My account natively, on the section the web named', () => {
    expect(resolveWebLink('/account/settings?tab=security')).toEqual({ kind: 'tab', route: '/account/security', app: 'account' });
    expect(resolveWebLink('/account/settings?tab=pictures')).toEqual({ kind: 'tab', route: '/account/pictures', app: 'account' });
    expect(resolveWebLink('/account/settings')).toEqual({ kind: 'tab', route: '/account/general', app: 'account' });
    expect(resolveWebLink('/account/settings?tab=nonsense')).toEqual({ kind: 'tab', route: '/account/general', app: 'account' });
    expect(resolveWebLink('/account/security')).toEqual({ kind: 'tab', route: '/account/security', app: 'account' });
    expect(resolveWebLink('/account/access')).toEqual({ kind: 'tab', route: '/account/access', app: 'account' });
    expect(resolveWebLink('/account')).toEqual({ kind: 'tab', route: '/account/profile', app: 'account' });
  });
});

describe('a session, as its owner would recognise it', () => {
  const ua = (s: string, browser = 'Chrome', platform = 'macOS') => ({ user_agent: s, browser, platform });
  it('names this app, browsers, and what it cannot place', () => {
    expect(clientLabel(ua('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 WorkSuite/0.2.15 Chrome/152 Electron/44.4.5 Safari/537.36'))).toEqual({ label: 'WorkSuite Desktop · macOS', kind: 'desktop' });
    expect(clientLabel(ua('Mozilla/5.0 (Windows NT 10.0) Chrome/140', 'Chrome', 'Windows'))).toEqual({ label: 'Chrome on Windows', kind: 'browser' });
    expect(clientLabel(ua('Mozilla/5.0 (iPhone) Safari', 'Safari', 'iPhone')).kind).toBe('mobile');
    expect(clientLabel(ua('curl/8.7.1', 'Other', 'Unknown'))).toEqual({ label: 'An unrecognised program', kind: 'other' });
  });
});

describe('picture addresses', () => {
  it('load from the server only, and never the private marker', () => {
    expect(pictureUrl('/avatars/abc/256.webp', 'https://ws.example')).toBe('https://ws.example/avatars/abc/256.webp');
    expect(pictureUrl('/avatars/private', 'https://ws.example')).toBeNull();
    expect(pictureUrl('https://evil.example/x.png', 'https://ws.example')).toBeNull();
    expect(pictureUrl(null, 'https://ws.example')).toBeNull();
  });
});

describe('choosing a picture', () => {
  const limits = { max_bytes: 8 * 1048576, extensions: ['jpg', 'jpeg', 'png', 'webp'], types: ['jpg', 'png', 'webp'], min_side: 64 };
  it('refuses what the server would, before sending', () => {
    expect(refusal({ name: 'me.jpg', type: 'image/jpeg', size: 2000 }, limits)).toBeNull();
    expect(refusal({ name: 'me.gif', type: 'image/gif', size: 2000 }, limits)).toBe('A profile picture has to be a JPG, PNG or WebP.');
    expect(refusal({ name: 'me.png', type: 'image/png', size: 9 * 1048576 }, limits)).toBe('That picture is larger than 8 MB. Choose a smaller one.');
    expect(refusal({ name: 'me.png', type: 'image/png', size: 0 }, limits)).toBe('That file is empty.');
    expect(typeList(['png'])).toBe('PNG');
  });

  it('keeps the crop covering the frame, and a turn starts again from filling it', () => {
    const min = minScale(1200, 800, 0, 300);
    expect(initial(1200, 800, 300)).toEqual({ rotation: 0, scale: 300 / 800, x: 0, y: 0 });
    expect(clamp({ rotation: 0, scale: 99, x: 0, y: 0 }, 1200, 800, 300).scale).toBe(min * MAX_ZOOM);
    expect(clamp({ rotation: 0, scale: min, x: 5000, y: 0 }, 1200, 800, 300).x).toBeCloseTo(75);
    expect(rotate({ rotation: 0, scale: min * 2, x: 40, y: 0 }, 1, 1200, 800, 300)).toEqual({ rotation: 90, scale: 300 / 800, x: 0, y: 0 });
  });

  it('draws avatars from known choices only, with nothing typed becoming markup', () => {
    expect(normalise(null, 'Alex Rico')).toMatchObject({ look: 'initials', initials: 'AR', background: 'ocean', border: 'none' });
    expect(normalise({ initials: 'abcdef', background: 'neon' })).toMatchObject({ initials: 'ABC', background: 'ocean' });
    expect(initialsFrom('Nimal Kumara Perera')).toBe('NP');
    expect(avatarSvg({ initials: '<b>' })).not.toContain('<b>');
  });
});

describe('the small facts', () => {
  it('say working days as a run or a list', () => {
    expect(weekdays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(weekdays([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(weekdays([])).toBe('');
  });

  it('count days since a UTC stamp', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(daysAgo('2026-08-15 09:00:00', now)).toBe('42 days ago');
    expect(daysAgo('2026-09-25 09:00:00', now)).toBe('yesterday');
    expect(daysAgo('2026-09-26 09:00:00', now)).toBe('today');
    expect(daysAgo(null, now)).toBeNull();
  });

  it('name a zone by its city, its offset from UTC and its time now', () => {
    const f = zoneFacts('Asia/Colombo', new Date('2026-09-26T12:40:00Z'));
    expect(f.city).toBe('Colombo');
    expect(f.offset).toBe('UTC+5:30');
    expect(f.time).toMatch(/^(18|0?6)[:.]10/);
    expect(zoneFacts('UTC').offset).toBe('UTC');
  });
});
