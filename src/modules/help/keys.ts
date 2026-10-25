import { APP_CATALOGUE } from '@shared/apps';

/**
 * Which user guide each desktop screen opens (the server's guide keys: the web catalogue's app keys, plus `drive`
 * and `admin` — GET /api/help/guides). Every module in the registry and every app in the catalogue has an entry;
 * `null` is a screen of the shell itself (Home, Settings…) or one with no guide of its own, whose "User guide"
 * opens the list of all guides instead.
 */
export const GUIDE_KEYS: Readonly<Record<string, string | null>> = {
  // Shell screens and the guides themselves.
  home: null,
  activity: null,
  notifications: null,
  settings: null,
  account: null,
  diagnostics: null,
  help: null,
  'sinhala-tools': null,
  // Social Media Manager is not the internal Social stream; it has no guide of its own yet.
  'social-media': null,
  // Native modules.
  mail: 'mail',
  chat: 'chat',
  calls: 'chat',
  phone: 'phone',
  meet: 'meet',
  meetings: 'meetings',
  calendar: 'calendar',
  tasks: 'tasks',
  projects: 'projects',
  notes: 'notes',
  contacts: 'contacts',
  files: 'drive',
  office: 'word',
  pdf: 'pdf',
  crm: 'crm',
  marketing: 'marketing',
  sales: 'oms',
  billing: 'billing',
  tenders: 'tender',
  recruitment: 'recruitment',
  amc: 'amc',
  board: 'board',
  finance: 'finance',
  expenses: 'expenses',
  salon: 'salon',
  garage: 'garage',
  restaurant: 'restaurant',
  elearning: 'elearning',
  pms: 'pms',
  events: 'events',
  pos: 'pos',
  inventory: 'inventory',
  purchase: 'purchase',
  hr: 'hr',
  support: 'tickets',
  // Channels of Chat.
  whatsapp: 'whatsapp',
  messenger: 'chat',
  instagram: 'chat',
  // Apps that open in the browser.
  social: 'social',
  subscriptions: 'subscriptions',
  payroll: 'payroll',
  // Cheque Manager: no guide of its own yet.
  cheque: null,
  appointments: 'appointments',
  assets: 'assets',
  admin: 'admin',
  ai: 'ai',
};

/** The guide key of a desktop module or catalogue app; null when it has none (the list of guides is its guide). */
export function guideKeyFor(appId: string): string | null {
  return GUIDE_KEYS[appId] ?? null;
}

/** Whether the app opens in the browser (its guide is the web's, `/help/guides/<key>`). */
export function isBrowserApp(appId: string): boolean {
  return APP_CATALOGUE.find((a) => a.id === appId)?.surface === 'browser';
}

/** The desktop route of the guide viewer: the list, a guide, or one of its workflows. */
export function guideRoute(key?: string | null, workflow?: string | null): string {
  if (!key) return '/help';
  const q = new URLSearchParams({ guide: key });
  if (workflow) q.set('workflow', workflow);
  return `/help?${q.toString()}`;
}

/** The web path of a guide (for the browser), as the server's `url` names it — without the `#workflow`. */
export function webGuidePath(key: string): string {
  return `/help/guides/${encodeURIComponent(key)}`;
}
