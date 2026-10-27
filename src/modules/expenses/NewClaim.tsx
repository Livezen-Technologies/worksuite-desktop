import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { problemsOf, refusal } from '../finance/api';
import { Notice } from '../../components/RecordKit';
import { btn, btnPrimary, btnSmall, Field, input, Seg, Sheet } from '../../components/PageKit';
import { money, type Org } from './api';
import { ReadFields } from './ClaimPanel';
import {
  blocksOf,
  CK,
  converted,
  currencyOptions,
  fetchCategories,
  fetchCostCentres,
  fetchOpenAdvances,
  fetchRelated,
  fetchSchedule,
  fetchSettings,
  fileClaim,
  missingFor,
  payloadOf,
  previewClaim,
  readReceipt,
  RECEIPT_ACCEPT,
  RECEIPT_MAX,
  uploadReceipt,
  type ClaimForm,
  type ClaimKind,
  type ReadField,
} from './claim-data';
import { Blocks, Warnings, type Hit } from './parts';

/**
 * Filing an expense, in one company.
 *
 * THE PANEL ON THE RIGHT IS THE POINT OF THIS SCREEN. As soon as there is an
 * amount and a category, the policy and budget engines that will decide the
 * submission are run against the half-filled form and their answer is shown.
 * Finding out you are over a monthly cap after pressing File is a refusal at
 * the worst moment; finding out while the number is under your cursor is
 * information. `claims2/preview` shares its code with `create`, so the panel
 * cannot promise what the save then refuses.
 *
 * THREE KINDS, ONE FORM. An expense takes an amount. Mileage takes a distance
 * and the server multiplies by the company's rate; per diem takes the days
 * away. In those two the amount is worked out, not typed, and the workings
 * come back so the figure can be checked.
 */
export default function NewClaim({
  orgId,
  orgs,
  onClose,
  onDone,
  preset,
  fixed,
  relatedLabel,
}: {
  orgId: number;
  orgs: Org[];
  onClose: () => void;
  onDone: (claimId: number | null) => void;
  /** Fields the form opens with (filing from a subscription sets `subscription_id`); all still editable. */
  preset?: Record<string, unknown>;
  /** Which of the preset's related fields are DECIDED, whose pickers are therefore not offered. */
  fixed?: string[];
  /** What the preset links to, in words, so the form can say so. */
  relatedLabel?: string;
}) {
  const org = orgs.find((o) => o.id === orgId);
  const [form, setForm] = useState<ClaimForm>(() => ({
    kind: 'expense',
    spent_on: todayInZone(),
    amount: '',
    description: '',
    category_id: '',
    currency: '',
    // Strings, because every picker's values are strings and a number would match none of them.
    ...Object.fromEntries(Object.entries(preset ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])),
  }));
  const [receipt, setReceipt] = useState<{ token: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Record<string, ReadField> | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<Hit[] | null>(null);
  const [said, setSaid] = useState<string[]>([]);
  const pick = useRef<HTMLInputElement | null>(null);

  const settings = useQuery({ queryKey: CK.settings(orgId), queryFn: ({ signal }) => fetchSettings(orgId, signal), staleTime: 300_000 });
  const cats = useQuery({ queryKey: CK.companyCategories(orgId), queryFn: ({ signal }) => fetchCategories(String(orgId), signal), staleTime: 300_000 });
  const centres = useQuery({ queryKey: CK.costCentres(orgId), queryFn: ({ signal }) => fetchCostCentres(orgId, signal), staleTime: 300_000 });
  const related = useQuery({ queryKey: CK.related(orgId), queryFn: ({ signal }) => fetchRelated(orgId, signal), retry: false, staleTime: 300_000 });
  const advances = useQuery({ queryKey: CK.advances(orgId), queryFn: ({ signal }) => fetchOpenAdvances(orgId, signal), retry: false });
  const schedule = useQuery({ queryKey: CK.schedule(orgId), queryFn: ({ signal }) => fetchSchedule(orgId, signal), retry: false, staleTime: 300_000, enabled: form.kind !== 'expense' });

  const base = settings.data?.currency ?? org?.currency ?? 'LKR';
  const activeCats = (cats.data ?? []).filter((c) => c.active);
  /*
   * A preset category the picker cannot show is dropped once the list is
   * known — an archived one, or another company's. Otherwise the picker says
   * "choose one" while the payload names one, and the server refuses a claim
   * the person can see nothing wrong with. An empty list mid-flight is not
   * evidence the category is gone, so this waits for the answer.
   */
  const categoryId = cats.isSuccess && form.category_id && !activeCats.some((c) => String(c.id) === form.category_id) ? '' : (form.category_id ?? '');
  const vehicles = schedule.data?.vehicles ?? [];
  const vehicle = form.vehicle || (vehicles.length && !vehicles.includes('car') ? vehicles[0]! : 'car');
  const eff: ClaimForm = {
    ...form,
    currency: form.currency || base,
    category_id: categoryId,
    ...(form.kind === 'mileage' ? { vehicle } : {}),
  };
  const missing = missingFor(eff);

  const set = (patch: ClaimForm) => {
    setForm((f) => ({ ...f, ...patch }));
    // A refusal was about the claim as it stood; a change deserves a fresh answer.
    setRefused(null);
    setSaid([]);
  };

  /* ---- the live panel ---- */

  const wantsPreview = eff.kind === 'expense' && !!eff.amount && !!eff.category_id;
  const body = payloadOf(eff, receipt?.token ?? null);
  // Debounced: the preview runs real queries against the claims table, and one per keystroke is a query per digit.
  const settled = useSettled(JSON.stringify(body), 400);
  const settledBody = JSON.parse(settled) as Record<string, string>;
  const previewQ = useQuery({
    queryKey: CK.preview(orgId, settledBody),
    queryFn: ({ signal }) => previewClaim(orgId, settledBody, signal),
    enabled: wantsPreview && settledBody.kind === 'expense' && !!settledBody.amount && !!settledBody.category_id,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
  const preview = wantsPreview ? (previewQ.data ?? null) : null;
  const refusedNow = !!refused?.length || preview?.ready === false;

  /* ---- the receipt ---- */

  const upload = async (file: File) => {
    if (file.size > RECEIPT_MAX) {
      toast('error', 'That file is larger than 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const up = await uploadReceipt(file);
      setReceipt({ token: up.token, name: up.name });
      setRead(undefined);
      setRefused(null);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setUploading(false);
    }
  };
  const readIt = async () => {
    if (!receipt) return;
    setReading(true);
    try {
      setRead((await readReceipt(receipt.token)).fields);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setReading(false);
    }
  };
  /** Copy the suggestions in — by hand, and said to be suggestions. */
  const applyRead = () => {
    if (!read) return;
    set({
      ...(read.total?.value ? { amount: read.total.value } : {}),
      ...(read.date?.value ? { spent_on: read.date.value } : {}),
      ...(read.currency?.value ? { currency: read.currency.value } : {}),
    });
    toast('info', 'Copied in. Check each figure against the receipt before saving.');
  };

  const save = async () => {
    setSaving(true);
    setSaid([]);
    setRefused(null);
    try {
      const r = await fileClaim(orgId, payloadOf(eff, receipt?.token ?? null));
      // The workings, where the amount was worked out rather than typed, so the figure can be checked.
      toast('success', [r.message ?? 'Filed.', ...r.workings].join(' '));
      onDone(r.id);
    } catch (e) {
      const blocks = blocksOf(e);
      if (blocks.length) setRefused(blocks);
      else setSaid(problemsOf(e));
    } finally {
      setSaving(false);
    }
  };

  const ocr = settings.data?.reading ?? null;
  const types = (related.data ?? []).filter((t) => !(fixed ?? []).includes(t.field));
  const schedCountries = schedule.data?.countries ?? [];
  const schedCities = (schedule.data?.cities ?? []).filter((c) => !form.country || !c.country || c.country === form.country);

  return (
    <Sheet
      title="File an expense"
      onClose={onClose}
      width={1000}
      footer={
        <>
          <span className={cx('mr-auto self-center text-[12px]', refusedNow ? 'text-danger' : 'text-ink-3')}>
            {refusedNow ? 'Something in the panel refuses this claim.' : missing.length ? `Still needs ${missing.join(', ')}.` : null}
          </span>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!!missing.length || saving || refusedNow || uploading} title={missing.length ? `Still needs ${missing.join(', ')}` : undefined} onClick={() => void save()}>
            {saving ? 'Filing…' : 'File it'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="flex min-w-0 flex-col gap-3">
          {/* A link made silently is one nobody can check before saving. */}
          {relatedLabel ? (
            <Notice tone="grey">
              Related to <b>{relatedLabel}</b>
            </Notice>
          ) : null}
          {orgs.length > 1 && org ? <span className="text-[12.5px] text-ink-3">In {org.name}. Filing happens in one company; switch company to file in another.</span> : null}

          <Seg<ClaimKind>
            label="Kind of claim"
            value={eff.kind as ClaimKind}
            onChange={(k) => set({ kind: k })}
            options={[
              { id: 'expense', label: 'Something I paid for' },
              { id: 'mileage', label: 'Mileage' },
              { id: 'per_diem', label: 'Per diem' },
            ]}
          />

          {eff.kind === 'expense' ? (
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <Field label="Amount">
                <input autoFocus inputMode="decimal" value={form.amount ?? ''} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" className={input} />
              </Field>
              <Field label="Currency">
                {/* A picklist, not a box: a typed "LRK" converts at no rate and lands in the base total as itself. */}
                <Select aria-label="Currency" value={eff.currency} onValueChange={(v) => set({ currency: v })} className="w-full" options={currencyOptions(base)} />
              </Field>
            </div>
          ) : null}

          {eff.kind === 'mileage' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Distance" hint="Entered, not tracked — there is no maps service configured on this server.">
                <input autoFocus inputMode="decimal" value={form.quantity ?? ''} onChange={(e) => set({ quantity: e.target.value })} placeholder="0" className={input} />
              </Field>
              <Field label="Vehicle" hint="Must match a rate an administrator has entered.">
                {vehicles.length ? (
                  <Select aria-label="Vehicle" value={vehicle} onValueChange={(v) => set({ vehicle: v })} className="w-full" options={vehicles.map((v) => ({ value: v, label: v }))} />
                ) : (
                  <input aria-label="Vehicle" value={form.vehicle ?? 'car'} onChange={(e) => set({ vehicle: e.target.value })} className={input} />
                )}
              </Field>
            </div>
          ) : null}

          {eff.kind === 'per_diem' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day away">
                <input type="date" value={form.from_date ?? ''} max={form.to_date || undefined} onChange={(e) => set({ from_date: e.target.value })} className={input} />
              </Field>
              <Field label="Last day away">
                <input type="date" value={form.to_date ?? ''} min={form.from_date || undefined} onChange={(e) => set({ to_date: e.target.value })} className={input} />
              </Field>
              <Field label="Country" hint={schedCountries.length ? 'The countries the company’s rate schedule names; anywhere else takes its general rate.' : undefined}>
                {schedCountries.length ? (
                  <Select aria-label="Country" searchable value={form.country ?? ''} onValueChange={(v) => set({ country: v, city: '' })} className="w-full" options={[{ value: '', label: 'Anywhere else' }, ...schedCountries.map((c) => ({ value: c, label: c }))]} />
                ) : (
                  <input aria-label="Country" value={form.country ?? ''} onChange={(e) => set({ country: e.target.value })} className={input} />
                )}
              </Field>
              <Field label="City">
                {schedCities.length ? (
                  <Select aria-label="City" searchable value={form.city ?? ''} onValueChange={(v) => set({ city: v })} className="w-full" options={[{ value: '', label: 'Not one with its own rate' }, ...schedCities.map((c) => ({ value: c.city, label: c.city, hint: c.country ?? undefined }))]} />
                ) : (
                  <input aria-label="City" value={form.city ?? ''} onChange={(e) => set({ city: e.target.value })} className={input} />
                )}
              </Field>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date it was spent">
              <input type="date" value={form.spent_on ?? ''} max={todayInZone()} onChange={(e) => set({ spent_on: e.target.value })} className={input} />
            </Field>
            <Field label="Category">
              <Select
                aria-label="Category"
                searchable
                value={categoryId}
                onValueChange={(v) => set({ category_id: v })}
                className="w-full"
                options={[{ value: '', label: 'Choose one' }, ...activeCats.map((c) => ({ value: String(c.id), label: `${c.name}${c.shared ? '' : ' (this organization)'}` }))]}
              />
            </Field>
          </div>

          <Field label="What it was for" hint="The approver reads this. Above some amounts a policy requires a real explanation.">
            <textarea rows={2} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="Taxi from the airport to the client's office" className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost centre" hint={settings.data?.requireCostCentre ? 'This company requires one on every claim.' : undefined}>
              <Select
                aria-label="Cost centre"
                searchable
                value={form.cost_centre_id ?? ''}
                onValueChange={(v) => set({ cost_centre_id: v })}
                className="w-full"
                options={[{ value: '', label: 'Use my default' }, ...(centres.data ?? []).filter((c) => c.active).map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))]}
              />
            </Field>
            {/*
              * What the claim is related to. `require_project` is a switch an
              * administrator can turn on, and without a picker here the
              * company could make filing impossible. An empty type is shown
              * disabled rather than hidden: an absent picker reads as a
              * missing feature, not an empty table.
              */}
            {types.map((t) => (
              <Field key={t.key} label={t.label} hint={t.empty ? `No ${t.label.toLowerCase()}s have been added yet.` : t.field === 'project_id' && settings.data?.requireProject ? 'This company requires every claim to be charged to a project.' : t.scoped ? undefined : 'Shared across every company.'}>
                <Select
                  aria-label={t.label}
                  searchable
                  disabled={t.empty}
                  value={form[t.field] ?? ''}
                  onValueChange={(v) => set({ [t.field]: v })}
                  className="w-full"
                  options={[{ value: '', label: t.empty ? 'None yet' : `Not related to a ${t.label.toLowerCase()}` }, ...t.items.map((i) => ({ value: String(i.id), label: i.label }))]}
                />
              </Field>
            ))}
            {advances.data?.length ? (
              <Field label="Charge to an advance" hint="Spending against money you were already given.">
                <Select
                  aria-label="Charge to an advance"
                  value={form.advance_id ?? ''}
                  onValueChange={(v) => set({ advance_id: v })}
                  className="w-full"
                  options={[{ value: '', label: 'No — reimburse me' }, ...advances.data.map((a) => ({ value: String(a.id), label: `${a.advance_no} — ${money(a.amount, a.currency)}` }))]}
                />
              </Field>
            ) : null}
          </div>

          <div className="rounded-[12px] border border-dashed border-line px-3 py-2.5">
            {receipt ? (
              <div className="flex flex-wrap items-center gap-2">
                <Icon name="paperclip" size={14} className="text-ink-3" />
                <span className="min-w-0 truncate text-[13px] text-ink">{receipt.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReceipt(null);
                    setRead(undefined);
                    setRefused(null);
                  }}
                  className="text-[12px] font-semibold text-ink-3 hover:text-danger"
                >
                  remove
                </button>
                {ocr?.ok ? (
                  <button type="button" className={cx(btnSmall, 'ml-auto gap-1.5')} disabled={reading} onClick={() => void readIt()}>
                    <Icon name="scan" size={13} /> {reading ? 'Reading…' : 'Read the receipt'}
                  </button>
                ) : null}
              </div>
            ) : (
              <button type="button" disabled={uploading} onClick={() => pick.current?.click()} className="flex items-center gap-2 text-[13px] font-semibold text-ink-2 hover:text-ink disabled:opacity-60">
                <Icon name="paperclip" size={14} /> {uploading ? 'Attaching…' : 'Attach a receipt'}
                <span className="font-medium text-ink-3">· PDF, image or Office document, up to 10 MB</span>
              </button>
            )}
            <input
              ref={pick}
              type="file"
              className="hidden"
              aria-label="Choose a receipt"
              accept={RECEIPT_ACCEPT}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
            {receipt && ocr && !ocr.ok && ocr.message ? <p className="m-0 mt-2 text-[12px] text-ink-3">{ocr.message}</p> : null}
            {read !== undefined ? (
              <div className="mt-3 flex flex-col items-start gap-2 border-t border-line pt-3">
                <ReadFields fields={read} />
                {read ? (
                  <button type="button" className={btnSmall} onClick={applyRead}>
                    Copy the amount, date and currency in
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {said.length ? (
            <Notice tone="red">
              {said.length > 1 ? (
                <ul className="m-0 pl-4">
                  {said.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                said[0]
              )}
            </Notice>
          ) : null}
        </div>

        <aside className="flex flex-col gap-2.5 self-start rounded-[12px] bg-ground px-3.5 py-3">
          <b className="text-[13px] text-ink">Before you file</b>

          {!preview && eff.kind === 'expense' && !refused ? <p className="m-0 text-[12px] text-ink-3">Enter an amount and a category and the rules that apply will appear here, before you submit rather than after.</p> : null}
          {eff.kind !== 'expense' ? <p className="m-0 text-[12px] text-ink-2">The amount is worked out from the rate schedule when you file, and the workings come back with it so you can check the figure.</p> : null}

          {refused ? <Blocks items={refused} /> : null}

          {preview?.fx_missing ? <Notice tone="red">{preview.message}</Notice> : null}
          {preview && !preview.fx_missing && !refused ? (
            <>
              <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
                <span className="text-[11.5px] text-ink-3">In {preview.base_currency}</span>
                <b className="block text-[17px] text-ink tabular-nums">{money(preview.base_amount, preview.base_currency)}</b>
                {converted(preview) && preview.rate ? (
                  <span className="text-[11.5px] text-ink-3">
                    at {preview.rate.rate}, {preview.rate.source}, from {preview.rate.on}
                  </span>
                ) : null}
              </div>
              <Blocks items={preview.blocks} />
              <Warnings items={preview.warnings} />
              {preview.budgets.map((b) => (
                <div key={b.id} className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[12px]">
                  <b className="text-ink">{b.name}</b>
                  <span className="block text-ink-2">
                    {money(b.used, b.currency)} of {money(b.amount, b.currency)} used{b.pct !== null ? ` (${b.pct}%)` : ''}
                  </span>
                </div>
              ))}
              {preview.routing ? <p className="m-0 text-[12px] text-ink-2">{preview.routing}</p> : null}
              {preview.ready && !preview.warnings.length && !preview.blocks.length ? <p className="m-0 text-[12px] font-semibold text-success">Nothing objects to this claim.</p> : null}
              {/*
                * A refusal must never be invisible. Every reason is meant to
                * arrive in `blocks`; when one does not, this says so rather
                * than leave somebody in front of a dead button.
                */}
              {!preview.ready && !preview.blocks.length ? <Notice tone="red">{preview.message ?? 'The checks refused this claim but did not say which one. Please report this — the claim itself is not at fault.'}</Notice> : null}
            </>
          ) : null}

          <p className="m-0 text-[11.5px] text-ink-3">These are the same checks that run when you press File — this panel cannot pass something the save then refuses.</p>
        </aside>
      </div>
    </Sheet>
  );
}

/** The value once it has stopped changing for `ms`. */
function useSettled(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
