import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import type { AvatarStyle } from './avatarArt';

/**
 * My account's server side — the same endpoints the web's Profile settings,
 * Security and My access pages use, so the two can never disagree. Stamps
 * ending `_at` are UTC ("2026-09-26 08:31:00"): read them with `parseTs`.
 */

export type Section = 'profile' | 'general' | 'preferences' | 'notifications' | 'security' | 'pictures' | 'access';
export const SECTIONS: readonly Section[] = ['profile', 'general', 'preferences', 'notifications', 'security', 'pictures', 'access'];

export interface MyProfile {
  id: number;
  name: string;
  phone: string | null;
  email: string;
  avatar: string | null;
  timezone: string | null;
  department: string | null;
  designation: string | null;
  company: string | null;
  editable?: string[];
}

export type VisibilityMode = 'organization' | 'teams' | 'organizations';

export interface Picture {
  id: number;
  type: 'upload' | 'generated_avatar';
  current: boolean;
  pending?: boolean;
  created_at: string | null;
  url: string;
  large: string;
  thumb: string;
  style: Partial<AvatarStyle> | null;
}

export interface Pictures {
  items: Picture[];
  limits: { max_bytes: number; extensions: string[]; types?: string[]; min_side: number };
  /** `required`: a picture is needed before the workspace opens (#46); absent from older servers. */
  policy?: { moderation: boolean; default_look: 'initials' | 'abstract' | 'illustrated'; required?: boolean };
  can?: { upload: boolean; avatar: boolean; edit: boolean; delete: boolean; skip_review: boolean };
  visibility?: { mode: VisibilityMode; orgs: number[]; companies: Array<{ id: number; name: string }>; teams: Array<{ id: number; name: string }> };
}

export interface Mfa {
  enabled: boolean;
  enrolled_at: string | null;
  last_used_at: string | null;
  backup_codes: number;
  webauthn?: boolean;
  passkeys: number;
}

export interface Passkey {
  id: number;
  device_name: string | null;
  transports: string[] | string | null;
  backup_eligible: boolean | number;
  backup_state: boolean | number;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  active: boolean;
}

export interface PasskeyPolicy {
  enabled: boolean;
  requirement: string;
  max_per_user: number;
  required_for_you: boolean;
}

export interface SessionRow {
  id: number;
  ip: string | null;
  user_agent: string;
  browser: string;
  platform: string;
  created_at: string;
  expires_at: string;
}

export interface SignIn {
  id: number;
  event: 'login' | 'failed';
  method: 'password' | 'mfa' | 'passkey' | null;
  ip: string | null;
  user_agent: string;
  browser: string;
  platform: string;
  created_at: string;
}

/** A computer or browser this account has verified (worksuite-desktop#301): it is not asked to verify again until it expires. */
export interface TrustedDevice {
  id: number;
  label: string;
  platform: string;
  browser: string;
  last_ip: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  /** This computer. */
  current?: boolean;
}

export interface SignIns {
  items: SignIn[];
  failed_7d: number;
  password_set_at: string | null;
}

export interface PasswordPolicy {
  min_length: number;
  require_upper: number | boolean;
  require_lower: number | boolean;
  require_number: number | boolean;
  require_symbol: number | boolean;
  history_count: number;
  expires_days: number;
  mfa_required?: number | boolean;
}

export const K = {
  profile: ['account', 'profile'] as const,
  pictures: ['account', 'pictures'] as const,
  mfa: ['account', 'mfa'] as const,
  passkeys: ['account', 'passkeys'] as const,
  sessions: ['account', 'sessions'] as const,
  signIns: ['account', 'sign-ins'] as const,
  devices: ['account', 'trusted-devices'] as const,
  policy: ['account', 'password-policy'] as const,
  regional: ['account', 'regional'] as const,
  notifications: ['account', 'notifications'] as const,
  chatAlerts: ['account', 'chat-alerts'] as const,
  chatPrivacy: ['account', 'chat-privacy'] as const,
  presence: ['account', 'presence'] as const,
  access: ['account', 'access'] as const,
};

export function useProfile() {
  return useQuery({ queryKey: K.profile, queryFn: ({ signal }) => apiGet<MyProfile>('/api/users/me/profile', undefined, signal) });
}

export function usePictures() {
  return useQuery({ queryKey: K.pictures, queryFn: ({ signal }) => apiGet<Pictures>('/api/users/me/pictures', undefined, signal) });
}

/** What they may do with pictures; an older server's answer without `can` allowed everything. */
export function abilities(p: Pictures | undefined): NonNullable<Pictures['can']> {
  return p?.can ?? { upload: true, avatar: true, edit: true, delete: true, skip_review: false };
}

export function useMfa() {
  return useQuery({ queryKey: K.mfa, queryFn: ({ signal }) => apiGet<Mfa>('/api/auth/mfa', undefined, signal) });
}

export function usePasskeys() {
  return useQuery({ queryKey: K.passkeys, queryFn: ({ signal }) => apiGet<{ passkeys: Passkey[]; policy: PasskeyPolicy }>('/api/auth/passkeys', undefined, signal) });
}

/**
 * The account's sessions, and which is this app's. The id is asked for after
 * the list: fetching it may have refreshed this app's session, which gives it
 * a new id, and the list then already carries it.
 */
export function useSessions() {
  return useQuery({
    queryKey: K.sessions,
    queryFn: async ({ signal }) => {
      const rows = await apiGet<SessionRow[]>('/api/auth/sessions', undefined, signal);
      const { sid } = await call('auth:sessionId');
      return { rows: Array.isArray(rows) ? rows : [], sid };
    },
    // Where you are signed in changes from elsewhere: read it afresh each time it is shown.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Recent sign-ins. A server without the endpoint (before 2026-09-26) answers 404: null, and the list is not shown. */
export function useSignIns() {
  return useQuery({
    queryKey: K.signIns,
    queryFn: async ({ signal }) => {
      try {
        return await apiGet<SignIns>('/api/auth/sign-ins', undefined, signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Remembered devices. A server without them (before sign-in protection) answers 404: null, and the card is not shown. */
export function useTrustedDevices() {
  return useQuery({
    queryKey: K.devices,
    queryFn: async ({ signal }) => {
      try {
        const rows = await apiGet<TrustedDevice[]>('/api/auth/devices', undefined, signal);
        return Array.isArray(rows) ? rows : [];
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function usePasswordPolicy() {
  return useQuery({ queryKey: K.policy, queryFn: ({ signal }) => apiGet<PasswordPolicy>('/api/auth/password-policy', undefined, signal), staleTime: 5 * 60_000 });
}

/** Refresh the session's copy of me — the title bar, the menu, dates everywhere — after a change to my profile. */
export function useRefreshMe() {
  const qc = useQueryClient();
  return async (keys: ReadonlyArray<readonly string[]> = []) => {
    await Promise.all([...keys.map((k) => qc.invalidateQueries({ queryKey: k })), call('session:refresh').catch(() => undefined)]);
  };
}

export function useHasApp(id: string): boolean {
  return useStore(app, (s) => s.apps.some((a) => a.id === id));
}

/** "WorkSuite Desktop · macOS", "Chrome on Windows": a session or sign-in, as its owner would recognise it. */
export function clientLabel(r: { user_agent: string; browser: string; platform: string }): { label: string; kind: 'desktop' | 'mobile' | 'browser' | 'other' } {
  const ua = r.user_agent ?? '';
  const platform = r.platform && r.platform !== 'Unknown' ? r.platform : null;
  if (/WorkSuite\/[\d.]+/.test(ua) && /Electron\//.test(ua)) return { label: `WorkSuite Desktop${platform ? ` · ${platform}` : ''}`, kind: 'desktop' };
  if (/WorkSuite(Mobile)?\//i.test(ua) || platform === 'iPhone' || platform === 'Android' || platform === 'iPad') {
    return { label: /WorkSuite/i.test(ua) ? `WorkSuite Mobile${platform ? ` · ${platform}` : ''}` : `${r.browser} on ${platform}`, kind: 'mobile' };
  }
  if (r.browser && r.browser !== 'Other' && r.browser !== 'Unknown') return { label: platform ? `${r.browser} on ${platform}` : r.browser, kind: 'browser' };
  return { label: platform ? `A program on ${platform}` : 'An unrecognised program', kind: 'other' };
}
