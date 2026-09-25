/**
 * Makes a server-supplied file name safe to create on any of the three
 * platforms: no separators or reserved characters, no Windows device names,
 * no leading dots that would hide it, bounded length. The extension survives.
 */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function safeFileName(input: string, fallback = 'download'): string {
  let name = String(input ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  if (!name) name = fallback;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const safeBase = RESERVED.test(base) ? `_${base}` : base;
  const maxBase = Math.max(1, 180 - ext.length);
  return `${safeBase.slice(0, maxBase)}${ext.slice(0, 32)}`;
}

/** "Report.pdf" → "Report (1).pdf" → "Report (2).pdf" … */
export function numberedName(name: string, n: number): string {
  if (n <= 0) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

/** FR-CNF-02: "<name> (<user>'s conflicted copy YYYY-MM-DD).<ext>" */
export function conflictedCopyName(name: string, user: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  const dot = name.lastIndexOf('.');
  const who = safeFileName(user, 'user').replace(/\.[^.]*$/, '');
  if (dot <= 0) return `${name} (${who}'s conflicted copy ${day})`;
  return `${name.slice(0, dot)} (${who}'s conflicted copy ${day})${name.slice(dot)}`;
}
