import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Select } from '../../components/Select';
import type { Organization } from '@shared/types';
import { Field } from '../hr/parts';
import { scopeParams } from './logic';

/**
 * The CRM's company scope (SRS W1/W7). The company the desktop is showing —
 * the organisation switcher's choice — is the company every CRM list asks
 * for (`org_id`); "All organizations" asks for every company of mine. A new
 * record is filed under that company; with several companies and All
 * showing, its form asks which one, since the server will not guess
 * (422 `org_required`).
 */
const NONE: Organization[] = [];

export interface CrmScope {
  orgId: number | null;
  orgs: Organization[];
  /** A create form must ask which company: several companies and All showing. */
  needsOrg: boolean;
  /** "CreativeFX", or "All companies". */
  name: string;
  /** For a list: `org_id` (and `org`, which servers before it read). */
  params: { org_id?: number; org?: number };
}

export function scopeOf(organizationId: string | null, orgs: Organization[]): CrmScope {
  const orgId = organizationId && /^\d+$/.test(organizationId) ? Number(organizationId) : null;
  const name = orgId ? (orgs.find((o) => o.id === organizationId)?.name ?? 'This company') : orgs.length === 1 ? orgs[0]!.name : 'All companies';
  return { orgId, orgs, needsOrg: orgs.length > 1 && orgId === null, name, params: scopeParams(orgId) };
}

export function useCrmScope(): CrmScope {
  const orgs = useStore(app, (s) => s.bootstrap?.organizations ?? NONE);
  const current = useStore(app, (s) => s.organizationId);
  return scopeOf(current, orgs);
}

/** The `org_id` a create sends: the field's choice, else the scope's company, else nothing (one company: the server knows). */
export function orgIdFor(choice: string, scope: CrmScope): number | undefined {
  if (choice && /^\d+$/.test(choice)) return Number(choice);
  return scope.orgId ?? undefined;
}

/** "Company it belongs to" — shown only when the scope cannot say. */
export function CompanyField({ scope, value, onChange, what = 'record' }: { scope: CrmScope; value: string; onChange: (v: string) => void; what?: string }) {
  if (!scope.needsOrg) return null;
  return (
    <Field label="Company it belongs to" hint={`Which of your companies files this ${what}.`}>
      <Select label="Company it belongs to" placeholder="Choose…" value={value || null} onValueChange={onChange} options={scope.orgs.map((o) => ({ value: o.id, label: o.name }))} />
    </Field>
  );
}
