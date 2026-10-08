import type { AttachChoice } from '../attach';

/**
 * What a channel's message actions offer (C-02, SRS RDC-12; worksuite-desktop#229). Team Chat and website chats draw
 * their messages with the same kit; a channel only turns things off. Turned-off actions are hidden, never greyed out:
 * the visitor's widget cannot show a reaction, a forward or a pin, so offering one would promise what never arrives.
 * What a message already carries is still drawn — a reaction made on another surface shows, it just cannot be added.
 */
export interface ChannelCaps {
  /** Add or change a reaction (existing ones are drawn regardless). */
  reactions: boolean;
  forward: boolean;
  pin: boolean;
  star: boolean;
  edit: boolean;
  /** Voice notes play inline as a voice message (otherwise an audio file is a file). */
  voice: boolean;
  /**
   * Where playing somebody's voice message is noted (#285), `{id}` the message's: its dot goes on every device. Left
   * out, the dot goes on this computer only.
   */
  listenedPath?: string;
  urgent: boolean;
  copy: boolean;
  /** "Save to Drive" on a message's files; only where a save path exists for that channel's files. */
  saveToDrive: boolean;
  /** "Copy link" to the conversation (worksuite://chat/<room>). */
  copyLink: boolean;
  /** "Create task" from a message (the drawer's menu). */
  createTask: boolean;
  /** Consecutive picture-only messages in a run collapse into one grid (2–4 tiles, "+N"). */
  gridImages: boolean;
  /**
   * How long staff may delete a message for the visitor too (`chat_delete_for_everyone_minutes`, RDC-12). Left out
   * (Team Chat), delete is as the server's per-message `can` says; `null` while the server offers no such delete, and
   * then Delete is not shown at all.
   */
  deleteForVisitorMinutes?: number | null;
  /** Where the server reads a link's card (#229); left out, links are shortened but get no card. */
  linkPreviewPath?: string;
  /** Words written in Markdown — **bold**, lists, [links](…) — are drawn formatted (#261); left out, as they are written. */
  markdown?: boolean;
}

export const TEAM_CAPS: ChannelCaps = {
  reactions: true,
  forward: true,
  pin: true,
  star: true,
  edit: true,
  voice: true,
  listenedPath: '/api/chat/messages/{id}/listened',
  urgent: true,
  copy: true,
  saveToDrive: false,
  copyLink: true,
  createTask: true,
  // Each picture keeps its own star, pin and delete in Team Chat.
  gridImages: false,
};

/**
 * Website chats (RDC-12, P-04): Reply, Copy, Save to Drive (a copy of the visitor's file in my Drive) and Delete for the
 * visitor within the server's window. A thread sets the window the server gives it; left null, Delete is not shown.
 */
export const WEBSITE_CAPS: ChannelCaps = {
  // The visitor's widget shows reactions and adds its own (server Communication 1.60.0); each message says if it may.
  reactions: true,
  forward: false,
  pin: false,
  star: false,
  edit: false,
  // A visitor's recording (a phone's voice memo, a forwarded voice note) plays in the voice player (#285); their
  // widget cannot play one back, so the composer still sends none.
  voice: true,
  urgent: false,
  copy: true,
  saveToDrive: true,
  copyLink: false,
  createTask: false,
  gridImages: true,
  deleteForVisitorMinutes: null,
  linkPreviewPath: '/api/chat/widget-admin/link-preview',
  // A saved reply, an assistant's draft or the bot's answer written in Markdown reads formatted here, as the list's
  // plain preview promises (worksuite-desktop#261).
  markdown: true,
};

/**
 * What a channel's composer offers (P-04 "One chat kit", SRS RDC-02; CHAT-UI-02): Team Chat and website chats write
 * with the one `Composer` (ChatComposer), and the channel profile decides its buttons. As with the message actions,
 * what a visitor's widget cannot receive is hidden, never greyed out.
 */
export interface ComposerCaps {
  /** The paperclip, a pasted file or screenshot, files dropped on the thread, and the camera. */
  attach: boolean;
  emoji: boolean;
  /** Quote a message in the reply ("Replying to …"). */
  replyQuote: boolean;
  /** Saved replies: the "/" picker, the chips above the box and their button (RDC-03). */
  savedReplies: boolean;
  /** The writing assistant (the AI tools button). */
  assistant: boolean;
  /** "@" to mention somebody — and its button. A website chat has it in an internal note only. */
  mentions: boolean;
  /** Record and send a voice message — and its button. */
  voice: boolean;
  urgent: boolean;
  /** Share from WorkSuite: records sent as their address and shown as cards. */
  shareRecords: boolean;
  /** "From Drive" sends a copy of the file, never a Drive link (RDC-05). */
  driveCopy: boolean;
  /** What the paperclip offers, in order; left out, everything Team Chat has. */
  attachChoices?: AttachChoice[];
  /** The paperclip's words for a choice where the channel says it differently (AttachmentPicker · website). */
  attachCopy?: Partial<Record<AttachChoice, { label: string; hint?: string }>>;
  /** How the writing assistant's button is named. */
  assistantLabel?: string;
}

export const TEAM_COMPOSER: ComposerCaps = {
  attach: true,
  emoji: true,
  replyQuote: true,
  savedReplies: true,
  assistant: true,
  mentions: true,
  voice: true,
  urgent: true,
  shareRecords: true,
  driveCopy: false,
};

/**
 * Website chats (P-04, RDC-02): attach, paste, drop, camera, emoji, reply quote, saved replies and the writing
 * assistant; no @mentions (notes only), voice notes, urgent, sharing records or Drive links. The paperclip says what it
 * does for a visitor: Upload a file, Paste a screenshot, Take a photo, From Drive — a copy.
 */
export const WEBSITE_COMPOSER: ComposerCaps = {
  attach: true,
  emoji: true,
  replyQuote: true,
  savedReplies: true,
  assistant: true,
  mentions: false,
  voice: false,
  urgent: false,
  shareRecords: false,
  driveCopy: true,
  attachChoices: ['upload', 'paste', 'camera', 'drive'],
  attachCopy: {
    camera: { label: 'Take a photo' },
    drive: { label: 'From Drive', hint: "Sends a copy — visitors can't open Drive links" },
  },
  assistantLabel: 'Writing assistant',
};
