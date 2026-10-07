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

/**
 * Settings › Sidebar: the person's own sidebar (core/sidebar-prefs) — what is pinned, what they removed from it (to
 * bring back), and Reset to default. Pinning, removing and ordering are done in the sidebar itself: right-click an
 * app there, or drag it. Only apps the person may open are listed.
 */

function Card({ title, hint, aside, children }: { title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[16px] border border-line bg-surface p-[18px]" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[16px] font-bold text-ink">{title}</h3>
          {hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
        </div>
        {aside ? <span className="text-[12px] text-ink-3">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Line({ a, children }: { a: AppDefinition; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-subtle text-ink-2">
        <Icon name={a.icon} size={17} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{appLabel(a)}</span>
      {children}
    </li>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-[560px] flex-col gap-1">
          <h2 className="text-[22px] font-bold text-ink">{t('sidebar.title')}</h2>
          <p className="text-[13.5px] text-ink-3">{t('sidebar.hint')}</p>
          <p className="text-[12.5px] text-ink-3" data-sidebar-source={source}>
            {source === 'local' ? t('sidebar.local') : t('sidebar.synced')}
          </p>
        </div>
        <Button icon="undo" onClick={() => setConfirm(true)}>
          {t('sidebar.reset')}
        </Button>
      </div>

      <Card title={t('nav.pinned')} hint={t('sidebar.pinnedHint')} aside={pinned.length ? String(pinned.length) : undefined}>
        {pinned.length ? (
          <ul className="flex flex-col gap-3" aria-label={t('nav.pinned')}>
            {pinned.map((a) => (
              <Line key={a.id} a={a}>
                <Button size="sm" icon="pin-off" onClick={() => void pinSidebarItem(a.id, false)}>
                  {t('sidebar.unpin')}
                </Button>
              </Line>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">{t('sidebar.nonePinned')}</p>
        )}
      </Card>

      <Card title={t('sidebar.hidden')} hint={t('sidebar.hiddenHint')} aside={hidden.length ? String(hidden.length) : undefined}>
        {hidden.length ? (
          <ul className="flex flex-col gap-3" aria-label={t('sidebar.hidden')}>
            {hidden.map((a) => (
              <Line key={a.id} a={a}>
                <Button size="sm" icon="eye" onClick={() => restore(a)}>
                  {t('sidebar.restore')}
                </Button>
              </Line>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">{t('sidebar.noneHidden')}</p>
        )}
      </Card>

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
