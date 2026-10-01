/**
 * Notes & Minutes on the server (worksuite-desktop#80): `/api/meetings/{id}/minutes`.
 */
export const SECTIONS = ['agenda', 'discussion', 'decisions'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = { agenda: 'Agenda', discussion: 'Discussion', decisions: 'Decisions' };

export interface MinutesAccess {
  /** Who reads them: everyone in the meeting, or only the people who may edit. */
  view: 'participants' | 'editors';
  /** Who edits: the organiser and host, the people given "Edit minutes", or everyone in the meeting. */
  edit: 'hosts' | 'chosen' | 'participants';
}

export interface MinutesAction {
  id: number;
  title: string;
  detail: string | null;
  assignee_id: number | null;
  assignee: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  task_id: number | null;
}

export interface MinutesPerson {
  id: number;
  user_id: number | null;
  name: string;
  email: string | null;
  role: string;
  attendance: string | null;
}

export interface Edited {
  id: number;
  name: string;
  at: string;
}

export interface MinutesView {
  meeting: { id: number; title: string; start_at: string; end_at: string; when: string };
  people: MinutesPerson[];
  sections: Record<Section, string>;
  revs: Record<Section, number>;
  edited: Record<Section, Edited | null>;
  finalised_at: string | null;
  shared_at: string | null;
  actions: MinutesAction[];
  access: MinutesAccess;
  can: { edit: boolean; manage: boolean };
}

/** What a refused save carries: the section as it is now, and who changed it. */
export interface Conflict {
  conflict: true;
  section: Section;
  html: string;
  rev: number;
  edited: Edited | null;
}
