import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, Empty, ErrorNote, Spinner, Switch, TextField, cx } from '../../components/ui';
import { useSignatures } from './api';
import { plainText } from './model';
import { textToHtml } from './sanitize';
import type { Signature } from './types';

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
  field: 'from' | 'to' | 'subject' | 'any';
  op: 'contains' | 'is' | 'matches';
  value: string;
  action: 'fileinto' | 'star' | 'seen' | 'delete' | 'forward';
  action_arg: string | null;
  stop: boolean;
  enabled: boolean;
}

export interface RulesData {
  server_rules: { available: boolean; reason: string | null };
  vacation: { enabled: boolean; subject: string; message: string; start_date: string | null; end_date: string | null };
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

const useRules = () => useQuery({ queryKey: ['mail', 'rules'], queryFn: () => apiGet<RulesData>('/api/mail/rules'), staleTime: 60_000, retry: false });

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
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">Signatures</h2>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          New signature
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
                </span>
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
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? <SignatureEditor signature={editing === 'new' ? null : editing} first={rows.length === 0} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </>
  );
}

function SignatureEditor({ signature, first, onClose, onSaved }: { signature: Signature | null; first: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(signature?.name ?? '');
  const [body, setBody] = useState(signature ? plainText(signature.html) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), html: textToHtml(body.trim()), ...(signature ? {} : { is_default: first }) };
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
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Signature</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!name.trim() || !body.trim()} onClick={() => void save()}>
          Save
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
        <h3 className="border-b border-line px-4 py-3 text-[15px] font-bold text-ink">Filter rules</h3>
        {filters.length === 0 ? <p className="px-4 py-3 text-[12.5px] text-ink-3">No rules yet. A rule sorts mail as it arrives, on the mail server.</p> : null}
        <ul role="list">
          {filters.map((f) => (
            <li key={f.id ?? f.value} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0">
              <Switch label={f.name || filterWords(f)} checked={f.enabled} onChange={(on) => void saveFilters(data.filters.map((x) => (x === f ? { ...x, enabled: on } : x)), on ? text('Rule turned on.') : text('Rule turned off.'))} />
              <span className={cx('min-w-0 flex-1', !f.enabled && 'text-ink-3')}>
                {f.name ? <span className="block font-semibold text-ink">{f.name}</span> : null}
                <span className="block truncate text-ink-2">{filterWords(f)}</span>
              </span>
              <Button size="sm" variant="ghost" className="!text-danger" onClick={() => void saveFilters(data.filters.filter((x) => x !== f), text('Rule removed.'))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <NewRule onAdd={(r) => void saveFilters([...data.filters, r], text('Rule added.'))} />
      </section>
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
          <h3 className="text-[15px] font-bold text-ink">Automatic reply</h3>
          <p className="text-[12.5px] text-ink-3">Answers mail while you are away, once per sender.</p>
        </div>
        <Switch label={text('Automatic reply')} checked={v.enabled} onChange={(on) => setV({ ...v, enabled: on })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={text('From')} type="date" value={v.start_date ?? ''} onChange={(e) => setV({ ...v, start_date: e.target.value || null })} />
        <TextField label={text('Until')} type="date" value={v.end_date ?? ''} onChange={(e) => setV({ ...v, end_date: e.target.value || null })} />
      </div>
      <TextField label={text('Subject')} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Message</span>
        <textarea value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} rows={4} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
      </label>
      <div className="flex justify-end">
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save automatic reply
        </Button>
      </div>
    </section>
  );
}

function NewRule({ onAdd }: { onAdd: (f: MailFilter) => void }) {
  const [field, setField] = useState<MailFilter['field']>('from');
  const [value, setValue] = useState('');
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
        onAdd({ name: null, field, op: 'contains', value: value.trim(), action, action_arg: needsArg ? arg.trim() : null, stop, enabled: true });
        setValue('');
        setArg('');
      }}
    >
      <div className="w-[130px]">
        <Select label={text('When')} value={field} options={[{ value: 'from', label: text('From') }, { value: 'to', label: text('To') }, { value: 'subject', label: text('Subject') }, { value: 'any', label: text('Anywhere') }]} onValueChange={(v) => setField(v as MailFilter['field'])} />
      </div>
      <TextField label={text('contains')} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-[160px] flex-1" />
      <div className="w-[150px]">
        <Select label={text('Then')} value={action} options={[{ value: 'fileinto', label: text('Move to folder') }, { value: 'star', label: text('Star it') }, { value: 'seen', label: text('Mark it read') }, { value: 'forward', label: text('Forward to') }, { value: 'delete', label: text('Delete it') }]} onValueChange={(v) => setAction(v as MailFilter['action'])} />
      </div>
      {needsArg ? <TextField label={action === 'forward' ? text('Address') : text('Folder')} value={arg} onChange={(e) => setArg(e.target.value)} className="w-[160px]" /> : null}
      <label className="flex h-9 items-center gap-2 text-[12.5px] text-ink-2">
        <Checkbox checked={stop} onChange={(e) => setStop(e.target.checked)} />
        Stop here
      </label>
      <Button type="submit" variant="primary" disabled={!value.trim() || (needsArg && !arg.trim())}>
        Add rule
      </Button>
    </form>
  );
}
