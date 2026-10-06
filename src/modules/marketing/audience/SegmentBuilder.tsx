import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Select, type SelectOption } from '../../../components/Select';
import { Button, cx, Empty, ErrorNote, IconButton, Modal, NumberField, Spinner } from '../../../components/ui';
import {
  fetchCampaigns,
  fetchSegment,
  fetchSnapshots,
  fetchSources,
  fetchTags,
  MK,
  NOT_OFFERED,
  previewSegment,
  saveSegment,
  scheduleSnapshot,
  segmentToList,
  useLists,
  useTopics,
  type Contact,
  type MatchMode,
  type MList,
  type Rule,
  type Segment,
  type SegmentPreview,
  type Snapshot,
} from '../api';
import { ago, count, day, isoDay, ratio, share } from '../lib/format';
import {
  BASELINE_FIELDS,
  canAddRule,
  cleanRule,
  emptyRule,
  fieldOf,
  FIELDS,
  GROUPS,
  MAX_DAYS,
  MAX_RULES,
  operatorOf,
  operatorsFor,
  plannedGroup,
  ruleProblem,
  validRule,
  valueKind,
  withField,
  withOperator,
  type SegmentField,
} from '../lib/segment';
import { useMarketingOrg } from '../org';
import { Bar, Field, Input, INPUT, Loaded, Notice, OptionalView, PageBody, PageHeader, Panel, Planned, Refused, TD, TH, Table, useAction } from '../parts';

/**
 * DK04 · Segment builder (W04; MKT-SEG-01..05, MKT-SEG-08; WF-04). A segment is up to 20 rules over 19 fields, all or
 * any of which must match; it stores rules, never members, and is counted again at preview, at scheduling and at send
 * (MKT-SEG-02). While editing, the count and a sample follow the rules (MKT-SEG-03, NFR-03: 2 s for 50,000), asked
 * 400 ms after the last change with only the rules that are complete. Suppressed and unsubscribed contacts are always
 * left out at send (MKT-SEG-04). A saved segment can be kept once as a static list (MKT-SEG-05); a schedule that
 * snapshots it into a list (MKT-SEG-08) is offered where the server has it.
 */
export default function SegmentBuilder({ id }: { id: number | null }) {
  const org = useMarketingOrg();
  const { go } = useTab();
  const seg = useQuery({ queryKey: MK.segment(org, id ?? 0), queryFn: ({ signal }) => fetchSegment(id ?? 0, signal), enabled: id !== null });
  if (id !== null && !seg.data) {
    // The segments routes are built, so a 404 here is a segment that is gone or another company's (C5), not a missing route.
    const gone = seg.error instanceof ApiError && seg.error.status === 404;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader crumb={<Crumb go={go} />} title="Segment" />
        <PageBody>
          {gone ? (
            <Empty
              icon="filter"
              title="This segment isn’t here"
              hint="It may have been deleted, or it belongs to another company."
              action={
                <Button className="mt-1" onClick={() => go('/marketing/segments')}>
                  All segments
                </Button>
              }
            />
          ) : (
            <Loaded q={seg} what="This segment">
              {() => null}
            </Loaded>
          )}
        </PageBody>
      </div>
    );
  }
  return <Builder key={id ?? 'new'} id={id} initial={id !== null ? (seg.data ?? null) : null} />;
}

function Crumb({ go }: { go: (route: string) => void }) {
  return (
    <>
      Marketing /{' '}
      <button type="button" onClick={() => go('/marketing/segments')} className="font-medium text-ink-3 hover:text-primary hover:underline">
        Segments
      </button>
    </>
  );
}

/** A rule with a key of its own, so removing one keeps the others' inputs where they are. */
interface Line {
  uid: number;
  rule: Rule;
}

let seq = 0;
const line = (rule: Rule): Line => ({ uid: ++seq, rule });

const fingerprint = (name: string, match: MatchMode, rules: readonly Rule[]) => JSON.stringify([name.trim(), match, rules.map(cleanRule)]);

const MATCH: Array<SelectOption<MatchMode>> = [
  { value: 'all', label: 'all' },
  { value: 'any', label: 'any' },
];

/** The preview's sample may say when each contact last opened. */
type Sampled = Contact & { last_open_at?: string | null };

function lastOpen(c: Sampled): string {
  const at = c.last_open_at ?? (c.last_activity?.kind === 'open' ? c.last_activity.at : null);
  return at ? ago(at) || '—' : '—';
}

function Builder({ id, initial }: { id: number | null; initial: Segment | null }) {
  const org = useMarketingOrg();
  const { go } = useTab();
  const qc = useQueryClient();
  const [busy, run] = useAction();
  const [name, setName] = useState(initial?.name ?? 'New segment');
  const [match, setMatch] = useState<MatchMode>(initial?.match === 'any' ? 'any' : 'all');
  const [lines, setLines] = useState<Line[]>(() => (initial ? (initial.rules ?? []) : [emptyRule('tag')]).map(line));
  const [saved, setSaved] = useState(() => (initial ? fingerprint(initial.name, initial.match, initial.rules ?? []) : null));
  const [refused, setRefused] = useState(false);
  const [tried, setTried] = useState(false);
  const [asList, setAsList] = useState<string | null>(null);
  const [madeList, setMadeList] = useState<MList | null>(null);
  const tagList = useId();
  const sourceList = useId();

  const rules = useMemo(() => lines.map((l) => l.rule), [lines]);
  const complete = useMemo(() => rules.filter(validRule).map(cleanRule), [rules]);
  const incomplete = rules.length - complete.length;
  const dirty = fingerprint(name, match, rules) !== saved;
  const problem = !name.trim() ? 'Name the segment.' : rules.length === 0 ? 'Add at least one rule.' : incomplete ? 'Complete or remove the rules marked in red.' : null;

  // The live count (MKT-SEG-03): the complete rules, asked once the editing pauses.
  const payload = useMemo(() => ({ match, rules: complete }), [match, complete]);
  const [asked, setAsked] = useState(payload);
  useEffect(() => {
    const t = setTimeout(() => setAsked(payload), 400);
    return () => clearTimeout(t);
  }, [payload]);
  const preview = useQuery({
    queryKey: [...MK.segments(org), 'preview', asked],
    queryFn: ({ signal }) => previewSegment(org, asked, signal),
    placeholderData: keepPreviousData,
    enabled: asked.rules.length > 0,
  });
  const ready = complete.length > 0;
  const shown = ready ? preview.data : undefined;
  const counting = ready && (preview.isFetching || JSON.stringify(asked) !== JSON.stringify(payload));

  // What the value pickers offer.
  const uses = (pick: (f: SegmentField) => boolean) => rules.some((r) => {
    const f = fieldOf(r.field);
    return !!f && pick(f);
  });
  const lists = useLists();
  const topics = useTopics();
  const campaigns = useQuery({ queryKey: MK.campaigns(org, {}), queryFn: ({ signal }) => fetchCampaigns(org, {}, signal), enabled: uses((f) => f.type === 'campaign'), staleTime: 60_000 });
  const tags = useQuery({ queryKey: MK.tags(org), queryFn: ({ signal }) => fetchTags(org, signal), enabled: uses((f) => f.type === 'tag'), staleTime: 60_000 });
  const sources = useQuery({ queryKey: MK.sources(org), queryFn: ({ signal }) => fetchSources(org, signal), enabled: uses((f) => f.key === 'source'), staleTime: 60_000 });
  const refOptions = (f: SegmentField): Array<SelectOption<string>> =>
    f.type === 'list'
      ? (lists.data ?? []).map((l) => ({ value: String(l.id), label: l.name, hint: `${count(l.members_count)} members` }))
      : f.type === 'topic'
        ? (topics.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))
        : (campaigns.data?.rows ?? []).filter((c) => c.sent_count > 0 || c.status === 'sending' || c.status === 'paused' || c.status === 'sent').map((c) => ({ value: String(c.id), label: c.name }));

  const change = (uid: number, rule: Rule) => setLines((ls) => ls.map((l) => (l.uid === uid ? { uid, rule } : l)));
  const remove = (uid: number) => setLines((ls) => ls.filter((l) => l.uid !== uid));
  const add = () => {
    // WF-04 step 3: the editor refuses a 21st rule.
    if (!canAddRule(lines)) {
      setRefused(true);
      return;
    }
    const next = line(emptyRule('tag'));
    setRefused(false);
    setLines((ls) => [...ls, next]);
  };

  const save = async () => {
    if (problem) {
      setTried(true);
      return;
    }
    const input = { name: name.trim(), match, rules: rules.map(cleanRule) };
    await run(
      'save',
      async () => {
        const s = await saveSegment(org, id, input);
        setSaved(fingerprint(input.name, input.match, input.rules));
        setTried(false);
        qc.setQueryData(MK.segment(org, s.id), s);
        void qc.invalidateQueries({ queryKey: MK.segments(org), exact: true });
        if (id === null) go(`/marketing/segments/${s.id}`);
      },
      'Segment saved.',
    );
  };

  const made = (list: MList) => {
    setAsList(null);
    setMadeList(list);
    toast('success', `Saved as the list “${list.name}”.`, { label: 'Open list', run: () => go(`/marketing/lists/${list.id}`) });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={<Crumb go={go} />}
        title={
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Segment name"
            placeholder="Segment name"
            maxLength={150}
            className="-mx-1 w-full min-w-0 rounded-[6px] border border-transparent bg-transparent px-1 text-[19px] leading-tight font-bold text-ink outline-none placeholder:text-ink-3 hover:border-line focus:border-primary"
          />
        }
        sub="Live segment · re-evaluated every time it is used"
        actions={
          <>
            <Button
              icon="list"
              disabled={id === null || dirty}
              title={id === null ? 'Save the segment first' : dirty ? 'Save your changes first: the list is made from the saved rules' : 'Keep the contacts who match now as a static list'}
              onClick={() => setAsList(`${name.trim()} · ${day(isoDay(new Date()))}`)}
            >
              Save as list
            </Button>
            <Button variant="primary" icon="check" loading={busy === 'save'} onClick={() => void save()}>
              Save segment
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            {madeList ? (
              <Notice
                tone="success"
                icon="check-circle"
                action={
                  <Button size="sm" onClick={() => go(`/marketing/lists/${madeList.id}`)}>
                    Open list
                  </Button>
                }
              >
                Saved {count(madeList.members_count)} contacts as the list <b>“{madeList.name}”</b>. The list stays as it is when contacts change.
              </Notice>
            ) : null}
            {tried && problem ? <Notice tone="warning">{problem}</Notice> : null}
            <Panel title="Rules">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                  <span>Match</span>
                  <Select value={match} onValueChange={setMatch} options={MATCH} aria-label="Match all or any of the rules" className="h-8 w-[76px]" />
                  <span>of the following rules</span>
                </div>
                <span className="text-[11.5px] text-ink-3">{`${lines.length} of ${MAX_RULES} rules · ${BASELINE_FIELDS} fields available`}</span>
              </div>
              {lines.length ? (
                <div className="flex flex-col gap-2">
                  {lines.map((l, i) => (
                    <RuleRow
                      key={l.uid}
                      index={i}
                      rule={l.rule}
                      tried={tried}
                      refOptions={refOptions}
                      datalist={l.rule.field === 'tag' ? tagList : l.rule.field === 'source' ? sourceList : undefined}
                      onChange={(r) => change(l.uid, r)}
                      onRemove={() => remove(l.uid)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-ink-3">No rules yet. Add one — for example Tag includes vendor.</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Button size="sm" icon="plus" onClick={add}>
                  Add rule
                </Button>
                {refused && !canAddRule(lines) ? (
                  <span role="alert" className="text-[12px] font-medium text-danger">
                    {`A segment can have at most ${MAX_RULES} rules. Remove one to add another.`}
                  </span>
                ) : incomplete && !tried ? (
                  <span className="text-[12px] text-ink-3">{incomplete === 1 ? 'One rule is not complete yet; it is left out of the count.' : `${incomplete} rules are not complete yet; they are left out of the count.`}</span>
                ) : null}
              </div>
              <datalist id={tagList}>
                {(tags.data ?? []).map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <datalist id={sourceList}>
                {(sources.data ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Panel>
            <Panel title={shown ? `Preview · first ${count(shown.sample.length)} of ${count(shown.count)}` : 'Preview'}>
              {!ready ? (
                <p className="py-2 text-[12.5px] text-ink-3">Complete a rule to see a sample of the contacts who match.</p>
              ) : preview.error && !shown ? (
                <Refused error={preview.error} what="The live preview" onRetry={() => void preview.refetch()} />
              ) : !shown ? (
                <Spinner label="Counting…" />
              ) : shown.sample.length === 0 ? (
                <Empty icon="users" title="No contact matches these rules" hint={match === 'all' ? 'Loosen a rule, or match any of the rules instead of all.' : 'Loosen a rule or remove one.'} />
              ) : (
                <Table
                  label="Contacts who match"
                  head={
                    <tr>
                      <th className={TH}>Contact</th>
                      <th className={TH}>Organisation</th>
                      <th className={TH}>Last open</th>
                    </tr>
                  }
                >
                  {(shown.sample as Sampled[]).map((c) => (
                    <tr key={c.id}>
                      <td className={TD}>
                        <button type="button" className="text-left font-medium text-ink hover:text-primary hover:underline" onClick={() => go(`/marketing/contacts/${c.id}`)}>
                          {c.name}
                        </button>
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>{c.organisation ?? '—'}</td>
                      <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{lastOpen(c)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <AudienceSize data={shown} ready={ready} counting={counting} error={ready ? preview.error : null} onRetry={() => void preview.refetch()} />
            <FieldGroups />
            <Panel title="Snapshot">
              <p className="text-[12px] text-ink-3">Turn this segment into a list on a schedule so a campaign can target a frozen audience.</p>
              {id === null ? <p className="mt-2 text-[12px] text-ink-3">Save the segment first.</p> : <Snapshots id={id} segmentName={name.trim()} />}
            </Panel>
          </div>
        </div>
      </PageBody>
      {asList !== null && id !== null ? <SaveAsList id={id} initialName={asList} size={shown?.count ?? null} onClose={() => setAsList(null)} onMade={made} /> : null}
    </div>
  );
}

/** One rule: field, how it compares, the value, remove (design DK04 "Tag · includes · vendor · ×"). */
function RuleRow({
  index,
  rule,
  tried,
  refOptions,
  datalist,
  onChange,
  onRemove,
}: {
  index: number;
  rule: Rule;
  tried: boolean;
  refOptions: (f: SegmentField) => Array<SelectOption<string>>;
  datalist: string | undefined;
  onChange: (r: Rule) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const field = fieldOf(rule.field);
  const op = field ? operatorOf(field, rule.op) : undefined;
  const kind = field ? valueKind(field, op) : 'text';
  const problem = ruleProblem(rule);
  // An empty value is only flagged once saving was tried; a wrong one (a day count, a date, a planned field) at once.
  const flagged = !!problem && (tried || !!field?.planned || (rule.value.trim() !== '' && kind !== 'option' && kind !== 'ref'));
  const fields: Array<SelectOption<string>> = FIELDS.map((f) => ({ value: f.key, label: f.label, group: f.group, disabled: !!f.planned, hint: f.planned ? 'Planned' : undefined }));
  const ops: Array<SelectOption<string>> = operatorsFor(rule.field).map((o) => ({ value: o.value, label: o.label }));
  const value = rule.value;
  const set = (v: string) => onChange({ ...rule, value: v });
  const label = `Rule ${n} value`;

  let input: ReactNode = null;
  if (field && kind === 'days') {
    input = <NumberField value={value} onValueChange={set} min={1} max={MAX_DAYS} unit="days" size="sm" width={124} invalid={flagged} aria-label={label} />;
  } else if (field && kind === 'date') {
    input = <input type="date" value={value} onChange={(e) => set(e.target.value)} aria-label={label} aria-invalid={flagged || undefined} className={cx(INPUT, 'w-[160px] font-mono', flagged && 'border-danger')} />;
  } else if (field && kind === 'option') {
    input = <Select value={value} onValueChange={set} options={field.options ?? []} placeholder="Choose a value" aria-label={label} className="min-w-[150px] flex-[2]" />;
  } else if (field && kind === 'ref') {
    const options = refOptions(field);
    const shown = value && !options.some((o) => o.value === value) ? [{ value, label: `#${value}` }, ...options] : options;
    const what = field.type === 'list' ? 'list' : field.type === 'topic' ? 'topic' : 'campaign';
    input = <Select value={value} onValueChange={set} options={shown} placeholder={`Choose a ${what}`} empty={`No ${what} to choose yet.`} aria-label={label} className="min-w-[150px] flex-[2]" />;
  } else if (kind !== 'none') {
    input = (
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        list={datalist}
        aria-label={label}
        aria-invalid={flagged || undefined}
        placeholder={field?.type === 'tag' ? 'Tag' : 'Value'}
        className={cx(INPUT, 'min-w-[140px] flex-[2] basis-[140px] font-mono', flagged && 'border-danger')}
      />
    );
  }

  return (
    <div role="group" aria-label={`Rule ${n}`} className={cx('rounded-[10px] border px-2.5 py-2', flagged ? 'border-danger/50' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={rule.field} onValueChange={(k) => onChange(withField(rule, k))} options={fields} aria-label={`Rule ${n} field`} className="min-w-[150px] flex-1" />
        <Select value={rule.op} onValueChange={(o) => onChange(withOperator(rule, o))} options={ops} aria-label={`Rule ${n} comparison`} className="w-[140px]" />
        {input}
        <IconButton icon="x" label={`Remove rule ${n}`} onClick={onRemove} className="ml-auto" />
      </div>
      {flagged ? <p className="mt-1.5 text-[11.5px] text-danger">{problem}</p> : null}
    </div>
  );
}

/** "612 contacts match right now · 12.7% of 4,812" (MKT-SEG-03/04). */
function AudienceSize({ data, ready, counting, error, onRetry }: { data: SegmentPreview | undefined; ready: boolean; counting: boolean; error: unknown; onRetry: () => void }) {
  return (
    <Panel
      title="Audience size"
      action={
        <span role="status" className="text-[11.5px] text-ink-3">
          {counting ? 'Counting…' : ''}
        </span>
      }
    >
      {!ready ? (
        <p className="text-[12.5px] text-ink-3">Complete a rule to count who matches.</p>
      ) : error && !data ? (
        <ErrorNote error={error} onRetry={onRetry} />
      ) : !data ? (
        <div className="font-mono text-[30px] leading-none font-bold text-ink-3">—</div>
      ) : (
        <>
          <div className="font-mono text-[30px] leading-none font-bold tabular-nums text-ink">{count(data.count)}</div>
          <div className="mt-1 text-[12px] text-ink-3">contacts match right now</div>
          <Bar value={ratio(data.count, data.total)} className="mt-3" />
          <p className="mt-2 text-[11.5px] text-ink-3">{`${share(data.count, data.total)} of ${count(data.total)} · suppressed contacts are always excluded at send time`}</p>
          {data.excluded ? <p className="mt-1.5 text-[11.5px] font-medium text-warning">{`${count(data.excluded)} of them are suppressed or unsubscribed and will not be sent to.`}</p> : null}
        </>
      )}
    </Panel>
  );
}

function FieldGroups() {
  return (
    <Panel title="Field groups">
      <ul className="flex flex-col">
        {GROUPS.map((g) => (
          <li key={g} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[12.5px] text-ink-2 last:border-b-0">
            <span className="min-w-0 truncate">{g}</span>
            {plannedGroup(g) ? <Planned /> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const EVERY: Array<SelectOption<Snapshot['every']>> = [
  { value: 'day', label: 'Every day' },
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
];

/** MKT-SEG-08 (Target): the segment frozen into a list on a schedule, where the server offers it. */
function Snapshots({ id, segmentName }: { id: number; segmentName: string }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const [busy, run] = useAction();
  const [listName, setListName] = useState('');
  const [every, setEvery] = useState<Snapshot['every']>('week');
  const q = useQuery({ queryKey: MK.snapshots(org, id), queryFn: ({ signal }) => fetchSnapshots(id, signal) });
  const fallback = `${segmentName || 'Segment'} snapshot`;

  const schedule = (e: FormEvent) => {
    e.preventDefault();
    void run('snapshot', async () => {
      const r = await scheduleSnapshot(id, { list_name: listName.trim() || fallback, every });
      if (!r.offered) {
        toast('info', NOT_OFFERED);
        return;
      }
      toast('success', `Scheduled: ${EVERY.find((x) => x.value === r.data.every)?.label ?? r.data.every} into “${r.data.list.name}”.`);
      setListName('');
      void qc.invalidateQueries({ queryKey: MK.snapshots(org, id) });
      void qc.invalidateQueries({ queryKey: MK.lists(org) });
    });
  };

  return (
    <div className="mt-2">
      <OptionalView
        q={q}
        what="Segment snapshots"
        notOffered={
          <div className="pt-0.5">
            <Planned>Planned · scheduled segment → list</Planned>
          </div>
        }
      >
        {(rows) => (
          <div className="flex flex-col gap-2.5">
            {rows.length ? (
              <ul className="flex flex-col">
                {rows.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[12.5px] last:border-b-0">
                    <span className="min-w-0 truncate text-ink-2">
                      <b className="font-semibold text-ink">{EVERY.find((x) => x.value === s.every)?.label ?? s.every}</b> → {s.list.name}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{s.next_at ? `next ${day(s.next_at)}` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-ink-3">No snapshot is scheduled.</p>
            )}
            <form className="flex flex-col gap-2" onSubmit={schedule}>
              <Field label="Into the list">
                <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder={fallback} maxLength={150} />
              </Field>
              <div className="flex items-center gap-2">
                <Select value={every} onValueChange={setEvery} options={EVERY} aria-label="How often" className="min-w-0 flex-1" />
                <Button type="submit" loading={busy === 'snapshot'}>
                  Schedule
                </Button>
              </div>
            </form>
          </div>
        )}
      </OptionalView>
    </div>
  );
}

/** MKT-SEG-05: the contacts who match now, kept once as a static list. */
function SaveAsList({ id, initialName, size, onClose, onMade }: { id: number; initialName: string; size: number | null; onClose: () => void; onMade: (list: MList) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const [busy, run] = useAction();
  const [name, setName] = useState(initialName);
  const titleId = useId();

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n) return;
    void run('list', async () => {
      const list = await segmentToList(id, n);
      void qc.invalidateQueries({ queryKey: MK.lists(org) });
      void qc.invalidateQueries({ queryKey: MK.segments(org), exact: true });
      onMade(list);
    });
  };

  return (
    <Modal
      title="Save as list"
      labelledBy={titleId}
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="list" loading={busy === 'list'} disabled={!name.trim()} onClick={() => submit()}>
            Save as list
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <p className="text-[12.5px] text-ink-2">
          {size === null
            ? 'The contacts who match the saved rules now become a static list. The list does not change when contacts change later; the segment stays live.'
            : `The ${count(size)} contacts who match the saved rules now become a static list. The list does not change when contacts change later; the segment stays live.`}
        </p>
        <Field label="List name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
