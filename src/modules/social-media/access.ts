import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import type { Account, AccessLevel } from './api';

/**
 * Who may do what in Social Media Manager (WS-SMM-SRS-001 §7, §14): the `social.*` permission family, then the
 * per-account level (Use ⊂ Publish ⊂ Manage, SMM-ACC-011) on top of it — `social.post.publish` only works on accounts
 * where the person holds Publish.
 *
 * The server refuses anyway (AppGate on every route, SMM-ADM-007); this only keeps actions someone cannot take out of
 * their way: a Contributor's composer offers Save draft and Send for approval, never Schedule (WF-03, AC-05). `*` is a
 * super-admin. When the module status names the caller's permissions, those win over the bootstrap's.
 */
export const SOCIAL_PERMISSIONS = [
  'social.view',
  'social.post.create',
  'social.post.edit_any',
  'social.post.publish',
  'social.post.approve',
  'social.post.delete',
  'social.account.connect',
  'social.account.manage',
  'social.inbox.view',
  'social.inbox.reply',
  'social.inbox.assign',
  'social.inbox.convert',
  'social.analytics.view',
  'social.analytics.export',
  'social.library.manage',
  'social.campaign.manage',
  'social.listening.manage',
  'social.settings.manage',
  'social.audit.view',
] as const;

export type SocialPermission = (typeof SOCIAL_PERMISSIONS)[number];

export interface SocialAccess {
  view: boolean;
  create: boolean;
  editAny: boolean;
  publish: boolean;
  approve: boolean;
  deletePosts: boolean;
  connect: boolean;
  manageAccounts: boolean;
  inbox: boolean;
  reply: boolean;
  assign: boolean;
  convert: boolean;
  analytics: boolean;
  exportAnalytics: boolean;
  library: boolean;
  campaigns: boolean;
  settings: boolean;
  audit: boolean;
  /** CRM's own permission, for "Create CRM lead" (WF-11: the action is hidden without it). */
  crm: boolean;
  /** Support's, for "Create ticket". */
  tickets: boolean;
}

export function can(perms: readonly string[] | null | undefined, p: string): boolean {
  return !!perms && (perms.includes('*') || perms.includes(p));
}

export function socialAccess(perms: readonly string[] | null | undefined): SocialAccess {
  const settings = can(perms, 'social.settings.manage');
  const has = (p: SocialPermission) => settings || can(perms, p);
  return {
    view: has('social.view'),
    create: has('social.post.create'),
    editAny: has('social.post.edit_any'),
    publish: has('social.post.publish'),
    approve: has('social.post.approve'),
    deletePosts: has('social.post.delete'),
    connect: has('social.account.connect'),
    manageAccounts: has('social.account.manage'),
    inbox: has('social.inbox.view'),
    reply: has('social.inbox.reply'),
    assign: has('social.inbox.assign'),
    convert: has('social.inbox.convert'),
    analytics: has('social.analytics.view'),
    exportAnalytics: has('social.analytics.export'),
    library: has('social.library.manage'),
    campaigns: has('social.campaign.manage'),
    settings,
    audit: has('social.audit.view'),
    crm: can(perms, 'crm.view') || can(perms, 'crm.create') || can(perms, 'lead.create'),
    tickets: can(perms, 'support.view') || can(perms, 'tickets.create') || can(perms, 'support.create'),
  };
}

export function useSocialAccess(serverPerms?: readonly string[] | null): SocialAccess {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return socialAccess(serverPerms && serverPerms.length ? serverPerms : perms);
}

const RANK: Record<AccessLevel, number> = { use: 1, publish: 2, manage: 3 };

/**
 * The person's level on an account reaches `need`. A Social Admin (social.settings.manage) manages every account
 * (§7); anyone else has what the server says, and nothing when it says nothing.
 */
export function hasLevel(account: Pick<Account, 'my_level'>, need: AccessLevel, access?: Pick<SocialAccess, 'settings'>): boolean {
  if (access?.settings) return true;
  const mine = account.my_level ?? null;
  return !!mine && RANK[mine] >= RANK[need];
}

/** May schedule on every one of these accounts without approval (policy permitting): Publish on each, and the permission. */
export function canPublishOn(access: SocialAccess, accounts: Array<Pick<Account, 'my_level'>>): boolean {
  return access.publish && accounts.length > 0 && accounts.every((a) => hasLevel(a, 'publish', access));
}

/** Accounts the composer offers (SMM-ACC-011): where the person holds Use or more, and not disconnected. */
export function usableAccounts<T extends Pick<Account, 'my_level' | 'status'>>(accounts: T[], access?: Pick<SocialAccess, 'settings'>): T[] {
  return accounts.filter((a) => a.status !== 'disconnected' && hasLevel(a, 'use', access));
}
