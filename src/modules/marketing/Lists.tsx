import { useState } from 'react';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import type { MenuItem } from '../../components/Menu';
import { Select } from '../../components/Select';
import { Spinner } from '../../components/ui';
import { refreshMarketing, send } from './api';
import { act, ConfirmSheet, firstCompany, may, MoreMenu, Refused, useLists, useSegmentNames } from './audience-parts';
import { btn, btnPrimary, Field, input, n, PageHeader, Seg, Sheet } from './parts';
import { companiesWhere, fieldErrors, peopleOf, refusal, type MarketingList, type Options } from './types';

type Doing = { kind: 'edit'; list: MarketingList | null } | { kind: 'merge' | 'segment' | 'delete'; list: MarketingList } | null;

/**
 * Lists (MKT-LST-01): people chosen by hand for something — a newsletter, an
 * event, a campaign. Unlike a segment, a list does not change unless somebody
 * changes it: tick contacts in Contacts, add a segment's members here, or name
 * one when importing. Archiving keeps one and its members out of the way;
 * deleting one keeps every contact that was on it.
 */
export default function Lists({ org, options, onContacts }: { org: string; options: Options; onContacts: (listId: number) => void }) {
  const [archived, setArchived] = useState(false);
  const [doing, setDoing] = useState<Doing>(null);
  const [busy, setBusy] = useState(false);
  const q = useLists(org, archived);
  const items = q.data?.items ?? [];
  const run = async (fn: () => Promise<{ message: string | null }>, fallback: string) => {
    setBusy(true);
    const ok = await act(fn, fallback);
    setBusy(false);
    if (ok) setDoing(null);
  };

  const menu = (l: MarketingList): MenuItem[] =>
    l.archived
      ? [
        { id: 'restore', label: 'Restore', icon: 'undo-edit', onSelect: () => void run(() => send('POST', `/api/marketing/lists/${l.id}/restore`), 'Restored.') },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDoing({ kind: 'delete', list: l }) },
      ]
      : [
        { id: 'edit', label: 'Rename or describe', icon: 'pen', onSelect: () => setDoing({ kind: 'edit', list: l }) },
        { id: 'segment', label: 'Add a segment’s members', icon: 'filter', onSelect: () => setDoing({ kind: 'segment', list: l }) },
        { id: 'merge', label: 'Merge other lists in', icon: 'columns', onSelect: () => setDoing({ kind: 'merge', list: l }) },
        { id: 'duplicate', label: 'Copy', icon: 'copy', onSelect: () => void run(() => send('POST', `/api/marketing/lists/${l.id}/duplicate`), 'Copied.') },
        { id: 'archive', label: 'Archive', icon: 'archive', onSelect: () => void run(() => send('POST', `/api/marketing/lists/${l.id}/archive`), 'Archived.') },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDoing({ kind: 'delete', list: l }) },
      ];

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        crumbs={['Audience']}
        title="Lists"
        sub="Fixed groups of contacts, chosen by hand — they change only when somebody changes them"
        actions={
          <>
            <Seg<'live' | 'archived'> label="Which lists" value={archived ? 'archived' : 'live'} onChange={(v) => setArchived(v === 'archived')} options={[{ id: 'live', label: 'In use' }, { id: 'archived', label: 'Archived' }]} />
            {companiesWhere(options, 'lists').length > 0 ? (
              <button type="button" className={btnPrimary} onClick={() => setDoing({ kind: 'edit', list: null })}>
                <Icon name="plus" size={15} /> New list
              </button>
            ) : null}
          </>
        }
      />

      {q.isLoading ? <Spinner /> : null}
      {q.error ? <Refused error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && items.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-4 py-10 text-center">
          <p className="m-0 text-[14px] font-semibold text-ink">{archived ? 'No archived lists.' : 'No lists yet.'}</p>
          <p className="m-0 mt-1 text-[12.5px] text-ink-3">A list is people chosen by hand — tick them in Contacts, add a segment&apos;s members, or name one when importing.</p>
        </div>
      ) : null}
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((l) => (
          <li key={l.id} className="flex min-w-0 flex-col rounded-[12px] border border-line bg-surface p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[14px] font-bold text-ink">{l.name}</p>
                {l.description ? <p className="m-0 line-clamp-2 text-[12px] text-ink-3">{l.description}</p> : null}
              </div>
              {may(options, 'lists', l.org_id) ? <MoreMenu label={`What to do with ${l.name}`} items={menu(l)} /> : null}
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <button type="button" onClick={() => onContacts(l.id)} className="text-left">
                <span className="block text-[22px] leading-tight font-bold text-ink tabular-nums">{n(l.members)}</span>
                <span className="text-[12px] font-bold text-primary hover:underline">{l.members === 1 ? 'contact' : 'contacts'} — see them</span>
              </button>
              <span className="text-right text-[11.5px] text-ink-3">
                {l.owner?.name ?? 'Nobody'}
                <br />
                changed {dateLabel(l.updated_at) || '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {doing?.kind === 'edit' ? <ListSheet list={doing.list} options={options} org={org} onClose={() => setDoing(null)} /> : null}
      {doing?.kind === 'merge' ? <MergeSheet list={doing.list} others={items.filter((o) => o.org_id === doing.list.org_id && o.id !== doing.list.id)} busy={busy} onRun={run} onClose={() => setDoing(null)} /> : null}
      {doing?.kind === 'segment' ? <SegmentSheet list={doing.list} busy={busy} onRun={run} onClose={() => setDoing(null)} /> : null}
      {doing?.kind === 'delete' ? (
        <ConfirmSheet title={`Delete ${doing.list.name}?`} action="Delete" danger busy={busy} onClose={() => setDoing(null)} onYes={() => void run(() => send('DELETE', `/api/marketing/lists/${doing.list.id}`), 'Deleted.')}>
          The {n(doing.list.members)} {doing.list.members === 1 ? 'contact' : 'contacts'} on it are kept; only the list goes.
        </ConfirmSheet>
      ) : null}
    </div>
  );
}

/** A new list, or its name, purpose and owner changed. */
export function ListSheet({ list, options, org, onClose, onSaved }: { list: MarketingList | null; options: Options; org: string; onClose: () => void; onSaved?: (id: number) => void }) {
  const makers = companiesWhere(options, 'lists');
  const [orgId, setOrgId] = useState(list ? String(list.org_id) : firstCompany(options, 'lists', org));
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [owner, setOwner] = useState(list?.owner ? String(list.owner.id) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const hint = (k: string) => (errors[k] ? <span className="text-danger">{errors[k]}</span> : undefined);

  const save = async () => {
    setBusy(true);
    setErrors({});
    const body = { name, description, ...(owner === '' && !list ? {} : { owner_id: owner === '' ? null : Number(owner) }) };
    try {
      const r = list ? await send<{ id?: number } | null>('PUT', `/api/marketing/lists/${list.id}`, body) : await send<{ id?: number } | null>('POST', '/api/marketing/lists', { ...body, org_id: Number(orgId) });
      toast('success', r.message ?? 'Saved.');
      await refreshMarketing();
      onSaved?.(list?.id ?? Number(r.data?.id ?? 0));
      onClose();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={list ? list.name : 'New list'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || name.trim() === '' || orgId === ''} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {!list && makers.length > 1 ? (
        <Field label="Company">
          <Select<string> aria-label="Company" value={orgId} placeholder="Which company?" onValueChange={(v) => (setOrgId(v), setOwner(''))} options={makers.map((c) => ({ value: String(c.id), label: c.name }))} className={input} />
        </Field>
      ) : null}
      <Field label="Name" hint={hint('name')}>
        <input autoFocus className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="What it is for" hint={hint('description')}>
        <textarea rows={2} className={`${input} !h-auto resize-none py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Owner" hint={hint('owner_id')}>
        <Select<string> aria-label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: list ? 'Nobody' : 'Me' }, ...peopleOf(options, Number(orgId) || null)]} className={input} />
      </Field>
    </Sheet>
  );
}

function MergeSheet({ list, others, busy, onRun, onClose }: { list: MarketingList; others: MarketingList[]; busy: boolean; onRun: (fn: () => Promise<{ message: string | null }>, fallback: string) => Promise<void>; onClose: () => void }) {
  const [from, setFrom] = useState<number[]>([]);
  const [archive, setArchive] = useState(true);
  return (
    <Sheet
      title={`Merge into ${list.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || from.length === 0} onClick={() => void onRun(() => send('POST', `/api/marketing/lists/${list.id}/merge`, { from, archive }), 'Merged.')}>
            Merge
          </button>
        </>
      }
    >
      {others.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-2">This company has no other list in use to merge.</p>
      ) : (
        <>
          <p className="m-0 text-[13px] text-ink-2">Everybody on the lists you choose is put on {list.name}; somebody on both is there once.</p>
          <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-auto p-0 scroll-thin">
            {others.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <Checkbox checked={from.includes(o.id)} onChange={(e) => setFrom(e.target.checked ? [...from, o.id] : from.filter((x) => x !== o.id))} />
                  {o.name} <span className="text-[12px] text-ink-3">{n(o.members)}</span>
                </label>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Archive them afterwards
          </label>
        </>
      )}
    </Sheet>
  );
}

function SegmentSheet({ list, busy, onRun, onClose }: { list: MarketingList; busy: boolean; onRun: (fn: () => Promise<{ message: string | null }>, fallback: string) => Promise<void>; onClose: () => void }) {
  const segments = useSegmentNames(String(list.org_id));
  const mine = (segments.data?.items ?? []).filter((s) => s.org_id === list.org_id);
  const [segment, setSegment] = useState('');
  return (
    <Sheet
      title={`Add to ${list.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || segment === ''} onClick={() => void onRun(() => send('POST', `/api/marketing/lists/${list.id}/members`, { segment_id: Number(segment) }), 'Added.')}>
            Add them
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Everybody the segment matches now is put on the list. The list keeps them; the segment goes on changing.</p>
      {segments.isLoading ? (
        <Spinner />
      ) : mine.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">This company has no segment yet.</p>
      ) : (
        <Field label="Segment">
          <Select<string> aria-label="Segment" value={segment} placeholder="Choose a segment" onValueChange={setSegment} options={mine.map((s) => ({ value: String(s.id), label: s.name }))} className={input} />
        </Field>
      )}
    </Sheet>
  );
}
