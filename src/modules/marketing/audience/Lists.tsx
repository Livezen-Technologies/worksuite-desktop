import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Button, cx, Empty, IconButton, Modal } from '../../../components/ui';
import { deleteList, exportListCsv, fetchListMembers, MK, removeListMembers, saveList, useLists, type MList } from '../api';
import { emailConsent } from '../lib/consent';
import { count, day, isoDay, plural, ratio, share } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Bar, Field, Input, Loaded, Notice, PageBody, PageHeader, Pager, saveCsv, Status, Table, TD, TextArea, TH, useAction } from '../parts';
import { ContactCell } from './ContactEditor';

/**
 * Lists (MKT-LST-01/02). Static lists: each one's size, consent coverage (members with recorded email consent) and
 * when a campaign last used it; create, rename, delete. A list's page shows its members, removes ticked ones and
 * exports them as CSV (MKT-IMP-05, audited on the server). Members are added from Contacts' bulk bar or by import.
 */
export default function Lists({ id }: { id: number | null }) {
  return id === null ? <ListIndex /> : <ListPage id={id} />;
}

/** Members with recorded email consent, as a share of the list; null when the server does not say. */
export function coverage(l: Pick<MList, 'members_count' | 'email_subscribed_count'>): number | null {
  if (typeof l.email_subscribed_count !== 'number') return null;
  return l.members_count > 0 ? ratio(l.email_subscribed_count, l.members_count) : 0;
}

type Edit = { list: MList | null } | null;

function ListIndex() {
  const { go } = useTab();
  const lists = useLists();
  const [edit, setEdit] = useState<Edit>(null);
  const [removing, setRemoving] = useState<MList | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Audience"
        title="Lists"
        sub={lists.data ? `${plural(lists.data.length, 'list')} · static: members are added from Contacts or by import` : 'Static lists: members are added from Contacts or by import'}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEdit({ list: null })}>
            New list
          </Button>
        }
      />
      <PageBody>
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
          <Loaded q={lists} what="Lists">
            {(rows) =>
              rows.length === 0 ? (
                <div className="rounded-[12px] border border-line bg-surface">
                  <Empty
                    icon="list"
                    title="No lists yet"
                    hint="Create a list, then add contacts to it from Contacts — tick them and choose Add to list — or when you import a CSV."
                    action={
                      <Button size="sm" variant="primary" icon="plus" className="mt-1" onClick={() => setEdit({ list: null })}>
                        New list
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Table
                  label="Lists"
                  head={
                    <tr>
                      <th className={TH}>List</th>
                      <th className={cx(TH, 'text-right')}>Members</th>
                      <th className={TH}>Consent coverage</th>
                      <th className={TH}>Last used</th>
                      <th className={cx(TH, 'w-[84px]')}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  }
                >
                  {rows.map((l) => {
                    const cover = coverage(l);
                    const open = () => go(`/marketing/lists/${l.id}`);
                    return (
                      <tr key={l.id} onClick={open} className="cursor-pointer hover:bg-subtle/60">
                        <td className={TD}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              open();
                            }}
                            className="block max-w-[360px] truncate text-left font-semibold text-ink hover:underline"
                          >
                            {l.name}
                          </button>
                          {l.description ? <div className="max-w-[360px] truncate text-[11.5px] text-ink-3">{l.description}</div> : null}
                        </td>
                        <td className={cx(TD, 'text-right')}>
                          <span className="font-mono tabular-nums">{count(l.members_count)}</span>
                        </td>
                        <td className={cx(TD, 'min-w-[180px]')}>
                          {cover === null ? (
                            <span className="text-ink-3">Not measured</span>
                          ) : (
                            <div className="flex items-center gap-2.5" title={`${count(l.email_subscribed_count)} of ${count(l.members_count)} members have recorded email consent`}>
                              <Bar value={cover} tone={cover >= 80 ? 'success' : cover >= 50 ? 'primary' : 'warning'} className="max-w-[140px]" />
                              <span className="font-mono text-[12px] text-ink-2 tabular-nums">{share(l.email_subscribed_count, l.members_count, 0)}</span>
                            </div>
                          )}
                        </td>
                        <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{l.last_used_at ? day(l.last_used_at) : 'Never'}</td>
                        <td className={cx(TD, 'whitespace-nowrap')} onClick={(e) => e.stopPropagation()}>
                          <IconButton icon="pen" label={`Rename ${l.name}`} onClick={() => setEdit({ list: l })} />
                          <IconButton icon="trash" label={`Delete ${l.name}`} onClick={() => setRemoving(l)} className="hover:text-danger" />
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )
            }
          </Loaded>
        </div>
      </PageBody>
      {edit ? (
        <ListEditor
          list={edit.list}
          onClose={() => setEdit(null)}
          onSaved={(l, created) => {
            setEdit(null);
            if (created) go(`/marketing/lists/${l.id}`);
          }}
        />
      ) : null}
      {removing ? <DeleteList list={removing} onClose={() => setRemoving(null)} onDeleted={() => setRemoving(null)} /> : null}
    </div>
  );
}

const PER_PAGE = 50;

function ListPage({ id }: { id: number }) {
  const { go } = useTab();
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const lists = useLists();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, run] = useAction();
  const members = useQuery({ queryKey: MK.listMembers(org, id, page), queryFn: ({ signal }) => fetchListMembers(id, page, signal), placeholderData: keepPreviousData });
  const list = lists.data?.find((l) => l.id === id) ?? null;
  const name = list?.name ?? 'List';
  // The list is not there (deleted, or another company's) — not a server without the route.
  const gone = members.error instanceof ApiError && members.error.status === 404 && !/route/i.test(members.error.message);

  const exportCsv = () => void run('export', async () => saveCsv(`list-${name}-${isoDay(new Date())}`, await exportListCsv(id)));
  const remove = () =>
    void run('remove', async () => {
      const r = await removeListMembers(id, [...selected]);
      toast('success', `${plural(r.affected, 'contact')} removed from ${name}.`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: MK.all });
    });

  const rows = members.data?.rows ?? [];
  const ids = rows.map((r) => r.id);
  const all = ids.length > 0 && ids.every((x) => selected.has(x));
  const some = ids.some((x) => selected.has(x));
  const toggle = (cid: number) => {
    const next = new Set(selected);
    if (next.has(cid)) next.delete(cid);
    else next.add(cid);
    setSelected(next);
  };
  const togglePage = () => {
    const next = new Set(selected);
    for (const x of ids) {
      if (all) next.delete(x);
      else next.add(x);
    }
    setSelected(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={
          <>
            Marketing /{' '}
            <button type="button" className="hover:text-ink hover:underline" onClick={() => go('/marketing/lists')}>
              Lists
            </button>
          </>
        }
        back={<IconButton icon="back" label="Back to lists" onClick={() => go('/marketing/lists')} />}
        title={name}
        sub={list?.description || undefined}
        actions={
          gone ? null : (
            <>
              <Button icon="download" loading={busy === 'export'} onClick={exportCsv}>
                Export CSV
              </Button>
              {list ? (
                <>
                  <Button icon="pen" onClick={() => setRenaming(true)}>
                    Rename
                  </Button>
                  <Button icon="trash" className="!border-danger/40 !text-danger" onClick={() => setDeleting(true)}>
                    Delete
                  </Button>
                </>
              ) : null}
            </>
          )
        }
      />
      <PageBody>
        {gone ? (
          <Empty
            icon="list"
            title="This list isn’t here"
            hint="It may have been deleted, or it belongs to another company."
            action={
              <Button size="sm" className="mt-1" onClick={() => go('/marketing/lists')}>
                Back to lists
              </Button>
            }
          />
        ) : (
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
            {list ? <Summary list={list} /> : null}
            <Notice
              icon="info"
              action={
                <span className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => go('/marketing/contacts')}>
                    Contacts
                  </Button>
                  <Button size="sm" onClick={() => go('/marketing/import')}>
                    Import
                  </Button>
                </span>
              }
            >
              Members are added from Contacts — tick them and choose Add to list — or when you import a CSV.
            </Notice>
            {selected.size > 0 ? (
              <div role="group" aria-label="Selected members" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/25 bg-selection px-3 py-2">
                <span className="text-[12.5px] font-bold text-ink" aria-live="polite">
                  {count(selected.size)} selected
                </span>
                <Button size="sm" icon="x" loading={busy === 'remove'} onClick={remove}>
                  Remove from list
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </div>
            ) : null}
            <Loaded q={members} what="This list’s members">
              {(data) =>
                data.rows.length === 0 ? (
                  <div className="rounded-[12px] border border-line bg-surface">
                    <Empty icon="users" title="No members yet" hint="Add contacts from Contacts’ bulk bar (Add to list), or choose this list when you import a CSV." />
                  </div>
                ) : (
                  <div className={cx('flex flex-col transition-opacity', members.isPlaceholderData && 'opacity-60')}>
                    <Table
                      label={`Members of ${name}`}
                      head={
                        <tr>
                          <th className={cx(TH, 'w-9')}>
                            <Checkbox aria-label="Select every member on this page" checked={all} indeterminate={!all && some} onChange={togglePage} />
                          </th>
                          <th className={TH}>Contact</th>
                          <th className={TH}>Organisation</th>
                          <th className={TH}>Email consent</th>
                        </tr>
                      }
                    >
                      {data.rows.map((c) => {
                        const e = emailConsent(c.email_consent);
                        const on = selected.has(c.id);
                        const open = () => go(`/marketing/contacts/${c.id}`);
                        return (
                          <tr key={c.id} onClick={open} className={cx('cursor-pointer', on ? 'bg-selection/70' : 'hover:bg-subtle/60')}>
                            <td className={cx(TD, 'w-9')} onClick={(e) => e.stopPropagation()}>
                              <Checkbox aria-label={`Select ${c.name}`} checked={on} onChange={() => toggle(c.id)} />
                            </td>
                            <td className={TD}>
                              <ContactCell c={c} onOpen={open} />
                            </td>
                            <td className={cx(TD, 'max-w-[240px] truncate text-ink-2')}>{c.organisation ?? '—'}</td>
                            <td className={TD}>
                              <Status tone={e.tone}>{e.label}</Status>
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                    <Pager
                      page={data.page}
                      pages={data.pages}
                      total={data.total}
                      perPage={data.perPage || PER_PAGE}
                      onPage={(p) => {
                        setPage(p);
                        setSelected(new Set());
                      }}
                    />
                  </div>
                )
              }
            </Loaded>
          </div>
        )}
      </PageBody>
      {renaming && list ? <ListEditor list={list} onClose={() => setRenaming(false)} onSaved={() => setRenaming(false)} /> : null}
      {deleting && list ? <DeleteList list={list} onClose={() => setDeleting(false)} onDeleted={() => go('/marketing/lists')} /> : null}
    </div>
  );
}

/** Size and consent coverage of the list (MKT-LST-02). */
function Summary({ list }: { list: MList }) {
  const parts = [plural(list.members_count, 'member')];
  if (typeof list.email_subscribed_count === 'number') parts.push(`${share(list.email_subscribed_count, list.members_count)} with email consent`);
  if (typeof list.phone_consented_count === 'number') parts.push(`${share(list.phone_consented_count, list.members_count)} with phone consent`);
  parts.push(list.last_used_at ? `last used ${day(list.last_used_at)}` : 'not used by a campaign yet');
  const cover = coverage(list);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-2">
      <span>{parts.join(' · ')}</span>
      {cover !== null ? <Bar value={cover} tone={cover >= 80 ? 'success' : cover >= 50 ? 'primary' : 'warning'} className="max-w-[200px] sm:ml-auto" /> : null}
    </div>
  );
}

function ListEditor({ list, onClose, onSaved }: { list: MList | null; onClose: () => void; onSaved: (l: MList, created: boolean) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [busy, run] = useAction();
  const valid = name.trim() !== '';
  const save = () =>
    void run('save', async () => {
      if (!valid) return;
      const l = await saveList(org, list?.id ?? null, { name: name.trim(), description: description.trim() || null });
      toast('success', list ? 'List saved.' : `${l.name} created.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onSaved(l, !list);
    });
  return (
    <Modal
      title={list ? `Rename ${list.name}` : 'New list'}
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy === 'save'} disabled={!valid}>
            {list ? 'Save' : 'Create list'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendors 2026" autoFocus autoComplete="off" />
        </Field>
        <Field label="Description" hint="Optional: who is on it and why.">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Registered vendors invited to the 2026 tenders." />
        </Field>
      </form>
    </Modal>
  );
}

function DeleteList({ list, onClose, onDeleted }: { list: MList; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [busy, run] = useAction();
  const remove = () =>
    void run('delete', async () => {
      await deleteList(list.id);
      toast('success', `${list.name} deleted.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onDeleted();
    });
  return (
    <Modal
      title="Delete list"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy === 'delete'} onClick={remove}>
            Delete list
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">
        Delete <b className="font-semibold text-ink">{list.name}</b>? Its {plural(list.members_count, 'member')} stay in Marketing with their consent; only the list and its memberships go.
      </p>
    </Modal>
  );
}
