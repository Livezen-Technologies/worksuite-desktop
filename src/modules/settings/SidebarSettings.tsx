import { useMemo, useState, type ReactNode } from 'react';
import { navApps, type AppDefinition } from '@shared/apps';
import { hiddenSidebarItems, mergeSidebar, sidebarDefaults } from '@shared/sidebar-prefs';
import { app } from '../../core/app-state';
import { appLabel, t } from '../../core/i18n';
import { useGuest } from '../../core/session';
import { hideSidebarItem, pinSidebarItem, resetSidebar, useSidebarPrefs, useSidebarSource } from '../../core/sidebar-prefs';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';
import { SectionHeader, SettingRow, SettingsGroup } from '../../components/SettingsKit';

/**
 * Settings › Sidebar: the person's own sidebar (core/sidebar-prefs) — what is pinned, what they removed from it (to
 * bring back), and Reset to default. Pinning, removing and ordering are done in the sidebar itself: right-click an
 * app there, or drag it. Only apps the person may open are listed.
 */

/** An app's row: its icon and name, and what can be done with it. */
function Line({ a, children }: { a: AppDefinition; children: ReactNode }) {
  return (
    <SettingRow
      as="li"
      label={appLabel(a)}
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-subtle text-ink-2">
          <Icon name={a.icon} size={17} />
        </span>
      }
    >
      {children}
    </SettingRow>
  );
}

export function SidebarSettings() {
  const apps = useStore(app, (s) => s.apps);
  const guest = useGuest();
  const own = useSidebarPrefs();
  const source = useSidebarSource();
  const [confirm, setConfirm] = useState(false);
  const listed = useMemo(() => navApps(apps), [apps]);
  const defaults = useMemo(() => sidebarDefaults(listed, guest), [listed, guest]);
  const pinned = useMemo(() => mergeSidebar(defaults, listed, own.items).pinned, [defaults, listed, own]);
  const hidden = useMemo(() => hiddenSidebarItems(defaults, listed, own.items), [defaults, listed, own]);

  const restore = (a: AppDefinition) =>
    void hideSidebarItem(a.id, false).then((ok) => {
      if (ok) toast('success', t('sidebar.restored', { app: appLabel(a) }));
    });
  const reset = () =>
    void resetSidebar().then((ok) => {
      if (ok) toast('success', t('sidebar.resetDone'));
    });

  return (
    <div className="flex flex-col">
      <SectionHeader
        title={t('sidebar.title')}
        hint={
          <>
            {t('sidebar.hint')}
            <span className="mt-1 block text-[12.5px]" data-sidebar-source={source}>
              {source === 'local' ? t('sidebar.local') : t('sidebar.synced')}
            </span>
          </>
        }
        actions={
          <Button icon="undo" onClick={() => setConfirm(true)}>
            {t('sidebar.reset')}
          </Button>
        }
      />

      <SettingsGroup title={t('nav.pinned')} description={t('sidebar.pinnedHint')} actions={pinned.length ? <span className="text-[12px] text-ink-3">{pinned.length}</span> : undefined} list={pinned.length ? t('nav.pinned') : undefined}>
        {pinned.length ? (
          <>
            {pinned.map((a) => (
              <Line key={a.id} a={a}>
                <Button size="sm" icon="pin-off" onClick={() => void pinSidebarItem(a.id, false)}>
                  {t('sidebar.unpin')}
                </Button>
              </Line>
            ))}
          </>
        ) : (
          <p className="px-[18px] py-3.5 text-[13px] text-ink-3">{t('sidebar.nonePinned')}</p>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('sidebar.hidden')} description={t('sidebar.hiddenHint')} actions={hidden.length ? <span className="text-[12px] text-ink-3">{hidden.length}</span> : undefined} list={hidden.length ? t('sidebar.hidden') : undefined}>
        {hidden.length ? (
          <>
            {hidden.map((a) => (
              <Line key={a.id} a={a}>
                <Button size="sm" icon="eye" onClick={() => restore(a)}>
                  {t('sidebar.restore')}
                </Button>
              </Line>
            ))}
          </>
        ) : (
          <p className="px-[18px] py-3.5 text-[13px] text-ink-3">{t('sidebar.noneHidden')}</p>
        )}
      </SettingsGroup>

      {confirm ? (
        <Modal
          title={t('sidebar.resetTitle')}
          labelledBy="sidebar-reset-title"
          width={420}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(false);
                  reset();
                }}
              >
                {t('sidebar.reset')}
              </Button>
            </>
          }
        >
          <p className="text-[13px] leading-[1.5] text-ink-2">{t('sidebar.resetBody')}</p>
        </Modal>
      ) : null}
    </div>
  );
}
