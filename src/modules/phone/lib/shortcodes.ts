/**
 * Short codes, checked on this computer before the server is asked (design A09 "Check 200 · free"). The server's
 * `ShortCodes::check` is the authority — it also knows every extension, queue, ring group and IVR on the switch —
 * so this only catches what can be known without it: the shape, and Asterisk's reserved feature codes.
 */

/** Reserved by Asterisk/FreePBX and never allocated (`ShortCodes::RESERVED`). */
export const RESERVED_CODES: readonly string[] = ['*97', '*98', '*72', '*73', '*69', '*77', '*78', '*79', '70', '71', '*11', '*43', '*60', '*65', '*76', '666'];

/** What each reserved code does, for the note under the table. */
export const RESERVED_NOTE = '*97 voicemail · *72/*73 forwarding · 70–71 parking · *43 echo test · 666';

export type LocalCheck = { ok: true } | { ok: false; reason: string };

export function localCheck(raw: string): LocalCheck {
  const code = raw.trim();
  if (!code) return { ok: false, reason: 'Type a code.' };
  if (!/^[0-9*#]{1,12}$/.test(code)) return { ok: false, reason: 'A short code is digits, * and # only.' };
  if (RESERVED_CODES.includes(code)) return { ok: false, reason: `${code} is a reserved feature code on Asterisk.` };
  return { ok: true };
}

export const TARGET_KINDS = ['extension', 'department', 'queue', 'ring_group', 'ivr', 'voicemail', 'external', 'feature'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const TARGET_LABEL: Record<TargetKind, string> = {
  extension: 'Extension',
  department: 'Department',
  queue: 'Queue',
  ring_group: 'Ring group',
  ivr: 'IVR',
  voicemail: 'Voicemail',
  external: 'External',
  feature: 'Feature',
};
