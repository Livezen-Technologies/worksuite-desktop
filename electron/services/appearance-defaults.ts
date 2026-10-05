import { normalizeHex } from '@shared/color';
import type { Tint } from '@shared/theme-profiles';
import { DesktopError } from '../main/errors';
import type { PolicyHttp } from './launcher-defaults';

/**
 * The organisation's colour profile (worksuite-desktop#234): its accent, how tinted the backgrounds are, and whether
 * everyone must use it. Four keys of the organisation's desktop policy (`appearance_accent`, `appearance_tint`,
 * `appearance_tint_color`, `appearance_locked`), so they reach every device in the bootstrap the policy already rides
 * in, set the way the launcher's defaults are (launcher-defaults.ts): `PUT /desktop/v1/admin/policies/organization:{id}`,
 * which needs `desktop.policies.manage` there and replaces the scope's whole policy — its other keys are read first
 * and kept.
 */
export interface AppearanceDefaults {
  /** Null: no organisation profile; everyone's own choice, or Blue. */
  accent: string | null;
  tint: Tint;
  tintColor: string | null;
  locked: boolean;
}

interface PolicyRow {
  scope?: string;
  scope_id?: number | string;
  policy?: Record<string, unknown>;
}

const KEYS = ['appearance_accent', 'appearance_tint', 'appearance_tint_color', 'appearance_locked'] as const;

export async function saveAppearanceDefaults(http: PolicyHttp, organizationId: string, wanted: AppearanceDefaults): Promise<AppearanceDefaults> {
  if (!/^\d{1,12}$/.test(organizationId)) throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose an organization first.');
  const accent = normalizeHex(wanted.accent);
  const tint: Tint = wanted.tint === 'accent' || wanted.tint === 'custom' ? wanted.tint : 'neutral';
  const tintColor = tint === 'custom' ? normalizeHex(wanted.tintColor) : null;
  if (tint === 'custom' && !tintColor) throw new DesktopError('IPC_VALIDATION_FAILED', 'Pick a background colour.');
  const listed = await http.get<{ policies?: PolicyRow[] }>('/desktop/v1/admin/policies');
  const row = (listed?.policies ?? []).find((p) => p.scope === 'organization' && String(p.scope_id) === organizationId);
  const policy: Record<string, unknown> = { ...(row?.policy ?? {}) };
  for (const key of KEYS) delete policy[key];
  // No accent is "no organisation profile": the keys go, rather than empty values standing for one.
  if (accent) {
    policy.appearance_accent = accent;
    policy.appearance_tint = tint;
    if (tintColor) policy.appearance_tint_color = tintColor;
    if (wanted.locked) policy.appearance_locked = true;
  }
  await http.request('PUT', `/desktop/v1/admin/policies/organization:${organizationId}`, { body: { policy } });
  return accent ? { accent, tint, tintColor, locked: wanted.locked } : { accent: null, tint: 'neutral', tintColor: null, locked: false };
}
