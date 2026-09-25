import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * The application menu (FR-SHL-05). On macOS it is the real menu bar with the
 * platform's standard menus; its accelerators send the same commands the
 * renderer's shortcut registry handles on Windows and Linux, where the custom
 * title bar replaces the menu bar.
 */
export function buildMenu(send: (command: string, arg?: number) => void, actions: { checkUpdates: () => void; diagnostics: () => void; quit: () => void }): void {
  const mac = process.platform === 'darwin';
  const cmd = (id: string, arg?: number) => () => send(id, arg);
  // Shortcuts are handled by the renderer's registry on every platform (so
  // they can be remapped, FR-SRCH-04); the menu shows them without
  // registering them, which would fire each command twice.
  const r = { registerAccelerator: false };
  const template: MenuItemConstructorOptions[] = [];
  if (mac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: actions.checkUpdates },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('settings'), ...r },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Lock WorkSuite', accelerator: 'Cmd+L', click: cmd('lock'), ...r },
        { label: 'Quit WorkSuite', accelerator: 'Cmd+Q', click: actions.quit },
      ],
    });
  }
  template.push({
    label: 'File',
    submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: cmd('new'), ...r },
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: cmd('new-tab'), ...r },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab'), ...r },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: cmd('restore-tab'), ...r },
      { type: 'separator' },
      { label: 'Switch Organization…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('switch-org'), ...r },
      ...(mac ? [] : [{ type: 'separator' as const }, { label: 'Settings', accelerator: 'Ctrl+,', click: cmd('settings'), ...r }, { label: 'Exit', click: actions.quit }]),
    ],
  });
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'selectAll' },
    ],
  });
  template.push({
    label: 'View',
    submenu: [
      { label: 'Search', accelerator: 'CmdOrCtrl+K', click: cmd('search'), ...r },
      { label: 'Command Palette', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('palette'), ...r },
      { label: 'AI Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('ai'), ...r },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }]),
    ],
  });
  template.push({ role: 'windowMenu' });
  template.push({
    role: 'help',
    submenu: [
      { label: 'Diagnostics', accelerator: 'F1', click: actions.diagnostics, ...r },
      ...(mac ? [] : [{ label: 'Check for Updates…', click: actions.checkUpdates }, { label: 'Lock WorkSuite', accelerator: 'Ctrl+L', click: cmd('lock'), ...r }]),
    ],
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
