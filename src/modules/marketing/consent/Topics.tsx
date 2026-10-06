import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, IconButton, Modal, Switch } from '../../../components/ui';
import { deleteTopic, MK, saveTopic, useSettings, useTopics, type Topic } from '../api';
import { count, plural } from '../lib/format';
import { useCompanies, useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, PageBody, PageHeader, Panel, Status, Table, TD, TextArea, TH, useAction } from '../parts';

/**
 * Topics & preferences (MKT-CON-04/05/06; WF-11; design P01 "Email preference centre"). The topics a campaign targets
 * and a contact chooses, and beside them the preference centre as contacts see it from the signed link in every email
 * — drawn only from the topics shown there, never sample ones. Every change a contact makes there is a ledger entry
 * with actor "contact" (MKT-CON-06), which is the server's to write.
 */
export default function Topics() {
  const q = useTopics();
  const [editing, setEditing] = useState<Topic | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Topic | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Email"
        title="Topics & preferences"
        sub="What contacts can choose to hear about in the preference centre linked from every email"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            New topic
          </Button>
        }
      />
      <PageBody>
        <Loaded q={q} what="Topics">
          {(topics) => (
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              {topics.length === 0 ? (
                <div className="rounded-[12px] border border-line bg-surface">
                  <Empty
                    icon="tag"
                    title="No topics yet"
                    hint="Create topics such as Services news or Tenders, and target campaigns at a topic. Contacts choose theirs in the preference centre."
                    action={
                      <Button variant="primary" icon="plus" className="mt-1" onClick={() => setEditing('new')}>
                        New topic
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Table
                  label="Topics"
                  head={
                    <tr>
                      <th className={TH}>Topic</th>
                      <th className={TH}>Description</th>
                      <th className={cx(TH, 'text-right')}>Subscribers</th>
                      <th className={TH}>In preference centre</th>
                      <th className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  }
                >
                  {topics.map((t) => (
                    <tr key={t.id}>
                      <td className={cx(TD, 'font-semibold')}>{t.name}</td>
                      <td className={cx(TD, 'max-w-[320px] text-ink-2')}>{t.description ? <span className="line-clamp-2">{t.description}</span> : <span className="text-ink-3">—</span>}</td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono>{count(t.subscribers_count)}</Mono>
                      </td>
                      <td className={TD}>{t.public ? <Status tone="success">Yes</Status> : <Status tone="muted">No</Status>}</td>
                      <td className={cx(TD, 'whitespace-nowrap text-right')}>
                        <IconButton icon="compose" label={`Edit ${t.name}`} size={16} onClick={() => setEditing(t)} />
                        <IconButton icon="trash" label={`Delete ${t.name}`} size={16} onClick={() => setDeleting(t)} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              <Preview topics={topics.filter((t) => t.public)} />
            </div>
          )}
        </Loaded>
      </PageBody>
      {editing ? <TopicEditor topic={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteTopic topic={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

function TopicEditor({ topic, onClose }: { topic: Topic | null; onClose: () => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const title = useId();
  const hint = useId();
  const [name, setName] = useState(topic?.name ?? '');
  const [description, setDescription] = useState(topic?.description ?? '');
  const [shown, setShown] = useState(topic?.public ?? true);
  const [busy, run] = useAction();
  const ready = name.trim().length > 0;

  const save = () =>
    void run(
      'save',
      async () => {
        await saveTopic(org, topic?.id ?? null, { name: name.trim(), description: description.trim() || null, public: shown });
        void qc.invalidateQueries({ queryKey: MK.all });
        onClose();
      },
      topic ? 'Topic saved.' : 'Topic created.',
    );

  return (
    <Modal
      title={topic ? 'Edit topic' : 'New topic'}
      labelledBy={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!ready} onClick={save}>
            {topic ? 'Save topic' : 'Create topic'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) save();
        }}
      >
        <Field label="Name" hint="What contacts read in the preference centre, and what a campaign targets.">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Services news" />
        </Field>
        <Field label="Description" hint="Optional. One line under the name in the preference centre.">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} className="min-h-[64px]" placeholder="Care packages, new services" />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2.5">
          <span className="min-w-0">
            <b className="block text-[13px] text-ink">Show in the preference centre</b>
            <span id={hint} className="block text-[11.5px] text-ink-3">
              Off keeps the topic for campaigns only; contacts cannot choose it.
            </span>
          </span>
          <Switch label="Show in the preference centre" describedBy={hint} checked={shown} onChange={setShown} />
        </div>
      </form>
    </Modal>
  );
}

function DeleteTopic({ topic, onClose }: { topic: Topic; onClose: () => void }) {
  const qc = useQueryClient();
  const title = useId();
  const [busy, run] = useAction();
  const remove = () =>
    void run(
      'delete',
      async () => {
        await deleteTopic(topic.id);
        void qc.invalidateQueries({ queryKey: MK.all });
        onClose();
      },
      'Topic deleted.',
    );
  return (
    <Modal
      title="Delete topic"
      labelledBy={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy === 'delete'} onClick={remove}>
            Delete topic
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[12.5px] text-ink-2">
        <p className="m-0">
          Delete <b className="text-ink">{topic.name}</b>? It has {plural(topic.subscribers_count, 'subscriber')}, and contacts will no longer see it in the preference centre.
        </p>
        <p className="m-0">Campaigns that targeted it keep their history: their sends, reports and consent records stay as they are.</p>
      </div>
    </Modal>
  );
}

/** The preview's foot: the company and its postal address, naming the company once when the address starts with it. */
export function footerLine(company: string | null, address: string | null): string | null {
  const c = company?.trim() || null;
  const a = address?.trim() || null;
  if (!a) return c;
  if (!c || a.toLocaleLowerCase().startsWith(c.toLocaleLowerCase())) return a;
  return `${c} · ${a}`;
}

/**
 * The public preference centre (design P01), drawn from the topics it really shows. Inert: it is a picture of the page,
 * and the same topics are in the table beside it.
 */
function Preview({ topics }: { topics: Topic[] }) {
  const org = useMarketingOrg();
  const companies = useCompanies();
  const settings = useSettings();
  const company = companies.find((c) => c.id === org)?.name ?? companies[0]?.name ?? null;
  const foot = footerLine(company, settings.data?.sending.postal_address ?? null);

  return (
    <Panel title="Preference centre" sub="This is how contacts see it, from the link in every email." bodyClassName="flex flex-col gap-2">
      <div inert className="rounded-[12px] border border-line bg-ground p-3 select-none">
        {company ? (
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-primary text-white">
              <Icon name="building" size={13} />
            </span>
            <span className="truncate">{company}</span>
          </div>
        ) : null}
        <div className="rounded-[12px] border border-line bg-surface p-4">
          <h3 className="m-0 text-[16px] font-bold text-ink">Your email preferences</h3>
          {topics.length ? (
            <ul className="m-0 mt-2 flex list-none flex-col p-0">
              {topics.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px] text-ink">{t.name}</b>
                    {t.description ? <span className="block text-[11.5px] text-ink-3">{t.description}</span> : null}
                  </span>
                  <span aria-hidden className="h-[18px] w-[18px] shrink-0 rounded-[5px] border-2 border-line bg-surface" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 text-[12.5px] text-ink-3">No topic is shown in the preference centre yet, so contacts can only unsubscribe from everything.</p>
          )}
          <div className="mt-3 flex flex-col gap-2">
            {topics.length ? (
              <button type="button" tabIndex={-1} className="h-9 rounded-[8px] bg-primary text-[13px] font-semibold text-white">
                Save preferences
              </button>
            ) : null}
            <button type="button" tabIndex={-1} className="h-9 rounded-[8px] border border-line bg-surface text-[13px] font-semibold text-danger">
              Unsubscribe from all
            </button>
          </div>
          <p className="m-0 mt-3 text-[11.5px] leading-snug text-ink-3">No sign-in needed — this link is signed for each contact. Changes are recorded in the consent ledger.</p>
        </div>
        {foot ? <p className="m-0 mt-2.5 text-[11px] text-ink-3">{foot}</p> : null}
      </div>
      <p className="m-0 text-[11.5px] text-ink-3">
        {topics.length ? 'A preview built from the topics shown in the preference centre; each contact sees their own choices ticked.' : 'A preview. Add a topic, or show one, for contacts to choose here.'}
      </p>
    </Panel>
  );
}
