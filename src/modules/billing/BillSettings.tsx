import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ModuleSettingsForm } from '../../components/ModuleSettingsForm';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Panel, Sheet } from '../hr/parts';
import { can, K, METHODS, useBillingOrgs } from './api';
import {
  addRate,
  addTax,
  fetchAllTaxes,
  fetchBillingAccess,
  fetchCurrencies,
  fetchModes,
  fetchRates,
  KB,
  makeBase,
  removeCurrency,
  removeMode,
  removeRate,
  retireTax,
  saveCurrency,
  saveMode,
  updateTax,
  type CurrencyRow,
  type Mode,
} from './more';
import { Checkbox } from '../../components/Checkbox';
import { Reminders, Templates } from './SettingsComms';
import { Crm, Gateways, Members, Woo } from './SettingsNative';

/**
 * Billing settings (BillSettings, BillSettingsSheet): numbering, money,
 * letterhead and branding (per company, from the server's own field list),
 * tax rates, exchange rates, payment modes and currencies, and what the
 * company picker narrows — and, natively since SRS-BIL-001 G-37, payment
 * gateways, the CRM connector, WooCommerce stores and members (their
 * credentials write-only), payment reminders and message templates.
 * Changing any of it needs `billing.settings`.
 */
type Section = 'general' | 'taxes' | 'rates' | 'modes' | 'currencies' | 'access' | 'gateways' | 'reminders' | 'templates' | 'crm' | 'woo' | 'members';
const NAV: Array<{ id: Section; label: string; native: boolean; group?: string }> = [
  { id: 'general', label: 'General', native: true },
  { id: 'taxes', label: 'Tax rates', native: true },
  { id: 'rates', label: 'Exchange rates', native: true },
  { id: 'modes', label: 'Payment modes', native: true },
  { id: 'currencies', label: 'Currencies', native: true },
  { id: 'gateways', label: 'Payment gateways', native: true, group: 'Getting paid' },
  { id: 'reminders', label: 'Payment reminders', native: true },
  { id: 'templates', label: 'Message templates', native: true },
  { id: 'crm', label: 'CRM connector', native: true, group: 'Connections' },
  { id: 'woo', label: 'WooCommerce stores', native: true },
  { id: 'members', label: 'Members', native: true, group: 'People' },
  { id: 'access', label: 'Data access', native: true },
];

/** The sections whose settings belong to one company: the company chooser shows above them. */
const PER_COMPANY = new Set<Section>(['general', 'modes', 'gateways', 'reminders', 'templates']);

export default function BillSettings({ org }: { org: string }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const may = can(perms, 'billing.settings');
  const orgs = useBillingOrgs();
  const [section, setSection] = useState<Section>('general');
  const [company, setCompany] = useState(/^\d+$/.test(org) ? org : '');
  const onlyOrg = (orgs.data ?? []).length === 1 ? String(orgs.data![0]!.id) : '';
  const whose = company || onlyOrg;
  const whoseName = orgs.data?.find((o) => String(o.id) === whose)?.name;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Settings" sub={`Billing${whoseName ? ` · ${whoseName}` : ''}`} />
      <div className="flex items-start gap-3.5">
        <nav aria-label="Settings sections" className="flex w-[200px] shrink-0 flex-col gap-0.5">
          {NAV.map((n) => {
            const on = n.native && section === n.id;
            return [
              n.group ? (
                <span key={`${n.id}-group`} className="mt-2.5 mb-0.5 px-2.5 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">
                  {n.group}
                </span>
              ) : null,
              <button
                key={n.id}
                type="button"
                aria-current={on ? 'page' : undefined}
                title={n.native ? n.label : `${n.label} — opens in your browser`}
                onClick={() => (n.native ? setSection(n.id as Section) : void call('app:openInBrowser', { path: '/billing' }))}
                className={cx('flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', on ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
              >
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                {n.native ? null : <Icon name="external" size={12} className="shrink-0 text-ink-3" />}
              </button>,
            ];
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {PER_COMPANY.has(section) && (orgs.data ?? []).length > 1 ? (
            <Field label="Company" hint={section === 'general' ? 'These settings can differ per company: numbering, letterhead, terms.' : 'These settings are per company.'}>
              <Select<string>
                aria-label="Settings company"
                searchable
                value={company}
                onValueChange={setCompany}
                placeholder="Choose the company"
                options={(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
                className={input + ' !w-[300px]'}
              />
            </Field>
          ) : null}
          {section === 'general' ? (
            <>
              {whose || !(orgs.data ?? []).length ? (
                <ModuleSettingsForm
                  key={whose}
                  slug="billing"
                  section="general"
                  org={whose || undefined}
                  queryKey={KB.moduleSettings(whose)}
                  note={whoseName ? `For ${whoseName}. The base currency is the installation's.` : 'For the whole installation.'}
                  readOnly="You can read these settings; changing them needs Billing settings."
                  custom={{
                    logo_file_id: ({ value }) => (
                      <span className="flex h-[34px] items-center gap-2 text-[12.5px] text-ink-2">
                        {value ? `A file from Files (#${value})` : 'No logo'}
                        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: '/billing' })}>
                          Choose in the browser
                        </button>
                      </span>
                    ),
                    accent_colour: ({ value, onChange, disabled, label }) => (
                      <span className="flex items-center gap-2">
                        <input type="color" aria-label={`${label} picker`} disabled={disabled} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#1d4ed8'} onChange={(e) => onChange(e.target.value)} className="h-[34px] w-[44px] cursor-pointer rounded-[8px] border border-line bg-surface p-1" />
                        <input aria-label={label} disabled={disabled} value={value} placeholder="#1d4ed8" onChange={(e) => onChange(e.target.value)} className={input + ' !w-[120px] font-mono'} />
                      </span>
                    ),
                  }}
                />
              ) : (
                <Empty text="Choose a company to see its settings." />
              )}
            </>
          ) : null}
          {section === 'taxes' ? <Taxes may={may} /> : null}
          {section === 'rates' ? <Rates may={may} /> : null}
          {section === 'modes' ? <Modes may={may} org={whose} /> : null}
          {section === 'currencies' ? <Currencies may={may} /> : null}
          {section === 'access' ? <Access /> : null}
          {section === 'gateways' ? <Gateways may={may} org={whose} orgs={orgs.data ?? []} /> : null}
          {section === 'reminders' ? <Reminders may={may} org={whose} /> : null}
          {section === 'templates' ? <Templates may={may} org={whose} /> : null}
          {section === 'crm' ? <Crm may={may} orgs={orgs.data ?? []} /> : null}
          {section === 'woo' ? <Woo may={may} orgs={orgs.data ?? []} /> : null}
          {section === 'members' ? <Members org={whose} orgs={orgs.data ?? []} /> : null}
        </div>
      </div>
    </div>
  );
}

function useRun() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      after?.();
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Taxes({ may }: { may: boolean }) {
  const q = useQuery({ queryKey: KB.allTaxes, queryFn: ({ signal }) => fetchAllTaxes(signal) });
  const { busy, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', code: '', rate: '', kind: 'sales' as 'sales' | 'withholding', is_compound: false, is_default: false });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  return (
    <Panel
      title="Tax rates"
      sub="A retired rate stays on the invoices that used it, and is no longer offered."
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setAdding(true)}>
            + Add a tax rate
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {rows.length ? (
        rows.map((t) => (
          <div key={t.id} data-tax={t.name} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0', !t.active && 'opacity-60')}>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <b className="truncate text-ink">{t.name}</b>
              {t.is_compound ? <span className="rounded-[8px] bg-subtle px-1.5 text-[11px] font-semibold text-ink-2">compound</span> : null}
              {t.is_default && t.active ? <span className="rounded-[8px] bg-selection px-1.5 text-[11px] font-semibold text-primary">every invoice</span> : null}
              {!t.active ? <span className="rounded-[8px] bg-subtle px-1.5 text-[11px] font-semibold text-ink-3">retired</span> : null}
            </span>
            <span className="w-[70px] shrink-0 font-mono text-ink-2">{t.code ?? '—'}</span>
            <span className="w-[60px] shrink-0 text-right text-ink tabular-nums">{Number(t.rate)}%</span>
            <span className="w-[100px] shrink-0 text-ink-2">{t.kind === 'withholding' ? 'Withholding' : 'Sales'}</span>
            <span className="w-[80px] shrink-0 text-right">
              {may ? (
                t.active ? (
                  <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void run(() => retireTax(t.id), `${t.name} retired.`)}>
                    Retire
                  </button>
                ) : (
                  <button type="button" className="font-semibold text-primary hover:underline" disabled={busy} onClick={() => void run(() => updateTax(t.id, { active: true }), `${t.name} is offered again.`)}>
                    Bring back
                  </button>
                )
              ) : null}
            </span>
          </div>
        ))
      ) : (
        <Empty text="No tax rates. Invoices carry no tax until one is added." />
      )}
      {adding ? (
        <Sheet
          title="Add a tax rate"
          width={440}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !f.name.trim() || !(Number(f.rate) >= 0 && Number(f.rate) <= 100) || f.rate === ''}
                onClick={() => void run(() => addTax({ name: f.name.trim(), ...(f.code.trim() ? { code: f.code.trim() } : {}), rate: Number(f.rate), kind: f.kind, is_compound: f.kind === 'sales' && f.is_compound, is_default: f.kind === 'withholding' && f.is_default }), 'Tax rate added.', () => setAdding(false))}
              >
                Add rate
              </button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Name">
              <input aria-label="Name" value={f.name} placeholder="VAT" onChange={(e) => setF({ ...f, name: e.target.value })} className={input} />
            </Field>
            <Field label="Code">
              <input aria-label="Code" value={f.code} placeholder="VAT" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} className={input + ' font-mono'} />
            </Field>
            <Field label="Rate %">
              <input aria-label="Rate %" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={input} />
            </Field>
            <Field label="Kind">
              <Select<'sales' | 'withholding'>
                aria-label="Kind"
                value={f.kind}
                onValueChange={(v) => setF({ ...f, kind: v })}
                options={[
                  { value: 'sales', label: 'Sales tax' },
                  { value: 'withholding', label: 'Withholding tax' },
                ]}
                className={input}
              />
            </Field>
          </div>
          {f.kind === 'sales' ? (
            <label className="flex items-start gap-2 text-[12.5px] text-ink">
              <Checkbox checked={f.is_compound} onChange={(e) => setF({ ...f, is_compound: e.target.checked })} className="mt-0.5" />
              <span>
                <b>Compound</b>
                <span className="block text-ink-3">Charged on the line plus the simple taxes on it.</span>
              </span>
            </label>
          ) : (
            <label className="flex items-start gap-2 text-[12.5px] text-ink">
              <Checkbox checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} className="mt-0.5" />
              <span>
                <b>Apply to every invoice</b>
                <span className="block text-ink-3">Withheld from each invoice's total by the customer.</span>
              </span>
            </label>
          )}
        </Sheet>
      ) : null}
    </Panel>
  );
}

function Rates({ may }: { may: boolean }) {
  const q = useQuery({ queryKey: KB.rates, queryFn: ({ signal }) => fetchRates(signal) });
  const { busy, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ currency: '', rate: '', on: todayInZone() });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const base = d.base_currency;
  return (
    <Panel
      title="Exchange rates"
      sub={`What one unit of each currency is worth in ${base}. Rates are never fetched automatically; an invoice in a currency with no rate is refused.`}
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setAdding(true)}>
            + Record a rate
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {Object.keys(d.latest).length ? (
        <div className="flex flex-wrap gap-2 border-b border-line px-3.5 py-2.5">
          {Object.entries(d.latest).map(([cur, rate]) => (
            <span key={cur} className="rounded-[8px] bg-subtle px-2.5 py-1 text-[12.5px] text-ink">
              <b>1 {cur}</b> = <span className="tabular-nums">{rate}</span> {base}
            </span>
          ))}
        </div>
      ) : null}
      {d.history.length ? (
        d.history.slice(0, 60).map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
            <b className="w-[60px] shrink-0 text-ink">{r.currency}</b>
            <span className="min-w-0 flex-1 text-ink">
              1 {r.currency} = <span className="tabular-nums">{r.rate}</span> {base}
            </span>
            <span className="w-[140px] shrink-0 text-ink-2">from {dateLabel(r.effective_on)}</span>
            <span className="w-[120px] shrink-0 truncate text-ink-3">{r.entered_by ?? r.source ?? ''}</span>
            {may ? (
              <button type="button" aria-label={`Remove the ${r.currency} rate from ${r.effective_on}`} title="Remove" className="flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger-bg" disabled={busy} onClick={() => void run(() => removeRate(r.id), 'Rate removed.')}>
                <Icon name="x" size={13} />
              </button>
            ) : null}
          </div>
        ))
      ) : (
        <Empty text={`Only ${base} can be invoiced until a rate is recorded.`} />
      )}
      {adding ? (
        <Sheet
          title="Record an exchange rate"
          width={440}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !/^[A-Z]{3}$/.test(f.currency) || f.currency === base || !(Number(f.rate) > 0)}
                onClick={() =>
                  void run(
                    async () => {
                      const r = await addRate({ currency: f.currency, rate: Number(f.rate), effective_on: f.on });
                      if (r.message) toast('success', r.message);
                    },
                    'Rate recorded.',
                    () => setAdding(false),
                  )
                }
              >
                Record
              </button>
            </>
          }
        >
          <Field label="Currency" hint="Three-letter code, e.g. USD">
            <input aria-label="Currency" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className={input + ' font-mono'} />
          </Field>
          <Field label={`Rate — 1 ${f.currency || 'unit'} equals, in ${base}`} hint="Or the rate your bank actually used">
            <input aria-label="Rate" inputMode="decimal" value={f.rate} placeholder={f.currency === 'USD' && base === 'LKR' ? '300' : ''} onChange={(e) => setF({ ...f, rate: e.target.value })} className={input + ' tabular-nums'} />
          </Field>
          {Number(f.rate) > 0 && f.currency ? (
            <p className="m-0 text-[12.5px] text-ink-2">
              So 100 {f.currency} is {(100 * Number(f.rate)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {base}.
            </p>
          ) : null}
          <Field label="Effective from" hint="Invoices dated on or after this use this rate">
            <input aria-label="Effective from" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} className={input} />
          </Field>
        </Sheet>
      ) : null}
    </Panel>
  );
}

const MODE_KIND = (k: string) => (k === 'offset' ? 'Offset against a bill' : (METHODS.find((m) => m.id === k)?.label ?? k));

function Modes({ may, org }: { may: boolean; org: string }) {
  const q = useQuery({ queryKey: KB.modes(org), queryFn: ({ signal }) => fetchModes(org, signal) });
  const { busy, run } = useRun();
  const [editing, setEditing] = useState<Partial<Mode> | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  return (
    <Panel
      title="Payment modes"
      sub="The ways a customer can pay, as printed on invoices"
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setEditing({ name: '', kind: 'bank_transfer', instructions: '', is_active: true })}>
            + New payment mode
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {rows.length ? (
        rows.map((m) => (
          <div key={m.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0', !m.is_active && 'opacity-60')}>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{m.name}</b>
              <span className="truncate text-[11.5px] text-ink-3">{m.shared ? 'every company' : 'this company'}{m.instructions ? ` · ${m.instructions}` : ''}</span>
            </span>
            <span className="w-[150px] shrink-0 text-ink-2">{MODE_KIND(m.kind)}</span>
            <span className="w-[60px] shrink-0 text-right text-ink-2 tabular-nums">{m.payments}</span>
            <span className="w-[70px] shrink-0 text-ink-2">{m.is_active ? 'Active' : 'Inactive'}</span>
            <span className="w-[110px] shrink-0 text-right">
              {may ? (
                <>
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing(m)}>
                    Edit
                  </button>
                  <span className="text-ink-3"> · </span>
                  <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void run(() => removeMode(m.id), `${m.name} removed.`)}>
                    Remove
                  </button>
                </>
              ) : null}
            </span>
          </div>
        ))
      ) : (
        <Empty text="No payment modes yet." />
      )}
      {editing ? (
        <Sheet
          title={editing.id ? `Edit ${editing.name}` : 'New payment mode'}
          width={460}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy || !editing.name?.trim()} onClick={() => void run(() => saveMode({ ...editing, name: editing.name!.trim() }, org), 'Saved.', () => setEditing(null))}>
                Save
              </button>
            </>
          }
        >
          <Field label="Name">
            <input aria-label="Name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} />
          </Field>
          <Field label="Kind" hint={editing.id && (editing.payments ?? 0) > 0 ? 'Fixed: payments have been recorded against it.' : undefined}>
            <Select<string> aria-label="Kind" disabled={!!editing.id && (editing.payments ?? 0) > 0} value={editing.kind ?? 'bank_transfer'} onValueChange={(v) => setEditing({ ...editing, kind: v })} options={[...METHODS, { id: 'offset', label: 'Offset' }].map((m) => ({ value: m.id, label: MODE_KIND(m.id) }))} className={input} />
          </Field>
          <Field label="Instructions" hint="Printed on the invoice: account number, where to send a cheque…">
            <textarea aria-label="Instructions" value={editing.instructions ?? ''} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} className={input + ' !h-[64px] resize-none py-2'} />
          </Field>
          <label className="flex items-center gap-2 font-semibold text-ink">
            <Checkbox checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
            Active
          </label>
        </Sheet>
      ) : null}
    </Panel>
  );
}

function Currencies({ may }: { may: boolean }) {
  const q = useQuery({ queryKey: KB.currencies, queryFn: ({ signal }) => fetchCurrencies(signal) });
  const { busy, run } = useRun();
  const [editing, setEditing] = useState<Partial<CurrencyRow> | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <Panel
      title="Currencies"
      sub={d.base_locked ?? `${d.base} is the base currency.`}
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setEditing({ code: '', name: '', symbol: '', decimals: 2, is_active: true })}>
            + New currency
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {d.rows.map((c) => (
        <div key={c.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0', !c.is_active && 'opacity-60')}>
          <b className="w-[60px] shrink-0 font-mono text-ink">{c.code}</b>
          <span className="min-w-0 flex-1 truncate text-ink">
            {c.name}
            {c.is_base ? <span className="ml-1.5 rounded-[8px] bg-selection px-1.5 text-[11px] font-semibold text-primary">base</span> : null}
          </span>
          <span className="w-[50px] shrink-0 text-ink-2">{c.symbol ?? '—'}</span>
          <span className="w-[90px] shrink-0 text-right text-ink-2 tabular-nums">{c.documents}</span>
          <span className="w-[70px] shrink-0 text-ink-2">{c.is_active ? 'Active' : 'Inactive'}</span>
          <span className="w-[170px] shrink-0 text-right">
            {may ? (
              <>
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing(c)}>
                  Edit
                </button>
                {!c.is_base && !d.base_locked ? (
                  <>
                    <span className="text-ink-3"> · </span>
                    <button type="button" className="font-semibold text-primary hover:underline" disabled={busy} onClick={() => void run(() => makeBase(c.id), `${c.code} is the base currency.`)}>
                      Make base
                    </button>
                  </>
                ) : null}
                {!c.is_base && !c.documents ? (
                  <>
                    <span className="text-ink-3"> · </span>
                    <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void run(() => removeCurrency(c.id), `${c.code} removed.`)}>
                      Remove
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </span>
        </div>
      ))}
      {editing ? (
        <Sheet
          title={editing.id ? `Edit ${editing.code}` : 'New currency'}
          width={440}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy || !/^[A-Z]{3}$/.test(editing.code ?? '') || !editing.name?.trim()} onClick={() => void run(() => saveCurrency(editing), 'Saved.', () => setEditing(null))}>
                Save
              </button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Code" hint={editing.id && (editing.documents ?? 0) > 0 ? 'Fixed: documents use it.' : 'Three letters'}>
              <input aria-label="Code" disabled={!!editing.id && (editing.documents ?? 0) > 0} maxLength={3} value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className={input + ' font-mono'} />
            </Field>
            <Field label="Symbol">
              <input aria-label="Symbol" value={editing.symbol ?? ''} onChange={(e) => setEditing({ ...editing, symbol: e.target.value })} className={input} />
            </Field>
            <Field label="Name" className="col-span-2">
              <input aria-label="Name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} />
            </Field>
            <Field label="Decimals">
              <input aria-label="Decimals" type="number" min={0} max={4} value={editing.decimals ?? 2} onChange={(e) => setEditing({ ...editing, decimals: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} className={input} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 font-semibold text-ink">
              <Checkbox checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              Active
            </label>
          </div>
        </Sheet>
      ) : null}
    </Panel>
  );
}

function Access() {
  const q = useQuery({ queryKey: KB.access, queryFn: ({ signal }) => fetchBillingAccess(signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data!;
  const unassigned = Object.entries(a.unassigned ?? {}).filter(([, n]) => Number(n) > 0);
  return (
    <>
      {a.why ? <p className="m-0 text-[13px] text-ink-2">{a.why}</p> : null}
      {a.boundary_note ? <p className="m-0 rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">{a.boundary_note}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="Narrowed by the company picker" bodyClassName="flex flex-col gap-1 px-3.5 py-3">
          {a.scoped.map((x) => (
            <span key={x} className="flex gap-2 text-[12.5px] text-ink">
              <Icon name="check" size={14} className="mt-0.5 shrink-0 text-success" />
              {x}
            </span>
          ))}
        </Panel>
        <Panel title="Not narrowed" bodyClassName="flex flex-col gap-1 px-3.5 py-3">
          {a.unscoped.length ? (
            a.unscoped.map((x) => (
              <span key={x} className="flex gap-2 text-[12.5px] text-ink-2">
                <Icon name="minus" size={14} className="mt-0.5 shrink-0 text-ink-3" />
                {x}
              </span>
            ))
          ) : (
            <span className="text-[12.5px] text-ink-3">Everything is narrowed.</span>
          )}
        </Panel>
      </div>
      {a.companies.length ? (
        <Panel title="Companies you work in" bodyClassName="flex flex-wrap gap-1.5 px-3.5 py-3">
          {a.companies.map((c) => (
            <span key={c.id} className="rounded-[8px] bg-subtle px-2.5 py-1 text-[12.5px] font-semibold text-ink">
              {c.name}
              {c.role ? <span className="font-medium text-ink-3"> · {c.role}</span> : null}
            </span>
          ))}
        </Panel>
      ) : null}
      {unassigned.length ? (
        <Panel title="Belonging to no company" sub="Shown under every company." bodyClassName="flex flex-col gap-1 px-3.5 py-3">
          {unassigned.map(([what, n]) => (
            <span key={what} className="text-[12.5px] text-ink">
              <b className="tabular-nums">{Number(n).toLocaleString()}</b> {what.replace(/_/g, ' ')}
            </span>
          ))}
        </Panel>
      ) : null}
      {a.permissions?.length ? (
        <Panel title="Your Billing permissions" bodyClassName="flex flex-col">
          {a.permissions.map((p) => (
            <div key={p.slug} data-permission={p.slug} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', p.held ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>
                <Icon name={p.held ? 'check' : 'minus'} size={13} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-ink">{p.name}</b>
                <span className="font-mono text-[11.5px] text-ink-3">{p.slug}</span>
              </span>
              <span className="text-[12px] text-ink-3">{p.held ? (p.via ? `through ${p.via}` : 'Granted') : 'Not granted'}</span>
            </div>
          ))}
        </Panel>
      ) : null}
    </>
  );
}
