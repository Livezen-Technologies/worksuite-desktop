import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { plainText } from '../../core/rich';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { btn, btnPrimary, Cell, Empty, Field, input, Kpi, PageHead, row, Sheet, SidePanel, StatusChip, THead } from './parts';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { StatGrid } from '../../components/StatCard';

/**
 * Announcements (HrAdminSheet "Announcements"; the web's HrAnnouncements):
 * what HR has told one company, several or all of those you may publish to
 * (worksuite-desktop#98) — written, saved as a draft, published, edited,
 * withdrawn — and who has read and acknowledged it. Before anything goes out
 * it says how many people it reaches, in which companies; someone in two of
 * them gets it once.
 *
 * The companies offered are the server's answer to "where may you write one,
 * and where may you also publish it" (`announcements/companies`); a company
 * where you may only write is chosen for a draft and named when it stops the
 * draft being published.
 */
interface Company {
  id: number;
  name: string;
  /** Whether you may publish there, not only write a draft (newer servers; older ones mean yes). */
  publish?: boolean;
}

export interface AnnouncementRow {
  id: number;
  title: string;
  /** A display string: one company, several, or "All companies". */
  company: string;
  org_id: number | null;
  /** Newer servers (#98): every company it goes to, and whether that is "all you may publish to". */
  companies?: Company[];
  all_companies?: boolean;
  body?: string | null;
  category: string;
  priority: string;
  status: string;
  pinned: boolean;
  requires_ack: boolean;
  publish_at: string | null;
  published_at: string | null;
  expires_at: string | null;
  /** Whether you may change it (every company it goes to is one you may write for). */
  manageable?: boolean;
  /** Whether you may publish or withdraw it (every company it goes to is one you may publish to). */
  publishable?: boolean;
}

interface Report {
  stats: { notified: number; read: number; acknowledged: number };
  revision: number;
  companies?: Company[];
  people: Array<{ id: number; name: string; email: string; read: boolean; acknowledged: boolean; ack_revision: number | null; company?: string | null }>;
}

export interface Audience {
  total: number;
  companies: Array<{ id: number; name: string; count: number }>;
}

interface CompanyChoices {
  items: Company[];
  default: number | null;
}

const when = (s: string | null) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (body: string) =>
  body
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
const PRIORITY: Record<string, string> = { normal: 'Normal', important: 'Important', urgent: 'Urgent' };

const STATUS: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', publishing: 'Publishing', published: 'Published', expired: 'Expired', cancelled: 'Withdrawn' };

/** What the status is called here: a cancelled announcement was withdrawn. */
export function statusLabel(status: string): string {
  return STATUS[status] ? text(STATUS[status]) : status[0]!.toUpperCase() + status.slice(1);
}

/** "3 companies", or one. */
const companyCount = (n: number) => (n === 1 ? text('1 company') : text('{n} companies', { n: n.toLocaleString() }));

/** "Livezen", "Livezen and Asterix", "3 companies" — or all of them. */
export function companiesLabel(r: Pick<AnnouncementRow, 'company' | 'companies' | 'all_companies'>): string {
  if (r.all_companies) return text('All companies');
  const c = r.companies ?? [];
  if (!c.length) return r.company;
  return c.length === 1 ? c[0]!.name : c.length === 2 ? text('{a} and {b}', { a: c[0]!.name, b: c[1]!.name }) : companyCount(c.length);
}

/** "128 people in 2 companies". */
export function audienceLine(a: Audience): string {
  const people = a.total === 1 ? text('1 person') : text('{n} people', { n: a.total.toLocaleString() });
  return text('{people} in {companies}', { people, companies: companyCount(a.companies.length) });
}

/** "Livezen and Asterix" for a sentence: the names, joined. */
const names = (list: Company[]) => list.map((c) => c.name).join(', ');

/**
 * The companies you may announce to. An older server without its own list
 * answers 404, and then every company HR lets you use is offered as before.
 */
function useCompanies() {
  return useQuery({
    queryKey: ['hr', 'announcement-companies'],
    queryFn: async ({ signal }): Promise<CompanyChoices> => {
      try {
        return await apiGet<CompanyChoices>('/api/hr/announcements/companies', undefined, signal);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        const c = await apiGet<{ organizations: Company[]; default: number | null }>('/api/hr/context', undefined, signal);
        return { items: c.organizations, default: c.default };
      }
    },
  });
}

/** Where "All companies" reaches: those you may publish to, or every one offered when you may publish to none. */
export function allOf(companies: Company[]): Company[] {
  const sendable = companies.filter((c) => c.publish !== false);
  return sendable.length ? sendable : companies;
}

const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Who it would reach, asked as the companies change (a moment after the last change). */
function useAudience(ids: number[], all: boolean, enabled = true) {
  const key = all ? 'all' : [...ids].sort((a, b) => a - b).join(',');
  const [asked, setAsked] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setAsked(key), 300);
    return () => clearTimeout(t);
  }, [key]);
  return useQuery({
    queryKey: ['hr', 'announcement-audience', asked],
    queryFn: ({ signal }) => apiGet<Audience>('/api/hr/announcements/audience', { org_ids: asked }, signal),
    enabled: enabled && asked !== '',
    retry: false,
    staleTime: 30_000,
  });
}

export default function Announcements() {
  const qc = useQueryClient();
  const companies = useCompanies();
  const [org, setOrg] = useState('');
  const [writing, setWriting] = useState<AnnouncementRow | 'new' | null>(null);
  const [sending, setSending] = useState<AnnouncementRow | null>(null);
  const [withdrawing, setWithdrawing] = useState<AnnouncementRow | null>(null);
  const [deleting, setDeleting] = useState<AnnouncementRow | null>(null);
  const [report, setReport] = useState<AnnouncementRow | null>(null);
  const q = useQuery({ queryKey: ['hr', 'announcements', org], queryFn: ({ signal }) => apiGet<{ items: AnnouncementRow[] }>('/api/hr/announcements', org ? { org } : undefined, signal) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['hr', 'announcements'] });
    void qc.invalidateQueries({ queryKey: ['announcements'] });
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };
  const list = companies.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Announcements" sub="What HR has told each company, and who has read it.">
        {list.length > 1 ? (
          <OrgSwitcher label="Filter by company" orgs={list.map((c) => ({ id: String(c.id), name: c.name }))} value={org ? [org] : []} onChange={(ids) => setOrg(ids[0] ?? '')} />
        ) : null}
        <button type="button" className={btnPrimary} onClick={() => setWriting('new')}>
          New announcement
        </button>
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Title', null], ['Companies', 160], ['Priority', 100], ['Acknowledgement', 120], ['Status', 110], ['Sent', 110], ['', 230]]} />
          {q.data.items.map((r) => {
            const mayWrite = r.manageable !== false;
            const maySend = mayWrite && r.publishable !== false;
            return (
              <div key={r.id} className={row}>
                <Cell w={null} className="font-semibold">
                  {r.pinned ? <Icon name="pin" size={12} className="mr-1 inline text-ink-3" /> : null}
                  {r.title}
                </Cell>
                <Cell w={160} className="text-ink-2">
                  <span title={(r.companies ?? []).map((c) => c.name).join(', ') || r.company}>{companiesLabel(r)}</span>
                </Cell>
                <Cell w={100} className="!overflow-visible">
                  <StatusChip className={r.priority === 'urgent' ? '!bg-danger-bg !text-danger' : r.priority === 'important' ? '!bg-warning-bg !text-[#9A4A06] dark:!text-warning' : '!bg-subtle !text-ink-2'}>{text(PRIORITY[r.priority] ?? r.priority)}</StatusChip>
                </Cell>
                <Cell w={120} className="text-ink-2">{r.requires_ack ? 'Required' : 'Not required'}</Cell>
                <Cell w={110} className="!overflow-visible">
                  <StatusChip>{statusLabel(r.status)}</StatusChip>
                </Cell>
                <Cell w={110} className="text-ink-3">{when(r.published_at)}</Cell>
                <span className="flex w-[230px] shrink-0 justify-end gap-3 text-[12.5px] font-bold">
                  {mayWrite && (r.status === 'draft' || r.status === 'published') ? (
                    <button type="button" className="text-primary hover:underline" onClick={() => setWriting(r)}>
                      Edit
                    </button>
                  ) : null}
                  {r.status === 'draft' ? (
                    maySend ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => setSending(r)}>
                        Publish
                      </button>
                    ) : null
                  ) : (
                    <button type="button" className="text-primary hover:underline" onClick={() => setReport(r)}>
                      Who has read it
                    </button>
                  )}
                  {!mayWrite ? null : r.status === 'published' ? (
                    maySend ? (
                      <button type="button" className="text-danger hover:underline" onClick={() => setWithdrawing(r)}>
                        Withdraw
                      </button>
                    ) : null
                  ) : (
                    <button type="button" className="text-danger hover:underline" onClick={() => setDeleting(r)}>
                      Delete
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {!q.data.items.length ? <Empty text="Nothing announced yet." /> : null}
        </div>
      ) : null}
      {writing && writing !== 'new' ? <EditLoader row={writing} companies={list} defaultCompany={companies.data?.default ?? null} onClose={() => setWriting(null)} onDone={() => (setWriting(null), refresh())} /> : null}
      {writing === 'new' ? <Composer row={null} companies={list} defaultCompany={companies.data?.default ?? null} onClose={() => setWriting(null)} onDone={() => (setWriting(null), refresh())} /> : null}
      {sending ? <PublishSheet row={sending} onClose={() => setSending(null)} onPublish={() => run(() => apiPost(`/api/hr/announcements/${sending.id}/publish`, {}), text('Published.')).then((ok) => ok && setSending(null))} /> : null}
      {withdrawing ? (
        <Sheet
          title={`Withdraw “${withdrawing.title}”?`}
          width={440}
          onClose={() => setWithdrawing(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setWithdrawing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} onClick={() => void run(() => apiPost(`/api/hr/announcements/${withdrawing.id}/withdraw`, {}), text('Withdrawn.')).then((ok) => ok && setWithdrawing(null))}>
                Withdraw
              </button>
            </>
          }
        >
          <span className="text-ink-2">It disappears from everybody’s home screen in every company it went to, and its notification no longer opens it. Who read and acknowledged it stays in the report.</span>
        </Sheet>
      ) : null}
      {deleting ? (
        <Sheet
          title={`Delete “${deleting.title}”?`}
          width={420}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} onClick={() => void run(() => apiDelete(`/api/hr/announcements/${deleting.id}`), text('Deleted.')).then((ok) => ok && setDeleting(null))}>
                Delete
              </button>
            </>
          }
        >
          <span className="text-ink-2">{deleting.status === 'draft' ? 'The draft is removed.' : 'It is removed, and who read it is no longer shown.'}</span>
        </Sheet>
      ) : null}
      {report ? <ReportPanel row={report} onClose={() => setReport(null)} /> : null}
    </div>
  );
}

/** Editing reads the whole announcement first (the list has no message); an older server without that edits from the row. */
function EditLoader({ row: r, ...rest }: { row: AnnouncementRow; companies: Company[]; defaultCompany: number | null; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['hr', 'announcement', r.id], queryFn: ({ signal }) => apiGet<AnnouncementRow>(`/api/hr/announcements/${r.id}`, undefined, signal), retry: false });
  if (q.isLoading) return null;
  return <Composer row={q.data ? { ...r, ...q.data } : r} {...rest} />;
}

/** Publishing says who it reaches first. */
function PublishSheet({ row: r, onClose, onPublish }: { row: AnnouncementRow; onClose: () => void; onPublish: () => void }) {
  const ids = (r.companies ?? []).map((c) => c.id);
  const audience = useAudience(ids.length ? ids : r.org_id ? [r.org_id] : [], !!r.all_companies || (!ids.length && r.org_id === null));
  return (
    <Sheet
      title={`Publish “${r.title}”?`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={onPublish}>
            Publish Announcement
          </button>
        </>
      }
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] font-semibold text-ink-3">Target audience</span>
        <b className="text-ink">{audience.data ? audienceLine(audience.data) : companiesLabel(r)}</b>
      </span>
      {audience.data && audience.data.companies.length > 1 ? <AudienceBreakdown a={audience.data} /> : null}
      <span className="text-ink-2">They see it on their home screen and are notified once.</span>
      {r.requires_ack ? <span className="text-ink-2">Each of them is asked to confirm they have read it.</span> : null}
      <span className="text-[12px] text-ink-3">Who receives it is fixed once it is published.</span>
    </Sheet>
  );
}

function AudienceBreakdown({ a }: { a: Audience }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] text-ink-3">
      {a.companies.map((c) => (
        <li key={c.id} className="flex justify-between">
          <span>{c.name}</span>
          <span className="tabular">{c.count.toLocaleString()}</span>
        </li>
      ))}
      <li className="text-[11.5px]">Someone in more than one of them is counted, and notified, once.</li>
    </ul>
  );
}

/**
 * Companies to publish to (#98): search, checkboxes, "All companies you may
 * publish to", chips for the chosen ones, how many, Select All and Clear
 * Selection. All is never wider than the companies you may publish to.
 */
export function CompanyPicker({ companies, value, onChange }: { companies: Company[]; value: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = companies.filter((c) => !needle || c.name.toLowerCase().includes(needle));
  const everyone = allOf(companies).map((c) => c.id);
  const isAll = everyone.length > 0 && sameIds(value, everyone);
  const flip = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded-[8px] border border-line bg-surface p-1">
        {value.map((id) => {
          const c = companies.find((x) => x.id === id);
          return c ? (
            <span key={id} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold', c.publish === false ? 'bg-warning-bg text-[#9A4A06] dark:text-warning' : 'bg-selection text-primary')} title={c.publish === false ? text('You may write drafts for {name} but not publish to it.', { name: c.name }) : undefined}>
              {c.name}
              {c.publish === false ? <span className="font-normal">· {text('draft only')}</span> : null}
              <button type="button" aria-label={text('Remove {name}', { name: c.name })} onClick={() => flip(id)} className="rounded-full hover:bg-primary/10">
                <Icon name="x" size={12} />
              </button>
            </span>
          ) : null;
        })}
        <input aria-label="Search companies" value={q} onChange={(e) => setQ(e.target.value)} placeholder={value.length ? '' : text('Search companies…')} className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[13px] text-ink outline-none" />
      </div>
      <div className="flex items-center gap-3 text-[12px]">
        <span className="text-ink-3" aria-live="polite">
          {isAll ? (
            <>
              <span>All companies</span>
              {' · '}
            </>
          ) : null}
          <span>{text('{n} selected', { n: value.length })}</span>
        </span>
        <span className="flex-1" />
        <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-40" disabled={!everyone.length || isAll} onClick={() => onChange(everyone)}>
          Select All
        </button>
        <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-40" disabled={!value.length} onClick={() => onChange([])}>
          Clear Selection
        </button>
      </div>
      <ul role="listbox" aria-label="Companies" aria-multiselectable className="m-0 flex max-h-[170px] list-none flex-col overflow-y-auto rounded-[8px] border border-line p-1 scroll-thin">
        {!needle && companies.length > 1 ? (
          <li role="option" aria-selected={isAll} className="border-b border-line/70">
            <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1 text-[13px] font-semibold text-ink hover:bg-subtle">
              <Checkbox aria-label="All companies you may publish to" checked={isAll} indeterminate={!isAll && value.length > 0} onChange={() => onChange(isAll ? [] : everyone)} />
              <span>All companies you may publish to</span>
              <span className="ml-auto text-[12px] font-normal text-ink-3 tabular">{everyone.length}</span>
            </label>
          </li>
        ) : null}
        {shown.map((c) => (
          <li key={c.id} role="option" aria-selected={value.includes(c.id)}>
            <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1 text-[13px] text-ink hover:bg-subtle">
              <Checkbox aria-label={c.name} checked={value.includes(c.id)} onChange={() => flip(c.id)} />
              {c.name}
              {c.publish === false ? <span className="ml-auto text-[11.5px] text-ink-3">Drafts only</span> : null}
            </label>
          </li>
        ))}
        {!shown.length ? <li className="px-1.5 py-1 text-[12.5px] text-ink-3">No company matches.</li> : null}
      </ul>
    </div>
  );
}

function Composer({ row: r, companies, defaultCompany, onClose, onDone }: { row: AnnouncementRow | null; companies: Company[]; defaultCompany: number | null; onClose: () => void; onDone: () => void }) {
  const initialIds = useMemo(() => {
    if (r?.all_companies) return allOf(companies).map((c) => c.id);
    if (r?.companies?.length) return r.companies.map((c) => c.id);
    if (r?.org_id) return [r.org_id];
    return defaultCompany && companies.some((c) => c.id === defaultCompany) ? [defaultCompany] : companies.length === 1 ? [companies[0]!.id] : [];
  }, [r, companies, defaultCompany]);
  const [title, setTitle] = useState(r?.title ?? '');
  const [body, setBody] = useState(r?.body ? plainText(r.body) : '');
  const [bodyTouched, setBodyTouched] = useState(false);
  const [priority, setPriority] = useState(r?.priority ?? 'normal');
  const [ids, setIds] = useState<number[] | null>(null);
  const [ack, setAck] = useState(r?.requires_ack ?? false);
  const [pinned, setPinned] = useState(r?.pinned ?? false);
  const [expires, setExpires] = useState(r?.expires_at?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const chosen = ids ?? initialIds;
  const all = companies.length > 0 && sameIds(chosen, allOf(companies).map((c) => c.id));
  const audience = useAudience(chosen, all, chosen.length > 0);
  const published = r?.status === 'published';
  /** Chosen companies you may write for but not publish to: they stop Publish, not Save Draft. */
  const draftOnly = companies.filter((c) => c.publish === false && chosen.includes(c.id));
  const missing = !title.trim() ? text('Give it a title.') : !chosen.length ? text('Choose at least one company.') : !r && !body.trim() ? text('Write the message.') : null;
  const noPublish = draftOnly.length ? text('You may not publish to {names}. Save it as a draft, or remove them.', { names: names(draftOnly) }) : null;

  const payload = () => ({
    title: title.trim(),
    ...(!r || bodyTouched ? { body: html(body) } : {}),
    priority,
    org_ids: all ? 'all' : chosen,
    ...(!r ? { audience_type: 'all' } : {}),
    requires_ack: ack,
    pinned,
    expires_at: expires ? `${expires} 23:59:59` : null,
  });
  const save = async (publish: boolean) => {
    setBusy(true);
    try {
      const saved = r ? await apiPut<{ id?: number }>(`/api/hr/announcements/${r.id}`, payload()) : await apiPost<{ id?: number; item?: { id: number } }>('/api/hr/announcements', payload());
      const id = r?.id ?? (saved as { id?: number; item?: { id: number } }).id ?? (saved as { item?: { id: number } }).item?.id;
      if (publish && id) await apiPost(`/api/hr/announcements/${id}/publish`, {});
      toast('success', publish ? text('Published.') : published ? text('Changes saved; readers see them now.') : text('Saved as a draft. Nobody sees it until it is published.'));
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
      setConfirming(false);
    }
  };
  const hint = missing ?? (published ? null : noPublish);
  return (
    <Sheet
      title={r ? 'Edit announcement' : 'New announcement'}
      width={600}
      onClose={onClose}
      footer={
        <>
          {hint ? <span className="mr-auto text-[12px] text-ink-3">{hint}</span> : null}
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          {published ? (
            <button type="button" disabled={busy || !!missing} className={btnPrimary} onClick={() => void save(false)}>
              Save changes
            </button>
          ) : (
            <>
              <button type="button" disabled={busy || !!missing} className={btn} onClick={() => void save(false)}>
                Save Draft
              </button>
              <button type="button" disabled={busy || !!missing || !!noPublish} className={btnPrimary} onClick={() => setConfirming(true)}>
                Publish Announcement
              </button>
            </>
          )}
        </>
      }
    >
      <Field label="Title">
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Annual staff meeting" className={input} />
      </Field>
      <Field label="Message" hint={r && !r.body && !bodyTouched ? 'Leave empty to keep the message as it is.' : undefined}>
        <textarea aria-label="Message" value={body} onChange={(e) => (setBody(e.target.value), setBodyTouched(true))} placeholder="Friday at 10:00 in the main hall." className={input + ' !h-[120px] resize-none py-2'} />
      </Field>
      <Field label="Companies">
        <CompanyPicker companies={companies} value={chosen} onChange={setIds} />
      </Field>
      <p className={cx('m-0 text-[12.5px]', audience.data ? 'text-ink-2' : 'text-ink-3')} aria-live="polite">
        {!chosen.length ? text('Choose who it is for.') : audience.data ? text('Reaches {audience}.', { audience: audienceLine(audience.data) }) : audience.isLoading ? text('Counting who it reaches…') : null}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Priority">
          <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={input}>
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Expires" hint="Optional: it disappears after this day.">
          <input aria-label="Expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={input} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <Checkbox aria-label="Pin it" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="mt-[2px]" />
        <span>
          <b>Pin it</b> <span className="text-ink-3">— kept near the top of everyone's list.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <Checkbox aria-label="Ask everyone to acknowledge it" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-[2px]" />
        <span>
          <b>Ask everyone to acknowledge it</b>
          <br />
          <span className="text-ink-3">Each person confirms they have read it, and you see who has and has not.</span>
        </span>
      </label>
      {confirming ? (
        <div role="alertdialog" aria-label="Publish now?" className="flex flex-col gap-2 rounded-[10px] border border-primary/30 bg-selection p-3 text-[12.5px] text-ink">
          <b>{text('Publish to {audience}?', { audience: audience.data ? audienceLine(audience.data) : companyCount(chosen.length) })}</b>
          {audience.data && audience.data.companies.length > 1 ? <AudienceBreakdown a={audience.data} /> : null}
          <span className="text-ink-2">Each person is notified once. Who receives it is fixed once it is published.</span>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setConfirming(false)}>
              Not yet
            </button>
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => void save(true)}>
              Publish now
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/** One person's state: acknowledged (this text or an earlier one), read, or not read. */
function personState(p: Report['people'][number], revision: number, asked: boolean): string {
  if (p.acknowledged) return p.ack_revision !== null && p.ack_revision < revision ? text('Acknowledged earlier text') : text('Acknowledged');
  if (p.read) return asked ? text('Read, not acknowledged') : text('Read');
  return text('Not read');
}

function ReportPanel({ row: r, onClose }: { row: AnnouncementRow; onClose: () => void }) {
  const [org, setOrg] = useState('');
  const q = useQuery({ queryKey: ['hr', 'announcement-report', r.id, org], queryFn: ({ signal }) => apiGet<Report>(`/api/hr/announcements/${r.id}/report`, org ? { org } : undefined, signal) });
  const d = q.data;
  const choices = d?.companies ?? r.companies ?? [];
  return (
    <SidePanel label="Who has read it" width={540} onClose={onClose} head={<b className="truncate text-ink">{r.title}</b>}>
      {choices.length > 1 ? (
        <div>
          <OrgSwitcher label="Company" orgs={choices.map((c) => ({ id: String(c.id), name: c.name }))} value={org ? [org] : []} onChange={(ids) => setOrg(ids[0] ?? '')} />
        </div>
      ) : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <StatGrid min={150}>
            <Kpi icon="send" tone="blue" label="Sent to" value={d.stats.notified} />
            <Kpi icon="eye" tone="violet" label="Read" value={d.stats.read} />
            <Kpi icon="check-check" tone="green" label="Acknowledged" value={r.requires_ack ? d.stats.acknowledged : '—'} />
          </StatGrid>
          <div className="flex flex-col">
            {d.people.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border-b border-line/70 py-2 text-[12.5px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{p.name}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{[p.email, p.company].filter(Boolean).join(' · ')}</span>
                </span>
                <StatusChip>{personState(p, d.revision, r.requires_ack)}</StatusChip>
              </div>
            ))}
            {!d.people.length ? <Empty text="Nobody yet." /> : null}
          </div>
        </>
      ) : null}
    </SidePanel>
  );
}
