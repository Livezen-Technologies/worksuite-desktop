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
}

export const TEAM_CAPS: ChannelCaps = {
  reactions: true,
  forward: true,
  pin: true,
  star: true,
  edit: true,
  voice: true,
  urgent: true,
  copy: true,
  saveToDrive: false,
  copyLink: true,
  createTask: true,
  // Each picture keeps its own star, pin and delete in Team Chat.
  gridImages: false,
};

/**
 * Website chats (RDC-12): Reply and Copy. Save to Drive waits for a save path for widget files, and delete for the
 * visitor for the server's window; both stay hidden until then rather than half-working.
 */
export const WEBSITE_CAPS: ChannelCaps = {
  reactions: false,
  forward: false,
  pin: false,
  star: false,
  edit: false,
  voice: false,
  urgent: false,
  copy: true,
  saveToDrive: false,
  copyLink: false,
  createTask: false,
  gridImages: true,
  deleteForVisitorMinutes: null,
  linkPreviewPath: '/api/chat/widget-admin/link-preview',
};
