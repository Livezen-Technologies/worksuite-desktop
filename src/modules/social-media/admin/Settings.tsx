import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Button, cx } from '../../../components/ui';
import { dataOf, rowsOf, SK, socialApi, useBrands, useInvalidate, useModuleStatus, useSettings, type SettingsPage, type SettingsSection, type SettingValue } from '../api';
import { useSocialAccess } from '../access';
import { Notice, NotOffered, OptionalView, PageBody, PageHeader, Panel } from '../parts';
import { fieldsFor, FieldRows } from './settings/fields';
import { ProviderAppsSection } from './settings/ProviderApps';
import { AdvancedTools, BrandsList, isDiagnosticKey, isNotificationKey, NotificationsGrid, PermissionsMatrix } from './settings/sections';

/**
 * A02 · Module settings (SMM-ADM-001…007, §19). The standard ten sections down the left, one at a time on the
 * right; the route carries the section. Provider apps keeps its own Save per network (a secret is sent only when
 * typed); every other section collects its edits and "Save changes" sends them together. The server audits every
 * change and refuses anyone without social.settings.manage.
 */

const SECTIONS: Array<{ id: SettingsSection; label: string; sub?: string }> = [
  { id: 'general', label: 'General', sub: 'Defaults for new posts' },
  { id: 'access', label: 'User access', sub: 'Who can open Social Media Manager' },
  { id: 'permissions', label: 'Permissions', sub: 'What each social.* permission allows' },
  { id: 'organization', label: 'Organization', sub: 'Brands and what your edition allows' },
  { id: 'providers', label: 'Provider apps' },
  { id: 'publishing', label: 'Publishing', sub: 'Retries, spacing, links and reminders' },
  { id: 'approvals', label: 'Approvals', sub: 'External review and approval defaults' },
  { id: 'inbox', label: 'Inbox', sub: 'Sync, business hours and reply targets' },
  { id: 'notifications', label: 'Notifications', sub: 'Who hears about what, and where' },
  { id: 'advanced', label: 'Advanced', sub: 'Kill switch, retention, export and diagnostics' },
];

type Values = Record<string, SettingValue>;

function SectionForm({ section, page, draft, onChange, canEdit, onEditRoles }: { section: string; page: SettingsPage; draft: Values; onChange: (k: string, v: SettingValue) => void; canEdit: boolean; onEditRoles: () => void }) {
  const brands = rowsOf(useBrands().data);
  const values = { ...page.values, ...draft };
  const fields = (skip?: (k: string) => boolean) => (
    <FieldRows defs={fieldsFor(section, page.values, (k) => isNotificationKey(k) || isDiagnosticKey(k) || !!skip?.(k))} values={values} onChange={onChange} brands={brands} disabled={!canEdit} />
  );
  switch (section) {
    case 'permissions':
      return <PermissionsMatrix onEditRoles={onEditRoles} />;
    case 'organization':
      return (
        <div className="flex flex-col gap-4">
          <BrandsList />
          {fields()}
        </div>
      );
    case 'notifications':
      return <NotificationsGrid values={values} onChange={onChange} disabled={!canEdit} />;
    case 'advanced':
      return (
        <div className="flex flex-col gap-4">
          <AdvancedTools values={page.values} canEdit={canEdit} />
          {fields()}
        </div>
      );
    default:
      return fields();
  }
}

export default function Settings({ section }: { section: string | null }) {
  const tab = useTab();
  const invalidate = useInvalidate();
  const status = useModuleStatus();
  const access = useSocialAccess(dataOf(status.data)?.permissions);
  const current = section || 'general';
  const known = SECTIONS.find((s) => s.id === current);
  const isProviders = current === 'providers';
  // Unknown sections are asked for anyway and drawn generically.
  const q = useSettings(current as SettingsSection, !isProviders);
  const [drafts, setDrafts] = useState<Record<string, Values>>({});
  const draft = drafts[current] ?? {};
  const dirty = Object.keys(draft).length > 0;
  const canEdit = access.settings;

  const save = useMutation({
    mutationFn: (v: { section: string; values: Values }) => socialApi.saveSettings(v.section as SettingsSection, v.values),
    onSuccess: (_r, v) => {
      setDrafts((d) => {
        const { [v.section]: _gone, ...rest } = d;
        return rest;
      });
      invalidate(SK.settings(v.section as SettingsSection), SK.status);
      toast('success', 'Settings saved.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const onChange = (k: string, v: SettingValue) => setDrafts((d) => ({ ...d, [current]: { ...(d[current] ?? {}), [k]: v } }));
  const title = known?.label ?? current.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

  let body: ReactNode;
  if (isProviders) body = <ProviderAppsSection canEdit={canEdit} />;
  else
    body = (
      <>
        <h2 className="text-[16px] font-bold text-ink">{title}</h2>
        {known?.sub ? <p className="mb-2 text-[12.5px] text-ink-3">{known.sub}</p> : null}
        {current === 'permissions' && q.data && !q.data.offered ? (
          <div className="flex flex-col gap-3">
            <NotOffered what="Social Media Manager’s permissions" compact />
            <PermissionsMatrix onEditRoles={() => tab.openLink('/admin/roles')} />
          </div>
        ) : (
          <OptionalView q={q} what={`${title} settings`} compact>
            {(page) => <SectionForm section={current} page={page} draft={draft} onChange={onChange} canEdit={canEdit} onEditRoles={() => tab.openLink('/admin/roles')} />}
          </OptionalView>
        )}
      </>
    );

  return (
    <>
      <PageHeader
        crumb="Administer"
        title="Module settings"
        actions={
          <>
            <Button icon="history" onClick={() => tab.openLink('/admin/audit?module=social-media')}>
              Audit log
            </Button>
            <Button variant="primary" disabled={!dirty || !canEdit || isProviders} loading={save.isPending} onClick={() => save.mutate({ section: current, values: draft })}>
              Save changes
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="h-fit rounded-[14px] border border-line bg-surface p-2">
            <ul className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => {
                const on = s.id === current;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={on ? 'page' : undefined}
                      onClick={() => tab.go(`/social-media/settings/${s.id}`)}
                      className={cx('flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[13px]', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink-2 hover:bg-subtle hover:text-ink')}
                    >
                      {s.label}
                      {drafts[s.id] && Object.keys(drafts[s.id]!).length ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-warning" aria-label="Unsaved changes" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col gap-3">
            {!canEdit ? (
              <Notice tone="warning" icon="lock">
                You can look, but only Social Admins (social.settings.manage) can change settings.
              </Notice>
            ) : null}
            <Panel bodyClassName="flex flex-col gap-1 pt-4">{body}</Panel>
            <p className="text-[11.5px] text-ink-3">Only Social Admins (social.settings.manage) can open settings; every change is audited.</p>
          </div>
        </div>
      </PageBody>
    </>
  );
}
