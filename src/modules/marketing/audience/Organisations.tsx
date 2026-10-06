import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '../../../core/api';
import { call } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, IconButton, Modal } from '../../../components/ui';
import { fetchOrganisation, fetchOrganisations, MK, saveOrganisation, type Organisation, type TimelineEntry } from '../api';
import { emailConsent } from '../lib/consent';
import { ago, count, day, full, plural, share } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, PageBody, PageHeader, Pager, Panel, Row, Status, Table, TD, TH, useAction } from '../parts';
import { ContactCell } from './ContactEditor';

/**
 * Organisations (MKT-AUD-03). The companies contacts work for: a searchable list with each one's contacts and how
 * many are subscribed, and an organisation's page with its contacts and their activity. Contacts link to an
 * organisation by name when they are added or imported; one can also be added here.
 */
export default function Organisations({ id }: { id: number | null }) {
  return id === null ? <OrganisationList /> : <OrganisationPage id={id} />;
}

/** `https://` for a website typed without it; null for something that is not a web address. */
export function websiteUrl(site: string | null | undefined): string | null {
  const s = (site ?? '').trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(url);
    return u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "ceylonagri.lk" — a website as people say it. */
export function websiteHost(site: string): string {
  const url = websiteUrl(site);
  return url ? new URL(url).hostname.replace(/^www\./, '') : site;
}

function openSite(site: string) {
  const url = websiteUrl(site);
  if (url) void call('app:openExternal', { url }).catch(() => toast('error', 'The website could not be opened.'));
}

function OrganisationList() {
  const { go } = useTab();
  const org = useMarketingOrg();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const next = text.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      setQ(next);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [text, q]);
  const list = useQuery({ queryKey: MK.organisations(org, q, page), queryFn: ({ signal }) => fetchOrganisations(org, q, page, signal), placeholderData: keepPreviousData });
  const total = list.data && !q ? list.data.total : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Audience"
        title="Organisations"
        sub={total !== undefined ? `${plural(total, 'organisation')} · contacts link to theirs by name` : 'Contacts link to their organisation by name'}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add organisation
          </Button>
        }
      />
      <PageBody>
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface p-2.5">
            <div className="relative min-w-[200px] flex-1 sm:max-w-[420px]">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-3">
                <Icon name="search" size={14} />
              </span>
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Name, industry or country"
                aria-label="Search organisations"
                className="h-[34px] w-full rounded-[8px] border border-line bg-surface pr-3 pl-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
              />
            </div>
          </div>
          <Loaded q={list} what="Organisations">
            {(data) =>
              data.rows.length === 0 ? (
                <div className="rounded-[12px] border border-line bg-surface">
                  {q ? (
                    <Empty icon="search" title={`No organisation matches “${q}”`} hint="Try part of the name, an industry or a country." />
                  ) : (
                    <Empty
                      icon="building"
                      title="No organisations yet"
                      hint="They appear as contacts are added or imported with an organisation, or add one here."
                      action={
                        <Button size="sm" variant="primary" icon="plus" className="mt-1" onClick={() => setAdding(true)}>
                          Add organisation
                        </Button>
                      }
                    />
                  )}
                </div>
              ) : (
                <div className={cx('flex flex-col transition-opacity', list.isPlaceholderData && 'opacity-60')}>
                  <Table
                    label="Organisations"
                    head={
                      <tr>
                        <th className={TH}>Organisation</th>
                        <th className={TH}>Industry</th>
                        <th className={TH}>Country</th>
                        <th className={cx(TH, 'text-right')}>Contacts</th>
                        <th className={cx(TH, 'text-right')}>Subscribed</th>
                        <th className={TH}>Last activity</th>
                      </tr>
                    }
                  >
                    {data.rows.map((o) => {
                      const open = () => go(`/marketing/organisations/${o.id}`);
                      return (
                        <tr key={o.id} onClick={open} className="cursor-pointer hover:bg-subtle/60">
                          <td className={TD}>
                            <div className="flex min-w-[180px] items-center gap-2.5">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-subtle text-ink-3">
                                <Icon name="building" size={15} />
                              </span>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    open();
                                  }}
                                  className="block max-w-full truncate text-left font-semibold text-ink hover:underline"
                                >
                                  {o.name}
                                </button>
                                {o.website ? <div className="truncate text-[11.5px] text-ink-3">{websiteHost(o.website)}</div> : null}
                              </div>
                            </div>
                          </td>
                          <td className={cx(TD, 'text-ink-2')}>{o.industry ?? '—'}</td>
                          <td className={cx(TD, 'text-ink-2')}>{o.country ?? '—'}</td>
                          <td className={cx(TD, 'text-right')}>
                            <Mono>{count(o.contacts_count)}</Mono>
                          </td>
                          <td className={cx(TD, 'text-right whitespace-nowrap')}>
                            {typeof o.subscribed_count === 'number' ? (
                              <>
                                <Mono>{count(o.subscribed_count)}</Mono>
                                <span className="ml-1.5 text-[11.5px] text-ink-3">{share(o.subscribed_count, o.contacts_count, 0)}</span>
                              </>
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                          <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{o.last_activity_at ? ago(o.last_activity_at) : '—'}</td>
                        </tr>
                      );
                    })}
                  </Table>
                  <Pager page={data.page} pages={data.pages} total={data.total} perPage={data.perPage} onPage={setPage} />
                </div>
              )
            }
          </Loaded>
        </div>
      </PageBody>
      {adding ? (
        <OrganisationEditor
          organisation={null}
          onClose={() => setAdding(false)}
          onSaved={(o) => {
            setAdding(false);
            go(`/marketing/organisations/${o.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function OrganisationPage({ id }: { id: number }) {
  const { go } = useTab();
  const org = useMarketingOrg();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: MK.organisation(org, id), queryFn: ({ signal }) => fetchOrganisation(org, id, signal) });
  const o = q.data;
  const back = <IconButton icon="back" label="Back to organisations" onClick={() => go('/marketing/organisations')} />;
  const crumb = (
    <>
      Marketing /{' '}
      <button type="button" className="hover:text-ink hover:underline" onClick={() => go('/marketing/organisations')}>
        Organisations
      </button>
    </>
  );
  const site = o?.website ?? null;
  // The organisation is not there (removed, or another company's) — not a server without the route.
  const gone = q.error instanceof ApiError && q.error.status === 404 && !/route/i.test(q.error.message);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={crumb}
        back={back}
        title={o?.name ?? 'Organisation'}
        sub={o ? [o.industry, o.country].filter(Boolean).join(' · ') || undefined : undefined}
        actions={
          o ? (
            <>
              {site && websiteUrl(site) ? (
                <Button icon="external" onClick={() => openSite(site)} title={websiteUrl(site) ?? undefined}>
                  {websiteHost(site)}
                </Button>
              ) : null}
              <Button variant="primary" icon="pen" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          ) : null
        }
      />
      <PageBody>
        {gone ? (
          <Empty
            icon="building"
            title="This organisation isn’t here"
            hint="It may have been removed, or it belongs to another company."
            action={
              <Button size="sm" className="mt-1" onClick={() => go('/marketing/organisations')}>
                Back to organisations
              </Button>
            }
          />
        ) : (
          <Loaded q={q} what="This organisation">
            {(d) => (
              <div className="mx-auto grid w-full max-w-[1280px] items-start gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
                <Panel title="Details">
                  <Row label="Industry">{d.industry ?? '—'}</Row>
                  <Row label="Country">{d.country ?? '—'}</Row>
                  <Row label="Website">
                    {site && websiteUrl(site) ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => openSite(site)}>
                        {websiteHost(site)}
                      </button>
                    ) : (
                      (site ?? '—')
                    )}
                  </Row>
                  <Row label="Phone">{d.phone ? <Mono>{d.phone}</Mono> : '—'}</Row>
                  <Row label="Contacts">
                    <Mono>{count(d.contacts_count)}</Mono>
                  </Row>
                  <Row label="Email-subscribed">
                    {typeof d.subscribed_count === 'number' ? (
                      <>
                        <Mono>{count(d.subscribed_count)}</Mono> <span className="text-ink-3">· {share(d.subscribed_count, d.contacts_count)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <Row label="Last activity">{d.last_activity_at ? day(d.last_activity_at) : '—'}</Row>
                </Panel>
                <div className="flex min-w-0 flex-col gap-4">
                  <Panel title="Contacts" sub={plural(d.contacts.length, 'contact')} className="overflow-hidden" bodyClassName="px-0 pb-0">
                    {d.contacts.length === 0 ? (
                      <Empty icon="users" title="No contacts here yet" hint="A contact added or imported with this organisation’s name is linked to it." />
                    ) : (
                      <Table
                        label="Contacts at this organisation"
                        className="!rounded-none !border-x-0 !border-b-0"
                        head={
                          <tr>
                            <th className={TH}>Contact</th>
                            <th className={TH}>Job title</th>
                            <th className={TH}>Email consent</th>
                            <th className={TH}>Last activity</th>
                          </tr>
                        }
                      >
                        {d.contacts.map((c) => {
                          const e = emailConsent(c.email_consent);
                          const open = () => go(`/marketing/contacts/${c.id}`);
                          return (
                            <tr key={c.id} onClick={open} className="cursor-pointer hover:bg-subtle/60">
                              <td className={TD}>
                                <ContactCell c={c} onOpen={open} />
                              </td>
                              <td className={cx(TD, 'text-ink-2')}>{c.job_title ?? '—'}</td>
                              <td className={TD}>
                                <Status tone={e.tone}>{e.label}</Status>
                              </td>
                              <td className={cx(TD, 'max-w-[260px] truncate text-ink-2')}>{c.last_activity ? `${c.last_activity.text} · ${ago(c.last_activity.at)}` : '—'}</td>
                            </tr>
                          );
                        })}
                      </Table>
                    )}
                  </Panel>
                  <Panel title="Activity">
                    <Activity rows={d.activity} />
                  </Panel>
                </div>
              </div>
            )}
          </Loaded>
        )}
      </PageBody>
      {editing && o ? <OrganisationEditor organisation={o} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
    </div>
  );
}

function Activity({ rows }: { rows: TimelineEntry[] }) {
  if (rows.length === 0) return <Empty icon="history" title="No activity yet" hint="Sends, opens, calls and hand-overs of its contacts show here." />;
  return (
    <ol className="flex flex-col">
      {rows.map((t) => (
        <li key={t.id} className="flex gap-3 border-b border-line py-2.5 last:border-b-0">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold break-words text-ink">{t.title}</div>
            <div className="text-[11.5px] break-words text-ink-3">{[t.detail, t.actor, full(t.at)].filter(Boolean).join(' · ')}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

type OrgFields = { name: string; industry: string; country: string; website: string; phone: string };

function OrganisationEditor({ organisation, onClose, onSaved }: { organisation: Organisation | null; onClose: () => void; onSaved: (o: Organisation) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const [f, setF] = useState<OrgFields>({
    name: organisation?.name ?? '',
    industry: organisation?.industry ?? '',
    country: organisation?.country ?? '',
    website: organisation?.website ?? '',
    phone: organisation?.phone ?? '',
  });
  const [busy, run] = useAction();
  const formId = useId();
  const set = (k: keyof OrgFields, v: string) => setF((x) => ({ ...x, [k]: v }));
  const siteBad = f.website.trim() !== '' && !websiteUrl(f.website);
  const valid = f.name.trim() !== '' && !siteBad;
  const save = () =>
    void run('save', async () => {
      if (!valid) return;
      const o = await saveOrganisation(org, organisation?.id ?? null, {
        name: f.name.trim(),
        industry: f.industry.trim() || null,
        country: f.country.trim() || null,
        website: f.website.trim() || null,
        phone: f.phone.trim() || null,
      });
      toast('success', organisation ? 'Organisation saved.' : `${o.name} added.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onSaved(o);
    });
  return (
    <Modal
      title={organisation ? `Edit ${organisation.name}` : 'Add organisation'}
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy === 'save'} disabled={!valid}>
            {organisation ? 'Save' : 'Add organisation'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Field label="Name" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label="Industry">
          <Input value={f.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Agriculture" autoComplete="off" />
        </Field>
        <Field label="Country">
          <Input value={f.country} onChange={(e) => set('country', e.target.value)} placeholder="Sri Lanka" autoComplete="off" />
        </Field>
        <Field label="Website" error={siteBad ? 'Enter a web address like ceylonagri.lk.' : null}>
          <Input value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="ceylonagri.lk" aria-invalid={siteBad || undefined} autoComplete="off" />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" />
        </Field>
      </form>
    </Modal>
  );
}
