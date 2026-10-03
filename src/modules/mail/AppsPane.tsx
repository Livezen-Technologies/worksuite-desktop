import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { canOpen } from '../../core/access';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { plainText } from './model';
import { crmActivity, findCrmRecord } from './quickSteps';
import type { MessageContext, MessageDetail } from './types';

/**
 * The Apps pane (ENH-MAIL-03 DMO-INT-01, DMO-INT-02): WorkSuite's own apps
 * beside the message, in its context — the sender in CRM (lead or account,
 * its open deals, Log this email), related tasks and meetings, a helpdesk
 * ticket, a note. Each section shows only for someone who has that app, and
 * everything goes through WorkSuite's own APIs and permissions; there are no
 * Outlook add-in manifests (DMO-INT-02).
 */

interface AccountDetail {
  account: { id: number; name: string; status?: string | null };
  deals?: Array<{ id: number; name: string; amount: number; currency: string | null; stage: string; stage_kind: string }>;
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line px-3 py-3 last:border-b-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold tracking-wide text-ink-2 uppercase">
        <Icon name={icon} size={13} />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AppsPane({ m, link, context, offline, navigate, onCreateTask, onSaveNote, onClose }: { m: MessageDetail; link: string; context: MessageContext | null | undefined; offline: boolean; navigate: (route: string) => void; onCreateTask: () => void; onSaveNote: () => void; onClose: () => void }) {
  const crm = canOpen('crm');
  const found = useQuery({
    queryKey: ['mail', 'apps', 'crm', m.from_email.toLowerCase()],
    queryFn: () => findCrmRecord(m.from_email),
    enabled: crm && !offline,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const account = useQuery({
    queryKey: ['mail', 'apps', 'account', found.data?.kind === 'account' ? found.data.record.id : null],
    queryFn: () => apiGet<AccountDetail>(`/api/crm/accounts/${found.data!.record.id}`),
    enabled: found.data?.kind === 'account' && !offline,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const logEmail = () => {
    const f = found.data;
    if (!f) return;
    void run('crm', () => apiPost(`/api/crm/${f.kind === 'lead' ? 'leads' : 'accounts'}/${f.record.id}/activity`, crmActivity({ subject: m.subject, preview: plainText(m.body_html).slice(0, 500) }, link)), text('Logged in CRM.'));
  };
  const ticket = () =>
    void run(
      'ticket',
      () => apiPost('/api/tickets', { subject: (m.subject || text('(no subject)')).slice(0, 255), requester_name: m.from_name || null, requester_email: m.from_email, body: `${plainText(m.body_html).slice(0, 20_000)}${link ? `\n\n${text('From the email: {link}', { link })}` : ''}` }),
      text('Helpdesk ticket raised.'),
    );
  const tasks = context?.related?.tasks ?? [];
  const meetings = context?.related?.meetings ?? [];
  const open = (account.data?.deals ?? []).filter((d) => d.stage_kind === 'open');

  return (
    <aside aria-label={text('Apps')} className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line bg-ground scroll-thin">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 text-[13px] font-bold text-ink">{text('Apps')}</span>
        <button type="button" aria-label={text('Close the Apps pane')} onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={14} />
        </button>
      </div>
      {crm ? (
        <Section title={text('CRM')} icon="users">
          {offline ? (
            <p className="text-[12.5px] text-ink-3">{text('CRM needs a connection.')}</p>
          ) : found.isLoading ? (
            <p className="text-[12.5px] text-ink-3">{text('Looking up {email}…', { email: m.from_email })}</p>
          ) : found.error ? (
            <p className="text-[12.5px] text-ink-3">{errorMessage(found.error)}</p>
          ) : found.data ? (
            <div className="flex flex-col gap-2 text-[13px]">
              <button type="button" onClick={() => navigate(found.data!.kind === 'lead' ? `/crm?lead=${found.data!.record.id}` : `/crm?account=${found.data!.record.id}`)} className="text-left">
                <span className="block font-semibold text-primary hover:underline">{found.data.record.name ?? account.data?.account.name ?? m.from_email}</span>
                <span className="block text-[12px] text-ink-3">{[found.data.kind === 'lead' ? text('Lead') : text('Account'), found.data.record.status, found.data.record.company].filter(Boolean).join(' · ')}</span>
              </button>
              {open.length ? (
                <ul aria-label={text('Open deals')} className="flex flex-col gap-1">
                  {open.slice(0, 5).map((d) => (
                    <li key={d.id} className="text-[12.5px]">
                      <span className="font-semibold text-ink">{d.name}</span> <span className="text-ink-3">· {d.stage} · {d.currency ?? ''} {d.amount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button size="sm" icon="plus" loading={busy === 'crm'} onClick={logEmail}>
                {text('Log this email')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-[12.5px] text-ink-3">
              <p>{text('{email} is not a lead or account in CRM.', { email: m.from_email })}</p>
              <Button size="sm" icon="plus" onClick={() => navigate('/crm?new=1')}>
                {text('New lead')}
              </Button>
            </div>
          )}
        </Section>
      ) : null}
      {canOpen('tasks') ? (
        <Section title={text('Tasks')} icon="list-todo">
          {tasks.length ? (
            <ul className="mb-2 flex flex-col gap-1 text-[12.5px]">
              {tasks.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => navigate(`/tasks?task=${t.id}`)} className="text-left font-semibold text-ink hover:text-primary hover:underline">
                    {t.title}
                  </button>
                  <span className="text-ink-3">{[t.status, t.due ? dateLabel(t.due) : null].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Button size="sm" icon="plus" onClick={onCreateTask}>
            {text('Create task…')}
          </Button>
        </Section>
      ) : null}
      {meetings.length ? (
        <Section title={text('Meetings')} icon="calendar">
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {meetings.slice(0, 5).map((x) => (
              <li key={x.id}>
                <span className="font-semibold text-ink">{x.title}</span>
                <span className="text-ink-3">{x.at ? ` · ${dateLabel(x.at)}` : ''}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={text('Helpdesk')} icon="life-buoy">
        <Button size="sm" icon="plus" loading={busy === 'ticket'} disabled={offline} onClick={ticket}>
          {text('Create a helpdesk ticket')}
        </Button>
      </Section>
      {canOpen('notes') ? (
        <Section title={text('Notes')} icon="file-text">
          <Button size="sm" icon="plus" onClick={onSaveNote}>
            {text('Save as note')}
          </Button>
        </Section>
      ) : null}
    </aside>
  );
}
