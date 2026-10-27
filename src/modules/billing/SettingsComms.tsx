import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Seg, Sheet } from '../../components/PageKit';
import { offsetLabel } from './actions';
import { fetchReminderLog, fetchReminders, fetchTemplates, KA, PLACEHOLDERS, removeTemplate, saveReminders, saveTemplate, sortSteps, TEMPLATE_KINDS, type Channel, type MessageTemplate, type ReminderSettings, type TemplateKind } from './admin';
import { SettingsGroup } from '../../components/SettingsKit';

/**
 * Payment reminders (dunning, W13) and the message templates they and the
 * Send dialog use. The schedule is steps relative to the due date — before,
 * on and after — each by email and, where WhatsApp is installed, WhatsApp,
 * with a template; reminders stop when the invoice is paid, while a dispute
 * is open, and for customers who opted out. The server runs them; this is
 * what it runs, and what it sent.
 */
export function Reminders({ may, org }: { may: boolean; org: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.reminders(org), queryFn: ({ signal }) => fetchReminders(org, signal) });
  const log = useQuery({ queryKey: KA.reminderLog(org), queryFn: ({ signal }) => fetchReminderLog(org, signal), retry: false });
  const templates = useQuery({ queryKey: [...KA.templates(org), 'reminder'], queryFn: ({ signal }) => fetchTemplates(org, 'reminder', signal), retry: false, staleTime: 300_000 });
  const [draft, setDraft] = useState<ReminderSettings | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const s = draft ?? q.data!;
  const edit = (patch: Partial<ReminderSettings>) => setDraft({ ...s, ...patch });
  const step = (i: number, patch: Partial<ReminderSettings['steps'][number]>) => edit({ steps: s.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const wa = s.whatsapp_available !== false;
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveReminders(org, { ...s, steps: sortSteps(s.steps) });
      toast('success', r.message ?? 'Reminders saved.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: KA.reminders(org) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SettingsGroup title="Payment reminders" description="Remind customers automatically, before and after an invoice falls due." actions={
          may ? (
            <span className="flex gap-1.5">
              {draft ? (
                <button type="button" className={btnSmall} onClick={() => setDraft(null)}>
                  Undo changes
                </button>
              ) : null}
              <button type="button" className={btnPrimary + ' !h-[30px]'} disabled={busy || !draft} onClick={() => void save()}>
                Save
              </button>
            </span>
          ) : null
        } className="!mb-0">
        <div className="min-h-0 flex-1 flex flex-col gap-2 px-3.5 py-3">
        <label className="flex items-center gap-2 font-semibold text-ink">
          <Checkbox checked={s.enabled} disabled={!may} onChange={(e) => edit({ enabled: e.target.checked })} />
          Send reminders on this schedule
        </label>
        <div className="flex flex-col rounded-[10px] border border-line">
          {s.steps.map((x, i) => (
            <div key={i} data-step={x.offset_days} className="flex flex-wrap items-center gap-2.5 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
              <span
                className={cx(
                  'flex h-7 w-11 shrink-0 items-center justify-center rounded-[8px] font-bold tabular-nums',
                  x.offset_days < 0 ? 'bg-selection text-primary' : x.offset_days >= 30 ? 'bg-danger-bg text-danger' : x.offset_days > 0 ? 'bg-warning-bg text-warning-ink dark:text-warning' : 'bg-selection text-primary',
                )}
              >
                {x.offset_days === 0 ? '0' : offsetLabel(x.offset_days)}
              </span>
              <label className="flex items-center gap-1.5 text-ink-2">
                <input
                  aria-label={`Step ${i + 1} days from the due date`}
                  type="number"
                  min={-60}
                  max={365}
                  disabled={!may}
                  value={x.offset_days}
                  onChange={(e) => step(i, { offset_days: Math.round(Number(e.target.value) || 0) })}
                  className={input + ' !h-[30px] !w-[70px] tabular-nums'}
                />
                {x.offset_days < 0 ? 'days before due' : x.offset_days === 0 ? 'on the due date' : 'days overdue'}
              </label>
              <span className="flex items-center gap-3">
                {(['email', 'whatsapp'] as Channel[]).map((c) => (
                  <label key={c} className={cx('flex items-center gap-1.5', c === 'whatsapp' && !wa && 'opacity-50')} title={c === 'whatsapp' && !wa ? 'WhatsApp is not installed' : undefined}>
                    <Checkbox
                      aria-label={`Step ${i + 1} by ${c === 'email' ? 'email' : 'WhatsApp'}`}
                      checked={x.channels.includes(c)}
                      disabled={!may || (c === 'whatsapp' && !wa)}
                      onChange={(e) => step(i, { channels: e.target.checked ? [...new Set([...x.channels, c])] : x.channels.filter((y) => y !== c) })}
                    />
                    {c === 'email' ? 'Email' : 'WhatsApp'}
                  </label>
                ))}
              </span>
              <span className="flex-1" />
              <Select<string>
                aria-label={`Step ${i + 1} template`}
                value={x.template_id ? String(x.template_id) : ''}
                disabled={!may}
                onValueChange={(v) => step(i, { template_id: v ? Number(v) : null })}
                options={[{ value: '', label: 'The default reminder' }, ...(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]}
                className={input + ' !h-[30px] !w-[200px]'}
              />
              {may ? (
                <button
                  type="button"
                  aria-label={`Remove step ${i + 1}`}
                  title="Remove"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger-bg"
                  onClick={() => edit({ steps: s.steps.filter((_, j) => j !== i) })}
                >
                  <Icon name="x" size={13} />
                </button>
              ) : null}
            </div>
          ))}
          {!s.steps.length ? <Empty text="No steps: nothing is sent." /> : null}
        </div>
        {may ? (
          <button
            type="button"
            className="self-start text-[12.5px] font-semibold text-primary hover:underline"
            onClick={() => edit({ steps: [...s.steps, { offset_days: (s.steps[s.steps.length - 1]?.offset_days ?? 0) + 7, channels: ['email'], template_id: null }] })}
          >
            + Add a step
          </button>
        ) : null}
        <b className="mt-1 text-[11px] tracking-[.4px] text-ink-3 uppercase">Stop rules</b>
        <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <Icon name="check" size={14} className="text-success" /> They stop when the invoice is paid or credited, and for customers who opted out.
        </span>
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={s.stop_on_dispute} disabled={!may} onChange={(e) => edit({ stop_on_dispute: e.target.checked })} />
          Pause while a dispute is open on the invoice
        </label>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Sent lately" className="!mb-0">
        <div className="min-h-0 flex-1 flex flex-col">
        {log.isLoading ? <Spinner /> : null}
        {(log.data ?? []).slice(0, 30).map((r, i) => (
          <div key={r.id ?? `next-${i}`} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
            <b className="w-[110px] shrink-0 truncate text-ink">{r.invoice_number ?? (r.invoice_id ? `#${r.invoice_id}` : '—')}</b>
            <span className="min-w-0 flex-1 truncate text-ink-2">{r.customer ?? ''}</span>
            <span className="w-[50px] shrink-0 text-ink-2 tabular-nums">{offsetLabel(r.offset_days)}</span>
            <span className="w-[80px] shrink-0 text-ink-2">{r.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
            <span className={cx('w-[80px] shrink-0', r.status === 'failed' ? 'text-danger' : 'text-ink-2')} title={r.error ?? undefined}>
              {r.status}
            </span>
            <span className="w-[90px] shrink-0 text-ink-3">{r.sent_at ? dateLabel(r.sent_at) : r.due_on ? dateLabel(r.due_on) : '—'}</span>
          </div>
        ))}
        {!log.isLoading && !(log.data ?? []).length ? <Empty text={log.error ? errorMessage(log.error) : 'No reminder has been sent yet.'} /> : null}
        </div>
      </SettingsGroup>
    </>
  );
}

export function Templates({ may, org }: { may: boolean; org: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<TemplateKind>('invoice');
  const q = useQuery({ queryKey: [...KA.templates(org), kind], queryFn: ({ signal }) => fetchTemplates(org, kind, signal) });
  const [editing, setEditing] = useState<Partial<MessageTemplate> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      after?.();
      void qc.invalidateQueries({ queryKey: KA.templates(org) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup title="Message templates" description="The words of invoices, reminders, statements and receipts sent to customers." actions={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setEditing({ kind, name: '', subject: '', body: '', ...(/^\d+$/.test(org) ? { org_id: Number(org) } : {}) })}>
            + New template
          </button>
        ) : null
      } className="!mb-0">
      <div className="min-h-0 flex-1 flex flex-col">
      <div className="border-b border-line px-3.5 py-2.5">
        <Seg<TemplateKind> label="Kind of message" value={kind} onChange={setKind} options={TEMPLATE_KINDS.map((k) => ({ id: k.id, label: k.label }))} />
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {(q.data ?? []).map((t) => (
        <div key={t.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">
              {t.name}
              {t.is_default ? <span className="ml-1.5 rounded-[8px] bg-selection px-1.5 text-[11px] font-semibold text-primary">default</span> : null}
            </b>
            <span className="truncate text-[11.5px] text-ink-3">{t.subject || t.body.slice(0, 80)}</span>
          </span>
          <span className="w-[80px] shrink-0 text-ink-2">{t.whatsapp_body ? 'Email, WhatsApp' : 'Email'}</span>
          {may ? (
            <span className="w-[110px] shrink-0 text-right">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing(t)}>
                Edit
              </button>
              <span className="text-ink-3"> · </span>
              <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void run(() => removeTemplate(t.id), `${t.name} removed.`)}>
                Remove
              </button>
            </span>
          ) : null}
        </div>
      ))}
      {!q.isLoading && !(q.data ?? []).length ? <Empty text="No templates of this kind: the server’s own words are used." /> : null}
      {editing ? (
        <Sheet
          title={editing.id ? `Edit ${editing.name}` : 'New template'}
          width={560}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !editing.name?.trim() || !editing.body?.trim()}
                onClick={() =>
                  void run(
                    () => saveTemplate({ ...editing, name: editing.name!.trim() }),
                    'Template saved.',
                    () => setEditing(null),
                  )
                }
              >
                Save
              </button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Name">
              <input aria-label="Name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} />
            </Field>
          </div>
          <Field label="Subject" hint="The email’s subject">
            <input aria-label="Subject" value={editing.subject ?? ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} className={input} />
          </Field>
          <Field label="Message" hint={`Filled in when sent: ${PLACEHOLDERS.join(' ')}`}>
            <textarea aria-label="Message" value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className={input + ' !h-[180px] resize-none py-2 leading-relaxed'} />
          </Field>
          <Field label="WhatsApp text" hint="Optional — without it, WhatsApp gets a short form of the message">
            <textarea aria-label="WhatsApp text" value={editing.whatsapp_body ?? ''} onChange={(e) => setEditing({ ...editing, whatsapp_body: e.target.value })} className={input + ' !h-[80px] resize-none py-2 leading-relaxed'} />
          </Field>
          <label className="flex items-center gap-2 font-semibold text-ink">
            <Checkbox checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
            The default for {TEMPLATE_KINDS.find((k) => k.id === (editing.kind ?? kind))?.label.toLowerCase()} messages
          </label>
        </Sheet>
      ) : null}
      </div>
    </SettingsGroup>
  );
}
