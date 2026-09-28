import type { SyncPolicy } from '@shared/types';

/**
 * The small rules Drive sync applies everywhere: what a path's key is, what
 * is never synced, and what a name must look like on this computer.
 *
 * Pure: no filesystem, no network, so each rule is tested directly.
 */

/** The server's block size (SyncEngine::BLOCK_SIZE). Changing it invalidates every manifest. */
export const BLOCK_SIZE = 4 * 1024 * 1024;

/**
 * Never synced, whatever the policy says: the operating systems' and the
 * editors' leftovers, and this app's own partial downloads. Matched against a
 * name and against the whole relative path, like the server's fnmatch.
 */
export const ALWAYS_IGNORED = [
  '.DS_Store',
  '._*',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '.TemporaryItems',
  'Icon\r',
  'Thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '$RECYCLE.BIN',
  'System Volume Information',
  '~$*',
  '.~lock.*#',
  '.#*',
  '*.swp',
  '*.tmp',
  '*.temp',
  '*.crdownload',
  '*.part',
  '*.partial',
  '*.download',
  '*.wsync-part',
  '.worksuite-sync*',
];

/** Leftovers that may be removed so an otherwise-empty folder can go. */
export const JUNK = ['.DS_Store', 'Thumbs.db', 'ehthumbs.db', 'desktop.ini', 'Icon\r'];

const compiled = new Map<string, RegExp>();

/** fnmatch without FNM_PATHNAME and with FNM_CASEFOLD — what the server applies to `ignored_patterns`. */
export function globToRegExp(pattern: string): RegExp {
  const hit = compiled.get(pattern);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, end).replace(/\\/g, '\\\\');
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      re += `[${body}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`, 'is');
  compiled.set(pattern, out);
  return out;
}

export function nameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

export function parentOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

export function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function depthOf(rel: string): number {
  return rel === '' ? 0 : rel.split('/').length;
}

/** `rel` is `prefix` or inside it (both keys, or both relative paths). */
export function isUnder(rel: string, prefix: string): boolean {
  return prefix === '' || rel === prefix || rel.startsWith(`${prefix}/`);
}

/** `rel` with its leading `from` replaced by `to` — how a folder's move carries what is inside it. */
export function rebaseRel(rel: string, from: string, to: string): string {
  return rel === from ? to : `${to}${rel.slice(from.length)}`;
}

/**
 * The key two paths are the same file by. Unicode is compared composed (macOS
 * hands out decomposed names), and on the case-insensitive filesystems macOS
 * and Windows use by default, without case: "Report.pdf" and "report.pdf"
 * cannot both exist there, so they must not both be synced there.
 */
export function makeKey(caseInsensitive: boolean): (rel: string) => string {
  return caseInsensitive ? (rel) => rel.normalize('NFC').toLowerCase() : (rel) => rel.normalize('NFC');
}

export function isIgnored(rel: string, patterns: readonly string[]): boolean {
  const name = nameOf(rel);
  for (const p of ALWAYS_IGNORED) if (globToRegExp(p).test(name) || globToRegExp(p).test(rel)) return true;
  for (const raw of patterns) {
    const p = raw.trim();
    if (p && (globToRegExp(p).test(name) || globToRegExp(p).test(rel))) return true;
  }
  return false;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Why the policy keeps this file out of sync (SyncEngine::refuse), or null. Ignore patterns are separate: those are silent. */
export function policyRefusal(policy: SyncPolicy | null, name: string, size: number): string | null {
  if (!policy) return null;
  if (policy.max_file_bytes > 0 && size > policy.max_file_bytes) {
    return `This file is ${humanBytes(size)}; the limit for synced files is ${humanBytes(policy.max_file_bytes)}.`;
  }
  const ext = extensionOf(name);
  if (ext && policy.blocked_types.some((t) => t.trim().replace(/^\./, '').toLowerCase() === ext)) {
    return `.${ext} files are not synced on this installation.`;
  }
  return null;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Why a name from Drive cannot be created in this folder on this computer, or null. */
export function localNameProblem(name: string, platform: NodeJS.Platform): string | null {
  if (!name || name === '.' || name === '..') return 'It has no name this computer can use.';
  // eslint-disable-next-line no-control-regex
  if (/[/\u0000]/.test(name)) return 'Its name has a slash in it, which no computer allows.';
  if (platform === 'win32') {
    // eslint-disable-next-line no-control-regex
    if (/[<>:"\\|?*\u0001-\u001f]/.test(name)) return 'Its name has a character Windows does not allow (< > : " \\ | ? *).';
    if (/[. ]$/.test(name)) return 'Its name ends in a dot or a space, which Windows does not allow.';
    if (WINDOWS_RESERVED.test(name)) return 'Its name is one Windows keeps for itself.';
  }
  if (Buffer.byteLength(name, 'utf8') > 255) return 'Its name is too long for this computer.';
  return null;
}

/** Why a name on this computer cannot go to Drive, or null (the server refuses slashes and backslashes). */
export function driveNameProblem(name: string): string | null {
  if (name.includes('\\')) return 'Drive does not allow a backslash in a name.';
  if ([...name].length > 255) return 'Drive does not allow names longer than 255 characters.';
  return null;
}

/**
 * Removable and external volumes, where the policy says whether sync may go.
 * macOS and Linux mount them in known places; on Windows the drive type needs
 * a native call this app does not make, so a drive letter is not judged.
 */
export function looksRemovable(path: string, platform: NodeJS.Platform): boolean {
  if (platform === 'darwin') return /^\/Volumes\//.test(path);
  if (platform === 'linux') return /^\/(media|mnt|run\/media)\//.test(path);
  return false;
}

export function humanBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${v} B` : `${v.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}
