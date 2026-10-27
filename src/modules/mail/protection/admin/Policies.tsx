import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { dateLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { Select } from '../../../../components/Select';
import { Button, ErrorNote, Modal, NumberField, Spinner, Switch, TextField, cx } from '../../../../components/ui';
import { VerdictChip } from '../QuarantinePage';
import { adminKeys, applyPolicy, createPolicy, previewPolicy, rollbackPolicy, savePolicy, usePolicies, usePolicyVersions } from './api';
import { Card, NO_MANAGE, ProtTop, Segmented, num, useAdminPerms } from './parts';
import { SelfTestResult } from './Engines';
import type { ActedVerdict, Policy, PolicyPreview, PolicySettings, ProtectionAction, ProtectionPath, SelfTest } from '../types';

/**
 * Admin Center › Protection › Policies (D22, P-UI-02, AC-MPR-09): the policies with what they apply to; the editor —
 * thresholds, the action for each verdict on each path, fail mode, provider folders, links, quarantine, outbound; the
 * 7-day impact preview; Apply with the self-test (rolled back by the server if it fails); and the versions, each one
 * click from a rollback. Nothing offers "drop" and malware can only be refused, held or stripped.
 */

const VERDICTS: ActedVerdict[] = ['BULK', 'SPAM', 'HIGH_SPAM', 'PHISH', 'SPOOF', 'MALWARE', 'POLICY'];
const PATHS: Array<[ProtectionPath, string]> = [
  ['gateway', 'WorkSuite mail server'],
  ['post', 'Connected accounts'],
  ['outbound', 'Outgoing'],
];
const ACTION_WORDS: Record<ProtectionAction, string> = {
  deliver: 'Deliver',
  tag: 'Deliver with tag',
  junk: 'Junk Email',
  quarantine: 'Quarantine',
  reject: 'Refuse',
  strip_attachment: 'Strip file + notice',
  hold: 'Hold for review',
};

/** The actions a verdict may take on a path: malware is never delivered, tagged or junked; outgoing mail is held or refused. */
export function actionChoices(v: ActedVerdict, path: ProtectionPath): ProtectionAction[] {
  if (v === 'MALWARE') return path === 'outbound' ? ['reject', 'hold'] : path === 'gateway' ? ['reject', 'quarantine', 'strip_attachment'] : ['quarantine', 'strip_attachment'];
  if (path === 'outbound') return ['deliver', 'hold', 'reject'];
  const all: ProtectionAction[] = ['deliver', 'tag', 'junk', 'quarantine', 'strip_attachment'];
  return path === 'gateway' ? [...all, 'reject'] : all;
}

/** What is wrong with the thresholds (spec §4.11): Junk at least 3, Quarantine above Junk, Refuse at least Quarantine + 2. */
export function thresholdProblems(t: PolicySettings['thresholds']): string[] {
  const out: string[] = [];
  if (!(t.junk >= 3)) out.push(text('Junk must be 3 or more.'));
  if (!(t.quarantine > t.junk)) out.push(text('Quarantine must be above Junk.'));
  if (!(t.reject >= t.quarantine + 2)) out.push(text('Refuse must be at least Quarantine + 2.'));
  return out;
}

export function Policies() {
  const q = usePolicies();
  const perms = useAdminPerms();
  const [picked, setPicked] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(true);
  const list = q.data ?? [];
  const current = list.find((p) => p.id === picked) ?? list[0] ?? null;
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop
        tab="policies"
        actions={
          <>
            <Button disabled={!current} onClick={() => setHistory(!history)} aria-pressed={history}>{text('Version history')}</Button>
            <Button variant="primary" disabled={!perms.manage} title={perms.manage ? undefined : text(NO_MANAGE)} onClick={() => setCreating(true)}>{text('New policy')}</Button>
          </>
        }
      />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
          <section aria-label={text('Policies')} className="flex flex-col gap-2 xl:w-[250px] xl:shrink-0">
            {list.map((p) => {
              const on = p.id === current?.id;
              return (
                <button key={p.id} type="button" aria-current={on ? 'true' : undefined} onClick={() => setPicked(p.id)} className={cx('flex flex-col gap-1 rounded-[12px] px-3.5 py-3 text-left', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}>
                  <span className="flex items-center gap-2">
                    <b className="flex-1 text-[13.5px] text-ink">{p.name}</b>
                    <span className="text-[10.5px] font-bold tracking-[.5px] text-ink-3">{p.base === 'custom' ? text('CUSTOM') : text('BUILT-IN')}</span>
                  </span>
                  <span className="text-[12px] text-ink-2">{p.assignments.map((a) => a.label).join(', ') || text('Not assigned')} · {text('{n} mailboxes', { n: num(p.counts.mailboxes) })}</span>
                  <span className="text-[11.5px] text-ink-3">{text('v{v} · {date}', { v: p.version, date: dateLabel(p.updated_at) })}{p.updated_by ? ` · ${p.updated_by}` : ''}</span>
                </button>
              );
            })}
            <p className="rounded-[10px] bg-subtle px-3 py-2 text-[12px] text-ink-2">{text('The most specific assignment wins: mailbox › group › domain › organisation.')}</p>
          </section>
          {current ? <PolicyEditor key={`${current.id}:${current.version}`} policy={current} canManage={perms.manage} showHistory={history} /> : <p className="text-[13px] text-ink-3">{text('No policies yet.')}</p>}
        </div>
      )}
      {creating ? <NewPolicyDialog onClose={() => setCreating(false)} onMade={(id) => setPicked(id)} /> : null}
    </div>
  );
}

function PolicyEditor({ policy, canManage, showHistory }: { policy: Policy; canManage: boolean; showHistory: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PolicySettings>(policy.settings);
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | 'save' | null>(null);
  const [test, setTest] = useState<{ self: SelfTest; rolledBack: boolean } | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(policy.settings);
  const problems = thresholdProblems(draft.thresholds);
  const set = (patch: Partial<PolicySettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setPreview(null);
  };
  const setAction = (path: ProtectionPath, v: ActedVerdict, a: ProtectionAction) => set({ actions: { ...draft.actions, [path]: { ...draft.actions[path], [v]: a } } });
  const refresh = () => void qc.invalidateQueries({ queryKey: adminKeys.policies });
  const doPreview = async () => {
    setBusy('preview');
    try {
      setPreview(await previewPolicy(policy.id, draft));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    setBusy('apply');
    try {
      if (changed) await savePolicy(policy.id, draft);
      const r = await applyPolicy(policy.id);
      setTest({ self: r.self_test, rolledBack: r.rolled_back });
      toast(r.rolled_back ? 'error' : 'success', r.rolled_back ? text('The self-test failed, so the change was rolled back.') : text('Applied as version {v}; the self-test passed.', { v: r.version }));
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const noManage = canManage ? undefined : text(NO_MANAGE);
  const th = draft.thresholds;
  const scale = Math.max(20, th.reject + 5);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3.5 2xl:flex-row 2xl:items-start">
      <section aria-label={text('Policy editor')} className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-[12px] border border-line bg-surface px-4 py-3.5">
        <div className="flex items-baseline gap-2">
          <b className="flex-1 text-[15px] text-ink">
            {policy.name} <span className="font-normal text-ink-3">· v{policy.version}</span>
          </b>
          {changed ? <span className="text-[12px] font-semibold text-warning">{text('Unsaved changes')}</span> : null}
        </div>
        <fieldset disabled={!canManage} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-2">
            <legend className="font-bold text-ink">{text('Spam thresholds')}</legend>
            <div aria-hidden className="relative flex h-2 overflow-hidden rounded-[4px]">
              <span className="bg-green" style={{ width: `${(th.junk / scale) * 100}%` }} />
              <span className="bg-amber" style={{ width: `${((th.quarantine - th.junk) / scale) * 100}%` }} />
              <span className="bg-red" style={{ width: `${((th.reject - th.quarantine) / scale) * 100}%` }} />
              <span className="flex-1 bg-danger" />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  ['junk', text('Junk Email at'), text('min 3')],
                  ['quarantine', text('Quarantine at'), text('users can release spam')],
                  ['reject', text('Refuse at gateway at'), text('mail server only')],
                ] as const
              ).map(([k, label, hint]) => (
                <div key={k} className={cx('flex items-center gap-2 rounded-[10px] border px-3 py-2', th[k] !== policy.settings.thresholds[k] ? 'border-amber bg-warning-bg' : 'border-line')}>
                  <label htmlFor={`th-${k}`} className="flex flex-1 flex-col">
                    <b className="text-[12.5px] text-ink">{label}</b>
                    <span className="text-[11.5px] text-ink-3">{th[k] !== policy.settings.thresholds[k] ? text('was {n}', { n: policy.settings.thresholds[k] }) : hint}</span>
                  </label>
                  <NumberField id={`th-${k}`} size="sm" width={64} min={0} max={1000} value={String(th[k])} onValueChange={(v) => set({ thresholds: { ...th, [k]: Number(v) || 0 } })} />
                </div>
              ))}
            </div>
            {problems.length ? <p role="alert" className="text-[12px] text-danger">{problems.join(' ')}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <b className="text-ink">{text('What happens to each verdict')}</b>
            <div role="table" aria-label={text('Action per verdict and path')} className="flex flex-col text-[12.5px]">
              <div role="row" className="grid grid-cols-[110px_repeat(3,minmax(0,1fr))] gap-2 py-1 text-[11.5px] font-semibold text-ink-3">
                <span role="columnheader">{text('Verdict')}</span>
                {PATHS.map(([p, l]) => <span key={p} role="columnheader">{text(l)}</span>)}
              </div>
              {VERDICTS.map((v) => (
                <div key={v} role="row" className="grid grid-cols-[110px_repeat(3,minmax(0,1fr))] items-center gap-2 border-t border-line py-1.5">
                  <span role="cell"><VerdictChip verdict={v} /></span>
                  {PATHS.map(([p, l]) => {
                    const choices = actionChoices(v, p);
                    const value = draft.actions[p]?.[v];
                    if (p === 'outbound' && v !== 'SPAM' && v !== 'HIGH_SPAM' && v !== 'MALWARE' && v !== 'POLICY' && !value) return <span key={p} role="cell" className="text-ink-3">—</span>;
                    return (
                      <span key={p} role="cell">
                        <Select aria-label={text('{verdict} on {path}', { verdict: v, path: text(l) })} value={value && choices.includes(value) ? value : choices[0]!} disabled={!canManage} options={choices.map((c) => ({ value: c, label: text(ACTION_WORDS[c]) }))} onValueChange={(x) => setAction(p, v, x as ProtectionAction)} className="h-8 w-full" />
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-subtle px-3 py-2.5">
              <b className="text-[12.5px] text-ink">{text('Change Outlook / Gmail folders')}</b>
              <Segmented label={text('Change Outlook / Gmail folders')} value={draft.provider_changes} options={[['off', text('Off')], ['junk', text('Junk only')], ['full', text('Full')]]} onChange={(v) => canManage && set({ provider_changes: v })} />
              <span className="text-[11.5px] text-ink-3">{text('Off: hidden and locked in WorkSuite apps only. Mail is never deleted at the provider.')}</span>
            </div>
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-subtle px-3 py-2.5">
              <b className="text-[12.5px] text-ink">{text('If scanning is unavailable')}</b>
              {PATHS.map(([p, l]) => (
                <label key={p} className="flex items-center gap-2 text-[12px] text-ink-2">
                  <span className="flex-1">{text(l)}</span>
                  <Select aria-label={text('If scanning is unavailable: {path}', { path: text(l) })} value={draft.fail_mode[p]} disabled={!canManage} options={(p === 'post' ? (['tag', 'hold'] as const) : (['hold', 'tag'] as const)).map((c) => ({ value: c, label: c === 'hold' ? text('Hold, retry later') : text('Show “Not scanned”, lock files') }))} onValueChange={(x) => set({ fail_mode: { ...draft.fail_mode, [p]: x as ProtectionAction } })} className="h-8 w-[220px]" />
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <b className="text-[12.5px] text-ink">{text('Links')}</b>
              <Toggle label={text('Check links when clicked')} checked={draft.links.click_check} onChange={(v) => set({ links: { ...draft.links, click_check: v } })} disabled={!canManage} />
              <Toggle label={text('Rewrite links')} checked={draft.links.rewrite} onChange={(v) => set({ links: { ...draft.links, rewrite: v } })} disabled={!canManage} />
            </div>
            <div className="flex flex-col gap-2">
              <b className="text-[12.5px] text-ink">{text('Quarantine')}</b>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <span className="flex-1">{text('Keep for (days)')}</span>
                <NumberField size="sm" width={64} min={1} max={365} value={String(draft.quarantine_days)} onValueChange={(v) => set({ quarantine_days: Math.max(1, Number(v) || 1) })} />
              </label>
              <Toggle label={text('People release their own spam')} checked={draft.user_release} onChange={(v) => set({ user_release: v })} disabled={!canManage} />
            </div>
            <div className="flex flex-col gap-2">
              <b className="text-[12.5px] text-ink">{text('Outgoing')}</b>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <span className="flex-1">{text('Messages per hour')}</span>
                <NumberField size="sm" width={72} min={1} max={100000} value={String(draft.outbound.per_hour)} onValueChange={(v) => set({ outbound: { ...draft.outbound, per_hour: Number(v) || 1 } })} />
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <span className="flex-1">{text('Messages per day')}</span>
                <NumberField size="sm" width={72} min={1} max={1000000} value={String(draft.outbound.per_day)} onValueChange={(v) => set({ outbound: { ...draft.outbound, per_day: Number(v) || 1 } })} />
              </label>
              <Toggle label={text('Pause a mailbox that looks compromised')} checked={draft.outbound.pause_on_compromise} onChange={(v) => set({ outbound: { ...draft.outbound, pause_on_compromise: v } })} disabled={!canManage} />
            </div>
          </div>
        </fieldset>
      </section>
      <aside aria-label={text('Apply')} className="flex flex-col gap-3 2xl:w-[340px] 2xl:shrink-0">
        <Card title={text('Preview impact')}>
          {preview ? (
            <>
              <span className="text-[12px] text-ink-3">{text('Replayed on the last {n} days', { n: preview.days })}</span>
              {preview.changes.length === 0 ? <p className="text-[12.5px] text-ink-2">{text('No message would have been handled differently.')}</p> : null}
              {preview.changes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[12.5px]">
                  <VerdictChip verdict={c.verdict} />
                  <span className="flex-1 text-ink-2">{text(ACTION_WORDS[c.from_action] ?? c.from_action)} → {text(ACTION_WORDS[c.to_action] ?? c.to_action)}</span>
                  <b className="text-ink tabular-nums">{num(c.count)}</b>
                </div>
              ))}
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">{text('See what this change would have done to the last 7 days of mail before you apply it.')}</p>
          )}
          <Button size="sm" className="self-start" loading={busy === 'preview'} disabled={!changed || problems.length > 0 || !!busy} onClick={() => void doPreview()}>
            {text('Preview impact')}
          </Button>
        </Card>
        <Card title={text('Before applying')}>
          <p className={cx('text-[12.5px]', problems.length ? 'text-danger' : 'text-success dark:text-success-ink')}>
            {problems.length ? `✕ ${problems.join(' ')}` : `✓ ${text('Thresholds in order ({a} < {b} < {c})', { a: th.junk, b: th.quarantine, c: th.reject })}`}
          </p>
          <p className="text-[12.5px] text-ink-2">• {text('Self-test runs EICAR and GTUBE through every path; a failure rolls the change back.')}</p>
          <div className="flex justify-end gap-2">
            <Button disabled={!changed || !!busy} onClick={() => (setDraft(policy.settings), setPreview(null))}>{text('Discard')}</Button>
            <Button variant="primary" loading={busy === 'apply'} disabled={!canManage || problems.length > 0 || !!busy} title={noManage} onClick={() => void apply()}>
              {text('Apply and self-test')}
            </Button>
          </div>
        </Card>
        {test ? <SelfTestResult test={test.self} onClose={() => setTest(null)} /> : null}
        {showHistory ? <Versions policy={policy} canManage={canManage} onRolledBack={refresh} /> : null}
      </aside>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-[12.5px] text-ink">
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
      {label}
    </span>
  );
}

function Versions({ policy, canManage, onRolledBack }: { policy: Policy; canManage: boolean; onRolledBack: () => void }) {
  const q = usePolicyVersions(policy.id);
  const [busy, setBusy] = useState<number | null>(null);
  const roll = async (v: number) => {
    setBusy(v);
    try {
      await rollbackPolicy(policy.id, v);
      toast('success', text('Rolled back to version {v}.', { v }));
      onRolledBack();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title={text('Versions')}>
      {q.isLoading ? <Spinner /> : null}
      {(q.data ?? []).slice(0, 10).map((v) => (
        <div key={v.version} className="flex items-center gap-2 text-[12.5px]">
          <b className="w-8 text-ink">v{v.version}</b>
          <span className="flex-1 truncate text-ink-2">{[v.version === policy.version ? text('Current') : null, dateLabel(v.created_at), v.note, v.created_by].filter(Boolean).join(' · ')}</span>
          {v.version !== policy.version ? (
            <Button size="sm" variant="ghost" loading={busy === v.version} disabled={!canManage || busy !== null} onClick={() => void roll(v.version)}>
              {text('Roll back')}
            </Button>
          ) : null}
        </div>
      ))}
    </Card>
  );
}

function NewPolicyDialog({ onClose, onMade }: { onClose: () => void; onMade: (id: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [base, setBase] = useState<Policy['base']>('standard');
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const p = await createPolicy(name.trim(), base);
      void qc.invalidateQueries({ queryKey: adminKeys.policies });
      onMade(p.id);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={text('New policy')} labelledBy="new-policy" width={420} onClose={busy ? undefined : onClose} footer={<><Button onClick={onClose} disabled={busy}>{text('Cancel')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void make()}>{text('Create')}</Button></>}>
      <div className="flex flex-col gap-3 p-4">
        <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <span className="flex items-center gap-2 text-[12.5px] text-ink">
          {text('Start from')}
          <Segmented label={text('Start from')} value={base} options={[['standard', text('Standard')], ['strict', text('Strict')], ['custom', text('Custom')]]} onChange={setBase} />
        </span>
      </div>
    </Modal>
  );
}
