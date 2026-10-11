import type { MenuItem, MenuSection } from '../../components/Menu';
import { text } from '../../core/i18n';
import type { MeetRole, RoomSettings } from './api';

/**
 * The meeting's More menu (worksuite-desktop#124), as data: Meeting Tools
 * and Host Controls (the workspace adds View & Layout after them). Kept apart
 * from MeetRoom so who sees what, and what each item says, can be tested.
 *
 * Each label says what it will do now (Start or Stop Recording, Lock or
 * Unlock Meeting). Host controls are not shown to people who cannot use them
 * (worksuite-desktop#348): a participant or a guest sees no Lock, no
 * Recording and no Transcription item, not even disabled. A co-host the room
 * does not let record still sees Recording, disabled with the reason, since
 * the host can change that. Related secondary options are submenus
 * (Activities, Meeting Info).
 */
export interface MeetMenuState {
  role: MeetRole;
  /** Host or co-host. */
  canManage: boolean;
  settings: Partial<Pick<RoomSettings, 'recording' | 'record' | 'transcription'>>;
  mayRecord: boolean;
  mayStopRecording: boolean;
  /** A recording is running that this person could stop. */
  recordingActive: boolean;
  recordingCommand: 'idle' | 'starting' | 'stopping' | 'error';
  /** Where a recording is kept and how: "On the server · grid · 1080p". */
  recordHint?: string;
  /** Recorded on this computer: it is uploaded after. */
  recordingMine: boolean;
  mayTranscribe: boolean;
  /** This computer is transcribing (and can stop). */
  transcribingHere: boolean;
  /** Someone else is transcribing; their name when known. */
  transcribingElsewhere: { by: string | null } | null;
  locked: boolean;
  boardOnStage: boolean;
  /** Controlling someone's computer: whose. */
  controlling: string | null;
  /** The meeting's own words for "Host controls", "Q&A" and "Polls". */
  words: { hostControls: string; qa: string; polls: string };
}

export interface MeetMenuActions {
  releaseControl: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  recordingSettings: () => void;
  startTranscription: () => void;
  stopTranscription: () => void;
  setLocked: (locked: boolean) => void;
  hostControls: () => void;
  livestreaming: () => void;
  panel: (tab: 'Q&A' | 'Polls' | 'Notes' | 'Files' | 'Info' | 'Settings') => void;
  toggleBoardOnStage: () => void;
  copyLink: () => void;
}

/** Why someone may not record: the room has it off, or it is for the hosts. */
export function recordingReason(s: Pick<MeetMenuState, 'settings' | 'role'>): string {
  if (s.settings.recording === false) return text("Recording isn't turned on for this meeting");
  return s.settings.record === 'hosts' ? text('Only the host and co-hosts can record') : text('Only the host can record this meeting');
}

export function transcriptionReason(s: Pick<MeetMenuState, 'settings'>): string {
  return s.settings.transcription === false ? text("Transcription isn't turned on for this meeting") : text('Only hosts and people who may record can transcribe');
}

export function meetMoreSections(s: MeetMenuState, a: MeetMenuActions): MenuSection[] {
  const busy = s.recordingCommand === 'starting' || s.recordingCommand === 'stopping';
  const recording: MenuItem | null = s.recordingActive && s.mayStopRecording
    ? {
        id: 'recording',
        icon: 'stop',
        danger: true,
        label: s.recordingCommand === 'stopping' ? text('Stopping Recording…') : text('Stop Recording'),
        description: s.recordingMine ? text('It is finished and uploaded to your Drive after') : undefined,
        disabled: busy,
        onSelect: a.stopRecording,
      }
    : s.mayRecord
      ? {
          id: 'recording',
          icon: 'film',
          label: s.recordingCommand === 'starting' ? text('Starting Recording…') : text('Start Recording'),
          description: s.recordHint,
          disabled: busy,
          onSelect: a.startRecording,
        }
      : s.canManage
        ? { id: 'recording', icon: 'film', label: s.recordingActive ? text('Stop Recording') : text('Start Recording'), disabled: true, reason: recordingReason(s) }
        : null;

  // Somebody who may neither transcribe nor run the room has no Transcription item at all (#348); the badge says when it is on.
  const transcription: MenuItem | null = !s.transcribingHere && !s.mayTranscribe && !s.canManage
    ? null
    : s.transcribingHere
    ? { id: 'transcription', icon: 'stop', danger: true, label: text('Stop Transcription'), description: text('The transcript is kept in the meeting’s details'), onSelect: a.stopTranscription }
    : s.transcribingElsewhere
      ? {
          id: 'transcription',
          icon: 'file-text',
          label: text('Stop Transcription'),
          disabled: true,
          reason: s.transcribingElsewhere.by ? text('{name} is transcribing; only they can stop it', { name: s.transcribingElsewhere.by }) : text('Someone else is transcribing; only they can stop it'),
        }
      : s.mayTranscribe
        ? { id: 'transcription', icon: 'file-text', label: text('Start Transcription…'), description: text('English, Sinhala or Tamil'), onSelect: a.startTranscription }
        : { id: 'transcription', icon: 'file-text', label: text('Start Transcription…'), disabled: true, reason: transcriptionReason(s) };

  const tools: MenuItem[] = [
    // Reachable even when their screen is not on the stage (the board is, or the floating card).
    ...(s.controlling ? [{ id: 'release', icon: 'stop', danger: true, label: text('Release Control'), description: text('Of {name}’s computer', { name: s.controlling }), onSelect: a.releaseControl }] : []),
    ...(recording ? [recording] : []),
    ...(transcription ? [transcription] : []),
    {
      id: 'activities',
      icon: 'chart',
      label: text('Activities'),
      submenu: [
        {
          id: 'activities',
          items: [
            { id: 'qa', icon: 'help', label: s.words.qa, onSelect: () => a.panel('Q&A') },
            { id: 'polls', icon: 'chart', label: s.words.polls, onSelect: () => a.panel('Polls') },
            { id: 'notes', icon: 'file', label: text('Notes & Minutes'), onSelect: () => a.panel('Notes') },
            { id: 'files', icon: 'paperclip', label: text('Files'), onSelect: () => a.panel('Files') },
            { id: 'board', icon: 'board', label: text('Whiteboard on Stage'), description: text('The board as the main view'), checked: s.boardOnStage, onSelect: a.toggleBoardOnStage },
          ],
        },
      ],
    },
    {
      id: 'info',
      icon: 'info',
      label: text('Meeting Info'),
      submenu: [
        {
          id: 'info',
          items: [
            { id: 'details', icon: 'info', label: text('Meeting Details'), onSelect: () => a.panel('Info') },
            { id: 'link', icon: 'link', label: text('Copy Join Link'), onSelect: a.copyLink },
            { id: 'room-settings', icon: 'settings', label: text('Room Settings'), onSelect: () => a.panel('Settings') },
          ],
        },
      ],
    },
  ];

  const lock: MenuItem = {
    id: 'lock',
    icon: s.locked ? 'unlock' : 'lock',
    label: s.locked ? text('Unlock Meeting') : text('Lock Meeting'),
    description: s.locked ? text('People with the link can join again') : text('No one new can join'),
    onSelect: () => a.setLocked(!s.locked),
  };
  const host: MenuItem[] = [
    ...(s.canManage ? [{ id: 'host-controls', icon: 'shield', label: s.words.hostControls, description: text('Permissions, waiting room and who can join'), onSelect: a.hostControls }] : []),
    ...(s.canManage ? [lock] : []),
    ...(s.canManage ? [{ id: 'livestream', icon: 'video', label: text('Livestreaming…'), onSelect: a.livestreaming }] : []),
    // Recording settings (#68): whoever may record, or stop the recording running.
    ...(s.mayRecord || (s.mayStopRecording && s.recordingActive) ? [{ id: 'recording-settings', icon: 'settings', label: text('Recording Settings…'), onSelect: a.recordingSettings }] : []),
  ];

  // Nothing of the hosts' to show: no Host Controls heading at all.
  return [
    { id: 'tools', label: text('Meeting Tools'), items: tools },
    ...(host.length ? [{ id: 'host', label: text('Host Controls'), items: host }] : []),
  ];
}
