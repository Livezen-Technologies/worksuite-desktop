import { Checkbox } from '../../components/Checkbox';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { send } from './api';
import { BlockEditor } from './email-BlockEditor';
import { parseBlocks, plainText, serializeBlocks, type Block } from './email-blocks';
import { stamp, useSegmentNames } from './email-kit';
import { Card, Field, Pill, Sheet, btn, btnBad, btnPrimary, btnSmall, input } from './parts';
import { refusal, type CampaignDetail, type Recurrence } from './types';

/**
 * WS-B (SRS v2.0) on the desktop — the same screens as the web's
 * `Governance.tsx`, on the same endpoints: version history (EDT-06),
 * approval (EML-05), the deliverability panel with its fixes and seed tests
 * (request 4, DLV-02), languages (EDT-09), repeating and feed campaigns
 * (SND-13), saved blocks and who sees each block (EDT-07/08), re-permission
 * (CON-08) and call script versions (CAL-07). The server decides; these show
 * what it says and send back what was chosen.
 */

export type Reload = () => Promise<void>;

/* ------------------------------------------------------------------ *
 * What the server sends
 * ------------------------------------------------------------------ */

interface VersionRow { id: number; version: number; note: string | null; by: string | null; created_at: string | null; subject: string | null; changed: string[] }
interface VersionCompare { version: number; created_at: string | null; fields: Array<{ field: string; label: string; then: string | null; now: string | null }> }
interface ApprovalState {
  required: boolean; status: 'pending' | 'approved' | 'rejected' | null; label: string; note: string | null; decided_at: string | null;
  can_request: boolean; can_decide: boolean; own: boolean; history: Array<{ action: string; note: string | null; by: string | null; at: string | null }>;
}
type CheckStatus = 'pass' | 'warn' | 'fail';
type CheckGroup = 'content' | 'compliance' | 'sender' | 'audience';
interface DlvCheck { group: CheckGroup; key: string; status: CheckStatus; title: string; detail: string; fix: { key: string; label: string } | null }
interface DlvSuggestion { key: string; label: string; why: string; tone: 'fail' | 'warn' | 'info'; impact: string; at?: string }
export interface WarmupPlan {
  id: number; domain: string; status: 'active' | 'paused' | 'done'; start_cap: number; growth_percent: number; max_cap: number; started_on: string;
  cap_today: number; used_today: number; days_to_max: number; schedule: Array<{ date: string; cap: number }>;
}
interface SeedTest { id: number; created_at: string | null; sent: number; spam_score: number | null; results: Record<string, string | null>; inbox_rate: number | null }
interface CampaignDeliverability {
  score: number; grade: 'good' | 'fair' | 'poor'; counts: Record<CheckStatus, number>; checks: DlvCheck[];
  spam: { score: number; threshold: number }; suggestions: DlvSuggestion[]; ai: boolean; editable: boolean;
  domain: { domain: string; warmup: WarmupPlan | null } | null; seed_tests: SeedTest[]; seeds: string[]; can: { edit: boolean; launch: boolean };
}
interface ScriptVersionRow { id: number; version: number; sections: Record<string, string>; by: string | null; created_at: string | null; calls: number; outcomes: Record<string, number>; positive_rate: number | null }
interface FeedItem { title: string; link: string; date: string }

export const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' }, { value: 'si', label: 'Sinhala' }, { value: 'ta', label: 'Tamil' }, { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' }, { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'es', label: 'Spanish' },
  { value: 'zh', label: 'Chinese' }, { value: 'ja', label: 'Japanese' }, { value: 'ms', label: 'Malay' }, { value: 'pt', label: 'Portuguese' },
];
const GROUPS: Array<[CheckGroup, string]> = [['content', 'Content'], ['compliance', 'Compliance'], ['sender', 'Sender'], ['audience', 'Audience']];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MARK: Record<CheckStatus, { icon: 'check-circle' | 'warning' | 'x-circle'; cls: string; word: string }> = {
  pass: { icon: 'check-circle', cls: 'text-success', word: 'Pass' },
  warn: { icon: 'warning', cls: 'text-warning', word: 'Warning' },
  fail: { icon: 'x-circle', cls: 'text-danger', word: 'Fail' },
};

/* ================================================================== *
 * Version history (MKT-EDT-06)
 * ================================================================== */

export function VersionHistory({ campaign, onClose, onRestored }: { campaign: CampaignDetail; onClose: () => void; onRestored: Reload }) {
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ['marketing', 'campaign-versions', campaign.id, campaign.updated_at],
    queryFn: ({ signal }) => apiGet<{ items: VersionRow[]; keep: number }>(`/api/marketing/campaigns/${campaign.id}/versions`, undefined, signal),
  });
  const cmp = useQuery({
    queryKey: ['marketing', 'campaign-version', campaign.id, open],
    queryFn: ({ signal }) => apiGet<VersionCompare>(`/api/marketing/campaigns/${campaign.id}/versions/${open}`, undefined, signal),
    enabled: open !== null,
  });
  const items = list.data?.items ?? [];

  const restore = async () => {
    setBusy(true);
    try {
      const r = await send('POST', `/api/marketing/campaigns/${campaign.id}/versions/${open}/restore`);
      toast('success', r.message ?? 'Restored.');
      await onRestored();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Version history" onClose={onClose} width={860}
      footer={(
        <>
          <button type="button" className={btn} onClick={onClose}>Close</button>
          {campaign.can.edit && open !== null && items[0]?.id !== open ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void restore()}>{busy ? 'Restoring…' : 'Restore this version'}</button> : null}
        </>
      )}>
      {list.isLoading ? <Spinner label="Loading versions…" /> : items.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">No versions yet: one is kept each time a change is saved.</p> : (
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="m-0 flex max-h-[55vh] list-none flex-col gap-1 overflow-auto p-0 scroll-thin">
            {items.map((v, i) => (
              <li key={v.id}>
                <button type="button" onClick={() => setOpen(v.id)} aria-pressed={open === v.id}
                  className={cx('w-full rounded-[8px] border px-2.5 py-2 text-left text-[12.5px]', open === v.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
                  <b className="block text-ink">Version {v.version}{i === 0 ? ' · now' : ''}</b>
                  <span className="block text-[11.5px] text-ink-3">{stamp(v.created_at)}{v.by ? ` · ${v.by}` : ''}</span>
                  {v.note ? <span className="block text-[11.5px] text-ink-2">{v.note}</span> : null}
                  {i > 0 && v.changed.length ? <span className="block truncate text-[11.5px] text-warning">Differs in: {v.changed.join(', ')}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {open === null ? <p className="m-0 text-[12.5px] text-ink-3">Choose a version to compare it with what the campaign says now.</p>
              : cmp.isLoading ? <Spinner label="Comparing…" /> : !cmp.data ? <p className="m-0 text-[12.5px] text-danger">{refusal(cmp.error)}</p>
                : cmp.data.fields.length === 0 ? <p className="m-0 text-[12.5px] text-ink-2">This version says what the campaign says now.</p> : (
                  <table className="w-full table-fixed text-[12.5px]">
                    <thead><tr className="text-left text-[11.5px] text-ink-3"><th className="w-28">Field</th><th>Version {cmp.data.version}</th><th>Now</th></tr></thead>
                    <tbody>
                      {cmp.data.fields.map((f) => (
                        <tr key={f.field} className="border-t border-line align-top">
                          <th scope="row" className="py-1.5 pr-2 text-left font-semibold text-ink-2">{f.label}</th>
                          <td className="py-1.5 pr-2 break-words whitespace-pre-wrap text-danger">{f.then ?? '—'}</td>
                          <td className="py-1.5 break-words whitespace-pre-wrap text-success">{f.now ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ================================================================== *
 * Approval (MKT-EML-05)
 * ================================================================== */

export function ApprovalBar({ campaign, dirty, onChanged }: { campaign: CampaignDetail; dirty: boolean; onChanged: Reload }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<null | 'request' | 'approve' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'campaign-approval', campaign.id, campaign.updated_at],
    queryFn: ({ signal }) => apiGet<ApprovalState>(`/api/marketing/campaigns/${campaign.id}/approval`, undefined, signal),
    retry: false,
  });
  const a = q.data;
  if (!a || typeof a.label !== 'string' || (!a.required && a.status === null)) return null;

  const go = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      const r = await send('POST', `/api/marketing/campaigns/${campaign.id}/approval/${asking}`, { note });
      toast('success', r.message ?? 'Done.');
      setAsking(null);
      setNote('');
      await qc.invalidateQueries({ queryKey: ['marketing', 'campaign-approval', campaign.id] });
      await onChanged();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className={cx('flex flex-wrap items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12.5px]',
      a.status === 'approved' ? 'border-success/40 bg-success-bg text-success' : a.status === 'rejected' ? 'border-danger/40 bg-danger-bg text-danger' : 'border-primary/30 bg-selection text-primary')}>
      <b>Approval: {a.label}</b>
      {a.note ? <span className="min-w-0 truncate">“{a.note}”</span> : null}
      {a.status === null && a.required ? <span>This company approves campaigns before they are scheduled.</span> : null}
      <span className="ml-auto flex flex-wrap gap-2">
        {a.can_request && campaign.can.edit ? <button type="button" className={btnSmall} disabled={dirty} title={dirty ? 'Save first' : undefined} onClick={() => setAsking('request')}>{a.status === 'rejected' ? 'Ask again' : 'Ask for approval'}</button> : null}
        {a.can_decide ? (
          <>
            <button type="button" className={btnSmall} onClick={() => setAsking('approve')}>Approve</button>
            <button type="button" className={btnBad} onClick={() => setAsking('reject')}>Ask for changes</button>
          </>
        ) : null}
        {a.status === 'pending' && a.own ? <span>Somebody else approves it.</span> : null}
      </span>
      {asking ? (
        <Sheet title={asking === 'request' ? 'Ask for approval' : asking === 'approve' ? 'Approve this campaign' : 'Ask for changes'} onClose={() => setAsking(null)}
          footer={(
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>Cancel</button>
              <button type="button" className={btnPrimary} disabled={busy || (asking === 'reject' && !note.trim())} onClick={() => void go()}>{busy ? 'Sending…' : asking === 'request' ? 'Ask' : asking === 'approve' ? 'Approve' : 'Send back'}</button>
            </>
          )}>
          <Field label={asking === 'reject' ? 'What should change' : 'Note (optional)'}>
            <textarea className={cx(input, 'h-24 py-2')} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Sheet>
      ) : null}
    </div>
  );
}

export function ApprovalsWaiting({ onOpen }: { onOpen: (id: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'approvals'],
    queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string; subject: string | null }> }>('/api/marketing/approvals', undefined, signal),
    retry: false,
  });
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Card title={`Waiting for your approval (${items.length})`} tone="info" className="mb-3">
      <ul className="m-0 list-none divide-y divide-line p-0">
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1"><b className="block truncate text-ink">{c.name}</b><span className="block truncate text-ink-3">{c.subject}</span></span>
            <button type="button" className={btnSmall} onClick={() => onOpen(c.id)}>Review</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ================================================================== *
 * Deliverability panel (request 4) and seed tests (MKT-DLV-02)
 * ================================================================== */

export function DeliverabilityPanel({ campaign, dirty, onChanged }: { campaign: CampaignDetail; dirty: boolean; onChanged: Reload }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [ai, setAi] = useState<null | Array<{ subject: string; preheader: string; score: number }>>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedTo, setSeedTo] = useState('');
  const q = useQuery({
    queryKey: ['marketing', 'campaign-deliverability', campaign.id, campaign.updated_at],
    queryFn: ({ signal }) => apiGet<CampaignDeliverability>(`/api/marketing/campaigns/${campaign.id}/deliverability`, undefined, signal),
    retry: false,
  });
  const d = q.data;
  const again = () => qc.invalidateQueries({ queryKey: ['marketing', 'campaign-deliverability', campaign.id] });

  const fix = async (s: { key: string; at?: string }) => {
    setBusy(s.key);
    try {
      if (s.key === 'ai_rewrite') {
        const r = await send<{ options?: Array<{ subject: string; preheader: string; score: number }> }>('POST', `/api/marketing/campaigns/${campaign.id}/deliverability/rewrite`);
        setAi(r.data?.options ?? []);
        return;
      }
      const r = await send('POST', `/api/marketing/campaigns/${campaign.id}/deliverability/fix`, { fix: s.key, at: s.at });
      toast('success', r.message ?? 'Done.');
      await again();
      await onChanged();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  const applyOption = async (o: { subject: string; preheader: string }) => {
    setBusy('ai_apply');
    try {
      await send('PUT', `/api/marketing/campaigns/${campaign.id}`, { subject: o.subject, preheader: o.preheader });
      toast('success', 'Subject and preview text changed.');
      setAi(null);
      await onChanged();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  const seed = async () => {
    setBusy('seed');
    try {
      const r = await send('POST', `/api/marketing/campaigns/${campaign.id}/seed-test`, { to: seedTo.split(/[\s,;]+/).filter(Boolean) });
      toast('success', r.message ?? 'Sent.');
      setSeeding(false);
      await again();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  const place = async (t: SeedTest, addr: string, where: string) => {
    try {
      await send('PUT', `/api/marketing/seed-tests/${t.id}`, { results: { [addr]: where || null } });
      await again();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  if (q.isLoading) return <Card title="Deliverability"><Spinner label="Checking deliverability…" /></Card>;
  if (d && !Array.isArray(d.checks)) return null;
  if (!d) return <Card title="Deliverability"><p className="m-0 text-[12.5px] text-danger">{refusal(q.error, 'The deliverability check could not be run.')}</p></Card>;

  const canFix = d.editable && d.can.edit && !dirty;
  const ring = d.grade === 'good' ? 'text-success' : d.grade === 'fair' ? 'text-warning' : 'text-danger';

  return (
    <Card title="Deliverability" action={<button type="button" className={btnSmall} onClick={() => void q.refetch()}>Check again</button>}>
      <div className="flex flex-wrap items-center gap-4">
        <div className={cx('flex size-16 shrink-0 items-center justify-center rounded-full border-[6px] border-current text-[18px] font-bold', ring)} role="meter" aria-label="Deliverability score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.score}>
          <span className="text-ink">{d.score}</span>
        </div>
        <div className="min-w-0 flex-1 text-[12.5px] text-ink-2">
          <b className="block text-ink">{d.grade === 'good' ? 'Likely to reach the inbox' : d.grade === 'fair' ? 'Some risks to fix' : 'At risk of the spam folder'}</b>
          {d.counts.pass} passed · {d.counts.warn} warnings · {d.counts.fail} failed · spam score {d.spam.score.toFixed(1)} of {d.spam.threshold}
          {dirty ? <span className="block text-warning">Save to check what is on screen.</span> : null}
        </div>
      </div>

      {d.suggestions.length ? (
        <div className="mt-3 rounded-[10px] border border-primary/30 bg-selection p-3">
          <b className="mb-1.5 block text-[12.5px] text-ink">Suggestions</b>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {d.suggestions.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className={cx('size-2 shrink-0 rounded-full', s.tone === 'fail' ? 'bg-danger' : s.tone === 'warn' ? 'bg-warning' : 'bg-primary')} aria-hidden="true" />
                <span className="min-w-0 flex-1"><b className="text-ink">{s.label}</b><span className="block text-[11.5px] text-ink-3">{s.why} · {s.impact}</span></span>
                {s.key !== 'ai_rewrite' || d.ai ? (
                  <button type="button" className={s.tone === 'fail' ? btnPrimary : btnSmall} disabled={!canFix || busy !== null || (s.key === 'send_time' && !d.can.launch)} onClick={() => void fix(s)}>
                    {busy === s.key ? 'Working…' : s.key === 'ai_rewrite' ? 'Suggest' : 'Apply'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {GROUPS.map(([g, word]) => {
          const items = d.checks.filter((c) => c.group === g);
          if (!items.length) return null;
          return (
            <section key={g} className="rounded-[10px] border border-line">
              <b className="block border-b border-line px-3 py-1.5 text-[12.5px] text-ink">{word} <span className="font-normal text-ink-3">· {items.filter((i) => i.status === 'pass').length}/{items.length} pass</span></b>
              <ul className="m-0 list-none divide-y divide-line p-0">
                {items.map((c) => (
                  <li key={c.key} className="flex gap-2 px-3 py-1.5 text-[12.5px]">
                    <span className={cx('mt-0.5 shrink-0', MARK[c.status].cls)} aria-label={MARK[c.status].word}><Icon name={MARK[c.status].icon} size={15} /></span>
                    <span className="min-w-0 flex-1"><b className="block text-ink">{c.title}</b><span className="block text-[11.5px] text-ink-3">{c.detail}</span></span>
                    {c.fix && c.fix.key !== 'ai_rewrite' && canFix ? <button type="button" className={btnSmall} disabled={busy !== null} onClick={() => { if (c.fix) void fix(c.fix); }}>Fix</button> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {d.domain?.warmup ? (
        <p className="m-0 mt-2 text-[11.5px] text-ink-3">{d.domain.domain} is warming up: {d.domain.warmup.used_today.toLocaleString()} of {d.domain.warmup.cap_today.toLocaleString()} sent today; full volume in {d.domain.warmup.days_to_max} day(s).</p>
      ) : null}

      <div className="mt-3 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <b className="text-[12.5px] text-ink">Seed-inbox tests</b>
          {d.can.edit ? <button type="button" className={btnSmall} disabled={dirty} onClick={() => { setSeedTo(d.seeds.join(', ')); setSeeding(true); }}>Send a seed test</button> : null}
        </div>
        {d.seed_tests.length === 0 ? <p className="m-0 mt-1 text-[11.5px] text-ink-3">Send the campaign to inboxes you can look into, and record where it landed.</p> : (
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
            {d.seed_tests.slice(0, 3).map((t) => (
              <li key={t.id} className="rounded-[8px] border border-line p-2 text-[11.5px]">
                <span className="text-ink-3">{stamp(t.created_at)} · spam score {t.spam_score?.toFixed(1) ?? '—'}{t.inbox_rate !== null ? ` · ${t.inbox_rate}% reached the inbox` : ''}</span>
                {Object.entries(t.results).map(([addr, where]) => (
                  <div key={addr} className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-ink">{addr}</span>
                    <span className="w-[150px]">
                      <Select aria-label={`Where it landed at ${addr}`} className="h-[28px]" value={where ?? ''} onValueChange={(v) => void place(t, addr, v)}
                        options={[{ value: '', label: 'Not looked yet' }, { value: 'inbox', label: 'Inbox' }, { value: 'promotions', label: 'Promotions tab' }, { value: 'spam', label: 'Spam' }, { value: 'missing', label: 'Did not arrive' }]} />
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      {ai !== null ? (
        <Sheet title="Subject and preview suggestions" onClose={() => setAi(null)} footer={<button type="button" className={btn} onClick={() => setAi(null)}>Close</button>}>
          <p className="m-0 text-[12px] text-ink-3">From the AI assistant. Nothing changes until you pick one.</p>
          {ai.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">No usable suggestion. Try again.</p> : ai.map((o) => (
            <div key={o.subject} className="rounded-[10px] border border-line p-2.5">
              <b className="block text-[13px] text-ink">{o.subject}</b>
              <span className="block text-[12px] text-ink-2">{o.preheader}</span>
              <div className="mt-1.5 flex items-center justify-between"><span className="text-[11.5px] text-ink-3">Spam score {o.score.toFixed(1)}</span>
                <button type="button" className={btnSmall} disabled={busy !== null} onClick={() => void applyOption(o)}>Use this</button></div>
            </div>
          ))}
        </Sheet>
      ) : null}
      {seeding ? (
        <Sheet title="Seed-inbox test" onClose={() => setSeeding(false)}
          footer={<><button type="button" className={btn} onClick={() => setSeeding(false)}>Cancel</button><button type="button" className={btnPrimary} disabled={busy !== null} onClick={() => void seed()}>{busy === 'seed' ? 'Sending…' : 'Send'}</button></>}>
          <Field label="Seed inboxes" hint="Up to 25, separated by commas. The company's seed inboxes are set under Settings → Sending.">
            <textarea className={cx(input, 'h-20 py-2')} value={seedTo} onChange={(e) => setSeedTo(e.target.value)} />
          </Field>
        </Sheet>
      ) : null}
    </Card>
  );
}

/* ================================================================== *
 * Languages (MKT-EDT-09)
 * ================================================================== */

export type Variants = Record<string, { subject: string; preheader: string; body_html: string }>;

export function LanguagesCard({ value, onChange, edit, orgId, mergeTags, company, main }: {
  value: Variants; onChange: (v: Variants) => void; edit: boolean; orgId: number; mergeTags: Array<{ value: string; label: string }>; company?: string;
  main: { subject: string; preheader: string; body_html: string };
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [add, setAdd] = useState('');
  const langs = Object.keys(value);
  const label = (k: string) => LANGUAGES.find((l) => l.value === k)?.label ?? k;
  const empty = { subject: '', preheader: '', body_html: '' };
  const put = (k: string, patch: Partial<Variants[string]>) => onChange({ ...value, [k]: { ...(value[k] ?? empty), ...patch } });
  const open = editing === null ? null : value[editing];

  return (
    <Card title="Languages">
      <p className="m-0 mb-2 text-[12px] text-ink-3">The main email goes to everybody whose language has no version of its own. Contacts carry their language on their record.</p>
      {langs.length === 0 ? <p className="m-0 mb-2 text-[12.5px] text-ink-3">Only the main email.</p> : null}
      <div className="flex flex-col gap-2">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="rounded-[10px] border border-line p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <b className="text-[13px] text-ink">{label(k)}</b>
              <span className="flex gap-1.5">
                <button type="button" className={btnSmall} onClick={() => setEditing(k)}>{edit ? 'Write the email' : 'Read the email'}</button>
                {edit ? <button type="button" className={btnSmall} onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }}>Remove</button> : null}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={`Subject (${label(k)})`}><input className={input} value={v.subject} readOnly={!edit} maxLength={255} placeholder={main.subject} onChange={(e) => put(k, { subject: e.target.value })} /></Field>
              <Field label={`Preview text (${label(k)})`}><input className={input} value={v.preheader} readOnly={!edit} maxLength={255} placeholder={main.preheader} onChange={(e) => put(k, { preheader: e.target.value })} /></Field>
            </div>
            <p className="m-0 mt-1 truncate text-[11.5px] text-ink-3">{v.body_html.trim() ? plainText(v.body_html).slice(0, 140) : 'No content of its own yet: readers get the main content.'}</p>
          </div>
        ))}
      </div>
      {edit ? (
        <div className="mt-2 flex items-end gap-2">
          <span className="w-[220px]"><Select aria-label="Add a language" value={add} onValueChange={setAdd} placeholder="Add a language…" options={LANGUAGES.filter((l) => !langs.includes(l.value))} /></span>
          <button type="button" className={btnSmall} disabled={!add} onClick={() => { onChange({ ...value, [add]: { subject: '', preheader: '', body_html: main.body_html } }); setAdd(''); }}>Add</button>
        </div>
      ) : null}
      {editing && open ? (
        <Sheet title={`Content in ${label(editing)}`} onClose={() => setEditing(null)} width={1100} footer={<button type="button" className={btnPrimary} onClick={() => setEditing(null)}>Done</button>}>
          <BlockEditor initial={open.body_html} onChange={(html) => put(editing, { body_html: html })} orgId={orgId} mergeTags={mergeTags} readOnly={!edit} companyName={company}
            alsoText={[open.subject || main.subject, open.preheader || main.preheader]} />
        </Sheet>
      ) : null}
    </Card>
  );
}

/* ================================================================== *
 * Repeating and feed campaigns (MKT-SND-13)
 * ================================================================== */

export const NO_REPEAT: Recurrence = { every: 'weekly', at: '09:00', weekday: 1, day: 1, until: null, feed_url: null, feed_items: 5, only_new: true };

export function RecurrenceCard({ campaign, value, onChange, edit, dirty, onChanged }: {
  campaign: CampaignDetail; value: Recurrence | null; onChange: (v: Recurrence | null) => void; edit: boolean; dirty: boolean; onChanged: Reload;
}) {
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const r = value;
  const set = (patch: Partial<Recurrence>) => onChange({ ...(r ?? NO_REPEAT), ...patch });
  const repeating = campaign.status === 'recurring';

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      return await send<{ items?: FeedItem[] }>('POST', path, body);
    } catch (e) {
      toast('error', refusal(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const startStop = async (on: boolean) => {
    const res = await act(`/api/marketing/campaigns/${campaign.id}/recurrence/${on ? 'start' : 'stop'}`);
    if (res) {
      toast('success', res.message ?? 'Done.');
      await onChanged();
    }
  };

  return (
    <Card title="Repeat" action={repeating ? <Pill tone="violet">Repeating</Pill> : undefined}>
      <label className="flex items-center gap-2 text-[12.5px] text-ink">
        <Checkbox checked={!!r} disabled={!edit || repeating} onChange={(e) => onChange(e.target.checked ? NO_REPEAT : null)} />
        Send it again on a schedule — a newsletter every week, or what is new in a feed
      </label>
      {r ? (
        <div className="mt-2.5 grid gap-2.5 border-t border-line pt-2.5 sm:grid-cols-3">
          <Field label="Every">
            <Select aria-label="Repeats every" value={r.every} disabled={!edit} onValueChange={(v) => set({ every: v as Recurrence['every'] })}
              options={[{ value: 'daily', label: 'Day' }, { value: 'weekly', label: 'Week' }, { value: 'monthly', label: 'Month' }]} />
          </Field>
          {r.every === 'weekly' ? (
            <Field label="On"><Select aria-label="Weekday" value={String(r.weekday)} disabled={!edit} onValueChange={(v) => set({ weekday: Number(v) })} options={WEEKDAYS.map((w, i) => ({ value: String(i + 1), label: w }))} /></Field>
          ) : null}
          {r.every === 'monthly' ? <Field label="On day" hint="1 to 28."><input className={input} type="number" min={1} max={28} value={r.day} readOnly={!edit} onChange={(e) => set({ day: Number(e.target.value) || 1 })} /></Field> : null}
          <Field label="At" hint="The company's own time zone."><input className={input} type="time" value={r.at} readOnly={!edit} onChange={(e) => set({ at: e.target.value })} /></Field>
          <Field label="Until" hint="Empty: until stopped."><input className={input} type="date" value={r.until ?? ''} readOnly={!edit} onChange={(e) => set({ until: e.target.value || null })} /></Field>
          <Field label="Feed (RSS or Atom)" hint="Optional. Its newest items go where the content has its feed block, or at the end." className="sm:col-span-2">
            <span className="flex gap-2">
              <input className={input} type="url" value={r.feed_url ?? ''} readOnly={!edit} placeholder="https://example.com/blog/feed" onChange={(e) => set({ feed_url: e.target.value || null })} />
              <button type="button" className={btnSmall} disabled={!r.feed_url || busy} onClick={() => void act('/api/marketing/recurrence/feed-preview', { url: r.feed_url }).then((res) => { if (res) setFeed(res.data?.items ?? []); })}>Preview</button>
            </span>
          </Field>
          {r.feed_url ? (
            <>
              <Field label="Items per email"><input className={input} type="number" min={1} max={10} value={r.feed_items} readOnly={!edit} onChange={(e) => set({ feed_items: Number(e.target.value) || 5 })} /></Field>
              <label className="flex items-center gap-2 text-[12.5px] text-ink sm:col-span-2"><Checkbox checked={r.only_new} disabled={!edit} onChange={(e) => set({ only_new: e.target.checked })} />Only when there is something new</label>
            </>
          ) : null}
          {feed ? (
            <ul className="m-0 list-none p-0 text-[11.5px] sm:col-span-3">
              {feed.length === 0 ? <li className="text-ink-3">The feed has no items.</li> : feed.slice(0, 5).map((i) => <li key={i.link} className="truncate"><b className="text-ink">{i.title}</b> <span className="text-ink-3">· {i.date}</span></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {r || repeating ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          {repeating ? (
            <>
              <span className="text-[12.5px] text-ink-2">Next run {stamp(campaign.next_run_at ?? null)}.</span>
              <button type="button" className={btnBad} disabled={busy} onClick={() => void startStop(false)}>Stop repeating</button>
            </>
          ) : campaign.can.launch ? (
            <button type="button" className={btnPrimary} disabled={dirty || busy} title={dirty ? 'Save first' : undefined} onClick={() => void startStop(true)}>Start repeating</button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/* ================================================================== *
 * Saved blocks (MKT-EDT-07), who sees each block (MKT-EDT-08)
 * ================================================================== */

function blockLabel(b: Block): string {
  switch (b.type) {
    case 'text': return plainText(b.html).slice(0, 80) || 'Text';
    case 'image': return b.alt ? `Picture: ${b.alt}` : 'Picture';
    case 'button': return `Button: ${b.label}`;
    case 'columns': return 'Two columns';
    case 'divider': return 'Divider';
    default: return 'HTML';
  }
}

interface SavedBlock { id: number; org_id: number; name: string; kind: string; kind_label: string; html: string }

export function SavedBlocksMenu({ orgId, body, edit, onInsert, onBody }: { orgId: number; body: string; edit: boolean; onInsert: (html: string) => void; onBody: (html: string) => void }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [dynamic, setDynamic] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'blocks'],
    queryFn: ({ signal }) => apiGet<{ items: SavedBlock[]; kinds: Array<{ value: string; label: string }> }>('/api/marketing/blocks', undefined, signal),
  });
  const mine = (q.data?.items ?? []).filter((b) => b.org_id === orgId);
  if (!edit) return null;
  return (
    <>
      <span className="w-[200px]">
        <Select aria-label="Insert a saved block" className="h-[30px]" value="" placeholder={mine.length ? 'Insert a saved block…' : 'No saved blocks yet'}
          options={mine.map((b) => ({ value: String(b.id), label: `${b.name} · ${b.kind_label}` }))}
          onValueChange={(v) => { const b = mine.find((x) => String(x.id) === v); if (b) { onInsert(b.html); toast('success', `“${b.name}” added at the end.`); } }} />
      </span>
      <button type="button" className={btnSmall} onClick={() => setSaving(true)}>Save a block</button>
      <button type="button" className={btnSmall} onClick={() => setDynamic(true)}>Who sees each block</button>
      {saving ? <SaveBlock orgId={orgId} body={body} kinds={q.data?.kinds ?? []} onClose={() => setSaving(false)} onSaved={() => void qc.invalidateQueries({ queryKey: ['marketing', 'blocks'] })} /> : null}
      {dynamic ? <DynamicContent orgId={orgId} body={body} onClose={() => setDynamic(false)} onApply={onBody} /> : null}
    </>
  );
}

function SaveBlock({ orgId, body, kinds, onClose, onSaved }: { orgId: number; body: string; kinds: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void }) {
  const blocks = parseBlocks(body);
  const [pick, setPick] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('header');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const html = serializeBlocks(blocks.filter((b) => pick.includes(b.id)).map((b) => ({ ...b, rule: undefined })));
      const r = await send('POST', '/api/marketing/blocks', { org_id: orgId, name, kind, html });
      toast('success', r.message ?? 'Saved.');
      onSaved();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Save a block" onClose={onClose}
      footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={busy || !name.trim() || !pick.length} onClick={() => void go()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <p className="m-0 text-[12px] text-ink-3">For every campaign of this company: a header, a footer, a product card.</p>
      <Field label="Name"><input className={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Kind"><Select aria-label="Kind of block" value={kind} onValueChange={setKind} options={kinds.length ? kinds : [{ value: 'header', label: 'Header' }, { value: 'footer', label: 'Footer' }, { value: 'product', label: 'Product card' }, { value: 'other', label: 'Other' }]} /></Field>
      <b className="text-[12.5px] text-ink">Which of the email’s blocks</b>
      {blocks.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">The email has no blocks yet.</p> : blocks.map((b) => (
        <label key={b.id} className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={pick.includes(b.id)} onChange={() => setPick((p) => (p.includes(b.id) ? p.filter((x) => x !== b.id) : [...p, b.id]))} />
          <span className="truncate">{blockLabel(b)}</span>
        </label>
      ))}
    </Sheet>
  );
}

function DynamicContent({ orgId, body, onClose, onApply }: { orgId: number; body: string; onClose: () => void; onApply: (html: string) => void }) {
  const segments = useSegmentNames(String(orgId));
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(body));
  const segs = (segments.data?.items ?? []).filter((s) => s.org_id === orgId);
  const options = [{ value: '', label: 'Everybody' }, ...segs.flatMap((s) => [{ value: `show:${s.id}`, label: `Only ${s.name}` }, { value: `hide:${s.id}`, label: `Everybody but ${s.name}` }])];
  return (
    <Sheet title="Who sees each block" onClose={onClose} width={640}
      footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} onClick={() => { onApply(serializeBlocks(blocks)); onClose(); }}>Apply</button></>}>
      <p className="m-0 text-[12px] text-ink-3">Each copy is cut for its reader when it is sent.</p>
      {blocks.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">The email has no blocks yet.</p> : blocks.map((b) => (
        <div key={b.id} className="flex items-center gap-3 border-b border-line py-1.5">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{blockLabel(b)}</span>
          {b.type === 'html' ? <span className="text-[11.5px] text-ink-3">HTML blocks are shown to everybody</span> : (
            <span className="w-[240px]">
              <Select aria-label={`Who sees: ${blockLabel(b)}`} className="h-[30px]" value={b.rule ? `${b.rule.mode}:${b.rule.segment}` : ''} options={options}
                onValueChange={(v) => setBlocks((all) => all.map((x) => {
                  if (x.id !== b.id) return x;
                  const [mode, seg] = v.split(':');
                  return { ...x, rule: v ? { mode: mode === 'hide' ? 'hide' : 'show', segment: Number(seg) } : undefined } as Block;
                }))} />
            </span>
          )}
        </div>
      ))}
    </Sheet>
  );
}

/* ================================================================== *
 * Re-permission (MKT-CON-08)
 * ================================================================== */

export function RepermissionCard({ orgId, canCreate, onOpen }: { orgId: number | null; canCreate: boolean; onOpen?: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await send<{ id?: number }>('POST', '/api/marketing/campaigns/repermission', { org_id: orgId ?? undefined });
      toast('success', 'A re-permission campaign was written as a draft. Choose who it asks, then review it.');
      if (r.data?.id && onOpen) onOpen(r.data.id);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Re-permission">
      <p className="m-0 text-[12.5px] text-ink-2">A re-permission campaign goes only to people whose email consent is unknown or expired, asking them to confirm with one click. Each answer is a new entry in the ledger; nobody who withdrew is asked.</p>
      {canCreate ? <button type="button" className={cx(btnSmall, 'mt-2.5')} disabled={busy} onClick={() => void go()}>{busy ? 'Writing…' : 'Create a re-permission campaign'}</button> : null}
    </Card>
  );
}

/* ================================================================== *
 * Call script versions (MKT-CAL-07)
 * ================================================================== */

export function ScriptVersions({ scriptId, name, canManage, words, onClose, onRestored }: {
  scriptId: number; name: string; canManage: boolean; words: Record<string, string>; onClose: () => void; onRestored: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['marketing', 'script-versions', scriptId],
    queryFn: ({ signal }) => apiGet<{ items: ScriptVersionRow[] }>(`/api/marketing/calls/scripts/${scriptId}/versions`, undefined, signal),
  });
  const items = q.data?.items ?? [];
  const shown = items.find((v) => v.id === open) ?? items[0];
  const restore = async () => {
    if (!shown) return;
    try {
      const r = await send('POST', `/api/marketing/calls/scripts/${scriptId}/versions/${shown.id}/restore`);
      toast('success', r.message ?? 'Restored.');
      onRestored();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <Sheet title={`Versions of “${name}”`} onClose={onClose} width={820}
      footer={<><button type="button" className={btn} onClick={onClose}>Close</button>{canManage && shown && shown.id !== items[0]?.id ? <button type="button" className={btnPrimary} onClick={() => void restore()}>Restore this version</button> : null}</>}>
      <p className="m-0 text-[12px] text-ink-3">Each call records the version the agent had in front of them.</p>
      {q.isLoading ? <Spinner label="Loading versions…" /> : items.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">No versions recorded yet.</p> : (
        <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {items.map((v) => (
              <li key={v.id}>
                <button type="button" aria-pressed={shown?.id === v.id} onClick={() => setOpen(v.id)} className={cx('w-full rounded-[8px] border px-2.5 py-1.5 text-left text-[12.5px]', shown?.id === v.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
                  <b className="block text-ink">Version {v.version}</b>
                  <span className="block text-[11.5px] text-ink-3">{stamp(v.created_at)}{v.by ? ` · ${v.by}` : ''}</span>
                  <span className="block text-[11.5px] text-ink-2">{v.calls} call(s){v.positive_rate !== null ? ` · ${v.positive_rate}% interested or better` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          {shown ? (
            <div className="flex min-w-0 flex-col gap-2">
              {Object.entries(shown.sections).filter(([, t]) => t.trim() !== '').map(([k, t]) => (
                <div key={k}><b className="block text-[11.5px] text-ink-3">{words[k] ?? k}</b><p className="m-0 text-[12.5px] whitespace-pre-wrap text-ink">{t}</p></div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
