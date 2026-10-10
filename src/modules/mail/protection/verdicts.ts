import { text } from '../../../core/i18n';
import type { LinkVerdict } from '@shared/mail-files';
import type { AttachmentScan, AttachmentStatus, BannerAction, LinkCheckResult, MessageProtection, ProtectionBanner, ReleaseRule, SendBlock, Verdict } from './types';

/**
 * What a verdict means on screen, kept apart from the screens so every one of them says the same thing (MPR-UX-01,
 * MPR-UX-08): the words, the chip's colours in light and dark (the D19–D25 tokens), and the rules nobody may bend —
 * MALWARE never has a Release; "Not scanned" and "Checking" are never shown as scanned; offline, only a CLEAN verdict
 * this computer already has keeps attachments open (MPR-UX-07).
 */

/** A verdict's chip: its words and colours, light and dark, as the designs draw them. */
export const VERDICT_CHIP: Record<Verdict, { label: string; className: string }> = {
  CLEAN: { label: 'Clean', className: 'bg-[#E6F4EC] text-[#1F7A4D] dark:bg-[#12301F] dark:text-[#5FD39A]' },
  BULK: { label: 'Bulk', className: 'bg-[#E6F0FF] text-[#0A5BD6] dark:bg-[#0F2A52] dark:text-[#7DB4FF]' },
  SPAM: { label: 'Spam', className: 'bg-[#FDF0E1] text-[#9A4A06] dark:bg-[#3A2610] dark:text-[#F5B26B]' },
  HIGH_SPAM: { label: 'High spam', className: 'bg-[#FDF0E1] text-[#9A4A06] dark:bg-[#3A2610] dark:text-[#F5B26B]' },
  PHISH: { label: 'Phishing', className: 'bg-[#FCE9E4] text-[#B42318] dark:bg-[#3D1A16] dark:text-[#FF8A7A]' },
  SPOOF: { label: 'Spoofing', className: 'bg-[#F6F1FE] text-[#6B3FB5] dark:bg-[#241B3D] dark:text-[#C7A8FF]' },
  MALWARE: { label: 'Malware', className: 'bg-[#B42318] text-white' },
  POLICY: { label: 'Blocked file', className: 'bg-[#E3F4F5] text-[#0B6770] dark:bg-[#0E2F33] dark:text-[#6FD6DF]' },
  UNSCANNED: { label: 'Not scanned', className: 'bg-[#ECEEF4] text-[#4A5168] dark:bg-[#1E2537] dark:text-[#A7AFC4]' },
  CHECKING: { label: 'Checking', className: 'bg-[#ECEEF4] text-[#4A5168] dark:bg-[#1E2537] dark:text-[#A7AFC4]' },
};

/** The other chips the protection screens use (states, checks), in the same palette. */
export const STATE_CHIP = {
  ok: 'bg-[#E6F4EC] text-[#1F7A4D] dark:bg-[#12301F] dark:text-[#5FD39A]',
  warn: 'bg-[#FDF0E1] text-[#9A4A06] dark:bg-[#3A2610] dark:text-[#F5B26B]',
  bad: 'bg-[#FCE9E4] text-[#B42318] dark:bg-[#3D1A16] dark:text-[#FF8A7A]',
  muted: 'bg-[#ECEEF4] text-[#4A5168] dark:bg-[#1E2537] dark:text-[#A7AFC4]',
  info: 'bg-[#E6F0FF] text-[#0A5BD6] dark:bg-[#0F2A52] dark:text-[#7DB4FF]',
} as const;

export const VERDICTS: Verdict[] = ['CLEAN', 'BULK', 'SPAM', 'HIGH_SPAM', 'PHISH', 'SPOOF', 'MALWARE', 'POLICY', 'UNSCANNED', 'CHECKING'];

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && (VERDICTS as string[]).includes(v);
}

export function verdictLabel(v: Verdict): string {
  return text(VERDICT_CHIP[v]?.label ?? v);
}

/** The release a verdict allows, whatever an answer says: malware never, phish/spoof/policy on request, spam by yourself. */
export function releaseFor(v: Verdict, said: ReleaseRule | null | undefined): ReleaseRule | null {
  if (v === 'MALWARE') return 'never';
  if (v === 'PHISH' || v === 'SPOOF' || v === 'POLICY') return said === 'never' ? 'never' : 'request';
  if (v === 'SPAM' || v === 'HIGH_SPAM') return said ?? 'self';
  return said ?? null;
}

export type BannerKind = 'junk' | 'phish' | 'spoof' | 'malware' | 'policy' | 'unscanned' | 'checking';

/** The banner a verdict gets (P-UI-10); none for clean mail or bulk mail that was only tagged. */
export function bannerKind(v: Verdict): BannerKind | null {
  switch (v) {
    case 'SPAM':
    case 'HIGH_SPAM':
      return 'junk';
    case 'PHISH':
      return 'phish';
    case 'SPOOF':
      return 'spoof';
    case 'MALWARE':
      return 'malware';
    case 'POLICY':
      return 'policy';
    case 'UNSCANNED':
      return 'unscanned';
    case 'CHECKING':
      return 'checking';
    default:
      return null;
  }
}

export interface BannerModel {
  kind: BannerKind;
  tone: ProtectionBanner['tone'];
  icon: string;
  title: string;
  text: string;
  actions: BannerAction[];
}

/**
 * Only what the verdict allows, whatever an answer lists: no Release or Request release for malware, Release only for
 * self-release verdicts and only with a quarantine item to release, Request release only for request verdicts, and no
 * Not junk where the server answers "Request review instead" (malware, phishing).
 */
export function allowedActions(actions: BannerAction[], p: Pick<MessageProtection, 'verdict' | 'release' | 'quarantine_id'>): BannerAction[] {
  const release = releaseFor(p.verdict, p.release);
  return [...new Set(actions)].filter((a) => {
    if (a === 'release') return p.verdict !== 'MALWARE' && release === 'self' && p.quarantine_id !== null;
    if (a === 'request_release') return p.verdict !== 'MALWARE' && release === 'request' && p.quarantine_id !== null;
    if (a === 'not_junk') return p.verdict !== 'MALWARE' && p.verdict !== 'PHISH';
    return true;
  });
}

const DEFAULT_ACTIONS: Record<BannerKind, BannerAction[]> = {
  junk: ['not_junk', 'release', 'trust_sender', 'block_sender', 'headers'],
  phish: ['request_release', 'report_phish', 'junk', 'block_sender', 'headers'],
  spoof: ['request_release', 'report_phish', 'junk', 'block_sender', 'headers'],
  malware: ['block_sender', 'headers'],
  policy: ['request_release', 'headers'],
  unscanned: ['scan_now', 'headers'],
  checking: [],
};

const TONE: Record<BannerKind, ProtectionBanner['tone']> = { junk: 'warn', phish: 'danger', spoof: 'danger', malware: 'danger', policy: 'warn', unscanned: 'neutral', checking: 'neutral' };
const ICON: Record<BannerKind, string> = { junk: 'spam', phish: 'shield-alert', spoof: 'shield-alert', malware: 'shield-alert', policy: 'lock', unscanned: 'lock', checking: 'spinner' };

/** The plain words for a verdict when the server sent no banner of its own (MPR-UX-01). */
function defaultWords(kind: BannerKind, from: { name: string | null; email: string }): { title: string; text: string } {
  switch (kind) {
    case 'junk':
      return { title: text('This looks like spam'), text: text('Pictures are blocked and links are shown as text. Mark it Not junk if you expected it.') };
    case 'phish':
      return { title: text('This message may be trying to steal your password'), text: text('Do not open its links or attachments, or reply with anything private.') };
    case 'spoof':
      return {
        title: from.name ? text('This isn’t from {name} — the address is {email}', { name: from.name, email: from.email }) : text('This message pretends to be from someone else — the address is {email}', { email: from.email }),
        text: text('The sender failed the checks that prove who sent it.'),
      };
    case 'malware':
      return { title: text('Dangerous attachment removed'), text: text('A virus was found in this message. Its files cannot be opened, saved or forwarded, and it cannot be released.') };
    case 'policy':
      return { title: text('A file in this message is blocked by your organisation'), text: text('It cannot be opened here. You can ask an administrator to release it.') };
    case 'unscanned':
      return { title: text('Not scanned'), text: text('This message could not be checked yet. Its attachments stay locked until they have been checked.') };
    case 'checking':
      return { title: text('Checking this message…'), text: text('Its attachments are locked until the check is done.') };
  }
}

/** The banner to show: the server's words when it sent some, the default otherwise, and only the allowed actions. */
export function bannerFor(p: MessageProtection, from: { name: string | null; email: string }): BannerModel | null {
  const kind = bannerKind(p.verdict);
  if (!kind && !p.banner) return null;
  const k: BannerKind = kind ?? 'junk';
  const words = p.banner && p.banner.title ? { title: p.banner.title, text: p.banner.text } : defaultWords(k, from);
  return {
    kind: k,
    tone: p.verdict === 'MALWARE' ? 'danger' : (p.banner?.tone ?? TONE[k]),
    icon: ICON[k],
    title: words.title,
    text: words.text,
    actions: allowedActions(p.banner ? p.banner.actions : DEFAULT_ACTIONS[k], p),
  };
}

/** How each banner action is labelled (MPR-UX-01/06). */
export function actionLabel(a: BannerAction): string {
  const words: Record<BannerAction, string> = {
    junk: 'Junk',
    not_junk: 'Not junk',
    release: 'Release',
    request_release: 'Request release',
    report_phish: 'Report phishing',
    trust_sender: 'Trust sender',
    block_sender: 'Block sender',
    scan_now: 'Scan now',
    headers: 'View headers',
  };
  return text(words[a]);
}

// ── Attachments (P-UI-11, MPR-UX-02, MPR-UX-07) ────────────────────────────────────────────────────

export interface AttachmentAccess {
  status: AttachmentStatus;
  /** Opened, previewed, saved, downloaded or dragged out: only a scanned file. */
  open: boolean;
  /** Why it is locked, in words. */
  reason: string | null;
  threat: string | null;
  /** Locked only because this computer is offline and holds no clean verdict for it. */
  waitingOnline: boolean;
}

/** The scan that belongs to an attachment: by its part (`ref`), else by name and size. */
export function scanFor(scans: AttachmentScan[], a: { ref: string; name: string; size: number }): AttachmentScan | null {
  return scans.find((s) => String(s.id) === a.ref) ?? scans.find((s) => s.name === a.name && (!s.size || !a.size || s.size === a.size)) ?? null;
}

/** What may be done with one attachment, by its status. */
export function accessOf(status: AttachmentStatus, scan: Pick<AttachmentScan, 'reason' | 'threat'> | null, waitingOnline = false): AttachmentAccess {
  switch (status) {
    case 'scanned':
      return { status, open: true, reason: null, threat: null, waitingOnline: false };
    case 'blocked':
      return { status, open: false, reason: scan?.reason ?? (scan?.threat ? text('A virus was found: {threat}', { threat: scan.threat }) : text('Blocked by your organisation')), threat: scan?.threat ?? null, waitingOnline: false };
    case 'checking':
      return { status, open: false, reason: waitingOnline ? text('Locked until you are back online and it has been checked') : text('Being checked for viruses'), threat: null, waitingOnline };
    default:
      return { status: 'unscanned', open: false, reason: scan?.reason ?? text('Not checked for viruses yet'), threat: null, waitingOnline: false };
  }
}

/**
 * What each attachment of a message may do, from its protection — or null where there is nothing to go by: the
 * server has no protection service (an older WorkSuite), so the app behaves as it always did.
 */
export function attachmentGate(p: MessageProtection | null, attachments: Array<{ ref: string; name: string; size: number }>, waitingOnline: boolean): Map<string, AttachmentAccess> | null {
  // Nothing that reads as a protection answer: nothing to go by.
  if (!p || !isVerdict(p.verdict)) return null;
  const out = new Map<string, AttachmentAccess>();
  for (const a of attachments) {
    const scan = scanFor(p.attachments ?? [], a);
    // A file the result does not mention is not scanned — never assumed clean (AC-MPR-04).
    let status: AttachmentStatus = scan?.status ?? (p.verdict === 'CHECKING' ? 'checking' : 'unscanned');
    if (p.verdict === 'MALWARE' && status === 'scanned' && scan?.threat) status = 'blocked';
    out.set(a.ref, accessOf(status, scan, waitingOnline && status === 'checking'));
  }
  return out;
}

/** What a protection answer means for this computer right now. */
export interface ProtectionView {
  protection: MessageProtection | null;
  /** The server has no protection service: no banner, no gating (an older WorkSuite). */
  unavailable: boolean;
  /** Shown from what this computer kept, not a fresh answer. */
  fromCache: boolean;
  /** Offline (or not answered yet) and nothing clean kept: attachments wait for the connection (MPR-UX-07). */
  waitingOnline: boolean;
}

/**
 * MPR-UX-07, desktop offline: a message synced before its verdict shows Checking and keeps its attachments locked
 * until online; a CLEAN verdict this computer already has keeps working offline. Anything else kept here is shown as it
 * was, with its scanned files locked again until a fresh answer: a cached verdict that is not clean is not enough to
 * open a file without the server.
 */
export function protectionView(answer: { data: MessageProtection; offline: boolean; local?: boolean } | { unavailable: true } | null | undefined, opts: { offline: boolean; failed: boolean }): ProtectionView {
  if (answer && 'unavailable' in answer) return { protection: null, unavailable: true, fromCache: false, waitingOnline: false };
  const checking = (waiting: boolean): ProtectionView => ({
    protection: { verdict: 'CHECKING', score: null, path: null, action: null, policy: null, reasons: [], banner: null, attachments: [], images_blocked: false, links_as_text: false, quarantine_id: null, release: null },
    unavailable: false,
    fromCache: false,
    waitingOnline: waiting,
  });
  if (!answer) return checking(opts.offline || opts.failed);
  const cached = answer.offline || !!answer.local;
  const p = answer.data;
  if (!cached || p.verdict === 'CLEAN') return { protection: p, unavailable: false, fromCache: cached, waitingOnline: false };
  return {
    protection: { ...p, attachments: (p.attachments ?? []).map((a) => (a.status === 'scanned' ? { ...a, status: 'checking' as const } : a)) },
    unavailable: false,
    fromCache: true,
    waitingOnline: true,
  };
}

// ── Links (P-UI-12) ──────────────────────────────────────────────────────────────────────────────────

/**
 * The click-time check's answer in the link guard's terms. The server keeps `verdict` in the older words (ok, caution,
 * danger, blocked) for installed clients and ranks by it as before; the new words come as `safety` (safe, suspicious,
 * dangerous, unknown) beside `reason`, `final_url` and `checked_at`. An answer with only the new words in `verdict` is
 * read too: dangerous is blocked (Go back only), suspicious asks, unknown says nothing.
 */
export function linkVerdictOf(r: Partial<LinkCheckResult> | { verdict?: unknown; safety?: unknown; reasons?: unknown; reason?: unknown; final_url?: unknown } | null | undefined): { verdict: LinkVerdict; reasons: string[]; reasonText: string | null; finalUrl: string | null } | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as { verdict?: unknown; safety?: unknown; reasons?: unknown; reason?: unknown; final_url?: unknown };
  const reasons = Array.isArray(o.reasons) ? o.reasons.filter((x): x is string => typeof x === 'string') : [];
  const reasonText = typeof o.reason === 'string' && o.reason.trim() ? o.reason : null;
  const finalUrl = typeof o.final_url === 'string' && o.final_url ? o.final_url : null;
  const old = o.verdict === 'ok' || o.verdict === 'caution' || o.verdict === 'danger' || o.verdict === 'blocked' ? o.verdict : null;
  const map: Record<string, LinkVerdict | null> = { safe: 'ok', suspicious: 'caution', dangerous: 'blocked', unknown: null };
  const safety = typeof o.safety === 'string' ? o.safety : typeof o.verdict === 'string' && !old ? o.verdict : null;
  const fromSafety = safety !== null ? (map[safety] ?? null) : null;
  const verdict = old ?? fromSafety;
  if (verdict === null && !finalUrl && !reasonText) return null;
  return { verdict: verdict ?? 'ok', reasons, reasonText, finalUrl };
}

// ── Sending (P-UI-15) ────────────────────────────────────────────────────────────────────────────────

const MALWARE_CODES = new Set(['malware', 'malware_attachment', 'MALWARE', 'MALWARE_ATTACHMENT', 'send_blocked_malware', 'SEND_BLOCKED']);
const PAUSED_CODES = new Set(['paused', 'sending_paused', 'outbound_paused', 'OUTBOUND_PAUSED', 'SENDING_PAUSED', 'account_paused']);

/**
 * Why the server refused a send, when protection refused it: a file with malware (the draft is kept), or this
 * mailbox's sending paused for review. The refusal names it in `code` (the envelope's or `errors.code`) and may carry
 * `threat`, `attachment` and `reason`. Anything else is an ordinary refusal: null.
 */
export function sendBlockOf(e: unknown): SendBlock | null {
  if (!e || typeof e !== 'object') return null;
  const err = e as { message?: unknown; code?: unknown; data?: unknown; status?: unknown };
  const data = (err.data && typeof err.data === 'object' ? err.data : {}) as Record<string, unknown>;
  const errors = (data.errors && typeof data.errors === 'object' ? data.errors : data) as Record<string, unknown>;
  const code = [err.code, errors.code, errors.reason, data.code].find((c) => typeof c === 'string' && (MALWARE_CODES.has(c) || PAUSED_CODES.has(c))) as string | undefined;
  const message = typeof err.message === 'string' ? err.message : '';
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  if (code && MALWARE_CODES.has(code)) return { kind: 'malware', attachment: str(errors.attachment) ?? str(errors.file), threat: str(errors.threat), message };
  if (code && PAUSED_CODES.has(code)) return { kind: 'paused', reason: str(errors.detail) ?? str(errors.why) ?? (code === errors.reason ? null : str(errors.reason)), message };
  return null;
}

/** Bytes as "1.2 MB", for the quarantine and admin lists. */
export function sizeWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
