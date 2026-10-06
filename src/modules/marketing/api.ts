import { useQuery } from '@tanstack/react-query';
import { apiGet, request } from '../../core/api';
import { queryClient } from '../../core/query';
import type { Options, Pulse } from './types';

/**
 * Marketing's server side: the reader's companies and what they may do in
 * each, the rail's counts, and one way to send a change and hear what the
 * server said about it.
 *
 * Every rule — who is a duplicate, who may be emailed or called, what a
 * campaign may send — is the server's. These screens show what they were sent
 * and send back what was typed, exactly as the web client does; nothing here
 * decides who may be marketed to.
 */

/** The chosen companies as the server reads them: `org=7,9`, or nothing for every company the reader reaches. */
export function withOrg(org: string, rest: Record<string, string | number | boolean | null | undefined> = {}): Record<string, string | number | boolean> {
  const q: Record<string, string | number | boolean> = {};

  if (org) q.org = org;
  for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined && v !== '') q[k] = v;

  return q;
}

/** Every company the reader reaches, or the chosen ones, with what they may do in each and Marketing's vocabulary. */
export function useOptions(org: string) {
  return useQuery({
    queryKey: ['marketing', 'options', org],
    queryFn: ({ signal }) => apiGet<Options>('/api/marketing/options', withOrg(org), signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** The rail's counts: cheap, and absent from a server a part behind — then the rail simply has none. */
export function usePulse(org: string, enabled = true) {
  return useQuery({
    queryKey: ['marketing', 'pulse', org],
    queryFn: ({ signal }) => apiGet<Pulse>('/api/marketing/pulse', withOrg(org), signal),
    retry: false,
    refetchInterval: 60_000,
    enabled,
  });
}

export type Can = keyof Options['companies'][number]['can'];

/** Whether the reader may do this in any of the chosen companies. */
export function mayAny(options: Options | undefined, k: Can): boolean {
  return (options?.companies ?? []).some((c) => Boolean(c.can[k]));
}

/**
 * A change, and the server's sentence about it: "Saved", "3 handed to CRM",
 * "Paused". The sentence is what the toast says, so a person reads the server's
 * account of what happened rather than the screen's guess.
 */
export async function send<T = unknown>(method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, body?: unknown): Promise<{ data: T; message: string | null }> {
  const r = await request<T>(method, path, { body });

  return { data: r.data, message: r.message ?? null };
}

/** Everything a change to a contact, a list or a campaign can move: every Marketing query but the vocabulary. */
export function refreshMarketing(): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'marketing' && q.queryKey[1] !== 'options' });
}
