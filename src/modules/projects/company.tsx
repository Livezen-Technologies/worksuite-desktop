import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet } from '../../core/api';
import { recallOrgChoice, rememberOrgChoice } from '../../core/org-prefs';
import { createStore, useStore } from '../../core/store';

/**
 * Which company the Projects screens are working in (G-01, PRJ-REG-04, NFR-05) — the web's `company.tsx` and
 * `withOrg` (web/src/pages/project/company.tsx, api.ts), for the desktop.
 *
 * Single-pick: the company is the subject of every total on these screens, so the server reports one company at a
 * time and this picks which. With nothing picked the server uses the caller's own (`current` from
 * GET /api/projects/companies), and the first answer stores that one so every request names the same company. The
 * choice is remembered like every module's (`core/org-prefs`, under `projects`).
 *
 * A portfolio-level read carries the company as `org` — in the request AND in its query key — so a warm cache never
 * answers with the previous company's rows; a read about one project (`project_id`) carries none.
 *
 * (The minimal shared module: the Portfolio branch owns the full one with the same exports.)
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

const MODULE = 'projects';

function recalled(): number | null {
  try {
    const id = recallOrgChoice(MODULE);
    return id && /^\d+$/.test(id) ? Number(id) : null;
  } catch {
    return null;
  }
}

const chosen = createStore<{ id: number | null }>({ id: recalled() });

/** The chosen company as `org`'s value, '' when nothing is chosen (the server then uses the caller's own). */
export const orgParam = (): string => (chosen.get().id ? String(chosen.get().id) : '');

type Params = Record<string, string | number | boolean | null | undefined>;

/** A portfolio-level request's params with the chosen company added; one project's request is left alone, and an `org` the caller names wins. */
export function withOrg<P extends Params>(p: P = {} as P): P & { org?: string } {
  return p.project_id ? p : { org: orgParam() || undefined, ...p };
}

export const companiesKey = ['projects', 'companies'] as const;

export interface ProjectCompany {
  /** Every company the caller may act for. Empty on an installation without companies. */
  companies: Company[];
  /** The company the screens are showing: the one picked, else the caller's own. */
  current: Company | null;
  /** Pick a company (remembered). */
  choose: (id: number) => void;
  loading: boolean;
}

function choose(id: number): void {
  chosen.set({ id });
  try {
    rememberOrgChoice(MODULE, String(id));
  } catch {
    /* a preference, not the data */
  }
}

export function useProjectCompany(): ProjectCompany {
  const picked = useStore(chosen, (s) => s.id);
  const q = useQuery({ queryKey: companiesKey, queryFn: ({ signal }) => apiGet<CompanyList>('/api/projects/companies', undefined, signal), staleTime: 300_000, retry: false });
  const companies = q.data?.items ?? [];
  const fallback = q.data?.current ?? null;
  const known = companies.some((c) => c.id === picked);
  // Store the company the screens are showing, so every request names the same one; a stored company that has left
  // the list (access removed) is replaced the same way.
  useEffect(() => {
    if (fallback !== null && companies.length > 0 && (picked === null || !known)) choose(fallback);
  }, [fallback, picked, known, companies.length]);
  const id = picked ?? fallback;
  return { companies, current: companies.find((c) => c.id === id) ?? null, choose, loading: q.isLoading };
}
