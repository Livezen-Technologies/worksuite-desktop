import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, cx } from '../../../components/ui';
import { createCampaign, fetchContent, MK, saveContent, useLists, useSegments, useTemplates, useTopics, type Block, type Content } from '../api';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, PageBody, PageHeader, Panel, useAction } from '../parts';
import { asBlocks, blocksToPlainText, cloneBlocks } from '../lib/blocks';
import { count, day, plural } from '../lib/format';
import { EmailPreview, startOptions, type StartOption } from './Templates';
import { isEmail } from './TestSend';

/**
 * A new email campaign (WF-06 steps 1–3; MKT-EML-02/03, MKT-CON-04, MKT-EDT-01/02): its name, topic, audience —
 * lists and segments — and sender, then how it starts: one of the three starter layouts or a saved template
 * (`?template=<id>` from Templates comes chosen). "Create draft" makes the campaign and opens its content. Also the
 * audience, topic and sender fields the editor's Setup step reuses.
 */

/* ------------------------------------------------------------------------ *
 * Fields shared with the editor's Setup
 * ------------------------------------------------------------------------ */

/** "That is not an email address" for a filled-in address that is not one; empty is allowed until the check. */
export function senderErrors(s: { from_email: string; reply_to: string }): { from_email: string | null; reply_to: string | null } {
  const bad = (v: string) => (v.trim() && !isEmail(v) ? 'That is not an email address.' : null);
  return { from_email: bad(s.from_email), reply_to: bad(s.reply_to) };
}

export function TopicField({ value, onChange, disabled }: { value: number | null; onChange: (id: number | null) => void; disabled?: boolean }) {
  const topics = useTopics();
  const options = [{ value: '', label: topics.isLoading ? 'Loading topics…' : 'No topic' }, ...(topics.data ?? []).map((t) => ({ value: String(t.id), label: t.name, hint: `${count(t.subscribers_count)} subscribed` }))];
  return (
    <Field label="Topic" hint="Campaigns target a topic; contacts not subscribed to it are excluded." error={topics.error ? `Topics could not be read: ${(topics.error as Error).message}` : null}>
      <Select value={value === null ? '' : String(value)} onValueChange={(v) => onChange(v ? Number(v) : null)} options={options} aria-label="Topic" disabled={disabled} />
    </Field>
  );
}

const toggle = (ids: number[], id: number) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

/** Lists and segments, ticked together (MKT-EML-02); exclusions are applied and shown at Review & send. */
export function AudiencePicker({ listIds, segmentIds, onChange, disabled }: { listIds: number[]; segmentIds: number[]; onChange: (p: { list_ids?: number[]; segment_ids?: number[] }) => void; disabled?: boolean }) {
  const lists = useLists();
  const segments = useSegments();
  const upTo = (lists.data ?? []).filter((l) => listIds.includes(l.id)).reduce((n, l) => n + l.members_count, 0) + (segments.data ?? []).filter((s) => segmentIds.includes(s.id)).reduce((n, s) => n + (s.count ?? 0), 0);
  const chosen = listIds.length + segmentIds.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[12px] font-semibold text-ink-2">Lists</legend>
          <Loaded q={lists} what="Lists">
            {(rows) =>
              rows.length === 0 ? (
                <p className="rounded-[8px] border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">No lists yet. Make one under Audience › Lists, or import contacts into one.</p>
              ) : (
                <ul className="flex max-h-[260px] flex-col overflow-y-auto rounded-[8px] border border-line scroll-thin">
                  {rows.map((l) => (
                    <li key={l.id} className="border-b border-line last:border-b-0">
                      <label className={cx('flex items-center gap-2.5 px-3 py-2', disabled ? 'opacity-70' : 'cursor-pointer hover:bg-subtle')}>
                        <Checkbox checked={listIds.includes(l.id)} disabled={disabled} onChange={() => onChange({ list_ids: toggle(listIds, l.id) })} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{l.name}</span>
                        <span className="shrink-0 text-right text-[11.5px] text-ink-3">
                          <Mono className="text-ink-2">{count(l.members_count)}</Mono>
                          {typeof l.email_subscribed_count === 'number' ? (
                            <>
                              {' · '}
                              <Mono>{count(l.email_subscribed_count)}</Mono> subscribed
                            </>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loaded>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[12px] font-semibold text-ink-2">Segments</legend>
          <Loaded q={segments} what="Segments">
            {(rows) =>
              rows.length === 0 ? (
                <p className="rounded-[8px] border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">No segments yet. A segment is a saved filter of contacts, made under Audience › Segments.</p>
              ) : (
                <ul className="flex max-h-[260px] flex-col overflow-y-auto rounded-[8px] border border-line scroll-thin">
                  {rows.map((s) => (
                    <li key={s.id} className="border-b border-line last:border-b-0">
                      <label className={cx('flex items-center gap-2.5 px-3 py-2', disabled ? 'opacity-70' : 'cursor-pointer hover:bg-subtle')}>
                        <Checkbox checked={segmentIds.includes(s.id)} disabled={disabled} onChange={() => onChange({ segment_ids: toggle(segmentIds, s.id) })} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
                        <Mono className="shrink-0 text-[11.5px] text-ink-2">{count(s.count)}</Mono>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loaded>
        </fieldset>
      </div>
      <p className="text-[12px] text-ink-3" aria-live="polite">
        {chosen === 0 ? (
          'Nothing chosen yet. A campaign with no audience cannot be scheduled.'
        ) : (
          <>
            {plural(listIds.length, 'list')} · {plural(segmentIds.length, 'segment')} · up to <Mono className="text-ink-2">{count(upTo)}</Mono> contacts before duplicates and exclusions
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Applies the chosen layout when the new campaign's content comes back empty — a server that does not know the
 * starter's name, say — so the editor opens on what the author picked. Content already there is left alone.
 */
async function seedContent(qc: QueryClient, org: string, id: number, blocks: readonly Block[]): Promise<void> {
  if (!blocks.length) return;
  try {
    const content = await fetchContent(id);
    if (asBlocks(content.blocks).length) {
      qc.setQueryData<Content>(MK.content(org, id), content);
      return;
    }
    const fresh = cloneBlocks(blocks);
    const plain = blocksToPlainText(fresh);
    const r = await saveContent(id, { blocks: fresh, plain_text: plain, version: content.version });
    qc.setQueryData<Content>(MK.content(org, id), { blocks: fresh, plain_text: plain, version: r.version, saved_at: r.saved_at });
  } catch {
    // The editor shows what the server has.
  }
}

/* ------------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------------ */

interface Form {
  name: string;
  topic_id: number | null;
  list_ids: number[];
  segment_ids: number[];
  from_name: string;
  from_email: string;
  reply_to: string;
}

export default function NewCampaign() {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go, query } = useTab();
  const templates = useTemplates();
  const [f, setF] = useState<Form>({ name: '', topic_id: null, list_ids: [], segment_ids: [], from_name: '', from_email: '', reply_to: '' });
  const [pick, setPick] = useState<string>(() => {
    const t = Number(query.get('template'));
    if (Number.isInteger(t) && t > 0) return `template:${t}`;
    return `starter:${query.get('starter') || 'newsletter'}`;
  });
  const [tried, setTried] = useState(false);
  const [busy, run] = useAction();
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const options = startOptions(templates.data);
  // A starter the server lists under its own name stands in for ours; a template from a stale link is said so.
  const chosen: StartOption | null = options.find((o) => o.key === pick || o.aliases.includes(pick)) ?? (pick.startsWith('starter:') ? (options[0] ?? null) : null);
  const goneTemplate = pick.startsWith('template:') && templates.isSuccess && !chosen;
  const errs = senderErrors(f);
  const invalid = !f.name.trim() || !!errs.from_email || !!errs.reply_to;

  const create = () => {
    setTried(true);
    if (invalid || !chosen) return;
    void run(
      'create',
      async () => {
        const input = {
          name: f.name.trim(),
          topic_id: f.topic_id,
          list_ids: f.list_ids,
          segment_ids: f.segment_ids,
          from_name: f.from_name.trim() || null,
          from_email: f.from_email.trim() || null,
          reply_to: f.reply_to.trim() || null,
        };
        const c = await createCampaign(org, chosen.template ? { ...input, template_id: chosen.template.id } : { ...input, starter: chosen.starter?.id ?? null });
        await seedContent(qc, org, c.id, chosen.blocks);
        void qc.invalidateQueries({ queryKey: ['marketing', 'campaigns'] });
        void qc.invalidateQueries({ queryKey: MK.dashboard(org) });
        go(`/marketing/campaigns/${c.id}/content`);
      },
      'Draft created.',
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Email"
        title="New campaign"
        sub="Name it, choose who it goes to and who it is from, then how it starts"
        actions={
          <>
            <Button onClick={() => go('/marketing/campaigns')}>Cancel</Button>
            <Button variant="primary" icon="check" loading={busy === 'create'} disabled={!chosen} onClick={create}>
              Create draft
            </Button>
          </>
        }
      />
      <PageBody>
        <form
          noValidate
          className="mx-auto flex w-full max-w-[1120px] flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Panel title="Campaign" sub="Only the name is needed now; all of it can change until the campaign is scheduled." bodyClassName="flex flex-col gap-3">
              <Field label="Name" error={tried && !f.name.trim() ? 'Give the campaign a name.' : null}>
                <Input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} placeholder="e.g. October service update" autoFocus aria-invalid={tried && !f.name.trim() ? true : undefined} />
              </Field>
              <TopicField value={f.topic_id} onChange={(topic_id) => set({ topic_id })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sender name" hint="Shown as who it is from.">
                  <Input value={f.from_name} onChange={(e) => set({ from_name: e.target.value })} maxLength={120} placeholder="Your company or team" />
                </Field>
                <Field label="From address" error={tried ? errs.from_email : null}>
                  <Input type="email" value={f.from_email} onChange={(e) => set({ from_email: e.target.value })} placeholder="news@company.lk" className="font-mono" />
                </Field>
              </div>
              <Field label="Reply-to" hint="Where replies go, when not to the from address." error={tried ? errs.reply_to : null}>
                <Input type="email" value={f.reply_to} onChange={(e) => set({ reply_to: e.target.value })} placeholder="hello@company.lk" className="font-mono" />
              </Field>
            </Panel>
            <Panel title="Audience" sub="Duplicates are removed, and anyone suppressed, unsubscribed or not subscribed to the topic is left out when it sends.">
              <AudiencePicker listIds={f.list_ids} segmentIds={f.segment_ids} onChange={set} />
            </Panel>
          </div>
          <Panel title="Start from" sub="One of three starter layouts, or a template your team saved. Everything can be changed in the editor.">
            {goneTemplate ? (
              <Notice tone="warning" className="mb-3">
                The template this link names is no longer there. Pick another way to start.
              </Notice>
            ) : null}
            <div role="group" aria-label="Start from" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(232px,1fr))]">
              {options.map((o) => {
                const on = chosen?.key === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPick(o.key)}
                    className={cx('flex min-w-0 flex-col gap-2.5 rounded-[12px] border bg-surface p-3 text-left transition-colors', on ? 'border-primary ring-2 ring-primary/25' : 'border-line hover:border-primary/40')}
                  >
                    <EmailPreview blocks={o.blocks} height={120} scale={0.34} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{o.label}</span>
                        {on ? <span className="text-[11px] font-semibold text-primary">Chosen</span> : null}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11.5px] text-ink-3">
                        {o.starter ? o.starter.description : o.template?.kind === 'starter' ? 'Starter layout' : `Saved template${o.template?.updated_at ? ` · ${day(o.template.updated_at)}` : ''}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {templates.isLoading ? <p className="mt-2 text-[12px] text-ink-3">Loading saved templates…</p> : templates.error ? <p className="mt-2 text-[12px] text-danger">Saved templates could not be read: {(templates.error as Error).message}</p> : null}
          </Panel>
          <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
            {tried && invalid ? <span className="text-[12px] text-danger">Fix the marked fields first.</span> : null}
            <Button type="submit" variant="primary" icon="check" loading={busy === 'create'} disabled={!chosen}>
              Create draft
            </Button>
          </div>
        </form>
      </PageBody>
    </div>
  );
}
