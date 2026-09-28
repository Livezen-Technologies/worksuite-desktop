import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { APP_PARTS, canOpenApp, SHELL_SCREENS, type VisibleApps } from '@shared/access';
import { APP_CATALOGUE } from '@shared/apps';
import { defineDesktopManifest, validateManifest, type DesktopManifest, type DesktopManifestInput } from '@shared/manifest';

/**
 * DesktopAppRegistry, renderer half (FR-REG-01..07, §15).
 *
 * Each desktop module declares a manifest and a lazily-loaded screen. The
 * manifest is validated against the module contract before anything from it
 * is registered; an invalid one is dropped and logged, never shown. The
 * server decides which apps the user may see (shared/apps.ts); this decides
 * which of them the desktop can render natively.
 */
export interface ModuleProps {
  tabId: string;
  route: string;
  active: boolean;
}

export interface DesktopModule {
  id: string;
  manifest: DesktopManifest;
  component: LazyExoticComponent<ComponentType<ModuleProps>>;
  /** Available to everyone signed in, regardless of app access (a shell screen, shared/access.ts). */
  always?: boolean;
  /** Available to whoever may open this app (a part of another app, in its own windows; shared/access.ts). */
  requires?: string;
}

const DEFS: Array<{ input: DesktopManifestInput; load: () => Promise<{ default: ComponentType<ModuleProps> }> }> = [
  {
    input: defineDesktopManifest({
      id: 'home', name: 'Home', icon: 'home', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/dashboard/home'] },
      native: ['notifications'],
      widgets: [{ id: 'todays-work', size: 'md' }, { id: 'calendar', size: 'md' }, { id: 'waiting-for-me', size: 'md' }, { id: 'activity', size: 'md' }, { id: 'files', size: 'md' }, { id: 'summary', size: 'md' }],
    }),
    load: () => import('./home/HomePage'),
  },
  {
    input: defineDesktopManifest({ id: 'activity', name: 'Activity', icon: 'activity', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' } }),
    load: () => import('./activity/ActivityPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'mail', name: 'Mail', icon: 'mail', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'DRAFTS', entities: ['draft'], cache: ['/api/mail/folders', '/api/mail/messages', '/api/mail/mailboxes'] },
      native: ['notifications', 'file-drop', 'printing'],
      quickActions: [{ id: 'compose', label: 'New Email', route: '/mail?compose=1' }],
      deepLinks: ['mail', 'mail/:id'],
    }),
    load: () => import('./mail/MailPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'chat', name: 'Chat', icon: 'chat', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['message'], cache: ['/api/chat/rooms', '/api/chat/messages'] },
      native: ['notifications', 'file-drop'],
      windows: [{ id: 'chat-mini', route: '/chat', alwaysOnTop: true }],
      quickActions: [{ id: 'open-chat', label: 'Open Chat', route: '/chat' }],
      deepLinks: ['chat', 'chat/:id'],
    }),
    load: () => import('./chat/ChatPage'),
  },
  {
    // Chat calls: the ring and the call each open in a window of their own.
    input: defineDesktopManifest({
      id: 'calls', name: 'Calls', icon: 'phone', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      windows: [{ id: 'call', route: '/calls/call', alwaysOnTop: true }, { id: 'ring', route: '/calls/ring', alwaysOnTop: true }],
    }),
    load: () => import('./calls/CallsPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'meet', name: 'Meet', icon: 'video', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      windows: [{ id: 'meet', route: '/meet' }],
      quickActions: [{ id: 'new-meeting', label: 'New meeting', route: '/meet' }],
      deepLinks: ['meet', 'meet/:id'],
    }),
    load: () => import('./meet/MeetPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'meetings', name: 'Meetings', icon: 'calendar-clock', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      deepLinks: ['meetings'],
    }),
    load: () => import('./meetings/MeetingsPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'calendar', name: 'Calendar', icon: 'calendar', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/calendar/events'] },
      native: ['notifications'],
    }),
    load: () => import('./calendar/CalendarPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'tasks', name: 'Tasks', icon: 'tasks', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['task'], cache: ['/api/tasks', '/api/task-lists'] },
      native: ['notifications'],
      quickActions: [{ id: 'new-task', label: 'New Task', route: '/tasks?new=1' }],
    }),
    load: () => import('./tasks/TasksPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'notes', name: 'Notes', icon: 'notebook', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/notes', '/api/notebooks', '/api/note-sections'] },
      quickActions: [{ id: 'new-note', label: 'New Note', route: '/notes?new=1' }],
    }),
    load: () => import('./notes/NotesPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'contacts', name: 'Contacts', icon: 'contact', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/contacts', '/api/contact-groups'] },
      quickActions: [{ id: 'new-contact', label: 'New Contact', route: '/contacts?new=1' }],
    }),
    load: () => import('./contacts/ContactsPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'files', name: 'Files', icon: 'folder', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/files/browse', '/api/drive/list', '/api/drive/tree', '/api/drive/home'] },
      native: ['file-drop', 'printing'],
      quickActions: [{ id: 'upload', label: 'Upload File', route: '/files?upload=1' }],
    }),
    load: () => import('./files/FilesPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'crm', name: 'CRM', icon: 'users', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['lead'], cache: ['/api/crm/leads'] },
      native: ['file-drop'],
      quickActions: [{ id: 'new-lead', label: 'New Lead', route: '/crm?new=1' }],
      deepLinks: ['crm/leads/:id'],
    }),
    load: () => import('./crm/CrmShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'sales', name: 'Sales & Orders', icon: 'trending-up', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['order'], cache: ['/api/oms/orders'] },
      quickActions: [{ id: 'new-order', label: 'New Order', route: '/sales?tab=orders&new=1' }],
    }),
    load: () => import('./sales/SalesShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'billing', name: 'Invoices', icon: 'receipt', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['invoice'], cache: ['/api/billing/invoices'] },
      quickActions: [{ id: 'new-invoice', label: 'New Invoice', route: '/billing?tab=inv&new=1' }],
    }),
    load: () => import('./billing/BillingShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'tenders', name: 'Tenders', icon: 'file-text', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['tender'], cache: ['/api/tenders', '/api/tenders/dashboard', '/api/tenders/board'] },
      native: ['notifications'],
      quickActions: [{ id: 'new-tender', label: 'New Tender', route: '/tenders?make=new' }],
    }),
    load: () => import('./tenders/TendersShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'inventory', name: 'Inventory', icon: 'package', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['product'], cache: ['/api/inventory/products', '/api/inventory/stock'] },
      quickActions: [{ id: 'new-product', label: 'New Product', route: '/inventory?tab=prod&new=1' }],
    }),
    load: () => import('./inventory/InventoryShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'hr', name: 'HR', icon: 'id-card', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/hr/attendance/me', '/api/hr/me/profile', '/api/hr/leave/balance', '/api/hr/leave/requests', '/api/hr/leave/approvals'] },
      native: ['notifications'],
      quickActions: [{ id: 'clock-in', label: 'Clock In', route: '/hr' }],
    }),
    load: () => import('./hr/HrShell'),
  },
  {
    input: defineDesktopManifest({ id: 'notifications', name: 'Notifications', icon: 'bell', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'READ_CACHE', cache: ['/api/notifications'] } }),
    load: () => import('./notifications/NotificationsPage'),
  },
  {
    input: defineDesktopManifest({ id: 'settings', name: 'Settings', icon: 'settings', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' } }),
    load: () => import('./settings/SettingsPage'),
  },
  {
    input: defineDesktopManifest({ id: 'account', name: 'My account', icon: 'user', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' }, deepLinks: ['account'] }),
    load: () => import('./account/AccountPage'),
  },
  {
    input: defineDesktopManifest({ id: 'diagnostics', name: 'Diagnostics', icon: 'stethoscope', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' } }),
    load: () => import('./diagnostics/DiagnosticsPage'),
  },
];

export const MODULES: DesktopModule[] = [];
export const REJECTED: Array<{ id: string; error: string }> = [];

for (const def of DEFS) {
  const check = validateManifest(def.input);
  if (!check.ok || !check.manifest) {
    REJECTED.push({ id: String((def.input as { id?: unknown }).id ?? '?'), error: check.error ?? 'invalid' });
    console.warn('[registry] module rejected', def.input.id, check.error);
    continue;
  }
  const id = check.manifest.id;
  MODULES.push({ id, manifest: check.manifest, component: lazy(def.load), always: SHELL_SCREENS.has(id), requires: APP_PARTS[id] });
}

export function moduleFor(id: string): DesktopModule | undefined {
  return MODULES.find((m) => m.id === id);
}

export function appForRoute(route: string): string {
  const seg = route.replace(/^\/+/, '').split(/[/?#]/)[0] || 'home';
  return MODULES.some((m) => m.id === seg) ? seg : 'home';
}

export function titleForRoute(route: string): string {
  const id = appForRoute(route);
  return moduleFor(id)?.manifest.name ?? APP_CATALOGUE.find((a) => a.id === id)?.label ?? 'WorkSuite';
}

/**
 * Modules the current user may open: visible apps with a desktop module, the
 * parts of a visible app (calls, of chat), and the always-on screens — the
 * same decision as everywhere else (`canOpenApp`, shared/access.ts).
 */
export function allowedModules(visibleAppIds: VisibleApps): Set<string> {
  const out = new Set<string>();
  for (const m of MODULES) if (canOpenApp(m.id, visibleAppIds)) out.add(m.id);
  return out;
}

export function parseRoute(route: string): { path: string[]; query: URLSearchParams } {
  const [p, q] = route.split('?');
  return { path: (p ?? '').split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}
