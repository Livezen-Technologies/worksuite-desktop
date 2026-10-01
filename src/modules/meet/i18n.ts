import { useLanguage } from '../../core/i18n';

/**
 * Meet's strings (FR-L10N-01), kept beside the module as Restaurant's are: English complete, another language falling
 * back to English for what it does not have, `{name}` filled from the values given. Layout uses start/end spacing.
 */
const en = {
  'home.eyebrow': 'WorkSuite Meet',
  'home.title': 'Connect with your team',
  'home.subtitle': 'Start a meeting, share a link, or plan your next conversation.',
  'home.new': 'New meeting',
  'home.startNow': 'Start now',
  'home.startNowHint': 'Join now and invite people from inside',
  'home.later': 'Create a link for later',
  'home.laterHint': 'Get a link and code to share',
  'home.schedule': 'Schedule in Calendar',
  'home.scheduleHint': 'Invite people; it shows in Calendar',
  'home.scheduleNoPermission': 'Needs the "Schedule meetings" permission',
  'home.codePlaceholder': 'Enter a code or meeting link',
  'home.codeLabel': 'Meeting code or link',
  'home.join': 'Join',
  'home.joining': 'Joining…',
  'home.checkDevices': 'Check camera and microphone',
  'home.tagline': 'A little closer, wherever you work.',
  'home.upcoming': 'Upcoming meetings',
  'home.recent': 'Recent meetings',
  'home.recordings': 'Recordings',
  'home.allMeetings': 'All meetings',
  'home.seeAll': 'See all',
  'home.showFewer': 'Show fewer',
  'home.today': 'Today',
  'home.tomorrow': 'Tomorrow',
  'home.liveNow': 'Live now',
  'home.openDetails': 'Open details',
  'home.invited': '{n} invited',
  'home.people': '{n} people',
  'home.person': '1 person',
  'home.youHost': 'You host',
  'home.hostedBy': 'Hosted by {name}',
  'home.openChat': 'Open chat',
  'home.copyLink': 'Copy link',
  'home.copyCode': 'Copy meeting ID',
  'home.linkCopied': 'Meeting link copied.',
  'home.codeCopied': 'Meeting ID copied.',
  'home.moreFor': 'More for {title}',
  'home.notStarted': 'Not started',
  'home.recorded': 'Recorded',
  'home.nothingScheduled': 'Nothing scheduled',
  'home.nothingScheduledHint': 'Meetings you are invited to show here.',
  'home.scheduleMeeting': 'Schedule a meeting',
  'home.noRecent': 'No meetings yet',
  'home.noRecentHint': 'Meetings you start or join show here.',
  'home.startMeeting': 'Start a meeting',
  'home.noRecordings': 'No recordings',
  'home.noRecordingsHint': 'Record a meeting you host from its controls. Only you can see your recordings.',
  'home.onlyYou': 'Only you can see your recordings',
  'home.processing': 'Processing',
  'home.download': 'Download',
  'home.rename': 'Rename',
  'home.delete': 'Delete',
  'err.notMeetLink': 'That link is not a WorkSuite Meet link. It looks like …/meet/ and then the meeting’s id.',
  'err.badCode': 'A meeting ID has 9 digits, like 482 119 330.',
  'err.badChars': 'That is not a meeting code or link.',
  'err.noSuchCode': 'No meeting has that ID. Check it with whoever sent it.',
  'err.ended': 'That meeting has ended.',

  'dev.camera': 'Camera',
  'dev.microphone': 'Microphone',
  'dev.speaker': 'Speaker',
  'dev.default': 'System default',
  'dev.micOn': 'Turn off microphone',
  'dev.micOff': 'Turn on microphone',
  'dev.camOn': 'Turn off camera',
  'dev.camOff': 'Turn on camera',
  'dev.micWorking': 'Microphone working',
  'dev.micSilent': 'Say something to test your microphone',
  'dev.micMuted': 'Microphone is off',
  'dev.testSpeaker': 'Test speaker',
  'dev.playing': 'Playing…',
  'dev.cameraOff': 'Camera is off',
  'dev.cameraStarting': 'Starting the camera…',
  'dev.you': 'You',
  'dev.settings': 'Device settings',
  'dev.checkTitle': 'Check camera and microphone',
  'dev.checkHint': 'What you choose here is used when you join a meeting.',
  'dev.blocked': '{what} is blocked. Allow WorkSuite to use it in your system’s privacy settings, then try again.',
  'dev.missing': 'No {what} was found. Connect one, then try again.',
  'dev.busy': 'The {what} is being used by another app. Close it there, then try again.',
  'dev.failed': 'The {what} could not be started.',
  'dev.openSettings': 'Open privacy settings',
  'dev.tryAgain': 'Try again',
  'dev.done': 'Done',

  'lobby.ready': 'Ready to join?',
  'lobby.asking': 'Asking to join…',
  'lobby.organizedBy': 'Organized by {name}',
  'lobby.host': 'You’re the host',
  'lobby.first': 'You’ll be the first to join',
  'lobby.others': '{n} people are in the meeting',
  'lobby.other': '1 person is in the meeting',
  'lobby.yourName': 'Your name',
  'lobby.nameFromAccount': 'Your WorkSuite name is shown to others.',
  'lobby.passcode': 'Meeting passcode',
  'lobby.joinNow': 'Join now',
  'lobby.askToJoin': 'Ask to join',
  'lobby.joining': 'Joining…',
  'lobby.waiting': 'Waiting for the host to let you in…',
  'lobby.waitingForHost': 'Waiting for the host to start the meeting…',
  'lobby.cancel': 'Cancel',
  'lobby.settingsUsed': 'Your microphone and camera settings will be used when you join.',
  'lobby.hostNote': 'You let people in and can record.',
  'lobby.guestNote': 'The host lets people in. The meeting may be recorded.',
  'lobby.inviteAfter': 'Invite others after joining',
  'lobby.scheduled': 'Scheduled {time}',
  'lobby.retry': 'Try again',
  'lobby.connection': 'WorkSuite could not reach the meeting. Check your connection, then try again.',

  'card.meeting': 'Meeting',
  'card.startedByYou': 'Started by you',
  'card.startedBy': 'Started by {name}',
  'card.live': 'Live',
  'card.ended': 'Ended',
  'card.removed': 'Removed',
  'card.join': 'Join',
  'card.joining': 'Joining…',
  'card.return': 'Return to meeting',
  'card.details': 'View details',
  'card.detailsTitle': 'Meeting details',
  'card.started': 'Started',
  'card.length': 'Length',
  'card.people': 'People',
  'card.recording': 'Recording',
  'card.recordingReady': 'Recorded — in Meet → Recordings',
  'card.recordingProcessing': 'Recorded — being processed',
  'card.noDetails': 'The details of this meeting are no longer available.',
  'card.close': 'Close',
} as const;

export type MKey = keyof typeof en;
type Table = Partial<Record<MKey, string>>;

const si: Table = { 'home.new': 'නව රැස්වීමක්', 'home.join': 'එක්වන්න', 'lobby.joinNow': 'දැන් එක්වන්න', 'dev.camera': 'කැමරාව', 'dev.microphone': 'මයික්‍රෆෝනය' };
const ta: Table = { 'home.new': 'புதிய கூட்டம்', 'home.join': 'சேர்', 'lobby.joinNow': 'இப்போது சேர்', 'dev.camera': 'கேமரா', 'dev.microphone': 'மைக்ரோஃபோன்' };
const ar: Table = { 'home.new': 'اجتماع جديد', 'home.join': 'انضمام', 'lobby.joinNow': 'انضم الآن', 'dev.camera': 'الكاميرا', 'dev.microphone': 'الميكروفون' };
const TABLES: Record<string, Table> = { en, si, ta, ar };

function lang(): string {
  return typeof document !== 'undefined' ? (document.documentElement.lang || 'en').split('-')[0]! : 'en';
}

export function mt(key: MKey, vars?: Record<string, string | number>): string {
  let s: string = TABLES[lang()]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** `mt`, re-rendering when the language changes. */
export function useMeetT(): typeof mt {
  useLanguage();
  return mt;
}
