import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { send } from './api';
import { BlockEditor } from './email-BlockEditor';
import { AiCopySheet } from './automation-parts';
import { bodyOf, draftOf, type Draft, type SetDraft } from './email-draft';
import { Confirm, Tabs, stamp, useTemplates, useTopics, wallWords } from './email-kit';
import { ReportView } from './email-Report';
import { ReviewStep, SendTest } from './email-Review';
import { SetupStep } from './email-Setup';
import { ApprovalBar, DeliverabilityPanel, LanguagesCard, RecurrenceCard, SavedBlocksMenu, VersionHistory } from './email-governance';
import { Card, Field, Seg, Sheet, btn, btnPrimary, btnSmall, input } from './parts';
import { fieldErrors, refusal, type CampaignCheck, type CampaignDetail, type Options } from './types';

/**
 * One email campaign: written in three steps while it can still change — a
 * draft, or scheduled and not yet started — Setup, Content (DK07) and
 * Review & send (DK08); and from the moment it starts, its report (DK09).
 *
 * A draft saves itself two seconds after the last change ("autosaved 09:41"),
 * so what the review checks is what was typed. A scheduled campaign does not:
 * changing one takes it back to draft, to be checked and scheduled again, so
 * that is a Save somebody presses on purpose.
 */
type Step = 'setup' | 'content' | 'review';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'setup', label: 'Setup' },
  { id: 'content', label: 'Content' },
  { id: 'review', label: 'Review & send' },
];

export default function CampaignView({ id, options, step, onStep, onBack, onOpen }: { id: number; options: Options; step: string | null; onStep: (step: string) => void; onBack: () => void; onOpen: (id: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'campaign', id],
    queryFn: ({ signal }) => apiGet<CampaignDetail>(`/api/marketing/campaigns/${id}`, undefined, signal),
    retry: false,
  });

  if (q.isLoading) return <Spinner label="Loading the campaign…" />;
  if (!q.data) {
    return (
      <div className="flex flex-col items-start gap-2">
        <ErrorNote error={new Error(refusal(q.error, 'That campaign could not be loaded.'))} onRetry={() => void q.refetch()} />
        <button type="button" className={btn} onClick={onBack}>
          All campaigns
        </button>
      </div>
    );
  }

  const c = q.data;
  const writing = (c.status === 'draft' || c.status === 'scheduled' || c.status === 'recurring') && step !== 'report';
  /* Keyed by the campaign alone: a save refreshes what the editor is given without throwing away what is on screen. */
  return writing ? (
    <Editor key={c.id} campaign={c} options={options} step={step === 'setup' || step === 'review' ? step : 'content'} onStep={onStep} onBack={onBack} />
  ) : (
    <ReportView campaign={c} options={options} onBack={onBack} onOpen={onOpen} />
  );
}

function Editor({ campaign, options, step, onStep, onBack }: { campaign: CampaignDetail; options: Options; step: Step; onStep: (step: string) => void; onBack: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(campaign, options));
  /** Changes made, and changes the server has: unsaved while they differ. */
  const [rev, setRev] = useState(0);
  const [savedRev, setSavedRev] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [version, setVersion] = useState<'a' | 'b'>('a');
  const [drafting, setDrafting] = useState(false);
  /** Bumped when the content is replaced from outside the editor (a template), so the editor reads it again. */
  const [seed, setSeed] = useState(0);
  const [replacing, setReplacing] = useState<{ subject: string; preheader: string; body_html: string } | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [history, setHistory] = useState(false);
  const edit = campaign.can.edit;
  const auto = campaign.status === 'draft' && edit;
  const dirty = rev > savedRev;

  const set: SetDraft = (k, v) => {
    setD((x) => ({ ...x, [k]: v }));
    setRev((r) => r + 1);
    setProblem(null);
  };

  const check = useQuery({
    queryKey: ['marketing', 'campaign-check', campaign.id, campaign.updated_at],
    queryFn: ({ signal }) => apiGet<CampaignCheck>(`/api/marketing/campaigns/${campaign.id}/check`, undefined, signal),
    enabled: step !== 'content' || testing,
    retry: false,
  });
  const topics = useTopics(String(campaign.org_id));
  const topicName = (topics.data?.items ?? []).find((t) => String(t.id) === d.topic_id)?.name ?? null;

  const save = async (): Promise<boolean> => {
    if (saving) return false;
    const at = rev;
    setSaving(true);
    try {
      const r = await send('PUT', `/api/marketing/campaigns/${campaign.id}`, bodyOf(d));
      setSavedRev((s) => Math.max(s, at));
      setSavedAt(timeLabel(new Date().toISOString()));
      setProblem(null);
      setErrors({});
      if (!auto) toast('success', r.message ?? 'Saved.');
      void qc.invalidateQueries({ queryKey: ['marketing', 'campaign', campaign.id] });
      void qc.invalidateQueries({ queryKey: ['marketing', 'campaigns'] });
      return true;
    } catch (e) {
      setErrors(fieldErrors(e));
      setProblem(refusal(e));
      if (!auto) toast('error', refusal(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * The server changed the campaign — a version restored, a deliverability
   * fix, an approval — so the editor reads it again. Offered only with
   * nothing unsaved, so nothing typed is lost.
   */
  const reload = async () => {
    const fresh = await qc.fetchQuery({
      queryKey: ['marketing', 'campaign', campaign.id],
      queryFn: ({ signal }) => apiGet<CampaignDetail>(`/api/marketing/campaigns/${campaign.id}`, undefined, signal),
      staleTime: 0,
    });
    setD(draftOf(fresh, options));
    setRev((r) => {
      setSavedRev(r + 1);
      return r + 1;
    });
    setSeed((s) => s + 1);
    void qc.invalidateQueries({ queryKey: ['marketing', 'campaigns'] });
    void qc.invalidateQueries({ queryKey: ['marketing', 'campaign-check', campaign.id] });
  };

  /* A draft saves itself two seconds after the last change; a refusal waits for the next change. */
  useEffect(() => {
    if (!auto || !dirty || saving || problem) return;
    const t = setTimeout(() => void save(), 2000);
    return () => clearTimeout(t);
  });

  const go = (s: Step) => {
    if (s === 'review' && dirty && auto) void save();
    onStep(s);
  };

  const openTest = () => {
    if (dirty && auto) void save();
    setTesting(true);
  };

  const status = campaign.status === 'scheduled' ? 'Scheduled' : 'Draft';
  const caption = saving ? 'saving…' : problem ? 'not saved' : dirty ? (auto ? 'changes waiting to save' : 'not saved') : savedAt ? `autosaved ${savedAt}` : `changed ${stamp(campaign.updated_at)}`;
  const onB = d.ab_on && d.b_own && version === 'b';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-line bg-surface px-3 py-2">
        <button type="button" onClick={onBack} aria-label="All campaigns" title="All campaigns" className="flex size-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
          <Icon name="chevron-left" size={16} />
        </button>
        <div className="min-w-0 flex-[1_1_200px]">
          <p className="m-0 truncate text-[11.5px] text-ink-3" aria-live="polite">
            Email campaign · {status} · {caption}
          </p>
          <h1 className="m-0 truncate text-[16px] leading-tight font-bold text-ink">{d.name || 'Untitled campaign'}</h1>
        </div>
        <Tabs label="Steps" items={STEPS} value={step} onChange={go} className="flex-[1_1_auto] justify-center" />
        <div className="flex flex-[1_1_200px] flex-wrap justify-end gap-2">
          {!auto && edit && dirty ? (
            <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
          <button type="button" className={btn} disabled={dirty} title={dirty ? 'Save first' : undefined} onClick={() => setHistory(true)}>
            History
          </button>
          {edit ? (
            <button type="button" className={btn} onClick={openTest}>
              <Icon name="send" size={15} /> Send test
            </button>
          ) : null}
          {step !== 'review' ? (
            <button type="button" className={btnPrimary} onClick={() => go('review')}>
              <Icon name="chevron-right" size={15} /> Review
            </button>
          ) : null}
        </div>
      </div>

      {campaign.status === 'scheduled' ? (
        <p role="status" className="m-0 rounded-[10px] border border-primary/30 bg-selection px-3.5 py-2.5 text-[12.5px] text-primary">
          {campaign.local_time && campaign.local_at ? `Scheduled to arrive at ${wallWords(campaign.local_at)} in each person’s own time zone.` : `Scheduled to go ${stamp(campaign.scheduled_at)}.`} Changing it takes it back to draft, to be checked and scheduled again.
        </p>
      ) : campaign.status_note ? (
        <p role="status" className="m-0 rounded-[10px] border border-[#F5D9A8] bg-[#FFF9EE] px-3.5 py-2.5 text-[12.5px] text-[#9A4A06] dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          {campaign.status_note}
        </p>
      ) : null}
      <ApprovalBar campaign={campaign} dirty={dirty} onChanged={reload} />
      {!edit ? <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-2.5 text-[12.5px] text-ink-2">You can read this campaign; changing it needs permission to edit campaigns.</p> : null}
      {problem ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger">
          <span className="min-w-0 flex-1">Not saved: {problem}</span>
          <button type="button" className={btnSmall} onClick={() => void save()}>
            Try again
          </button>
        </p>
      ) : null}

      {step === 'setup' ? (
        <div className="flex flex-col gap-4">
          <SetupStep orgId={campaign.org_id} d={d} set={set} errors={errors} options={options} edit={edit} check={check.data} checking={check.isFetching} dirty={dirty || saving} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <LanguagesCard value={d.variants} onChange={(v) => set('variants', v)} edit={edit} orgId={campaign.org_id} mergeTags={options.merge_tags ?? []}
                company={options.companies.find((x) => x.id === campaign.org_id)?.name} main={{ subject: d.subject, preheader: d.preheader, body_html: d.body_html }} />
              {errors.variants ? <p role="alert" className="m-0 text-[12px] text-danger">{errors.variants}</p> : null}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <RecurrenceCard campaign={campaign} value={d.recurrence} onChange={(v) => set('recurrence', v)} edit={edit} dirty={dirty || saving} onChanged={reload} />
              {errors.recurrence ? <p role="alert" className="m-0 text-[12px] text-danger">{errors.recurrence}</p> : null}
              <Card title="Daily cap & plain text">
                <Field label="Emails a day from this campaign, at most" hint="Empty: no cap of its own. Spreads a big send over days, as a warming-up domain needs.">
                  <input className={input} type="number" min={10} value={d.daily_cap} readOnly={!edit} onChange={(e) => set('daily_cap', e.target.value)} />
                </Field>
                {errors.daily_cap ? <p role="alert" className="m-0 text-[12px] text-danger">{errors.daily_cap}</p> : null}
                <Field label="Plain-text part" hint="Empty: made from the HTML for every copy. The unsubscribe link is added at its end either way." className="mt-2.5">
                  <textarea className={`${input} h-28 py-2`} value={d.text_body} readOnly={!edit} onChange={(e) => set('text_body', e.target.value)} />
                </Field>
                {errors.text_body ? <p role="alert" className="m-0 text-[12px] text-danger">{errors.text_body}</p> : null}
              </Card>
            </div>
          </div>
        </div>
      ) : step === 'review' ? (
        <ReviewStep campaign={campaign} d={d} set={set} errors={errors} options={options} check={check} dirty={dirty} saving={saving} autosave={auto} edit={edit} onStep={go} onTest={openTest}
          extra={<DeliverabilityPanel campaign={campaign} dirty={dirty || saving} onChanged={reload} />} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {d.ab_on && d.b_own ? <Seg label="Version" value={version} onChange={setVersion} options={[{ id: 'a', label: 'Version A' }, { id: 'b', label: 'Version B' }]} /> : null}
            {d.ab_on && !d.b_own ? <span className="text-[12px] text-ink-3">Version B says what A says; give it its own content under Setup › A/B test.</span> : null}
            {edit && !onB ? (
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <TemplatePicker orgId={campaign.org_id} onPick={setReplacing} />
                <SavedBlocksMenu orgId={campaign.org_id} body={d.body_html} edit={edit}
                  onInsert={(html) => { set('body_html', d.body_html + html); setSeed((s) => s + 1); }}
                  onBody={(html) => { set('body_html', html); setSeed((s) => s + 1); }} />
                {campaign.can.templates ? (
                  <button type="button" className={btnSmall} onClick={() => setSavingTemplate(true)}>
                    Save as a template
                  </button>
                ) : null}
                {/* WS-C (MKT-AI-01): a draft from a brief, used only when "Use this" is pressed. */}
                <button type="button" className={btnSmall} onClick={() => setDrafting(true)}>Draft with AI</button>
              </span>
            ) : null}
          </div>
          {errors.body_html ? <p role="alert" className="m-0 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger">{errors.body_html}</p> : null}
          <BlockEditor
            key={`${onB ? 'b' : 'a'}-${seed}`}
            initial={onB ? d.b_body_html : d.body_html}
            onChange={(html) => set(onB ? 'b_body_html' : 'body_html', html)}
            orgId={campaign.org_id}
            mergeTags={options.merge_tags ?? []}
            readOnly={!edit}
            companyName={options.companies.find((x) => x.id === campaign.org_id)?.name}
            topicName={topicName}
            alsoText={onB ? [d.b_subject || d.subject, d.b_preheader || d.preheader] : [d.subject, d.preheader]}
          />
        </div>
      )}

      {testing ? <SendTest campaign={campaign} limit={check.data?.test_limit ?? options.sending?.test_limit ?? 5} sample={check.data?.audience.sample ?? null} onClose={() => setTesting(false)} /> : null}
      {replacing ? (
        <Confirm
          title="Start again from this template?"
          yes="Replace"
          onClose={() => setReplacing(null)}
          onYes={() => {
            setD((x) => ({ ...x, subject: replacing.subject || x.subject, preheader: replacing.preheader || x.preheader, body_html: replacing.body_html }));
            setRev((r) => r + 1);
            setSeed((s) => s + 1);
            setVersion('a');
            setReplacing(null);
          }}
        >
          What is written now is replaced by the template, with its subject and preview text.{auto ? ' It saves itself as usual.' : ' It is not saved until you save.'}
        </Confirm>
      ) : null}
      {history ? <VersionHistory campaign={campaign} onClose={() => setHistory(false)} onRestored={reload} /> : null}
      {drafting ? (
        <AiCopySheet orgId={campaign.org_id} onClose={() => setDrafting(false)}
          onUse={(t) => {
            setD((x) => ({ ...x, subject: t.subject || x.subject, preheader: t.preheader || x.preheader, body_html: t.body_html }));
            setRev((r) => r + 1);
            setSeed((s) => s + 1);
            setVersion('a');
            setDrafting(false);
          }} />
      ) : null}
      {savingTemplate ? <SaveAsTemplate campaign={campaign} d={d} options={options} onClose={() => setSavingTemplate(false)} /> : null}
    </div>
  );
}

/** Start again from a starter or one of the company's templates. */
function TemplatePicker({ orgId, onPick }: { orgId: number; onPick: (t: { subject: string; preheader: string; body_html: string }) => void }) {
  const templates = useTemplates();
  const choices = [
    ...(templates.data?.starters ?? []).map((s) => ({ value: `s:${s.key}`, label: s.name, hint: s.subcategory_label ?? 'Starter' })),
    ...(templates.data?.items ?? []).filter((t) => t.org_id === orgId).map((t) => ({ value: `t:${t.id}`, label: t.name, hint: t.category_label })),
  ];
  const pick = (v: string) => {
    const [kind, key] = v.split(':');
    const s = kind === 's' ? templates.data?.starters.find((x) => x.key === key) : null;
    const t = kind === 't' ? templates.data?.items.find((x) => String(x.id) === key) : null;
    if (s) onPick({ subject: s.subject, preheader: s.preheader, body_html: s.body_html });
    else if (t) onPick({ subject: t.subject ?? '', preheader: t.preheader ?? '', body_html: t.body_html });
  };
  return (
    <span className="w-[230px]">
      <Select aria-label="Start again from a template" className="h-[30px]" value="" placeholder="Start again from a template…" onValueChange={pick} options={choices} disabled={templates.isLoading} />
    </span>
  );
}

function SaveAsTemplate({ campaign, d, options, onClose }: { campaign: CampaignDetail; d: Draft; options: Options; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(d.name);
  const [category, setCategory] = useState('custom');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await send('POST', '/api/marketing/templates', { org_id: campaign.org_id, name: name.trim(), category, subject: d.subject, preheader: d.preheader, body_html: d.body_html });
      toast('success', r.message ?? 'Saved as a template.');
      void qc.invalidateQueries({ queryKey: ['marketing', 'templates'] });
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Save as a template"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !name.trim()} onClick={() => void go()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-3">Its subject, preview text and content, to start other campaigns from. A campaign made from it keeps its own copy.</p>
      <Field label="Name">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
      </Field>
      {(options.template_categories ?? []).length ? (
        <Field label="Kind">
          <Select aria-label="Kind" value={category} onValueChange={setCategory} options={options.template_categories ?? []} />
        </Field>
      ) : null}
    </Sheet>
  );
}
