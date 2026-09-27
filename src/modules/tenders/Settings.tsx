import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { ModuleSettingsForm } from '../../components/ModuleSettingsForm';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Panel, Seg, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { K, type Company } from './api';
import { deleteRule, fetchRules, fetchRuns, fetchSources, KA, OPERATOR_WORDS, operatorsFor, rescoreOpen, ruleBody, ruleDraft, ruleSentence, saveRule, toggledRuleBody, type Factor, type Rule, type RuleDraft } from './admin';

/**
 * Tenders' settings, for those who may change them: the scoring rules that
 * put a number on each new tender (arithmetic over a few fields — it has not
 * read the document), where tenders come from and how each feed last ran,
 * and the module's switches. A rule belongs to one company; so does a source.
 */
type Tab = 'scoring' | 'sources' | 'general';

export default function Settings({ org, companies, section, onSection }: { org: string; companies: Company[]; section: string | null; onSection: (s: Tab) => void }) {
  const tab: Tab = section === 'sources' || section === 'general' ? section : 'scoring';
  return (
    <div className="flex max-w-[980px] flex-col gap-3.5 px-6 py-5">
      <PageHead title="Settings" sub="How tenders are scored, where they come from, and the module’s switches">
        <Seg
          label="Settings"
          value={tab}
          onChange={onSection}
          options={[
            { id: 'scoring', label: 'Scoring rules' },
            { id: 'sources', label: 'Sources' },
            { id: 'general', label: 'General' },
          ]}
        />
      </PageHead>
      {tab === 'scoring' ? <Scoring org={org} companies={companies} /> : null}
      {tab === 'sources' ? <SourceList org={org} companies={companies} /> : null}
      {tab === 'general' ? <ModuleSettingsForm slug="tender" section="general" queryKey={KA.settings} note="Changes apply to every company." readOnly="You can read these settings; changing them needs the settings permission." /> : null}
    </div>
  );
}

function Scoring({ org, companies }: { org: string; companies: Company[] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.rules(org), queryFn: ({ signal }) => fetchRules(org, signal) });
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: KA.rules(org) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { rules, factors, note } = q.data;
  const several = companies.length > 1 && !org;
  const nameOf = (id: number | null) => companies.find((c) => c.id === id)?.name ?? null;
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const rescore = async () => {
    setBusy('rescore');
    try {
      const r = await rescoreOpen(org);
      toast('success', `${r.rescored} open ${r.rescored === 1 ? 'tender' : 'tenders'} scored again.`);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Scoring rules"
      sub={note}
      action={
        <span className="flex shrink-0 gap-2">
          <button type="button" className={btnSmall} disabled={busy !== null} onClick={() => void rescore()}>
            {busy === 'rescore' ? 'Scoring…' : 'Score everything open again'}
          </button>
          <button type="button" className={btnSmall + ' gap-1'} onClick={() => setEditing('new')}>
            <Icon name="plus" size={13} /> Add a rule
          </button>
        </span>
      }
      bodyClassName="flex flex-col"
    >
      {rules.length ? (
        rules.map((r) => (
          <div key={r.id} data-rule={r.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
            <b className={cx('w-11 shrink-0 text-right font-mono text-[13px] tabular-nums', r.points > 0 ? 'text-[#145C39] dark:text-success' : 'text-danger', !r.enabled && 'opacity-40')}>{r.points > 0 ? `+${r.points}` : r.points}</b>
            <span className={cx('flex min-w-0 flex-1 flex-col', !r.enabled && 'opacity-50')}>
              <span className="flex flex-wrap items-center gap-1.5">
                <b className={cx('text-[13px] text-ink', !r.enabled && 'line-through')}>{r.name}</b>
                {several && nameOf(r.org_id) ? <Pill tone="blue">{nameOf(r.org_id)}</Pill> : null}
                {!r.enabled ? <Pill>Off</Pill> : null}
              </span>
              <span className="text-[11.5px] text-ink-3">
                When {ruleSentence(r, factors).charAt(0).toLowerCase() + ruleSentence(r, factors).slice(1)}
                {r.reason ? ` · “${r.reason}”` : ''}
              </span>
            </span>
            <button type="button" className={btnSmall + ' !h-7'} disabled={busy !== null} onClick={() => void run(`t${r.id}`, () => saveRule(toggledRuleBody(r, r.org_id), r.id), r.enabled ? 'Turned off.' : 'Turned on.')}>
              {r.enabled ? 'Turn off' : 'Turn on'}
            </button>
            <button type="button" aria-label={`Edit ${r.name}`} title="Edit" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={() => setEditing(r)}>
              <Icon name="compose" size={13} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${r.name}`}
              title="Remove"
              className={btnSmall + ' !h-7 !w-7 justify-center !px-0 !text-danger'}
              disabled={busy !== null}
              onClick={() => void run(`d${r.id}`, () => deleteRule(r.id, org), 'Removed.')}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))
      ) : (
        <Empty text="No scoring rules. Every tender scores 50 until some are added." />
      )}
      {editing ? <RuleSheet rule={editing === 'new' ? null : editing} factors={factors} org={org} companies={companies} next={rules.length + 1} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </Panel>
  );
}

function RuleSheet({ rule, factors, org, companies, next, onClose, onSaved }: { rule: Rule | null; factors: Record<string, string>; org: string; companies: Company[]; next: number; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<RuleDraft>(() => ruleDraft(rule));
  const [company, setCompany] = useState(rule?.org_id ? String(rule.org_id) : org || (companies.length === 1 ? String(companies[0]!.id) : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsCompany = !rule && !org && companies.length > 1;
  const ops = operatorsFor(d.factor);
  const save = async () => {
    const out = ruleBody(d, rule?.sort_order ?? next, company ? Number(company) : null);
    if (!out.body) return setError(out.error);
    if (needsCompany && !company) return setError('Choose the company this rule scores for.');
    setBusy(true);
    setError(null);
    try {
      await saveRule(out.body, rule?.id ?? null);
      toast('success', rule ? 'Rule saved.' : 'Rule added. Score open tenders again to apply it to them.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const valueHint =
    d.factor === 'certifications'
      ? 'Nothing to compare — it asks the checklist.'
      : d.operator === 'between'
        ? 'Two numbers, the lower first: 10, 30.'
        : d.operator === 'in'
          ? 'Several values, separated by commas.'
          : d.factor === 'budget'
            ? 'The published ceiling, as a plain figure.'
            : d.factor === 'lead_time'
              ? 'Whole days until closing.'
              : undefined;
  return (
    <Sheet
      title={rule ? 'Edit the rule' : 'Add a scoring rule'}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !d.name.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : rule ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      {needsCompany ? (
        <Field label="Company">
          <Select<string> aria-label="Company" value={company} onValueChange={setCompany} options={[{ value: '', label: 'Choose a company' }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]} className={input} />
        </Field>
      ) : null}
      <Field label="Name" hint="What appears next to the score.">
        <input aria-label="Name" autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={150} placeholder="Construction is our strongest line" className={input} />
      </Field>
      <div className="grid grid-cols-[1.3fr_1fr] gap-2.5">
        <Field label="Looks at">
          <Select<string>
            aria-label="Looks at"
            value={d.factor}
            onValueChange={(v) => {
              const f = v as Factor;
              setD({ ...d, factor: f, operator: operatorsFor(f).includes(d.operator) ? d.operator : operatorsFor(f)[0]!, value: f === 'certifications' ? '' : d.value });
            }}
            options={Object.entries(factors).map(([value, label]) => ({ value, label }))}
            className={input}
          />
        </Field>
        <Field label="When it">
          <Select<string> aria-label="When it" value={d.operator} onValueChange={(v) => setD({ ...d, operator: v as RuleDraft['operator'] })} options={ops.map((o) => ({ value: o, label: OPERATOR_WORDS[o] }))} className={input} />
        </Field>
      </div>
      {d.factor !== 'certifications' ? (
        <Field label="Value" hint={valueHint}>
          <input aria-label="Value" value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} maxLength={500} className={input} />
        </Field>
      ) : (
        <p className="m-0 text-[12px] text-ink-3">{valueHint}</p>
      )}
      <div className="grid grid-cols-[120px_1fr] gap-2.5">
        <Field label="Points" hint="-100 to 100.">
          <input aria-label="Points" inputMode="numeric" value={d.points} onChange={(e) => setD({ ...d, points: e.target.value })} className={input} />
        </Field>
        <Field label="Why" hint="Shown with the score, so it reads as a reason.">
          <input aria-label="Why" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} maxLength={250} placeholder="We have the crews and the plant for it." className={input} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} className="accent-primary" />
        On
      </label>
      <p className="m-0 rounded-[9px] bg-subtle px-3 py-2 text-[12px] text-ink-2">
        {d.name.trim() || d.value.trim() || d.factor === 'certifications'
          ? `When ${ruleSentence(d, factors).charAt(0).toLowerCase()}${ruleSentence(d, factors).slice(1)}, the score moves by ${Number(d.points) > 0 ? '+' : ''}${d.points || 0}.`
          : 'Say what the rule looks at and when it applies.'}
      </p>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function SourceList({ org, companies }: { org: string; companies: Company[] }) {
  const q = useQuery({ queryKey: KA.sources(org), queryFn: ({ signal }) => fetchSources(org, signal) });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const several = companies.length > 1 && !org;
  const nameOf = (id: number | null) => companies.find((c) => c.id === id)?.name ?? null;
  return (
    <div className="flex flex-col gap-3.5">
      <Panel title="Ways tenders can arrive" sub="What this installation can take in, and why not where it cannot" bodyClassName="flex flex-col">
        {q.data.drivers.map((d) => (
          <div key={d.key} className="flex items-start gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', d.usable.ok ? 'bg-success' : 'bg-ink-3/40')} />
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-ink">{d.label}</b>
              {!d.usable.ok && d.usable.why ? <span className="text-[12px] leading-relaxed text-[#9A4A06] dark:text-warning">{d.usable.why}</span> : null}
            </span>
            <Pill tone={d.usable.ok ? 'green' : 'grey'}>{d.usable.ok ? 'Ready' : 'Not available'}</Pill>
          </div>
        ))}
      </Panel>
      <Panel title="Sources" sub="Each feed, and how it last ran" bodyClassName="flex flex-col">
        {q.data.sources.length ? (
          q.data.sources.map((s) => (
            <div key={s.id} className="flex flex-col border-b border-line/60 last:border-b-0">
              <button type="button" onClick={() => setOpen((o) => (o === s.id ? null : s.id))} className="flex items-center gap-3 px-3.5 py-2.5 text-left text-[12.5px] hover:bg-subtle">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <b className="text-ink">{s.name}</b>
                    {several && nameOf(s.org_id) ? <Pill tone="blue">{nameOf(s.org_id)}</Pill> : null}
                  </span>
                  <span className="text-[11.5px] text-ink-3">{[q.data!.drivers.find((d) => d.key === s.driver)?.label ?? s.driver, s.last_run_at ? `last ran ${relative(s.last_run_at)}` : 'never run', s.last_status].filter(Boolean).join(' · ')}</span>
                </span>
                <Pill tone={s.enabled ? 'green' : 'grey'}>{s.enabled ? 'On' : 'Off'}</Pill>
                <Icon name={open === s.id ? 'chevron-down' : 'chevron-right'} size={14} className="text-ink-3" />
              </button>
              {open === s.id ? <Runs id={s.id} /> : null}
            </div>
          ))
        ) : (
          <Empty text="No sources. Tenders are added by hand or pasted as a list (New tender › Paste a list)." />
        )}
      </Panel>
    </div>
  );
}

function Runs({ id }: { id: number }) {
  const q = useQuery({ queryKey: KA.runs(id), queryFn: ({ signal }) => fetchRuns(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <p className="m-0 px-3.5 pb-2.5 text-[12px] text-ink-3">It has not run yet.</p>;
  return (
    <div className="flex flex-col px-3.5 pb-2.5" aria-label="Runs">
      {q.data.map((r) => (
        <span key={r.id} className="flex items-center gap-2 border-t border-line/50 py-1.5 text-[12px]">
          <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', r.ok ? 'bg-success' : 'bg-danger')} />
          <span className="w-[110px] shrink-0 text-ink-2">{r.started_at ? relative(r.started_at) : '—'}</span>
          <span className="min-w-0 flex-1 truncate text-ink">
            {r.seen} seen · {r.imported} kept · {r.duplicates} already here · {r.rejected} unreadable
          </span>
          {r.message ? (
            <span className="max-w-[40%] truncate text-ink-3" title={r.message}>
              {r.message}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
