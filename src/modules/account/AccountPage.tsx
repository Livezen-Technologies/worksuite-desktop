import { lazy, Suspense, useState } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { SECTIONS, type Section } from './api';
import { AccountRail } from './Rail';
import type { AvatarStyle } from './avatarArt';
import { PictureEditor, type EditorTab } from './PictureEditor';

/**
 * My account (the "19 · My account" designs): my profile, how people reach
 * me, my preferences and notifications, how I sign in, my pictures, and what
 * I may open. Everything here is about the person signed in — settings for
 * this computer stay in Settings. Addressed `/account/<section>`; the web's
 * `/account/settings?tab=…`, `/account/security` and `/account/access` land
 * on the same screens.
 */
const Profile = lazy(() => import('./Profile'));
const General = lazy(() => import('./General'));
const Preferences = lazy(() => import('./Preferences'));
const Notifications = lazy(() => import('./Notifications'));
const Security = lazy(() => import('./Security'));
const Pictures = lazy(() => import('./Pictures'));
const Access = lazy(() => import('./Access'));

const TITLES: Record<Section, string> = {
  profile: 'My profile',
  general: 'Profile settings',
  preferences: 'Preferences',
  notifications: 'Notifications',
  security: 'Security',
  pictures: 'Profile pictures',
  access: 'My access',
};

/** Opens the picture editor on a tab; every screen that shows your picture can ask for it. */
export type OpenEditor = (tab: EditorTab, style?: Partial<AvatarStyle> | null) => void;

export default function AccountPage(_props: ModuleProps) {
  const { path, query, go } = useTab();
  const asked = (path[1] ?? query.get('tab') ?? 'profile') as Section;
  const section: Section = SECTIONS.includes(asked) ? asked : 'profile';
  const opened = query.get('edit');
  const [editor, setEditor] = useState<{ tab: EditorTab; style: Partial<AvatarStyle> | null } | null>(opened === 'photo' || opened === 'avatar' ? { tab: opened, style: null } : null);
  useTabTitle(`My account · ${TITLES[section]}`);
  const open: OpenEditor = (tab, style = null) => setEditor({ tab, style });
  const pick = (s: Section) => go(`/account/${s}`);

  return (
    <div className="flex h-full min-h-0">
      <AccountRail section={section} onPick={pick} />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-ground px-7 py-[22px] scroll-thin">
        <Suspense fallback={<Spinner />}>
          {section === 'profile' ? <Profile onPick={pick} onEdit={open} /> : null}
          {section === 'general' ? <General onPick={pick} onEdit={open} /> : null}
          {section === 'preferences' ? <Preferences /> : null}
          {section === 'notifications' ? <Notifications /> : null}
          {section === 'security' ? <Security /> : null}
          {section === 'pictures' ? <Pictures onEdit={open} /> : null}
          {section === 'access' ? <Access /> : null}
        </Suspense>
      </main>
      {editor ? <PictureEditor tab={editor.tab} style={editor.style} onTab={(tab) => setEditor({ tab, style: editor.style })} onClose={() => (setEditor(null), opened ? go(`/account/${section}`) : undefined)} /> : null}
    </div>
  );
}
