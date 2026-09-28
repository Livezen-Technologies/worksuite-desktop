import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Participant } from 'livekit-client';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { bytes, dateLabel, parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Empty, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { CallAvatar, useNow } from '../calls/parts';
import { ScreenPicker } from '../calls/ScreenPicker';
import { CallWorkspace } from '../calls/ui/CallWorkspace';
import type { ControlButton, MenuEntry } from '../calls/ui/CoreCallControls';
import { personOf } from '../calls/ui/people';
import { callUi } from '../calls/ui/state';
import { Thread } from '../chat/Thread';
import type { ChatFile } from '../chat/types';
import { formatCode, invitation } from './api';
import { ShareInChat, ShareRow } from './MeetHome';
import { remote } from './remote/controller';
import { RemoteControlLayer } from './remote/ControllerSurface';
import { isGuest, meet, metaOf } from './session';
import { Whiteboard } from './Whiteboard';
import { Select } from '../../components/Select';

/** 00:24:10 — how long the meeting has been going. */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * The meeting room (MeetRoom) on the shared call surface (CallWorkspace): a
 * shared screen or the whiteboard is the main view with people in the
 * corner, else the speaker or a grid; People, Chat, Board, Files and Info
 * in one panel beside it; one compact control bar. Full screen, the
 * floating card and maximise are in the header.
 */
export function MeetRoom() {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const ui = useSyncExternalStore(callUi.subscribe, callUi.get);
  const [picking, setPicking] = useState<'start' | 'change' | null>(null);
  const [ending, setEnding] = useState(false);
  const now = useNow();
  const room = meet.room!;
  const lp = room.localParticipant;
  const info = meet.info!;
  const participants: Participant[] = [lp, ...meet.present];
  const people = participants.map((p) => personOf(p, p === lp, { host: metaOf(p).host || (p === lp && meet.isHost), guest: isGuest(p) }));
  const started = info.started_at ? parseTs(info.started_at).getTime() : meet.joinedAt;
  const clock = started ? hms(now - started) : '';
  const waiting = meet.waiting;
  const sharing = lp.isScreenShareEnabled;
  const paused = meet.sharePaused;
  const copyLink = () => void navigator.clipboard.writeText(info.join_url).then(() => toast('success', 'Join link copied.'));
  // Sharing and control in this meeting, as the server sees it: asking to control a shared screen, and controlling it.
  const uuid = meet.uuid;
  useEffect(() => remote.start(uuid), [uuid]);
  // Whether this computer can be controlled, for the picker's "Let people ask to control" (RC01).
  const rcView = useQuery({ queryKey: ['rc-state'], queryFn: () => call('rc:state'), enabled: picking === 'start', staleTime: 0 });
  const pickerControl = rcView.data
    ? {
        allowRequests: rcView.data.allowRequests,
        unavailable: !rcView.data.support.policyAllows ? "This computer's policy doesn't let others control it." : rcView.data.support.available ? null : rcView.data.support.reason,
      }
    : undefined;
  const controlNote = sharing && meet.control ? (meet.control.offered ? ' · others can ask to control it' : '') : '';
  const panelOn = (tab: string) => ui.panelOpen && ui.panelTab === tab;

  const buttons: ControlButton[] = [
    { id: 'mic', icon: lp.isMicrophoneEnabled ? 'mic' : 'mic-off', label: lp.isMicrophoneEnabled ? 'Mute' : 'Unmute', tone: lp.isMicrophoneEnabled ? undefined : 'warn', onClick: () => void meet.toggleMic() },
    { id: 'camera', icon: lp.isCameraEnabled ? 'video' : 'video-off', label: lp.isCameraEnabled ? 'Turn camera off' : 'Turn camera on', tone: lp.isCameraEnabled ? undefined : 'warn', onClick: () => void meet.toggleCamera() },
    sharing
      ? {
          id: 'share',
          icon: 'screen-share',
          label: 'Sharing — options',
          tone: 'active',
          menu: [
            { heading: `Sharing ${meet.shareLabel ?? 'your screen'}` },
            { label: 'Share something else', hint: 'Another screen or window, without stopping', icon: 'monitor', onClick: () => setPicking('change') },
            { label: paused ? 'Resume sharing' : 'Pause sharing', hint: paused ? undefined : 'The others see "Screen sharing paused"', icon: paused ? 'play' : 'pause', onClick: () => void meet.pauseShare(!paused) },
            { label: 'Stop sharing', icon: 'stop', danger: true, onClick: () => void meet.share(null) },
          ],
        }
      : { id: 'share', icon: 'screen-share', label: 'Share your screen', onClick: () => setPicking('start') },
    { id: 'chat', icon: 'chat', label: panelOn('Chat') ? 'Hide chat' : 'Chat', tone: panelOn('Chat') ? 'active' : undefined, onClick: () => callUi.togglePanel('Chat') },
    { id: 'people', icon: 'users', label: 'People', tone: panelOn('People') ? 'active' : undefined, badge: meet.isHost ? waiting.length : undefined, onClick: () => callUi.togglePanel('People') },
    { id: 'board', icon: 'board', label: ui.boardOnStage ? 'Take the board off the stage' : 'Whiteboard', tone: ui.boardOnStage || panelOn('Board') ? 'active' : undefined, onClick: () => (ui.boardOnStage ? callUi.set({ boardOnStage: false }) : callUi.togglePanel('Board')) },
  ];
  const more: MenuEntry[] = [
    // Reachable even when their screen is not on the stage (the board is, or the floating card).
    ...(remote.session ? [{ label: 'Release control', hint: `Of ${remote.session.sharer.name}'s computer`, icon: 'stop', danger: true, onClick: () => void remote.release() }] : []),
    ...(meet.isHost ? [{ label: room.isRecording ? 'Stop recording' : 'Record the meeting', icon: room.isRecording ? 'stop' : 'film', onClick: () => void meet.record(!room.isRecording) }] : []),
    { label: ui.boardOnStage ? 'Board back to the panel' : 'Whiteboard on stage', icon: 'board', onClick: () => callUi.set({ boardOnStage: !ui.boardOnStage, ...(ui.boardOnStage ? {} : { panelOpen: false }) }) },
    { label: 'Files', icon: 'paperclip', onClick: () => callUi.togglePanel('Files') },
    { label: 'Meeting details', icon: 'info', onClick: () => callUi.togglePanel('Info') },
    { label: 'Copy join link', icon: 'link', onClick: copyLink },
  ];

  const alerts =
    meet.error || (meet.isHost && waiting.length) ? (
      <>
        {meet.error ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-[#3A1A14] px-3 py-2 text-[12.5px] text-[#FFD2C4]" role="alert">
            <span className="flex-1">{meet.error}</span>
            <button type="button" onClick={() => meet.note(null)} className="font-bold" aria-label="Dismiss">×</button>
          </div>
        ) : null}
        {meet.isHost && waiting.length ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-[#16254F]/95 px-3 py-2 text-[12.5px] shadow-lg">
            <span className="flex-1">
              <b>{waiting.length === 1 ? waiting[0]!.name || 'Someone' : `${waiting.length} people`}</b> {waiting.length === 1 ? 'is' : 'are'} waiting to join
            </span>
            <button type="button" onClick={() => void Promise.all(waiting.map((p) => meet.admit(p)))} className="h-7 rounded-[7px] bg-white px-2.5 text-[12px] font-bold text-[#151A2D]">
              Admit{waiting.length > 1 ? ' all' : ''}
            </button>
            <button type="button" onClick={() => callUi.set({ panelOpen: true, panelTab: 'People' })} className="h-7 rounded-[7px] bg-[#2A3A66] px-2.5 text-[12px] font-semibold">
              See who
            </button>
          </div>
        ) : null}
      </>
    ) : null;

  return (
    <>
      <CallWorkspace
        title={info.title || 'Meeting'}
        clock={clock}
        badges={
          <>
            {room.isRecording ? (
              <span className="flex items-center gap-1.5 rounded-full bg-[#3A1A14] px-2 py-0.5 text-[11.5px] font-bold text-[#FFB4A2]">
                <span className="h-2 w-2 rounded-full bg-[#E0522F]" />
                Recording
              </span>
            ) : null}
            {meet.locked ? <span className="rounded-full bg-[#2A3A66] px-2 py-0.5 text-[11.5px] font-semibold">Locked</span> : null}
          </>
        }
        headerExtra={
          <>
            {info.meeting_id ? <span className="hidden text-[12px] text-[#AFC0E8] lg:inline">Meeting ID {formatCode(info.meeting_id)}</span> : null}
            <button type="button" onClick={copyLink} className="no-drag h-7 rounded-[7px] bg-[#2A3A66] px-2.5 text-[12px] font-semibold hover:bg-[#344777]">
              Copy join link
            </button>
          </>
        }
        people={people}
        lastSpeaker={meet.lastSpeaker}
        alerts={alerts}
        board={ui.boardOnStage ? <Whiteboard stage /> : null}
        tabs={[
          { id: 'People', label: 'People', badge: meet.isHost ? waiting.length : undefined, content: <PeoplePanel /> },
          {
            id: 'Chat',
            label: 'Chat',
            content: info.room_id ? (
              <div className="flex h-full flex-col">
                <span className="border-b border-line px-3 py-2 text-[11.5px] text-ink-3">Meeting chat · saved to the meeting's conversation</span>
                <div className="min-h-0 flex-1">
                  <Thread roomId={String(info.room_id)} room={undefined} mini bare rooms={[]} />
                </div>
              </div>
            ) : (
              <Empty icon="chat" title="This meeting has no chat" />
            ),
          },
          {
            id: 'Board',
            label: 'Board',
            content: ui.boardOnStage ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-[12.5px] text-ink-2">
                <b className="text-ink">The board is on the main stage</b>
                <button type="button" onClick={() => callUi.set({ boardOnStage: false })} className="font-semibold text-primary hover:underline">
                  Bring it back here
                </button>
              </div>
            ) : (
              <Whiteboard />
            ),
          },
          { id: 'Files', label: 'Files', content: <FilesPanel roomId={info.room_id} /> },
          { id: 'Info', label: 'Info', content: <InfoPanel /> },
        ]}
        buttons={buttons}
        more={more}
        end={{ label: 'Leave the meeting', onClick: () => void meet.leave(), menu: meet.isHost ? [{ label: 'End for everyone', icon: 'phone-off', danger: true, onClick: () => setEnding(true) }] : undefined }}
        status={sharing ? (paused ? `Sharing ${meet.shareLabel ?? 'your screen'} — paused` : `You are sharing ${meet.shareLabel ?? 'your screen'}${controlNote}`) : null}
        screenLayer={(sharer) => <RemoteControlLayer sharer={sharer} />}
      />
      {picking && (picking === 'change' || !rcView.isLoading) ? (
        <ScreenPicker
          changing={picking === 'change'}
          control={pickerControl}
          onClose={() => setPicking(null)}
          onPick={(pick) => {
            setPicking(null);
            void meet.share(pick);
          }}
        />
      ) : null}
      {ending ? (
        <Modal title="End the meeting for everyone?" onClose={() => setEnding(false)} width={420} footer={<><Button onClick={() => setEnding(false)}>Cancel</Button><Button variant="danger" onClick={() => (setEnding(false), void meet.endForAll())}>End for all</Button></>}>
          <p className="text-[13px] text-ink-2">Everyone is disconnected{room.isRecording ? ' and the recording stops' : ''}. The meeting cannot be joined again.</p>
        </Modal>
      ) : null}
    </>
  );
}

function PeoplePanel() {
  const [menu, setMenu] = useState<string | null>(null);
  const room = meet.room!;
  const present: Participant[] = [room.localParticipant, ...meet.present];
  const link = 'text-[12px] font-semibold text-primary hover:underline';
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {meet.isHost && meet.waiting.length ? (
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
      <div className="flex items-center">
        <b className="flex-1 text-ink">In the meeting · {present.length}</b>
      </div>
      {present.map((p) => {
        const self = p === room.localParticipant;
        const host = metaOf(p).host || (self && meet.isHost);
        const state = p.isSpeaking ? 'Speaking' : !p.isMicrophoneEnabled ? 'Muted' : '';
        return (
          <div key={p.identity} className="relative flex items-center gap-2.5">
            <CallAvatar name={p.name || p.identity} size={30} />
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{self ? `${p.name || 'You'} (you)` : p.name || 'Guest'}</b>
              <span className="text-[11px] text-ink-3">{host ? 'Host' : isGuest(p) ? 'Guest · by link' : 'Member'}</span>
            </span>
            <span className={cx('text-[11.5px] font-semibold', p.isSpeaking ? 'text-success' : 'text-ink-3')}>{state}</span>
            {meet.isHost && !self ? (
              <>
                <button type="button" aria-label={`Actions for ${p.name || 'this person'}`} onClick={() => setMenu(menu === p.identity ? null : p.identity)} className="h-7 w-7 rounded-[7px] text-ink-2 hover:bg-subtle">⋯</button>
                {menu === p.identity ? (
                  <div role="menu" className="absolute top-8 right-0 z-10 w-40 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
                    <button type="button" role="menuitem" disabled={!p.isMicrophoneEnabled} onClick={() => (setMenu(null), void meet.mute(p))} className="block w-full px-3 py-1.5 text-left hover:bg-subtle disabled:opacity-50">Mute</button>
                    <button type="button" role="menuitem" onClick={() => (setMenu(null), void meet.remove(p))} className="block w-full px-3 py-1.5 text-left text-danger hover:bg-subtle">Remove from the meeting</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FilesPanel({ roomId }: { roomId: number | null }) {
  const q = useQuery({
    queryKey: ['chat', 'shared', String(roomId)],
    queryFn: ({ signal }) => apiGet<{ files: Array<{ message_id: number; sender_name: string; created_at: string; file?: ChatFile }>; media: Array<{ message_id: number; file?: ChatFile; created_at: string; sender_name: string }> }>(`/api/chat/rooms/${roomId}/shared`, undefined, signal),
    enabled: !!roomId,
    refetchInterval: 15_000,
  });
  if (!roomId) return <Empty icon="file" title="This meeting has no conversation to share files in" />;
  const files = [...(q.data?.files ?? []), ...(q.data?.media ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const share = async () => {
    try {
      const picked = await call('files:pickFiles', { multiple: true, title: 'Share files with the meeting' });
      if (picked.length) await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'chat', roomId: String(roomId) } });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-2 p-3.5 text-[12.5px]">
      {q.isLoading ? <Spinner /> : null}
      {!q.isLoading && !files.length ? <p className="text-ink-3">Nothing shared yet.</p> : null}
      {files.map((f) => (
        <div key={f.message_id} className="flex items-center gap-2.5 rounded-[9px] border border-line px-2.5 py-2">
          <FileBadge name={f.file?.filename ?? 'file'} size={30} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{f.file?.filename}</b>
            <span className="text-[11px] text-ink-3">{f.file ? bytes(f.file.size) : ''} · {f.sender_name} · {dateLabel(f.created_at)}</span>
          </span>
        </div>
      ))}
      <button type="button" onClick={() => void share()} className="h-9 rounded-[8px] border border-line font-semibold text-ink hover:bg-subtle">Share a file from this computer</button>
    </div>
  );
}

function InfoPanel() {
  const info = meet.info!;
  const [chat, setChat] = useState(false);
  const text = invitation({ title: info.title, join_url: info.join_url, code: info.meeting_id, passcode: info.passcode }, info.host_name);
  const copy = (v: string, what: string) => void navigator.clipboard.writeText(v).then(() => toast('success', `${what} copied.`));
  const rows: Array<[string, string]> = [
    ['Meeting link', info.join_url],
    ...(info.meeting_id ? ([['Meeting ID', formatCode(info.meeting_id)]] as Array<[string, string]>) : []),
    ...(info.passcode ? ([['Passcode', info.passcode]] as Array<[string, string]>) : []),
  ];
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <span className="text-ink-3">{k}</span>
          <span className="flex items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-ink selectable">{v.replace(/^https?:\/\//, '')}</b>
            <button type="button" onClick={() => copy(v, k)} className="text-[12px] font-semibold text-primary hover:underline">Copy</button>
          </span>
        </div>
      ))}
      <b className="text-ink">Share via</b>
      <ShareRow text={text} m={{ uuid: info.uuid, title: info.title }} onChat={() => setChat(true)} copy={copy} />
      {meet.isHost ? (
        <label className="flex flex-col gap-1">
          <b className="text-ink">Access</b>
          <Select value={meet.locked ? 'locked' : 'ask'} onChange={(e) => void meet.lock(e.target.value === 'locked')} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink">
            <option value="ask">Ask to join (host admits)</option>
            <option value="locked">Locked — no new participants</option>
          </Select>
        </label>
      ) : null}
      {chat ? <ShareInChat text={text} onClose={() => setChat(false)} /> : null}
    </div>
  );
}
