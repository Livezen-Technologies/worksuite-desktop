import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { recallOrgChoice, rememberOrgChoice, useOrgPrefs } from '../../core/org-prefs';
import { apiGet } from '../../core/api';

/**
 * Which company the Projects screens are working in (G-01, PRJ-REG-04, NFR-05) — the web's `company.tsx`.
 *
 * MINIMAL STAND-IN (DELIVERY branch): the PORTFOLIO branch owns this file and its "Company: X ▾" control; the
 * integrator keeps theirs. Same path, same exports: `useProjectCompany()` and `withOrg(params)`.
 *
 * One company at a time: every portfolio-level total is that company's, in its reporting currency. The choice is
 * the app's remembered organisation choice for `projects` (core/org-prefs), so it persists like every app's. With
 * nothing chosen the server uses the caller's own company (`current` of GET /projects/companies), and that one is
 * stored once so every request names the same company.
 */

export interface Company {
  id: number;
  name: string;
  currency: string;
  role?: string | null;
}

export interface CompanyList {
  items: Company[];
  current: number | null;
}

export interface ProjectCompany {
  /** Every company the caller may act for. Empty on an installation without companies. */
  companies: Company[];
  /** The company the screens are showing: the one picked, else the caller's own. */
  current: Company | null;
  /** Pick a company (remembered, like every app's choice). */
  choose: (id: number) => void;
  loading: boolean;
}

const SCOPE = 'projects';

/** The chosen company as `org`'s value, '' when nothing is chosen (the server then uses the caller's own). */
export function orgParam(): string {
  return recallOrgChoice(SCOPE) ?? '';
}

type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * A portfolio-level request's params with the chosen company added; one project's request (`project_id`) is left
 * alone, and an `org` the caller names wins.
 */
export function withOrg<P extends Params>(p: P = {} as P): P & { org?: string } {
  return p.project_id ? p : { org: orgParam() || undefined, ...p };
}

export function useProjectCompany(): ProjectCompany {
  useOrgPrefs();
  const q = useQuery({ queryKey: ['projects', 'companies'], queryFn: () => apiGet<CompanyList>('/api/projects/companies'), staleTime: 300_000, retry: false });
  const companies = q.data?.items ?? [];
  const fallback = q.data?.current ?? null;
  const picked = Number(orgParam()) || null;
  const known = companies.some((c) => c.id === picked);
  useEffect(() => {
    if (fallback !== null && companies.length > 0 && (picked === null || !known)) rememberOrgChoice(SCOPE, String(fallback));
  }, [fallback, picked, known, companies.length]);
  const id = known ? picked : fallback;
  return {
    companies,
    current: companies.find((c) => c.id === id) ?? null,
    choose: (next: number) => rememberOrgChoice(SCOPE, String(next)),
    loading: q.isLoading,
  };
}
