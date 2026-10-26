import type { Preferences } from '@shared/types';
import { linkPrefs, type LinkPrefs } from '@shared/link-prefs';
import { updatePrefs } from '../../core/app-state';
import { useFeature } from '../../core/desktop-settings';
import { Switch } from '../../components/ui';
import { Select } from '../../components/Select';

/**
 * Settings › Desktop › Links (worksuite-desktop#170): whether WorkSuite links
 * open in this app, where a link clicked in Mail opens, and whether a link's
 * action asks first. Actions that change data always ask; the last switch
 * covers the rest (a download, joining a meeting).
 */
export function LinksSettings({ prefs }: { prefs: Preferences }) {
  const l = linkPrefs(prefs);
  // `features.itemLinks` off (desktop settings): links open in the browser, and the switch says so.
  const itemLinks = useFeature('itemLinks');
  const set = (patch: Partial<LinkPrefs>) => {
    const { openInApp, ...rest } = { ...l, ...patch };
    // While it is off, the person's own "open in the app" is left as they saved it (links merge field by field).
    void updatePrefs({ links: itemLinks ? { ...rest, openInApp } : rest });
  };
  return (
    <section aria-labelledby="settings-links" className="mt-8">
      <h3 id="settings-links" className="mb-1 text-[15px] font-bold text-ink">
        Links
      </h3>
      <Line label="Open WorkSuite links in the desktop app" hint="Links to files, meetings, tasks and other WorkSuite items open here instead of the browser.">
        <Switch label="Open WorkSuite links in the desktop app" checked={l.openInApp} disabled={!itemLinks} onChange={(v) => set({ openInApp: v })} />
      </Line>
      <Line label="Open links from Mail in" hint="Where a WorkSuite link clicked in an email opens.">
        <Select
          label="Open links from Mail in"
          value={l.mailLinks}
          disabled={!l.openInApp}
          options={[
            { value: 'new-tab', label: 'A new tab' },
            { value: 'current-tab', label: 'The current tab' },
          ]}
          onValueChange={(v) => set({ mailLinks: v })}
        />
      </Line>
      <Line label="Ask before running actions from links" hint="Downloads and joining a meeting ask first. Anything that changes data — marking done, answering an invitation, requesting access — always asks.">
        <Switch label="Ask before running actions from links" checked={l.confirmActions} onChange={(v) => set({ confirmActions: v })} />
      </Line>
    </section>
  );
}

function Line({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{label}</div>
        <div className="mt-0.5 text-[12.5px] text-ink-3">{hint}</div>
      </div>
      <div className="min-w-0 max-w-[60%] shrink-0">{children}</div>
    </div>
  );
}
