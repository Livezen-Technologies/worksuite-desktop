import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { PRIORITIES, PRIORITY_LABEL, statusLabel, type Meta, type SupportPriority, type SupportStatus, type TicketChanges, type TicketFull, type TicketShow } from '@shared/support';
import { text } from '../../core/i18n';
import { stampDayLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, Modal, cx } from '../../components/ui';
import { K, agents, assign, conflictTicket, errorText, transition, updateTicket } from './api';
import { presenceLabel } from './parts';

/**
 * The ticket's properties (D-02, FR-TKT-03/10): the status through the moves the state machine allows this person
 * (`transitions`), the priority, the assignee (`GET agents`, with their presence and load), the team, category and
 * department (the desk's own lists from `GET meta`: the ticket's organization's, or shared by all), the due date and
 * the tags.
 *
 * Every change goes with the version the screen showed. When somebody changed the ticket first, the server answers
 * 409 with the ticket as it now stands, and the conflict review says what they set and what I chose: keep theirs,
 * or set mine again on top of theirs (FR-TKT-10). Nothing is written over unseen.
 */
export type Change =
  | { kind: 'status'; to: SupportStatus }
  | { kind: 'assignee'; to: number | null; name?: string | null }
  | { kind: 'field'; field: keyof TicketChanges; to: TicketChanges[keyof TicketChanges] };

const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  team_id: 'Team',
  category_id: 'Category',
  department_id: 'Department',
  due_at: 'Due',
  tags: 'Tags',
};

/** The field a change touches, as the conflict review names it. */
export function changeField(change: Change): string {
  return text(FIELD_LABEL[change.kind === 'field' ? change.field : change.kind] ?? 'Field');
}

const named = (list: Array<{ id: number; name: string }> | undefined, id: unknown): string => (id ? (list?.find((x) => x.id === Number(id))?.name ?? `#${String(id)}`) : text('None'));

/** A value of the field a change touches, in words: what I chose, or (from `t`) what it now is. */
export function describe(change: Change, meta: Meta | undefined, value: unknown, t?: Pick<TicketFull, 'assignee'>): string {
  switch (change.kind) {
    case 'status':
      return text(statusLabel(String(value)));
    case 'assignee': {
      if (!value) return text('Unassigned');
      if (t?.assignee?.id === Number(value)) return t.assignee.name ?? `#${String(value)}`;
      return change.to === Number(value) && change.name ? change.name : `#${String(value)}`;
    }
    case 'field':
      if (change.field === 'priority') return text(PRIORITY_LABEL[value as SupportPriority] ?? String(value));
      if (change.field === 'team_id') return named(meta?.teams, value);
      if (change.field === 'category_id') return named(meta?.categories, value);
      if (change.field === 'department_id') return named(meta?.departments, value);
      if (change.field === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : text('None');
      if (change.field === 'due_at') return value ? `${stampDayLabel(String(value), 'year')}, ${timeLabel(String(value))}` : text('None');
      return value === null || value === undefined || value === '' ? text('None') : String(value);
  }
}

/** The value a change touches, as a ticket now has it. */
export function currentOf(change: Change, t: TicketFull): unknown {
  switch (change.kind) {
    case 'status':
      return t.status;
    case 'assignee':
      return t.assignee?.id ?? null;
    case 'field':
      if (change.field === 'team_id') return t.team?.id ?? null;
      if (change.field === 'category_id') return t.category?.id ?? null;
      if (change.field === 'department_id') return t.department?.id ?? null;
      return (t as unknown as Record<string, unknown>)[change.field] ?? null;
  }
}

/** Sends a change with a version. The ticket as it now stands, or null where the as-built API answers nothing. */
export function sendChange(t: Pick<TicketFull, 'id' | 'version'>, change: Change, version = t.version): Promise<TicketFull | null> {
  const v = version || undefined;
  if (change.kind === 'status') return transition(t.id, { status: change.to, version: v });
  if (change.kind === 'assignee') return assign(t.id, { user_id: change.to, version: v });
  return updateTicket(t.id, version, { [change.field]: change.to } as TicketChanges);
}

export interface Conflict {
  change: Change;
  theirs: TicketFull;
}

/** A change, its conflict review, and the screen kept current with the server's answer. */
export function useTicketChange(show: TicketShow) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const id = show.ticket.id;
  const settle = (fresh: TicketFull | null) => {
    if (fresh) qc.setQueryData<TicketShow>(K.ticket(id), (d) => (d ? { ...d, ticket: { ...d.ticket, ...fresh } } : d));
    // The moves allowed, the journal and the lists change with it: asked again.
    void qc.invalidateQueries({ queryKey: K.ticket(id) });
    void qc.invalidateQueries({ queryKey: K.lists });
    void qc.invalidateQueries({ queryKey: ['support', 'views'] });
  };
  const run = async (change: Change, version?: number) => {
    setBusy(change.kind === 'field' ? change.field : change.kind);
    try {
      settle(await sendChange(show.ticket, change, version));
      setConflict(null);
    } catch (e) {
      const theirs = conflictTicket(e);
      if (theirs) {
        // Shown as it now stands at once; the review says what changed under me.
        qc.setQueryData<TicketShow>(K.ticket(id), (d) => (d ? { ...d, ticket: { ...d.ticket, ...theirs } } : d));
        setConflict({ change, theirs });
      } else toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const keepTheirs = () => {
    setConflict(null);
    settle(null);
  };
  return { busy, conflict, run, keepTheirs };
}

/** Somebody changed the ticket first: what it is now, what I chose, and a choice between them (FR-TKT-10). */
export function ConflictReview({ conflict, meta, onKeepTheirs, onUseMine }: { conflict: Conflict; meta: Meta | undefined; onKeepTheirs: () => void; onUseMine: () => void }) {
  const { change, theirs } = conflict;
  return (
    <Modal
      title={text('{ref} was changed by somebody else', { ref: theirs.reference })}
      labelledBy="support-conflict-title"
      onClose={onKeepTheirs}
      width={480}
      footer={
        <>
          <Button onClick={onKeepTheirs}>{text('Keep theirs')}</Button>
          <Button variant="primary" onClick={onUseMine}>
            {text('Use mine')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink-2">{text('It changed while you had it open, so your change was not saved over theirs.')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[10px] border border-line bg-subtle px-3 py-2.5 text-[13px]">
        <dt className="text-ink-3">{text('Field')}</dt>
        <dd className="font-semibold text-ink">{changeField(change)}</dd>
        <dt className="text-ink-3">{text('Now')}</dt>
        <dd className="font-semibold text-ink">{describe(change, meta, currentOf(change, theirs), theirs)}</dd>
        <dt className="text-ink-3">{text('You chose')}</dt>
        <dd className="font-semibold text-ink">{describe(change, meta, change.to)}</dd>
      </dl>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-2 py-1">
      <span className="text-[12px] text-ink-3">{label}</span>
      <div className="min-w-0 text-[12.5px] text-ink">{children}</div>
    </div>
  );
}

/** "2026-10-05T17:00:00+05:30" as a datetime field takes it, on this computer's clock. */
export function localInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A tag as the desk keeps it: trimmed, lower case, at most 40 characters. */
export function tagOf(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
}

export function Properties({ show, meta, onResolve }: { show: TicketShow; meta: Meta | undefined; onResolve: () => void }) {
  const t = show.ticket;
  const ch = useTicketChange(show);
  const [tag, setTag] = useState('');
  const readOnly = !!t.merged_into;
  const canEdit = show.can.edit === true && !readOnly && !show.legacy;
  const canAssign = show.can.assign === true && !readOnly;
  const people = useQuery({ queryKey: K.agents(`ticket:${t.id}`), queryFn: () => agents({ ticket_id: t.id }), enabled: canAssign, staleTime: 60_000 });
  const org = t.organization?.id ?? null;
  const ours = <T extends { organization_id: number | null }>(list: T[] | undefined) => (list ?? []).filter((x) => x.organization_id === null || x.organization_id === org);
  const tags = t.tags ?? [];
  const suggest = [...new Set(ours(meta?.tags).map((x) => x.name))].filter((n) => !tags.includes(n));
  const addTag = () => {
    const name = tagOf(tag);
    setTag('');
    if (!name || tags.includes(name)) return;
    void ch.run({ kind: 'field', field: 'tags', to: [...tags, name] });
  };
  const assignee = t.assignee ? String(t.assignee.id) : '';
  const folders: Array<{ field: 'team_id' | 'category_id' | 'department_id'; label: string; list: Array<{ id: number; name: string }>; now: { id: number; name: string | null } | null }> = [
    { field: 'team_id', label: text('Team'), list: ours(meta?.teams), now: t.team },
    { field: 'category_id', label: text('Category'), list: ours(meta?.categories), now: t.category },
    { field: 'department_id', label: text('Department'), list: ours(meta?.departments), now: t.department },
  ];

  return (
    <section aria-label={text('Properties')} className="flex flex-col">
      <h3 className="pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{text('Properties')}</h3>
      <Row label={text('Status')}>
        <Select<string>
          className="h-7 w-full text-[12.5px]"
          aria-label={text('Status')}
          value={t.status}
          disabled={readOnly || !show.transitions.length || ch.busy === 'status'}
          onValueChange={(to) => {
            if (to === t.status) return;
            // Resolving asks what fixed it (the same dialog as E).
            if (to === 'resolved') onResolve();
            else void ch.run({ kind: 'status', to: to as SupportStatus });
          }}
          options={[t.status, ...show.transitions.filter((s) => s !== t.status)].map((s) => ({ value: s, label: text(statusLabel(s)) }))}
        />
      </Row>
      <Row label={text('Priority')}>
        <Select<string>
          className="h-7 w-full text-[12.5px]"
          aria-label={text('Priority')}
          value={t.priority}
          disabled={!canEdit || ch.busy === 'priority'}
          onValueChange={(to) => {
            if (to !== t.priority) void ch.run({ kind: 'field', field: 'priority', to: to as SupportPriority });
          }}
          options={PRIORITIES.map((p) => ({ value: p, label: text(PRIORITY_LABEL[p]) }))}
        />
      </Row>
      <Row label={text('Assignee')}>
        {canAssign ? (
          <Select<string>
            className="h-7 w-full text-[12.5px]"
            aria-label={text('Assignee')}
            value={assignee}
            searchable
            disabled={ch.busy === 'assignee'}
            onValueChange={(to) => {
              if (to === assignee) return;
              const person = (people.data ?? []).find((p) => String(p.id) === to);
              void ch.run({ kind: 'assignee', to: to ? Number(to) : null, name: person?.name ?? null });
            }}
            options={[
              { value: '', label: text('Unassigned') },
              ...(t.assignee && !(people.data ?? []).some((p) => p.id === t.assignee!.id) ? [{ value: String(t.assignee.id), label: t.assignee.name ?? `#${t.assignee.id}` }] : []),
              ...(people.data ?? []).map((p) => ({
                value: String(p.id),
                label: p.name,
                hint: [presenceLabel(p.presence), p.capacity ? text('{open}/{capacity} open', { open: p.open, capacity: p.capacity }) : text('{open} open', { open: p.open })].join(' · '),
              })),
            ]}
          />
        ) : (
          <span className={cx(!t.assignee && 'text-ink-3')}>{t.assignee?.name ?? text('Unassigned')}</span>
        )}
      </Row>
      {folders.map(({ field, label, list, now }) => (
        <Row key={field} label={label}>
          {canEdit && list.length ? (
            <Select<string>
              className="h-7 w-full text-[12.5px]"
              aria-label={label}
              value={now ? String(now.id) : ''}
              searchable={list.length > 6}
              disabled={ch.busy === field}
              onValueChange={(to) => {
                if (to !== (now ? String(now.id) : '')) void ch.run({ kind: 'field', field, to: to ? Number(to) : null });
              }}
              options={[{ value: '', label: text('None') }, ...(now && !list.some((x) => x.id === now.id) ? [{ value: String(now.id), label: now.name ?? `#${now.id}` }] : []), ...list.map((x) => ({ value: String(x.id), label: x.name }))]}
            />
          ) : (
            <span className={cx(!now && 'text-ink-3')}>{now?.name ?? text('None')}</span>
          )}
        </Row>
      ))}
      <Row label={text('Due')}>
        {canEdit ? (
          <input
            type="datetime-local"
            aria-label={text('Due')}
            defaultValue={localInput(t.due_at)}
            key={t.due_at ?? 'none'}
            disabled={ch.busy === 'due_at'}
            onBlur={(e) => {
              const v = e.target.value;
              const next = v ? new Date(v).toISOString() : null;
              const before = t.due_at ? new Date(t.due_at).toISOString() : null;
              if (next !== before) void ch.run({ kind: 'field', field: 'due_at', to: next });
            }}
            className="h-7 w-full rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-primary"
          />
        ) : (
          <span className={cx(!t.due_at && 'text-ink-3')}>{t.due_at ? `${stampDayLabel(t.due_at, 'year')}, ${timeLabel(t.due_at)}` : text('None')}</span>
        )}
      </Row>
      <Row label={text('Tags')}>
        <span className="flex flex-wrap items-center gap-1">
          {tags.map((name) => (
            <span key={name} className="inline-flex items-center gap-0.5 rounded-full bg-subtle py-0.5 pr-1 pl-2 text-[11.5px] text-ink-2">
              {name}
              {canEdit ? (
                <button type="button" aria-label={text('Remove the tag {tag}', { tag: name })} onClick={() => void ch.run({ kind: 'field', field: 'tags', to: tags.filter((x) => x !== name) })} className="rounded-full p-0.5 hover:bg-line">
                  <Icon name="x" size={10} />
                </button>
              ) : null}
            </span>
          ))}
          {canEdit ? (
            <>
              <input
                value={tag}
                list={`support-tags-${t.id}`}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                aria-label={text('Add a tag')}
                placeholder={text('Add…')}
                disabled={ch.busy === 'tags'}
                className="h-6 w-20 min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-1 text-[12px] text-ink outline-none focus:border-line"
              />
              <datalist id={`support-tags-${t.id}`}>
                {suggest.slice(0, 50).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </>
          ) : !tags.length ? (
            <span className="text-ink-3">{text('None')}</span>
          ) : null}
        </span>
      </Row>
      {ch.conflict ? <ConflictReview conflict={ch.conflict} meta={meta} onKeepTheirs={ch.keepTheirs} onUseMine={() => void ch.run(ch.conflict!.change, ch.conflict!.theirs.version)} /> : null}
    </section>
  );
}
