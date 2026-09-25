import { useEffect, useRef } from 'react';
import type { NavigateRequest, ToastMessage } from '@shared/types';
import { app } from '../core/app-state';
import { call, on } from '../core/bridge';
import { accelerator, commandForAccelerator, effectiveShortcuts, getCommand, registerCommand } from '../core/commands';
import { useStore } from '../core/store';
import { activateIndex, activeTab, closeTab, closeTabsForApps, navigate, openTab, resetTabs, restoreClosed, restoreTabs, suspendIdle, tabsStore } from '../core/tabs';
import { toast } from '../core/toasts';
import { closeOverlay, openOverlay, toggleDock, ui } from '../core/ui';
import { allowedModules, moduleFor } from '../modules/registry';
import { AiDock } from '../app/overlays/AiDock';
import { Launcher } from '../app/overlays/Launcher';
import { NetworkPopover, NotificationCenter, OrgSwitcher, ProfileMenu, TransferCenter } from '../app/overlays/Popovers';
import { SearchOverlay } from '../app/overlays/SearchOverlay';
import { UpdateBanner } from '../app/screens/UpdateScreens';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TabStrip } from './TabStrip';
import { TitleBar } from './TitleBar';
import { Workspace } from './Workspace';

/** The main window: title bar, sidebar, tabs, workspace, dock and status bar (UI-04, §4.1). */
export function Shell() {
  const overlay = useStore(ui, (s) => s.overlay);
  const dock = useStore(ui, (s) => s.dock);
  const apps = useStore(app, (s) => s.apps);
  const info = useStore(app, (s) => s.info);
  const restored = useRef(false);
  const knownApps = useRef<Set<string> | null>(null);

  // Tab restore at start (FR-NAV-04) — only apps the user can still open.
  useEffect(() => {
    if (restored.current || apps.length === 0) return;
    restored.current = true;
    const allowed = allowedModules(new Set(apps.map((a) => a.id)));
    void restoreTabs(allowed).then((ok) => {
      if (!ok || tabsStore.get().tabs.length === 0) resetTabs();
      if (!tabsStore.get().tabs.some((t) => t.app === 'home')) openTab('/home', { background: true });
      if (info?.restoredFromCrash) toast('info', 'WorkSuite closed unexpectedly. Your tabs, drafts and unsent changes have been restored.');
    });
  }, [apps, info]);

  // FR-REG-04 / WF-28: an app the administrator disabled leaves the navigation and its tabs close.
  useEffect(() => {
    const ids = new Set(apps.map((a) => a.id));
    const prev = knownApps.current;
    knownApps.current = ids;
    if (!prev || !restored.current) return;
    const allowed = allowedModules(ids);
    const closed = closeTabsForApps(allowed);
    for (const id of closed) {
      const name = moduleFor(id)?.manifest.name ?? id;
      toast('warning', `${name} was disabled by your administrator.`);
    }
  }, [apps]);

  // Shell commands (FR-SRCH-03) and shortcuts (FR-SRCH-04).
  useEffect(() => {
    const offs = [
      registerCommand({ id: 'search', label: 'Search', group: 'Shell', run: () => openOverlay('search') }),
      registerCommand({ id: 'palette', label: 'Command palette', group: 'Shell', run: () => openOverlay('palette') }),
      registerCommand({ id: 'new-tab', label: 'New tab', group: 'Shell', run: () => openTab('/home') }),
      registerCommand({ id: 'close-tab', label: 'Close tab', group: 'Shell', run: () => { const t = activeTab(); if (t && !t.pinned) closeTab(t.id); } }),
      registerCommand({ id: 'restore-tab', label: 'Reopen closed tab', group: 'Shell', run: restoreClosed }),
      registerCommand({ id: 'settings', label: 'Settings', group: 'Navigate', run: () => navigate('/settings') }),
      registerCommand({ id: 'ai', label: 'Open AI Assistant', group: 'Shell', run: () => toggleDock('ai') }),
      registerCommand({ id: 'switch-org', label: 'Switch organization', group: 'Shell', run: () => openOverlay('org') }),
      registerCommand({ id: 'lock', label: 'Lock WorkSuite', group: 'Shell', run: () => void call('security:lock') }),
      registerCommand({ id: 'help', label: 'Help & Diagnostics', group: 'Navigate', run: () => navigate('/diagnostics') }),
      registerCommand({ id: 'launcher', label: 'All apps', group: 'Navigate', run: () => openOverlay('launcher') }),
      registerCommand({ id: 'notifications', label: 'Notifications', group: 'Navigate', run: () => navigate('/notifications') }),
      registerCommand({ id: 'theme', label: 'Change theme', group: 'Shell', keywords: 'dark light appearance', run: () => navigate('/settings/preferences') }),
      registerCommand({ id: 'pause-notifications', label: 'Pause notifications for an hour', group: 'Shell', run: () => void call('notifications:pause', { minutes: 60 }).then(() => toast('info', 'Notifications paused for an hour.')) }),
      registerCommand({ id: 'new', label: 'New (in this app)', group: 'Create', run: () => { const t = activeTab(); if (t) navigate(`/${t.app}?new=1`); } }),
      registerCommand({ id: 'new-task', label: 'Create task', group: 'Create', run: () => navigate('/tasks?new=1'), when: () => app.get().apps.some((a) => a.id === 'tasks') }),
      registerCommand({ id: 'new-email', label: 'New email', group: 'Create', run: () => navigate('/mail?compose=1'), when: () => app.get().apps.some((a) => a.id === 'mail') }),
      registerCommand({ id: 'open-chat', label: 'Open chat', group: 'Navigate', run: () => navigate('/chat'), when: () => app.get().apps.some((a) => a.id === 'chat') }),
      registerCommand({ id: 'upload', label: 'Upload file', group: 'Create', run: () => navigate('/files?upload=1'), when: () => app.get().apps.some((a) => a.id === 'files') }),
      registerCommand({ id: 'clock-in', label: 'Clock in / out', group: 'Create', run: () => navigate('/hr'), when: () => app.get().apps.some((a) => a.id === 'hr') }),
      registerCommand({ id: 'new-lead', label: 'New lead', group: 'Create', run: () => navigate('/crm?new=1'), when: () => app.get().apps.some((a) => a.id === 'crm') }),
      ...Array.from({ length: 9 }, (_, i) => registerCommand({ id: `tab-${i + 1}`, label: `Go to tab ${i + 1}`, group: 'Shell', run: () => activateIndex(i + 1) })),
    ];
    const onKey = (e: KeyboardEvent) => {
      const acc = accelerator(e);
      if (!acc) return;
      const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (typing && !acc.includes('Mod') && acc !== 'F1') return;
      const id = commandForAccelerator(effectiveShortcuts(app.get().prefs?.shortcuts), acc);
      if (!id) {
        if (e.key === 'Escape') closeOverlay();
        return;
      }
      const cmd = getCommand(id);
      if (!cmd) return;
      e.preventDefault();
      e.stopPropagation();
      cmd.run();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      offs.forEach((off) => off());
    };
  }, []);

  // Commands from the application menu, navigation from deep links /
  // notifications / the tray, and toasts from the main process.
  useEffect(() => {
    const offs = [
      on<{ id: string; arg?: number }>('command', (c) => {
        const cmd = getCommand(c.id === 'tab' ? `tab-${c.arg ?? 1}` : c.id);
        cmd?.run();
      }),
      on<NavigateRequest>('navigate', (req) => {
        const allowed = allowedModules(new Set(app.get().apps.map((a) => a.id)));
        const target = req.route.replace(/^\/+/, '').split(/[/?]/)[0] || 'home';
        if (!allowed.has(target) && moduleFor(target)) {
          toast('error', "You don't have access to this record.");
          return;
        }
        if (!moduleFor(target)) {
          toast('info', 'That record opens in WorkSuite on the web.');
          void call('app:openInBrowser', { path: req.route });
          return;
        }
        if (req.organizationId && req.organizationId !== app.get().organizationId) {
          const org = app.get().bootstrap?.organizations.find((o) => o.id === req.organizationId);
          if (!org) {
            toast('error', "You don't have access to this record.");
            return;
          }
          toast('info', `This record belongs to ${org.name}.`, {
            label: 'Switch',
            run: () => void call('session:switchOrganization', { organizationId: org.id }).then(() => app.set({ organizationId: org.id })),
          });
        }
        navigate(req.route, req.organizationId ?? null);
      }),
      on<ToastMessage>('toast', (t) => toast(t.kind, t.text)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // FR-NAV-08: suspend idle tabs.
  const suspendAfter = useStore(app, (s) => s.prefs?.tabSuspendMinutes ?? 30);
  useEffect(() => {
    const h = setInterval(() => suspendIdle(suspendAfter), 60_000);
    return () => clearInterval(h);
  }, [suspendAfter]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <TabStrip />
          <div className="flex min-h-0 flex-1">
            <Workspace />
            {dock === 'ai' ? <AiDock /> : null}
          </div>
          <StatusBar />
        </div>
      </div>
      {overlay === 'search' ? <SearchOverlay mode="search" /> : null}
      {overlay === 'palette' ? <SearchOverlay mode="palette" /> : null}
      {overlay === 'launcher' ? <Launcher /> : null}
      {overlay === 'notifications' ? <NotificationCenter /> : null}
      {overlay === 'transfers' ? <TransferCenter /> : null}
      {overlay === 'org' ? <OrgSwitcher /> : null}
      {overlay === 'profile' ? <ProfileMenu /> : null}
      {overlay === 'network' ? <NetworkPopover /> : null}
    </div>
  );
}
