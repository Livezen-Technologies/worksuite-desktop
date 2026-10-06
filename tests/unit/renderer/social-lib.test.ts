import { describe, expect, it } from 'vitest';
import { canPublishOn, hasLevel, socialAccess, usableAccounts } from '../../../src/modules/social-media/access';
import { capabilitiesOf, DEFAULT_CAPABILITIES, networkInfo } from '../../../src/modules/social-media/lib/networks';
import { accountStatusLabel, calendarBucket, canReschedule } from '../../../src/modules/social-media/lib/status';
import { countText, excerpt, fillVariables, findHashtags, findLinks, findMentions, splitIntoThread, tagLink, X_LINK_WEIGHT } from '../../../src/modules/social-media/lib/text';
import { brandClock, dueLabel, hhmm, inZone, parseHhmm, weekStart, whenLabel } from '../../../src/modules/social-media/lib/time';
import { checkVariant } from '../../../src/modules/social-media/lib/validate';

const caption312 = 'WorkSuite 3.2 is here. Offline mode for Desktop, PDF Studio with Acrobat-class tools, and a faster Mail inbox. '.repeat(3).slice(0, 312);

describe('caption counting (NFR-12, AC-18)', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countText('😀😀', 'code_points')).toBe(2);
    expect(countText('abc', 'code_points')).toBe(3);
  });

  it('counts Sinhala and Tamil by code point after NFC, the same however they were typed', () => {
    const sinhala = 'ශ්‍රී ලංකාව'; // with a ZWJ in ශ්‍රී
    expect(countText(sinhala, 'code_points')).toBe([...sinhala.normalize('NFC')].length);
    const tamil = 'தமிழ்நாடு';
    expect(countText(tamil, 'code_points')).toBe([...tamil].length);
    // Decomposed and composed forms of the same text count alike.
    expect(countText('é', 'code_points')).toBe(countText('é', 'code_points'));
  });

  it('weighs X the twitter-text way: links 23, emoji 2, Sinhala and Tamil 1, CJK 2', () => {
    expect(countText('see https://worksuitecloud.com/webinar?utm_source=x&utm_campaign=ws32-launch', 'x_weighted')).toBe(4 + X_LINK_WEIGHT);
    expect(countText('wks.lk/32-launch', 'x_weighted')).toBe(X_LINK_WEIGHT);
    expect(countText('👍🏽', 'x_weighted')).toBe(2);
    expect(countText('ලංකා', 'x_weighted')).toBe([...'ලංකා'].length);
    expect(countText('தமிழ்', 'x_weighted')).toBe([...'தமிழ்'].length);
    expect(countText('日本', 'x_weighted')).toBe(4);
  });

  it('does not take an e-mail address for a link', () => {
    expect(findLinks('write to hello@worksuite.lk today')).toEqual([]);
    expect(findLinks('Join at wks.lk/32-launch.').map((l) => l.url)).toEqual(['wks.lk/32-launch']);
  });
});

describe('Split into thread (SMM-CMP-004, AC-04)', () => {
  it('turns a 312-character caption into a valid 2-part X thread', () => {
    expect(countText(caption312, 'x_weighted')).toBe(312);
    const parts = splitIntoThread(caption312, 280, 'x_weighted');
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(countText(p, 'x_weighted')).toBeLessThanOrEqual(280);
    expect(parts[0]).toMatch(/\(1\/2\)$/);
    expect(parts[1]).toMatch(/\(2\/2\)$/);
    // Nothing lost: the words of the caption are all there, in order.
    const words = (s: string) => s.replace(/ \(\d\/\d\)/g, '').split(/\s+/).filter(Boolean);
    expect(words(parts.join(' '))).toEqual(words(caption312));
  });

  it('leaves a caption that fits as it is', () => {
    expect(splitIntoThread('Short and sweet.', 280, 'x_weighted')).toEqual(['Short and sweet.']);
  });

  it('cuts a long word with no spaces by grapheme', () => {
    const long = 'ශ්‍රී'.repeat(200);
    const parts = splitIntoThread(long, 280, 'x_weighted');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(countText(p, 'x_weighted')).toBeLessThanOrEqual(280);
  });
});

describe('checks (SMM-CMP-003, SMM-MED-004)', () => {
  const x = capabilitiesOf('x');
  const ig = capabilitiesOf('instagram');

  it('blocks X at 312 characters and offers the thread fix', () => {
    const r = checkVariant({ network: 'x', caps: x, text: caption312, media: [] });
    expect(r.blocking).toBe(true);
    expect(r.used).toBe(312);
    expect(r.issues[0]).toMatchObject({ level: 'error', code: 'too_long', fix: 'split_thread' });
  });

  it('passes the same caption once it is a thread', () => {
    const parts = splitIntoThread(caption312, 280, 'x_weighted');
    const r = checkVariant({ network: 'x', caps: x, text: caption312, media: [], threadParts: parts });
    expect(r.blocking).toBe(false);
  });

  it('asks Instagram for media and a 4:5–1.91:1 picture', () => {
    expect(checkVariant({ network: 'instagram', caps: ig, text: 'Hi', media: [] }).issues.map((i) => i.code)).toContain('media_required');
    const tall = checkVariant({ network: 'instagram', caps: ig, text: 'Hi', media: [{ kind: 'image', width: 1080, height: 1920, alt_text: 'x' }] });
    expect(tall.issues.find((i) => i.code === 'ratio')).toMatchObject({ level: 'error', fix: 'crop' });
    const ok = checkVariant({ network: 'instagram', caps: ig, text: 'Hi', media: [{ kind: 'image', width: 1080, height: 1350, alt_text: 'x' }] });
    expect(ok.blocking).toBe(false);
  });

  it('warns about missing alt text, and blocks when the setting requires it (SMM-CMP-015)', () => {
    const m = [{ kind: 'image' as const, width: 1080, height: 1080, name: 'a.jpg' }];
    expect(checkVariant({ network: 'facebook', caps: capabilitiesOf('facebook'), text: 'Hi', media: m }).issues.find((i) => i.code === 'alt_text')?.level).toBe('warning');
    expect(checkVariant({ network: 'facebook', caps: capabilitiesOf('facebook'), text: 'Hi', media: m, altRequired: true }).blocking).toBe(true);
  });

  it('refuses media a network cannot take, and needs a title on YouTube and a board on Pinterest', () => {
    expect(checkVariant({ network: 'x', caps: x, text: 'Deck', media: [{ kind: 'document' }] }).issues.map((i) => i.code)).toContain('media_kind');
    expect(checkVariant({ network: 'youtube', caps: capabilitiesOf('youtube'), text: 'v', media: [{ kind: 'video' }] }).issues.map((i) => i.code)).toContain('title_required');
    expect(checkVariant({ network: 'pinterest', caps: capabilitiesOf('pinterest'), text: 'p', media: [{ kind: 'image', alt_text: 'x' }] }).issues.map((i) => i.code)).toContain('board_required');
  });

  it('says a link is not clickable on Instagram', () => {
    expect(checkVariant({ network: 'instagram', caps: ig, text: 'See wks.lk/32-launch', media: [{ kind: 'image', width: 1080, height: 1080, alt_text: 'x' }] }).issues.find((i) => i.code === 'link_not_clickable')).toMatchObject({ fix: 'move_link_to_comment' });
  });

  it('takes the server’s capability set over the base one', () => {
    expect(capabilitiesOf('x', { text_limit: 25_000 }).text_limit).toBe(25_000);
    expect(capabilitiesOf('x').text_limit).toBe(DEFAULT_CAPABILITIES.x.text_limit);
  });
});

describe('links, tags and saved replies', () => {
  it('adds UTM tags with the network as source, keeping tags already there', () => {
    const u = new URL(tagLink('https://worksuitecloud.com/webinar', { source: '{network}', medium: 'social', campaign: 'ws32-launch' }, 'facebook'));
    expect(u.searchParams.get('utm_source')).toBe('facebook');
    expect(u.searchParams.get('utm_medium')).toBe('social');
    expect(u.searchParams.get('utm_campaign')).toBe('ws32-launch');
    expect(new URL(tagLink('https://a.lk/?utm_source=mail', { source: 'x' })).searchParams.get('utm_source')).toBe('mail');
    expect(tagLink('wks.lk/32', { campaign: 'c' })).toBe('https://wks.lk/32?utm_campaign=c');
  });

  it('finds hashtags (Sinhala too) and mentions', () => {
    expect(findHashtags('#WorkSuite and #ශ්‍රීලංකා #SaaS')).toEqual(['#WorkSuite', '#ශ්‍රීලංකා', '#SaaS']);
    expect(findMentions('thanks @techhubiz.lk and @kasun_r')).toEqual(['@techhubiz.lk', '@kasun_r']);
  });

  it('fills saved-reply variables and leaves unknown ones', () => {
    expect(fillVariables('Hi {first_name}, thanks from {brand} {x}', { first_name: 'Ruwan', brand: 'TechHubiz' })).toBe('Hi Ruwan, thanks from TechHubiz {x}');
  });

  it('shortens to a word boundary', () => {
    expect(excerpt('one two three four five six', 14)).toBe('one two three…');
  });
});

describe('times (SMM-SCH-002, NFR-10)', () => {
  it('reads a UTC stamp on a zone’s clock', () => {
    expect(inZone('2026-10-09T05:00:00Z', 'Asia/Colombo')).toEqual({ ymd: '2026-10-09', minutes: 630, weekday: 5 });
  });

  it('labels when a post goes out', () => {
    expect(whenLabel('2026-10-06T11:00:00Z', 'Asia/Colombo', '2026-10-06')).toBe('Today 16:30');
    expect(whenLabel('2026-10-07T05:00:00Z', 'Asia/Colombo', '2026-10-06')).toBe('Tomorrow 10:30');
    expect(whenLabel('2026-10-08T03:30:00Z', 'Asia/Colombo', '2026-10-06')).toBe('Thu 09:00');
    expect(whenLabel('2026-10-27T04:30:00Z', 'Asia/Colombo', '2026-10-06')).toBe('Tue 27 Oct, 10:00');
  });

  it('shows the brand’s clock only when it differs', () => {
    expect(brandClock('2026-10-09T05:00:00Z', 'Asia/Colombo', 'Asia/Colombo')).toBeNull();
    expect(brandClock('2026-10-09T05:00:00Z', 'Asia/Colombo', 'Europe/London')).toBe('10:30 Asia/Colombo');
  });

  it('weeks start on Monday; times parse and print', () => {
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(parseHhmm('9:05')).toBe(545);
    expect(parseHhmm('24:00')).toBeNull();
    expect(hhmm(1439)).toBe('23:59');
  });

  it('says how long is left on a reply target (SMM-INB-008)', () => {
    const now = Date.parse('2026-10-06T04:30:00Z');
    expect(dueLabel('2026-10-06T05:30:00Z', now)).toEqual({ text: 'reply within 1 h', state: 'ok' });
    expect(dueLabel('2026-10-06T04:40:00Z', now)?.state).toBe('at_risk');
    expect(dueLabel('2026-10-06T04:10:00Z', now)).toEqual({ text: 'overdue by 20 min', state: 'overdue' });
  });
});

describe('statuses', () => {
  it('names an expiring account by its days left', () => {
    expect(accountStatusLabel('expiring', '2026-10-09T04:30:00Z', Date.parse('2026-10-06T04:30:00Z'))).toBe('Expires in 3 days');
    expect(accountStatusLabel('needs_reconnect', null)).toBe('Needs reconnect');
  });

  it('colours the calendar by status and refuses to move what is out (WF-08)', () => {
    expect(calendarBucket('in_review')).toBe('in_review');
    expect(calendarBucket('partly_published')).toBe('published');
    expect(canReschedule('scheduled')).toBe(true);
    expect(canReschedule('publishing')).toBe(false);
    expect(canReschedule('published')).toBe(false);
  });

  it('knows every network’s chip', () => {
    expect(networkInfo('linkedin').short).toBe('in');
    expect(networkInfo('threads').short).toBe('@');
    expect(networkInfo('mastodon').label).toBe('mastodon');
  });
});

describe('access (§14, SMM-ACC-011, AC-05)', () => {
  it('a Contributor creates but cannot publish', () => {
    const a = socialAccess(['social.view', 'social.post.create']);
    expect(a.create).toBe(true);
    expect(a.publish).toBe(false);
    expect(canPublishOn(a, [{ my_level: 'publish' }])).toBe(false);
  });

  it('Publish needs the level on every account', () => {
    const a = socialAccess(['social.view', 'social.post.create', 'social.post.publish']);
    expect(canPublishOn(a, [{ my_level: 'publish' }, { my_level: 'manage' }])).toBe(true);
    expect(canPublishOn(a, [{ my_level: 'publish' }, { my_level: 'use' }])).toBe(false);
  });

  it('a Social Admin manages every account; others only what the server grants', () => {
    const admin = socialAccess(['social.settings.manage']);
    expect(admin.publish && admin.inbox && admin.audit).toBe(true);
    expect(hasLevel({ my_level: null }, 'manage', admin)).toBe(true);
    expect(hasLevel({ my_level: null }, 'use')).toBe(false);
    expect(usableAccounts([{ id: 1, my_level: 'use', status: 'connected' }, { id: 2, my_level: null, status: 'connected' }, { id: 3, my_level: 'manage', status: 'disconnected' }]).map((a) => a.id)).toEqual([1]);
  });

  it('a super-admin has it all', () => {
    expect(Object.entries(socialAccess(['*'])).every(([, v]) => v)).toBe(true);
  });
});
