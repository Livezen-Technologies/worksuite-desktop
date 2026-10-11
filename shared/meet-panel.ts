/**
 * What the meeting's side panel shows at the top, and what goes behind More
 * (the WorkSuite Meet Side Panel canvas).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY FOUR TABS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The panel had ten: People, Chat, Q&A, Polls, Board, Notes, Files, Info,
 * Settings and — in a support session — Session. Ten tabs in a 380px column
 * wrap onto three rows, and the three that are used in almost every meeting
 * sit among seven that are used in almost none. So three stay, and the rest
 * move behind **More**, which is a grid of cards with a line each saying what
 * the thing is for — a tab strip cannot say that, and a name alone ("Board")
 * does not tell somebody who has never opened it what they would get.
 *
 * Nothing is removed and nothing moves house: a tool behind More is the same
 * tab with the same content, one press further away.
 */

/** The three a meeting uses constantly, in the order the canvas draws them. */
export const PANEL_PRIMARY: readonly string[] = ['Chat', 'People', 'Q&A'];

/** How a tool behind More describes itself, beyond its name. */
export const PANEL_HELP: Record<string, string> = {
  Polls: 'Ask a quick question and see results live',
  Board: 'Draw and sketch together',
  Notes: 'Shared notes, and the summary after the call',
  Files: 'Everything shared in this meeting',
  Info: 'The meeting ID, the link and who is hosting',
  Settings: 'Chat, reactions, the waiting room and who may present',
  Session: 'The support session, its ticket and AI assist',
};

export interface PanelLayout<T> {
  /** The tabs the strip shows, in order. */
  tabs: T[];
  /** What More holds, in order; empty when there is nothing to put there. */
  more: T[];
}

/**
 * Split a meeting's tabs into the strip and what More holds.
 *
 * A support session is left alone: RC-SUP-03 already reduces that room to
 * Chat, Files and Session, which is three — putting one of three behind More
 * would be hiding a third of a panel to save nothing.
 */
export function panelLayout<T extends { id: string }>(all: T[], opts: { support?: boolean } = {}): PanelLayout<T> {
  if (opts.support) return { tabs: all, more: [] };

  const primary = PANEL_PRIMARY.map((id) => all.find((t) => t.id === id)).filter((t): t is T => !!t);
  const rest = all.filter((t) => !PANEL_PRIMARY.includes(t.id));

  // Nothing to put behind More: don't draw a More tab that opens an empty grid.
  if (!rest.length) return { tabs: primary, more: [] };

  return { tabs: primary, more: rest };
}
