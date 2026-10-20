import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SinhalaProfilesView, SinhalaStatus } from '@shared/sinhala';
import { app } from './app-state';
import { call, hasDesktop, on } from './bridge';
import { queryClient } from './query';
import { useStore } from './store';

/**
 * Sinhala Tools as the windows see them (blueprint §6): whether they are offered, the profiles, the person's settings.
 * The work is the main process's (electron/services/sinhala.ts); these only ask, and ask again on `sinhala:changed`.
 */
export const SINHALA_KEY = ['sinhala'] as const;

let wired = false;
function wire(): void {
  if (wired || !hasDesktop()) return;
  wired = true;
  on('sinhala:changed', () => void queryClient.invalidateQueries({ queryKey: SINHALA_KEY }));
}

/** The tools' state, while signed in. */
export function useSinhalaStatus() {
  useEffect(wire, []);
  const signedIn = useStore(app, (s) => s.auth?.stage === 'ready');
  return useQuery<SinhalaStatus>({ queryKey: [...SINHALA_KEY, 'status'], queryFn: () => call('sinhala:status'), enabled: signedIn && hasDesktop(), staleTime: 10_000 });
}

/** Offered now: the app is the person's and the server said the organisation has the tools on. */
export function useSinhalaAvailable(): boolean {
  return useSinhalaStatus().data?.availability === 'ok';
}

export function useSinhalaProfiles(enabled = true) {
  useEffect(wire, []);
  return useQuery<SinhalaProfilesView>({ queryKey: [...SINHALA_KEY, 'profiles'], queryFn: () => call('sinhala:profiles', null), enabled: enabled && hasDesktop(), staleTime: 60_000 });
}
