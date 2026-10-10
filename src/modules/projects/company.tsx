import { useQuery } from '@tanstack/react-query';
import { apiGetMeta, type Query } from '../../core/api';
import { orgPrefs, recallOrgChoice, rememberOrgChoice } from '../../core/org-prefs';
import { useStore } from '../../core/store';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { cx } from '../../components/ui';

/**
 * Which company the Projects screens are working in (G-01, PRJ-REG-04, NFR-05) — the desktop twin of the web's
 * `pages/project/company.tsx` and `withOrg` (api.ts), shared by every Projects screen of this app.
 *
 * SINGLE-PICK: the company is the subject of every total on these screens, so the server reports one company at a
 * time and this picks which. With nothing picked the server uses the caller's own company — `current` from
 * `GET /api/projects/companies` — and the control says which that is rather than showing a blank.
 *
 * THE APP'S OWN SELECTION, NOT A NEW ONE: the choice is kept in the organisation filter's memory
 * (`core/org-prefs`, worksuite-desktop#214) under the app id `projects`, so it persists, follows the person's
 * "one selection for every app" setting and syncs between their devices like every other app's. A remembered
 * company the caller may no longer act for is never used: the caller's own stands in for it.
 *
 * The server is the boundary; this only chooses inside it. A company somebody may not act for is never offered, and
 * if they name one anyway the server answers with nothing, not with everything.
 *
 * COMPANY IN REQUESTS (the web's rule): every portfolio-level read carries the company as `org` — in the request AND
 * in its query key (`useOrgParam()`), so a warm cache never answers with the previous company's rows. A read about ONE
 * project (`project_id`, or a by-id path) carries none: it is that project's company's, and a link from Mail must open
 * it whatever the selector says.
 */

/** A company the caller may act for. `currency` is its reporting currency: what its totals are in. */
export interface Company {
  id: number;
  name: string;
  currency: string;
  role?: string | null;
}

/** GET /api/projects/companies — the list, and the company used when nothing is chosen. */
export interface CompanyList {
  items: Company[];
  current: number | null;
}

export interface ProjectCompany {
  /** Every company the caller may act for. Empty on an installation without companies. */
  companies: Company[];
  /** The company the screens are showing: the one picked, else the caller's own. */
  current: Company | null;
  /** Pick a company (remembered like every app's organisation choice). */
  choose: (id: number) => void;
  loading: boolean;
}

/** The organisation filter's app id for Projects (`core/org-prefs`). */
export const COMPANY_SCOPE = 'projects';

export const companiesKey = ['projects', 'companies'] as const;

/** The last list the server gave, read synchronously by `orgParam()` when a request is built. */
let known: CompanyList | null = null;

export async function readCompanies(signal?: AbortSignal): Promise<CompanyList> {
  const r = await apiGetMeta<Partial<CompanyList> | null>('/api/projects/companies', undefined, signal);
  const list: CompanyList = { items: Array.isArray(r.data?.items) ? r.data.items : [], current: typeof r.data?.current === 'number' ? r.data.current : null };
  known = list;
  return list;
}

/** Which company a remembered choice resolves to, given the list (or the choice itself before the list is known). */
function resolve(list: CompanyList | null, picked: string): string {
  if (!list || !list.items.length) return picked;
  if (picked && list.items.some((c) => String(c.id) === picked)) return picked;
  return list.current !== null ? String(list.current) : '';
}

/** The chosen company as `org`'s value, '' when nothing is chosen (the server then uses the caller's own). */
export function orgParam(): string {
  return resolve(known, recallOrgChoice(COMPANY_SCOPE) ?? '');
}

/**
 * A portfolio-level request's params with the chosen company added; one project's request is left alone, and an `org`
 * the caller names (the New project dialog's own Company field) wins over the selector's.
 */
export function withOrg(p: Query = {}): Query {
  return p.project_id ? p : { org: orgParam() || undefined, ...p };
}

/** `orgParam()`, re-read when the choice or the list changes — for query keys. */
export function useOrgParam(): string {
  useStore(orgPrefs, (s) => s.stored);
  const q = useQuery({ queryKey: companiesKey, queryFn: ({ signal }) => readCompanies(signal), staleTime: 300_000, retry: false });
  return resolve(q.data ?? known, recallOrgChoice(COMPANY_SCOPE) ?? '');
}

export function useProjectCompany(): ProjectCompany {
  useStore(orgPrefs, (s) => s.stored);
  const q = useQuery({ queryKey: companiesKey, queryFn: ({ signal }) => readCompanies(signal), staleTime: 300_000, retry: false });
  const list = q.data ?? null;
  const companies = list?.items ?? [];
  const id = resolve(list, recallOrgChoice(COMPANY_SCOPE) ?? '');
  return {
    companies,
    // Resolved from the list rather than held, so a company that has left it (access removed) stops being current.
    current: companies.find((c) => String(c.id) === id) ?? null,
    choose: (next: number) => rememberOrgChoice(COMPANY_SCOPE, String(next)),
    loading: q.isLoading,
  };
}

/**
 * "Company: TechHubiz ▾" — the W01/W02 header control, drawn with the app's organisation filter. One company is its
 * name alone (a control with one choice cannot be operated); none (an installation without companies) is nothing.
 */
export function CompanySelect({ className }: { className?: string }) {
  const { companies, current, choose } = useProjectCompany();
  if (!companies.length) return null;
  if (companies.length === 1) {
    return (
      <span className={cx('inline-flex h-7 items-center gap-1 rounded-[8px] border border-line bg-ground px-2.5 text-[12px] text-ink-3', className)}>
        Company: <b className="font-semibold text-ink">{companies[0]!.name}</b>
      </span>
    );
  }
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] text-ink-3', className)}>
      <span aria-hidden="true">Company:</span>
      <OrgSwitcher
        label="Company"
        allowAll={false}
        placeholder="Choose…"
        orgs={companies.map((c) => ({ id: String(c.id), name: c.name, hint: c.currency }))}
        value={current ? [String(current.id)] : []}
        onChange={(ids) => {
          if (ids[0]) choose(Number(ids[0]));
        }}
      />
    </span>
  );
}

/**
 * Whose money a total is: "TechHubiz · LKR", with the rate date when anything was converted. Every KPI and report
 * total names its company and reporting currency (SRS §18).
 */
export function MoneyBasis({ company, currency, rateDate }: { company: Company | null | undefined; currency: string; rateDate?: string | null }) {
  return (
    <span className="text-[12px] text-ink-3">
      {company ? <>{company.name} · </> : null}
      <span className="font-mono">{currency}</span>
      {rateDate ? (
        <>
          {' '}
          · rates of <span className="font-mono">{rateDate}</span>
        </>
      ) : null}
    </span>
  );
}
