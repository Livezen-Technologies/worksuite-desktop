import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, cx, IconButton, Modal, Switch } from '../../../../components/ui';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { SK, socialApi, useInboxRules, useInvalidate, useSavedReplies, type InboxRule, type SavedReply, type Thread } from '../../api';
import { ConfirmButton, Field, INPUT, NativeSelect, OptionalView, TEXTAREA } from '../../parts';

/**
 * W06 Inbox dialogs: saved replies (SMM-INB-007), routing rules (INB-005), assigning to someone by id, and turning a
 * conversation into a CRM lead or a Support ticket (WF-11, INB-009, INB-010, AC-12).
 */

/* ------------------------------------------------------------------------ *
 * Saved replies
 * ------------------------------------------------------------------------ */

type Draft = { id?: number; name: string; shortcut: string; body: string };

export function SavedRepliesModal({ canManage, onClose }: { canManage: boolean; onClose: () => void }) {
  const q = useSavedReplies();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) => socialApi.saveSavedReply({ id: d.id, name: d.name.trim(), body: d.body, shortcut: d.shortcut.trim() ? `/${d.shortcut.trim().replace(/^\/+/, '')}` : null }),
    onSuccess: () => {
      toast('success', 'Saved reply saved');
      setDraft(null);
      invalidate(SK.savedReplies);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => socialApi.deleteSavedReply(id),
    onSuccess: () => invalidate(SK.savedReplies),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const edit = (r: SavedReply) => setDraft({ id: r.id, name: r.name, shortcut: r.shortcut ?? '', body: r.body });
  return (
    <Modal
      title="Saved replies"
      onClose={onClose}
      width={600}
      footer={
        draft ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!draft.name.trim() || !draft.body.trim()} loading={save.isPending} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          </>
        ) : canManage ? (
          <Button variant="primary" icon="plus" onClick={() => setDraft({ name: '', shortcut: '', body: '' })}>
            New saved reply
          </Button>
        ) : null
      }
    >
      {draft ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Name">
              <input className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Shortcut" hint="Type it in a reply, then a space.">
              <input className={cx(INPUT, 'font-mono')} value={draft.shortcut} placeholder="/price" onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} />
            </Field>
          </div>
          <Field label="Reply" hint="{first_name} and {brand} are filled in when the reply is used.">
            <textarea className={cx(TEXTAREA, 'min-h-[120px]')} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
        </div>
      ) : (
        <OptionalView q={q} what="Saved replies" compact>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-[13px] text-ink-3">No saved replies yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        {r.name}
                        {r.shortcut ? <span className="font-mono text-[11.5px] font-medium text-ink-3">{r.shortcut}</span> : null}
                      </div>
                      <p className="line-clamp-2 text-[12.5px] text-ink-2">{r.body}</p>
                    </div>
                    {canManage ? (
                      <>
                        <IconButton icon="pen" label={`Edit ${r.name}`} onClick={() => edit(r)} />
                        <ConfirmButton size="sm" variant="ghost" icon="trash" label="Delete" confirm="Delete" loading={remove.isPending && remove.variables === r.id} onConfirm={() => remove.mutate(r.id)} />
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </OptionalView>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------------ */

export function RulesModal({ onClose }: { onClose: () => void }) {
  const q = useInboxRules();
  const invalidate = useInvalidate();
  const [edited, setEdited] = useState<InboxRule[] | null>(null);
  const server = q.data?.offered ? [...q.data.data].sort((a, b) => a.priority - b.priority) : [];
  const rules = edited ?? server;

  const save = useMutation({
    mutationFn: (rs: InboxRule[]) => socialApi.saveRules(rs.map((r, i) => ({ id: r.id, priority: i + 1, enabled: r.enabled }))),
    onSuccess: () => {
      toast('success', 'Rules saved');
      invalidate(SK.rules);
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const move = (i: number, by: -1 | 1) => {
    const next = [...rules];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r!);
    setEdited(next);
  };

  return (
    <Modal
      title="Inbox rules"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!edited} loading={save.isPending} onClick={() => edited && save.mutate(edited)}>
            Save order
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-ink-3">Rules run top to bottom on every new conversation; the first that matches assigns it. Conditions are edited in module settings.</p>
      <OptionalView q={q} what="Inbox rules" compact>
        {() =>
          rules.length === 0 ? (
            <p className="text-[13px] text-ink-3">No rules yet — conversations stay unassigned until someone picks them up.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
              {rules.map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-5 text-center text-[12px] font-bold text-ink-3 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{r.name}</span>
                    <span className="block text-[12px] text-ink-3">{r.summary}</span>
                  </span>
                  <IconButton icon="arrow-up" label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon="arrow-down" label={`Move ${r.name} down`} disabled={i === rules.length - 1} onClick={() => move(i, 1)} />
                  <Switch checked={r.enabled} label={`${r.name} on`} onChange={(v) => setEdited(rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))} />
                </li>
              ))}
            </ol>
          )
        }
      </OptionalView>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ *
 * Assign to someone
 * ------------------------------------------------------------------------ */

/** The module has no people directory route yet, so this asks for the user or team id plainly. */
export function AssignModal({ busy, onClose, onAssign }: { busy: boolean; onClose: () => void; onAssign: (to: { type: 'user' | 'team'; id: number }) => void }) {
  const [type, setType] = useState<'user' | 'team'>('user');
  const [id, setId] = useState('');
  const n = Number(id);
  const ok = Number.isInteger(n) && n > 0;
  return (
    <Modal
      title="Assign conversation"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={() => onAssign({ type, id: n })}>
            Assign
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[130px_1fr] gap-3">
        <Field label="To a">
          <NativeSelect label="Assign to a" value={type} onChange={(v) => setType(v === 'team' ? 'team' : 'user')}>
            <option value="user">User</option>
            <option value="team">Team</option>
          </NativeSelect>
        </Field>
        <Field label={type === 'team' ? 'Team id' : 'User id'} hint="As WorkSuite numbers them (Teams and Users in the admin).">
          <input className={INPUT} inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ *
 * Convert
 * ------------------------------------------------------------------------ */

/** Create CRM lead / Create ticket, prefilled from the thread (WF-11 step 1); CRM's dedupe decides create or link. */
export function ConvertModal({ thread, to, source, onClose }: { thread: Thread; to: 'crm_lead' | 'ticket'; source: string; onClose: () => void }) {
  const invalidate = useInvalidate();
  const firstIn = thread.messages.find((m) => m.direction === 'in')?.body ?? thread.excerpt;
  const [fields, setFields] = useState<Record<string, string>>((): Record<string, string> =>
    to === 'crm_lead'
      ? { name: thread.participant.name, handle: thread.participant.handle ?? '', message: firstIn, source }
      : { subject: `${thread.participant.name}: ${thread.excerpt}`.slice(0, 120), description: firstIn, requester: thread.participant.name, source },
  );
  const run = useMutation({
    mutationFn: () => socialApi.convert(thread.id, to, { ...fields, network: thread.network, account_id: String(thread.account_id), ...(thread.post ? { post_id: String(thread.post.id) } : {}) }),
    onSuccess: () => {
      toast('success', to === 'crm_lead' ? 'CRM lead created' : 'Ticket created');
      invalidate(SK.thread(thread.id), SK.threadsAll);
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const set = (k: string) => (v: string) => setFields((f) => ({ ...f, [k]: v }));
  const field = (k: string, label: string, long = false) => (
    <Field key={k} label={label}>
      {long ? <textarea className={cx(TEXTAREA, 'min-h-[90px]')} value={fields[k] ?? ''} onChange={(e) => set(k)(e.target.value)} /> : <input className={INPUT} value={fields[k] ?? ''} onChange={(e) => set(k)(e.target.value)} />}
    </Field>
  );
  return (
    <Modal
      title={to === 'crm_lead' ? 'Create CRM lead' : 'Create ticket'}
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={run.isPending} disabled={!(fields.name ?? fields.subject ?? '').trim()} onClick={() => run.mutate()}>
            {to === 'crm_lead' ? 'Create lead' : 'Create ticket'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {to === 'crm_lead'
          ? [field('name', 'Name'), field('handle', 'Network handle'), field('message', 'Message', true), field('source', 'Source')]
          : [field('subject', 'Subject'), field('requester', 'Requester'), field('description', 'Description', true), field('source', 'Source')]}
        <p className="text-[12px] text-ink-3">{to === 'crm_lead' ? 'CRM matches an existing contact by its rules and links it instead of making a duplicate.' : 'The ticket keeps a link to this conversation.'}</p>
      </div>
    </Modal>
  );
}
