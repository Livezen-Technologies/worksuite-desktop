import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, Kpi, PageHead, Panel, Seg, Sheet } from '../../components/PageKit';
import { minWidth } from '../../components/ListKit';
import { fromCents, problemsOf, shortDate } from '../finance/api';
import { LoadFailed, Notice } from '../../components/RecordKit';
import { can, canAct, money } from './api';
import type { ScreenProps } from './Rail';
import { SubConfirm, SubPill, SubscriptionPanel } from './SubscriptionPanel';
import {
  bumpSubs,
  createSub,
  currencyChoices,
  CYCLES,
  cycleLabel,
  draftProblems,
  fetchBaseCurrency,
  fetchCategories,
  fetchSubs,
  fetchVendorPick,
  inDays,
  matchesTerm,
  mayWriteSub,
  mulTruncate,
  renewalTone,
  renewing,
  scopeWords,
  seedDraft,
  setSubStatus,
  SK,
  subBody,
  summarise,
  updateSub,
  writeOrg,
  type ClaimPreset,
  type CurrencyCost,
  type Draft,
  type EditorMode,
  type Sub,
} from './suppliers';
import { StatGrid } from '../../components/StatCard';
import { clickOnKey } from '../../components/press';

/**
 * Vendor subscriptions: what the company pays for on a cycle, and when each
 * renews.
 *
 * THE SELECTION DECIDES, AND "ALL MY COMPANIES" IS A CHOICE. The list and the
 * figures above it are read for the companies selected in the rail — the
 * server reads no selection as "every company I belong to", which is a filter,
 * not a boundary, and once showed one company's spending under another's
 * name. The consolidated view stays one click away for somebody who works
 * across a group; the Company column says which is which, and a subscription
 * that belongs to no company shows under every one and says so.
 *
 * FILTERED HERE, DELIBERATELY. The endpoint returns every subscription this
 * person may see — the cards above are computed from the whole set — so a
 * search that went back to the server would make the totals and the rows two
 * reads of one question. That holds while a company has tens of these.
 *
 * THE ROW OPENS THE RECORD, NOT THE FORM. Most visits are to look something
 * up, and a form full of inputs is both slower and a way to change something
 * by accident; the record is also the only way somebody with read access can
 * open one.
 */
type ShowWhich = 'mine' | 'all';

export default function Subscriptions({
  org,
  orgId,
  orgs,
  onGo,
  openSub,
  onFile,
}: ScreenProps & {
  openSub: number | null;
  /** Files an expense against a subscription, starting from what it says. Without it the Expenses tab only lists. */
  onFile?: (preset: ClaimPreset, orgId: number) => void;
}) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = can(perms, 'expense.manage');
  const [which, setWhich] = useState<ShowWhich>('mine');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<{ mode: EditorMode; sub?: Sub } | null>(null);
  const [deleting, setDeleting] = useState<Sub | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // '' is every company this person belongs to — the endpoint's own rule.
  const scope = which === 'all' ? '' : org;
  const q = useQuery({ queryKey: SK.list(scope), queryFn: ({ signal }) => fetchSubs(scope, signal), retry: false });
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => all.filter((s) => (!status || s.status === status) && matchesTerm(s, term)), [all, status, term]);
  const sum = useMemo(() => summarise(all), [all]);
  const soon = useMemo(() => renewing(all), [all]);

  const company = orgs.find((o) => o.id === orgId) ?? null;
  // A new subscription is made in one company — the one on screen — and only where this person may act.
  const createIn = manage && company && canAct(company) ? company.id : null;
  const open = (id: number) => onGo('subs', `&sub=${id}`);

  const pause = async (s: Sub, next: 'active' | 'paused') => {
    setBusy(s.id);
    await setSubStatus(qc, s, next, orgId);
    setBusy(null);
  };
  // Subscriptions are listed through membership; a company read only through reporting lists none, and the screen says so rather than looking empty.
  const picked = orgs.filter((o) => org.split(',').includes(String(o.id)));
  const readOnlyOnly = which === 'mine' && picked.length > 0 && picked.every((o) => !o.member);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Vendor subscriptions" sub={`Showing ${scopeWords(which === 'all', org, orgId, orgs)}, and those that belong to every company.`}>
        {org !== '' ? (
          <Seg
            label="Which companies"
            value={which}
            onChange={setWhich}
            options={[
              { id: 'mine', label: orgId !== null ? 'This company' : 'Selected companies' },
              { id: 'all', label: 'All my companies' },
            ]}
          />
        ) : null}
        {manage ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={createIn === null}
            title={createIn === null ? (orgId === null ? 'Choose one company in the switcher: a subscription is added to one.' : 'You can read this company but not change it.') : undefined}
            onClick={() => setEditor({ mode: 'create' })}
          >
            <Icon name="plus" size={14} /> Add subscription
          </button>
        ) : null}
      </PageHead>

      {/* The heading and the choice of companies stay put while another set loads; only what was read for the old set goes. */}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <LoadFailed what="The subscriptions" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <Kpi icon="repeat" tone="blue" label="Active" value={sum.active} />
            <Kpi icon="calendar" tone="violet" label="Monthly cost" value={<Costs costs={sum.costs} pick="monthly" />} sub={sum.costs.length > 1 ? 'One line per currency — not added across them' : undefined} />
            <Kpi icon="calendar-days" tone="cyan" label="Annual cost" value={<Costs costs={sum.costs} pick="annual" />} sub="Twelve months at today’s prices" />
            <Kpi icon="calendar-clock" label="Renewing in 30 days" value={sum.dueSoon} tone={sum.dueSoon ? 'amber' : undefined} sub={sum.overdue ? `${sum.overdue} overdue` : undefined} />
          </StatGrid>

          {soon.length ? (
            <Panel title="Upcoming renewals" sub={sum.overdue ? 'Overdue first: a stated renewal date that has passed without a payment receipt.' : undefined}>
              {soon.map((s) => (
                <RenewalRow key={s.id} s={s} onOpen={() => open(s.id)} />
              ))}
            </Panel>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name, vendor, company…" aria-label="Search subscriptions" className={cx(input, 'h-[32px] w-[260px]')} />
            <Select
              aria-label="Status"
              value={status}
              onValueChange={setStatus}
              className="h-[32px] w-[150px]"
              options={[
                { value: '', label: 'Any status' },
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            {/* Said only when a filter is actually hiding something, so the count is a fact about this screen rather than permanent chrome. */}
            {rows.length !== all.length ? (
              <span className="text-[12.5px] text-ink-3">
                {rows.length} of {all.length}
                <button type="button" className="ml-1.5 font-semibold text-primary hover:underline" onClick={() => (setTerm(''), setStatus(''))}>
                  clear
                </button>
              </span>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
            <div style={{ minWidth: minWidth(220, [140, 130, 120, 140, 140, 90, 132]) }}>
              <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Subscription</span>
                <span className="w-[140px] shrink-0">Cycle</span>
                <span className="w-[130px] shrink-0 text-right">Amount</span>
                <span className="w-[120px] shrink-0 text-right">Per month</span>
                <span className="w-[140px] shrink-0">Next renewal</span>
                <span className="w-[140px] shrink-0">Company</span>
                <span className="w-[90px] shrink-0">Status</span>
                <span className="w-[132px] shrink-0" />
              </div>
              {rows.map((s) => {
                const write = mayWriteSub(s, orgs, manage);
                const meta = [s.vendor, s.category, s.description].filter(Boolean).join(' · ');
                const tone = renewalTone(s.days_until, s.overdue);
                return (
                  <div
                    key={s.id}
                    role="button" tabIndex={0} onKeyDown={clickOnKey} onClick={() => open(s.id)}
                    className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-[13px] last:border-b-0 hover:bg-subtle', s.status !== 'active' && 'opacity-60', openSub === s.id && '!bg-selection !opacity-100')}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <button type="button" className="truncate text-left font-semibold text-ink hover:underline" onClick={(e) => (e.stopPropagation(), open(s.id))}>
                        {s.name}
                      </button>
                      {/* Vendor and category first because they are structured; the note last because it is free text. */}
                      {meta ? (
                        <span className="truncate text-[11.5px] text-ink-3" title={s.description ?? undefined}>
                          {meta}
                        </span>
                      ) : null}
                    </span>
                    <span className="w-[140px] shrink-0 truncate text-[12.5px] text-ink-2">
                      {cycleLabel(s.billing_cycle)}
                      {s.quantity > 1 ? <span className="text-ink-3"> · ×{s.quantity}</span> : null}
                    </span>
                    <span className="w-[130px] shrink-0 text-right tabular-nums text-ink">{money(s.amount, s.currency)}</span>
                    <span className="w-[120px] shrink-0 text-right text-[12.5px] tabular-nums text-ink-2">{money(s.monthly_equiv, s.currency)}</span>
                    {/* A paused or cancelled row computes no renewal at all, so it says so rather than showing a blank that reads as "not known yet". */}
                    <span className="flex w-[140px] shrink-0 flex-col">
                      {s.status === 'active' && s.next_renewal ? (
                        <>
                          <span className={cx('font-semibold', TONE_TEXT[tone])}>{shortDate(s.next_renewal)}</span>
                          <span className="text-[11.5px] text-ink-3">{s.overdue ? 'overdue' : inDays(s.days_until)}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </span>
                    <span className="w-[140px] shrink-0 truncate text-[12.5px]">{s.org ? <span className="text-ink-2">{s.org}</span> : <i className="text-ink-3">Every company</i>}</span>
                    <span className="w-[90px] shrink-0">
                      <SubPill status={s.status} />
                    </span>
                    {/* The write actions gate themselves: a button whose only outcome is a 403 teaches people to distrust the screen. */}
                    <span role="presentation" className="flex w-[132px] shrink-0 justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {write ? (
                        <>
                          <RowAction icon="compose" label={`Edit ${s.name}`} onClick={() => setEditor({ mode: 'edit', sub: s })} />
                          {writeOrg(s, createIn) !== null ? <RowAction icon="copy" label={`Copy ${s.name}`} onClick={() => setEditor({ mode: 'copy', sub: s })} /> : null}
                          {s.status === 'active' ? <RowAction icon="pause" label={`Pause ${s.name}`} disabled={busy === s.id} onClick={() => void pause(s, 'paused')} /> : null}
                          {s.status === 'paused' ? <RowAction icon="play" label={`Resume ${s.name}`} disabled={busy === s.id} onClick={() => void pause(s, 'active')} /> : null}
                          <RowAction icon="trash" label={`Delete ${s.name}`} danger onClick={() => setDeleting(s)} />
                        </>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {!rows.length ? (
                <div className="flex flex-col items-center gap-2 px-3.5 py-8 text-center text-[12.5px] text-ink-3">
                  {all.length ? 'No subscriptions match those filters.' : readOnlyOnly ? 'Subscriptions are listed for companies you belong to. You can read the selected ones through reporting, so there is nothing to list here.' : 'No subscriptions yet.'}
                  {!all.length && createIn !== null ? (
                    <button type="button" className={btn} onClick={() => setEditor({ mode: 'create' })}>
                      Add the first one
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <p className="m-0 text-[12px] text-ink-3">Renewal dates are computed from the billing cycle — always current, never advanced by hand — unless one has been stated on the subscription, or a payment receipt filed against it moved it on.</p>
        </>
      )}

      {openSub !== null ? (
        <SubscriptionPanel
          key={openSub}
          id={openSub}
          seed={all.find((s) => s.id === openSub) ?? null}
          org={org}
          orgId={orgId}
          orgs={orgs}
          manage={manage}
          canCopy={(s) => writeOrg(s, createIn) !== null}
          onClose={() => onGo('subs')}
          onEdit={(s) => setEditor({ mode: 'edit', sub: s })}
          onCopy={(s) => setEditor({ mode: 'copy', sub: s })}
          onGo={onGo}
          onFile={onFile}
        />
      ) : null}
      {editor ? <SubEditor mode={editor.mode} sub={editor.sub} org={org} orgs={orgs} createIn={editor.mode === 'edit' ? null : editor.sub ? writeOrg(editor.sub, createIn) : createIn} onClose={() => setEditor(null)} /> : null}
      {deleting ? <SubConfirm what="delete" sub={deleting} orgId={orgId} onClose={() => setDeleting(null)} onDone={() => (setDeleting(null), openSub === deleting.id ? onGo('subs') : undefined)} /> : null}
    </div>
  );
}

const TONE_TEXT = { red: 'text-danger', amber: 'text-warning-ink dark:text-warning', grey: 'text-ink' } as const;
const TONE_BADGE = {
  red: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
  amber: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  grey: 'bg-subtle text-ink-2',
} as const;

function RowAction({ icon, label, onClick, danger, disabled }: { icon: string; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cx('flex h-[28px] w-[28px] items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle disabled:opacity-40', danger ? 'hover:text-danger' : 'hover:text-ink')}>
      <Icon name={icon} size={14} />
    </button>
  );
}

/** A figure per currency, one to a line. Never one total across currencies. */
function Costs({ costs, pick }: { costs: CurrencyCost[]; pick: 'monthly' | 'annual' }) {
  if (!costs.length) return <span className="text-ink-3">—</span>;
  return (
    <span className={cx('flex flex-col', costs.length > 1 && 'text-[15px] leading-snug')}>
      {costs.map((c) => (
        <span key={c.currency}>{money(fromCents(c[pick]), c.currency)}</span>
      ))}
    </span>
  );
}

/**
 * One renewal. URGENCY IS A SHAPE, NOT ONLY A COLOUR: the days sit in a
 * filled badge leading the row, so they read before the words beside it and
 * without telling red from orange. The row opens the subscription — the one
 * screen saying a renewal is imminent must be one somebody can act from.
 */
function RenewalRow({ s, onOpen }: { s: Sub; onOpen: () => void }) {
  const d = s.days_until ?? 0;
  const tone = renewalTone(s.days_until, s.overdue);
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-subtle">
      <span className={cx('flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-[10px] text-center', TONE_BADGE[tone])}>
        <b className="text-[13px] leading-none tabular-nums">{Math.abs(d)}</b>
        <span className="mt-0.5 text-[9px] font-semibold tracking-wide uppercase">{s.overdue ? 'late' : d === 0 ? 'today' : d === 1 ? 'day' : 'days'}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px] text-ink">{s.name}</b>
        <span className="truncate text-[12px] text-ink-3">
          {[s.vendor, cycleLabel(s.billing_cycle), s.next_renewal ? (s.overdue ? `was due ${shortDate(s.next_renewal)}` : `${shortDate(s.next_renewal)}, ${inDays(s.days_until)}`) : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <b className="text-[13px] tabular-nums text-ink">{money(s.charge, s.currency)}</b>
        {/* The thing a number cannot say: whether somebody has to act before the date, or whether it happens by itself. */}
        <span className={cx('text-[11.5px]', s.auto_renew ? 'text-ink-3' : 'text-warning-ink dark:text-warning')}>{s.auto_renew ? 'renews automatically' : 'will not auto-renew'}</span>
      </span>
      <Icon name="chevron-right" size={15} className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
    </button>
  );
}

// ── the form ─────────────────────────────────────────────────────────────

/**
 * One form for adding, editing and copying a subscription. A copy does NOT
 * duplicate on the server: subscriptions are told apart by name, so the name
 * arrives suffixed and the person confirms it — the only moment they can say
 * what the copy is for. The company is never a field here: a new one is made
 * in the company on screen, and Move changes it.
 */
function SubEditor({ mode, sub, org, orgs, createIn, onClose }: { mode: EditorMode; sub?: Sub; org: string; orgs: ScreenProps['orgs']; createIn: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = mode === 'edit';
  const catOrg = editing && sub?.org_id ? String(sub.org_id) : createIn ? String(createIn) : org;
  const baseQ = useQuery({ queryKey: SK.base(org), queryFn: ({ signal }) => fetchBaseCurrency(signal), retry: false, staleTime: 300_000 });
  const vendorsQ = useQuery({ queryKey: SK.vendorPick(org), queryFn: ({ signal }) => fetchVendorPick(signal), retry: false });
  const catsQ = useQuery({ queryKey: SK.categories(catOrg), queryFn: ({ signal }) => fetchCategories(catOrg, signal), retry: false });
  // The row is the seed, ids included: an empty picker is indistinguishable from "none chosen", and saving it would detach the vendor.
  const [d, setD] = useState<Draft>(() => seedDraft(sub, mode, todayInZone()));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  if (baseQ.isLoading) return null;
  // Without the configured currency the form cannot tell a foreign amount from a local one; it is the web's own fallback.
  const base = baseQ.data ?? 'LKR';
  const currency = d.currency || base;
  const foreign = currency !== base;
  const problems = draftProblems({ ...d, currency }, base);
  const computed = foreign ? mulTruncate(d.amount, d.rate) : null;
  const vendors = vendorsQ.data ?? [];
  const cats = catsQ.data ?? [];
  const into = createIn !== null ? (orgs.find((o) => o.id === createIn)?.name ?? 'this company') : null;

  const save = async () => {
    setBusy(true);
    setSaid([]);
    const body = subBody({ ...d, currency }, mode, base);
    try {
      if (editing && sub) {
        await updateSub(sub.id, body, writeOrg(sub, null));
        toast('success', 'Subscription updated.');
      } else if (createIn !== null) {
        await createSub(createIn, body);
        toast('success', mode === 'copy' ? 'Copy created.' : 'Subscription added.');
      }
      void bumpSubs(qc);
      onClose();
    } catch (e) {
      // The server's sentences, all of them, under the form that caused them.
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  const optional = (label: string, extra?: ReactNode) => (
    <span>
      {label} <span className="font-medium text-ink-3">— {extra ?? 'optional'}</span>
    </span>
  );

  return (
    <Sheet
      title={editing ? 'Edit subscription' : mode === 'copy' ? 'Copy subscription' : 'Add subscription'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-ink-3">{problems[0] ?? ''}</span>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || problems.length > 0 || (!editing && createIn === null)} onClick={() => void save()}>
            {busy ? 'Saving…' : editing ? 'Save' : mode === 'copy' ? 'Create copy' : 'Add'}
          </button>
        </>
      }
    >
      {mode === 'copy' && sub ? (
        <p className="m-0 text-[12.5px] text-ink-2">
          Starting from <b className="text-ink">{sub.name}</b>. Give it a name of its own — two subscriptions with one name cannot be told apart on a later import.
        </p>
      ) : null}
      {/* Said, because the form has no company field: a new one lands in the company on screen, and Move is how it changes. */}
      {into ? (
        <p className="m-0 text-[12.5px] text-ink-3">
          It will be added to <b className="text-ink-2">{into}</b>.
        </p>
      ) : null}
      <Field label="Name">
        <input autoFocus value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Microsoft 365" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Billing cycle">
          <Select aria-label="Billing cycle" value={d.cycle} onValueChange={(v) => set({ cycle: v })} className="w-full" options={CYCLES} />
        </Field>
        <Field label="Start date">
          <input type="date" value={d.start} onChange={(e) => set({ start: e.target.value })} className={input} />
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_112px_84px] gap-3">
        <Field label="Amount per cycle" hint={Number(d.qty) > 1 ? 'Per unit — the cycle costs this times the quantity.' : undefined}>
          <input value={d.amount} inputMode="decimal" placeholder="0.00" onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.,]/g, '') })} className={cx(input, 'text-right tabular-nums')} />
        </Field>
        <Field label="Currency">
          <Select
            aria-label="Currency"
            value={currency}
            onValueChange={(v) => set(v === base ? { currency: v, rate: '', baseOverride: '' } : { currency: v })}
            className="w-full"
            options={currencyChoices(base, sub?.currency).map((c) => ({ value: c, label: c }))}
          />
        </Field>
        <Field label="Qty">
          <input value={d.qty} inputMode="numeric" onChange={(e) => set({ qty: e.target.value.replace(/[^0-9]/g, '') })} className={cx(input, 'text-right tabular-nums')} />
        </Field>
      </div>
      {foreign ? (
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-ground px-3.5 py-3">
          <Field label={optional('Exchange rate', `1 ${currency} = ? ${base}`)}>
            <input value={d.rate} inputMode="decimal" placeholder="e.g. 305" onChange={(e) => set({ rate: e.target.value.replace(/[^0-9.]/g, '') })} className={input} />
          </Field>
          <Field label={optional(`${base} amount`, 'optional override')}>
            <input value={d.baseOverride} inputMode="decimal" placeholder={computed ?? 'worked out from the rate'} onChange={(e) => set({ baseOverride: e.target.value.replace(/[^0-9.,]/g, '') })} className={input} />
          </Field>
          <span className="text-[12px] text-ink-3">
            {d.baseOverride.trim() ? (
              <>
                Stored as <b className="text-ink-2">{money(d.baseOverride.replace(/,/g, ''), base)}</b> (entered by hand).
              </>
            ) : computed !== null ? (
              <>
                Stored as <b className="text-ink-2">{money(computed, base)}</b> at this rate.
              </>
            ) : (
              'The base-currency value is computed from the rate, or enter it directly.'
            )}
          </span>
        </div>
      ) : null}
      {/*
        The attached vendor is offered even when the picklist lacks it: the
        picklist holds ACTIVE vendors only, so a subscription attached to an
        archived one showed its name in the row and "None" here — and saving
        silently detached it.
      */}
      {vendors.length || sub?.vendor_id ? (
        <Field label={optional('Vendor')}>
          <Select
            aria-label="Vendor"
            searchable
            value={d.vendorId}
            onValueChange={(v) => set({ vendorId: v })}
            className="w-full"
            options={[
              { value: '', label: 'None' },
              ...vendors.map((v) => ({ value: String(v.id), label: v.name })),
              ...(sub?.vendor_id && !vendors.some((v) => v.id === sub.vendor_id) ? [{ value: String(sub.vendor_id), label: `${sub.vendor ?? 'Attached vendor'} (archived)` }] : []),
            ]}
          />
        </Field>
      ) : null}
      <Field label={optional('Category')}>
        <Select
          aria-label="Category"
          value={d.categoryId}
          onValueChange={(v) => set({ categoryId: v })}
          className="w-full"
          options={[
            { value: '', label: 'None' },
            ...cats.map((c) => ({ value: String(c.id), label: c.name })),
            ...(sub?.category_id && !cats.some((c) => c.id === sub.category_id) ? [{ value: String(sub.category_id), label: `${sub.category ?? 'Attached category'} (archived)` }] : []),
          ]}
        />
      </Field>
      {/* The only place an end date can be set or cleared — a subscription that should stop renewing needs somewhere to be told. */}
      <Field label={optional('Ends on', 'optional, nothing renews after this')}>
        <input type="date" value={d.end} min={d.start || undefined} onChange={(e) => set({ end: e.target.value })} className={input} />
      </Field>
      <Field label={optional('Note')}>
        <input value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. which company it belongs to" className={input} />
      </Field>
      {said.length ? (
        <Notice tone="red">
          {said.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Notice>
      ) : null}
    </Sheet>
  );
}

