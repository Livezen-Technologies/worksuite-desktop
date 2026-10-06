import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refreshMarketing, send } from './api';
import { Confirm, useTopics } from './email-kit';
import { Card, Field, PageHeader, Pill, Sheet, btn, btnPrimary, btnSmall, input, n } from './parts';
import { companiesWhere, fieldErrors, refusal, type Options, type Topic } from './types';

/**
 * Topics & preferences: what a company's emails are about — product updates,
 * the newsletter, events. Every campaign email links to a page where the
 * person chooses which of these they hear about, and a campaign about a topic
 * leaves out whoever said no to it.
 *
 * Changing a topic changes that page for every recipient, so it is
 * Marketing's settings to change; everybody who writes campaigns can see
 * them. Consent › Topics shows this same screen, `embedded` (without its own
 * heading).
 */
export default function Topics({ org, options, embedded = false }: { org: string; options: Options; embedded?: boolean }) {
  const [editing, setEditing] = useState<Topic | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Topic | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useTopics(org);
  const managers = companiesWhere(options, 'settings');
  const mayManage = (orgId: number) => managers.some((c) => c.id === orgId);
  const items = q.data?.items ?? [];
  const scoped = org.split(',').filter(Boolean).map(Number);
  const groups = options.companies
    .filter((c) => scoped.length === 0 || scoped.includes(c.id))
    .map((company) => ({ company, topics: items.filter((t) => t.org_id === company.id).sort((a, b) => a.position - b.position) }))
    .filter((g) => g.topics.length > 0 || mayManage(g.company.id));
  const several = groups.length > 1;
  const suggested = q.data?.suggested.length ?? 6;

  const act = async (method: 'POST', path: string, body: unknown, fallback: string): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await send(method, path, body);
      toast('success', r.message ?? fallback);
      void refreshMarketing();
      return true;
    } catch (e) {
      toast('error', refusal(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addSuggested = (orgId: number) => void act('POST', '/api/marketing/topics/suggested', { org_id: orgId }, 'Added.');

  const body = q.isLoading ? (
    <Spinner label="Loading topics…" />
  ) : q.error ? (
    <ErrorNote error={new Error(refusal(q.error, 'The topics could not be loaded.'))} onRetry={() => void q.refetch()} />
  ) : groups.length === 0 ? (
    <Card>
      <p className="m-0 text-[13px] text-ink-2">No topics yet. With none, every email simply offers to unsubscribe.</p>
    </Card>
  ) : (
    <div className="flex flex-col gap-5">
      {groups.map(({ company, topics }) => (
        <section key={company.id} aria-label={several ? company.name : 'Topics'}>
          {several ? <h2 className="m-0 mb-2 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">{company.name}</h2> : null}
          {topics.length === 0 ? (
            <Card>
              <p className="m-0 text-[13px] text-ink-2">No topics yet. With none, every email simply offers to unsubscribe.</p>
              {mayManage(company.id) ? (
                <button type="button" className={cx(btn, 'mt-3')} disabled={busy} onClick={() => addSuggested(company.id)}>
                  Add the {suggested} suggested topics
                </button>
              ) : null}
            </Card>
          ) : (
            <ul className="m-0 list-none overflow-hidden rounded-[12px] border border-line bg-surface p-0">
              {topics.map((t, i) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-[1_1_220px]">
                    <p className="m-0 flex items-center gap-2 text-[13.5px] font-bold text-ink">
                      <span className="truncate">{t.name}</span>
                      {t.archived ? <Pill tone="slate">Archived</Pill> : null}
                    </p>
                    {t.description ? <p className="m-0 truncate text-[12px] text-ink-3">{t.description}</p> : null}
                  </div>
                  <span className="text-[12px] text-ink-3 tabular-nums">{n(t.opted_out)} opted out</span>
                  <span className="text-[12px] text-ink-3 tabular-nums">
                    {n(t.campaigns)} {t.campaigns === 1 ? 'campaign' : 'campaigns'}
                  </span>
                  {mayManage(t.org_id) ? (
                    <span className="flex items-center gap-1">
                      <button type="button" aria-label={`Move ${t.name} up`} disabled={busy || i === 0} onClick={() => void act('POST', `/api/marketing/topics/${t.id}/move`, { direction: -1 }, 'Moved.')} className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-30">
                        <Icon name="arrow-up" size={15} />
                      </button>
                      <button type="button" aria-label={`Move ${t.name} down`} disabled={busy || i === topics.length - 1} onClick={() => void act('POST', `/api/marketing/topics/${t.id}/move`, { direction: 1 }, 'Moved.')} className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-30">
                        <Icon name="arrow-down" size={15} />
                      </button>
                      <button type="button" className={btnSmall} onClick={() => setEditing(t)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={btnSmall}
                        disabled={busy}
                        onClick={() => (t.archived ? void act('POST', `/api/marketing/topics/${t.id}/restore`, undefined, 'Back in use.') : setArchiving(t))}
                      >
                        {t.archived ? 'Restore' : 'Archive'}
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {topics.length > 0 && topics.length < suggested && mayManage(company.id) ? (
            <button type="button" className="mt-2 text-[12.5px] font-bold text-primary hover:underline disabled:opacity-50" disabled={busy} onClick={() => addSuggested(company.id)}>
              Add the suggested topics this company does not have
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );

  const newButton = managers.length > 0 ? (
    <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
      <Icon name="plus" size={15} /> New topic
    </button>
  ) : null;

  return (
    <div className="flex flex-col">
      {embedded ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[12.5px] text-ink-3">People choose between these on the page every campaign email links to. A campaign about one leaves out whoever said no to it.</p>
          {newButton}
        </div>
      ) : (
        <PageHeader crumbs={['Email']} title="Topics & preferences" sub="People choose between these on the page every campaign email links to. A campaign about one leaves out whoever said no to it." actions={newButton} />
      )}
      {body}

      {editing ? <TopicForm topic={editing === 'new' ? null : editing} companies={managers} org={org} onClose={() => setEditing(null)} /> : null}
      {archiving ? (
        <Confirm
          title={`Archive ${archiving.name}?`}
          yes="Archive"
          busy={busy}
          onClose={() => setArchiving(null)}
          onYes={() => void act('POST', `/api/marketing/topics/${archiving.id}/archive`, undefined, 'Archived.').then((ok) => ok && setArchiving(null))}
        >
          It leaves the preferences page and is offered to no new campaign. Whoever opted out of it stays opted out.
        </Confirm>
      ) : null}
    </div>
  );
}

function TopicForm({ topic, companies, org, onClose }: { topic: Topic | null; companies: Array<{ id: number; name: string }>; org: string; onClose: () => void }) {
  const scoped = org.split(',').filter(Boolean).map(Number);
  const [orgId, setOrgId] = useState(String(topic?.org_id ?? (scoped.length === 1 && companies.some((c) => c.id === scoped[0]) ? scoped[0] : companies.length === 1 ? companies[0]!.id : '')));
  const [name, setName] = useState(topic?.name ?? '');
  const [description, setDescription] = useState(topic?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = topic
        ? await send('PUT', `/api/marketing/topics/${topic.id}`, { name: name.trim(), description })
        : await send('POST', '/api/marketing/topics', { org_id: Number(orgId), name: name.trim(), description });
      toast('success', r.message ?? 'Saved.');
      void refreshMarketing();
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
      title={topic ? topic.name : 'New topic'}
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
      {!topic && companies.length > 1 ? (
        <Field label="Company">
          <Select aria-label="Company" value={orgId} onValueChange={setOrgId} placeholder="Choose a company" options={companies.map((c) => ({ value: String(c.id), label: c.name }))} />
        </Field>
      ) : null}
      <Field label="Name" hint="As people see it on their preferences page.">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Product updates" />
      </Field>
      {errors.name ? <p role="alert" className="m-0 text-[12px] text-danger">{errors.name}</p> : null}
      <Field label="What it is about" hint="One line under the name.">
        <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} placeholder="What is new in what we make." />
      </Field>
      {topic ? <p className="m-0 text-[12px] text-ink-3">Renaming it changes what everybody sees on their preferences page. Who opted out of it stays opted out.</p> : null}
    </Sheet>
  );
}
