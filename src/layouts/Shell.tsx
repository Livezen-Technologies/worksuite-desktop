import { useEffect, useRef } from 'react';
import type { AiHandoff, NavigateRequest } from '@shared/types';
import { canOpen, canOpenWeb, refuse, useCanOpen, useVisibleIds } from '../core/access';
import { app, isGuest } from '../core/app-state';
import { useGuest } from '../core/session';
import { GuestProfileMenu } from '../modules/guest/GuestProfileMenu';
import { call, errorMessage, isMac, on } from '../core/bridge';
import { accelerator, commandForAccelerator, getCommand, registerCommand, runCommand } from '../core/commands';
import { initLauncherPrefs, shellShortcuts } from '../core/launcher-prefs';
import { initOrgPrefs } from '../core/org-prefs';
import { noteRecentApp } from '../core/recent-apps';
import { useStore } from '../core/store';
import { activateIndex, activeTab, closeTab, closeTabsForApps, detachTab, dockSide, insertTab, navigate, newRoute, openTab, resetTabs, restoreClosed, restoreTabs, suspendIdle, tabsStore, undockSide } from '../core/tabs';
import { toast } from '../core/toasts';
import { aiWidget, closeOverlay, closeTopPanel, minimiseChatDrawer, openAssistant, openChatDrawer, openOverlay, toggleAssistant, toggleDock, ui, useAiDisplay } from '../core/ui';
import { allowedModules, moduleFor } from '../modules/registry';
import { PanelBoundary } from '../app/Boundaries';
import { AiDock, askWorkSuite, makeTask, openAiChanges, openAiDockWith, useAssistantAlerts, useAssistantFollowsDisplay } from '../app/overlays/AiDock';
import { AiWidget } from '../app/overlays/AiWidget';
import { AI_WORKSPACE_ATTR, restoreAssistant, useAutoMinimize } from '../app/overlays/aiMinimize';
import { closeMenuOnRouteChange, openAssistantAtStart } from '../app/overlays/panels';
import { Launcher } from '../app/overlays/Launcher';
import { NetworkPopover, NotificationCenter, ProfileMenu, TransferCenter } from '../app/overlays/Popovers';
import { OrgSwitcher } from '../app/overlays/OrgSwitcher';
import { switchOrganization } from '../core/orgs';
import { ClockPopover } from '../app/overlays/ClockPopover';
import { ItemLinkDialog } from '../app/overlays/ItemLinkDialog';
import { closeItemDialog, openItemLink } from '../core/item-links';
import { SearchOverlay } from '../app/overlays/SearchOverlay';
import { UpdateBanner, UpdatePopover } from '../app/screens/UpdateScreens';
import { UpdateNotices } from '../app/overlays/UpdateControls';
import { MandatoryBanner } from '../app/screens/MandatoryUpdate';
import { UpdateDialogs } from '../app/screens/UpdateDialogs';
import { ChatDrawer, MinimisedChats, useDrawerShown } from '../modules/chat/ChatDrawer';
import { RingingBar } from '../modules/chat/website/Ringing';
import { watchMicrophone } from '../modules/chat/website/mic';
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
  const visible = useVisibleIds();
  const hasChat = useCanOpen('chat');
  const hasAi = useCanOpen('ai');
  const chatOpen = dock === 'chat' && hasChat;
  const chatShown = useDrawerShown(chatOpen);
  // With the call window off, the bar under the tabs plays the tone instead.
  const ringWindow = useStore(app, (s) => s.prefs?.webchatRinging?.window ?? true);
  const info = useStore(app, (s) => s.info);
  const restored = useRef(false);
  const guest = useGuest();
  const knownApps = useRef<Set<string> | null>(null);

  // Settings › AI Assistant: the assistant open from the start, where the person keeps it (#61).
  const aiDisplay = useAiDisplay();
  useAssistantFollowsDisplay();
  useAssistantAlerts();
  // Settings › AI Assistant › Auto-minimize when I continue working (#126).
  useAutoMinimize();
  // Only when WorkSuite starts, as the setting says; a menu closes when the screen changes under it (#150).
  useEffect(() => void openAssistantAtStart(), []);
  // Whether this computer can take a visitor's voice call (ENH-WCHAT-05, VOICE-11).
  useEffect(() => (hasChat ? watchMicrophone() : undefined), [hasChat]);
  useEffect(() => closeMenuOnRouteChange(), []);
  // The launcher's preferences follow whoever is signed in: this computer's copy at once, then the server's (#201).
  useEffect(() => initLauncherPrefs(), []);
  useEffect(() => initOrgPrefs(), []);

  // Tab restore at start (FR-NAV-04) — only apps the user can still open.
  useEffect(() => {
    if (restored.current || apps.length === 0) return;
    restored.current = true;
    const allowed = allowedModules(visible);
    void restoreTabs(allowed).then((ok) => {
      if (!ok || tabsStore.get().tabs.length === 0) resetTabs();
      // And the tabs torn off into their own windows (FR-NAV-05/07), where they were.
      void call('windows:restoreDetached').catch(() => undefined);
      // Guest mode (#149) has no Home: it starts on Notes.
      if (!isGuest() && !tabsStore.get().tabs.some((t) => t.app === 'home')) openTab('/home', { background: true });
      if (info?.restoredFromCrash) toast('info', 'WorkSuite closed unexpectedly. Your tabs, drafts and unsent changes have been restored.');
    });
  }, [apps, visible, info]);

  // FR-REG-04 / WF-28: an app the person is no longer given leaves the
  // navigation and its tabs close — whichever way the bootstrap was refreshed
  // (sign-in, organization switch, access.changed, the periodic check).
  useEffect(() => {
    const prev = knownApps.current;
    knownApps.current = visible;
    if (!prev || !restored.current) return;
    const allowed = allowedModules(visible);
    const closed = closeTabsForApps(allowed);
    for (const id of closed) {
      const name = moduleFor(id)?.manifest.name ?? id;
      toast('warning', `${name} is no longer available to you.`);
    }
    if (!canOpen('ai')) {
      if (ui.get().dock === 'ai') toggleDock('ai');
      aiWidget.set({ open: false });
    }
  }, [visible]);

  // Shell commands (FR-SRCH-03) and shortcuts (FR-SRCH-04).
  useEffect(() => {
    const offs = [
      registerCommand({ id: 'search', label: 'Search', group: 'Shell', run: () => openOverlay('search') }),
      registerCommand({ id: 'palette', label: 'Command palette', group: 'Shell', run: () => openOverlay('palette') }),
      registerCommand({ id: 'new-tab', label: 'New tab', group: 'Shell', run: () => openTab('/home') }),
      registerCommand({
        id: 'close-tab',
        label: 'Close tab',
        group: 'Shell',
        run: () => {
          const t = activeTab();
          // On a Mac, ⌘W on the last tab closes the window, as it does in any Mac app; WorkSuite stays in the Dock (#221).
          if (isMac && (!t || tabsStore.get().tabs.length <= 1)) {
            void call('windows:close').catch(() => undefined);
            return;
          }
          if (t && !t.pinned) closeTab(t.id);
        },
      }),
      registerCommand({ id: 'restore-tab', label: 'Reopen closed tab', group: 'Shell', run: restoreClosed }),
      registerCommand({ id: 'move-tab-to-window', label: 'Move tab to new window', group: 'Shell', keywords: 'tear off detach undock window', run: () => { const t = activeTab(); if (t) void detachTab(t.id); } }),
      registerCommand({
        id: 'dock-tab-beside',
        label: 'Dock tab beside / undock',
        group: 'Shell',
        keywords: 'split side by side dock panel',
        run: () => {
          const s = tabsStore.get();
          if (s.sideId) undockSide();
          else if (s.activeId) dockSide(s.activeId);
        },
      }),
      registerCommand({ id: 'settings', label: 'Settings', group: 'Navigate', run: () => navigate('/settings') }),
      registerCommand({ id: 'account', label: 'My account', group: 'Navigate', keywords: 'profile picture password two-factor passkey sessions', run: () => navigate('/account/profile'), when: () => !isGuest() }),
      registerCommand({ id: 'account-security', label: 'Change my password', group: 'Navigate', keywords: 'security two-factor 2fa passkey sessions sign out', run: () => navigate('/account/security'), when: () => !isGuest() }),
      registerCommand({ id: 'ai', label: 'Open AI Assistant', group: 'Shell', run: () => toggleAssistant(), when: () => canOpen('ai') }),
      registerCommand({ id: 'ai-alt', label: 'Open AI Assistant', group: 'Shell', hidden: true, run: () => toggleAssistant(), when: () => canOpen('ai') }),
      registerCommand({ id: 'switch-org', label: 'Switch organization', group: 'Shell', run: () => openOverlay('org'), when: () => !isGuest() }),
      registerCommand({ id: 'lock', label: 'Lock WorkSuite', group: 'Shell', run: () => void call('security:lock'), when: () => !isGuest() }),
      registerCommand({ id: 'help', label: 'Help & Diagnostics', group: 'Navigate', run: () => navigate('/diagnostics') }),
      registerCommand({ id: 'launcher', label: 'App launcher', group: 'Navigate', keywords: 'all apps grid', run: () => openOverlay('launcher') }),
      registerCommand({ id: 'notifications', label: 'Notifications', group: 'Navigate', run: () => navigate('/notifications'), when: () => !isGuest() }),
      registerCommand({ id: 'theme', label: 'Change theme', group: 'Shell', keywords: 'dark light appearance', run: () => navigate('/settings/preferences') }),
      registerCommand({ id: 'pause-notifications', label: 'Pause notifications for an hour', group: 'Shell', run: () => void call('notifications:pause', { minutes: 60 }).then(() => toast('info', 'Notifications paused for an hour.')), when: () => !isGuest() }),
      registerCommand({ id: 'new', label: 'New (in this app)', group: 'Create', run: () => { const t = activeTab(); if (t) navigate(newRoute(t)); } }),
      registerCommand({ id: 'new-task', label: 'Create task', group: 'Create', run: () => navigate('/tasks?new=1'), when: () => canOpen('tasks') }),
      registerCommand({ id: 'new-email', label: 'New email', group: 'Create', run: () => navigate('/mail?compose=1'), when: () => canOpen('mail') }),
      registerCommand({ id: 'open-chat', label: 'Open chat', group: 'Navigate', run: () => navigate('/chat'), when: () => canOpen('chat') }),
      registerCommand({ id: 'chat-drawer', label: 'Chat over this screen', group: 'Shell', keywords: 'drawer message', run: () => (ui.get().dock === 'chat' ? minimiseChatDrawer() : openChatDrawer(ui.get().chatRoom)), when: () => canOpen('chat') }),
      registerCommand({ id: 'upload', label: 'Upload file', group: 'Create', run: () => navigate('/files?upload=1'), when: () => canOpen('files') }),
      registerCommand({ id: 'clock-in', label: 'Clock in / out', group: 'Create', run: () => navigate('/hr'), when: () => canOpen('hr') }),
      registerCommand({ id: 'new-lead', label: 'New lead', group: 'Create', run: () => navigate('/crm?new=1'), when: () => canOpen('crm') }),
      ...Array.from({ length: 9 }, (_, i) => registerCommand({ id: `tab-${i + 1}`, label: `Go to tab ${i + 1}`, group: 'Shell', run: () => activateIndex(i + 1) })),
      // ⌃0–⌃9 (Ctrl+Alt elsewhere): All organizations, then the switcher's list in order. Shortcuts only, not palette entries.
      ...Array.from({ length: 10 }, (_, i) =>
        registerCommand({
          id: `org-${i}`,
          label: i === 0 ? 'Show all organizations' : `Switch to organization ${i}`,
          group: 'Shell',
          hidden: true,
          run: () => {
            const b = app.get().bootstrap;
            const orgs = b?.organizations ?? [];
            if (orgs.length < 2) return;
            const target = i === 0 ? null : (orgs[i - 1]?.id ?? undefined);
            if (target === undefined || target === app.get().organizationId) return;
            void switchOrganization(target);
          },
        }),
      ),
    ];
    const onKey = (e: KeyboardEvent) => {
      const acc = accelerator(e);
      if (!acc) return;
      const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (typing && !acc.includes('Mod') && acc !== 'F1') return;
      const id = commandForAccelerator(shellShortcuts(app.get().prefs?.shortcuts), acc);
      // ⌘⇧K inside a text editor that took it for itself (a link) stays there.
      if (id === 'launcher' && e.defaultPrevented) return;
      if (!id) {
        // Escape that nothing nearer took: the open menu, else the assistant (#150).
        if (e.key === 'Escape' && !e.defaultPrevented) closeTopPanel();
        return;
      }
      if (!getCommand(id)) return;
      e.preventDefault();
      e.stopPropagation();
      // Unavailable (an app the person was not given): the keys do nothing.
      runCommand(id);
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
        runCommand(c.id === 'tab' ? `tab-${c.arg ?? 1}` : c.id);
      }),
      // Quick Ask handing its text over: the AI dock, a new task, or search.
      on<AiHandoff>('ai:open', (h) => {
        if (h.to === 'task') makeTask(h.text);
        else if (h.to === 'search') askWorkSuite(h.text);
        else if (h.to === 'changes') {
          openAiChanges();
          openAssistant();
        } else if (h.to === 'ask') {
          restoreAssistant();
        } else {
          openAiDockWith(h.text, h.result);
          openAssistant();
        }
      }),
      on<NavigateRequest>('navigate', (req) => {
        // A WorkSuite item link (#170): its organisation, access, offline copy and action are settled there.
        if (req.item) {
          void openItemLink(req.item.link, { source: req.item.source });
          return;
        }
        const target = req.route.replace(/^\/+/, '').split(/[/?]/)[0] || 'home';
        if (moduleFor(target) ? !canOpen(target) : !canOpenWeb(req.route)) {
          refuse(req.route);
          return;
        }
        if (!moduleFor(target)) {
          toast('info', 'That record opens in WorkSuite on the web.');
          void call('app:openInBrowser', { path: req.route }).catch((e) => toast('error', errorMessage(e)));
          return;
        }
        // A torn-off window docked back: a tab of its own, or beside the open one. A file the OS handed over: a tab of its own.
        if (req.source === 'dock' || req.source === 'file') {
          insertTab(req.route, { title: req.title, side: req.side });
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
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // The launcher's Recent row: the app of whichever tab comes to the front.
  const userId = useStore(app, (s) => s.auth?.user?.id ?? null);
  useEffect(() => {
    let last: string | null = null;
    const note = () => {
      const t = activeTab();
      if (t && t.app !== last) {
        last = t.app;
        if (t.app !== 'home') noteRecentApp(userId, t.app);
      }
    };
    note();
    return tabsStore.subscribe(note);
  }, [userId]);

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
          <MandatoryBanner />
          <UpdateBanner />
          <UpdateNotices />
          <UpdateDialogs />
          <TabStrip />
          {hasChat ? <RingingBar tone={!ringWindow} /> : null}
          <div className="relative flex min-h-0 flex-1">
            {/* The floating AI widget keeps inside the workspace: never over the sidebar, the tabs, the status bar or a drawer. */}
            <div {...{ [AI_WORKSPACE_ATTR]: '' }} className="relative flex min-h-0 min-w-0 flex-1">
              <Workspace />
              {hasAi ? (
                <PanelBoundary name="The AI Assistant" onClose={() => aiWidget.set({ open: false })} floating>
                  <AiWidget />
                </PanelBoundary>
              ) : null}
            </div>
            {dock === 'ai' && hasAi && aiDisplay !== 'widget' ? (
              <PanelBoundary name="The AI Assistant" onClose={() => toggleDock('ai')}>
                <AiDock />
              </PanelBoundary>
            ) : null}
            {/*
              The chat drawer (worksuite-desktop#264): docked, a column beside the workspace, which gives up its width —
              the title bar and the tab strip above keep the window's; floating, over the workspace. It stays a moment
              after it is put away, to leave as it came.
            */}
            {chatShown ? (
              <PanelBoundary name="Chat" onClose={() => minimiseChatDrawer()}>
                <ChatDrawer closing={!chatOpen} />
              </PanelBoundary>
            ) : null}
            {hasChat ? (
              <PanelBoundary name="Minimised chats" floating>
                <MinimisedChats />
              </PanelBoundary>
            ) : null}
          </div>
          <StatusBar />
        </div>
      </div>
      <PanelBoundary name="This panel" onClose={() => closeOverlay()} floating resetKey={overlay}>
        {overlay === 'search' ? <SearchOverlay mode="search" /> : null}
        {overlay === 'palette' ? <SearchOverlay mode="palette" /> : null}
        {overlay === 'launcher' ? <Launcher /> : null}
        {overlay === 'notifications' ? <NotificationCenter /> : null}
        {overlay === 'transfers' ? <TransferCenter /> : null}
        {overlay === 'org' ? <OrgSwitcher /> : null}
        {overlay === 'profile' ? guest ? <GuestProfileMenu /> : <ProfileMenu /> : null}
        {overlay === 'network' ? <NetworkPopover /> : null}
        {overlay === 'clock' ? <ClockPopover /> : null}
        {overlay === 'update' ? <UpdatePopover /> : null}
      </PanelBoundary>
      <PanelBoundary name="This link" onClose={closeItemDialog} floating>
        <ItemLinkDialog />
      </PanelBoundary>
    </div>
  );
}
