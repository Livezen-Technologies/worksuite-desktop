/**
 * A person's own room (WS-MEET-ENH-01 D01), as this app understands it.
 *
 * **The server is the authority on every rule here.**
 * `Modules\Communication\Libraries\MeetCode::isSlug` and `PersonalRoom::why`
 * decide what a name may be, and a rename is accepted or refused there. This
 * copy exists so somebody typing a name is told what is wrong with it before
 * they press anything — and the refusals it produces are worded the same way,
 * so a name refused here and a name refused there do not read like two
 * different products disagreeing.
 *
 * If the two ever drift, the server wins and its message is shown: that is why
 * `rename` surfaces the server's own text rather than keeping this one.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;

/** Names WorkSuite itself means something by. Mirrors `MeetCode::SLUG_RESERVED`. */
export const SLUG_RESERVED = [
  'meet', 'new', 'join', 'guest', 'support', 'personal', 'resolve', 'admin', 'api', 'settings',
  'recordings', 'recording', 'sessions', 'session', 'breakout', 'breakouts', 'host', 'me', 'you', 'everyone',
];

export interface PersonalRoomView {
  uuid: string;
  /** Empty when every name near theirs was taken; the room still works by its ID. */
  slug: string;
  title: string;
  /** The link people are given: `/meet/<name>`, or `/meet/<uuid>` without a name. */
  url: string;
  code: string;
  locked: boolean;
  passcode: string | null;
  room_id?: number | null;
}

export function isSlug(value: string): boolean {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return false;
  if (value.length < SLUG_MIN || value.length > SLUG_MAX) return false;

  const bare = value.replace(/-/g, '');

  // Eight or more characters of nothing but 0-9 and a-f is a meeting ID (nine)
  // or the front of a uuid (eight). A short name that happens to be hex —
  // "ada", "cafe" — is somebody's name, not a code.
  if (bare.length >= 8 && /^[0-9a-f]+$/.test(bare)) return false;
  // Every other code in this product is digits, and the join box reads a run
  // of them as one of those long before it would read it as a name.
  if (/^[0-9]+$/.test(bare)) return false;

  return !SLUG_RESERVED.includes(value);
}

/** Why a name was refused, in the words of the rule it broke. Empty when it is fine. */
export function why(raw: string): string {
  const value = raw.trim().toLowerCase();

  if (value === '') return 'A name is needed.';
  if (value.length < SLUG_MIN) return `A name needs at least ${SLUG_MIN} characters.`;
  if (value.length > SLUG_MAX) return `A name can be at most ${SLUG_MAX} characters.`;
  if (SLUG_RESERVED.includes(value)) return 'That word is used by WorkSuite itself. Try another.';

  const bare = value.replace(/-/g, '');

  if (bare.length >= 8 && /^[0-9a-f]+$/.test(bare)) return 'A name that long made only of 0-9 and a-f would read as a meeting ID. Add another letter.';
  if (/^[0-9]+$/.test(bare)) return 'A name of only digits would read as a meeting or support code. Add a letter.';
  if (!isSlug(value)) return 'Use letters, numbers and single hyphens — "hasarinda" or "design-team".';

  return '';
}

/** What a link reads as on screen: the host and path, without the scheme nobody says out loud. */
export function linkLabel(url: string | null | undefined): string {
  return String(url ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
