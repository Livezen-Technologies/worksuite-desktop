import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, Switch, cx } from '../../components/ui';
import { problemsOf, refusal } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice } from '../../components/RecordKit';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Panel, Seg, Sheet } from '../../components/PageKit';
import { minWidth, Pill } from '../../components/ListKit';
import { can, canAct } from './api';
import type { ScreenProps } from './Rail';
import {
  archivePolicy,
  archiveRule,
  CAPS,
  fetchCategories,
  fetchCentres,
  fetchPeople,
  fetchPolicies,
  fetchRouting,
  idOf,
  KR,
  pickList,
  POLICY_SCOPES,
  POLICY_SORTS,
  policyBody,
  policyDraft,
  policyLimits,
  policyProblems,
  policyScope,
  previewRule,
  readRefusal,
  ROLES,
  ruleBody,
  ruleDraft,
  ruleLine,
  ruleProblems,
  savePolicy,
  saveRule,
  SCOPE_WORDS,
  shownPolicies,
  stepWords,
  type ApprovalRule,
  type Choice,
  type Policy,
  type PolicyDraft,
  type PolicyScope,
  type PolicyShow,
  type PolicySort,
  type Preview,
  type RuleDraft,
  type RuleStep,
  type Stalled,
} from './rules';

/**
 * Policies and approval routing, side by side, because they are the two
 * things that decide what happens to a claim.
 *
 * A POLICY IS ARITHMETIC. Every rule is a number an administrator typed
 * compared against a number a claimant typed, and every refusal it produces
 * names the rule and both figures. A `hard` policy refuses; a `warn` one lets
 * the claim through, flagged, and shows the approver what fired. A missing
 * receipt refuses either way.
 *
 * THE ROUTING PREVIEW IS THE FEATURE NOBODY ASKS FOR AND EVERYBODY NEEDS. A
 * rule that resolves to nobody is invisible until the first claim sits
 * unapproved for a week. The preview runs the resolvers against a real person
 * and says, per step, who it would land on and what would go wrong — without
 * creating anything.
 *
 * Reading is for everybody in the company: a control nobody can look up is a
 * control people work around. Writing is `expense.admin` and the company's
 * administrator role, which the server checks and names when it refuses.
 */
export default function Policies({ orgId, orgs, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [tab, setTab] = useState<'policies' | 'routing'>('policies');
  if (orgId === null) return null;
  const org = orgs.find((o) => o.id === orgId);
  const mayAdmin = can(perms, 'expense.admin') && !!org && canAct(org);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Policies and approval" sub="The rules that refuse a claim, and the chain of people who have to say yes.">
        <Seg
          label="Policies or routing"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'policies', label: 'Spending policies' },
            { id: 'routing', label: 'Approval routing' },
          ]}
        />
      </PageHead>
      {tab === 'policies' ? <PolicyList orgId={orgId} mayAdmin={mayAdmin} /> : <Routing orgId={orgId} mayAdmin={mayAdmin} onClaim={(id) => onGo('organization', `&claim=${id}`)} />}
    </div>
  );
}

function Said({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <Notice tone="red">
      {lines.length === 1 ? (
        lines[0]
      ) : (
        <ul className="m-0 pl-4">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

// ── spending policies ────────────────────────────────────────────────────

const PW = { scope: 190, limits: 300, effect: 84, order: 56, status: 86, act: 128 };

const NAMED = ['branch', 'department', 'user'];

/**
 * Filtered and sorted here: the server returns every policy for the company,
 * in PRIORITY order — the order they are evaluated in — so that is the
 * default, and reversing it is offered rather than replacing it.
 *
 * ARCHIVED POLICIES ARE REACHABLE. A claim refused last quarter still names
 * the policy that refused it, so "which rule was that" needs an answer here.
 * They are a filter, hidden by default.
 *
 * NO BULK. Archiving is the only repeatable act and nothing takes an array of
 * policy ids — and a policy archived by mistake stops refusing claims
 * silently, which is the failure nobody notices until a quarter's spend has
 * gone through.
 */
function PolicyList({ orgId, mayAdmin }: { orgId: number; mayAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KR.policies(orgId), queryFn: ({ signal }) => fetchPolicies(orgId, signal), retry: false });
  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const mayEdit = mayAdmin && !!q.data?.can_edit;
  // Names for the ids the policies store, where they can be had: the roster is an approver's read.
  const cats = useQuery({ queryKey: KR.categories(orgId), queryFn: ({ signal }) => fetchCategories(orgId, signal), enabled: all.some((p) => p.category_id !== null), retry: false, staleTime: 60_000 });
  const centres = useQuery({ queryKey: KR.centres(orgId), queryFn: ({ signal }) => fetchCentres(orgId, signal), enabled: all.some((p) => p.scope === 'cost_centre'), retry: false, staleTime: 60_000 });
  const people = useQuery({ queryKey: KR.people(orgId), queryFn: ({ signal }) => fetchPeople(orgId, signal), enabled: mayEdit && all.some((p) => NAMED.includes(p.scope)), retry: false, staleTime: 60_000 });
  const [find, setFind] = useState('');
  const [show, setShow] = useState<PolicyShow>('active');
  const [effect, setEffect] = useState<'' | 'hard' | 'warn'>('');
  const [sort, setSort] = useState<PolicySort>('priority');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<Policy | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => shownPolicies(all, { q: find, show, effect, sort, dir }), [all, find, show, effect, sort, dir]);

  if (q.isLoading) return <Spinner />;
  const refused = readRefusal(q.error);
  if (refused) return <Notice tone="grey">{refused}</Notice>;
  if (q.error || !q.data) return <LoadFailed what="The spending policies" onRetry={() => void q.refetch()} />;

  const cur = q.data.currency;
  const lists = { centres: centres.data, people: people.data };
  const catName = (id: number) => cats.data?.find((c) => c.id === id)?.name;
  const refresh = () => void qc.invalidateQueries({ queryKey: KR.policies(orgId) });
  const fixed = [PW.scope, PW.limits, PW.effect, PW.order, PW.status, ...(mayEdit ? [PW.act] : [])];

  const archive = async (p: Policy) => {
    setBusy(true);
    try {
      const m = await archivePolicy(orgId, p.id);
      toast('success', m ?? 'Policy archived. It stops applying now, and claims it already refused still name it.');
      setArchiving(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search name or description" aria-label="Search name or description" className={cx(input, 'w-[230px] pl-8')} />
        </div>
        <Select<PolicyShow>
          aria-label="Show"
          value={show}
          onValueChange={setShow}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: '', label: 'Both' },
          ]}
          className={cx('w-[120px]', show !== 'active' && 'bg-selection')}
        />
        <Select<'' | 'hard' | 'warn'>
          aria-label="Filter by effect"
          value={effect}
          onValueChange={setEffect}
          options={[
            { value: '', label: 'Any effect' },
            { value: 'hard', label: 'Refuses' },
            { value: 'warn', label: 'Flags' },
          ]}
          className={cx('w-[130px]', effect && 'bg-selection')}
        />
        <Select<PolicySort> aria-label="Sort by" value={sort} onValueChange={setSort} options={POLICY_SORTS.map(([v, l]) => ({ value: v, label: `Sort: ${l}` }))} className="w-[160px]" />
        <button type="button" className={btn} aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'} title={dir === 'asc' ? 'Ascending' : 'Descending'} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
          <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />
        </button>
        <span className="flex-1" />
        {mayEdit ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> New policy
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
        <div style={{ minWidth: minWidth(220, fixed) }}>
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Policy</span>
            <span className="shrink-0" style={{ width: PW.scope }}>
              Applies to
            </span>
            <span className="shrink-0" style={{ width: PW.limits }}>
              Limits
            </span>
            <span className="shrink-0" style={{ width: PW.effect }}>
              Effect
            </span>
            <span className="shrink-0 text-right" style={{ width: PW.order }} title="The order policies are evaluated in. Lower runs first.">
              Order
            </span>
            <span className="shrink-0" style={{ width: PW.status }}>
              Status
            </span>
            {mayEdit ? <span className="shrink-0" style={{ width: PW.act }} /> : null}
          </div>
          {shown.map((p) => {
            const limits = policyLimits(p, cur);
            const archived = p.status === 'archived';
            return (
              <div key={p.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-[13px] last:border-b-0', archived && 'opacity-70')}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{p.name}</b>
                  {p.description ? <span className="line-clamp-2 text-[11.5px] text-ink-3">{p.description}</span> : null}
                </span>
                <span className="flex shrink-0 flex-col text-[12.5px] text-ink-2" style={{ width: PW.scope }}>
                  <span className="truncate">{policyScope(p, lists)}</span>
                  {p.category_id !== null ? <span className="truncate text-[11.5px] text-ink-3">{catName(p.category_id) ? `only ${catName(p.category_id)}` : 'one category only'}</span> : null}
                </span>
                <span className={cx('shrink-0 text-[12px] leading-snug', limits.length ? 'text-ink-2' : 'text-ink-3')} style={{ width: PW.limits }}>
                  {limits.length ? limits.join(' · ') : 'nothing set'}
                </span>
                <span className="shrink-0" style={{ width: PW.effect }}>
                  <Pill tone={p.enforcement === 'hard' ? 'red' : 'amber'}>{p.enforcement === 'hard' ? 'Refuses' : 'Flags'}</Pill>
                </span>
                <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: PW.order }}>
                  {p.priority}
                </span>
                <span className="shrink-0" style={{ width: PW.status }}>
                  <Pill tone={archived ? 'grey' : p.status === 'active' ? 'green' : 'amber'}>{p.status.charAt(0).toUpperCase() + p.status.slice(1)}</Pill>
                </span>
                {mayEdit ? (
                  <span className="flex shrink-0 justify-end gap-1" style={{ width: PW.act }}>
                    <button type="button" className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-primary hover:bg-subtle" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    {!archived ? (
                      <button type="button" className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-danger" onClick={() => setArchiving(p)}>
                        Archive
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
          })}
          {!all.length ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
              <b className="text-[13px] text-ink">No policies set.</b>
              <span className="max-w-[560px] text-[12.5px] text-ink-3">Without one, any amount can be claimed against any category. A policy caps what one person may spend in a day, a month or a financial year, and can require a receipt or an explanation above a figure.</span>
            </div>
          ) : !shown.length ? (
            <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-3">No policies match those filters.</div>
          ) : null}
        </div>
      </div>

      <p className="m-0 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">
        Every refusal a policy produces names the rule and both figures — the limit and what the claim would take the total to. A control that only says “policy violation” is one people route around.
      </p>

      {editing !== null ? <PolicySheet orgId={orgId} policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {archiving ? (
        <ConfirmSheet
          title={`Archive “${archiving.name}”?`}
          body="It stops applying from now. Claims it already refused still name it, so the record of the refusal survives."
          action="Archive it"
          danger
          busy={busy}
          onYes={() => void archive(archiving)}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}

/** Which one a scope names: picked from its list where there is one, typed as a number where the list could not be had. */
function WhichOne({ scope, options, loading, value, typed, onPick, onType }: { scope: string; options: Choice[] | null; loading: boolean; value: number | null; typed: string; onPick: (id: number | null) => void; onType: (v: string) => void }) {
  if (options) {
    return (
      <Field label="Which one">
        <Select<number | null> aria-label="Which one" value={value} onValueChange={onPick} disabled={loading} placeholder={loading ? 'Loading…' : 'Choose'} options={options.map((o) => ({ value: o.id, label: o.label }))} empty="Nothing to choose here yet." className="w-full" />
      </Field>
    );
  }
  return (
    <Field label="Which one" hint={scope === 'project' ? 'Projects have no list here yet, so give the project’s number.' : loading ? undefined : 'The list could not be loaded, so give its number.'}>
      <input inputMode="numeric" value={typed} onChange={(e) => onType(e.target.value)} placeholder="id" aria-label="Which one" className={input} disabled={loading} />
    </Field>
  );
}

function PolicySheet({ orgId, policy, onClose, onSaved }: { orgId: number; policy: Policy | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<PolicyDraft>(() => policyDraft(policy));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const set = <F extends keyof PolicyDraft>(f: F, v: PolicyDraft[F]) => setD((x) => ({ ...x, [f]: v }));
  const cats = useQuery({ queryKey: KR.categories(orgId), queryFn: ({ signal }) => fetchCategories(orgId, signal), retry: false, staleTime: 60_000 });
  const centres = useQuery({ queryKey: KR.centres(orgId), queryFn: ({ signal }) => fetchCentres(orgId, signal), enabled: d.scope === 'cost_centre', retry: false, staleTime: 60_000 });
  const people = useQuery({ queryKey: KR.people(orgId), queryFn: ({ signal }) => fetchPeople(orgId, signal), enabled: NAMED.includes(d.scope), retry: false, staleTime: 60_000 });
  const loading = (d.scope === 'cost_centre' && centres.isLoading) || (NAMED.includes(d.scope) && people.isLoading);
  const options = pickList(d.scope, { centres: centres.data, people: people.data });
  const scopeId = options ? d.scope_id : idOf(d.scope_typed);
  const problems = policyProblems(d);

  const save = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await savePolicy(orgId, policyBody(d, policy, scopeId), policy?.id ?? null);
      toast('success', r?.message ?? (policy ? 'Policy saved.' : 'Policy created.'));
      onSaved();
      onClose();
    } catch (e) {
      // "The daily limit is higher than the monthly one…", or whose rights this needs — as said.
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  let second: ReactNode;
  if (d.scope === 'role') {
    second = (
      <Field label="Which role" hint="An expense role here — member, approver, finance or admin — or a platform role’s slug.">
        <input value={d.role_slug} onChange={(e) => set('role_slug', e.target.value)} placeholder="manager" aria-label="Which role" className={input} />
      </Field>
    );
  } else if (d.scope !== 'everyone') {
    second = <WhichOne scope={d.scope} options={options} loading={loading} value={scopeId} typed={d.scope_typed} onPick={(v) => set('scope_id', v)} onType={(v) => set('scope_typed', v)} />;
  } else second = <span />;

  return (
    <Sheet
      title={policy ? 'Edit the policy' : 'New policy'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !d.name.trim() || problems.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Field label="Name" hint="People see this in the refusal, so name it as a rule rather than a number.">
        <input autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={150} placeholder="Travel spending" className={input} />
      </Field>
      <Field label="Description" hint="Optional. Shown under the name on the list.">
        <input value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={400} className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Applies to">
          <Select<PolicyScope> aria-label="Applies to" value={d.scope} onValueChange={(v) => setD((x) => ({ ...x, scope: v, scope_id: null, scope_typed: '' }))} options={POLICY_SCOPES.map((s) => ({ value: s, label: SCOPE_WORDS[s] ?? s }))} className="w-full" />
        </Field>
        {second}
      </div>
      <Field label="Only this category" hint={cats.error ? 'The categories could not be loaded.' : undefined}>
        <Select<number>
          aria-label="Only this category"
          value={d.category_id ?? 0}
          onValueChange={(v) => set('category_id', v || null)}
          disabled={cats.isLoading}
          options={[{ value: 0, label: 'Every category' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.label }))]}
          className="w-full"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {CAPS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input inputMode="decimal" value={d[k]} onChange={(e) => set(k, e.target.value)} placeholder="no limit" aria-label={label} className={input} />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Receipt required above" hint="0 means always.">
          <input inputMode="decimal" value={d.receipt_required_above} onChange={(e) => set('receipt_required_above', e.target.value)} placeholder="never" aria-label="Receipt required above" className={input} />
        </Field>
        <Field label="Explanation required above" hint="0 means always.">
          <input inputMode="decimal" value={d.reason_required_above} onChange={(e) => set('reason_required_above', e.target.value)} placeholder="never" aria-label="Explanation required above" className={input} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Refuse anything older than" hint="Days. Stops claims against a closed period.">
          <input inputMode="numeric" value={d.max_age_days} onChange={(e) => set('max_age_days', e.target.value)} placeholder="no limit" aria-label="Refuse anything older than" className={input} />
        </Field>
        <Field label="Order" hint={problems[0] ? <span className="text-danger">{problems[0]}</span> : 'Lower runs first.'}>
          <input inputMode="numeric" value={d.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Order" className={input} />
        </Field>
      </div>
      <div className="flex items-center gap-3 rounded-[10px] border border-line bg-ground px-3 py-2.5">
        <Switch checked={d.block_weekends} onChange={(v) => set('block_weekends', v)} label="No weekend dates" />
        <span className="text-[13px] text-ink">Refuse expenses dated on a Saturday or a Sunday</span>
      </div>
      <Field label="What happens when it fires">
        <Select<'hard' | 'warn'>
          aria-label="What happens when it fires"
          value={d.enforcement}
          onValueChange={(v) => set('enforcement', v)}
          options={[
            { value: 'hard', label: 'Refuse the claim' },
            { value: 'warn', label: 'Allow it, and flag it for the approver' },
          ]}
          className="w-full"
        />
      </Field>
      <Notice tone="grey">A missing receipt always refuses, whatever this is set to — it is a fact rather than a matter of degree, and an approver cannot fix it afterwards.</Notice>
      <Said lines={said} />
    </Sheet>
  );
}

// ── approval routing ─────────────────────────────────────────────────────

function Routing({ orgId, mayAdmin, onClaim }: { orgId: number; mayAdmin: boolean; onClaim: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KR.routing(orgId), queryFn: ({ signal }) => fetchRouting(orgId, signal), retry: false });
  const [editing, setEditing] = useState<ApprovalRule | 'new' | null>(null);
  const [preview, setPreview] = useState<{ rule: ApprovalRule; result: Preview } | null>(null);
  const [asking, setAsking] = useState(0);

  if (q.isLoading) return <Spinner />;
  const refused = readRefusal(q.error);
  if (refused) return <Notice tone="grey">{refused}</Notice>;
  if (q.error || !q.data) return <LoadFailed what="The approval rules" onRetry={() => void q.refetch()} />;

  const d = q.data;
  const mayEdit = mayAdmin && d.can_edit;
  const active = d.items.filter((r) => r.status !== 'archived');
  const refresh = () => void qc.invalidateQueries({ queryKey: KR.routing(orgId) });

  const runPreview = async (rule: ApprovalRule) => {
    setAsking(rule.id);
    try {
      setPreview({ rule, result: await previewRule(orgId, rule.id) });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setAsking(0);
    }
  };

  return (
    <>
      <StalledNote stalled={d.stalled} onClaim={onClaim} />
      <Panel
        title="Approval rules"
        action={
          mayEdit ? (
            <button type="button" className={btnSmall} onClick={() => setEditing('new')}>
              <Icon name="plus" size={13} className="mr-1" /> New rule
            </button>
          ) : null
        }
        bodyClassName="flex flex-col gap-2.5 p-3.5"
      >
        {active.length ? (
          active.map((r) => (
            <div key={r.id} className="rounded-[10px] border border-line px-3.5 py-3">
              <div className="flex flex-wrap items-start gap-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-[13px] text-ink">{r.name}</b>
                  <span className="text-[12px] text-ink-3">{ruleLine(r, d.currency)}</span>
                </span>
                {mayEdit ? (
                  <span className="flex shrink-0 gap-1">
                    <button type="button" className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-primary hover:bg-subtle disabled:opacity-50" disabled={asking === r.id} onClick={() => void runPreview(r)}>
                      {asking === r.id ? 'Asking…' : 'Who would it ask?'}
                    </button>
                    <button type="button" className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-ink" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                  </span>
                ) : null}
              </div>
              <ol className="m-0 mt-2 flex list-none flex-wrap items-center gap-1.5 p-0 text-[12px]">
                {r.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    {i > 0 ? <Icon name="chevron-right" size={12} className="text-ink-3" /> : null}
                    <span className="rounded-[10px] bg-subtle px-2 py-0.5 text-ink-2">{stepWords(s)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-6 py-6 text-center">
            <b className="text-[13px] text-ink">No approval rules.</b>
            <span className="max-w-[560px] text-[12.5px] text-ink-3">Without one, every claim goes to somebody with finance rights. A rule routes by amount, category, department, cost centre or project, through as many steps as you need.</span>
          </div>
        )}
      </Panel>

      {preview ? (
        <Sheet
          title={preview.rule.name}
          onClose={() => setPreview(null)}
          width={500}
          footer={
            <button type="button" className={btn} onClick={() => setPreview(null)}>
              Close
            </button>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{preview.result.message}</p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {preview.result.steps.map((s) => (
              <li key={s.step} className="rounded-[9px] border border-line px-3 py-2">
                <b className="block text-[13px] text-ink">
                  {s.step}. {s.label}
                </b>
                {s.resolves_to ? <span className="text-[12px] text-ink-3">would go to {s.resolves_to}</span> : <span className="text-[12px] text-danger">{s.problem}</span>}
              </li>
            ))}
          </ol>
          <Notice tone="grey">Resolved against you as the claimant. Nothing was created. A different claimant may route differently — a rule that follows the line manager depends on who is claiming.</Notice>
        </Sheet>
      ) : null}

      {editing !== null ? <RuleSheet orgId={orgId} rule={editing === 'new' ? null : editing} resolvers={d.resolvers} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </>
  );
}

/** Chains nobody can move — the ones that quietly never get paid. Shown to approvers and above. */
function StalledNote({ stalled, onClaim }: { stalled: Stalled[]; onClaim: (id: number) => void }) {
  if (!stalled.length) return null;
  const n = stalled.length;
  return (
    <Notice tone="red">
      <b className="block">{n === 1 ? '1 claim is' : `${n} claims are`} waiting on a step with nobody assigned</b>
      <span className="block">They will sit there indefinitely. Either name somebody on the step below, or reassign the approval from the claim itself.</span>
      <ul className="mt-1.5 mb-0 flex flex-col gap-0.5 pl-4">
        {stalled.slice(0, 5).map((s) => {
          const text = `${s.label ?? 'a step'} — ${s.days_waiting} ${s.days_waiting === 1 ? 'day' : 'days'} — ${s.reason}`;
          return (
            <li key={s.approval_id}>
              {s.entity_type === 'claim' ? (
                <button type="button" className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={() => onClaim(s.entity_id)}>
                  {text}
                </button>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
      {n > 5 ? <span className="mt-1 block">…and {n - 5} more.</span> : null}
    </Notice>
  );
}

function RuleSheet({ orgId, rule, resolvers, onClose, onSaved }: { orgId: number; rule: ApprovalRule | null; resolvers: Array<{ key: string; label: string }>; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<RuleDraft>(() => ruleDraft(rule));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const [archiving, setArchiving] = useState(false);
  const set = <F extends keyof RuleDraft>(f: F, v: RuleDraft[F]) => setD((x) => ({ ...x, [f]: v }));
  const setStep = (i: number, patch: Partial<RuleStep>) => setD((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const wantsPeople = d.steps.some((s) => s.resolver === 'user');
  const people = useQuery({ queryKey: KR.people(orgId), queryFn: ({ signal }) => fetchPeople(orgId, signal), enabled: wantsPeople, retry: false, staleTime: 60_000 });
  const problems = ruleProblems(d);
  const options = resolvers.length ? resolvers : ['manager', 'department', 'cost_centre', 'role', 'user'].map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));

  const save = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await saveRule(orgId, ruleBody(d, rule), rule?.id ?? null);
      toast('success', r?.message ?? 'Approval rule saved.');
      onSaved();
      onClose();
    } catch (e) {
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!rule) return;
    setBusy(true);
    try {
      const m = await archiveRule(orgId, rule.id);
      toast('success', m ?? 'Rule archived. Chains already built from it are untouched.');
      onSaved();
      onClose();
    } catch (e) {
      setArchiving(false);
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        title={rule ? 'Edit the rule' : 'New approval rule'}
        onClose={onClose}
        width={560}
        footer={
          <>
            {rule ? (
              <button type="button" className="mr-auto h-[34px] rounded-[8px] px-2.5 text-[12.5px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-50" disabled={busy} onClick={() => setArchiving(true)}>
                Archive the rule
              </button>
            ) : null}
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !d.name.trim() || d.steps.length === 0 || problems.length > 0} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={150} placeholder="Anything over 50,000" className={input} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="For">
            <Select<'claim' | 'advance'>
              aria-label="For"
              value={d.entity}
              onValueChange={(v) => set('entity', v)}
              options={[
                { value: 'claim', label: 'Expense claims' },
                { value: 'advance', label: 'Cash advances' },
              ]}
              className="w-full"
            />
          </Field>
          <Field label="From" hint="Inclusive.">
            <input inputMode="decimal" value={d.min_amount} onChange={(e) => set('min_amount', e.target.value)} placeholder="any" aria-label="From" className={input} />
          </Field>
          <Field label="Under" hint="Exclusive.">
            <input inputMode="decimal" value={d.max_amount} onChange={(e) => set('max_amount', e.target.value)} placeholder="any" aria-label="Under" className={input} />
          </Field>
        </div>
        <Field label="Order" hint={problems[0] ? <span className="text-danger">{problems[0]}</span> : 'The first matching rule wins, so ordering is what you read down the list.'}>
          <input inputMode="numeric" value={d.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Order" className={cx(input, 'w-[120px]')} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink">Steps, in order</span>
          {d.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-[12px] text-ink-3">{i + 1}</span>
              <Select<string> aria-label={`Step ${i + 1}`} value={s.resolver} onValueChange={(v) => setStep(i, { resolver: v })} options={options.map((r) => ({ value: r.key, label: r.label }))} className="min-w-0 flex-1" />
              {s.resolver === 'role' ? <Select<string> aria-label={`Step ${i + 1} role`} value={s.role ?? 'approver'} onValueChange={(v) => setStep(i, { role: v })} options={ROLES.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))} className="w-[130px]" /> : null}
              {s.resolver === 'user' ? (
                people.data ? (
                  <Select<number | null> aria-label={`Step ${i + 1} person`} value={s.user_id} onValueChange={(v) => setStep(i, { user_id: v })} placeholder="Choose" options={people.data.users.map((u) => ({ value: u.id, label: u.label }))} className="w-[190px]" />
                ) : (
                  <input inputMode="numeric" value={s.user_id ?? ''} onChange={(e) => setStep(i, { user_id: idOf(e.target.value) })} placeholder={people.isLoading ? 'Loading…' : 'user id'} aria-label={`Step ${i + 1} person`} className={cx(input, 'w-[120px]')} disabled={people.isLoading} />
                )
              ) : null}
              <button type="button" aria-label={`Remove step ${i + 1}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger" onClick={() => set('steps', d.steps.filter((_, j) => j !== i))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => set('steps', [...d.steps, { resolver: 'role', role: 'finance', user_id: null, label: null, skip_if_unresolved: true }])}>
            Add a step
          </button>
        </div>
        <Notice tone="grey">A step that resolves to nobody is skipped and says why. If every step resolves to nobody, the claim falls through to finance rather than disappearing — and if there is no finance either, it is reported as stalled.</Notice>
        <Said lines={said} />
      </Sheet>
      {archiving && rule ? (
        <ConfirmSheet
          title={`Archive “${rule.name}”?`}
          body="New claims stop being routed by it from now. Chains already built from it are untouched."
          action="Archive it"
          danger
          busy={busy}
          onYes={() => void archive()}
          onClose={() => setArchiving(false)}
        />
      ) : null}
    </>
  );
}
