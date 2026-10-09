import type { ProjectsChanged, ProjectTimerState, ProjectsOutboxItem } from '@shared/projects';
import type { IpcRouter } from '../../ipc/router';
import type { Database } from '../db';
import type { HttpClient } from '../http';
import type { ClaimedNotice, Incoming } from '../notifications';
import type { Vault } from '../vault';
import { ProjectNotices } from './notices';
import { ProjectsOutbox } from './outbox';
import { ProjectsTimer } from './timer';

/**
 * WorkSuite Projects in the main process (PRJ-DSK-02..04): the tray timer with its idle prompt, the offline outbox
 * and the banners with buttons, made together and registered on the router as `projects:*`.
 */
export interface ProjectsDeps {
  db: Database;
  vault: () => Vault;
  http: Pick<HttpClient, 'request'>;
  origin: () => string | null;
  /** The signed-in person who may use Projects, or null. */
  user: () => string | null;
  notify: (n: Incoming) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Opens a desktop route in the main window. */
  open: (route: string) => void;
  /** The mini timer, always on top (D02). */
  openMini: () => void;
  idleSeconds: () => number;
  /** Something changed: the screens (`projects:changed`), and the tray and the title bar's count. */
  changed: (c: ProjectsChanged) => void;
  tray: (t: ProjectTimerState) => void;
}

export interface Projects {
  timer: ProjectsTimer;
  outbox: ProjectsOutbox;
  notices: ProjectNotices;
  claim: (n: ClaimedNotice) => boolean;
  start: () => void;
  stop: () => void;
  /** The connection is back (or the computer woke): what waits is sent, then the timer read again. */
  reconnected: () => Promise<void>;
  pending: () => number;
  wipeUser: (userId: string) => void;
  register: (router: IpcRouter) => void;
}

export function createProjects(d: ProjectsDeps): Projects {
  const enabled = () => d.user() !== null;
  const outbox = new ProjectsOutbox({
    db: d.db,
    vault: d.vault,
    http: d.http,
    origin: d.origin,
    user: d.user,
    changed: (items: ProjectsOutboxItem[]) => d.changed({ outbox: items }),
  });
  const timer = new ProjectsTimer({
    http: d.http,
    enabled,
    outbox,
    notify: d.notify,
    idleSeconds: d.idleSeconds,
    changed: (s) => {
      d.tray(s);
      d.changed({ timer: s });
    },
  });
  const notices = new ProjectNotices({ db: d.db, notify: d.notify, markRead: d.markRead, open: d.open, enabled, user: d.user });

  const reconnected = async (): Promise<void> => {
    if (!enabled()) return;
    await outbox.replay();
    await timer.refresh();
  };

  return {
    timer,
    outbox,
    notices,
    claim: (n) => notices.claim(n),
    // Started with the session whether or not the bootstrap has said yet that the person has Projects: each tick
    // asks, so the timer appears when the app does and goes when it goes.
    start: () => {
      timer.start();
      notices.start();
      void outbox.replay();
    },
    stop: () => {
      timer.stop();
      notices.stop();
    },
    reconnected,
    pending: () => (enabled() ? outbox.pending() : 0),
    wipeUser: (uid) => {
      outbox.wipeUser(uid);
      notices.wipeUser(uid);
    },
    register: (router) => {
      router.handle('projects:timer', () => timer.get());
      router.handle('projects:timerRefresh', () => timer.refresh());
      router.handle('projects:timerStart', (input) => timer.begin({ taskId: input.taskId ?? null, projectId: input.projectId ?? null, billable: input.billable }));
      router.handle('projects:timerStop', (input) => timer.end(input?.note ?? undefined));
      router.handle('projects:timerSwitch', (input) => timer.switchTo({ taskId: input.taskId ?? null, projectId: input.projectId ?? null }));
      router.handle('projects:timerPause', () => timer.pause());
      router.handle('projects:timerResume', () => timer.resume());
      router.handle('projects:timerNote', (input) => timer.note(input.note));
      router.handle('projects:timerWindow', () => d.openMini());
      router.handle('projects:outbox', () => outbox.list());
      router.handle('projects:submit', (input) => outbox.submit(input));
      router.handle('projects:resolve', (input) => outbox.resolve(input.id, input.choice));
      router.handle('projects:discard', (input) => outbox.discard(input.id));
      router.handle('projects:replay', async () => {
        const r = await outbox.replay();
        const t = await timer.refresh();
        return { online: r.online && !t.offline, items: outbox.list() };
      });
    },
  };
}
