import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Cell, Field, input, PageHead, row, Sheet, THead } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, problemsOf, refusal, shortDate, type Company } from './api';
import { ConfirmSheet, LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import { archiveTaxCode, createTaxCode, fetchTaxCodes, fetchTaxHistory, forbiddenWhy, isOpenRate, KS, RATELESS, rateChange, setTaxRate, taxRateProblem, trimDecimals, type TaxCode } from './setup';

/**
 * Tax codes and the rates that applied to them.
 *
 * "NOT SET" IS NOT 0%. A code with no rate for the chosen date shows "Not set"
 * in amber, never 0.00%. A zero-rated supply is real and on the return; no
 * rate is a question nobody has answered, and the server refuses to classify a
 * document with it rather than assume the cheaper answer. Drawing the two
 * alike is how tax that was owed gets declared as tax that was nil.
 *
 * THE EMPTY STATE IS A STATEMENT. Nothing ships with rates in it: rates change,
 * thresholds move, and which treatment applies to a supply is a question for
 * the company's own advisers.
 *
 * RATES ARE APPEND-ONLY. A new rate closes whatever was open the day before it
 * starts, so documents raised under the old rate keep it. The sheet shows the
 * history and says which rate the new one closes, and on what day, before it
 * is recorded.
 *
 * Writing takes `finance.settings` (the route's gate). The server's area
 * envelope can narrow that further in the UI, as the web does; it is never a
 * reason to show a control somebody without the permission would be refused.
 * The tax return has no screen here, as it has none on the web.
 */
const TREATMENT_TONE: Record<string, 'blue' | 'amber' | 'grey'> = { standard: 'blue', zero_rated: 'grey', exempt: 'amber', out_of_scope: 'grey', reverse_charge: 'blue' };

const treatmentWord = (t: string) => {
  const s = t.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function TaxCodes({ company }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [asOf, setAsOf] = useState(() => todayInZone());
  const q = useQuery({ queryKey: KS.taxAsOf(company.id, asOf), queryFn: ({ signal }) => fetchTaxCodes(company.id, asOf, signal), retry: false, enabled: /^\d{4}-\d{2}-\d{2}$/.test(asOf) });
  const [adding, setAdding] = useState(false);
  const [rateFor, setRateFor] = useState<TaxCode | null>(null);
  const [archiving, setArchiving] = useState<TaxCode | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? <Notice tone="grey" className="m-6">{why}</Notice> : <LoadFailed what="Tax codes" onRetry={() => void q.refetch()} />;
  }

  const d = q.data;
  const mayEdit = can(perms, 'finance.settings') && d.can?.edit !== false;
  const codes = d.codes ?? [];
  const treatments = d.treatments ?? {};
  const refresh = () => void qc.invalidateQueries({ queryKey: KS.tax(company.id) });
  const archive = async (c: TaxCode) => {
    setBusy(true);
    try {
      await archiveTaxCode(company.id, c.id);
      toast('success', `${c.code} archived.`);
      setArchiving(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Tax codes" sub="What a document is classified as, and the rate that applied when it was raised.">
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
          Rates as at
          <input type="date" aria-label="Rates as at" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className={cx(input, 'w-[150px]')} />
        </label>
        {mayEdit ? (
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> New code
          </button>
        ) : null}
      </PageHead>

      {d.unconfigured > 0 ? (
        <Notice tone="amber">
          <b>
            {d.unconfigured} code{d.unconfigured === 1 ? ' has' : 's have'} no rate for {shortDate(asOf)}.
          </b>{' '}
          A document dated then cannot be classified with {d.unconfigured === 1 ? 'it' : 'them'} — the server refuses rather than assuming a rate of zero, because tax that was owed and tax that was nil are not the same thing.
        </Notice>
      ) : null}

      {codes.length === 0 ? (
        <div className="mx-auto flex max-w-[520px] flex-col items-center gap-2 py-8 text-center">
          <p className="m-0 text-[13px] text-ink-2">{d.empty_note ?? 'No tax codes are set up.'}</p>
          <p className="m-0 text-[12px] text-ink-3">Nothing here ships with rates in it. Rates change, thresholds move, and which treatment applies to a given supply is a question for your own advisers — so the product does not guess.</p>
          {mayEdit ? (
            <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
              Add the first one
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <div className="min-w-[820px]">
            <THead
              cols={[
                ['Code', 90],
                ['Name', null],
                ['Treatment', 130],
                ['Side', 130],
                [`Rate at ${shortDate(asOf)}`, 150],
                ...(mayEdit ? [['', 150] as [string, number]] : []),
              ]}
            />
            {codes.map((c) => (
              <div key={c.id} className={row}>
                <Cell w={90} className="font-mono text-[12px] text-ink-2">
                  {c.code}
                </Cell>
                <Cell w={null}>
                  <span title={c.note ?? undefined}>{c.name}</span>
                </Cell>
                <span className="w-[130px] shrink-0" title={treatments[c.treatment]}>
                  <Pill tone={TREATMENT_TONE[c.treatment] ?? 'grey'}>{treatmentWord(c.treatment)}</Pill>
                </span>
                <Cell w={130} className="text-[12.5px] text-ink-3">
                  {c.direction === 'output' ? 'Output (sales)' : 'Input (purchases)'}
                </Cell>
                <span className="flex w-[150px] shrink-0 flex-col">
                  {c.configured ? (
                    <>
                      <b className="tabular-nums">{trimDecimals(c.rate ?? '0', 2)}%</b>
                      <span className="text-[11px] text-ink-3">
                        from {shortDate(c.rate_from)}
                        {c.rate_to ? ` to ${shortDate(c.rate_to)}` : ''}
                      </span>
                    </>
                  ) : RATELESS.includes(c.treatment) ? (
                    <span className="text-[12px] text-ink-3">No rate by definition</span>
                  ) : (
                    <span title="No rate is recorded for this date. That is not 0%.">
                      <Pill tone="amber">Not set</Pill>
                    </span>
                  )}
                </span>
                {mayEdit ? (
                  <span className="flex w-[150px] shrink-0 justify-end gap-1.5">
                    <button type="button" className={btnSmall} onClick={() => setRateFor(c)} aria-label={`Set the rate for ${c.code}`}>
                      Set rate
                    </button>
                    <button type="button" className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-ink" onClick={() => setArchiving(c)}>
                      Archive
                    </button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {adding ? <NewCode company={company} treatments={treatments} taken={codes.map((c) => c.code)} onClose={() => setAdding(false)} onDone={refresh} /> : null}
      {rateFor ? <RateSheet company={company} code={rateFor} onClose={() => setRateFor(null)} onDone={refresh} /> : null}
      {archiving ? (
        <ConfirmSheet
          title={`Archive ${archiving.code}?`}
          body="It stops being offered on new documents. Everything already classified with it keeps its classification, and past returns still name it — archiving changes nothing that has happened."
          action="Archive"
          busy={busy}
          onYes={() => void archive(archiving)}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </div>
  );
}

function NewCode({ company, treatments, taken, onClose, onDone }: { company: Company; treatments: Record<string, string>; taken: string[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', treatment: 'standard', direction: 'output', note: '' });
  const [busy, setBusy] = useState(false);
  const clash = taken.includes(f.code.trim());
  const ready = f.code.trim() !== '' && f.name.trim() !== '' && !clash;
  const save = async () => {
    setBusy(true);
    try {
      await createTaxCode(company.id, { ...f, code: f.code.trim(), name: f.name.trim(), note: f.note.trim() });
      toast('success', 'Tax code created — it needs a rate before anything can be classified with it.');
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New tax code"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[140px_1fr] gap-3">
        <Field label="Code" hint={clash ? <span className="text-danger">This company already has a live {f.code.trim()}.</span> : undefined}>
          <input autoFocus aria-label="Code" value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="SR" className={cx(input, 'font-mono', clash && '!border-danger')} />
        </Field>
        <Field label="Name">
          <input aria-label="Name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Standard-rated sales" className={input} />
        </Field>
      </div>
      <Field label="Treatment" hint={treatments[f.treatment]}>
        <Select<string> aria-label="Treatment" value={f.treatment} onValueChange={(v) => setF({ ...f, treatment: v })} options={Object.keys(treatments).map((k) => ({ value: k, label: treatmentWord(k), hint: treatments[k] }))} className={input} />
      </Field>
      <Field label="Side">
        <Select<string>
          aria-label="Side"
          value={f.direction}
          onValueChange={(v) => setF({ ...f, direction: v })}
          options={[
            { value: 'output', label: 'Output — tax you charge on sales' },
            { value: 'input', label: 'Input — tax you are charged on purchases' },
          ]}
          className={input}
        />
      </Field>
      <Field label="Note">
        <input aria-label="Note" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What this code is for, in your own words" className={input} />
      </Field>
    </Sheet>
  );
}

/**
 * A new rate for one code: every rate it has carried, then the form. The
 * history is the feature — it is how somebody checks which rate a document
 * from March was raised under — so a failed read of it says so and is not
 * drawn as "no rate has been set".
 */
function RateSheet({ company, code, onClose, onDone }: { company: Company; code: TaxCode; onClose: () => void; onDone: () => void }) {
  const h = useQuery({ queryKey: KS.taxHistory(company.id, code.id), queryFn: ({ signal }) => fetchTaxHistory(company.id, code.id, signal), retry: false });
  const [f, setF] = useState(() => ({ rate: '', from: todayInZone(), note: '' }));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const rates = h.data ?? [];
  const problem = taxRateProblem(f.rate);
  const change = rateChange(rates, f.from, code.code);
  const ready = f.rate.trim() !== '' && !problem && !change.problem && !h.isLoading;

  const save = async () => {
    setBusy(true);
    setRefused([]);
    try {
      await setTaxRate(company.id, code.id, { rate: f.rate.trim(), from: f.from, note: f.note.trim() });
      toast('success', `Rate recorded for ${code.code}.`);
      onDone();
      onClose();
    } catch (e) {
      setRefused(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Rate for ${code.code}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Record it'}
          </button>
        </>
      }
    >
      {h.isLoading ? (
        <p className="m-0 text-[12px] text-ink-3">Loading the rates…</p>
      ) : h.error ? (
        <p className="m-0 text-[12px] text-[#9A4A06] dark:text-warning">The rate history could not be loaded. That is a failed request, not a code with no rates.</p>
      ) : rates.length === 0 ? (
        <p className="m-0 text-[12px] text-ink-3">No rate has been set yet, so nothing using this code can be taxed.</p>
      ) : (
        <div className="flex flex-col">
          <div className="mb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Every rate it has carried</div>
          <div className="overflow-hidden rounded-[10px] border border-line">
            {rates.map((r) => (
              <div key={String(r.id)} className="flex items-baseline justify-between gap-3 border-b border-line/70 px-3 py-2 text-[13px] last:border-b-0">
                <b className="tabular-nums">{trimDecimals(r.rate, 2)}%</b>
                <span className="flex items-center gap-2 text-[12px] text-ink-3">
                  {shortDate(r.starts_on)} – {isOpenRate(r) ? 'open' : shortDate(r.ends_on)}
                  {isOpenRate(r) ? <Pill tone="green">Current</Pill> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Notice tone="grey">
        Rates are never edited. This starts a new one and closes whatever was open the day before — so documents raised under the old rate keep it, and last year’s return still reconciles to last year’s ledger.
      </Notice>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate %">
          <input autoFocus aria-label="Rate %" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="0.00" className={cx(input, 'text-right tabular-nums', problem && '!border-danger')} />
        </Field>
        <Field label="In force from">
          <input aria-label="In force from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={input} />
        </Field>
      </div>
      <Field label="Note">
        <input aria-label="Note" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Why it changed, or what it refers to" className={input} />
      </Field>

      {problem ? <p className="m-0 text-[12.5px] text-danger">{problem}</p> : null}
      {change.problem ? <p className="m-0 text-[12.5px] text-danger">{change.problem}</p> : null}
      {!problem && !change.problem && change.closes && change.closesOn ? (
        <p className="m-0 text-[12.5px] text-ink-2">
          The current {trimDecimals(change.closes.rate, 2)}% (from {shortDate(change.closes.starts_on)}) closes on {shortDate(change.closesOn)}; {f.rate.trim() ? `${f.rate.trim()}%` : 'the new rate'} applies from {shortDate(f.from)}.
        </p>
      ) : null}
      {refused.length ? (
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12.5px] text-danger">
          {refused.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}
