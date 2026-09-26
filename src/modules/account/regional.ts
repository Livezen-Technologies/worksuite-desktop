import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { K, useRefreshMe } from './api';

/**
 * Time zone, language, date and time format and first day of week — mine, or
 * my company's (`/api/me/regional`, as the web's Regional panel). Saving
 * re-reads the session, so every date on screen changes at once; stored
 * times are UTC and never move. When the company decides for everyone the
 * server refuses (403) and `may_override` is false: shown, not editable.
 */
export type Source = 'user' | 'organization' | 'detected' | 'system' | 'default';

export interface Regional {
  effective: {
    timezone: string;
    timezone_source: Source;
    timezone_detected: string | null;
    locale: string;
    locale_source: Source;
    date_format: string | null;
    time_format: '12h' | '24h';
    week_start: number;
    may_override: boolean;
    offset: string;
    label: string;
  };
  mine: { timezone: string | null; timezone_auto: boolean; detected: string | null; locale: string | null; date_format: string | null; time_format: string | null; week_start: number | null };
  organization: { name: string; timezone: string | null; locale: string | null; date_format: string | null; time_format: string | null; week_start: number | null; may_override: boolean } | null;
  system: { timezone: string };
  options: {
    locales: Array<{ value: string; label: string }>;
    date_formats: Array<{ value: string; example: string }>;
    time_formats: Array<{ value: string; example: string }>;
    week_starts: Array<{ value: number; label: string }>;
  };
}

export interface Zone {
  value: string;
  label: string;
  offset: string;
  group: string;
}

export const FROM: Record<Source, string> = {
  user: 'your own choice',
  organization: 'your company',
  detected: 'detected from this computer',
  system: 'the installation default',
  default: 'the product default',
};

export function useRegional() {
  return useQuery({ queryKey: K.regional, queryFn: ({ signal }) => apiGet<Regional>('/api/me/regional', undefined, signal) });
}

export function useZones() {
  return useQuery({ queryKey: ['account', 'zones'], queryFn: ({ signal }) => apiGet<{ zones: Zone[]; system: string }>('/api/timezones', undefined, signal), staleTime: Infinity });
}

/** This computer's zone, which "detect automatically" reports. */
export function computerZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function useSaveRegional() {
  const qc = useQueryClient();
  const refresh = useRefreshMe();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await apiPut<Regional>('/api/me/regional', patch);
      if (r && typeof r === 'object' && 'effective' in r) qc.setQueryData(K.regional, r);
      else await qc.invalidateQueries({ queryKey: K.regional });
      await refresh([K.profile]);
      toast('success', 'Saved.');
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}
