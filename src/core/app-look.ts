/**
 * Each app's colour, as the App Launcher and Global Search designs draw it:
 * the icon in the colour on a tile of the same colour at low strength. One
 * table so the launcher, search and "Jump to" can never disagree.
 */
const COLOURS: Record<string, string> = {
  home: '#23349E',
  activity: '#4338CA',
  mail: '#1D4ED8',
  chat: '#0F766E',
  meet: '#0369A1',
  phone: '#0F766E',
  social: '#A21CAF',
  'social-media': '#2563EB',
  whatsapp: '#15803D',
  calendar: '#B91C1C',
  meetings: '#0E7490',
  tasks: '#6D28D9',
  files: '#D97706',
  contacts: '#0D9488',
  projects: '#3730A3',
  tenders: '#B45309',
  recruitment: '#7C3AED',
  notes: '#CA8A04',
  crm: '#DC2626',
  sales: '#C2410C',
  billing: '#047857',
  finance: '#115E59',
  expenses: '#A16207',
  inventory: '#4D7C0F',
  purchase: '#0369A1',
  subscriptions: '#7C3AED',
  marketing: '#BE185D',
  hr: '#9333EA',
  payroll: '#166534',
  appointments: '#DB2777',
  support: '#0284C7',
  assets: '#475569',
  amc: '#57534E',
  pos: '#9D174D',
  admin: '#334155',
  ai: '#0E7490',
};

export function appColour(id: string): string {
  return COLOURS[id] ?? '#23349E';
}

/**
 * Search result groups, by the app they belong to. The server names groups in
 * words ("Mail", "Tasks", "People"…); anything unknown falls back to a search
 * glyph in the brand colour.
 */
const GROUPS: Record<string, { app: string; icon: string }> = {
  apps: { app: 'home', icon: 'grid' },
  mail: { app: 'mail', icon: 'mail' },
  emails: { app: 'mail', icon: 'mail' },
  chat: { app: 'chat', icon: 'chat' },
  messages: { app: 'chat', icon: 'chat' },
  files: { app: 'files', icon: 'folder' },
  documents: { app: 'files', icon: 'folder' },
  drive: { app: 'files', icon: 'folder' },
  tasks: { app: 'tasks', icon: 'tasks' },
  contacts: { app: 'contacts', icon: 'contact' },
  calendar: { app: 'calendar', icon: 'calendar' },
  events: { app: 'calendar', icon: 'calendar' },
  projects: { app: 'projects', icon: 'kanban' },
  people: { app: 'home', icon: 'user' },
  users: { app: 'home', icon: 'user' },
  employees: { app: 'hr', icon: 'id-card' },
  leads: { app: 'crm', icon: 'users' },
  crm: { app: 'crm', icon: 'users' },
  deals: { app: 'crm', icon: 'trending-up' },
  customers: { app: 'crm', icon: 'building' },
  invoices: { app: 'billing', icon: 'receipt' },
  orders: { app: 'sales', icon: 'cart' },
  tenders: { app: 'tenders', icon: 'file-text' },
  candidates: { app: 'recruitment', icon: 'user-plus' },
  notes: { app: 'notes', icon: 'notebook' },
  tickets: { app: 'support', icon: 'life-buoy' },
  assets: { app: 'assets', icon: 'box' },
  meetings: { app: 'meetings', icon: 'calendar-clock' },
  appointments: { app: 'appointments', icon: 'calendar-clock' },
  products: { app: 'inventory', icon: 'package' },
  social: { app: 'social', icon: 'megaphone' },
  'social media': { app: 'social-media', icon: 'send' },
  'social posts': { app: 'social-media', icon: 'send' },
  expenses: { app: 'expenses', icon: 'wallet' },
  subscriptions: { app: 'subscriptions', icon: 'repeat' },
  groups: { app: 'hr', icon: 'users' },
  departments: { app: 'hr', icon: 'building' },
  designations: { app: 'hr', icon: 'briefcase' },
  companies: { app: 'admin', icon: 'building' },
  applications: { app: 'admin', icon: 'grid' },
  settings: { app: 'admin', icon: 'settings' },
  'website chats': { app: 'chat', icon: 'globe' },
  'go to': { app: 'home', icon: 'grid' },
  actions: { app: 'tasks', icon: 'zap' },
  commands: { app: 'home', icon: 'zap' },
  'offline results': { app: 'home', icon: 'cloud-off' },
};

export function groupLook(group: string): { colour: string; icon: string } {
  const g = GROUPS[group.trim().toLowerCase()];
  return g ? { colour: appColour(g.app), icon: g.icon } : { colour: '#23349E', icon: 'search' };
}
