import type { MeetRole, RoomSettings } from './api';

/**
 * Who may do what in a meeting (worksuite-desktop#348) — the server's table,
 * here so the room shows a control only to the people the server lets use it.
 *
 * The server keeps the table in `app/Modules/Communication/Config/meet-permissions.json`
 * (`MeetPermissions` in PHP), and the web app keeps a copy as this does.
 * `tests/fixtures/meet-permissions.json` is that file, and a test holds this
 * table to it, so the three cannot drift apart. The server checks every
 * action again whatever this says: a control left out here is a control
 * nobody is offered, never one somebody could not use.
 *
 * One role per person: host, co_host, participant (anybody signed in — a
 * presenter too, who may also share a screen) or guest (joined by link, no
 * account). It comes from the connection's own metadata, which only the
 * server writes, so a role handed out in the call shows its controls the
 * moment it arrives.
 */

export type MeetingRole = 'host' | 'co_host' | 'participant' | 'guest';

export type MeetAction =
  | 'admit' | 'mute' | 'ask_unmute' | 'remove' | 'set_cohost' | 'lock' | 'stop_screen_share' | 'set_presenter'
  | 'room_settings' | 'mark_ended' | 'record' | 'end_for_all' | 'transfer_host' | 'spotlight'
  | 'pin_self' | 'raise_hand' | 'react' | 'chat' | 'invite';

/** true: may; false: never; 'setting': the room's settings decide. */
type Cell = boolean | 'setting';

export const MEETING_ROLES: MeetingRole[] = ['host', 'co_host', 'participant', 'guest'];

export const PERMISSIONS: Record<MeetAction, Record<MeetingRole, Cell>> = {
  admit: { host: true, co_host: true, participant: false, guest: false },
  mute: { host: true, co_host: true, participant: false, guest: false },
  ask_unmute: { host: true, co_host: true, participant: false, guest: false },
  remove: { host: true, co_host: true, participant: false, guest: false },
  set_cohost: { host: true, co_host: false, participant: false, guest: false },
  lock: { host: true, co_host: true, participant: false, guest: false },
  stop_screen_share: { host: true, co_host: true, participant: false, guest: false },
  set_presenter: { host: true, co_host: true, participant: false, guest: false },
  room_settings: { host: true, co_host: true, participant: false, guest: false },
  mark_ended: { host: true, co_host: true, participant: false, guest: false },
  record: { host: true, co_host: 'setting', participant: false, guest: false },
  end_for_all: { host: true, co_host: false, participant: false, guest: false },
  transfer_host: { host: true, co_host: false, participant: false, guest: false },
  spotlight: { host: true, co_host: true, participant: false, guest: false },
  pin_self: { host: true, co_host: true, participant: true, guest: true },
  raise_hand: { host: true, co_host: true, participant: true, guest: true },
  react: { host: true, co_host: true, participant: true, guest: true },
  chat: { host: true, co_host: true, participant: true, guest: true },
  invite: { host: true, co_host: true, participant: 'setting', guest: false },
};

/** The room settings the table defers to. A setting an older server leaves out reads as its default. */
export type PermissionSettings = Partial<Pick<RoomSettings, 'invite' | 'record' | 'recording'>>;

/** May this role do this here? Recording off is off for everybody. */
export function can(role: MeetingRole, action: MeetAction, settings: PermissionSettings = {}): boolean {
  const cell = PERMISSIONS[action]?.[role] ?? false;

  if (action === 'record' && settings.recording === false) return false;
  if (cell !== 'setting') return cell;
  if (action === 'invite') return (settings.invite ?? 'everyone') === 'everyone';
  if (action === 'record') return (settings.record ?? 'host') === 'hosts';
  return false;
}

/** A role as the room names it (host, cohost, presenter, participant) as the table does; a guest is always a guest. */
export function meetingRoleOf(role: MeetRole, guest: boolean): MeetingRole {
  if (guest) return 'guest';
  return role === 'host' ? 'host' : role === 'cohost' ? 'co_host' : 'participant';
}

/** What a person's row in the People panel offers. */
export type RowAction =
  | 'pin' | 'unpin' | 'spotlight' | 'unspotlight' | 'ask_unmute' | 'ask_camera' | 'mute' | 'camera_off' | 'stop_share'
  | 'make_cohost' | 'remove_cohost' | 'make_presenter' | 'remove_presenter' | 'make_host' | 'remove';

/** The person a row is about, as the room sees them. */
export interface RowTarget {
  self: boolean;
  role: MeetingRole;
  presenter?: boolean;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** Pinned for me. */
  pinned: boolean;
  /** Spotlighted for everyone. */
  spotlit: boolean;
}

/**
 * What I may do to somebody, in the order the menu lists it (#348). Only what
 * my role allows is in it — nothing is offered greyed out — so a guest's menu
 * is Pin for me, and nothing else. The host is never muted, stopped or
 * removed by anybody else, and nobody's own row has a menu.
 */
export function rowActions(viewer: MeetingRole, t: RowTarget, settings: PermissionSettings = {}): RowAction[] {
  if (t.self) return [];

  const out: RowAction[] = [];
  const may = (a: MeetAction) => can(viewer, a, settings);
  const theHost = t.role === 'host';

  if (may('pin_self')) out.push(t.pinned ? 'unpin' : 'pin');
  if (may('spotlight')) out.push(t.spotlit ? 'unspotlight' : 'spotlight');
  if (may('ask_unmute')) {
    if (!t.micOn) out.push('ask_unmute');
    if (!t.cameraOn) out.push('ask_camera');
  }
  if (!theHost && may('mute')) {
    if (t.micOn) out.push('mute');
    if (t.cameraOn) out.push('camera_off');
  }
  if (!theHost && t.sharing && may('stop_screen_share')) out.push('stop_share');
  if (!theHost && t.role !== 'guest' && may('set_cohost')) out.push(t.role === 'co_host' ? 'remove_cohost' : 'make_cohost');
  if (t.role === 'participant' && may('set_presenter')) out.push(t.presenter ? 'remove_presenter' : 'make_presenter');
  if (!theHost && t.role !== 'guest' && may('transfer_host')) out.push('make_host');
  if (!theHost && may('remove')) out.push('remove');

  return out;
}
