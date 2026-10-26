import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ModuleSettingsForm } from '../../components/ModuleSettingsForm';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Cell, Empty, Field, input, Kpi, PageHead, Panel, row, Sheet, THead } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { MONTHS, problemsOf, refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice } from '../finance/parts';
import { can, canAct, K, money, type Org } from './api';
import {
  addFx,
  addMileage,
  addPerDiem,
  browserPath,
  categoryBody,
  categoryDraft,
  categoryProblems,
  centreBody,
  centreDraft,
  centreProblems,
  fetchAccess,
  fetchActivity,
  fetchCatalogue,
  fetchCategories,
  fetchCentres,
  fetchMembers,
  fetchModuleSettings,
  fetchRates,
  fetchRules,
  fxBody,
  fxDraft,
  fxProblems,
  KA,
  mileageBody,
  mileageDraft,
  mileageProblems,
  perDiemBody,
  perDiemDraft,
  perDiemProblems,
  rateText,
  refusedWhy,
  removeCentre,
  ROLE_WORDS,
  rulesBody,
  rulesDraft,
  rulesProblems,
  saveCategory,
  saveCentre,
  saveRules,
  SCOPE_ORDER,
  sectionList,
  silentRoles,
  type Category,
  type CategoryDraft,
  type CentreDraft,
  type CostCentre,
  type RulesDraft,
  type SectionItem,
} from './admin';
import { Organizations } from './Organizations';
import type { ExpenseView, ScreenProps } from './Rail';
import { Checkbox } from '../../components/Checkbox';
import { StatGrid } from '../../components/StatCard';

/**
 * Expenses' settings, as the web draws them: the standard settings shell's
 * sections, then the module's own, then the change log — one list, in the
 * server's order, so the two clients cannot disagree about what exists.
 *
 * WHAT IS DRAWN HERE. General (the three installation-wide fields, from the
 * server's own field list) and every section Expenses declares: its company
 * rules, cost centres, categories, rates, My access, who gets told, the
 * activity log and setting up a company. User Access, Screens, Organization,
 * Notifications and the change log are the installation's shell and open in
 * the browser, marked — they are the same screens for forty-six modules.
 *
 * WHO SEES WHAT. The shell answers only to those who administer Expenses
 * (`expense.manage`), and the server narrows the module's own sections to
 * the ones they may open. My access is the exception, shown to everybody:
 * it answers "what may I do here", which is the question of the person who
 * cannot open the rest. Within a section, a control the person cannot use is
 * absent rather than refused on click — and where the server still refuses
 * (the per-company role), its sentence is shown as written.
 *
 * One company: the shell guarantees `orgId`, and every section follows it.
 */
export default function Settings({ orgId, orgs, onGo }: ScreenProps) {
  if (orgId === null) return <Notice tone="grey" className="m-6 max-w-[560px]">Settings shows one company at a time. Choose one in the switcher.</Notice>;
  return <SettingsFor orgId={orgId} orgs={orgs} onGo={onGo} />;
}

function SettingsFor({ orgId, orgs, onGo }: { orgId: number; orgs: Org[]; onGo: (v: ExpenseView, extra?: string) => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const show = useQuery({ queryKey: KA.moduleSettings(orgId), queryFn: ({ signal }) => fetchModuleSettings(signal), retry: false });
  const [picked, setPicked] = useState<string | null>(null);
  if (show.isLoading) return <Spinner />;

  const company = orgs.find((o) => o.id === orgId) ?? null;
  const items = sectionList(show.data ?? null);
  const natives = items.filter((i) => i.native);
  const current = natives.find((i) => i.key === picked) ?? natives.find((i) => i.key === 'general') ?? natives[0]!;
  const refused = show.error ? refusedWhy(show.error) : null;
  const may = { manage: can(perms, 'expense.manage'), admin: can(perms, 'expense.admin') };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Settings" sub={`Expenses${company ? ` · ${company.name}` : ''}`} />
      <div className="flex items-start gap-3.5">
        <SectionNav items={items} current={current.key} onPick={setPicked} />
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          {show.error ? (
            refused ? (
              <Notice tone="grey">{refused} The rest of these settings are for people who administer Expenses; your own access is below.</Notice>
            ) : (
              <LoadFailed what="The settings list" onRetry={() => void show.refetch()} />
            )
          ) : null}
          <Section item={current} orgId={orgId} orgs={orgs} may={may} note={show.data?.note ?? null} advanced={show.data?.spec?.unavailable?.advanced ?? null} onGo={onGo} />
        </div>
      </div>
    </div>
  );
}

function SectionNav({ items, current, onPick }: { items: SectionItem[]; current: string; onPick: (key: string) => void }) {
  const group = (g: SectionItem['group'], head: string) => {
    const list = items.filter((i) => i.group === g);
    if (!list.length) return null;
    return (
      <>
        <div className="mt-2 mb-0.5 px-2.5 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase first:mt-0">{head}</div>
        {list.map((n) => {
          const on = n.native && n.key === current;
          return (
            <button
              key={n.key}
              type="button"
              aria-current={on ? 'page' : undefined}
              title={n.native ? n.label : `${n.label} — opens in your browser`}
              onClick={() => (n.native ? onPick(n.key) : void call('app:openInBrowser', { path: browserPath(n.key) }))}
              className={cx('flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
            >
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
              {n.native ? null : <Icon name="external" size={12} className="shrink-0 text-ink-3" />}
            </button>
          );
        })}
      </>
    );
  };
  return (
    <nav aria-label="Settings sections" className="flex w-[210px] shrink-0 flex-col gap-0.5">
      {group('standard', 'Settings')}
      {group('module', 'Expenses')}
      {group('history', 'History')}
    </nav>
  );
}

interface May {
  manage: boolean;
  admin: boolean;
}

function Section({ item, orgId, orgs, may, note, advanced, onGo }: { item: SectionItem; orgId: number; orgs: Org[]; may: May; note: string | null; advanced: string | null; onGo: (v: ExpenseView, extra?: string) => void }) {
  switch (item.key) {
    case 'general':
      return (
        <>
          {/* A module's standing caveat goes above the controls: after somebody has set a value is too late to learn it is not read. */}
          {note ? <Notice tone="amber">{note}</Notice> : null}
          <ModuleSettingsForm slug="expense" section="general" queryKey={KA.moduleSettings(orgId)} note="Expenses keeps one set of these for the whole installation, so they apply to every company." readOnly="You can read these settings; changing them needs expense.manage." />
          <Notice tone="grey">Each company also has its own numbering, currency and financial year, under Company rules. Claims filed through the newer claim form are numbered from there and the rest from here, so both are in use.</Notice>
        </>
      );
    case 'advanced':
      return (
        <Panel title="Advanced" bodyClassName="px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
          {advanced ?? 'Expenses has nothing configurable in this section. Its behaviour here is fixed, which is not the same as unconfigured — there is no hidden setting to find.'}
        </Panel>
      );
    case 'company':
      return <CompanyRules orgId={orgId} mayAdmin={may.admin} />;
    case 'centres':
      return <Centres orgId={orgId} mayManage={may.manage} />;
    case 'categories':
      return <Categories orgId={orgId} may={may} />;
    case 'rates':
      return <Rates orgId={orgId} mayAdmin={may.admin} />;
    case 'myaccess':
      return <MyAccess orgId={orgId} orgs={orgs} onGo={onGo} />;
    case 'events':
      return <WhoGetsTold orgId={orgId} />;
    case 'activity':
      return <Activity orgId={orgId} />;
    case 'companies':
      return <Organizations onCreated={() => undefined} />;
    default:
      // A section the server lists and this version cannot draw: said, never a blank panel.
      return (
        <Panel title={item.label} bodyClassName="flex flex-col items-start gap-2.5 px-3.5 py-3 text-[13px] text-ink-2">
          <span>Expenses offers a “{item.label}” section that this version of the desktop app does not know how to draw. The server is ahead of the app; the browser has it.</span>
          <button type="button" className={btnSmall + ' gap-1'} onClick={() => void call('app:openInBrowser', { path: browserPath(item.key) })}>
            Open in the browser <Icon name="external" size={11} />
          </button>
        </Panel>
      );
  }
}

/** A read that failed: the server's refusal as written, or a retry. */
function Failed({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  const why = refusedWhy(error);
  return why ? <Notice tone="grey">{why}</Notice> : <LoadFailed what={what} onRetry={onRetry} />;
}

function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <Notice tone="red">
      {items.map((p) => (
        <div key={p}>{p}</div>
      ))}
    </Notice>
  );
}

const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

// ── company rules ────────────────────────────────────────────────────────

/**
 * The per-company rules, writing `expense_org_settings` — NOT the store the
 * General section writes. The newer claim endpoint numbers from this table;
 * the original one from General's. Both are live, so both are shown.
 *
 * Two refusals worth knowing before looking for the button: the currency
 * cannot change once claims exist (it would relabel every stored figure
 * without converting it), and self-approval is said out loud every time it
 * is switched on.
 */
function CompanyRules({ orgId, mayAdmin }: { orgId: number; mayAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.rules(orgId), queryFn: ({ signal }) => fetchRules(orgId, signal), retry: false });
  const [d, setD] = useState<RulesDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Failed error={q.error} what="This company’s rules" onRetry={() => void q.refetch()} />;
  const r = q.data;
  const v = d ?? rulesDraft(r);
  const set = (patch: Partial<RulesDraft>) => setD({ ...v, ...patch });
  const off = !mayAdmin || busy;

  const save = async () => {
    const found = rulesProblems(v);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const res = await saveRules(orgId, rulesBody(r, v));
      // "Settings saved." — and, when self-approval is on, the sentence saying so, as a warning.
      toast(v.allowSelfApproval ? 'warning' : 'success', res.message ?? 'Settings saved.');
      setD(null);
      // A new name or currency is on every Expenses screen, and in the switcher.
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      setProblems(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-3.5">
      <Panel title="This organization" sub={r.fiscalYear ? `This financial year is ${r.fiscalYear.label}: ${shortDate(r.fiscalYear.start)} to ${shortDate(r.fiscalYear.end)}` : undefined} bodyClassName="flex flex-col gap-3 px-3.5 py-3">
        <Field label="Name">
          <input aria-label="Name" value={v.name} disabled={off} onChange={(e) => set({ name: e.target.value })} className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Currency" hint="Cannot change once claims exist.">
            <input aria-label="Currency" value={v.currency} disabled={off} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} className={input + ' font-mono'} />
          </Field>
          <Field label="Financial year starts" hint="Budgets and annual caps follow this.">
            <Select<string> aria-label="Financial year starts" value={v.fiscalStartMonth} disabled={off} onValueChange={(m) => set({ fiscalStartMonth: m })} options={monthOptions} className={input} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Claim prefix">
            <input aria-label="Claim prefix" value={v.claimPrefix} disabled={off} maxLength={12} onChange={(e) => set({ claimPrefix: e.target.value })} className={input} />
          </Field>
          <Field label="Advance prefix">
            <input aria-label="Advance prefix" value={v.advancePrefix} disabled={off} maxLength={12} onChange={(e) => set({ advancePrefix: e.target.value })} className={input} />
          </Field>
          <Field label="Digits">
            <input aria-label="Digits" inputMode="numeric" value={v.numberPad} disabled={off} onChange={(e) => set({ numberPad: e.target.value })} className={input} />
          </Field>
        </div>
        <Field label="Account code prefix" hint="Prepended to every GL code in the accounting export.">
          <input aria-label="Account code prefix" value={v.glPrefix} disabled={off} maxLength={20} placeholder="none" onChange={(e) => set({ glPrefix: e.target.value })} className={input} />
        </Field>
        <Check label="Every claim must name a cost centre" checked={v.requireCostCentre} disabled={off} onChange={(on) => set({ requireCostCentre: on })} />
        <Check label="Every claim must be charged to a project" checked={v.requireProject} disabled={off} onChange={(on) => set({ requireProject: on })} />
        <label className="flex items-start gap-2 rounded-[10px] border border-[#F5D48A] bg-[#FFF8E6] px-3 py-2.5 text-[12.5px] text-[#7A3B05] dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          <Checkbox aria-label="Let people approve their own claims" checked={v.allowSelfApproval} disabled={off} onChange={(e) => set({ allowSelfApproval: e.target.checked })} className="mt-0.5" />
          <span className="flex flex-col gap-0.5">
            <b>Let people approve their own claims</b>
            <span>Off by default, and worth leaving off. With it on, an approval chain that lands on the claimant is an approval by the claimant — a receipt rather than a control.</span>
          </span>
        </label>
        <Problems items={problems} />
        {mayAdmin ? (
          <div className="flex items-center justify-end gap-2">
            {d ? (
              <button type="button" className={btn} disabled={busy} onClick={() => (setD(null), setProblems([]))}>
                Discard
              </button>
            ) : null}
            <button type="button" className={btnPrimary} disabled={busy || !d} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <span className="text-[12px] text-ink-3">You can read these rules. Changing them needs expense administration rights and the administrator role in this company.</span>
        )}
      </Panel>

      <div className="flex flex-col gap-3.5">
        <Panel title="Receipt reading" bodyClassName="flex flex-col gap-1 px-3.5 py-3 text-[13px] text-ink-2">
          <span>{r.receiptReading?.message || 'Whether receipts can be read on this server was not reported.'}</span>
          {r.receiptReading?.ok && r.receiptReading.engine ? (
            <span className="text-[12px] text-ink-3">
              Engine: {r.receiptReading.engine} {r.receiptReading.version ?? ''}
            </span>
          ) : null}
        </Panel>
        {/* Written into the product, not only a commit message: the person configuring it is the one who would go looking for these switches. */}
        <Panel title="What this module cannot do" bodyClassName="flex flex-col gap-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
          <span><b className="text-ink">No bank or card feed.</b> Statements are imported from CSV. A live feed needs a commercial arrangement with the issuer, not a setting.</span>
          <span><b className="text-ink">No distance service.</b> Mileage is a distance somebody enters, multiplied by a rate you set.</span>
          <span><b className="text-ink">No general ledger.</b> The accounting export produces balanced double-entry lines for import elsewhere; nothing is posted here.</span>
          <span><b className="text-ink">No AI.</b> Receipt reading is optical character recognition and its output is a suggestion. Nothing categorises, predicts or judges.</span>
          <span><b className="text-ink">No tax decisions.</b> A rate can be attached and multiplied. Whether it is correct or recoverable is not something this can answer.</span>
        </Panel>
      </div>
    </div>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
      <Checkbox aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ── cost centres ─────────────────────────────────────────────────────────

/**
 * The dimension finance reports on, with each centre's spend this financial
 * year so the list is useful rather than a bare hierarchy. A centre that
 * claims are charged to cannot be removed — the server says so and why — and
 * is archived instead, which the web offered no control for.
 */
function Centres({ orgId, mayManage }: { orgId: number; mayManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.centres(orgId), queryFn: ({ signal }) => fetchCentres(orgId, signal), retry: false });
  const [editing, setEditing] = useState<CostCentre | 'new' | null>(null);
  const [removing, setRemoving] = useState<CostCentre | null>(null);
  const [removeWhy, setRemoveWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Failed error={q.error} what="The cost centres" onRetry={() => void q.refetch()} />;
  const { items, yearLabel, currency } = q.data;
  // Claims name a cost centre, so the claim form's list is under the same company.
  const refresh = () => void qc.invalidateQueries({ queryKey: K.one(orgId) });

  const remove = async (c: CostCentre) => {
    setBusy(true);
    try {
      const r = await removeCentre(orgId, c.id);
      toast('success', r.message ?? 'Cost centre removed.');
      setRemoving(null);
      refresh();
    } catch (e) {
      // "3 claim(s) are charged to this cost centre. Archive it instead…" — kept on the sheet, where it can be read.
      setRemoveWhy(refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const cols: Array<[string, number | null]> = [
    ['Code', 90],
    ['Name', null],
    ['Kind', 70],
    ['Owner', 140],
    ['GL code', 100],
    [yearLabel ? `Spend, ${yearLabel}` : 'Spend', 170],
    ...(mayManage ? [['', 130] as [string, number]] : []),
  ];

  return (
    <Panel
      title="Cost centres"
      sub="The dimension finance actually reports on. Claims can be required to name one."
      action={
        mayManage ? (
          <button type="button" className={btnSmall + ' gap-1'} onClick={() => setEditing('new')}>
            <Icon name="plus" size={13} /> New
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {items.length ? (
        <>
          <THead cols={cols} />
          {items.map((c) => (
            <div key={c.id} data-centre={c.id} className={cx(row, c.status === 'archived' && 'opacity-55')}>
              <Cell w={90} className="font-mono text-[12px] text-ink-2">
                {c.code}
              </Cell>
              <Cell w={null} className="font-semibold">
                {c.name}
                {c.status === 'archived' ? (
                  <span className="ml-1.5">
                    <Pill>Archived</Pill>
                  </span>
                ) : null}
              </Cell>
              <Cell w={70} className="text-ink-3">
                {c.kind}
              </Cell>
              <Cell w={140} className="text-ink-3">
                {c.manager ?? '—'}
              </Cell>
              <Cell w={100} className="font-mono text-[12px] text-ink-3">
                {c.glCode ?? '—'}
              </Cell>
              <Cell w={170} className="tabular-nums">
                {money(c.spend, currency)} <span className="text-[11.5px] text-ink-3">({c.claims})</span>
              </Cell>
              {mayManage ? (
                <span className="flex w-[130px] shrink-0 justify-end gap-1.5">
                  <button type="button" className={btnSmall + ' !h-7'} onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <button type="button" className={btnSmall + ' !h-7 !text-danger'} onClick={() => (setRemoveWhy(null), setRemoving(c))}>
                    Remove
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </>
      ) : (
        <Empty text="No cost centres. The dimension finance actually reports on — claims can be required to name one." />
      )}
      {editing ? <CentreSheet orgId={orgId} centre={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {removing ? (
        <ConfirmSheet
          title={`Remove ${removing.code}?`}
          body={
            <div className="flex flex-col gap-2">
              <span>
                {removing.name} goes for good. A cost centre that claims are charged to, or that others sit under, cannot be removed — archive it instead, so reports that have already been read do not change.
              </span>
              {removeWhy ? <Notice tone="red">{removeWhy}</Notice> : null}
            </div>
          }
          action="Remove"
          danger
          busy={busy}
          onYes={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Panel>
  );
}

function CentreSheet({ orgId, centre, onClose, onSaved }: { orgId: number; centre: CostCentre | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<CentreDraft>(() => centreDraft(centre));
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The owner is a person approval rules can route to: chosen from the company's members, by name.
  const people = useQuery({ queryKey: KA.members(orgId), queryFn: ({ signal }) => fetchMembers(orgId, signal), retry: false, staleTime: 60_000 });
  const owners = [{ value: '', label: 'Nobody' }, ...(people.data ?? []).map((m) => ({ value: String(m.userId), label: m.name, hint: m.role }))];
  if (centre?.managerId && !owners.some((o) => o.value === String(centre.managerId))) owners.push({ value: String(centre.managerId), label: centre.manager ?? `User ${centre.managerId}`, hint: 'not a member' });

  const save = async () => {
    const found = centreProblems(d);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const r = await saveCentre(orgId, centreBody(d, centre), centre?.id ?? null);
      toast('success', r.message ?? (centre ? 'Cost centre saved.' : 'Cost centre added.'));
      onSaved();
      onClose();
    } catch (e) {
      setProblems(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={centre ? 'Edit the cost centre' : 'New cost centre'}
      width={500}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Code">
          <input aria-label="Code" autoFocus value={d.code} maxLength={30} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} className={input + ' font-mono'} />
        </Field>
        <Field label="Kind">
          <Select<CentreDraft['kind']>
            aria-label="Kind"
            value={d.kind}
            onValueChange={(k) => setD({ ...d, kind: k })}
            options={[
              { value: 'cost', label: 'Cost centre' },
              { value: 'profit', label: 'Profit centre' },
            ]}
            className={input}
          />
        </Field>
      </div>
      <Field label="Name">
        <input aria-label="Name" value={d.name} maxLength={150} onChange={(e) => setD({ ...d, name: e.target.value })} className={input} />
      </Field>
      <Field label="GL code" hint="Used in the accounting export.">
        <input aria-label="GL code" value={d.glCode} maxLength={40} onChange={(e) => setD({ ...d, glCode: e.target.value })} className={input + ' font-mono'} />
      </Field>
      <Field label="Owner" hint="Approval rules can route to this person.">
        <Select<string> aria-label="Owner" searchable value={d.managerId} onValueChange={(v) => setD({ ...d, managerId: v })} options={owners} loading={people.isLoading} className={input} />
      </Field>
      {centre ? (
        <Field label="Status" hint="An archived cost centre keeps its claims and its history.">
          <Select<CentreDraft['status']>
            aria-label="Status"
            value={d.status}
            onValueChange={(s) => setD({ ...d, status: s })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
            className={input}
          />
        </Field>
      ) : null}
      <Problems items={problems} />
    </Sheet>
  );
}

// ── categories ───────────────────────────────────────────────────────────

/**
 * This company's categories and the ones shared by every company. A shared
 * one changes every company's list, so editing it needs expense.admin — the
 * Edit is absent for anybody else rather than refused.
 */
function Categories({ orgId, may }: { orgId: number; may: May }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.categories(orgId), queryFn: ({ signal }) => fetchCategories(orgId, signal), retry: false });
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Failed error={q.error} what="The categories" onRetry={() => void q.refetch()} />;
  const items = q.data;
  const mayEdit = (c: Category) => may.manage && (!c.shared || may.admin);

  return (
    <Panel
      title="Categories"
      sub="What a claim is for. A category can demand a receipt every time, and its GL code is where it lands in the export."
      action={
        may.manage ? (
          <button type="button" className={btnSmall + ' gap-1'} onClick={() => setEditing('new')}>
            <Icon name="plus" size={13} /> New
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {items.length ? (
        <>
          <THead
            cols={[
              ['Category', null],
              ['Code', 90],
              ['GL code', 100],
              ['Receipt', 80],
              ['Scope', 150],
              ...(may.manage ? [['', 60] as [string, number]] : []),
            ]}
          />
          {items.map((c) => (
            <div key={c.id} data-category={c.id} className={cx(row, c.status === 'archived' && 'opacity-55')}>
              <Cell w={null} className="font-semibold">
                {c.name}
                {c.status === 'archived' ? (
                  <span className="ml-1.5">
                    <Pill>Archived</Pill>
                  </span>
                ) : null}
              </Cell>
              <Cell w={90} className="font-mono text-[12px] text-ink-3">
                {c.code ?? '—'}
              </Cell>
              <Cell w={100} className="font-mono text-[12px] text-ink-3">
                {c.glCode ?? '—'}
              </Cell>
              <Cell w={80} className="text-ink-3">
                {c.requiresReceipt ? 'always' : '—'}
              </Cell>
              <Cell w={150} className="text-[12px] text-ink-3">
                {c.shared ? 'every organization' : 'this one only'}
              </Cell>
              {may.manage ? (
                <span className="flex w-[60px] shrink-0 justify-end">
                  {mayEdit(c) ? (
                    <button type="button" className={btnSmall + ' !h-7'} onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          ))}
        </>
      ) : (
        <Empty text="No categories yet." />
      )}
      {editing ? <CategorySheet orgId={orgId} category={editing === 'new' ? null : editing} mayShare={may.admin} onClose={() => setEditing(null)} onSaved={() => void qc.invalidateQueries({ queryKey: K.one(orgId) })} /> : null}
    </Panel>
  );
}

function CategorySheet({ orgId, category, mayShare, onClose, onSaved }: { orgId: number; category: Category | null; mayShare: boolean; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<CategoryDraft>(() => categoryDraft(category));
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const found = categoryProblems(d);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const r = await saveCategory(orgId, categoryBody(d, category), category?.id ?? null);
      toast('success', r.message ?? (category ? 'Category saved.' : 'Category added.'));
      onSaved();
      onClose();
    } catch (e) {
      setProblems(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={category ? 'Edit the category' : 'New category'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {category?.shared ? <Notice tone="amber">This category is shared by every organization. A change here changes it for all of them.</Notice> : null}
      <Field label="Name">
        <input aria-label="Name" autoFocus value={d.name} maxLength={100} onChange={(e) => setD({ ...d, name: e.target.value })} className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Short code">
          <input aria-label="Short code" value={d.code} maxLength={20} onChange={(e) => setD({ ...d, code: e.target.value })} className={input + ' font-mono'} />
        </Field>
        <Field label="GL code" hint="Where this lands in the export.">
          <input aria-label="GL code" value={d.glCode} maxLength={40} onChange={(e) => setD({ ...d, glCode: e.target.value })} className={input + ' font-mono'} />
        </Field>
      </div>
      <Check label="Always needs a receipt" checked={d.requiresReceipt} onChange={(on) => setD({ ...d, requiresReceipt: on })} />
      {!category && mayShare ? <Check label="Share with every organization" checked={d.shared} onChange={(on) => setD({ ...d, shared: on })} /> : null}
      {category ? (
        <Field label="Status">
          <Select<CategoryDraft['status']>
            aria-label="Status"
            value={d.status}
            onValueChange={(s) => setD({ ...d, status: s })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
            className={input}
          />
        </Field>
      ) : null}
      <Problems items={problems} />
    </Sheet>
  );
}

// ── rates ────────────────────────────────────────────────────────────────

/**
 * Mileage, per diem and exchange rates, each effective from a date so a
 * claim keeps the rate it was paid at. None is shipped with the software —
 * published rates differ by country and change every year — and the screen
 * says so first. Every figure is validated as text and sent as typed.
 */
function Rates({ orgId, mayAdmin }: { orgId: number; mayAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.rates(orgId), queryFn: ({ signal }) => fetchRates(orgId, signal), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Failed error={q.error} what="The rates" onRetry={() => void q.refetch()} />;
  const r = q.data;
  // The permission, and administrator of this company — what the server checks on every rate.
  const editable = mayAdmin && r.canEdit;
  // The claim form prices mileage and per diem from these, under the same company.
  const refresh = () => void qc.invalidateQueries({ queryKey: K.one(orgId) });

  return (
    <div className="flex flex-col gap-3.5">
      {r.note ? <Notice tone="grey">{r.note}</Notice> : null}
      {!editable ? <span className="text-[12px] text-ink-3">You can read these rates. Adding one needs expense administration rights and the administrator role in this company.</span> : null}

      <Panel title="Mileage" bodyClassName="flex flex-col">
        {editable ? <MileageForm orgId={orgId} onAdded={refresh} /> : null}
        {r.mileage.length ? (
          <>
            <THead
              cols={[
                ['Vehicle', null],
                ['Rate', 170],
                ['Tier', 200],
                ['From', 110],
                ['To', 110],
              ]}
            />
            {r.mileage.map((m) => (
              <div key={m.id} data-mileage={m.id} className={row}>
                <Cell w={null} className="font-semibold">
                  {m.vehicle}
                </Cell>
                <Cell w={170} className="tabular-nums">
                  {rateText(m.rate)} per {m.unit}
                </Cell>
                <Cell w={200} className="text-ink-3">
                  {m.thresholdUnits && m.rateAfter ? `${rateText(m.rateAfter)} above ${rateText(m.thresholdUnits)} ${m.unit}` : '—'}
                </Cell>
                <Cell w={110} className="text-ink-3">
                  {shortDate(m.effectiveFrom)}
                </Cell>
                <Cell w={110} className="text-ink-3">
                  {m.effectiveTo ? shortDate(m.effectiveTo) : 'still current'}
                </Cell>
              </div>
            ))}
          </>
        ) : (
          <Empty text="No mileage rate set, so mileage claims will be refused." />
        )}
      </Panel>

      <Panel title="Per diem" bodyClassName="flex flex-col">
        {editable ? <PerDiemForm orgId={orgId} onAdded={refresh} /> : null}
        {r.perDiem.length ? (
          <>
            <THead
              cols={[
                ['Where', null],
                ['Daily', 160],
                ['First/last day', 120],
                ['From', 110],
              ]}
            />
            {r.perDiem.map((p) => (
              <div key={p.id} data-perdiem={p.id} className={row}>
                <Cell w={null} className="font-semibold">
                  {p.city || p.country || 'Anywhere'}
                </Cell>
                <Cell w={160} className="tabular-nums">
                  {money(p.dailyRate, p.currency)}
                </Cell>
                <Cell w={120} className="text-ink-3">
                  {p.firstLastPct}%
                </Cell>
                <Cell w={110} className="text-ink-3">
                  {shortDate(p.effectiveFrom)}
                </Cell>
              </div>
            ))}
          </>
        ) : (
          <Empty text="No per diem schedule set." />
        )}
      </Panel>

      <Panel title="Exchange rates" bodyClassName="flex flex-col">
        {editable ? <FxForm orgId={orgId} base={r.currency} onAdded={refresh} /> : null}
        {r.fx.length ? (
          <>
            <THead
              cols={[
                ['Currency', null],
                ['Rate', 170],
                ['From', 110],
                ['Source', 110],
              ]}
            />
            {r.fx.slice(0, 30).map((f) => (
              <div key={f.id} data-fx={f.id} className={row}>
                <Cell w={null} className="font-mono font-semibold">
                  {f.currency}
                </Cell>
                <Cell w={170} className="tabular-nums">
                  {f.rate} {r.currency}
                </Cell>
                <Cell w={110} className="text-ink-3">
                  {shortDate(f.effectiveOn)}
                </Cell>
                <Cell w={110} className="text-[12px] text-ink-3">
                  {f.source ?? '—'}
                </Cell>
              </div>
            ))}
          </>
        ) : (
          <Empty text="No exchange rates recorded. A claim in a currency with no rate on file is refused rather than converted at a guess — assuming parity would turn a USD 300 hotel bill into 300 of your own currency." />
        )}
      </Panel>
    </div>
  );
}

/** One add-a-rate row: the fields, the button, and what is wrong with them. */
function AddRow({ children, label, busy, onAdd, problems }: { children: ReactNode; label: string; busy: boolean; onAdd: () => void; problems: string[] }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-ground/60 px-3.5 py-3">
      <div className="flex flex-wrap items-end gap-2.5">
        {children}
        <button type="button" className={btnPrimary} disabled={busy} onClick={onAdd}>
          {busy ? 'Saving…' : label}
        </button>
      </div>
      <Problems items={problems} />
    </div>
  );
}

/** Runs an add: said problems stop it; the server's sentence confirms or refuses it. */
function useAdd(onAdded: () => void) {
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (found: string[], go: () => Promise<{ message: string | null }>, fallback: string, reset: () => void) => {
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const r = await go();
      toast('success', r.message ?? fallback);
      reset();
      onAdded();
    } catch (e) {
      setProblems(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };
  return { problems, busy, run };
}

function MileageForm({ orgId, onAdded }: { orgId: number; onAdded: () => void }) {
  const [d, setD] = useState(() => mileageDraft(todayInZone()));
  const { problems, busy, run } = useAdd(onAdded);
  return (
    <AddRow label="Add" busy={busy} problems={problems} onAdd={() => void run(mileageProblems(d), () => addMileage(orgId, mileageBody(d)), 'Mileage rate added.', () => setD(mileageDraft(todayInZone())))}>
      <Field label="Vehicle" className="w-[120px]">
        <input aria-label="Vehicle" value={d.vehicle} maxLength={60} onChange={(e) => setD({ ...d, vehicle: e.target.value })} className={input} />
      </Field>
      <Field label="Unit" className="w-[96px]">
        <Select<'km' | 'mile'>
          aria-label="Unit"
          value={d.unit}
          onValueChange={(u) => setD({ ...d, unit: u })}
          options={[
            { value: 'km', label: 'km' },
            { value: 'mile', label: 'mile' },
          ]}
          className={input}
        />
      </Field>
      <Field label="Rate" className="w-[110px]">
        <input aria-label="Rate" inputMode="decimal" value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} placeholder="0.0000" className={input + ' tabular-nums'} />
      </Field>
      <Field label="Tier above" className="w-[110px]">
        <input aria-label="Tier above" inputMode="decimal" value={d.thresholdUnits} onChange={(e) => setD({ ...d, thresholdUnits: e.target.value })} placeholder="optional" className={input + ' tabular-nums'} />
      </Field>
      <Field label="Rate after" className="w-[110px]">
        <input aria-label="Rate after" inputMode="decimal" value={d.rateAfter} onChange={(e) => setD({ ...d, rateAfter: e.target.value })} className={input + ' tabular-nums'} />
      </Field>
      <Field label="From" className="w-[150px]">
        <input aria-label="From" type="date" value={d.effectiveFrom} onChange={(e) => setD({ ...d, effectiveFrom: e.target.value })} className={input} />
      </Field>
    </AddRow>
  );
}

function PerDiemForm({ orgId, onAdded }: { orgId: number; onAdded: () => void }) {
  const [d, setD] = useState(() => perDiemDraft(todayInZone()));
  const { problems, busy, run } = useAdd(onAdded);
  return (
    <AddRow label="Add" busy={busy} problems={problems} onAdd={() => void run(perDiemProblems(d), () => addPerDiem(orgId, perDiemBody(d)), 'Per diem rate added.', () => setD(perDiemDraft(todayInZone())))}>
      {/* Matched against the claim's country as written, so spelled the way the claim form spells it. */}
      <Field label="Country" className="w-[170px]">
        <input aria-label="Country" value={d.country} maxLength={80} onChange={(e) => setD({ ...d, country: e.target.value })} placeholder="Anywhere" className={input} />
      </Field>
      <Field label="City" className="w-[130px]">
        <input aria-label="City" value={d.city} maxLength={120} onChange={(e) => setD({ ...d, city: e.target.value })} className={input} />
      </Field>
      <Field label="Daily rate" className="w-[120px]">
        <input aria-label="Daily rate" inputMode="decimal" value={d.dailyRate} onChange={(e) => setD({ ...d, dailyRate: e.target.value })} className={input + ' tabular-nums'} />
      </Field>
      <Field label="First/last day %" hint="Usually 50 or 75." className="w-[120px]">
        <input aria-label="First/last day %" inputMode="numeric" value={d.firstLastPct} onChange={(e) => setD({ ...d, firstLastPct: e.target.value })} className={input + ' tabular-nums'} />
      </Field>
      <Field label="From" className="w-[150px]">
        <input aria-label="From" type="date" value={d.effectiveFrom} onChange={(e) => setD({ ...d, effectiveFrom: e.target.value })} className={input} />
      </Field>
    </AddRow>
  );
}

function FxForm({ orgId, base, onAdded }: { orgId: number; base: string; onAdded: () => void }) {
  const [d, setD] = useState(() => fxDraft(todayInZone()));
  const { problems, busy, run } = useAdd(onAdded);
  return (
    <AddRow label="Record it" busy={busy} problems={problems} onAdd={() => void run(fxProblems(d, base), () => addFx(orgId, fxBody(d)), 'Rate recorded.', () => setD(fxDraft(todayInZone())))}>
      <Field label="Currency" className="w-[96px]">
        <input aria-label="Currency" value={d.currency} maxLength={3} placeholder="USD" onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) })} className={input + ' font-mono'} />
      </Field>
      <Field label={`1 unit = ? ${base}`} className="w-[150px]">
        <input aria-label={`Rate in ${base}`} inputMode="decimal" value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} className={input + ' tabular-nums'} />
      </Field>
      <Field label="From" className="w-[150px]">
        <input aria-label="From" type="date" value={d.effectiveOn} onChange={(e) => setD({ ...d, effectiveOn: e.target.value })} className={input} />
      </Field>
    </AddRow>
  );
}

// ── my access ────────────────────────────────────────────────────────────

/**
 * What this person may see here, and why — a projection of the code that
 * decides (`Claims::scopes()`, the same array the claim lists build their
 * query from), so it cannot drift from it. Every refusal is a sentence:
 * "nobody has recorded which department you belong to" tells somebody what
 * to ask for, where "Department: no" sends them to ask what to change.
 *
 * Open to everybody, and it changes nothing.
 */
function MyAccess({ orgId, orgs, onGo }: { orgId: number; orgs: Org[]; onGo: (v: ExpenseView, extra?: string) => void }) {
  const q = useQuery({ queryKey: KA.access(orgId), queryFn: ({ signal }) => fetchAccess(orgId, signal), retry: false });
  const LIST: Partial<Record<string, ExpenseView>> = { mine: 'mine', team: 'team', organization: 'organization' };
  const a = q.data;

  return (
    <div className="flex flex-col gap-3.5">
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <Failed error={q.error} what="Your access" onRetry={() => void q.refetch()} /> : null}
      {a ? (
        <>
          <Panel title="Where you stand" bodyClassName="flex flex-col gap-3 px-3.5 py-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Your role here</span>
                <b className="text-[17px] text-ink capitalize">{a.role ?? 'not a member'}</b>
                {a.personalLimit ? <span className="text-[12px] text-ink-3">Own ceiling {money(a.personalLimit)}, on top of policy.</span> : null}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Where you are posted</span>
                {(
                  [
                    ['Branch', a.posting.branch, a.configurable.branch],
                    ['Department', a.posting.department, a.configurable.department],
                    ['Cost centre', a.posting.costCentre, true],
                  ] as Array<[string, string | null, boolean]>
                ).map(([label, value, configurable]) => (
                  <span key={label} className="flex gap-2 text-[13px]">
                    <span className="w-[96px] shrink-0 text-ink-3">{label}</span>
                    <span className={value ? 'text-ink' : 'text-ink-3'}>{value ?? (configurable ? 'not recorded' : 'none defined yet')}</span>
                  </span>
                ))}
              </div>
            </div>
            {a.viaStar ? <Notice tone="grey">You hold the super-admin grant, so every permission below reads as held wherever you go.</Notice> : null}
          </Panel>

          <Panel title="Which expenses you can list" bodyClassName="flex flex-col">
            {SCOPE_ORDER.map(([key, label]) => {
              const s = a.scopes[key];
              if (!s) return null;
              const view = LIST[key];
              return (
                <div key={key} data-scope={key} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0">
                  <b className="w-[110px] shrink-0 text-ink">{label}</b>
                  <span className="w-[44px] shrink-0">
                    <Pill tone={s.allowed ? 'green' : 'grey'}>{s.allowed ? 'yes' : 'no'}</Pill>
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{s.why}</span>
                  {s.allowed && view ? (
                    <button type="button" className="shrink-0 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => onGo(view)}>
                      Open
                    </button>
                  ) : null}
                </div>
              );
            })}
            <p className="m-0 border-t border-line px-3.5 py-2.5 text-[12px] text-ink-3">These describe which claims a list can contain, never what you may do to one. Approving, paying and administering are the permissions below, and they are checked separately every time.</p>
          </Panel>

          {a.permissions.length ? (
            <Panel title="Your expense permissions" bodyClassName="flex flex-col">
              {a.permissions.map((p) => (
                <div key={p.slug} data-permission={p.slug} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0">
                  <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', p.held ? 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success' : 'bg-subtle text-ink-3')}>
                    <Icon name={p.held ? 'check' : 'minus'} size={13} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="text-ink">{p.name}</b>
                    <span className="font-mono text-[11.5px] text-ink-3">{p.slug}</span>
                  </span>
                  <span className="text-[12px] text-ink-3">{p.held ? 'held' : 'not held'}</span>
                </div>
              ))}
              <p className="m-0 border-t border-line px-3.5 py-2.5 text-[12px] text-ink-3">Permissions are granted on a role, for the whole installation — not per organization. Membership says where they apply.</p>
            </Panel>
          ) : null}
        </>
      ) : null}

      {/* From the switcher's own list, so it answers even where the company above refuses to. */}
      <Panel title="Your role in each company" sub="Your permissions are the same everywhere; your role in each company decides whose claims you see and what you may do there." bodyClassName="flex flex-col">
        {orgs.map((o) => (
          <div key={o.id} data-company={o.id} className={cx('flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0', o.id === orgId && 'bg-selection/40')}>
            <b className="min-w-0 flex-1 truncate text-ink">{o.name}</b>
            <span className="w-[50px] shrink-0 font-mono text-[12px] text-ink-3">{o.currency}</span>
            <span className="w-[280px] shrink-0 text-right text-[12.5px] text-ink-2">
              {o.role ? <Pill tone={o.role === 'admin' ? 'blue' : 'grey'}>{o.role}</Pill> : canAct(o) ? 'every act, through the super-admin grant' : 'read only, through consolidated reporting'}
            </span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ── who gets told ────────────────────────────────────────────────────────

/**
 * What this module sends, and to whom — deliberately not switches. The
 * recipients are worked out per event from the approval chain and the
 * company's roles, and nothing reads a stored preference, so a toggle here
 * would change nothing. What earns the screen is the head-count: an event
 * addressed to a role nobody holds is delivered to no one, and nothing else
 * in the product would say so.
 */

const ROLE_ICON: Record<(typeof ROLE_WORDS)[number][0], string> = { admin: 'shield-check', finance: 'landmark', approver: 'badge-check', member: 'users' };

function WhoGetsTold({ orgId }: { orgId: number }) {
  const q = useQuery({ queryKey: KA.events(orgId), queryFn: ({ signal }) => fetchCatalogue(orgId, signal), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Failed error={q.error} what="The notification catalogue" onRetry={() => void q.refetch()} />;
  const c = q.data;
  const silent = silentRoles(c.roles);

  return (
    <div className="flex flex-col gap-3.5">
      <StatGrid min={180}>
        {ROLE_WORDS.map(([k, label]) => (
          <Kpi key={k} label={label} value={c.roles[k]} icon={ROLE_ICON[k]} tone={c.roles[k] === 0 ? 'amber' : 'blue'} />
        ))}
      </StatGrid>
      {silent.length ? (
        <Notice tone="amber">
          Nobody holds {silent.join(', ')} in this organization, so any event below addressed to them is computed and then delivered to no one. That is not an error — it is what an empty role means — but it is the reason a notification somebody expected never arrived.
        </Notice>
      ) : null}
      <Panel title={`${c.events.length} ${c.events.length === 1 ? 'notification' : 'notifications'} this module sends`} bodyClassName="flex flex-col">
        <THead
          cols={[
            ['Event', 230],
            ['When', null],
            ['Who receives it', 230],
          ]}
        />
        {c.events.map((e) => (
          <div key={e.slug} data-event={e.slug} className="flex items-start gap-2.5 border-b border-line/70 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
            <span className="flex w-[230px] shrink-0 flex-col">
              <span className="flex items-center gap-1.5">
                <b className="text-[13px] text-ink">{e.label}</b>
                {e.warning ? <Pill tone="amber">warning</Pill> : null}
              </span>
              <span className="font-mono text-[11px] text-ink-3">{e.slug}</span>
            </span>
            <span className="min-w-0 flex-1 text-ink-2">{e.when}</span>
            <span className="w-[230px] shrink-0 text-ink-2">{e.who}</span>
          </div>
        ))}
      </Panel>
      {c.delivery ? <Notice tone={/not installed/i.test(c.delivery) ? 'amber' : 'grey'}>{c.delivery}</Notice> : null}
      <Notice tone="grey">These are not switchable, and the absence of toggles is deliberate rather than unfinished. Recipients are worked out per event from the approval chain and the roles above, not from stored preferences — so a switch here would write somewhere nothing reads. Muting is done per person in Notification settings, which is where the choice actually belongs.</Notice>
    </div>
  );
}

// ── activity ─────────────────────────────────────────────────────────────

/**
 * Who changed what in this company: claims, approvals, budget changes (the
 * module's own log, not the settings change log). The server shows it to
 * approvers and above, and says so to anybody else.
 */
function Activity({ orgId }: { orgId: number }) {
  const q = useQuery({ queryKey: KA.activity(orgId), queryFn: ({ signal }) => fetchActivity(orgId, signal), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Failed error={q.error} what="The activity log" onRetry={() => void q.refetch()} />;
  const items = q.data;
  return (
    <Panel title="Recent changes" sub="Claims, approvals and budget changes in this organization, newest first. Changes to these settings are in the change log." bodyClassName="flex flex-col">
      {items.length ? (
        <>
          <THead
            cols={[
              ['When', 150],
              ['Who', 150],
              ['What', 190],
              ['Detail', null],
            ]}
          />
          {items.map((r, i) => (
            <div key={i} className={row}>
              <Cell w={150} className="text-[12px] text-ink-3 tabular-nums">
                {dateLabel(r.at)} {timeLabel(r.at)}
              </Cell>
              <Cell w={150}>{r.actor ?? 'the system'}</Cell>
              <Cell w={190} className="font-mono text-[11.5px] text-ink-2">
                {r.entity}.{r.action}
              </Cell>
              <Cell w={null} className="text-ink-2">
                {r.summary}
              </Cell>
            </div>
          ))}
        </>
      ) : (
        <Empty text="Nothing has been changed in this organization yet." />
      )}
    </Panel>
  );
}
