import { describe, expect, it } from 'vitest';
import { isSlug, linkLabel, why } from '../../../shared/personal-room';

/**
 * A personal room's name, as this app checks it before asking (D01).
 *
 * The server decides — `MeetCode::isSlug` and `PersonalRoom::why` — and these
 * are the same rules so that somebody typing a name learns what is wrong with
 * it without a round trip. What they protect is the boundary between the two
 * namespaces: a meeting ID is nine characters of 0-9 and a-f, and a name may
 * not be able to pass for one.
 */

describe('what a name may be', () => {
  it('takes letters, numbers and single hyphens', () => {
    for (const ok of ['hasarinda', 'design-team', 'nadeesha-perera', 'room-42', 'abc', 'cafe']) expect(isSlug(ok)).toBe(true);
  });

  it('refuses anything that could pass for a meeting ID or a code', () => {
    for (const no of ['4f29a1c07', 'deadbeef', 'dead-beef', '4f29a1c0', '12345', '847291663']) expect(isSlug(no)).toBe(false);
  });

  it('refuses the words WorkSuite means something by', () => {
    for (const no of ['meet', 'join', 'support', 'guest', 'settings', 'admin']) expect(isSlug(no)).toBe(false);
  });

  it('refuses a shape nobody can read out', () => {
    for (const no of ['-hasarinda', 'hasarinda-', 'has--arinda', 'has arinda', 'Hasarinda', 'ha', 'a'.repeat(33)]) expect(isSlug(no)).toBe(false);
  });
});

describe('why a name was refused', () => {
  it('names the rule rather than saying invalid', () => {
    expect(why('ab')).toMatch(/at least 3/);
    expect(why('a'.repeat(33))).toMatch(/at most 32/);
    expect(why('support')).toMatch(/WorkSuite itself/);
    expect(why('deadbeef')).toMatch(/meeting ID/);
    expect(why('12345')).toMatch(/digits/);
    expect(why('has arinda')).toMatch(/single hyphens/);
    expect(why('')).toMatch(/needed/);
  });

  it('says nothing at all about a name that is fine', () => {
    expect(why('hasarinda')).toBe('');
    expect(why('  Design-Team  ')).toBe('');
  });
});

describe('the link on screen', () => {
  it('drops the scheme nobody says out loud', () => {
    expect(linkLabel('https://app.worksuite.lk/meet/hasarinda')).toBe('app.worksuite.lk/meet/hasarinda');
    expect(linkLabel('http://localhost:8080/meet/abc/')).toBe('localhost:8080/meet/abc');
  });
});

describe('a payload that is not a room', () => {
  it('reads as no link rather than crashing', () => {
    // An older server, or a proxy answering 200 with something else: the card
    // checks for the two fields it is made of, and this is the helper's half.
    expect(linkLabel(undefined)).toBe('');
    expect(linkLabel(null)).toBe('');
    expect(linkLabel('')).toBe('');
  });
});
