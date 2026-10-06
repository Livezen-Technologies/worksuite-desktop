import { actionLabel, isDataChanging, isPageType, itemApp, itemLabel, itemRoute, OFFLINE_TYPES, type ItemAction, type ItemLink, type ItemSource } from '@shared/item-links';
import { linkPrefs } from '@shared/link-prefs';
import { canOpen } from './access';
import { ApiError, apiGet, apiPatch, apiPost } from './api';
import { app, isGuest } from './app-state';
import { call, errorMessage } from './bridge';
import { switchOrganization } from './orgs';
import { openSignInPanel } from './session';
import { createStore } from './store';
import { activate, activeTab, navigate, openTab, setRoute, tabsStore } from './tabs';
import { toast } from './toasts';

/**
 * Opening a WorkSuite item link inside the app (worksuite-desktop#170).
 *
 * Whatever brought the link — another program, Universal Links, a click in
 * Mail, an action card's button — it comes here, already parsed against the
 * allow-list (shared/item-links.ts), and goes through the same steps:
 *
 *   1. guest mode: the in-app sign-in panel (every item needs an account);
 *   2. the organisation: one the person is not a member of is refused; any
 *      other becomes the current one;
 *   3. offline: a stored copy opens for what keeps one (files, notes, tasks),
 *      anything else is "Available when online";
 *   4. access: the server says whether this person may see the item (never
 *      what it is when they may not), with Request access for Drive items;
 *   5. the action: one that changes data is always confirmed first, any other
 *      when "Ask before running actions from links" is on;
 *   6. the tab: the item's existing tab comes to the front, or one opens.
 *
 * Every link that gets this far is written to the audit trail: which item,
 * which action, where the link came from, and what came of it.
 */

/** What the server says about an item (GET /api/links/items/{org}/{type}/{id}). */
export interface ItemStatus {
  allowed: boolean;
  /** ok, or why it cannot be acted on: access removed, missing, the meeting ended, the task already done. */
  state: 'ok' | 'access_removed' | 'missing' | 'ended' | 'completed';
  state_label?: string | null;
  title?: string | null;
  kind_label?: string | null;
  detail?: string | null;
  size?: number | null;
  mime?: string | null;
  sharer?: string | null;
  org_id?: string | number | null;
  can_request_access?: boolean;
  /** For a reminder: the task it is about. */
  task_id?: number | null;
}

export type ItemDialog =
  | { kind: 'confirm'; link: ItemLink; title: string; body: string; action: string; danger: boolean; run: () => void; cancel: () => void }
  | { kind: 'no-org'; link: ItemLink }
  | { kind: 'no-access'; link: ItemLink; canRequest: boolean }
  | { kind: 'offline'; link: ItemLink };

/** The dialog the shell shows for a link (ItemLinkDialog), one at a time. */
export const itemDialog = createStore<{ dialog: ItemDialog | null }>({ dialog: null });

export function closeItemDialog(): void {
  itemDialog.set({ dialog: null });
}

export interface OpenOptions {
  source: ItemSource;
  /** Mail's setting: a new tab, or in place of the tab the link was clicked in. Default: the item's own tab. */
  place?: 'new-tab' | 'current-tab' | 'auto';
  /** What the caller already knows from the server (an action card), so it is not asked twice. */
  status?: ItemStatus | null;
}

function audit(link: ItemLink, source: ItemSource, outcome: 'opened' | 'confirmed' | 'cancelled' | 'refused' | 'offline'): void {
  void call('links:audit', { org: link.org, type: link.type, id: link.id, action: link.action, source, outcome }).catch(() => undefined);
}

export function itemStatusPath(link: Pick<ItemLink, 'org' | 'type' | 'id'>): string {
  return `/api/links/items/${link.org}/${link.type}/${encodeURIComponent(link.id)}`;
}

/** The server's word on an item; null when it cannot say (an older server, or no answer). */
export async function fetchItemStatus(link: Pick<ItemLink, 'org' | 'type' | 'id'>): Promise<ItemStatus | null> {
  try {
    return await apiGet<ItemStatus>(itemStatusPath(link));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404) && e.code !== 'NOT_FOUND_ROUTE') {
      // The server answered for this item: no access, or nothing there — said the same way.
      if (e.data && typeof e.data === 'object' && 'allowed' in e.data) return e.data as ItemStatus;
      if (e.status === 403) return { allowed: false, state: 'access_removed', can_request_access: false };
    }
    return null;
  }
}

/** Whether the network is down for this window. */
function offline(): boolean {
  return app.get().status?.network === 'OFFLINE';
}

/** Opens the item's route: its own tab if one is open, otherwise where the caller asked. */
export function showItem(link: ItemLink, route: string, place: OpenOptions['place'] = 'auto'): void {
  const org = link.org;
  // Already open in a tab: that tab comes to the front.
  const existing = tabsStore.get().tabs.find((t) => t.route === route);
  if (existing) {
    activate(existing.id);
    return;
  }
  if (place === 'new-tab') {
    openTab(route, { organizationId: org });
    return;
  }
  if (place === 'current-tab') {
    const here = activeTab();
    if (here && !here.pinned) {
      setRoute(here.id, route);
      return;
    }
  }
  navigate(route, org);
}

function confirmText(link: ItemLink, action: ItemAction, status: ItemStatus | null): { title: string; body: string } {
  const what = status?.title ? `“${status.title}”` : `this ${itemLabel(link.type)}`;
  switch (action) {
    case 'done':
      return { title: 'Mark as done?', body: `${what} will be marked as done.` };
    case 'snooze':
      return { title: 'Snooze the reminder?', body: `The reminder for ${what} will come back in 15 minutes.` };
    case 'accept':
    case 'decline':
    case 'maybe':
      return { title: `${actionLabel(action)} the invitation?`, body: `Your answer to ${what} will be sent to the organiser.` };
    case 'request-access':
      return { title: 'Request access?', body: `The owner of ${what} will be asked to share it with you.` };
    case 'approve':
    case 'reject':
      return { title: `${actionLabel(action)} ${what}?`, body: `${what} opens with its approval panel, where you ${action} it. Nothing is decided until you do.` };
    case 'download':
      return { title: 'Download this file?', body: `${what} will be saved to your downloads folder.` };
    case 'join':
      return { title: 'Join the meeting?', body: `${what} opens at its join screen, where you choose your camera and microphone.` };
    default:
      return { title: `${actionLabel(action)}?`, body: `A link asks to ${actionLabel(action).toLowerCase()} ${what}.` };
  }
}

const RSVP: Partial<Record<ItemAction, string>> = { accept: 'accepted', decline: 'declined', maybe: 'tentative' };

/**
 * Runs a link's action. Only the actions with a plain, permission-checked API
 * of their own run here; Approve and Reject open the record's approval panel,
 * where the decision itself is made (and checked) by its module.
 */
export async function runItemAction(link: ItemLink, status: ItemStatus | null): Promise<string | null> {
  switch (link.action) {
    case 'download':
      await call('transfers:download', { fileId: link.id, name: status?.title || `file-${link.id}` });
      return 'Downloading.';
    case 'request-access':
      await apiPost(`${itemStatusPath(link)}/request-access`);
      return 'Access requested. You’ll be told when it’s shared with you.';
    case 'done': {
      const task = link.type === 'reminder' ? (status?.task_id ?? Number(link.id)) : Number(link.id);
      await apiPatch(`/api/tasks/${task}`, { field: 'status', value: 'done' });
      return 'Marked as done.';
    }
    case 'snooze':
      if (!link.run) return 'This reminder can be snoozed from the task.';
      await apiPost(`/api/task-reminder-runs/${link.run}/snooze`, { minutes: 15 });
      return 'Snoozed for 15 minutes.';
    case 'accept':
    case 'decline':
    case 'maybe':
      await apiPost(`/api/calendar/events/${link.id}/rsvp`, { status: RSVP[link.action] });
      return 'Answer sent.';
    case 'approve':
    case 'reject':
      return `Review it, then ${link.action} it in the approval panel.`;
    default:
      return null;
  }
}

/** Whether the action is already moot: a task already done, a meeting over. */
function alreadyDone(link: ItemLink, status: ItemStatus | null): string | null {
  if (!status) return null;
  if (status.state === 'completed' && (link.action === 'done' || link.action === 'snooze')) return status.state_label ?? 'Task already completed';
  if (status.state === 'ended' && link.type === 'meeting') return status.state_label ?? 'Meeting ended';
  return null;
}

/** Asks, through the shell's dialog, whether to go ahead; resolves false when the person says no. */
function ask(link: ItemLink, status: ItemStatus | null): Promise<boolean> {
  const t = confirmText(link, link.action, status);
  return new Promise((resolve) => {
    itemDialog.set({
      dialog: {
        kind: 'confirm',
        link,
        title: t.title,
        body: t.body,
        action: actionLabel(link.action),
        danger: link.action === 'reject' || link.action === 'decline',
        run: () => {
          closeItemDialog();
          resolve(true);
        },
        cancel: () => {
          closeItemDialog();
          resolve(false);
        },
      },
    });
  });
}

/** Whether running this link's action needs the person's yes first. */
export function needsConfirmation(link: ItemLink, prefs: { confirmActions: boolean }): boolean {
  if (!link.explicitAction) return false;
  if (isDataChanging(link.action)) return true;
  // Opening is what any link does; the rest asks when the setting says so.
  return prefs.confirmActions && link.action !== 'open' && link.action !== 'show' && link.action !== 'details';
}

export async function openItemLink(link: ItemLink, opts: OpenOptions): Promise<void> {
  const appId = itemApp(link);
  // 1. Guest mode: every item lives in an account.
  if (isGuest()) {
    openSignInPanel(appId);
    audit(link, opts.source, 'refused');
    return;
  }
  if (!canOpen(appId)) {
    toast('error', "You don't have access to this.");
    audit(link, opts.source, 'refused');
    return;
  }
  // 2. The organisation.
  const s = app.get();
  const orgs = s.bootstrap?.organizations ?? [];
  if (!orgs.some((o) => o.id === link.org)) {
    itemDialog.set({ dialog: { kind: 'no-org', link } });
    audit(link, opts.source, 'refused');
    return;
  }
  if (s.organizationId !== null && s.organizationId !== link.org) {
    if (!(await switchOrganization(link.org))) return;
  }
  const route = itemRoute(link);
  // 3. Offline.
  if (offline()) {
    if (OFFLINE_TYPES.has(link.type) && !isDataChanging(link.action)) {
      showItem(link, route, opts.place);
      audit(link, opts.source, 'offline');
    } else {
      itemDialog.set({ dialog: { kind: 'offline', link } });
      audit(link, opts.source, 'offline');
    }
    return;
  }
  // 4. Access. A page of an app (#266) is the app's to allow, which step 1 asked; the server keeps no item for it.
  const status = opts.status !== undefined ? opts.status : isPageType(link.type) ? null : await fetchItemStatus(link);
  if (status && !status.allowed) {
    itemDialog.set({ dialog: { kind: 'no-access', link, canRequest: !!status.can_request_access && (link.type === 'file' || link.type === 'folder' || link.type === 'shared') } });
    audit(link, opts.source, 'refused');
    return;
  }
  // 5. The action.
  const moot = alreadyDone(link, status);
  if (moot) toast('info', moot);
  if (!moot && link.explicitAction && link.action !== 'open') {
    if (needsConfirmation(link, linkPrefs(s.prefs)) && !(await ask(link, status))) {
      audit(link, opts.source, 'cancelled');
      showItem(link, route, opts.place);
      return;
    }
    try {
      const done = await runItemAction(link, status);
      if (done) toast('success', done);
      audit(link, opts.source, isDataChanging(link.action) ? 'confirmed' : 'opened');
    } catch (e) {
      toast('error', errorMessage(e));
      audit(link, opts.source, 'refused');
    }
  } else {
    audit(link, opts.source, 'opened');
  }
  // 6. The tab.
  if (link.action !== 'download') showItem(link, route, opts.place);
}

/** Request access, from the no-access dialog: confirmed there, so it runs straight away. */
export async function requestItemAccess(link: ItemLink): Promise<void> {
  try {
    await apiPost(`${itemStatusPath(link)}/request-access`);
    toast('success', 'Access requested. You’ll be told when it’s shared with you.');
    audit({ ...link, action: 'request-access' }, 'external', 'confirmed');
  } catch (e) {
    toast('error', errorMessage(e));
  }
}
