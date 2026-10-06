import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Menu } from '../../../components/Menu';
import { Select } from '../../../components/Select';
import { Button, cx, Empty, Modal } from '../../../components/ui';
import { bulkContacts, exportContactsCsv, fetchContacts, fetchSources, fetchTags, MK, useDashboard, useLists, useSegments, type BulkAction, type Contact, type ContactFilters, type EmailConsent, type MList } from '../api';
import { EMAIL_CONSENT, emailConsent } from '../lib/consent';
import { ago, count, isoDay, plural } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, PageBody, PageHeader, Pager, saveCsv, Status, Table, TD, TextArea, TH, useAction } from '../parts';
import { ContactCell, ContactEditor } from './ContactEditor';

/**
 * DK02 · Contacts (MKT-AUD-01/04/05/07, MKT-IMP-05). One record per person per company, deduplicated by email, then
 * phone (last 9 digits), then name at organisation. Search by name, email, phone or organisation and filter by list,
 * segment, email consent, source and tag; tick rows for the bulk bar — add to list, tag, hand over to CRM, suppress,
 * do not call, archive. Export writes what the filters show as CSV (audited on the server). `?new=1` opens Add contact.
 */
const PER_PAGE = 50;

type Bulk = 'list' | 'tag' | 'handover' | 'suppress' | 'dnc' | 'archive';

const BULK: Record<Bulk, { title: string; action: BulkAction; button: string; danger?: boolean; done: (n: string, extra: string) => string }> = {
  list: { title: 'Add to list', action: 'add_to_list', button: 'Add to list', done: (n, list) => `${n} added to ${list}.` },
  tag: { title: 'Tag contacts', action: 'tag', button: 'Add tag', done: (n, tag) => `${n} tagged “${tag}”.` },
  handover: { title: 'Hand over to CRM', action: 'handover', button: 'Hand over', done: (n) => `${n} handed over to CRM.` },
  suppress: { title: 'Suppress email', action: 'suppress_email', button: 'Suppress email', danger: true, done: (n) => `Email suppressed for ${n}.` },
  dnc: { title: 'Do not call', action: 'do_not_call', button: 'Add to do-not-call', danger: true, done: (n) => `${n} added to do-not-call.` },
  archive: { title: 'Archive contacts', action: 'archive', button: 'Archive', done: (n) => `${n} archived.` },
};

const CONSENT_OPTIONS: Array<{ value: EmailConsent | ''; label: string }> = [{ value: '', label: 'Email consent' }, ...(Object.keys(EMAIL_CONSENT) as EmailConsent[]).map((k) => ({ value: k, label: `Email: ${EMAIL_CONSENT[k].label}` }))];

export default function Contacts() {
  const { go, query } = useTab();
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const dash = useDashboard();
  const lists = useLists();
  const segments = useSegments();
  const sources = useQuery({ queryKey: MK.sources(org), queryFn: ({ signal }) => fetchSources(org, signal), staleTime: 60_000 });
  const tags = useQuery({ queryKey: MK.tags(org), queryFn: ({ signal }) => fetchTags(org, signal), staleTime: 60_000 });

  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [listId, setListId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [consent, setConsent] = useState<EmailConsent | ''>('');
  const [source, setSource] = useState('');
  const [tag, setTag] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [busy, run] = useAction();

  // The search waits for a pause in typing; a new search starts on page one with nothing ticked.
  useEffect(() => {
    const next = text.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      setQ(next);
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(t);
  }, [text, q]);

  const filters: ContactFilters = {
    q,
    list_id: listId ? Number(listId) : null,
    segment_id: segmentId ? Number(segmentId) : null,
    email_consent: consent,
    source,
    tag,
    archived,
    page,
    per_page: PER_PAGE,
  };
  const contacts = useQuery({ queryKey: MK.contacts(org, filters), queryFn: ({ signal }) => fetchContacts(org, filters, signal), placeholderData: keepPreviousData });
  const filtered = !!(q || listId || segmentId || consent || source || tag || archived);
  const total = dash.data?.contacts.total ?? (filtered ? undefined : contacts.data?.total);

  const refilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setSelected(new Set());
  };
  const clearFilters = () => {
    setText('');
    setQ('');
    setListId('');
    setSegmentId('');
    setConsent('');
    setSource('');
    setTag('');
    setArchived(false);
    setPage(1);
    setSelected(new Set());
  };

  // `?new=1` (Add contact from elsewhere) opens the editor; closing it clears the route.
  const askedNew = query.get('new') === '1';
  const closeEditor = () => {
    setAdding(false);
    if (askedNew) go('/marketing/contacts');
  };

  const exportCsv = () => void run('export', async () => saveCsv(`contacts-${isoDay(new Date())}`, await exportContactsCsv(org, filters)));

  const doBulk = (kind: Bulk, extra: { list_id?: number; tag?: string; notes?: string }, what = '') =>
    void run(`bulk:${kind}`, async () => {
      const r = await bulkContacts(org, BULK[kind].action, [...selected], extra);
      const skipped = r.skipped ? ` ${plural(r.skipped, 'contact')} skipped.` : '';
      toast('success', `${BULK[kind].done(plural(r.affected, 'contact'), what)}${skipped}${r.message ? ` ${r.message}` : ''}`);
      setSelected(new Set());
      setBulk(null);
      void qc.invalidateQueries({ queryKey: MK.all });
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Audience"
        title="Contacts"
        sub={`${total !== undefined ? `${count(total)} contacts · ` : ''}deduplicated by email, then phone (last 9 digits), then name at organisation`}
        actions={
          <>
            <Button icon="download" loading={busy === 'export'} onClick={exportCsv}>
              Export
            </Button>
            <Button icon="upload" onClick={() => go('/marketing/import')}>
              Import
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add contact
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface p-2.5">
            <div className="relative min-w-[200px] flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-3">
                <Icon name="search" size={14} />
              </span>
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Name, email, phone or organisation"
                aria-label="Search contacts"
                className="h-[34px] w-full rounded-[8px] border border-line bg-surface pr-3 pl-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
              />
            </div>
            <Select aria-label="List" className={cx('max-w-[220px]', listId && 'bg-selection')} value={listId} onValueChange={refilter(setListId)} options={[{ value: '', label: 'List: All' }, ...(lists.data ?? []).map((l) => ({ value: String(l.id), label: `List: ${l.name}` }))]} />
            <Select aria-label="Segment" className={cx('max-w-[220px]', segmentId && 'bg-selection')} value={segmentId} onValueChange={refilter(setSegmentId)} options={[{ value: '', label: 'Segment: —' }, ...(segments.data ?? []).map((s) => ({ value: String(s.id), label: `Segment: ${s.name}` }))]} />
            <Select aria-label="Email consent" className={cx('max-w-[220px]', consent && 'bg-selection')} value={consent} onValueChange={refilter(setConsent)} options={CONSENT_OPTIONS} />
            <Select aria-label="Source" className={cx('max-w-[220px]', source && 'bg-selection')} value={source} onValueChange={refilter(setSource)} options={[{ value: '', label: 'Source' }, ...(sources.data ?? []).map((s) => ({ value: s, label: `Source: ${s}` }))]} />
            <Select aria-label="Tag" className={cx('max-w-[200px]', tag && 'bg-selection')} value={tag} onValueChange={refilter(setTag)} options={[{ value: '', label: 'Tag' }, ...(tags.data ?? []).map((t) => ({ value: t, label: `Tag: ${t}` }))]} />
            <Select
              aria-label="Active or archived"
              className={cx('max-w-[200px]', archived && 'bg-selection')}
              value={archived ? 'archived' : 'active'}
              onValueChange={(v) => refilter(setArchived)(v === 'archived')}
              options={[
                { value: 'active', label: 'Active contacts' },
                { value: 'archived', label: 'Archived contacts' },
              ]}
            />
          </div>

          {selected.size > 0 ? (
            <div role="group" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/25 bg-selection px-3 py-2">
              <span className="text-[12.5px] font-bold text-ink" aria-live="polite">
                {count(selected.size)} selected
              </span>
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <Button size="sm" onClick={() => setBulk('list')}>
                Add to list
              </Button>
              <Button size="sm" onClick={() => setBulk('tag')}>
                Tag
              </Button>
              <Button size="sm" onClick={() => setBulk('handover')}>
                Hand over to CRM
              </Button>
              <Button size="sm" className="!border-danger/40 !text-danger" onClick={() => setBulk('suppress')}>
                Suppress
              </Button>
              <span ref={moreRef} className="inline-flex">
                <Button size="sm" icon="more" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}>
                  More
                </Button>
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          ) : null}
          {more && selected.size > 0 ? (
            <Menu
              label="More bulk actions"
              anchor={moreRef}
              prefer="bottom"
              align="start"
              width={240}
              onClose={() => setMore(false)}
              sections={[
                {
                  id: 'more',
                  items: [
                    { id: 'dnc', label: 'Do not call', description: 'Suppress their phone keys for the company', icon: 'phone-off', danger: true, onSelect: () => setBulk('dnc') },
                    { id: 'archive', label: 'Archive', description: 'Hide them from Contacts', icon: 'archive', onSelect: () => setBulk('archive') },
                  ],
                },
              ]}
            />
          ) : null}

          <Loaded q={contacts} what="Contacts">
            {(data) =>
              data.rows.length === 0 ? (
                <div className="rounded-[12px] border border-line bg-surface">
                  {filtered ? (
                    <Empty
                      icon="search"
                      title="No contacts match"
                      hint={archived ? 'No archived contact matches these filters.' : 'Try another search, or clear the filters.'}
                      action={
                        <Button size="sm" className="mt-1" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <Empty
                      icon="users"
                      title="No contacts yet"
                      hint="Add people one at a time, or import a CSV. Each person is kept once per company: matched by email, then phone (last 9 digits), then name at organisation."
                      action={
                        <div className="mt-1 flex gap-2">
                          <Button size="sm" icon="upload" onClick={() => go('/marketing/import')}>
                            Import contacts
                          </Button>
                          <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                            Add contact
                          </Button>
                        </div>
                      }
                    />
                  )}
                </div>
              ) : (
                <div className={cx('flex flex-col transition-opacity', contacts.isPlaceholderData && 'opacity-60')}>
                  <ContactTable rows={data.rows} selected={selected} onSelected={setSelected} onOpen={(id) => go(`/marketing/contacts/${id}`)} />
                  <Pager page={data.page} pages={data.pages} total={data.total} perPage={data.perPage} onPage={setPage} />
                </div>
              )
            }
          </Loaded>
        </div>
      </PageBody>

      {adding || askedNew ? (
        <ContactEditor
          onClose={closeEditor}
          onSaved={(c) => {
            setAdding(false);
            go(`/marketing/contacts/${c.id}`);
          }}
        />
      ) : null}
      {bulk ? <BulkDialog kind={bulk} n={selected.size} lists={lists.data ?? []} tags={tags.data ?? []} busy={busy === `bulk:${bulk}`} onRun={(extra, what) => doBulk(bulk, extra, what)} onClose={() => setBulk(null)} /> : null}
    </div>
  );
}

function ContactTable({ rows, selected, onSelected, onOpen }: { rows: Contact[]; selected: ReadonlySet<number>; onSelected: (s: ReadonlySet<number>) => void; onOpen: (id: number) => void }) {
  const ids = rows.map((r) => r.id);
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  const some = ids.some((id) => selected.has(id));
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelected(next);
  };
  const togglePage = () => {
    const next = new Set(selected);
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    onSelected(next);
  };
  return (
    <Table
      label="Contacts"
      head={
        <tr>
          <th className={cx(TH, 'w-9')}>
            <Checkbox aria-label="Select every contact on this page" checked={all} indeterminate={!all && some} onChange={togglePage} />
          </th>
          <th className={TH}>Contact</th>
          <th className={TH}>Organisation</th>
          <th className={TH}>Source</th>
          <th className={TH}>Email consent</th>
          <th className={TH}>Tags</th>
          <th className={TH}>Last activity</th>
        </tr>
      }
    >
      {rows.map((c) => {
        const consent = emailConsent(c.email_consent);
        const on = selected.has(c.id);
        const when = c.last_activity ? ago(c.last_activity.at) : '';
        return (
          <tr key={c.id} onClick={() => onOpen(c.id)} className={cx('cursor-pointer', on ? 'bg-selection/70' : 'hover:bg-subtle/60')}>
            <td className={cx(TD, 'w-9')} onClick={(e) => e.stopPropagation()}>
              <Checkbox aria-label={`Select ${c.name}`} checked={on} onChange={() => toggle(c.id)} />
            </td>
            <td className={TD}>
              <ContactCell c={c} onOpen={() => onOpen(c.id)} />
            </td>
            <td className={cx(TD, 'max-w-[220px] truncate')}>{c.organisation ?? <span className="text-ink-3">—</span>}</td>
            <td className={cx(TD, 'max-w-[200px] truncate text-ink-2')}>{c.source ?? <span className="text-ink-3">—</span>}</td>
            <td className={TD}>
              <Status tone={consent.tone}>{consent.label}</Status>
            </td>
            <td className={TD}>
              {c.tags.length ? (
                <span className="flex flex-wrap gap-1">
                  {c.tags.slice(0, 2).map((t) => (
                    <Status key={t} tone="indigo">
                      {t}
                    </Status>
                  ))}
                  {c.tags.length > 2 ? <span className="self-center text-[11.5px] text-ink-3">+{c.tags.length - 2}</span> : null}
                </span>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </td>
            <td className={cx(TD, 'max-w-[280px] truncate text-ink-2')} title={c.last_activity?.text}>
              {c.last_activity ? `${c.last_activity.text}${when ? ` · ${when}` : ''}` : <span className="text-ink-3">—</span>}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/** What the bulk bar asks before it acts on the ticked contacts (MKT-AUD-05, WF-05, WF-14). */
function BulkDialog({ kind, n, lists, tags, busy, onRun, onClose }: { kind: Bulk; n: number; lists: MList[]; tags: string[]; busy: boolean; onRun: (extra: { list_id?: number; tag?: string; notes?: string }, what: string) => void; onClose: () => void }) {
  const [listId, setListId] = useState('');
  const [tag, setTag] = useState('');
  const [notes, setNotes] = useState('');
  const spec = BULK[kind];
  const who = plural(n, 'contact');
  const list = lists.find((l) => String(l.id) === listId);
  const tagText = tag.trim();
  const ready = kind === 'list' ? !!list : kind === 'tag' ? tagText !== '' : true;
  const submit = () => {
    if (!ready) return;
    if (kind === 'list' && list) onRun({ list_id: list.id }, list.name);
    else if (kind === 'tag') onRun({ tag: tagText }, tagText);
    else if (kind === 'handover') onRun(notes.trim() ? { notes: notes.trim() } : {}, '');
    else onRun({}, '');
  };
  return (
    <Modal
      title={spec.title}
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={spec.danger ? 'danger' : 'primary'} loading={busy} disabled={!ready} onClick={submit}>
            {spec.button}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        {kind === 'list' ? (
          lists.length ? (
            <Field label={`Add ${who} to`}>
              <Select aria-label="List" value={listId} onValueChange={setListId} placeholder="Choose a list" options={lists.map((l) => ({ value: String(l.id), label: l.name, hint: `${plural(l.members_count, 'member')}` }))} />
            </Field>
          ) : (
            <p>There are no lists yet. Create one under Lists, then add these contacts to it.</p>
          )
        ) : kind === 'tag' ? (
          <TagField who={who} value={tag} onChange={setTag} tags={tags} />
        ) : kind === 'handover' ? (
          <>
            <p>Each of the {who} goes to CRM through LeadWriter with channel marketing. Where CRM already knows the person, their lead gets an activity instead of a second lead.</p>
            <Field label="Notes for sales">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Asked for a website care quote at the trade fair." />
            </Field>
          </>
        ) : kind === 'suppress' ? (
          <p>
            Suppress the email address of {who}? Each one is added to this company’s suppression list by its email key: left out of every send from now on, and a re-import cannot bring it back. Lifting a suppression later needs a
            reason.
          </p>
        ) : kind === 'dnc' ? (
          <p>Add {who} to the do-not-call list? Their phone keys (last 9 digits) are suppressed for the company: they leave every call queue now, and a re-import cannot bring them back.</p>
        ) : (
          <p>Archive {who}? Archived contacts are hidden from Contacts; their consent ledger and any suppression stay. Find them under “Archived contacts” and restore one from its page.</p>
        )}
      </div>
    </Modal>
  );
}

function TagField({ who, value, onChange, tags }: { who: string; value: string; onChange: (v: string) => void; tags: string[] }) {
  const id = useId();
  return (
    <Field label={`Tag for ${who}`} hint="Added to each contact; their other tags stay.">
      <Input value={value} onChange={(e) => onChange(e.target.value)} list={id} autoFocus placeholder="vendor" autoComplete="off" />
      <datalist id={id}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </Field>
  );
}
