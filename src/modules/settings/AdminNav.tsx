import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { SettingsNavGroup, SettingsNavItem } from '../../components/SettingsKit';

/**
 * The Admin Center's rail (the Settings rail's "Admin Center" footer): its sections as the designs list them. Two are
 * this app's own screens — Mail › Protection (ENH-MAIL-04 D21–D25) and Chat › Ringing (P-03) — each for whoever may
 * use it; every other section is the web app's and opens in the browser.
 */

export const ADMIN_RINGING_ROUTE = '/settings/admin/chat/ringing';
export const ADMIN_PROTECTION_ROUTE = '/settings/admin/mail/protection';

export type AdminHere = 'ringing' | 'protection';

interface NavItem {
  label: string;
  web?: string;
  route?: string;
  here?: AdminHere;
  sub?: boolean;
  group?: boolean;
  /** Shown only to whoever holds this permission. */
  perm?: string;
}

const NAV: NavItem[] = [
  { label: 'Organizations', web: '/organization' },
  { label: 'Users & roles', web: '/users' },
  { label: 'Mail', web: '/admin/mail' },
  { label: 'Protection', sub: true, route: ADMIN_PROTECTION_ROUTE, here: 'protection', perm: 'mail.security.view' },
  { label: 'Chat', group: true },
  { label: 'General', web: '/module-settings?module=communication&section=general', sub: true },
  { label: 'Ringing', sub: true, route: ADMIN_RINGING_ROUTE, here: 'ringing' },
  { label: 'Drive', web: '/admin/drive/retention' },
  { label: 'Security', web: '/security' },
];

/** Whether this person holds a permission (`*` holds them all). */
export function useHasPermission(perm: string): boolean {
  return useStore(app, (s) => !!s.bootstrap?.permissions?.some((p) => p === '*' || p === perm));
}

export function AdminNav({ here }: { here: AdminHere }) {
  const { go } = useTab();
  const protection = useHasPermission('mail.security.view');
  const open = (path: string) => void call('app:openInBrowser', { path }).catch((e: unknown) => toast('error', errorMessage(e)));
  const shown = NAV.filter((n) => !n.perm || (n.perm === 'mail.security.view' ? protection : true));
  return (
    <nav aria-label="Admin sections" className="flex w-[220px] shrink-0 flex-col gap-px border-r border-line bg-surface px-3 pt-4 pb-4">
      <h1 className="px-3 pt-1 pb-3 text-[20px] font-bold text-ink">Admin Center</h1>
      {shown.map((n) =>
        n.group ? (
          <SettingsNavGroup key={n.label}>{n.label}</SettingsNavGroup>
        ) : (
          <SettingsNavItem key={n.label} label={n.label} indent={n.sub} current={n.here === here} title={n.web ? 'Opens in your browser' : undefined} onClick={() => (n.web ? open(n.web) : go(n.route!))} />
        ),
      )}
    </nav>
  );
}
