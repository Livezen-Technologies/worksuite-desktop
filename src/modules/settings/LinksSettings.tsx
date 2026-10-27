import type { Preferences } from '@shared/types';
import { linkPrefs, type LinkPrefs } from '@shared/link-prefs';
import { updatePrefs } from '../../core/app-state';
import { useFeature } from '../../core/desktop-settings';
import { Switch } from '../../components/ui';
import { Select } from '../../components/Select';
import { SettingRow, SettingsGroup } from '../../components/SettingsKit';

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
    <SettingsGroup title="Links">
      <SettingRow label="Open WorkSuite links in the desktop app" hint="Links to files, meetings, tasks and other WorkSuite items open here instead of the browser.">
        <Switch label="Open WorkSuite links in the desktop app" checked={l.openInApp} disabled={!itemLinks} onChange={(v) => set({ openInApp: v })} />
      </SettingRow>
      <SettingRow label="Open links from Mail in" hint="Where a WorkSuite link clicked in an email opens.">
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
      </SettingRow>
      <SettingRow label="Ask before running actions from links" hint="Downloads and joining a meeting ask first. Anything that changes data — marking done, answering an invitation, requesting access — always asks.">
        <Switch label="Ask before running actions from links" checked={l.confirmActions} onChange={(v) => set({ confirmActions: v })} />
      </SettingRow>
    </SettingsGroup>
  );
}
