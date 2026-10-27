import { app } from '../../core/app-state';
import { apiGet, apiPost, apiUrl } from '../../core/api';

/**
 * WorkSuite Drive (`/api/drive/*`, `/api/files/*`, `/api/folders/*`). Every
 * rule lives on the server (DriveGuard): a row carries `access`, and this
 * side only shows what that allows. Stamps are UTC without a zone.
 */
/** `comment` (worksuite-desktop#329): open it and take part in its comments, without changing it. */
export type Level = 'view' | 'comment' | 'edit' | 'full';

export interface ItemAccess {
  level: Level | null;
  owner: boolean;
  via: 'owner' | 'folder_owner' | 'direct' | 'inherited' | 'record' | null;
  can_download: boolean;
  capabilities: string[];
  reason?: string;
}

export interface DriveFile {
  id: number;
  name: string;
  description: string | null;
  extension: string | null;
  kind: string;
  mime_type: string | null;
  size: number;
  folder_id: number | null;
  folder_name: string;
  folder_path: string | null;
  has_thumb: boolean;
  version: number | null;
  downloads: number | null;
  owner_id: number | null;
  owner_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  opened_at: string | null;
  deleted_at: string | null;
  starred?: boolean;
  last_action?: string | null;
  last_at?: string | null;
  access?: ItemAccess | null;
  /** Pictures (ENH-03): a recipe is saved with the current version, and the stars given. */
  edited?: boolean;
  rating?: { mine: number | null; average: number | null } | null;
  /* Shared with me only. */
  org?: { id: number; name: string } | null;
  shared_at?: string | null;
  location?: { id: number; name: string } | null;
  related?: Array<{ type: string; id: number; kind: string; title: string; link: string | null; module: { key: string; label: string } | null }>;
}

export interface DriveFolder {
  id: number;
  parent_id: number | null;
  name: string;
  description: string | null;
  path: string | null;
  color: string | null;
  is_archived: boolean;
  is_locked: boolean;
  file_count: number;
  total_size: number;
  starred: boolean;
  access?: ItemAccess | null;
  owner_id?: number;
  owner_name?: string | null;
  children?: DriveFolder[];
  /** The product's folder (Call recordings, Tenders): it keeps its name and place (worksuite-desktop#328). */
  is_system?: boolean;
  /** "Created by Tenders", for a system folder's lock. */
  system_by?: string | null;
  /** Pinned to the top of the rail, by this person. */
  pinned?: boolean;
  /** The manual order among its siblings. */
  sort_order?: number;
  updated_at?: string | null;
}
export interface TreeNode extends DriveFolder {
  children: TreeNode[];
}

export interface Counts {
  files: number;
  folders: number;
  starred: number;
  recent: number;
  trash: number;
  used: number;
  /** Shares with me not looked at yet: the badge on Shared with me, cleared when it is opened (worksuite-desktop#164). */
  shared_new?: number;
}

export interface DriveList {
  view: string;
  files: DriveFile[];
  total: number;
  page: number;
  per_page: number;
  counts?: Counts;
  folder?: DriveFolder | null;
  breadcrumb?: Array<{ id: number; name: string }>;
  folders?: DriveFolder[];
  duplicates?: DuplicateGroup[];
  wasted?: number;
  facets?: { organizations: Array<{ id: number; name: string }>; no_company: boolean; modules: Array<{ key: string; label: string }>; locations: Array<{ id: number; name: string }> };
}

export interface DuplicateGroup {
  sha256: string;
  size: number;
  copies: number;
  wasted: number;
  files: Array<{ id: number; name: string; size: number; folder_id: number | null; folder_name: string; folder_path: string | null; created_at: string }>;
}

export interface DriveHome {
  continue: DriveFile[];
  recent: DriveFile[];
  starred: DriveFile[];
  starred_folders: Array<{ id: number; name: string; color: string | null; path: string | null; file_count: number; total_size: number }>;
  shared: Array<{ id: number; token: string; visibility: string; expires_at: string | null; downloads_used: number; file_id: number; name: string; extension: string | null; size: number }>;
  counts: Counts;
}

export interface DriveStorage {
  quota: number;
  used: number;
  by_kind: Array<{ kind: string; files: number; bytes: number }>;
  largest: DriveFile[];
  trash: { files: number; bytes: number };
  duplicates: { groups: number; wasted: number };
}

export interface Preview {
  id: number;
  kind: string;
  filename: string;
  extension: string | null;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  preview: 'image' | 'video' | 'audio' | 'pdf' | 'text' | null;
  status: 'ready' | 'unavailable' | 'blocked';
  url: string | null;
  download_url: string | null;
  thumb_url: string | null;
  poster_url: string | null;
}

/* ---- The views ---- */

export type View =
  | 'home' | 'folder' | 'recent' | 'starred' | 'shared' | 'my_shares' | 'trash' | 'large' | 'duplicates' | 'storage'
  | 'today' | 'yesterday' | 'week' | 'month'
  | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'video' | 'audio' | 'archive' | 'code' | 'design'
  | 'links' | 'notifications' | 'companies' | 'devices' | 'settings';

export const TITLES: Record<View, string> = {
  home: 'Home',
  folder: 'My Drive',
  recent: 'Recent',
  starred: 'Starred',
  shared: 'Shared with me',
  my_shares: 'Shared by me',
  trash: 'Recycle bin',
  large: 'Large files',
  duplicates: 'Duplicates',
  storage: 'Storage',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'This month',
  image: 'Images',
  pdf: 'PDFs',
  document: 'Documents',
  spreadsheet: 'Spreadsheets',
  presentation: 'Presentations',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archives',
  code: 'Code',
  design: 'Design files',
  links: 'Secure links',
  notifications: 'Drive notifications',
  companies: 'Sharing between companies',
  devices: 'Sync devices',
  settings: 'Drive settings',
};

export const EMPTY: Partial<Record<View, string>> = {
  recent: 'Files you open or edit show up here.',
  starred: 'Star a file or folder and it appears here.',
  my_shares: 'Files you have made a link for show up here.',
  large: 'Nothing over 50 MB.',
  today: 'Nothing has changed today.',
  yesterday: 'Nothing changed yesterday.',
  week: 'Nothing has changed this week.',
  month: 'Nothing has changed this month.',
};

/** The rail's Filters (by type or date): short labels, the full list in `hint` (the tooltip). */
export const GROUPS: Array<{ id: string; label: string; hint?: string; icon: string; views: View[] }> = [
  { id: 'images', label: 'Images', icon: 'file-image', views: ['image'] },
  { id: 'docs', label: 'Documents', hint: 'PDFs, documents, spreadsheets and presentations', icon: 'file-text', views: ['pdf', 'document', 'spreadsheet', 'presentation'] },
  { id: 'media', label: 'Media and other files', hint: 'Video, audio, archives, code and design files', icon: 'film', views: ['video', 'audio', 'archive', 'code', 'design'] },
  { id: 'dates', label: 'By date', hint: 'Today, yesterday, this week, this month', icon: 'calendar', views: ['today', 'yesterday', 'week', 'month'] },
];

export const LIST_VIEWS: View[] = ['recent', 'starred', 'my_shares', 'large', 'today', 'yesterday', 'week', 'month', 'image', 'pdf', 'document', 'spreadsheet', 'presentation', 'video', 'audio', 'archive', 'code', 'design'];
export const ALL_VIEWS: View[] = ['home', 'folder', 'shared', 'trash', 'duplicates', 'storage', 'links', 'notifications', 'companies', 'devices', 'settings', ...LIST_VIEWS];

/* ---- What a file is ---- */

const KINDS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico', 'avif'],
  pdf: ['pdf'],
  document: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv', 'numbers'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'avi', 'mkv', 'wmv'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  code: ['ts', 'tsx', 'js', 'jsx', 'json', 'php', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'css', 'scss', 'html', 'xml', 'yml', 'yaml', 'sql', 'sh', 'ini', 'env', 'toml', 'vue'],
  design: ['psd', 'ai', 'fig', 'sketch', 'xd', 'indd'],
};

export function extOf(name: string, ext?: string | null): string {
  return (ext || (name.includes('.') ? name.split('.').pop()! : '')).toLowerCase();
}

export function kindOf(name: string, ext?: string | null): string {
  const e = extOf(name, ext);
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(e)) return k;
  return 'other';
}

/** The design's coloured tag: light background, strong text, per kind. */
export const TONE: Record<string, string> = {
  folder: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  document: 'bg-info-bg text-brand-soft dark:bg-selection dark:text-primary',
  spreadsheet: 'bg-success-bg text-success dark:bg-success-bg dark:text-success',
  pdf: 'bg-danger-bg text-danger dark:bg-danger-bg dark:text-danger',
  video: 'bg-violet-bg text-violet-ink dark:bg-subtle dark:text-violet',
  presentation: 'bg-orange-bg text-warning dark:bg-warning-bg dark:text-warning',
  image: 'bg-teal-bg text-teal-ink dark:bg-subtle',
  archive: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2',
  code: 'bg-selection text-primary dark:bg-selection dark:text-primary',
  audio: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  design: 'bg-violet-bg text-violet-ink dark:bg-subtle dark:text-violet',
  other: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2',
};

/**
 * A file nobody means to open: one still downloading (.part, .crdownload…), an editor's temporary or lock file
 * (~$Report.docx, .~lock.Report.docx#, .swp) or the system's own (.DS_Store, Thumbs.db). Home leaves them out (#41).
 */
export function isJunkFile(name: string): boolean {
  const n = name.trim();
  return /\.(part|partial|crdownload|download|tmp|temp|swp|swo)$/i.test(n) || /^~\$/.test(n) || /^\.~lock\./i.test(n) || /^\./.test(n) || /^(thumbs\.db|desktop\.ini)$/i.test(n) || /~$/.test(n);
}

export function tagOf(name: string, ext?: string | null): string {
  return extOf(name, ext).slice(0, 4).toUpperCase() || 'FILE';
}

export function can(a: ItemAccess | null | undefined, capability: string): boolean {
  return !!a?.capabilities?.includes(capability);
}

export const OFFICE_EXTS = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'];
export const TEXT_EXTS = ['txt', 'md', 'log', 'csv', ...KINDS.code!];
export const PREVIEW_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'mp4', 'm4v', 'webm', 'ogv', 'mov', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus', ...TEXT_EXTS];
export const ZIP_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'];
export const MEDIA_EXTS = ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus'];

/**
 * What opening a file does: preview it here, read a PDF or edit an Office
 * file on the web, look inside an archive, or save it.
 */
export function openWay(f: Pick<DriveFile, 'name' | 'extension'>): 'preview' | 'code' | 'media' | 'pdf' | 'office' | 'archive' | 'download' {
  const e = extOf(f.name, f.extension);
  if (e === 'svg') return 'download';
  if (e === 'pdf') return 'pdf';
  if (OFFICE_EXTS.includes(e)) return 'office';
  if (MEDIA_EXTS.includes(e)) return 'media';
  if (TEXT_EXTS.includes(e)) return 'code';
  if (PREVIEW_EXTS.includes(e)) return 'preview';
  if (ZIP_EXTS.includes(e)) return 'archive';
  return 'download';
}

/** Pictures the image editor saves back in their own type. */
export const IMAGE_EDIT_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];

/* ---- Tree helpers ---- */

export function flatten(nodes: TreeNode[], depth = 0): Array<TreeNode & { depth: number }> {
  return nodes.flatMap((n) => [{ ...n, depth }, ...flatten(n.children, depth + 1)]);
}

export function pathTo(nodes: TreeNode[], id: number, trail: number[] = []): number[] | null {
  for (const n of nodes) {
    if (n.id === id) return trail;
    const hit = pathTo(n.children, id, [...trail, n.id]);
    if (hit) return hit;
  }
  return null;
}

/** A folder and every folder under it: where it may not be moved. */
export function subtree(nodes: TreeNode[], id: number): number[] {
  const find = (list: TreeNode[]): TreeNode | null => {
    for (const n of list) {
      if (n.id === id) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const root = find(nodes);
  return root ? flatten([root]).map((n) => n.id) : [id];
}

/* ---- Addresses ---- */

export const thumbUrl = (id: number) => apiUrl(`/api/drive/files/${id}/thumb`);

/** A signed `/media/…` address, which lives at the server's root. */
export function mediaUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^https:\/\//.test(u)) return u;
  if (u.startsWith('/media/')) {
    const origin = app.get().auth?.server?.origin;
    return origin ? `${origin}${u}` : null;
  }
  if (u.startsWith('/api/')) return apiUrl(u);
  return null;
}

/* ---- Calls used in several places ---- */

export const star = (type: 'file' | 'folder', id: number, on: boolean) => apiPost<{ starred: boolean }>('/api/drive/star', { type, id, on });
export const opened = (id: number, action: 'opened' | 'edited' | 'downloaded' = 'opened') => apiPost(`/api/drive/opened/${id}`, { action }).catch(() => undefined);
export const tree = (signal?: AbortSignal) => apiGet<{ tree: TreeNode[]; counts: Counts }>('/api/drive/tree', undefined, signal);

/** "3 files · 2 folders" and the like. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** What a selection is, for the selection bar. */
export type Key = `f:${number}` | `d:${number}`;
export const fileKey = (id: number): Key => `f:${id}`;
export const folderKey = (id: number): Key => `d:${id}`;
export function splitKeys(keys: Iterable<Key>): { files: number[]; folders: number[] } {
  const files: number[] = [];
  const folders: number[] = [];
  for (const k of keys) (k.startsWith('f:') ? files : folders).push(Number(k.slice(2)));
  return { files, folders };
}
