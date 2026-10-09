import type { Database } from '../db';
import type { ClaimedNotice, Incoming } from '../notifications';

/**
 * Projects' banners with their own buttons (PRJ-DSK-03, D02).
 *
 * The server raises them (PRJ-NTF-01/02) and the bell keeps them; the notification service hands the two kinds the
 * design gives buttons to here (`claim`) instead of showing them plainly:
 *
 *  - A change request waiting for my decision (`project.change_waiting`): Review — opens the change in the Projects
 *    app, where it is decided (online only: decisions are never kept offline).
 *  - A task of mine overdue (`project.task_overdue`): Open task — the task in the Projects app — and Snooze 1 day:
 *    the same banner again tomorrow at this time, kept on this computer so a restart does not lose it.
 *
 * They are Projects' banners (`module: projects`, `category: projects`), so the person's Projects switch and the
 * Desktop column's `cat:projects` switch silence them, with quiet hours, pause and privacy as for every banner.
 * Clicking a banner (not a button) opens the same place as its first button.
 */

export type ProjectNoticeKind = 'change' | 'overdue';

export const PROJECT_NOTICE_ACTIONS: Record<ProjectNoticeKind, readonly string[]> = {
  change: ['Review'],
  overdue: ['Open task', 'Snooze 1 day'],
};

export const SNOOZE_MS = 24 * 60 * 60_000;
const SNOOZED_KEY = 'projects_snoozed';

/** Which of Projects' notifications has buttons here, by the server's event key. */
export function projectNoticeKind(event: string | null | undefined): ProjectNoticeKind | null {
  const e = (event ?? '').toLowerCase();
  if (/^projects?[._]change[._]?waiting$/.test(e) || /^projects?\.changes?\.waiting$/.test(e)) return 'change';
  if (/^projects?[._]task[._]?overdue$/.test(e) || /^projects?\.tasks?\.overdue$/.test(e)) return 'overdue';
  return null;
}

/** The task a link names: `/tasks?task=12`, `/projects?task=12`, `/projects/3/tasks/12`. */
export function taskOfLink(link: string | null | undefined): { projectId: number | null; taskId: number } | null {
  const l = link ?? '';
  const deep = /^\/projects\/(\d+)\/tasks\/(\d+)(?:[/?#]|$)/.exec(l);
  if (deep) return { projectId: Number(deep[1]), taskId: Number(deep[2]) };
  const q = /^\/(?:tasks|projects)[^?#]*\?(?:[^#]*&)?task=(\d+)/.exec(l);
  return q ? { projectId: null, taskId: Number(q[1]) } : null;
}

/** The change a link names: `/projects/changes/7`. */
export function changeOfLink(link: string | null | undefined): number | null {
  const m = /^\/projects\/changes\/(\d+)(?:[/?#]|$)/.exec(link ?? '');
  return m ? Number(m[1]) : null;
}

/** Where a banner of each kind opens in the Projects app. */
export function noticeRoute(kind: ProjectNoticeKind, link: string | null | undefined): string {
  if (kind === 'change') {
    const id = changeOfLink(link);
    return id ? `/projects/changes/${id}` : '/projects/changes';
  }
  const t = taskOfLink(link);
  if (!t) return '/projects/my-work';
  return t.projectId ? `/projects/${t.projectId}/tasks/${t.taskId}` : `/projects/my-work?task=${t.taskId}`;
}

interface Snoozed {
  until: number;
  notice: ClaimedNotice;
  times: number;
}

export interface ProjectNoticeDeps {
  db: Database;
  notify: (n: Incoming) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Opens a desktop route in the main window, as a banner's click does. */
  open: (route: string) => void;
  /** Signed in, with Projects. */
  enabled: () => boolean;
  user: () => string | null;
  now?: () => number;
}

export class ProjectNotices {
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly d: ProjectNoticeDeps) {
    this.now = d.now ?? Date.now;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref?.();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** True when the notification is one of Projects' with buttons, now shown here. */
  claim(n: ClaimedNotice): boolean {
    const kind = projectNoticeKind(n.event);
    if (!kind || !this.d.enabled()) return false;
    this.raise(kind, n, n.id);
    return true;
  }

  private raise(kind: ProjectNoticeKind, n: ClaimedNotice, id: string): void {
    const route = noticeRoute(kind, n.link);
    const readId = /^\d+$/.test(n.id) ? n.id : null;
    this.d.notify({
      id,
      readId,
      module: 'projects',
      category: 'projects',
      title: n.title,
      body: n.body,
      sender: null,
      link: route,
      critical: false,
      custom: {
        actions: [...PROJECT_NOTICE_ACTIONS[kind]],
        onAction: async (index) => {
          if (index === 1 && kind === 'overdue') {
            this.snooze(n);
            return;
          }
          this.d.open(route);
          if (readId) await this.d.markRead([readId]).catch(() => undefined);
        },
      },
    });
  }

  private key(): string | null {
    const u = this.d.user();
    return u ? `${SNOOZED_KEY}:${u}` : null;
  }

  private snoozed(): Snoozed[] {
    const k = this.key();
    if (!k) return [];
    try {
      return this.d.db.getConfig<Snoozed[]>(k) ?? [];
    } catch {
      return [];
    }
  }

  /** Snooze 1 day: the same banner again tomorrow, kept on this computer. */
  snooze(n: ClaimedNotice): void {
    const k = this.key();
    if (!k) return;
    const list = this.snoozed().filter((s) => s.notice.id !== n.id);
    const times = (this.snoozed().find((s) => s.notice.id === n.id)?.times ?? 0) + 1;
    this.d.db.setConfig(k, [...list, { until: this.now() + SNOOZE_MS, notice: n, times }].slice(-100));
  }

  /** Every minute: a snoozed banner whose day has passed comes back. */
  tick(): void {
    const k = this.key();
    if (!k || !this.d.enabled()) return;
    const list = this.snoozed();
    const due = list.filter((s) => s.until <= this.now());
    if (!due.length) return;
    this.d.db.setConfig(
      k,
      list.filter((s) => s.until > this.now()),
    );
    for (const s of due) {
      const kind = projectNoticeKind(s.notice.event);
      if (kind) this.raise(kind, s.notice, `${s.notice.id}:again:${s.times}`);
    }
  }

  /** Signed out with WorkSuite's data removed: the snoozed banners go too. */
  wipeUser(userId: string): void {
    this.d.db.deleteConfig(`${SNOOZED_KEY}:${userId}`);
  }
}
