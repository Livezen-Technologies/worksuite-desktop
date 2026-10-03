/**
 * Settings › Desktop › Links (worksuite-desktop#170): how WorkSuite links open.
 * Kept as one object on the preferences, filled with these defaults when a
 * setting was never saved.
 */
export interface LinkPrefs {
  /** Open WorkSuite links in the desktop app (on): off, a web link goes to the browser. */
  openInApp: boolean;
  /** A WorkSuite link clicked in Mail: in a new tab, or in place of the Mail tab. */
  mailLinks: 'new-tab' | 'current-tab';
  /**
   * Ask before running any action a link asks for (on). Actions that change
   * data are always confirmed, whatever this says.
   */
  confirmActions: boolean;
}

export const DEFAULT_LINK_PREFS: LinkPrefs = { openInApp: true, mailLinks: 'new-tab', confirmActions: true };

export function linkPrefs(prefs: { links?: Partial<LinkPrefs> } | null | undefined): LinkPrefs {
  const l = prefs?.links ?? {};
  return {
    openInApp: typeof l.openInApp === 'boolean' ? l.openInApp : DEFAULT_LINK_PREFS.openInApp,
    mailLinks: l.mailLinks === 'current-tab' || l.mailLinks === 'new-tab' ? l.mailLinks : DEFAULT_LINK_PREFS.mailLinks,
    confirmActions: typeof l.confirmActions === 'boolean' ? l.confirmActions : DEFAULT_LINK_PREFS.confirmActions,
  };
}
