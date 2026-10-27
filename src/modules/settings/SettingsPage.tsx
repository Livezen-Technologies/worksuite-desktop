import type { ModuleProps } from '../registry';
import { useTab, useTabTitle } from '../../core/tab-context';
import { AdminProtection } from '../mail/protection/admin/AdminProtection';
import { AdminRinging, ADMIN_RINGING_ROUTE } from './AdminRinging';
import { useGuest } from '../../core/session';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { useCanOpen } from '../../core/access';
import { useHasPermission, ADMIN_PROTECTION_ROUTE } from './AdminNav';
import { useScrollFades } from '../../core/use-scroll-fades';
import { useState } from 'react';
import { searchSettings } from './search-index';
import { SettingsNavItem, SettingsSearchBox, SettingsNavGroup, SettingsQuery } from '../../components/SettingsKit';
import { cx } from '../../components/ui';
import { SinhalaSettings } from './SinhalaSettings';
import { LauncherSettings } from './LauncherSettings';
import { SidebarSettings } from './SidebarSettings';
import { AccountsServers } from './AccountsServers';
import { UpdatesPage, UpdateDiagnosticsPage } from './UpdatesPage';
import { MailSettings } from '../mail/MailSettings';
import { AccountsSettings } from '../contacts/sync/AccountsSettings';
import { LicensePage } from './LicensePage';
import { LocalProfileSection, LocalDataSection } from '../guest/LocalSettings';
import { FeaturesSettings } from './FeaturesSettings';
import { useManagesRinging } from './sections/parts';
import { General, PreferencesSection } from './sections/general';
import { NotificationsSection } from './sections/notifications';
import { SecuritySection, Devices } from './sections/security';
import { DesktopSection, FilesSection, OfflineSection } from './sections/desktop';
import { ChatSection, AiSection } from './sections/chat-ai';
import { LocalAISection } from './sections/local-ai';
import { MeetSection } from './sections/meet';
import { RemoteControlSection } from './sections/remote-control';
import { Monitoring, About } from './sections/about';

// The sections live one area per file in ./sections (audit D-G13); these keep their import paths.
export { useManagesRinging } from './sections/parts';
export { OrgFilterSetting } from './sections/general';
export { WebchatRingingPrefs } from './sections/notifications';
export { ChatSection, AiSection } from './sections/chat-ai';
export { SecuritySection } from './sections/security';
export { LocalAISection } from './sections/local-ai';
export { methodLabel, holdLabel, clipboardLabel, RC_RECHECK_MS, RemoteControlSection } from './sections/remote-control';
export { About } from './sections/about';

/** Pages laid out in cards side by side get the wider column. */
const WIDE: ReadonlySet<string> = new Set(['updates', 'update-diagnostics', 'license', 'accounts']);

/** Settings / profile tree (§4.9). Anything the organization's policy decides is shown locked, with the reason. */
const SECTIONS = [
  { id: 'general', label: 'General', icon: 'globe', group: 'Account' },
  { id: 'preferences', label: 'Preferences', icon: 'settings', group: 'Account' },
  { id: 'language', label: 'Language & Sinhala', icon: 'languages', group: 'Account' },
  { id: 'notifications', label: 'Notifications & calls', icon: 'bell', group: 'Account' },
  // The app launcher's look, apps, groups, order and shortcut (worksuite-desktop#201).
  { id: 'launcher', label: 'App launcher', icon: 'grid', group: 'Account' },
  // The person's own sidebar: pinned apps, apps removed from it, Reset to default.
  { id: 'sidebar', label: 'Sidebar', icon: 'sliders', group: 'Account' },
  { id: 'security', label: 'Security', icon: 'lock', group: 'Account' },
  { id: 'devices', label: 'Devices', icon: 'laptop', group: 'Account' },
  // Personal and Enterprise accounts side by side, and each one's connection health (Connection & Startup screen 15).
  { id: 'accounts', label: 'Accounts & Servers', icon: 'server', group: 'Desktop' },
  // What WorkSuite opens on, how it starts and runs on this computer (desktop settings `startup.screen`).
  { id: 'desktop', label: 'Desktop & startup', icon: 'monitor', group: 'Desktop' },
  // Features and apps on or off, with the organisation's policy (desktop settings `features.*`, `modules.*`).
  { id: 'features', label: 'Features & apps', icon: 'zap', group: 'Desktop' },
  { id: 'files', label: 'Files & Sync', icon: 'folder', group: 'Desktop' },
  { id: 'offline', label: 'Offline', icon: 'cloud-off', group: 'Desktop' },
  // Updates as its own page, with its Diagnostics (Updates & License design).
  { id: 'updates', label: 'Updates', icon: 'download', group: 'Desktop' },
  { id: 'update-diagnostics', label: 'Updates › Diagnostics', icon: 'stethoscope', group: 'Desktop' },
  { id: 'mail', label: 'Mail', icon: 'mail', group: 'Apps' },
  // How the chat drawer opens: docked beside the page or floating over it (worksuite-desktop#264).
  { id: 'chat', label: 'Chat', icon: 'chat', group: 'Apps' },
  // Contacts › Accounts & sync: Google, Outlook, iCloud, CardDAV, Mac Contacts (worksuite-desktop#175).
  { id: 'contacts', label: 'Contacts', icon: 'contact', group: 'Apps' },
  { id: 'ai', label: 'AI Assistant', icon: 'sparkles', group: 'Apps' },
  { id: 'local-ai', label: 'Local AI', icon: 'cpu', group: 'Apps' },
  { id: 'meet', label: 'Meet', icon: 'video', group: 'Apps' },
  { id: 'remote-control', label: 'Remote control', icon: 'screen-share', group: 'Apps' },
  { id: 'monitoring', label: 'Monitoring', icon: 'eye', group: 'Apps' },
  { id: 'about', label: 'About', icon: 'info', group: 'About' },
  { id: 'license', label: 'License', icon: 'key', group: 'About' },
  // Guest mode's own (#149): the Local Profile and its data, where an account's profile and data settings are.
  { id: 'local-profile', label: 'Profile', icon: 'user', group: 'This device' },
  { id: 'local-data', label: 'Backup & data', icon: 'download', group: 'This device' },
] as ReadonlyArray<{ id: string; label: string; icon: string; group: string }>;

/** What a guest's Settings show: what applies to this computer and the Local Profile, nothing that needs an account. */
const GUEST_SECTIONS: ReadonlySet<string> = new Set(['general', 'preferences', 'language', 'launcher', 'sidebar', 'updates', 'update-diagnostics', 'local-profile', 'local-data', 'about']);
const LOCAL_SECTIONS: ReadonlySet<string> = new Set(['local-profile', 'local-data']);

/**
 * Settings, and under it the Admin Center's Chat › Ringing (P-03: the Settings rail, an "Admin Center" tab) and Mail ›
 * Protection (ENH-MAIL-04 D21–D25), which this app draws itself; the Admin Center's other sections are the web app's.
 */
export default function SettingsPage(props: ModuleProps) {
  const { path } = useTab();
  // Admin Center › Mail › Protection (ENH-MAIL-04 D21–D25) and › Chat › Ringing (P-03): this app's own screens.
  if (path[1] === 'admin') return path[2] === 'mail' ? <AdminProtection /> : <AdminRinging />;
  return <SettingsSections {...props} />;
}

function SettingsSections(_props: ModuleProps) {
  useTabTitle('Settings');
  const { path, go, query } = useTab();
  const guest = useGuest();
  const shown = SECTIONS.filter((s) => (guest ? GUEST_SECTIONS.has(s.id) : !LOCAL_SECTIONS.has(s.id)));
  const section = shown.find((s) => s.id === path[1])?.id ?? 'general';
  const prefs = useStore(app, (s) => s.prefs);
  const hasMail = useCanOpen('mail');
  const hasContacts = useCanOpen('contacts');
  const hasChat = useCanOpen('chat');
  const managesRinging = useManagesRinging();
  const seesProtection = useHasPermission('mail.security.view');
  const { ref: listRef, fades, onScroll: onListScroll } = useScrollFades<HTMLDivElement>();
  const [find, setFind] = useState('');
  if (!prefs) return null;
  const listed = shown.filter((s) => (s.id !== 'mail' || hasMail) && (s.id !== 'contacts' || hasContacts) && (s.id !== 'chat' || hasChat));
  // Searching: the sections with something that matches, and under each what matched (search-index.ts).
  const hits = find.trim() ? searchSettings(find, listed) : null;
  const navItem = (s: (typeof SECTIONS)[number], sub?: string[]) => (
    <div key={s.id}>
      <SettingsNavItem label={s.label} icon={s.icon} current={section === s.id} onClick={() => go(`/settings/${s.id}`)} />
      {sub?.length ? (
        <ul className="mb-1 ms-[34px] flex flex-col">
          {sub.slice(0, 4).map((l) => (
            <li key={l}>
              <button type="button" onClick={() => go(`/settings/${s.id}`)} className="w-full truncate rounded-[6px] px-2 py-0.5 text-start text-[12px] text-ink-3 hover:bg-subtle hover:text-ink">
                {l}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  return (
    <div className="flex h-full bg-ground">
      {/*
        The sidebar fills the tab's height (never 100vh) and only its list scrolls, 16px clear of the bottom; Admin Center
        is a footer under it, so it is always whole above the status bar (worksuite-desktop#246).
      */}
      <nav className="flex h-full min-h-0 w-[240px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Settings sections">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={listRef} onScroll={onListScroll} data-settings-scroller className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-4 scroll-thin">
            <div>
              <h1 className="px-3 pt-1 pb-3 text-[20px] font-bold text-ink">Settings</h1>
              <SettingsSearchBox value={find} onChange={setFind} />
              {hits ? (
                hits.length ? (
                  hits.map((h) => navItem(h.section, h.labels))
                ) : (
                  <p className="px-3 py-4 text-[12.5px] text-ink-3">No setting matches “{find.trim()}”.</p>
                )
              ) : (
                listed.map((s, i, list) => (
                  <div key={s.id}>
                    {s.group !== list[i - 1]?.group ? <SettingsNavGroup>{s.group}</SettingsNavGroup> : null}
                    {navItem(s)}
                  </div>
                ))
              )}
            </div>
          </div>
          {/* More below: the list fades into the sidebar's own background, never a dark band. */}
          {fades.bottom ? <div aria-hidden data-fade="bottom" className="pointer-events-none absolute inset-x-0 bottom-0 h-8" style={{ background: 'linear-gradient(to bottom, transparent, var(--ws-surface))' }} /> : null}
        </div>
        {/* The organisation's ringing rules, for whoever manages website chats (P-03); it opens here, in the app. */}
        {(managesRinging || seesProtection) && !guest ? (
          <div data-settings-footer className="shrink-0 border-t border-line px-3 py-2">
            <SettingsNavItem label="Admin Center" icon="shield-check" onClick={() => go(managesRinging ? ADMIN_RINGING_ROUTE : ADMIN_PROTECTION_ROUTE)} />
          </div>
        ) : null}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-10 py-8 scroll-thin" data-settings-body>
        <SettingsQuery.Provider value={find}>
        <div className={cx('mx-auto', WIDE.has(section) ? 'max-w-[1040px]' : 'max-w-[780px]')}>
          {section === 'general' ? <General /> : null}
          {section === 'preferences' ? <PreferencesSection prefs={prefs} /> : null}
          {section === 'language' ? <SinhalaSettings /> : null}
          {section === 'notifications' ? <NotificationsSection prefs={prefs} /> : null}
          {section === 'launcher' ? <LauncherSettings /> : null}
          {section === 'sidebar' ? <SidebarSettings /> : null}
          {section === 'security' ? <SecuritySection prefs={prefs} /> : null}
          {section === 'devices' ? <Devices /> : null}
          {section === 'accounts' ? <AccountsServers /> : null}
          {section === 'desktop' ? <DesktopSection prefs={prefs} /> : null}
          {section === 'files' ? <FilesSection /> : null}
          {section === 'offline' ? <OfflineSection prefs={prefs} /> : null}
          {section === 'updates' ? <UpdatesPage onDiagnostics={() => go('/settings/update-diagnostics')} /> : null}
          {section === 'update-diagnostics' ? <UpdateDiagnosticsPage /> : null}
          {section === 'mail' && hasMail ? <MailSettings query={query} /> : null}
          {section === 'chat' && hasChat ? <ChatSection prefs={prefs} /> : null}
          {section === 'contacts' && hasContacts ? <AccountsSettings /> : null}
          {section === 'ai' ? <AiSection prefs={prefs} /> : null}
          {section === 'local-ai' ? <LocalAISection /> : null}
          {section === 'meet' && prefs ? <MeetSection prefs={prefs} /> : null}
          {section === 'remote-control' ? <RemoteControlSection /> : null}
          {section === 'monitoring' ? <Monitoring /> : null}
          {section === 'about' ? <About /> : null}
          {section === 'license' ? <LicensePage /> : null}
          {section === 'local-profile' ? <LocalProfileSection /> : null}
          {section === 'local-data' ? <LocalDataSection /> : null}
          {section === 'features' ? <FeaturesSettings /> : null}
        </div>
        </SettingsQuery.Provider>
      </div>
    </div>
  );
}
