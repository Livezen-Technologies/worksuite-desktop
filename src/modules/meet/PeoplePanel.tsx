import { useState, useSyncExternalStore } from 'react';
import type { Participant } from 'livekit-client';
import { cx } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { CallAvatar } from '../calls/parts';
import { HandQueue } from './Activities';
import { AddPeopleDialog, Invitations } from './InvitePeople';
import { badgeRole } from './invites';
import { useMeetT, type MKey } from './i18n';
import { rowActions, type RowAction } from './permissions';
import { RoleBadge, TransferHostDialog } from './RoomRoles';
import { isGuest, meet, meetingRoleOfParticipant, roleOf, userIdOf } from './session';

/**
 * The People tab in a meeting (worksuite-desktop#348): who is waiting, who is
 * in, and what I may do to each of them. Every control here is asked of the
 * permission table (`permissions.ts`), so it is shown only to the people the
 * server lets use it: the waiting room and Mute all are not there at all for
 * a participant or a guest, and their row menus offer Pin for me. A role
 * given or taken away in the call arrives on my connection, and the panel
 * re-renders with it.
 */

/** What each row action is called, and what it does to the person (#348). */
const ROW: Record<RowAction, { label: MKey; danger?: boolean }> = {
  pin: { label: 'hc.row.pin' },
  unpin: { label: 'hc.row.unpin' },
  spotlight: { label: 'hc.row.spotlight' },
  unspotlight: { label: 'hc.row.unspotlight' },
  ask_unmute: { label: 'hc.row.askUnmute' },
  ask_camera: { label: 'hc.row.askCamera' },
  mute: { label: 'hc.row.mute' },
  camera_off: { label: 'hc.row.cameraOff' },
  stop_share: { label: 'hc.row.stopShare' },
  make_cohost: { label: 'hc.row.makeCohost' },
  remove_cohost: { label: 'hc.row.removeCohost' },
  make_presenter: { label: 'hc.row.makePresenter' },
  remove_presenter: { label: 'hc.row.removePresenter' },
  make_host: { label: 'hc.row.makeHost' },
  remove: { label: 'hc.row.remove', danger: true },
};

export function PeoplePanel() {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const t = useMeetT();
  const [menu, setMenu] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ id: number; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const room = meet.room!;
  const present: Participant[] = [room.localParticipant, ...meet.present];
  const link = 'text-[12px] font-semibold text-primary hover:underline';
  const item = 'block w-full px-3 py-1.5 text-left hover:bg-subtle disabled:opacity-50';
  const settings = meet.settings;
  const me = meet.meetingRole;
  const spotlight = meet.spotlight;
  // Mute all: everyone else whose microphone is on, but the host's (#348).
  const unmuted = meet.present.filter((p) => p.isMicrophoneEnabled && roleOf(p) !== 'host').length;
  const run = (a: RowAction, p: Participant, uid: number, name: string) => {
    switch (a) {
      case 'pin': return meet.pin(p);
      case 'unpin': return meet.pin(null);
      case 'spotlight': return void meet.spotlightFor(p);
      case 'unspotlight': return void meet.spotlightFor(null);
      case 'ask_unmute': return void meet.askToTurnOn(p, 'microphone');
      case 'ask_camera': return void meet.askToTurnOn(p, 'camera');
      case 'mute': return void meet.mute(p);
      case 'camera_off': return void meet.cameraOff(p);
      case 'stop_share': return void meet.stopShare(p);
      case 'make_cohost': return void meet.cohost(uid, true);
      case 'remove_cohost': return void meet.cohost(uid, false);
      case 'make_presenter': return void meet.presenter(uid, true);
      case 'remove_presenter': return void meet.presenter(uid, false);
      case 'make_host': return setTransfer({ id: uid, name });
      case 'remove': return void meet.remove(p);
    }
  };
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {/* The waiting room is for whoever may admit: nobody else sees it at all (#348). */}
      {meet.can('admit') && meet.waiting.length ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] p-2.5 dark:bg-warning-bg">
          <div className="flex items-center gap-2">
            <b className="flex-1 text-ink">Waiting to join · {meet.waiting.length}</b>
            <button type="button" className={link} onClick={() => void Promise.all(meet.waiting.map((p) => meet.admit(p)))}>Admit all</button>
            <button type="button" className="text-[12px] font-semibold text-danger hover:underline" onClick={() => void Promise.all(meet.waiting.map((p) => meet.remove(p)))}>Deny all</button>
          </div>
          {meet.waiting.map((p) => (
            <div key={p.identity} className="flex items-center gap-2">
              <b className="min-w-0 flex-1 truncate text-ink">{p.name || 'Guest'}</b>
              <span className="text-[11.5px] text-ink-3">{isGuest(p) ? 'Guest · by link' : 'Signed in'}</span>
              <button type="button" onClick={() => void meet.admit(p)} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white">Admit</button>
              <button type="button" onClick={() => void meet.remove(p)} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink">Deny</button>
            </div>
          ))}
        </div>
      ) : null}
      <HandQueue />
      <div className="flex items-center gap-2">
        <b className="flex-1 text-ink">In the meeting · {present.length}</b>
        {meet.can('mute') ? (
          <button type="button" disabled={!unmuted} onClick={() => void meet.muteAll()} className="flex h-7 items-center rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
            {t('hc.muteAll')}
          </button>
        ) : null}
        {meet.mayInvite ? (
          <button type="button" onClick={() => setAdding(true)} className="flex h-7 items-center gap-1 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white hover:bg-primary-hover">
            + Add people
          </button>
        ) : null}
      </div>
      {present.map((p) => {
        const self = p === room.localParticipant;
        const uid = userIdOf(p);
        // Host and co-hosts as the meeting names them (#347); the connection's word for anybody else.
        const role = badgeRole(uid, self ? meet.role : roleOf(p), meet.info);
        const hand = meet.handOf(p);
        const state = p.isSpeaking ? 'Speaking' : !p.isMicrophoneEnabled ? 'Muted' : '';
        const name = p.name || 'Guest';
        // Only what my role may do to them (#348): nothing greyed out, nothing the server would refuse.
        const actions = rowActions(me, {
          self,
          role: role === 'host' ? 'host' : role === 'cohost' ? 'co_host' : meetingRoleOfParticipant(p) === 'guest' ? 'guest' : 'participant',
          presenter: role === 'presenter',
          micOn: p.isMicrophoneEnabled,
          cameraOn: p.isCameraEnabled,
          sharing: p.isScreenShareEnabled,
          pinned: meet.pinned === p.identity,
          spotlit: spotlight === p.identity,
        }, settings);
        const entries = actions.map((a) => ({
          id: a,
          label: a === 'make_presenter' && settings.present === 'presenters' ? t('hc.row.makePresenterShare') : t(ROW[a].label),
          danger: ROW[a].danger,
          onClick: () => run(a, p, uid, name),
        }));
        return (
          <div key={p.identity} className="relative flex items-center gap-2.5">
            <CallAvatar name={p.name || p.identity} size={30} />
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{self ? `${p.name || 'You'} (you)` : name}</b>
              <span className="flex items-center gap-1.5">
                <RoleBadge role={role} guest={isGuest(p)} />
                {isGuest(p) ? <span className="text-[11px] text-ink-3">by link</span> : null}
                {hand ? (
                  <span role="img" aria-label={`${t('act.handUp')} · ${hand.position}`} title={t('act.handUp')} className="flex items-center gap-0.5 rounded-full bg-[#FFF4E0] px-1.5 py-px text-[10.5px] font-bold text-[#9A5B00] dark:bg-[#3A2A10] dark:text-[#F6C77A]">
                    <Icon name="hand" size={11} />
                    {hand.position}
                  </span>
                ) : null}
              </span>
            </span>
            <span className={cx('text-[11.5px] font-semibold', p.isSpeaking ? 'text-success' : 'text-ink-3')}>{state}</span>
            {entries.length ? (
              <>
                <button type="button" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={menu === p.identity} onClick={() => setMenu(menu === p.identity ? null : p.identity)} className="h-7 w-7 rounded-[7px] text-ink-2 hover:bg-subtle">⋯</button>
                {menu === p.identity ? (
                  <div role="menu" className="absolute top-8 right-0 z-10 w-56 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
                    {entries.map((e) => (
                      <button key={e.id} type="button" role="menuitem" onClick={() => (setMenu(null), e.onClick())} className={cx(item, e.danger && 'text-danger')}>
                        {e.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
      <Invitations />
      {transfer ? <TransferHostDialog person={transfer} onClose={() => setTransfer(null)} /> : null}
      {adding ? <AddPeopleDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
