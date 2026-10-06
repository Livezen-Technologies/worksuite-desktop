import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { useTab } from '../../core/tab-context';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import type { MenuItem } from '../../components/Menu';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { send, withOrg } from './api';
import { ContactSheet } from './audience-contact';
import { SAVE_REFUSED, saveServerFile, useMaySave } from './audience-files';
import { act, emailWord, everybody, MoreMenu, Pager, Refused, ROW_LINK, SearchField, TABLE, TD, TH, useLists, useMeId, useSegmentNames } from './audience-parts';
import { btn, btnBad, btnPrimary, btnSmall, Field, Initials, input, n, PageHeader, Pill, Sheet } from './parts';
import type { Filter } from './routes';
import { refusal, type ContactRow, type Options } from './types';

const PER = 50;

type Bulk = 'add_to_list' | 'remove_from_list' | 'tag' | 'untag' | 'status' | 'owner' | 'convert' | 'suppress' | 'delete';

/**
 * Contacts (DK02, the web's W02; MKT-AUD-04, MKT-AUD-05, MKT-AUD-07): everybody
 * Marketing may reach, narrowed by list, segment, consent, source, status and
 * CRM, a page at a time — and what can be done to many at once.
 *
 * What a contact may be sent is shown, never decided here: the consent pill is
 * the server's reading of consent and the suppression list, and a phone number
 * comes masked when the reader may not edit contacts in that company. A bulk
 * act is checked by the server company by company — somebody who may tag in
 * one company and not the other changes only the first's contacts, and the
 * server's sentence says how many.
 */
export default function Contacts({ org, options, filter, onFilter, onOpen }: { org: string; options: Options; filter: Filter; onFilter: (f: Filter) => void; onOpen: (id: number) => void }) {
  const { go } = useTab();
  const maySave = useMaySave();
  const [typed, setTyped] = useState(filter.q ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = JSON.stringify([org, filter]);
  // A new filter starts at its first page with nothing chosen; neither is carried onto rows that are not there.
  const [paging, setPaging] = useState({ key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const [chosen, setChosen] = useState<{ key: string; ids: Set<number> }>({ key: '', ids: new Set() });
  const selected = chosen.key === `${key}|${page}` ? chosen.ids : new Set<number>();
  const [doing, setDoing] = useState<Bulk | null>(null);
  const [adding, setAdding] = useState(false);
  const lists = useLists(org);
  const segments = useSegmentNames(org);
  const can = (k: 'create' | 'edit' | 'delete' | 'lists' | 'export' | 'import' | 'convert' | 'suppression') => options.companies.some((c) => Boolean(c.can[k]));

  useEffect(() => {
    const t = timer;
    return () => clearTimeout(t.current);
  }, []);

  const list = useQuery({
    queryKey: ['marketing', 'contacts', org, filter, page],
    queryFn: ({ signal }) => apiGet<{ items: ContactRow[]; total: number }>('/api/marketing/contacts', withOrg(org, { ...filter, page, per_page: PER }), signal),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const people = useMemo(() => everybody(options), [options]);

  /* Searching as somebody types, once they pause: the address carries the search, so Back returns to it. */
  const type = (v: string) => {
    setTyped(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onFilter({ ...filter, q: v.trim() || undefined }), 300);
  };
  const set = (k: keyof Filter, v: string) => onFilter({ ...filter, [k]: v || undefined });
  const choose = (ids: Set<number>) => setChosen({ key: `${key}|${page}`, ids });
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    choose(next);
  };

  const exportCsv = async () => {
    try {
      const name = await saveServerFile({ method: 'GET', path: '/api/marketing/contacts/export', query: withOrg(org, filter) }, 'marketing-contacts.csv');
      if (name) toast('success', `Saved ${name}.`);
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  const chips: Array<[keyof Filter, string]> = [];
  if (filter.company) chips.push(['company', 'At one organisation']);
  if (filter.tag) chips.push(['tag', `Tagged ${filter.tag}`]);
  if (filter.owner) chips.push(['owner', filter.owner === 'none' ? 'Nobody owns them' : `Owned by ${people.find((p) => p.value === filter.owner)?.label ?? 'somebody'}`]);
  const filtered = Object.values(filter).some(Boolean);

  const more: MenuItem[] = [
    ...(can('lists') ? [{ id: 'remove_from_list', label: 'Take off a list', icon: 'list', onSelect: () => setDoing('remove_from_list') }] : []),
    ...(can('edit')
      ? [
        { id: 'untag', label: 'Remove a tag', icon: 'tag', onSelect: () => setDoing('untag') },
        { id: 'status', label: 'Set status', icon: 'flag', onSelect: () => setDoing('status') },
        { id: 'owner', label: 'Give to an owner', icon: 'user', onSelect: () => setDoing('owner') },
      ]
      : []),
    ...(can('delete') ? [{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDoing('delete') }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        crumbs={['Audience']}
        title="Contacts"
        sub={`${n(total)} ${total === 1 ? 'contact' : 'contacts'} · deduplicated by email, then phone (last 9 digits), then name at organisation`}
        actions={
          <>
            {can('export') ? (
              <button type="button" className={btn} disabled={!maySave} title={maySave ? 'Save these contacts as a CSV file' : SAVE_REFUSED} onClick={() => void exportCsv()}>
                <Icon name="download" size={15} /> Export
              </button>
            ) : null}
            {can('import') ? (
              <button type="button" className={btn} onClick={() => go('/marketing?view=import')}>
                <Icon name="upload" size={15} /> Import
              </button>
            ) : null}
            {can('create') ? (
              <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
                <Icon name="plus" size={15} /> Add contact
              </button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface p-2.5">
        <SearchField value={typed} onChange={type} label="Search contacts" placeholder="Name, email, phone or organisation" className="min-w-[220px] flex-[1_1_260px]" />
        <Select<string> aria-label="List" value={filter.list ?? ''} onValueChange={(v) => set('list', v)} className={cx('w-auto', filter.list && 'bg-selection')} options={[{ value: '', label: 'List: All' }, ...(lists.data?.items ?? []).map((l) => ({ value: String(l.id), label: l.name }))]} />
        <Select<string> aria-label="Segment" value={filter.segment ?? ''} onValueChange={(v) => set('segment', v)} className={cx('w-auto', filter.segment && 'bg-selection')} options={[{ value: '', label: 'Segment: —' }, ...(segments.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name }))]} />
        <Select<string>
          aria-label="Email consent"
          value={filter.subscribed ?? ''}
          onValueChange={(v) => set('subscribed', v)}
          className={cx('w-auto', filter.subscribed && 'bg-selection')}
          options={[{ value: '', label: 'Email consent' }, { value: 'yes', label: 'May be emailed' }, { value: 'no', label: 'May not be emailed' }]}
        />
        <Select<string> aria-label="Source" value={filter.source ?? ''} onValueChange={(v) => set('source', v)} className={cx('w-auto', filter.source && 'bg-selection')} options={[{ value: '', label: 'Source' }, ...options.sources]} />
        <Select<string> aria-label="Status" value={filter.status ?? ''} onValueChange={(v) => set('status', v)} className={cx('w-auto', filter.status && 'bg-selection')} options={[{ value: '', label: 'Status' }, ...options.statuses]} />
        <Select<string>
          aria-label="In CRM"
          value={filter.crm ?? ''}
          onValueChange={(v) => set('crm', v)}
          className={cx('w-auto', filter.crm && 'bg-selection')}
          options={[{ value: '', label: 'CRM' }, { value: 'yes', label: 'Handed to CRM' }, { value: 'no', label: 'Not in CRM' }]}
        />
        {chips.map(([k, label]) => (
          <button key={k} type="button" onClick={() => set(k, '')} className="flex h-[26px] items-center gap-1 rounded-full bg-selection px-2.5 text-[12px] font-semibold text-primary hover:underline">
            {label} <Icon name="x" size={12} />
            <span className="sr-only">(clear)</span>
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div role="region" aria-label="For the chosen contacts" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/30 bg-selection px-3 py-2 text-[13px]">
          <b className="text-ink">{selected.size} selected</b>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          {can('lists') ? (
            <button type="button" className={btnSmall} onClick={() => setDoing('add_to_list')}>
              Add to list
            </button>
          ) : null}
          {can('edit') ? (
            <button type="button" className={btnSmall} onClick={() => setDoing('tag')}>
              Tag
            </button>
          ) : null}
          {can('convert') ? (
            <button type="button" className={btnSmall} onClick={() => setDoing('convert')}>
              Hand over to CRM
            </button>
          ) : null}
          {can('suppression') ? (
            <button type="button" className={btnBad} onClick={() => setDoing('suppress')}>
              Suppress
            </button>
          ) : null}
          {more.length ? <MoreMenu label="More for the chosen contacts" items={more} /> : null}
          <span className="flex-1" />
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => choose(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      <section aria-label="Contacts" className="min-w-0 overflow-hidden rounded-[12px] border border-line bg-surface">
        {list.isLoading ? <Spinner label="Loading contacts…" /> : null}
        {list.error && !list.data ? (
          <div className="p-3">
            <Refused error={list.error} fallback="The contacts could not be loaded." onRetry={() => void list.refetch()} />
          </div>
        ) : null}
        {list.data && rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="m-0 text-[14px] font-semibold text-ink">{filtered ? 'Nobody matches these filters.' : 'No contacts yet.'}</p>
            <p className="m-0 mt-1 text-[12.5px] text-ink-3">{filtered ? 'Clear a filter to see more.' : 'Add somebody by hand, or import a spreadsheet of them.'}</p>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto scroll-thin">
            <table className={cx(TABLE, 'min-w-[860px]')}>
              <thead>
                <tr>
                  <th scope="col" className={cx(TH, 'w-9 pr-0')}>
                    <Checkbox aria-label="Select every contact on this page" checked={all} indeterminate={!all && rows.some((r) => selected.has(r.id))} onChange={() => choose(all ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                  <th scope="col" className={TH}>
                    Contact
                  </th>
                  <th scope="col" className={TH}>
                    Organisation
                  </th>
                  <th scope="col" className={TH}>
                    Source
                  </th>
                  <th scope="col" className={TH}>
                    Email consent
                  </th>
                  <th scope="col" className={TH}>
                    Tags
                  </th>
                  <th scope="col" className={TH}>
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody className={cx(list.isPlaceholderData && 'opacity-60')}>
                {rows.map((c) => {
                  const word = emailWord(c, options);
                  return (
                    <tr key={c.id} className={cx(ROW_LINK, selected.has(c.id) && 'bg-selection/50')} onClick={() => onOpen(c.id)}>
                      <td className={cx(TD, 'w-9 pr-0')}>
                        <Checkbox aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                      <td className={TD}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Initials name={c.name} size={28} />
                          <span className="flex min-w-0 flex-col">
                            <button type="button" onClick={(e) => (e.stopPropagation(), onOpen(c.id))} className="truncate text-left font-bold text-ink hover:underline">
                              {c.name}
                            </button>
                            <span className="truncate text-[11.5px] text-ink-3" title={c.phone_masked ? 'The number is masked: changing contacts in this company is not yours to do.' : undefined}>
                              {c.email ?? c.phone ?? '—'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className={cx(TD, 'max-w-[200px] truncate')}>{c.company?.name ?? '—'}</td>
                      <td className={cx(TD, 'max-w-[170px] truncate text-ink-2')}>{c.source_label}</td>
                      <td className={TD}>
                        <Pill tone={word.tone}>{word.label}</Pill>
                      </td>
                      <td className={TD}>
                        {c.tags.length === 0 ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <span className="flex items-center gap-1 whitespace-nowrap" title={c.tags.join(', ')}>
                            {c.tags.slice(0, 2).map((t) => (
                              <Pill key={t} tone="blue">
                                {t}
                              </Pill>
                            ))}
                            {c.tags.length > 2 ? <span className="text-[11px] text-ink-3">+{c.tags.length - 2}</span> : null}
                          </span>
                        )}
                      </td>
                      <td className={cx(TD, 'max-w-[260px] truncate text-ink-2')}>{lastActivity(c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data && total > 0 ? <Pager page={page} per={PER} total={total} onPage={(p) => setPaging({ key, page: p })} /> : null}
      </section>

      {doing ? <BulkSheet kind={doing} ids={[...selected]} org={org} options={options} onClose={() => setDoing(null)} onDone={() => (setDoing(null), choose(new Set()))} /> : null}
      {adding ? (
        <ContactSheet
          options={options}
          org={org}
          onClose={() => setAdding(false)}
          onSaved={(id) => (setAdding(false), id ? onOpen(id) : undefined)}
          onOpen={(id) => (setAdding(false), onOpen(id))}
        />
      ) : null}
    </div>
  );
}

/** The last thing that happened to them, as the server worded it; an older server sends only when they were last contacted. */
function lastActivity(c: ContactRow): string {
  if (c.last_activity) return [c.last_activity.title, relative(c.last_activity.at)].filter(Boolean).join(' · ');
  if (c.last_contacted_at) return `Contacted · ${relative(c.last_contacted_at)}`;
  return '—';
}

const TITLES: Record<Bulk, string> = {
  add_to_list: 'Add to a list', remove_from_list: 'Take off a list', tag: 'Tag them', untag: 'Remove a tag', status: 'Set their status',
  owner: 'Give them to an owner', convert: 'Hand over to CRM', suppress: 'Suppress them', delete: 'Delete them',
};

/**
 * One act on the chosen contacts, with the one thing it needs — a list, a tag,
 * a status, an owner, which channel to suppress — and then the server's
 * sentence about how many it changed (POST contacts/bulk).
 */
function BulkSheet({ kind, ids, org, options, onClose, onDone }: { kind: Bulk; ids: number[]; org: string; options: Options; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(kind === 'suppress' ? 'email' : '');
  const [busy, setBusy] = useState(false);
  const lists = useLists(org);
  const me = useMeId();
  const people = everybody(options);
  const who = `${ids.length} ${ids.length === 1 ? 'contact' : 'contacts'}`;
  const needs = kind !== 'convert' && kind !== 'delete';

  const run = async () => {
    setBusy(true);
    const v = kind === 'add_to_list' || kind === 'remove_from_list' ? Number(value) : kind === 'owner' ? (value === 'none' ? null : Number(value)) : kind === 'tag' || kind === 'untag' ? value.trim() : value;
    const ok = await act(() => send('POST', '/api/marketing/contacts/bulk', needs ? { action: kind, ids, value: v } : { action: kind, ids }), 'Done.');
    setBusy(false);
    if (ok) onDone();
  };

  let body: ReactNode;
  if (kind === 'add_to_list' || kind === 'remove_from_list') {
    body = (
      <Field label="List">
        <Select<string> aria-label="List" value={value} placeholder="Choose a list" onValueChange={setValue} options={(lists.data?.items ?? []).map((l) => ({ value: String(l.id), label: l.name, hint: `${n(l.members)} on it` }))} className={input} />
      </Field>
    );
  } else if (kind === 'tag' || kind === 'untag') {
    body = (
      <Field label="Tag">
        <input autoFocus className={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder="vendor" />
      </Field>
    );
  } else if (kind === 'status') {
    body = (
      <Field label="Status">
        <Select<string> aria-label="Status" value={value} placeholder="Choose a status" onValueChange={setValue} options={options.statuses} className={input} />
      </Field>
    );
  } else if (kind === 'owner') {
    body = (
      <Field label="Owner">
        <Select<string>
          aria-label="Owner"
          value={value}
          placeholder="Choose somebody"
          onValueChange={setValue}
          options={[{ value: 'none', label: 'Nobody' }, ...(me ? [{ value: String(me), label: 'Me' }] : []), ...people.filter((p) => p.value !== String(me))]}
          className={input}
        />
      </Field>
    );
  } else if (kind === 'suppress') {
    body = (
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">What to suppress</legend>
        {[
          ['email', 'Their email address', 'Suppressed by hand: no campaign email goes to it, now or if they are imported again.'],
          ['phone', 'Their number (do not call)', 'Put on the do-not-call list: no call campaign rings it.'],
        ].map(([v, label, hint]) => (
          <label key={v} className="flex items-start gap-2 text-[13px] text-ink">
            <input type="radio" name="suppress" className="mt-1" checked={value === v} onChange={() => setValue(v!)} />
            <span>
              <b className="block">{label}</b>
              <span className="text-[12px] text-ink-3">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    );
  } else if (kind === 'convert') {
    body = <p className="m-0 text-[13px] leading-[1.55] text-ink-2">A lead is made in CRM for each, with where they came from, their tags and lists, and what they agreed to — or, when CRM already has them, the two are linked and nothing is copied. Only contacts you may hand over are.</p>;
  } else {
    body = <p className="m-0 text-[13px] leading-[1.55] text-ink-2">They leave every list and segment. An address or number they unsubscribed or were suppressed on stays suppressed, so adding them again later cannot start marketing to them.</p>;
  }

  return (
    <Sheet
      title={`${TITLES[kind]} · ${who}`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, (kind === 'delete' || kind === 'suppress') && '!bg-danger hover:opacity-90')} disabled={busy || (needs && value.trim() === '')} onClick={() => void run()}>
            {busy ? 'Working…' : kind === 'delete' ? 'Delete' : kind === 'convert' ? 'Hand over' : kind === 'suppress' ? 'Suppress' : 'Apply'}
          </button>
        </>
      }
    >
      {body}
    </Sheet>
  );
}
