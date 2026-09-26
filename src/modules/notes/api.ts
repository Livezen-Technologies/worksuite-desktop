import { apiUrl } from '../../core/api';
import { plainText, readableText, sanitizeHtml } from '../../core/rich';

/**
 * Notes (`/api/notes`, `/api/notebooks`, `/api/note-sections`). Stamps are
 * UTC without a zone. A body is HTML the server cleans with its rich profile;
 * a to-do is a list item that starts with ☐ or ☑ (the server keeps no
 * checkboxes), and a picture is `<img data-file-id="N">`, served from
 * `/api/notes/{id}/images/N` to whoever may read the note.
 */
export interface NoteCard {
  id: number;
  notebook_id: number | null;
  section_id: number | null;
  title: string;
  excerpt: string | null;
  tags: string[];
  color: string | null;
  is_pinned: boolean;
  is_favorite: boolean;
  is_archived: boolean;
  updated_at: string;
  /** Shared with me only. */
  role?: 'viewer' | 'editor';
  shared?: boolean;
  owner_name?: string;
}

export interface Share {
  id: number;
  user_id: number;
  name: string;
  email: string | null;
  role: 'viewer' | 'editor';
}

export interface NoteDetail extends NoteCard {
  body: string;
  created_at: string;
  my_role: 'owner' | 'editor' | 'viewer';
  shares?: Share[];
}

export interface Notebook {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
  type: string;
  count: number;
}

export interface Section {
  id: number;
  notebook_id: number;
  name: string;
  color: string | null;
  count: number;
}

export interface Version {
  id: number;
  title: string;
  excerpt: string | null;
  size: number;
  created_at: string;
}

export interface Link {
  id: number;
  entity_type: 'contact' | 'event' | 'task';
  entity_id: number;
  label: string;
  url: string;
}

export interface Stats {
  total: number;
  favorites: number;
  pinned: number;
  archived: number;
  notebooks: number;
}

export type View = 'all' | 'fav' | 'pin' | 'shared' | 'archived';

export const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'all', label: 'All notes' },
  { id: 'fav', label: 'Favorites' },
  { id: 'pin', label: 'Pinned' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'archived', label: 'Archived' },
];

/** The templates a new note can start from (the web's, and the design's descriptions). */
export const TEMPLATES: Array<{ key: string; name: string; hint: string; title: string; body: string }> = [
  { key: 'blank', name: 'Blank note', hint: 'Start from an empty page', title: 'Untitled', body: '' },
  {
    key: 'meeting',
    name: 'Meeting notes',
    hint: 'Agenda · Discussion · Decisions · Action items',
    title: 'Meeting notes',
    body: '<p><b>Date:</b> </p><p><b>Attendees:</b> </p><h2>Agenda</h2><ul><li></li></ul><h2>Discussion</h2><p><br></p><h2>Decisions</h2><ul><li></li></ul><h2>Action items</h2><ul><li>☐ </li></ul>',
  },
  { key: 'project', name: 'Project documentation', hint: 'Overview · Purpose · Scope · Milestones · Risks', title: 'Project documentation', body: '<h2>Overview</h2><p><br></p><h2>Purpose</h2><p><br></p><h2>Scope</h2><p><br></p><h2>Milestones</h2><ul><li></li></ul><h2>Risks</h2><ul><li></li></ul>' },
  { key: 'sop', name: 'Standard operating procedure', hint: 'Purpose · Steps', title: 'Standard operating procedure', body: '<h2>Purpose</h2><p><br></p><h2>Steps</h2><ol><li></li><li></li></ol><h2>Notes</h2><p><br></p>' },
  { key: 'daily', name: 'Daily journal', hint: 'Top priorities · Wins · Goals', title: 'Daily journal', body: '<h2>Top priorities</h2><ul><li>☐ </li><li>☐ </li><li>☐ </li></ul><h2>Wins</h2><ul><li></li></ul><h2>Goals</h2><ul><li></li></ul>' },
  { key: 'todo', name: 'To-do list', hint: 'Checklist of tasks', title: 'To-do list', body: '<ul><li>☐ </li><li>☐ </li><li>☐ </li></ul>' },
];

export const NOTEBOOK_COLORS = ['#23349E', '#6B3FB5', '#0E7C86', '#1F7A4D', '#B45309', '#B42318', '#B83280', '#4A5168'];

/** A note's body to show: its pictures from the note. */
export function showBody(html: string | null | undefined, noteId: number): string {
  return sanitizeHtml(html, { profile: 'rich', imageUrl: (id) => apiUrl(`/api/notes/${noteId}/images/${id}`) });
}

/** A note's body to save: cleaned, pictures kept as their file ids alone. */
export function saveBody(html: string): string {
  return sanitizeHtml(html, { profile: 'rich' });
}

export { plainText, readableText };

export type DiffPart = { text: string; kind: 'same' | 'added' | 'removed' };

/**
 * What changed between two texts, word by word (the longest common
 * subsequence), for "Compare to current". Null when the texts are too long
 * to compare quickly.
 */
export function diffWords(before: string, after: string, limit = 600_000): DiffPart[] | null {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > limit) return null;
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i]!, 'same');
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push(a[i++]!, 'removed');
    else push(b[j++]!, 'added');
  }
  while (i < n) push(a[i++]!, 'removed');
  while (j < m) push(b[j++]!, 'added');
  return out;
}
