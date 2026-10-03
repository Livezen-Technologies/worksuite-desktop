import { resolveWebLink } from '@shared/links';
import { looksLikeItemLink, parseItemLink, workSuiteWebPath } from '@shared/item-links';
import { linkPrefs } from '@shared/link-prefs';
import { canFollowLink, refuse } from '../../core/access';
import { app } from '../../core/app-state';
import { openItemLink } from '../../core/item-links';
import { activeTab, navigate, openTab, setRoute } from '../../core/tabs';
import { toast } from '../../core/toasts';

/** The hosts a WorkSuite link in an email may point at: WorkSuite's own and the server this app is signed in to. */
export function workSuiteHosts(): Array<string | null> {
  const origin = app.get().auth?.server?.origin;
  try {
    return [origin ? new URL(origin).hostname : null];
  } catch {
    return [];
  }
}

/**
 * A link clicked in an email that points into WorkSuite (worksuite-desktop#170)
 * opens in a tab here, not the browser — an item link through the item-link
 * steps, a page of an app at that app's tab. Returns false for anything that
 * is not WorkSuite's (or when "Open WorkSuite links in the desktop app" is
 * off), which then goes through Mail's safe-links check as before.
 */
export function openWorkSuiteLinkFromMail(url: string): boolean {
  const prefs = linkPrefs(app.get().prefs);
  if (!prefs.openInApp) return false;
  const hosts = workSuiteHosts();
  if (looksLikeItemLink(url)) {
    const parsed = parseItemLink(url, { hosts });
    if (parsed.ok) {
      void openItemLink(parsed.link, { source: 'email', place: prefs.mailLinks });
      return true;
    }
    // On WorkSuite's own address but not a link it knows: refused, never guessed at.
    if (parsed.reason !== 'unknown_host' && parsed.reason !== 'bad_scheme') {
      toast('error', 'That WorkSuite link could not be opened.');
      return true;
    }
    return false;
  }
  const path = workSuiteWebPath(url, { hosts });
  if (!path) return false;
  const target = resolveWebLink(path);
  if (target.kind !== 'tab') return false;
  if (!canFollowLink(path)) {
    refuse(target.app);
    return true;
  }
  if (prefs.mailLinks === 'new-tab') openTab(target.route);
  else {
    const here = activeTab();
    if (here && !here.pinned) setRoute(here.id, target.route);
    else navigate(target.route);
  }
  return true;
}
