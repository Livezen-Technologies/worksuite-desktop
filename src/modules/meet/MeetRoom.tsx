import { LivestreamBadge, LivestreamControls, useLivestreamNotice } from './Livestreaming';
import { RecordingFeedback } from './RecordingFeedback';
import BrowserMeetingChat from './BrowserMeetingChat';
import { GuestChat } from './GuestChat';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomEvent, type Participant } from 'livekit-client';
import { callQuality, type CallQuality } from '../../core/connection';
import { ConnectionWarning } from '../../components/ConnectionWarning';
import { call } from '../../core/bridge';
import { parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Modal, cx } from '../../components/ui';
import { CallAvatar, useNow } from '../calls/parts';
import { ScreenPicker } from '../calls/ScreenPicker';
import { CallWorkspace } from '../calls/ui/CallWorkspace';
import type { ControlButton } from '../calls/ui/CoreCallControls';
import { meetMoreSections } from './moreMenu';
import { personOf } from '../calls/ui/people';
import { callUi } from '../calls/ui/state';
import { Thread } from '../chat/Thread';
import { formatCode, invitation } from './api';
import { ShareInChat, ShareRow } from './MeetHome';
import { remote } from './remote/controller';
import { RemoteControlLayer } from './remote/ControllerSurface';
import { PointerLayer } from './remote/PointerLayer';
import { pointers } from './remote/pointers';
import { useCallShortcuts } from './shortcuts';
import { isGuest, meet, roleOf, userIdOf } from './session';
import { HostLeaveDialog, RoleBadge, RoomSettingsPanel, TransferHostDialog } from './RoomRoles';
import { HostControlsDrawer, cameraControl, hostControlsControl, micControl, reactControl } from './HostControls';
import { AddPeopleDialog, Invitations } from './InvitePeople';
import { MeetNotes } from './MeetNotes';
import { RecordingSettings } from './RecordingSettings';
import { StartTranscriptionDialog } from './TranscriptControls';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Whiteboard } from './Whiteboard';
import { HandQueue, PollsPanel, QaPanel } from './Activities';
import { useMeetT } from './i18n';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { MeetingFiles, ShareMeetingDocument } from './MeetingFiles';

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
  useSyncExternalStore(pointers.subscribe, pointers.snapshot);
  useSyncExternalStore(remote.subscribe, remote.snapshot);
  const ui = useSyncExternalStore(callUi.subscribe, callUi.get);
  const t = useMeetT();
  const [picking, setPicking] = useState<'start' | 'change' | null>(null);
  const [ending, setEnding] = useState(false);
  const [sharingDocument, setSharingDocument] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [streamSettings, setStreamSettings] = useState(false);
  useLivestreamNotice(meet.livestream);
  const [recSettings, setRecSettings] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // Host controls (#91): the hosts' drawer; it closes by itself if I stop being one.
  const [hostControls, setHostControls] = useState(false);
  const rec = meet.recording;
  const recPrefs = useStore(app, (s) => s.prefs?.meetRecording);
  const recordHint = recPrefs ? `${recPrefs.method === 'local' ? 'On this computer' : 'On the server'} · ${{ grid: 'grid', speaker: 'speaker', screen: 'shared screen' }[recPrefs.layout]} · ${recPrefs.quality}` : undefined;
  const now = useNow();
  const room = meet.room!;
  const lp = room.localParticipant;
  const info = meet.info!;
  const participants: Participant[] = [lp, ...meet.present];
  // A raised hand shows on the tile with its place in the queue (#92).
  const handOn = (p: Participant) => {
    const h = meet.handOf(p);
    return h ? { position: h.position, label: `${t('act.handUp')} · ${h.position}` } : null;
  };
  const people = participants.map((p) => personOf(p, p === lp, { host: p === lp ? meet.isHost : roleOf(p) === 'host', guest: isGuest(p), hand: handOn(p) }));
  // Q&A, polls and raised hands (#92): what each is waiting on — a live poll I have not voted in, hands up for the hosts.
  const acts = meet.activities;
  const handsOn = meet.settings.raise_hand !== false;
  const pollsWaiting = meet.settings.polls !== false ? (acts?.polls.filter((p) => p.status === 'live' && p.my_choices === null).length ?? 0) : 0;
  const openQuestions = meet.canManage ? (acts?.questions.filter((q) => q.status === 'open' && !q.hidden).length ?? 0) : 0;
  const started = info.started_at ? parseTs(info.started_at).getTime() : meet.joinedAt;
  const clock = started ? hms(now - started) : '';
  const waiting = meet.waiting;
  const sharing = lp.isScreenShareEnabled;
  const paused = meet.sharePaused;
  const copyLink = () => void navigator.clipboard.writeText(info.join_url).then(() => toast('success', 'Join link copied.'));
  // Sharing and control in this meeting, as the server sees it: asking to control a shared screen, and controlling it.
  const uuid = meet.uuid;
  useEffect(() => remote.start(uuid), [uuid]);
  // Connection strength's Meet row (worksuite-desktop#254): this call's quality as LiveKit rates it, while the room is open.
  useEffect(() => {
    if (typeof room.on !== 'function') return;
    const publish = () => callQuality.set({ meet: { quality: String(room.localParticipant.connectionQuality ?? 'unknown') as CallQuality['quality'], packetLossPct: null } });
    publish();
    room.on(RoomEvent.ConnectionQualityChanged, publish);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, publish);
      callQuality.set({ meet: null });
    };
  }, [room]);
  // Whether this computer can be controlled, for the picker's "Let people ask to control" (RC01).
  const rcView = useQuery({ queryKey: ['rc-state'], queryFn: () => call('rc:recheck'), enabled: picking === 'start', staleTime: 0 });
  const pickerControl = rcView.data
    ? {
        allowRequests: rcView.data.allowRequests,
        unavailable: !rcView.data.support.policyAllows ? "This computer's policy doesn't let others control it." : rcView.data.support.available ? null : rcView.data.support.reason,
      }
    : undefined;
  const controlNote = sharing && meet.control ? (meet.control.offered ? ' · others can ask to control it' : '') : '';
  // Viewers point at and draw over my shared screen on their own screens (RC-PTR-02): I can clear it, or switch it off.
  const myShare = sharing ? (remote.state?.shares.find((s) => s.identity === lp.identity) ?? null) : null;
  const myMarks = myShare ? pointers.of(myShare.id) : null;
  const pointing = myShare ? pointers.activity(myShare.id, lp.identity) : [];
  const drawn = myShare ? pointers.othersMarks(myShare.id, lp.identity) : 0;
  const viewerNote = pointing.length ? ` · ${pointing.join(', ')} ${pointing.length === 1 ? 'is' : 'are'} pointing` : drawn ? ` · ${drawn === 1 ? '1 mark' : `${drawn} marks`} drawn over it` : '';
  const panelOn = (tab: string) => ui.panelOpen && ui.panelTab === tab;

  const buttons: ControlButton[] = [
    // A microphone or camera the host turned off for participants (#91): the button says why it cannot be turned on.
    micControl(lp),
    cameraControl(lp),
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
            ...(myShare && myMarks
              ? [
                  { label: "Clear viewers' annotations", hint: 'What others drew over your shared screen, for everyone', icon: 'eraser', onClick: () => pointers.clearAll(room, myShare.id) },
                  myMarks.annotOn
                    ? { label: "Turn viewers' annotations off", hint: 'Pointers still show; drawing stops', icon: 'pen', onClick: () => pointers.setAnnot(room, myShare.id, false) }
                    : { label: "Turn viewers' annotations on", icon: 'pen', onClick: () => pointers.setAnnot(room, myShare.id, true) },
                ]
              : []),
            { label: 'Stop sharing', icon: 'stop', danger: true, onClick: () => void meet.share(null) },
          ],
        }
      : meet.mayPresent
        ? { id: 'share', icon: 'screen-share', label: 'Share your screen', onClick: () => setPicking('start') }
        : { id: 'share', icon: 'screen-share', label: t('hc.off.present'), disabled: true },
    { id: 'document', icon: 'file', label: 'Share Document', disabled: !meet.mayPresent || !info.room_id, onClick: () => setSharingDocument(true) },
    reactControl(),
    // Raising a hand never turns the microphone on: the host gives the floor.
    {
      id: 'hand',
      icon: 'hand',
      label: meet.myHand ? t('act.lowerHand') : handsOn ? t('act.raiseHand') : t('act.handsOff'),
      tone: meet.myHand ? 'active' : undefined,
      disabled: !acts || (!handsOn && !meet.myHand),
      badge: meet.canManage ? acts?.hands.length : undefined,
      onClick: () => void meet.raiseHand(!meet.myHand),
    },
    { id: 'chat', icon: 'chat', label: panelOn('Chat') ? 'Hide chat' : 'Chat', tone: panelOn('Chat') ? 'active' : undefined, onClick: () => callUi.togglePanel('Chat') },
    { id: 'people', icon: 'users', label: 'People', tone: panelOn('People') ? 'active' : undefined, badge: meet.canManage ? waiting.length : undefined, onClick: () => callUi.togglePanel('People') },
    { id: 'board', icon: 'board', label: ui.boardOnStage ? 'Take the board off the stage' : 'Whiteboard', tone: ui.boardOnStage || panelOn('Board') ? 'active' : undefined, onClick: () => (ui.boardOnStage ? callUi.set({ boardOnStage: false }) : callUi.togglePanel('Board')) },
    // Host controls (#91): the host and co-hosts only.
    ...hostControlsControl(hostControls, () => setHostControls(!hostControls)),
  ];
  /*
   * The keys (WS-MEET-ENH-01 D06). Each one runs the button above it rather
   * than its own copy of the action, so a key cannot mute a microphone the
   * host has locked or raise a hand where hands are off: the button is already
   * disabled, and the key does nothing.
   */
  useCallShortcuts({
    buttons,
    openPanel: (tab) => callUi.togglePanel(tab),
    popOut: () => callUi.float(!ui.floating),
  });
  // More (#124): Meeting Tools and Host Controls, with the reason beside what cannot be used; the workspace adds View & Layout.
  const more = meetMoreSections(
    {
      role: meet.role,
      canManage: meet.canManage,
      settings: meet.settings,
      mayRecord: meet.mayRecord,
      mayStopRecording: meet.mayStopRecording,
      recordingActive: !!rec && (rec.mine || !!meet.rec?.cloud || room.isRecording),
      recordingCommand: meet.recordingCommand,
      recordHint,
      recordingMine: !!rec?.mine,
      mayTranscribe: meet.mayTranscribe,
      transcribingHere: !!meet.liveTx,
      transcribingElsewhere: meet.transcribing && !meet.liveTx ? { by: meet.transcribing.by } : null,
      locked: meet.locked,
      boardOnStage: ui.boardOnStage,
      controlling: remote.session ? remote.session.sharer.name : null,
      words: { hostControls: t('hc.title'), qa: t('act.qa'), polls: t('act.polls') },
    },
    {
      releaseControl: () => void remote.release(),
      startRecording: () => void meet.startRecording(),
      stopRecording: () => void meet.stopRecording(),
      recordingSettings: () => setRecSettings(true),
      startTranscription: () => setTranscribing(true),
      stopTranscription: () => void meet.stopTranscription(),
      setLocked: (v) => void meet.lock(v),
      hostControls: () => setHostControls(true),
      livestreaming: () => setStreamSettings(true),
      panel: (tab) => callUi.togglePanel(tab),
      toggleBoardOnStage: () => callUi.set({ boardOnStage: !ui.boardOnStage, ...(ui.boardOnStage ? {} : { panelOpen: false }) }),
      copyLink,
    },
  );

  const alerts =
    meet.error || meet.liveTx?.error || (meet.canManage && waiting.length) || meet.reactions.length ? (
      <>
        {meet.reactions.length ? (
          <div aria-live="polite" className="flex flex-wrap gap-1.5">
            {meet.reactions.map((r) => (
              <span key={r.id} className="animate-in rounded-full border border-line bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-ink shadow-lg">
                <span className="text-[16px]">{r.emoji}</span> {r.name}
              </span>
            ))}
          </div>
        ) : null}
        {meet.error ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-[#3A1A14] px-3 py-2 text-[12.5px] text-[#FFD2C4]" role="alert">
            <span className="flex-1">{meet.error}</span>
            <button type="button" onClick={() => meet.note(null)} className="font-bold" aria-label="Dismiss">×</button>
          </div>
        ) : null}
        {meet.liveTx?.error ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-[#3A2A10] px-3 py-2 text-[12.5px] text-[#F6C77A]" role="status">
            <span className="flex-1">{meet.liveTx.error} Transcription carries on with what is said next.</span>
          </div>
        ) : null}
        {meet.canManage && waiting.length ? (
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
            <LivestreamBadge status={meet.livestream} />
            <RecordingFeedback active={!!rec} since={rec?.since ?? null} now={now} phase={meet.recordingCommand !== 'idle' ? meet.recordingCommand : meet.rec?.pending?.some((r) => r.phase === 'stopping') ? 'stopping' : meet.rec?.pending?.some((r) => r.phase === 'starting') ? 'starting' : 'idle'} error={meet.recordingError} stopped={meet.recordingStopped}
              size={meet.localRec?.bytes ?? null} fix={meet.recordingFix} openSettings={() => void call('media:privacySettings', { pane: 'screen' }).catch(() => undefined)}
              retry={() => void (meet.recordingRetry === 'start' ? meet.startRecording() : meet.stopRecording())}
              stopPending={meet.rec?.pending?.some((r) => r.phase === 'starting') ? () => void meet.stopRecording() : undefined} />
            {meet.transcribing ? (
              <span role="status" title={meet.transcribing.by ? `Transcribed by ${meet.transcribing.by}` : 'What is said is being transcribed'} className="flex items-center gap-1.5 rounded-full bg-[#1E3A5F] px-2 py-0.5 text-[11.5px] font-bold text-[#BFD7FF]">
                <span className="h-2 w-2 rounded-full bg-[#5B9BFF]" />
                Transcribing{meet.liveTx?.pending ? ` · ${meet.liveTx.pending} in progress` : ''}
              </span>
            ) : null}
            {meet.locked ? <span className="rounded-full bg-[#2A3A66] px-2 py-0.5 text-[11.5px] font-semibold">Locked</span> : null}
            {/* Poor or Offline connection strength (#254): said in the call bar too. */}
            <ConnectionWarning tone="dark" />
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
          { id: 'People', label: 'People', badge: meet.canManage ? waiting.length : undefined, content: <PeoplePanel /> },
          {
            id: 'Chat',
            label: 'Chat',
            content: info.room_id ? (
              <div className="flex h-full flex-col">
                <span className="border-b border-line px-3 py-2 text-[11.5px] text-ink-3">
                  {meet.settings.chat === 'off'
                    ? 'The host has turned chat off in this meeting.'
                    : meet.settings.chat === 'hosts' && !meet.canManage
                      ? 'Only the host and co-hosts can write here.'
                      : "Meeting chat · saved to the meeting's conversation"}
                </span>
                <div className="min-h-0 flex-1 flex flex-col">
                  <BrowserMeetingChat uuid={info.uuid} />
                  <details className="border-t border-line"><summary className="cursor-pointer p-3 text-xs text-ink-3">Desktop guest chat</summary><GuestChat room={room} chat={meet.settings.chat} /></details>
                  <details className="border-t border-line"><summary className="cursor-pointer p-3 text-xs text-ink-3">Workspace conversation (members only)</summary><div className="h-80"><Thread roomId={String(info.room_id)} room={undefined} mini bare rooms={[]} /></div></details>
                </div>
              </div>
            ) : (
              <><BrowserMeetingChat uuid={info.uuid} /><GuestChat room={room} chat={meet.settings.chat} /></>
            ),
          },
          { id: 'Q&A', label: t('act.qa'), badge: openQuestions || undefined, content: <QaPanel /> },
          { id: 'Polls', label: t('act.polls'), badge: pollsWaiting || undefined, content: <PollsPanel /> },
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
          { id: 'Notes', label: 'Notes', content: <MeetNotes /> },
          { id: 'Files', label: 'Files', content: <MeetingFiles roomId={info.room_id} mayShare={meet.mayPresent} onPresent={() => { toast('info', 'Choose the document window to present. Participants follow its page or slide as you navigate.'); setPicking(sharing ? 'change' : 'start'); }} /> },
          { id: 'Info', label: 'Info', content: <InfoPanel /> },
          { id: 'Settings', label: 'Settings', content: <RoomSettingsPanel onHostControls={meet.canManage ? () => setHostControls(true) : undefined} /> },
        ]}
        buttons={buttons}
        more={more}
        end={{
          label: 'Leave the meeting',
          // The host leaving hands the meeting on, or ends it: never leaves it with no one to run it.
          onClick: () => (meet.isHost && meet.present.length ? setLeaving(true) : void meet.leave()),
          menu: meet.isHost ? [{ label: 'End for everyone', icon: 'phone-off', danger: true, onClick: () => setEnding(true) }] : undefined,
        }}
        status={sharing ? (paused ? `Sharing ${meet.shareLabel ?? 'your screen'} — paused` : `You are sharing ${meet.shareLabel ?? 'your screen'}${controlNote}${viewerNote}`) : null}
        stopPresenting={() => void meet.share(null)}
        screenLayer={(sharer) => (
          <>
            <PointerLayer sharer={sharer} />
            <RemoteControlLayer sharer={sharer} />
          </>
        )}
      />
      {/* The picker opens at once: remote control's check (Accessibility) never holds up sharing (worksuite-desktop#70). */}
      {picking ? (
        <ScreenPicker
          changing={picking === 'change'}
          inMeeting
          control={pickerControl ?? (rcView.isError ? { allowRequests: false, unavailable: 'Others can’t ask to control this computer right now.' } : undefined)}
          onClose={() => setPicking(null)}
          onPick={(pick) => {
            setPicking(null);
            void meet.share(pick);
          }}
        />
      ) : null}
      {sharingDocument && meet.mayPresent && info.room_id ? <ShareMeetingDocument roomId={info.room_id} onClose={() => setSharingDocument(false)} onSent={() => callUi.set({ panelOpen: true, panelTab: 'Files' })} /> : null}
      {hostControls && meet.canManage ? <HostControlsDrawer onClose={() => setHostControls(false)} /> : null}
      {transcribing ? <StartTranscriptionDialog onClose={() => setTranscribing(false)} /> : null}
      {streamSettings && meet.canManage ? <LivestreamControls close={() => setStreamSettings(false)} /> : null}
      {recSettings ? (
        <Modal title="Recording settings" onClose={() => setRecSettings(false)} width={560} footer={<Button variant="primary" onClick={() => setRecSettings(false)}>Done</Button>}>
          <RecordingSettings compact />
          {rec?.mine ? <p className="mt-3 text-[12px] text-ink-3">Changes apply to the next recording.</p> : null}
        </Modal>
      ) : null}
      {leaving ? <HostLeaveDialog onClose={() => setLeaving(false)} onEndAll={() => setEnding(true)} /> : null}
      {ending ? (
        <Modal title="End the meeting for everyone?" onClose={() => setEnding(false)} width={420} footer={<><Button onClick={() => setEnding(false)}>Cancel</Button><Button variant="danger" onClick={() => (setEnding(false), void meet.endForAll())}>End for all</Button></>}>
          <p className="text-[13px] text-ink-2">Everyone is disconnected{rec ? ' and the recording stops — it is still finished and saved to Drive' : ''}. The meeting cannot be joined again.</p>
        </Modal>
      ) : null}
    </>
  );
}

function PeoplePanel() {
  const t = useMeetT();
  const [menu, setMenu] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ id: number; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const room = meet.room!;
  const present: Participant[] = [room.localParticipant, ...meet.present];
  const link = 'text-[12px] font-semibold text-primary hover:underline';
  const item = 'block w-full px-3 py-1.5 text-left hover:bg-subtle disabled:opacity-50';
  const settings = meet.settings;
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {meet.canManage && meet.waiting.length ? (
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
      <div className="flex items-center">
        <b className="flex-1 text-ink">In the meeting · {present.length}</b>
        {meet.mayInvite ? (
          <button type="button" onClick={() => setAdding(true)} className="flex h-7 items-center gap-1 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white hover:bg-primary-hover">
            + Add people
          </button>
        ) : null}
      </div>
      {present.map((p) => {
        const self = p === room.localParticipant;
        const role = self ? meet.role : roleOf(p);
        const hand = meet.handOf(p);
        const uid = userIdOf(p);
        const state = p.isSpeaking ? 'Speaking' : !p.isMicrophoneEnabled ? 'Muted' : '';
        const name = p.name || 'Guest';
        // What I may do to them: the server checks again.
        const entries: Array<{ label: string; onClick: () => void; danger?: boolean; disabled?: boolean }> = [];
        if (!self && meet.canManage) {
          entries.push({ label: 'Mute', disabled: !p.isMicrophoneEnabled, onClick: () => void meet.mute(p) });
          if (uid && meet.isHost && role !== 'host') entries.push(role === 'cohost' ? { label: 'Remove as co-host', onClick: () => void meet.cohost(uid, false) } : { label: 'Make co-host', onClick: () => void meet.cohost(uid, true) });
          if (uid && (role === 'participant' || role === 'presenter'))
            entries.push(role === 'presenter' ? { label: 'Remove as presenter', onClick: () => void meet.presenter(uid, false) } : { label: settings.present === 'presenters' ? 'Make presenter (can share)' : 'Make presenter', onClick: () => void meet.presenter(uid, true) });
          if (uid && meet.isHost) entries.push({ label: 'Make host…', onClick: () => setTransfer({ id: uid, name }) });
          if (role !== 'host') entries.push({ label: 'Remove from the meeting', danger: true, onClick: () => void meet.remove(p) });
        }
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
                  <div role="menu" className="absolute top-8 right-0 z-10 w-52 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
                    {entries.map((e) => (
                      <button key={e.label} type="button" role="menuitem" disabled={e.disabled} onClick={() => (setMenu(null), e.onClick())} className={cx(item, e.danger && 'text-danger')}>
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
      {meet.canManage ? (
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
