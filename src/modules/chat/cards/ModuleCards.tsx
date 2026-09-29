import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCanOpen } from '../../../core/access';
import { ApiError, apiGet } from '../../../core/api';
import { call } from '../../../core/bridge';
import { dateLabel, relative, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { FileBadge } from '../../../components/ui';
import { openMeeting } from '../../meet/api';
import { CardFrame, Chip, Faces, type CardAction, type CardKind } from './CardFrame';
import type { RecordRef } from './recordLinks';
import { openRecord } from './RecordCards';

/**
 * A record named in a message, as a card: fetched with the reader's own
 * rights from the endpoint that record's screen uses, so what one person can
 * open another may not — and says so. Most modules answer 404 for both "not
 * yours" and "deleted", so the card says both; a 403 (a module permission)
 * is plainly "no access".
 */
type Ref = Exclude<RecordRef, { kind: 'meet' }>;

const ENDPOINT: Record<Ref['kind'], (id: number) => [string, Record<string, string | number>?]> = {
  task: (id) => [`/api/tasks/${id}`],
  note: (id) => [`/api/notes/${id}`],
  event: (id) => [`/api/calendar/events/${id}`],
  deal: (id) => [`/api/crm/deals/${id}`],
  lead: (id) => [`/api/crm/leads/${id}`],
  account: (id) => [`/api/crm/accounts/${id}`],
  invoice: (id) => [`/api/billing/invoices/${id}`],
  contact: (id) => [`/api/contacts/${id}`],
  meeting: (id) => [`/api/meetings/${id}`],
  file: (id) => [`/api/files/${id}/details`],
  folder: (id) => ['/api/drive/list', { folder_id: id, include_folders: 1, per_page: 3, counts: 0 }],
};

const money = (n: number | null | undefined, cur?: string | null) => (n === null || n === undefined ? '—' : `${cur ? `${cur} ` : ''}${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

// Loose on purpose: each module shapes its record differently.
type Rec = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const numOf = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

export function ModuleCard({ r }: { r: RecordRef }) {
  const ref = r as Ref;
  const [path, query] = ENDPOINT[ref.kind](ref.id);
  const q = useQuery({
    queryKey: ['chat', 'card', ref.kind, ref.id],
    queryFn: ({ signal }) => apiGet<Rec>(path, query, signal),
    staleTime: 60_000,
    retry: false,
  });
  const kind = ref.kind as CardKind;
  if (q.isLoading) return <CardFrame kind={kind} state="loading" />;
  if (q.error || !q.data) {
    const status = q.error instanceof ApiError ? q.error.status : 0;
    const what = kind === 'folder' ? 'folder' : kind === 'file' ? 'file' : kind;
    return (
      <CardFrame
        kind={kind}
        state="noaccess"
        gone={status === 403 ? { title: 'You don’t have access', sub: `You would need access to ${what}s to open this.` } : { title: 'You can’t open this', sub: `The ${what} was removed, or it has not been shared with you.` }}
      />
    );
  }
  const open = () => openRecord(ref);
  return <Body kind={ref.kind} d={q.data} open={open} id={ref.id} />;
}

function Body({ kind, d, open, id }: { kind: Ref['kind']; d: Rec; open: () => void; id: number }) {
  switch (kind) {
    case 'task':
      return <TaskCard t={d} open={open} />;
    case 'note':
      return <NoteCard n={d} open={open} />;
    case 'event':
      return <EventCard e={d} open={open} />;
    case 'deal':
      return <DealCard d={(d.deal as Rec) ?? d} open={open} />;
    case 'lead':
      return <LeadCard l={(d.lead as Rec) ?? d} open={open} />;
    case 'account':
      return <AccountCard a={(d.account as Rec) ?? d} s={(d.summary as Rec) ?? {}} open={open} />;
    case 'invoice':
      return <InvoiceCard i={(d.invoice as Rec) ?? d} open={open} />;
    case 'contact':
      return <ContactCard c={d} open={open} />;
    case 'meeting':
      return <MeetingCard m={(d.meeting as Rec) ?? d} people={(d.participants as Rec[]) ?? []} open={open} />;
    case 'file':
      return <FileCard f={d} id={id} open={open} />;
    case 'folder':
      return <FolderCard l={d} open={open} />;
  }
}

function Title({ children, strike }: { children: ReactNode; strike?: boolean }) {
  return <b className={`block text-[15px] leading-snug ${strike ? 'line-through opacity-70' : ''}`}>{children}</b>;
}
function Sub({ children }: { children: ReactNode }) {
  return <span className="block text-[12.5px] text-ink-3 dark:text-[#8D96B8]">{children}</span>;
}
const pad = 'flex flex-col gap-2 px-3.5 py-3.5';
const openAct = (label: string, open: () => void): CardAction => ({ label, tone: 'primary', onClick: open });

function TaskCard({ t, open }: { t: Rec; open: () => void }) {
  const status = str(t.status) ?? '';
  const done = /done|complete/i.test(status);
  const checklist = (t.checklist as Rec[] | undefined) ?? [];
  const checked = checklist.filter((c) => c.done || c.is_done || c.completed).length;
  const due = str(t.due_at) ?? str(t.due_date);
  const pri = str(t.priority);
  return (
    <CardFrame kind="task" org={str(t.org_name)} actions={[openAct('Open task', open)]} foot={str(t.task_key) ?? undefined}>
      <div className={pad}>
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border-2 ${done ? 'border-[#1F9D6B] bg-[#1F9D6B] text-white' : 'border-line dark:border-[#4A5A8C]'}`}>{done ? <Icon name="check" size={13} /> : null}</span>
          <Title strike={done}>{str(t.title) ?? 'Task'}</Title>
        </div>
        <div className="flex flex-wrap gap-1.5 pl-8">
          <Chip tone={done ? 'green' : 'blue'}>{human(status) || 'Open'}</Chip>
          {pri && pri !== 'normal' && pri !== 'medium' ? <Chip tone={/high|urgent/i.test(pri) ? 'red' : 'plain'}>{human(pri)}</Chip> : null}
          {due ? <Chip tone="amber">Due {dateLabel(due)}</Chip> : null}
        </div>
        <span className="pl-8">
          <Sub>
            {str(t.assignee_name) ? `${str(t.assignee_name)}` : 'Nobody assigned'}
            {checklist.length ? ` · ${checked} of ${checklist.length} subtasks` : ''}
          </Sub>
        </span>
      </div>
    </CardFrame>
  );
}

function NoteCard({ n, open }: { n: Rec; open: () => void }) {
  const role = str(n.my_role);
  const tags = ((n.tags as unknown[]) ?? []).map(String).slice(0, 3);
  return (
    <CardFrame kind="note" actions={[openAct('Open note', open)]} foot={role === 'editor' || role === 'owner' ? 'Can edit' : role === 'viewer' ? 'Can view' : undefined}>
      <div className={pad}>
        <Title>{str(n.title) ?? 'Untitled note'}</Title>
        {str(n.excerpt) ? <p className="m-0 line-clamp-3 text-[13px] text-ink-2 dark:text-[#C9CFE6]">{str(n.excerpt)}</p> : null}
        {tags.length ? (
          <span className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Chip key={t}>#{t}</Chip>
            ))}
          </span>
        ) : null}
        {str(n.updated_at) ? <Sub>Edited {relative(str(n.updated_at))}</Sub> : null}
      </div>
    </CardFrame>
  );
}

function EventCard({ e, open }: { e: Rec; open: () => void }) {
  const start = str(e.start_at);
  const end = str(e.end_at);
  const d = start ? new Date(start.includes('T') || start.endsWith('Z') ? start : start.replace(' ', 'T') + 'Z') : null;
  const people = ((e.participants as Rec[]) ?? []).map((p) => str(p.name) ?? '?');
  const going = ((e.participants as Rec[]) ?? []).filter((p) => /accept|yes|going|organizer/i.test(str(p.status) ?? '')).length;
  const uuid = str(e.meeting_uuid);
  const meet = useCanOpen('meet');
  const actions: CardAction[] = [openAct('Open event', open), ...(uuid && meet ? [{ label: 'Join', tone: 'go' as const, onClick: () => void openMeeting(uuid, str(e.title)) }] : [])];
  return (
    <CardFrame kind="event" actions={actions} foot={str(e.my_rsvp) ? human(str(e.my_rsvp)) : 'Invited'}>
      <div className="flex gap-3 px-3.5 py-3.5">
        {d && !Number.isNaN(d.getTime()) ? (
          <span className="flex w-[58px] shrink-0 flex-col items-center self-start rounded-[12px] bg-[#FCE7F1] py-1.5 text-[#9D174D] dark:bg-[#2A1624] dark:text-[#FFB3D4]">
            <span className="text-[10.5px] font-extrabold tracking-[.6px]">{d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</span>
            <b className="text-[22px] leading-tight">{d.getDate()}</b>
            <span className="text-[10.5px] font-extrabold tracking-[.6px]">{d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span>
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Title>{str(e.title) ?? 'Event'}</Title>
          <Sub>{e.all_day ? 'All day' : `${timeLabel(start)}${end ? ` – ${timeLabel(end)}` : ''}`}</Sub>
          {str(e.location) ? <Sub>{str(e.location)}</Sub> : null}
          {people.length ? (
            <span className="flex items-center gap-2 pt-0.5">
              <Faces names={people} />
              <Sub>
                {people.length} {people.length === 1 ? 'guest' : 'guests'}
                {going ? ` · ${going} going` : ''}
              </Sub>
            </span>
          ) : null}
        </span>
      </div>
    </CardFrame>
  );
}

function DealCard({ d, open }: { d: Rec; open: () => void }) {
  const kindOf = str(d.stage_kind);
  return (
    <CardFrame kind="deal" actions={[openAct('Open deal', open)]} foot={str(d.account_name) ?? undefined}>
      <div className={pad}>
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <Title>{str(d.name) ?? 'Deal'}</Title>
          </span>
          <b className="shrink-0 text-[15px]">{money(numOf(d.amount), str(d.currency))}</b>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Chip tone={kindOf === 'won' ? 'green' : kindOf === 'lost' ? 'red' : 'blue'}>{str(d.stage_name) ?? 'Open'}</Chip>
          {numOf(d.probability) !== null ? <Chip>{numOf(d.probability)}%</Chip> : null}
          {str(d.close_date) ? <Chip tone={d.overdue ? 'red' : 'amber'}>Closes {dateLabel(str(d.close_date))}</Chip> : null}
        </span>
        <Sub>{str(d.owner_name) ? `Owner ${str(d.owner_name)}` : 'No owner'}</Sub>
      </div>
    </CardFrame>
  );
}

function LeadCard({ l, open }: { l: Rec; open: () => void }) {
  return (
    <CardFrame kind="lead" actions={[openAct('Open lead', open)]} foot={str(l.lead_no) ?? undefined}>
      <div className={pad}>
        <Title>{str(l.name) ?? 'Lead'}</Title>
        {str(l.company) ? <Sub>{str(l.company)}</Sub> : null}
        <span className="flex flex-wrap gap-1.5">
          <Chip tone="blue">{human(str(l.status)) || 'New'}</Chip>
          {str(l.rating) ? <Chip tone={str(l.rating) === 'hot' ? 'red' : str(l.rating) === 'warm' ? 'amber' : 'plain'}>{human(str(l.rating))}</Chip> : null}
          {numOf(l.score) !== null ? <Chip>Score {numOf(l.score)}</Chip> : null}
          {numOf(l.est_value) ? <Chip>{money(numOf(l.est_value), str(l.currency))}</Chip> : null}
        </span>
      </div>
    </CardFrame>
  );
}

function AccountCard({ a, s, open }: { a: Rec; s: Rec; open: () => void }) {
  return (
    <CardFrame kind="account" actions={[openAct('Open account', open)]} foot={str(a.owner_name) ? `Owner ${str(a.owner_name)}` : undefined}>
      <div className={pad}>
        <Title>{str(a.name) ?? 'Account'}</Title>
        <span className="flex flex-wrap gap-1.5">
          <Chip tone="blue">{human(str(a.account_type)) || 'Account'}</Chip>
          {str(a.health) ? <Chip tone={str(a.health) === 'good' ? 'green' : str(a.health) === 'watch' ? 'amber' : 'red'}>{human(str(a.health))}</Chip> : null}
          {str(a.industry) ? <Chip>{str(a.industry)}</Chip> : null}
        </span>
        <Sub>
          {numOf(s.open_deals) ?? 0} open {numOf(s.open_deals) === 1 ? 'deal' : 'deals'} · {money(numOf(s.open_value), str(a.currency))} · {numOf(s.contacts) ?? 0} contacts
        </Sub>
      </div>
    </CardFrame>
  );
}

function InvoiceCard({ i, open }: { i: Rec; open: () => void }) {
  const over = numOf(i.days_overdue) ?? 0;
  const status = str(i.status) ?? '';
  const cur = str(i.currency);
  return (
    <CardFrame kind="invoice" actions={[openAct('View invoice', open)]} foot={str(i.owner) ?? undefined}>
      <div className={pad}>
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <Title>{str(i.number) ?? 'Invoice'}</Title>
            <Sub>{str(i.client) ?? ''}</Sub>
          </span>
          {over > 0 ? <Chip tone="red">Overdue {over} {over === 1 ? 'day' : 'days'}</Chip> : <Chip tone={/paid/i.test(status) ? 'green' : 'blue'}>{human(status)}</Chip>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['Total', i.total],
              ['Paid', i.paid],
              ['Due', i.due],
            ] as Array<[string, unknown]>
          ).map(([k, v]) => (
            <span key={k} className="flex flex-col rounded-[10px] bg-well px-2.5 py-2 dark:bg-[#0F1629]">
              <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:text-[#8D96B8]">{k}</span>
              <b className="truncate text-[13.5px]">{money(numOf(v), cur)}</b>
            </span>
          ))}
        </div>
        <Sub>
          {str(i.issue_date) ? `Issued ${dateLabel(str(i.issue_date))}` : ''}
          {str(i.due_date) ? ` · due ${dateLabel(str(i.due_date))}` : ''}
        </Sub>
      </div>
    </CardFrame>
  );
}

function ContactCard({ c, open }: { c: Rec; open: () => void }) {
  const name = str(c.display_name) ?? 'Contact';
  const email = str(c.email);
  const phone = str(c.phone);
  const actions: CardAction[] = [openAct('Open', open), ...(email ? [{ label: 'Email', onClick: () => void call('app:openExternal', { url: `mailto:${email}` }) }] : []), ...(phone ? [{ label: 'Call', onClick: () => void call('app:openExternal', { url: `tel:${phone.replace(/[^\d+]/g, '')}` }) }] : [])];
  return (
    <CardFrame kind="contact" actions={actions} foot="Contact">
      <div className="flex items-center gap-3 px-3.5 py-3.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E3F6EE] text-[15px] font-extrabold text-[#0B6B4A] dark:bg-[#11281F] dark:text-[#4FC3A1]">
          {name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]!.toUpperCase())
            .join('')}
        </span>
        <span className="min-w-0 flex-1">
          <Title>{name}</Title>
          <Sub>{[str(c.job_title), str(c.company)].filter(Boolean).join(' · ') || '—'}</Sub>
          <Sub>{[phone, email].filter(Boolean).join(' · ')}</Sub>
        </span>
      </div>
    </CardFrame>
  );
}

function MeetingCard({ m, people, open }: { m: Rec; people: Rec[]; open: () => void }) {
  const live = str(m.live_status);
  const uuid = str(m.meet_uuid);
  const start = str(m.start_at);
  const meet = useCanOpen('meet');
  const actions: CardAction[] = [openAct('Open meeting', open), ...(uuid && meet && live !== 'completed' && live !== 'cancelled' ? [{ label: 'Join', tone: 'go' as const, onClick: () => void openMeeting(uuid, str(m.title)) }] : [])];
  return (
    <CardFrame kind="meeting" actions={actions} foot={str(m.meeting_no) ?? undefined} live={live === 'ongoing'}>
      <div className={pad}>
        <Title>{str(m.title) ?? 'Meeting'}</Title>
        <span className="flex flex-wrap gap-1.5">
          <Chip tone={live === 'ongoing' ? 'green' : live === 'cancelled' ? 'red' : live === 'completed' ? 'plain' : 'blue'}>{live === 'ongoing' ? 'Going on now' : human(live) || 'Scheduled'}</Chip>
          {start ? (
            <Chip>
              {dateLabel(start)} · {timeLabel(start)}
            </Chip>
          ) : null}
        </span>
        <Sub>{[str(m.where), str(m.organizer) ? `Organised by ${str(m.organizer)}` : null].filter(Boolean).join(' · ')}</Sub>
        {people.length ? (
          <span className="flex items-center gap-2">
            <Faces names={people.map((p) => str(p.name) ?? '?')} />
            <Sub>{people.length} invited</Sub>
          </span>
        ) : null}
      </div>
    </CardFrame>
  );
}

function FileCard({ f, id, open }: { f: Rec; id: number; open: () => void }) {
  const name = str(f.name) ?? 'File';
  const size = numOf(f.size);
  const versions = numOf(f.version_count);
  return (
    <CardFrame
      kind="file"
      actions={[openAct('Open', open), { label: 'Download', onClick: () => void call('transfers:download', { fileId: String(id), name }).then(() => toast('success', 'Downloading.'), () => toast('error', 'That could not be downloaded.')) }]}
      foot={str(f.owner) ? `From ${str(f.owner)}` : undefined}
    >
      <div className="flex items-center gap-3 px-3.5 py-3.5">
        <FileBadge name={name} size={48} />
        <span className="min-w-0 flex-1">
          <Title>{name}</Title>
          <Sub>
            {(str(f.extension) ?? '').toUpperCase() || 'File'}
            {size ? ` · ${bytes(size)}` : ''}
            {versions && versions > 1 ? ` · v${versions}` : ''}
          </Sub>
          {str(f.folder_name) ? <Sub>In {str(f.folder_name)}</Sub> : null}
        </span>
      </div>
    </CardFrame>
  );
}

function FolderCard({ l, open }: { l: Rec; open: () => void }) {
  const folder = (l.folder as Rec | null) ?? null;
  if (!folder) return <CardFrame kind="folder" state="noaccess" gone={{ title: 'You can’t open this', sub: 'The folder was removed, or it has not been shared with you.' }} />;
  const files = ((l.files as Rec[]) ?? []).slice(0, 2);
  const count = numOf(folder.file_count) ?? numOf(l.total) ?? 0;
  const size = numOf(folder.total_size);
  return (
    <CardFrame kind="folder" actions={[openAct('Open', open)]}>
      <div className={pad}>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[#FDF1DF] text-[#F0A43A] dark:bg-[#2A2213]">
            <Icon name="folder" size={24} />
          </span>
          <span className="min-w-0 flex-1">
            <Title>{str(folder.name) ?? 'Folder'}</Title>
            <Sub>
              {count} {count === 1 ? 'file' : 'files'}
              {size ? ` · ${bytes(size)}` : ''}
            </Sub>
          </span>
        </div>
        {files.length ? (
          <div className="flex flex-col gap-1">
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-2 rounded-[8px] bg-well px-2 py-1.5 text-[12.5px] dark:bg-[#0F1629]">
                <FileBadge name={str(f.name) ?? 'file'} size={20} />
                <span className="min-w-0 flex-1 truncate">{str(f.name)}</span>
              </span>
            ))}
            {count > files.length ? <Sub>+{count - files.length} more</Sub> : null}
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}
