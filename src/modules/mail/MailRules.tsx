import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Icon } from '../../components/Icon';
import { Button, Chip, Empty, ErrorNote, Modal, Spinner, Switch, TextField, cx } from '../../components/ui';
import { useFolders, useMailboxes, useSignatures } from './api';
import { deviceId } from './clientRules';
import { plainText } from './model';
import { textToHtml } from './sanitize';
import type { Mailbox, Signature } from './types';

/**
 * Settings › Mail › Signatures and Rules (MAIL-CMP-07, MAIL-RUL-01…03,
 * MAIL-V2-09): the person's signatures, their automatic reply, their filter
 * rules and the senders they blocked. Rules run on the mail server through
 * ManageSieve; where a mailbox's provider has none, the page says so instead
 * of letting saved rules look active.
 */

export interface MailFilter {
  id?: number;
  name: string | null;
  /** `thread`: an ignored conversation (DMO-INB-10), by its root Message-ID. */
  field: 'from' | 'to' | 'subject' | 'any' | 'thread';
  op: 'contains' | 'is' | 'matches';
  value: string;
  action: 'fileinto' | 'star' | 'seen' | 'delete' | 'forward';
  action_arg: string | null;
  stop: boolean;
  enabled: boolean;
  /** Except if… (DMO-RUL-03): the same kinds of condition. */
  exceptions?: Array<{ field: MailFilter['field']; op: MailFilter['op']; value: string }>;
  /** On the server (default) or on this computer only (DMO-RUL-04). */
  run_location?: 'server' | 'client';
  /** What only this computer can do: show an alert, play a sound. */
  client_actions?: Array<'alert' | 'sound' | 'pin' | 'important'>;
  device_id?: string | null;
  /** Why the rule was switched off (DMO-RUL-08). */
  last_error?: string | null;
}

/** Rules as a JSON file (DMO-RUL-07): only the fields a rule is made of. */
export function exportRules(filters: MailFilter[]): string {
  return JSON.stringify({ worksuite_mail_rules: 1, rules: filters.map(({ name, field, op, value, action, action_arg, stop, enabled, exceptions, run_location, client_actions }) => ({ name, field, op, value, action, action_arg, stop, enabled, exceptions: exceptions ?? [], run_location: run_location ?? 'server', client_actions: client_actions ?? [] })) }, null, 2);
}

/** A rules file back into rules, or the reason it is not one. Outlook's .rwz is not readable here. */
export function importRules(raw: string): { rules: MailFilter[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: text('That is not a WorkSuite rules file. Outlook .rwz rules cannot be read — recreate them here, or from a message with Create rule.') };
  }
  const list = (data as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) return { error: text('That is not a WorkSuite rules file. Outlook .rwz rules cannot be read — recreate them here, or from a message with Create rule.') };
  const fields = ['from', 'to', 'subject', 'any', 'thread'];
  const ops = ['contains', 'is', 'matches'];
  const actions = ['fileinto', 'star', 'seen', 'delete', 'forward'];
  const rules: MailFilter[] = [];
  for (const r of list.slice(0, 200) as Array<Record<string, unknown>>) {
    const value = String(r.value ?? '').trim();
    if (!value) continue;
    rules.push({
      name: r.name ? String(r.name).slice(0, 100) : null,
      field: (fields.includes(String(r.field)) ? r.field : 'from') as MailFilter['field'],
      op: (ops.includes(String(r.op)) ? r.op : 'contains') as MailFilter['op'],
      value: value.slice(0, 255),
      action: (actions.includes(String(r.action)) ? r.action : 'fileinto') as MailFilter['action'],
      action_arg: r.action_arg ? String(r.action_arg).slice(0, 255) : null,
      stop: r.stop !== false,
      enabled: r.enabled !== false,
      exceptions: Array.isArray(r.exceptions) ? (r.exceptions as Array<Record<string, unknown>>).filter((e) => String(e.value ?? '').trim()).map((e) => ({ field: (fields.includes(String(e.field)) ? e.field : 'from') as MailFilter['field'], op: (ops.includes(String(e.op)) ? e.op : 'contains') as MailFilter['op'], value: String(e.value).slice(0, 255) })) : [],
      run_location: r.run_location === 'client' ? 'client' : 'server',
      client_actions: Array.isArray(r.client_actions) ? (r.client_actions as string[]).filter((a): a is 'alert' | 'sound' => a === 'alert' || a === 'sound') : [],
    });
  }
  return { rules };
}

export interface RulesData {
  server_rules: { available: boolean; reason: string | null };
  vacation: {
    enabled: boolean;
    subject: string;
    message: string;
    start_date: string | null;
    end_date: string | null;
    /** Outside the organisation (DMO-OOF-01): the same reply, none, contacts only, or a separate one to everyone. Absent on an older server. */
    external_audience?: 'same' | 'none' | 'contacts' | 'everyone';
    external_subject?: string | null;
    external_message?: string | null;
  };
  filters: MailFilter[];
}

/** A sender rule written by Block sender / Mark safe (POST rules/sender), as the list shows it. */
export function senderRule(f: MailFilter): { kind: 'blocked' | 'safe'; email: string } | null {
  const m = /^(Blocked|Safe sender): (.+)$/.exec(f.name ?? '');
  if (!m || f.field !== 'from') return null;
  return { kind: m[1] === 'Blocked' ? 'blocked' : 'safe', email: m[2]! };
}

/** "From contains sfcl.lk → move to Clients" in words. */
export function filterWords(f: MailFilter): string {
  if (f.field === 'thread') return text('A later message in this conversation → move to Deleted Items');
  const field = { from: text('From'), to: text('To'), subject: text('Subject'), any: text('Anywhere') }[f.field];
  const op = { contains: text('contains'), is: text('is'), matches: text('matches') }[f.op];
  const action =
    f.action === 'fileinto'
      ? text('move to {folder}', { folder: f.action_arg || 'INBOX' })
      : f.action === 'star'
        ? text('star it')
        : f.action === 'seen'
          ? text('mark it read')
          : f.action === 'delete'
            ? text('delete it')
            : text('forward to {address}', { address: f.action_arg ?? '' });
  return `${field} ${op} “${f.value}” → ${action}`;
}

export const useRules = (enabled = true) => useQuery({ queryKey: ['mail', 'rules'], queryFn: () => apiGet<RulesData>('/api/mail/rules'), staleTime: 60_000, retry: false, enabled });

export function Signatures() {
  const qc = useQueryClient();
  const list = useSignatures(true);
  const [editing, setEditing] = useState<Signature | 'new' | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mail', 'signatures'] });
  const act = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      refresh();
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const rows = list.data?.signatures ?? [];
  const boxes = (useMailboxes().data?.mailboxes ?? []).filter((b) => !b.archived);
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">{text('Signatures')}</h2>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          {text('New signature')}
        </Button>
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isSuccess && rows.length === 0 && editing === null ? <Empty icon="pen" title={text('No signature yet')} hint={text('A signature goes under every new message and reply you write.')} /> : null}
      {rows.length ? (
        <ul role="list" className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {rows.map((s) => (
            <li key={s.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[14px] font-bold text-ink">
                  {s.name}
                  {s.is_default ? <Chip tone="indigo">{text('Default')}</Chip> : null}
                  {s.default_new ? <Chip tone="success">{text('New mail')}</Chip> : null}
                  {s.default_reply ? <Chip tone="success">{text('Replies')}</Chip> : null}
                </span>
                <span className="block text-[12px] text-ink-3">{s.mailbox ? (boxes.find((b) => b.id === s.mailbox)?.email ?? text('One account')) : text('Every account')}</span>
                <span className="mt-1 block whitespace-pre-line text-[12.5px] text-ink-2">{plainText(s.html).slice(0, 240)}</span>
              </span>
              {!s.is_default ? (
                <Button size="sm" onClick={() => void act(() => apiPost(`/api/mail/signatures/${s.id}/default`), text('Now your default signature.'))}>
                  Make default
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setEditing(s)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" className="!text-danger" onClick={() => void act(() => apiDelete(`/api/mail/signatures/${s.id}`), text('Signature removed.'))}>
                {text('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? <SignatureEditor signature={editing === 'new' ? null : editing} first={rows.length === 0} boxes={boxes} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </>
  );
}

function SignatureEditor({ signature, first, boxes, onClose, onSaved }: { signature: Signature | null; first: boolean; boxes: Mailbox[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(signature?.name ?? '');
  // Per account, for new mail and replies (DMO-CMP-06).
  const [mailbox, setMailbox] = useState<number | ''>(signature?.mailbox ?? '');
  const [forNew, setForNew] = useState(signature?.default_new ?? first);
  const [forReply, setForReply] = useState(signature?.default_reply ?? first);
  const [body, setBody] = useState(signature ? plainText(signature.html) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), html: textToHtml(body.trim()), mailbox: mailbox === '' ? null : mailbox, default_new: forNew, default_reply: forReply, ...(signature ? {} : { is_default: first }) };
      if (signature) await apiPut(`/api/mail/signatures/${signature.id}`, payload);
      else await apiPost('/api/mail/signatures', payload);
      onSaved();
      toast('success', text('Signature saved.'));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={signature ? text('Edit signature') : text('New signature')} className="mt-4 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
      <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={text('Work')} autoFocus />
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-[260px]">
          <Select label={text('For')} value={mailbox} options={[{ value: '', label: text('Every account') }, ...boxes.map((b) => ({ value: b.id, label: b.email }))]} onValueChange={(v) => setMailbox(v === '' ? '' : Number(v))} />
        </div>
        <label className="flex h-9 items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={forNew} onChange={(e) => setForNew(e.target.checked)} />
          {text('Use for new messages')}
        </label>
        <label className="flex h-9 items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={forReply} onChange={(e) => setForReply(e.target.checked)} />
          {text('Use for replies and forwards')}
        </label>
      </div>
      <p className="text-[12px] text-ink-3">{text('Write {t1}, {t2}, {t3} or {t4} and each message gets your name, job title, phone or email from your WorkSuite profile.', { t1: '{name}', t2: '{title}', t3: '{phone}', t4: '{email}' })}</p>
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">{text('Signature')}</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{text('Cancel')}</Button>
        <Button variant="primary" loading={busy} disabled={!name.trim() || !body.trim()} onClick={() => void save()}>
          {text('Save')}
        </Button>
      </div>
    </section>
  );
}

export function Rules({ mailbox }: { mailbox: string | null }) {
  const qc = useQueryClient();
  const q = useRules();
  const data = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mail', 'rules'] });
  const saveFilters = async (filters: MailFilter[], done: string) => {
    try {
      const r = await apiPut<{ synced?: boolean; error?: string | null }>('/api/mail/rules/filters', { filters, ...(mailbox ? { mailbox } : {}) });
      refresh();
      toast(r?.error ? 'info' : 'success', r?.error ? text('Saved, but not running yet: {why}', { why: r.error }) : done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const [running, setRunning] = useState<MailFilter | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !data) return <ErrorNote error={q.error ?? text('Could not load your rules.')} onRetry={() => void q.refetch()} />;
  const senders = data.filters.map((f) => ({ f, s: senderRule(f) })).filter((x): x is { f: MailFilter; s: NonNullable<ReturnType<typeof senderRule>> } => x.s !== null);
  const filters = data.filters.filter((f) => senderRule(f) === null);
  return (
    <>
      <h2 className="mb-4 text-[20px] font-bold text-ink">Rules</h2>
      {!data.server_rules.available && data.server_rules.reason ? <p className="mb-4 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{data.server_rules.reason}</p> : null}
      <Vacation value={data.vacation} mailbox={mailbox} onSaved={refresh} />
      <section aria-label={text('Filter rules')} className="mt-4 rounded-[12px] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="flex-1 text-[15px] font-bold text-ink">{text('Filter rules')}</h3>
          <Button size="sm" icon="download" onClick={() => download(exportRules(filters))} disabled={filters.length === 0}>
            {text('Export')}
          </Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle">
            <Icon name="upload" size={14} />
            {text('Import')}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void file.text().then((raw) => {
                  const r = importRules(raw);
                  if ('error' in r) return toast('error', r.error);
                  void saveFilters([...data.filters, ...r.rules.map((x) => (x.run_location === 'client' ? { ...x, device_id: deviceId() } : x))], text('{n} rules imported.', { n: r.rules.length }));
                });
              }}
            />
          </label>
        </div>
        {filters.length === 0 ? <p className="px-4 py-3 text-[12.5px] text-ink-3">No rules yet. A rule sorts mail as it arrives, on the mail server.</p> : null}
        <ul role="list">
          {filters.map((f) => (
            <li key={f.id ?? f.value} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0">
              <Switch label={f.name || filterWords(f)} checked={f.enabled} onChange={(on) => void saveFilters(data.filters.map((x) => (x === f ? { ...x, enabled: on } : x)), on ? text('Rule turned on.') : text('Rule turned off.'))} />
              <span className={cx('min-w-0 flex-1', !f.enabled && 'text-ink-3')}>
                {f.name ? <span className="block font-semibold text-ink">{f.name}</span> : null}
                <span className="block truncate text-ink-2">{filterWords(f)}</span>
                {f.exceptions?.length ? <span className="block truncate text-[12px] text-ink-3">{text('except if {list}', { list: f.exceptions.map((e) => `${e.field} ${e.op} “${e.value}”`).join(text(' or ')) })}</span> : null}
                {f.last_error ? <span role="alert" className="block text-[12px] font-semibold text-danger">{text('Switched off: {why}', { why: f.last_error })}</span> : null}
              </span>
              <Chip tone={f.run_location === 'client' ? 'warning' : 'muted'}>{f.run_location === 'client' ? (f.device_id && f.device_id !== deviceId() ? text('On another computer') : text('On this computer only')) : text('On the server')}</Chip>
              {f.id && f.run_location !== 'client' && f.action !== 'forward' ? (
                <Button size="sm" onClick={() => setRunning(f)}>
                  {text('Run now')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="!text-danger" onClick={() => void saveFilters(data.filters.filter((x) => x !== f), text('Rule removed.'))}>
                {text('Remove')}
              </Button>
            </li>
          ))}
        </ul>
        <NewRule onAdd={(r) => void saveFilters([...data.filters, r.run_location === 'client' ? { ...r, device_id: deviceId() } : r], text('Rule added.'))} />
      </section>
      {running ? <RunNow rule={running} mailbox={mailbox} onClose={() => setRunning(null)} onDone={refresh} /> : null}
      <section aria-label={text('Blocked and safe senders')} className="mt-4 rounded-[12px] border border-line bg-surface">
        <h3 className="border-b border-line px-4 py-3 text-[15px] font-bold text-ink">Blocked and safe senders</h3>
        {senders.length === 0 ? <p className="px-4 py-3 text-[12.5px] text-ink-3">Block a sender from a message’s More menu; their mail then goes to Junk.</p> : null}
        <ul role="list">
          {senders.map(({ f, s }) => (
            <li key={f.id ?? s.email} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0">
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.email}</span>
              <Chip tone={s.kind === 'blocked' ? 'danger' : 'success'}>{s.kind === 'blocked' ? text('Blocked · to Junk') : text('Safe · to Inbox')}</Chip>
              <Button size="sm" onClick={() => void saveFilters(data.filters.filter((x) => x !== f), s.kind === 'blocked' ? text('{email} is no longer blocked.', { email: s.email }) : text('{email} is no longer marked safe.', { email: s.email }))}>
                {s.kind === 'blocked' ? text('Unblock') : text('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Vacation({ value, mailbox, onSaved }: { value: RulesData['vacation']; mailbox: string | null; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPut<{ error?: string | null }>('/api/mail/rules/vacation', { ...v, ...(mailbox ? { mailbox } : {}) });
      onSaved();
      toast(r?.error ? 'info' : 'success', r?.error ? text('Saved, but not running yet: {why}', { why: r.error }) : v.enabled ? text('Automatic reply is on.') : text('Automatic reply is off.'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={text('Automatic reply')} className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13.5px]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-bold text-ink">{text('Automatic reply')}</h3>
          <p className="text-[12.5px] text-ink-3">{text('Answers mail while you are away, once per sender.')}</p>
        </div>
        <Switch label={text('Automatic reply')} checked={v.enabled} onChange={(on) => setV({ ...v, enabled: on })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={text('From')} type="date" value={v.start_date ?? ''} onChange={(e) => setV({ ...v, start_date: e.target.value || null })} />
        <TextField label={text('Until')} type="date" value={v.end_date ?? ''} onChange={(e) => setV({ ...v, end_date: e.target.value || null })} />
      </div>
      <TextField label={text('Subject')} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">{v.external_audience && v.external_audience !== 'same' ? text('Message to people in your organisation') : text('Message')}</span>
        <textarea value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} rows={4} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
      </label>
      {v.external_audience !== undefined ? (
        <div className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
          <div className="w-[320px] max-w-full">
            <Select
              label={text('People outside your organisation')}
              value={v.external_audience}
              options={[
                { value: 'same', label: text('Get the same reply') },
                { value: 'everyone', label: text('Get a separate reply') },
                { value: 'contacts', label: text('Only your contacts get a separate reply') },
                { value: 'none', label: text('Get no reply') },
              ]}
              onValueChange={(x) => setV({ ...v, external_audience: x as NonNullable<typeof v.external_audience> })}
            />
          </div>
          {v.external_audience === 'everyone' || v.external_audience === 'contacts' ? (
            <>
              <TextField label={text('Subject for outside')} value={v.external_subject ?? ''} onChange={(e) => setV({ ...v, external_subject: e.target.value })} placeholder={v.subject} />
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-ink-2">{text('Message to people outside')}</span>
                <textarea value={v.external_message ?? ''} onChange={(e) => setV({ ...v, external_message: e.target.value })} rows={4} placeholder={v.message} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
              </label>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          {text('Save automatic reply')}
        </Button>
      </div>
    </section>
  );
}

export function NewRule({ onAdd, initial }: { onAdd: (f: MailFilter) => void; initial?: Partial<MailFilter> }) {
  const [field, setField] = useState<MailFilter['field']>(initial?.field ?? 'from');
  const [op, setOp] = useState<MailFilter['op']>(initial?.op ?? 'contains');
  const [value, setValue] = useState(initial?.value ?? '');
  const [excField, setExcField] = useState<MailFilter['field']>('subject');
  const [exc, setExc] = useState('');
  const [where, setWhere] = useState<'server' | 'client'>('server');
  const [alert, setAlert] = useState(false);
  const [sound, setSound] = useState(false);
  const [action, setAction] = useState<MailFilter['action']>('fileinto');
  const [arg, setArg] = useState('');
  const [stop, setStop] = useState(true);
  const needsArg = action === 'fileinto' || action === 'forward';
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || (needsArg && !arg.trim())) return;
        onAdd({
          name: initial?.name ?? null,
          field,
          op,
          value: value.trim(),
          action,
          action_arg: needsArg ? arg.trim() : null,
          stop,
          enabled: true,
          exceptions: exc.trim() ? [{ field: excField, op: 'contains', value: exc.trim() }] : [],
          run_location: where,
          client_actions: where === 'client' ? [...(alert ? (['alert'] as const) : []), ...(sound ? (['sound'] as const) : [])] : [],
        });
        setValue('');
        setArg('');
        setExc('');
      }}
    >
      <div className="w-[130px]">
        <Select label={text('When')} value={field} options={[{ value: 'from', label: text('From') }, { value: 'to', label: text('To') }, { value: 'subject', label: text('Subject') }, { value: 'any', label: text('Anywhere') }]} onValueChange={(v) => setField(v as MailFilter['field'])} />
      </div>
      <div className="w-[120px]">
        <Select label={text('Test')} value={op} options={[{ value: 'contains', label: text('contains') }, { value: 'is', label: text('is') }, { value: 'matches', label: text('matches') }]} onValueChange={(v) => setOp(v as MailFilter['op'])} />
      </div>
      <TextField label={text('Value')} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-[160px] flex-1" />
      <div className="w-[150px]">
        <Select label={text('Then')} value={action} options={[{ value: 'fileinto', label: text('Move to folder') }, { value: 'star', label: text('Star it') }, { value: 'seen', label: text('Mark it read') }, { value: 'forward', label: text('Forward to') }, { value: 'delete', label: text('Delete it') }]} onValueChange={(v) => setAction(v as MailFilter['action'])} />
      </div>
      {needsArg ? <TextField label={action === 'forward' ? text('Address') : text('Folder')} value={arg} onChange={(e) => setArg(e.target.value)} className="w-[160px]" /> : null}
      <label className="flex h-9 items-center gap-2 text-[12.5px] text-ink-2">
        <Checkbox checked={stop} onChange={(e) => setStop(e.target.checked)} />
        Stop here
      </label>
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="w-[130px]">
          <Select label={text('Except if')} value={excField} options={[{ value: 'from', label: text('From') }, { value: 'to', label: text('To') }, { value: 'subject', label: text('Subject') }, { value: 'any', label: text('Anywhere') }]} onValueChange={(v) => setExcField(v as MailFilter['field'])} />
        </div>
        <TextField label={text('contains (optional)')} value={exc} onChange={(e) => setExc(e.target.value)} className="min-w-[160px] flex-1" />
        <fieldset className="flex items-center gap-3 text-[12.5px] text-ink-2">
          <legend className="sr-only">{text('Where it runs')}</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="rule-where" checked={where === 'server'} onChange={() => setWhere('server')} />
            {text('On the server')}
          </label>
          <label className="flex items-center gap-1.5" title={text('Needed for alerts and sounds; runs only while WorkSuite is open on this computer.')}>
            <input type="radio" name="rule-where" checked={where === 'client'} onChange={() => setWhere('client')} />
            {text('On this computer only')}
          </label>
        </fieldset>
        {where === 'client' ? (
          <>
            <label className="flex h-9 items-center gap-2 text-[12.5px] text-ink-2">
              <Checkbox checked={alert} onChange={(e) => setAlert(e.target.checked)} />
              {text('Show an alert')}
            </label>
            <label className="flex h-9 items-center gap-2 text-[12.5px] text-ink-2">
              <Checkbox checked={sound} onChange={(e) => setSound(e.target.checked)} />
              {text('Play a sound')}
            </label>
          </>
        ) : null}
        <Button type="submit" variant="primary" disabled={!value.trim() || (needsArg && !arg.trim())}>
          {text('Add rule')}
        </Button>
      </div>
    </form>
  );
}

/** Save a file the person chose to export. */
function download(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'worksuite-mail-rules.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Create rule from a message (DMO-RUL-05): sender, recipients and subject filled in. */
export function CreateRule({ row, onSave, onClose }: { row: { from_email: string; from_name: string; subject: string }; onSave: (f: MailFilter) => void; onClose: () => void }) {
  return (
    <Modal title={text('Create rule')} labelledBy="mail-create-rule" width={720} onClose={onClose} footer={<Button onClick={onClose}>{text('Cancel')}</Button>}>
      <p className="px-5 pt-4 text-[13px] text-ink-3">{text('From {sender} · “{subject}”', { sender: row.from_name || row.from_email, subject: row.subject || text('(no subject)') })}</p>
      <NewRule initial={{ field: 'from', op: 'contains', value: row.from_email }} onAdd={onSave} />
    </Modal>
  );
}

/** Run rules now (DMO-RUL-06): a folder and a date range, with what it did. */
function RunNow({ rule, mailbox, onClose, onDone }: { rule: MailFilter; mailbox: string | null; onClose: () => void; onDone: () => void }) {
  const folders = useFolders(Number(mailbox ?? 0), !!mailbox);
  const [folder, setFolder] = useState('inbox');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ checked: number; matched: number; done: number } | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ checked: number; matched: number; done: number }>(`/api/mail/rules/${rule.id}/run`, { mailbox, folder, since: since || null, until: until || null });
      setResult(r);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={text('Run “{rule}” now', { rule: rule.name || filterWords(rule) })} labelledBy="mail-rule-run" width={440} onClose={onClose} footer={<><Button onClick={onClose}>{text('Close')}</Button><Button variant="primary" loading={busy} onClick={() => void run()}>{text('Run now')}</Button></>}>
      <div className="flex flex-col gap-3 p-5 text-[13.5px]">
        <Select label={text('Folder')} value={folder} options={(folders.data?.folders ?? [{ id: 0, name: 'Inbox', slug: 'inbox', type: 'system', total: 0, unread: 0 }]).filter((f) => f.slug !== 'starred' && f.slug !== 'important').map((f) => ({ value: f.slug, label: f.name }))} onValueChange={(v) => setFolder(String(v))} />
        <div className="grid grid-cols-2 gap-3">
          <TextField type="date" label={text('From')} value={since} onChange={(e) => setSince(e.target.value)} />
          <TextField type="date" label={text('Until')} value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        {busy ? <div role="progressbar" aria-label={text('Running the rule')} className="h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full w-1/2 animate-pulse bg-primary" /></div> : null}
        {result ? <p role="status" className="font-semibold text-ink">{text('Checked {checked} · {matched} matched · {done} changed.', result)}</p> : null}
      </div>
    </Modal>
  );
}
