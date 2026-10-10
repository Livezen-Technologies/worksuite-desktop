import { text } from '../../../../core/i18n';
import { useTab, useTabTitle } from '../../../../core/tab-context';
import { AdminNav } from '../../../settings/AdminNav';
import { AdminQuarantine } from './AdminQuarantine';
import { Engines } from './Engines';
import { Lists } from './Lists';
import { AttachmentsTab, ReportsTab } from './More';
import { Overview } from './Overview';
import { Policies } from './Policies';
import { protTabOf, useAdminPerms } from './parts';

/**
 * Admin Center › Mail & Communication › Protection (ENH-MAIL-04 MPR-ADM-01; D21–D25): drawn by this app in its own
 * Admin Center, as Chat › Ringing is, at `/settings/admin/mail/protection/<tab>` — Overview, Policies, Quarantine,
 * Allow & block lists, Attachments, Engines, Reports, and Search and remove from Overview and Quarantine. Whoever
 * lacks mail.security.view is told so; the web's `/admin/mail/protection` is the same screens in the browser.
 */
export function AdminProtection() {
  useTabTitle('Admin Center');
  const { path } = useTab();
  const perms = useAdminPerms();
  const tab = protTabOf(path[4]);
  return (
    <div className="flex h-full min-h-0">
      <AdminNav here="protection" />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground px-7 py-5 scroll-thin">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3.5">
          {!perms.view ? (
            <p role="alert" className="rounded-[10px] bg-subtle px-4 py-3 text-[13px] text-ink-2">{text('Mail protection needs the View mail security permission. Ask an administrator.')}</p>
          ) : tab === 'policies' ? (
            <Policies />
          ) : tab === 'quarantine' ? (
            <AdminQuarantine />
          ) : tab === 'lists' ? (
            <Lists />
          ) : tab === 'attachments' ? (
            <AttachmentsTab />
          ) : tab === 'engines' ? (
            <Engines />
          ) : tab === 'reports' ? (
            <ReportsTab />
          ) : (
            <Overview />
          )}
        </div>
      </main>
    </div>
  );
}
