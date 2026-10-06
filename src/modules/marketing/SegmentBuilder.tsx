import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { refreshMarketing, send, usePulse } from './api';
import { firstCompany, may, Refused, TABLE, TD, TH, useDebounced, useLists } from './audience-parts';
import { draftOfRule, ruleOf, ValueInput, type RuleDraft } from './audience-rules';
import { btn, btnPrimary, Card, Field, input, Meter, n, PageHeader, Planned, Sheet } from './parts';
import { companiesWhere, peopleOf, refusal, type Options, type Segment, type SegmentSample } from './types';

const MAX_RULES = 20;

/**
 * The segment builder (DK04, the web's W04; MKT-SEG-01, MKT-SEG-03,
 * MKT-SEG-05, MKT-SEG-08): up to twenty rules over the server's fields, all or
 * any of them, with the count and the first four matches as they are written —
 * nothing is saved to learn them. Suppressed and unsubscribed contacts are
 * always left out at send time whatever the rules say (MKT-SEG-04), and the
 * audience card says so.
 *
 * "Save as list" freezes who the saved segment matches now into a list, once;
 * doing that on a schedule is planned, and says so.
 */
export default function SegmentBuilder({ id, org, options, onBack, onSaved, onList }: { id: number | null; org: string; options: Options; onBack: () => void; onSaved: (id: number) => void; onList: (listId: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'segment', id],
    queryFn: ({ signal }) => apiGet<Segment>(`/api/marketing/segments/${id}`, undefined, signal),
    enabled: id !== null,
    retry: false,
    // The rules on screen are being edited; a refetch must not pull them from under the cursor.
    staleTime: Infinity,
  });
  if (id !== null && q.isLoading) return <Spinner label="Loading the segment…" />;
  if (id !== null && !q.data) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader crumbs={['Segments']} onCrumb={onBack} title="Segment" />
        <Refused error={q.error} fallback="That segment could not be loaded." onRetry={() => void q.refetch()} />
      </div>
    );
  }
  return <Builder key={q.data ? `${q.data.id}-${q.data.updated_at ?? ''}` : 'new'} segment={q.data ?? null} org={org} options={options} onBack={onBack} onSaved={onSaved} onList={onList} />;
}

function Builder({ segment, org, options, onBack, onSaved, onList }: { segment: Segment | null; org: string; options: Options; onBack: () => void; onSaved: (id: number) => void; onList: (listId: number) => void }) {
  const fields = options.segment_fields;
  const makers = companiesWhere(options, 'segments');
  const [orgId, setOrgId] = useState(segment ? String(segment.org_id) : firstCompany(options, 'segments', org));
  const [name, setName] = useState(segment?.name ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [match, setMatch] = useState<'all' | 'any'>(segment?.match ?? 'all');
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => {
    if (segment) return segment.rules.map(draftOfRule);
    const subscribed = fields.find((f) => f.key === 'email_status');
    const f = subscribed ?? fields[0];
    return f ? [{ field: f.key, op: f.ops[0]?.key ?? 'is', value: subscribed ? 'subscribed' : '' }] : [];
  });
  const [busy, setBusy] = useState(false);
  const [asList, setAsList] = useState(false);
  const lists = useLists(orgId);
  const pulse = usePulse(orgId, orgId !== '');
  const editable = segment ? may(options, 'segments', segment.org_id) : makers.length > 0;

  const rules = useMemo(() => drafts.map((d) => ruleOf(d, fields.find((f) => f.key === d.field))), [drafts, fields]);
  const asked = useDebounced(JSON.stringify({ org_id: Number(orgId), match, rules }), 450);
  /* The count as the rules are written, once typing pauses (MKT-SEG-03, NFR-03). */
  const preview = useQuery({
    queryKey: ['marketing', 'segment-preview', asked],
    queryFn: () => apiPost<{ members: number; sample?: SegmentSample[] }>('/api/marketing/segments/preview', JSON.parse(asked) as unknown),
    enabled: orgId !== '' && rules.length > 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const wrong = useMemo<Record<string, string>>(() => {
    const d = preview.error instanceof ApiError ? preview.error.data : null;
    const r = d && typeof d === 'object' ? (d as { rules?: unknown }).rules : null;
    return r && typeof r === 'object' ? (r as Record<string, string>) : {};
  }, [preview.error]);
  const members = preview.error ? null : (preview.data?.members ?? null);
  const total = pulse.data?.contacts ?? null;
  // Changed since it was opened (or last saved: a save reloads the segment, and the page starts again from it).
  const now = JSON.stringify({ name, description, match, drafts });
  const [opened] = useState(now);
  const dirty = opened !== now;

  const setDraft = (i: number, d: RuleDraft) => setDrafts(drafts.map((x, j) => (j === i ? d : x)));
  const addRule = () => {
    const f = fields[0];
    if (f) setDrafts([...drafts, { field: f.key, op: f.ops[0]?.key ?? 'is', value: '' }]);
  };

  const save = async () => {
    setBusy(true);
    const body = { name: name.trim(), description, match, rules };
    try {
      const r = segment ? await send('PUT', `/api/marketing/segments/${segment.id}`, body) : await send<{ id?: number } | null>('POST', '/api/marketing/segments', { ...body, org_id: Number(orgId) });
      toast('success', r.message ?? 'Saved.');
      await refreshMarketing();
      onSaved(segment?.id ?? Number((r.data as { id?: number } | null)?.id ?? 0));
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const people = peopleOf(options, Number(orgId) || null);
  const companyLists = (lists.data?.items ?? []).filter((l) => String(l.org_id) === orgId);
  const sample = preview.data?.sample;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Segments']}
        onCrumb={onBack}
        title={segment?.name || name.trim() || 'New segment'}
        sub="Live segment · re-evaluated every time it is used"
        actions={
          <>
            {segment && may(options, 'lists', segment.org_id) ? (
              <button type="button" className={btn} disabled={dirty} title={dirty ? 'Save the segment first: the list takes who it matches as saved.' : 'Freeze who matches now into a list'} onClick={() => setAsList(true)}>
                <Icon name="list" size={15} /> Save as list
              </button>
            ) : null}
            {editable ? (
              <button type="button" className={btnPrimary} disabled={busy || name.trim() === '' || orgId === '' || drafts.length === 0} onClick={() => void save()}>
                <Icon name="check" size={15} /> {busy ? 'Saving…' : 'Save segment'}
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Segment">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!segment && makers.length > 1 ? (
                <Field label="Company" className="sm:col-span-2">
                  <Select<string> aria-label="Company" value={orgId} placeholder="Which company?" onValueChange={setOrgId} options={makers.map((c) => ({ value: String(c.id), label: c.name }))} className={input} />
                </Field>
              ) : null}
              <Field label="Name">
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!segment} disabled={!editable} />
              </Field>
              <Field label="What it is for">
                <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} />
              </Field>
            </div>
          </Card>

          <Card
            title={
              <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ink">
                Match
                <Select<'all' | 'any'> aria-label="Match" value={match} onValueChange={setMatch} disabled={!editable} className="h-[30px] w-auto" options={[{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }]} />
                of the following rules
              </span>
            }
            action={
              <span className="text-[12px] text-ink-3">
                {drafts.length} of {MAX_RULES} rules · {fields.length} fields available
              </span>
            }
          >
            <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Rules">
              {drafts.map((d, i) => {
                const f = fields.find((x) => x.key === d.field);
                const op = f?.ops.find((o) => o.key === d.op);
                const said = wrong[String(i)];
                return (
                  <li key={i} className={cx('rounded-[10px] border p-2', said ? 'border-danger/50' : 'border-line')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select<string>
                        aria-label={`Rule ${i + 1}: about`}
                        value={d.field}
                        disabled={!editable}
                        onValueChange={(v) => {
                          const nf = fields.find((x) => x.key === v);
                          setDraft(i, { field: v, op: nf?.ops[0]?.key ?? '', value: '' });
                        }}
                        options={fields.map((x) => ({ value: x.key, label: x.label }))}
                        className="w-[200px]"
                      />
                      <Select<string> aria-label={`Rule ${i + 1}: how`} value={d.op} disabled={!editable} onValueChange={(v) => setDraft(i, { ...d, op: v })} options={(f?.ops ?? []).map((o) => ({ value: o.key, label: o.label }))} className="w-auto" />
                      {f && op && !op.bare ? <ValueInput field={f} draft={d} label={`Rule ${i + 1}: value`} onChange={(value) => setDraft(i, { ...d, value })} people={people} lists={companyLists} /> : null}
                      {editable ? (
                        <button type="button" aria-label={`Remove rule ${i + 1}`} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-line text-ink-3 hover:bg-subtle hover:text-danger">
                          <Icon name="x" size={14} />
                        </button>
                      ) : null}
                    </div>
                    {said ? (
                      <p role="alert" className="m-0 mt-1 text-[12px] text-danger">
                        {said}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {drafts.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">No rules yet: add one to describe who you mean.</p> : null}
            {editable ? (
              <button type="button" className={cx(btn, 'mt-2.5')} onClick={addRule} disabled={drafts.length >= MAX_RULES || fields.length === 0}>
                <Icon name="plus" size={14} /> Add rule
              </button>
            ) : null}
          </Card>

          <Card title={members === null ? 'Preview' : `Preview · first ${Math.min(4, sample?.length ?? 0)} of ${n(members)}`} padded={false}>
            {preview.isLoading ? <Spinner label="Counting…" /> : null}
            {preview.error ? (
              <div className="px-4 pb-4">
                <Refused error={preview.error} fallback="The rules could not be counted." />
              </div>
            ) : sample === undefined ? (
              preview.data ? <p className="m-0 px-4 pb-4 text-[12.5px] text-ink-3">This server counts the matches but sends no sample of them yet.</p> : null
            ) : sample.length === 0 ? (
              <p className="m-0 px-4 pb-4 text-[12.5px] text-ink-3">Nobody matches these rules now.</p>
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <table className={cx(TABLE, preview.isPlaceholderData && 'opacity-60')}>
                  <thead>
                    <tr>
                      <th scope="col" className={cx(TH, 'pl-4')}>
                        Contact
                      </th>
                      <th scope="col" className={TH}>
                        Organisation
                      </th>
                      <th scope="col" className={cx(TH, 'pr-4')}>
                        Last open
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sample.slice(0, 4).map((s) => (
                      <tr key={s.id}>
                        <td className={cx(TD, 'pl-4 font-semibold')}>{s.name}</td>
                        <td className={cx(TD, 'text-ink-2')}>{s.company ?? '—'}</td>
                        <td className={cx(TD, 'pr-4 text-ink-2')}>{s.last_open_at ? dateLabel(s.last_open_at) : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Audience size">
            <p role="status" aria-live="polite" className="m-0">
              <b className="block text-[30px] leading-tight text-ink tabular-nums">{members === null ? '—' : n(members)}</b>
              <span className="text-[12.5px] text-ink-3">{members === 1 ? 'contact matches right now' : 'contacts match right now'}</span>
            </p>
            {members !== null && total ? (
              <div className="mt-2.5">
                <Meter value={members} max={total} label="Share of all contacts" />
              </div>
            ) : null}
            <p className="m-0 mt-2 text-[12px] text-ink-3">
              {members !== null && total ? `${Math.round((members / total) * 1000) / 10}% of ${n(total)} · ` : ''}
              Suppressed contacts are always excluded at send time.
            </p>
          </Card>
          <Card title="Field groups">
            <ul className="m-0 flex list-none flex-col p-0 text-[12.5px] text-ink-2">
              {fields.map((f) => (
                <li key={f.key} className="border-b border-line/70 py-1 last:border-b-0">
                  {f.label}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Snapshot">
            <p className="m-0 text-[12.5px] text-ink-2">Turn this segment into a list on a schedule so a campaign can target a frozen audience.</p>
            <div className="mt-2">
              <Planned phase="scheduled segment → list" />
            </div>
          </Card>
        </div>
      </div>

      {asList && segment ? <SaveAsList segment={segment} onClose={() => setAsList(false)} onDone={onList} /> : null}
    </div>
  );
}

/**
 * The segment's matches now, frozen into a new list (MKT-SEG-05): the list is
 * made, then everybody the saved segment matches is put on it. The list keeps
 * them; the segment goes on changing.
 */
function SaveAsList({ segment, onClose, onDone }: { segment: Segment; onClose: () => void; onDone: (listId: number) => void }) {
  const [name, setName] = useState(`${segment.name} · ${dateLabel(new Date().toISOString())}`);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const made = await send<{ id?: number } | null>('POST', '/api/marketing/lists', { org_id: segment.org_id, name: name.trim(), description: `Frozen from the segment “${segment.name}”.` });
      const listId = Number(made.data?.id ?? 0);
      const added = await send('POST', `/api/marketing/lists/${listId}/members`, { segment_id: segment.id });
      toast('success', added.message ?? 'Saved as a list.');
      await refreshMarketing();
      onDone(listId);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Save as list"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || name.trim() === ''} onClick={() => void go()}>
            {busy ? 'Saving…' : 'Save as list'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Everybody the segment matches now goes on a new list. The list keeps them; the segment goes on changing.</p>
      <Field label="List name">
        <input autoFocus className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Sheet>
  );
}
