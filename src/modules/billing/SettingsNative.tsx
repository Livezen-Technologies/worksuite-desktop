import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Panel, Sheet } from '../hr/parts';
import {
  addCrm,
  addMember,
  addWoo,
  CAPABILITY_LABEL,
  createGateway,
  credentialsPayload,
  fetchCatalogue,
  fetchCrm,
  fetchGateways,
  fetchMembers,
  fetchWoo,
  findAssignable,
  initialCredentials,
  KA,
  missingFields,
  mintWooSecret,
  removeCrm,
  removeGateway,
  removeMember,
  removeWoo,
  ROLE_LABEL,
  secretsPatch,
  testCrm,
  testGateway,
  testWoo,
  updateCrm,
  updateGateway,
  updateWoo,
  type CredentialField,
  type GatewayAccount,
  type GatewayCapabilities,
  type GatewayKind,
} from './admin';
import { K } from './api';

/**
 * Billing's settings that used to open in the browser (G-37), drawn here:
 * online payment gateways (W14), the Perfex CRM connector, WooCommerce stores
 * and company members. Credentials are write-only — a secret's box starts
 * empty and shows only the server's masked hint beside it; leaving it empty
 * keeps what is stored. Changing any of it needs `billing.settings`.
 */

type Orgs = Array<{ id: number; name: string }>;

function useAct() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const act = async <T,>(fn: () => Promise<T>, done: string | null | ((r: T) => string | null), after?: (r: T) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      const said = typeof done === 'function' ? done(r) : done;
      if (said) toast('success', said);
      after?.(r);
      void qc.invalidateQueries({ queryKey: K.all });
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

/** The server's sentence about a write, when `request` gave one. */
const said = (fallback: string) => (r: unknown) => (r && typeof r === 'object' && 'message' in r && typeof (r as { message?: unknown }).message === 'string' ? (r as { message: string }).message : fallback);

/** A secret's box: always empty to start, the stored hint beside it, typed text never echoed back. */
export function SecretInput({ label, hint, value, onChange, disabled }: { label: string; hint: string | null | undefined; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint ? `Saved (${hint}). Leave empty to keep it; type to replace it.` : 'Not set yet.'}>
      <input aria-label={label} type="password" autoComplete="new-password" spellCheck={false} disabled={disabled} value={value} placeholder={hint ? '••••••••' : ''} onChange={(e) => onChange(e.target.value)} className={input + ' font-mono'} />
    </Field>
  );
}

const capsOf = (k: GatewayKind) => (Object.keys(CAPABILITY_LABEL) as Array<keyof GatewayCapabilities>).filter((c) => k.capabilities[c]);

// ── gateways ────────────────────────────────────────────────────────────

export function Gateways({ may, org, orgs }: { may: boolean; org: string; orgs: Orgs }) {
  const cat = useQuery({ queryKey: KA.catalogue, queryFn: ({ signal }) => fetchCatalogue(signal), staleTime: 600_000 });
  const accounts = useQuery({ queryKey: KA.gateways(org), queryFn: ({ signal }) => fetchGateways(org, signal) });
  const { busy, act } = useAct();
  const [editing, setEditing] = useState<{ kind: GatewayKind; account: GatewayAccount | null } | null>(null);
  const [tested, setTested] = useState<Record<number, { ok: boolean; message: string }>>({});
  if (cat.isLoading || accounts.isLoading) return <Spinner />;
  if (cat.error) return <ErrorNote error={cat.error} onRetry={() => void cat.refetch()} />;
  if (accounts.error) return <ErrorNote error={accounts.error} onRetry={() => void accounts.refetch()} />;
  const all = accounts.data ?? [];
  const test = (a: GatewayAccount) =>
    void act(
      () => testGateway(a.id),
      (r) => {
        const ok = r.data?.ok !== false;
        setTested((t) => ({ ...t, [a.id]: { ok, message: r.message ?? r.data?.message ?? (ok ? 'It answered.' : 'It did not answer.') } }));
        return null;
      },
    );
  return (
    <Panel title="Online payments" sub="Customers pay from the invoice’s pay link, its QR or the portal. Each paid charge records the payment, allocates it and posts it — no retyping." bodyClassName="flex flex-col">
      {(cat.data ?? []).map((k) => {
        const mine = all.filter((a) => a.gateway === k.key);
        const live = mine.some((a) => a.enabled);
        return (
          <div key={k.key} data-gateway={k.key} className="flex flex-col gap-1.5 border-b border-line/60 px-3.5 py-3 last:border-b-0">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-selection text-[14px] font-bold text-primary">{k.name.charAt(0)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <b className="text-ink">{k.name}</b>
                  <span className={cx('rounded-[10px] px-2 py-0.5 text-[11px] font-semibold', live ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>{live ? 'Connected' : 'Not connected'}</span>
                </span>
                <span className="text-[12px] text-ink-3">{[k.countries.join(', '), k.currencies.join(' · ')].filter(Boolean).join(' — ')}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {capsOf(k).map((c) => (
                    <span key={c} className="rounded-[8px] bg-subtle px-1.5 text-[11px] font-semibold text-ink-2">
                      {CAPABILITY_LABEL[c]}
                    </span>
                  ))}
                </span>
              </span>
              {may ? (
                <button type="button" className={btnSmall} onClick={() => setEditing({ kind: k, account: null })}>
                  {mine.length ? 'Add an account' : 'Connect'}
                </button>
              ) : null}
            </div>
            {mine.map((a) => (
              <div key={a.id} data-account={a.id} className="ml-12 flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle px-2.5 py-1.5 text-[12.5px]">
                <b className="text-ink">{a.name}</b>
                <span className={cx('rounded-[8px] px-1.5 text-[11px] font-semibold', a.mode === 'live' ? 'bg-success-bg text-success' : 'bg-warning-bg text-[#9A4A06] dark:text-warning')}>{a.mode === 'live' ? 'live' : 'test'}</span>
                {!a.enabled ? <span className="text-ink-3">off</span> : null}
                <span className="text-ink-3">{orgs.find((o) => o.id === a.org_id)?.name ?? (a.org_id ? `Company #${a.org_id}` : 'Every company')}</span>
                {tested[a.id] ? <span className={tested[a.id]!.ok ? 'text-success' : 'text-danger'}>{tested[a.id]!.message}</span> : a.last_test_at ? <span className="text-ink-3">tested {relative(a.last_test_at)}</span> : null}
                <span className="flex-1" />
                {may ? (
                  <>
                    <button type="button" className="font-semibold text-primary hover:underline" disabled={busy} onClick={() => test(a)}>
                      Test
                    </button>
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing({ kind: k, account: a })}>
                      Manage
                    </button>
                    <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void act(() => removeGateway(a.id), `${a.name} removed.`)}>
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
      {!(cat.data ?? []).length ? <Empty text="The server lists no payment gateways." /> : null}
      {editing ? <GatewayForm kind={editing.kind} account={editing.account} orgs={orgs} org={org} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}

/**
 * One gateway account's form, built from the gateway's own credentials spec. Plain fields are filled from what is
 * saved; secret fields start empty — the stored hint is said beside them — and only what is typed is sent.
 */
export function GatewayForm({ kind, account, orgs, org, onClose }: { kind: GatewayKind; account: GatewayAccount | null; orgs: Orgs; org: string; onClose: () => void }) {
  const { busy, act } = useAct();
  const [name, setName] = useState(account?.name ?? kind.name);
  const [mode, setMode] = useState<'test' | 'live'>(account?.mode ?? 'test');
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [company, setCompany] = useState(account?.org_id ? String(account.org_id) : /^\d+$/.test(org) ? org : '');
  const [values, setValues] = useState<Record<string, string | boolean>>(() => initialCredentials(kind.credentials_spec, account));
  const missing = missingFields(kind.credentials_spec, values, account);
  const set = (k: string, v: string | boolean) => setValues((x) => ({ ...x, [k]: v }));
  const save = () => {
    const credentials = credentialsPayload(kind.credentials_spec, values);
    const body = { gateway: kind.key, name: name.trim() || kind.name, mode, enabled, org_id: company ? Number(company) : null, credentials };
    void act(() => (account ? updateGateway(account.id, body) : createGateway(body)), account ? `${body.name} saved.` : `${kind.name} connected.`, onClose);
  };
  return (
    <Sheet
      title={account ? `${kind.name} · ${account.name}` : `Connect ${kind.name}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          {missing.length ? <span className="mr-auto self-center text-[12px] text-ink-3">Still needed: {missing.join(', ')}</span> : null}
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || missing.length > 0} onClick={save}>
            {account ? 'Save' : 'Connect'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Name" hint="As staff see it">
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </Field>
        <Field label="Mode">
          <Select<'test' | 'live'>
            aria-label="Mode"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'test', label: 'Test — no real money' },
              { value: 'live', label: 'Live' },
            ]}
            className={input}
          />
        </Field>
      </div>
      {orgs.length > 1 ? (
        <Field label="Company" hint="Whose invoices it takes payment for">
          <Select<string> aria-label="Company" value={company} onValueChange={setCompany} options={[{ value: '', label: 'Every company' }, ...orgs.map((o) => ({ value: String(o.id), label: o.name }))]} className={input} />
        </Field>
      ) : null}
      {kind.credentials_spec.map((f) => (
        <CredentialInput key={f.key} f={f} value={values[f.key]} hint={account?.secrets?.[f.key] ?? null} onChange={(v) => set(f.key, v)} />
      ))}
      <label className="flex items-center gap-2 font-semibold text-ink">
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Offer it on pay links
      </label>
      {account?.webhook_url ? (
        <Field label="Webhook address" hint="Paste this in the gateway’s dashboard so it confirms payments here">
          <span className="flex items-center gap-2">
            <input aria-label="Webhook address" readOnly value={account.webhook_url} className={input + ' font-mono text-[12px]'} />
            <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(account.webhook_url!).then(() => toast('success', 'Address copied.'))}>
              Copy
            </button>
          </span>
        </Field>
      ) : null}
    </Sheet>
  );
}

function CredentialInput({ f, value, hint, onChange }: { f: CredentialField; value: string | boolean | undefined; hint: string | null; onChange: (v: string | boolean) => void }) {
  if (f.type === 'secret') return <SecretInput label={f.label} hint={hint} value={typeof value === 'string' ? value : ''} onChange={onChange} />;
  if (f.type === 'boolean')
    return (
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
        <span>
          <b>{f.label}</b>
          {f.hint ? <span className="block text-ink-3">{f.hint}</span> : null}
        </span>
      </label>
    );
  if (f.type === 'select' && f.options?.length) {
    const opts = f.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    return (
      <Field label={f.label} hint={f.hint ?? undefined}>
        <Select<string> aria-label={f.label} value={typeof value === 'string' ? value : ''} onValueChange={onChange} options={opts} className={input} />
      </Field>
    );
  }
  return (
    <Field label={f.label} hint={f.hint ?? undefined}>
      <input aria-label={f.label} value={typeof value === 'string' ? value : ''} spellCheck={false} onChange={(e) => onChange(e.target.value)} className={input + (f.type === 'url' ? '' : ' font-mono')} />
    </Field>
  );
}

// ── CRM connector (Perfex) ──────────────────────────────────────────────

export function Crm({ may, orgs }: { may: boolean; orgs: Orgs }) {
  const q = useQuery({ queryKey: KA.crm, queryFn: ({ signal }) => fetchCrm(signal) });
  const { busy, act } = useAct();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [f, setF] = useState({ url: '', name: '', org: '' });
  const [edit, setEdit] = useState({ name: '', org: '', enabled: false, auto_apply: false, api_key: '', signing_secret: '' });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  const open = rows.find((r) => r.id === editing) ?? null;
  return (
    <Panel
      title="CRM connector"
      sub="Perfex CRM installations whose customers, invoices and payments come into Billing."
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setAdding(true)}>
            + Connect a CRM
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {rows.length ? (
        rows.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{c.name}</b>
              <span className="truncate text-[11.5px] text-ink-3">
                {c.url}
                {c.last_sync_at ? ` · synced ${relative(c.last_sync_at)}` : ''}
                {c.event_count ? ` · ${c.event_count} events` : ''}
              </span>
            </span>
            <span className={cx('rounded-[10px] px-2 py-0.5 text-[11px] font-semibold', c.enabled ? 'bg-success-bg text-success' : c.configured ? 'bg-subtle text-ink-2' : 'bg-warning-bg text-[#9A4A06] dark:text-warning')}>
              {c.enabled ? 'On' : c.configured ? 'Off' : 'Needs its key'}
            </span>
            {may ? (
              <>
                <button type="button" className="font-semibold text-primary hover:underline" disabled={busy} onClick={() => void act(() => testCrm(c.id), said('It answered.'))}>
                  Test
                </button>
                <button
                  type="button"
                  className="font-semibold text-primary hover:underline"
                  onClick={() => (setEdit({ name: c.name, org: c.org_id ? String(c.org_id) : '', enabled: c.enabled, auto_apply: c.auto_apply, api_key: '', signing_secret: '' }), setEditing(c.id))}
                >
                  Manage
                </button>
                <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void act(() => removeCrm(c.id), `${c.name} disconnected.`)}>
                  Remove
                </button>
              </>
            ) : null}
          </div>
        ))
      ) : (
        <Empty text="No CRM is connected." />
      )}
      {adding ? (
        <Sheet
          title="Connect a Perfex CRM"
          width={460}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !/^https:\/\/\S+$/.test(f.url.trim())}
                onClick={() =>
                  void act(
                    () => addCrm({ url: f.url.trim(), ...(f.name.trim() ? { name: f.name.trim() } : {}), org_id: f.org ? Number(f.org) : null }),
                    said('Connection added.'),
                    (r) => (setAdding(false), setF({ url: '', name: '', org: '' }), setEditing(r.data.connection?.id ?? null)),
                  )
                }
              >
                Add
              </button>
            </>
          }
        >
          <Field label="The CRM’s address" hint="Its base address, over HTTPS — the connector path is added for you">
            <input aria-label="The CRM’s address" value={f.url} placeholder="https://crm.example.com" onChange={(e) => setF({ ...f, url: e.target.value })} className={input} />
          </Field>
          <Field label="Name">
            <input aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} />
          </Field>
          <OrgField orgs={orgs} value={f.org} onChange={(v) => setF({ ...f, org: v })} />
        </Sheet>
      ) : null}
      {open ? (
        <Sheet
          title={open.name}
          width={500}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  void act(
                    () => updateCrm(open.id, { name: edit.name.trim(), org_id: edit.org ? Number(edit.org) : null, enabled: edit.enabled, auto_apply: edit.auto_apply, ...secretsPatch({ api_key: edit.api_key, signing_secret: edit.signing_secret }) }),
                    said('Saved.'),
                    () => setEditing(null),
                  )
                }
              >
                Save
              </button>
            </>
          }
        >
          <Field label="Name">
            <input aria-label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={input} />
          </Field>
          <OrgField orgs={orgs} value={edit.org} onChange={(v) => setEdit({ ...edit, org: v })} />
          <SecretInput label="API key" hint={open.key_hint} value={edit.api_key} onChange={(v) => setEdit({ ...edit, api_key: v })} />
          <SecretInput label="Signing secret" hint={open.secret_hint} value={edit.signing_secret} onChange={(v) => setEdit({ ...edit, signing_secret: v })} />
          <CopyField label="Webhook address" hint="Paste this in the CRM’s connector settings" value={open.delivery_url} />
          <label className="flex items-center gap-2 font-semibold text-ink">
            <Checkbox checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} />
            On — sync customers, invoices and payments
          </label>
          <label className="flex items-start gap-2 text-[12.5px] text-ink">
            <Checkbox checked={edit.auto_apply} onChange={(e) => setEdit({ ...edit, auto_apply: e.target.checked })} className="mt-0.5" />
            <span>
              <b>Apply payments automatically</b>
              <span className="block text-ink-3">A payment recorded in the CRM settles the matching invoice here.</span>
            </span>
          </label>
          {open.last_seen_at ? <span className="text-[12px] text-ink-3">Last answered {dateLabel(open.last_seen_at)}</span> : null}
        </Sheet>
      ) : null}
    </Panel>
  );
}

// ── WooCommerce stores ──────────────────────────────────────────────────

export function Woo({ may, orgs }: { may: boolean; orgs: Orgs }) {
  const q = useQuery({ queryKey: KA.woo, queryFn: ({ signal }) => fetchWoo(signal) });
  const { busy, act } = useAct();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [minted, setMinted] = useState<{ secret: string; delivery_url: string; topics: string[] } | null>(null);
  const [f, setF] = useState({ url: '', name: '', org: '', currency: 'LKR' });
  const [edit, setEdit] = useState({ name: '', org: '', currency: '', enabled: false, auto_invoice: false, consumer_key: '', consumer_secret: '' });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  const open = rows.find((r) => r.id === editing) ?? null;
  return (
    <Panel
      title="WooCommerce stores"
      sub="Online shops whose orders become invoices here."
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setAdding(true)}>
            + Connect a store
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {rows.length ? (
        rows.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{s.name}</b>
              <span className="truncate text-[11.5px] text-ink-3">
                {s.url} · {s.currency ?? '—'}
                {s.last_sync_at ? ` · synced ${relative(s.last_sync_at)}` : ''}
                {s.webhook_set ? '' : ' · no webhook secret'}
              </span>
            </span>
            <span className={cx('rounded-[10px] px-2 py-0.5 text-[11px] font-semibold', s.enabled ? 'bg-success-bg text-success' : s.configured ? 'bg-subtle text-ink-2' : 'bg-warning-bg text-[#9A4A06] dark:text-warning')}>
              {s.enabled ? 'On' : s.configured ? 'Off' : 'Needs its keys'}
            </span>
            {may ? (
              <>
                <button type="button" className="font-semibold text-primary hover:underline" disabled={busy} onClick={() => void act(() => testWoo(s.id), said('It answered.'))}>
                  Test
                </button>
                <button
                  type="button"
                  className="font-semibold text-primary hover:underline"
                  onClick={() => (setEdit({ name: s.name, org: s.org_id ? String(s.org_id) : '', currency: s.currency ?? '', enabled: s.enabled, auto_invoice: s.auto_invoice, consumer_key: '', consumer_secret: '' }), setEditing(s.id))}
                >
                  Manage
                </button>
                <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void act(() => removeWoo(s.id), `${s.name} disconnected.`)}>
                  Remove
                </button>
              </>
            ) : null}
          </div>
        ))
      ) : (
        <Empty text="No store is connected." />
      )}
      {adding ? (
        <Sheet
          title="Connect a WooCommerce store"
          width={460}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !/^https?:\/\/\S+$/.test(f.url.trim())}
                onClick={() =>
                  void act(
                    () => addWoo({ url: f.url.trim(), ...(f.name.trim() ? { name: f.name.trim() } : {}), currency: f.currency, org_id: f.org ? Number(f.org) : null }),
                    said('Store added. Add its API keys next.'),
                    (r) => (setAdding(false), setEditing(r.data.store?.id ?? null)),
                  )
                }
              >
                Add
              </button>
            </>
          }
        >
          <Field label="The store’s address">
            <input aria-label="The store’s address" value={f.url} placeholder="https://shop.example.com" onChange={(e) => setF({ ...f, url: e.target.value })} className={input} />
          </Field>
          <div className="grid grid-cols-[1fr_100px] gap-2.5">
            <Field label="Name">
              <input aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} />
            </Field>
            <Field label="Currency">
              <input aria-label="Currency" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className={input + ' font-mono'} />
            </Field>
          </div>
          <OrgField orgs={orgs} value={f.org} onChange={(v) => setF({ ...f, org: v })} />
        </Sheet>
      ) : null}
      {open ? (
        <Sheet
          title={open.name}
          width={500}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button
                type="button"
                className={btn + ' mr-auto'}
                disabled={busy}
                title="A new secret: paste it in WooCommerce’s webhook settings. It is shown once."
                onClick={() =>
                  void act(
                    () => mintWooSecret(open.id),
                    null,
                    (r) => setMinted(r.data),
                  )
                }
              >
                {open.webhook_set ? 'New webhook secret' : 'Make the webhook secret'}
              </button>
              <button type="button" className={btn} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      updateWoo(open.id, {
                        name: edit.name.trim(),
                        currency: edit.currency,
                        org_id: edit.org ? Number(edit.org) : null,
                        enabled: edit.enabled,
                        auto_invoice: edit.auto_invoice,
                        ...secretsPatch({ consumer_key: edit.consumer_key, consumer_secret: edit.consumer_secret }),
                      }),
                    said('Saved.'),
                    () => setEditing(null),
                  )
                }
              >
                Save
              </button>
            </>
          }
        >
          <div className="grid grid-cols-[1fr_100px] gap-2.5">
            <Field label="Name">
              <input aria-label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={input} />
            </Field>
            <Field label="Currency">
              <input aria-label="Currency" value={edit.currency} maxLength={3} onChange={(e) => setEdit({ ...edit, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className={input + ' font-mono'} />
            </Field>
          </div>
          <OrgField orgs={orgs} value={edit.org} onChange={(v) => setEdit({ ...edit, org: v })} />
          <SecretInput label="Consumer key" hint={open.key_hint} value={edit.consumer_key} onChange={(v) => setEdit({ ...edit, consumer_key: v })} />
          <SecretInput label="Consumer secret" hint={open.secret_hint} value={edit.consumer_secret} onChange={(v) => setEdit({ ...edit, consumer_secret: v })} />
          <CopyField label="Webhook delivery address" hint="WooCommerce › Settings › Advanced › Webhooks, for order created and updated" value={open.delivery_url} />
          <label className="flex items-center gap-2 font-semibold text-ink">
            <Checkbox checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} />
            On — take its orders in
          </label>
          <label className="flex items-start gap-2 text-[12.5px] text-ink">
            <Checkbox checked={edit.auto_invoice} onChange={(e) => setEdit({ ...edit, auto_invoice: e.target.checked })} className="mt-0.5" />
            <span>
              <b>Invoice each order automatically</b>
              <span className="block text-ink-3">Otherwise an order waits as a draft.</span>
            </span>
          </label>
        </Sheet>
      ) : null}
      {minted ? (
        <Sheet
          title="The webhook secret"
          width={480}
          onClose={() => setMinted(null)}
          footer={
            <button type="button" className={btnPrimary} onClick={() => setMinted(null)}>
              I have copied it
            </button>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Paste it into the store’s webhook now. It is not shown again — anywhere.</p>
          <CopyField label="Secret" value={minted.secret} />
          <CopyField label="Delivery address" value={minted.delivery_url} />
          <span className="text-[12px] text-ink-3">Topics: {minted.topics.join(', ')}</span>
        </Sheet>
      ) : null}
    </Panel>
  );
}

// ── members ─────────────────────────────────────────────────────────────

export function Members({ org, orgs }: { org: string; orgs: Orgs }) {
  const [company, setCompany] = useState(/^\d+$/.test(org) ? org : orgs.length === 1 ? String(orgs[0]!.id) : '');
  const id = Number(company);
  const q = useQuery({ queryKey: KA.members(company), queryFn: ({ signal }) => fetchMembers(id, signal), enabled: id > 0 });
  const { busy, act } = useAct();
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<{ id: number; name: string; email: string | null } | null>(null);
  const [hits, setHits] = useState<Array<{ id: number; name: string; email: string | null }>>([]);
  const [role, setRole] = useState('member');
  const d = q.data;
  const roles = d?.roles?.length ? d.roles : Object.keys(ROLE_LABEL);
  const search = (term: string) => void findAssignable(term).then(setHits, () => setHits([]));
  return (
    <Panel
      title="Members"
      sub={d?.shared_note ?? 'Who works in each company, and in what role.'}
      action={
        d?.can_manage ? (
          <button type="button" className={btnSmall} onClick={() => (setWho(null), setRole('member'), setAdding(true))}>
            + Add somebody
          </button>
        ) : null
      }
      bodyClassName="flex flex-col"
    >
      {orgs.length > 1 ? (
        <div className="border-b border-line px-3.5 py-2.5">
          <Select<string> aria-label="Members of" searchable value={company} onValueChange={setCompany} placeholder="Choose the company" options={orgs.map((o) => ({ value: String(o.id), label: o.name }))} className={input + ' !w-[300px]'} />
        </div>
      ) : null}
      {!id ? <Empty text="Choose a company to see its members." /> : q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {(d?.members ?? []).map((m) => (
        <div key={m.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{m.name}</b>
            <span className="truncate text-[11.5px] text-ink-3">{[m.email, m.status && m.status !== 'active' ? m.status : null].filter(Boolean).join(' · ')}</span>
          </span>
          {d?.can_manage ? (
            <Select<string>
              aria-label={`Role of ${m.name}`}
              value={m.role}
              disabled={busy}
              onValueChange={(r) => void act(() => addMember({ org_id: id, user_id: m.user_id, role: r }), said(`${m.name} is now ${ROLE_LABEL[r] ?? r}.`))}
              options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))}
              className={input + ' !h-[30px] !w-[150px]'}
            />
          ) : (
            <span className="w-[150px] shrink-0 text-ink-2">{ROLE_LABEL[m.role] ?? m.role}</span>
          )}
          {d?.can_manage ? (
            <button
              type="button"
              aria-label={`Remove ${m.name}`}
              title="Remove from the company"
              className="flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger-bg"
              disabled={busy}
              onClick={() => void act(() => removeMember(id, m.user_id), said(`${m.name} was removed.`))}
            >
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </div>
      ))}
      {d && !d.members.length ? <Empty text="Nobody is in this company yet." /> : null}
      {adding ? (
        <Sheet
          title={`Add to ${orgs.find((o) => o.id === id)?.name ?? 'the company'}`}
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
                disabled={busy || !who}
                onClick={() =>
                  void act(
                    () => addMember({ org_id: id, user_id: who!.id, role }),
                    said(`${who!.name} added.`),
                    () => setAdding(false),
                  )
                }
              >
                Add
              </button>
            </>
          }
        >
          <Field label="Person">
            <Select<string>
              aria-label="Person"
              value={who ? String(who.id) : ''}
              onSearch={search}
              empty="Type a name or email."
              placeholder="Find somebody"
              options={[...(who && !hits.some((h) => h.id === who.id) ? [who] : []), ...hits].map((u) => ({ value: String(u.id), label: u.name, hint: u.email ?? undefined }))}
              onValueChange={(v) => setWho([...hits, ...(who ? [who] : [])].find((u) => String(u.id) === v) ?? null)}
              className={input}
            />
          </Field>
          <Field label="Role">
            <Select<string> aria-label="Role" value={role} onValueChange={setRole} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))} className={input} />
          </Field>
          <p className="m-0 text-[12px] text-ink-3">What they may do in Billing still follows their permissions; this says which company’s records they work in.</p>
        </Sheet>
      ) : null}
    </Panel>
  );
}

// ── small parts ─────────────────────────────────────────────────────────

function OrgField({ orgs, value, onChange }: { orgs: Orgs; value: string; onChange: (v: string) => void }) {
  if (orgs.length < 2) return null;
  return (
    <Field label="Company" hint="Whose books its revenue lands in">
      <Select<string> aria-label="Company" value={value} onValueChange={onChange} options={[{ value: '', label: 'No particular company' }, ...orgs.map((o) => ({ value: String(o.id), label: o.name }))]} className={input} />
    </Field>
  );
}

function CopyField({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <Field label={label} hint={hint}>
      <span className="flex items-center gap-2">
        <input aria-label={label} readOnly value={value} className={input + ' font-mono text-[12px]'} />
        <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(value).then(() => toast('success', 'Copied.'))}>
          Copy
        </button>
      </span>
    </Field>
  );
}
