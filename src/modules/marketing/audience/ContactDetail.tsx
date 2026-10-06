import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Menu } from '../../../components/Menu';
import { Select } from '../../../components/Select';
import { Avatar, Button, Chip, cx, Empty, IconButton, Modal } from '../../../components/ui';
import { CallButton } from '../../phone/CallButton';
import {
  archiveContact,
  bulkContacts,
  eraseContact,
  fetchContact,
  fetchContactCalls,
  fetchContactCampaigns,
  fetchContactLedger,
  fetchContacts,
  fetchTimeline,
  handOver,
  mergeContacts,
  MK,
  NOT_OFFERED,
  recordConsent,
  type Basis,
  type CampaignStatus,
  type Channel,
  type Contact,
  type LedgerEntry,
} from '../api';
import { BASIS, basisLabel, CAMPAIGN_STATUS, emailConsent, phoneConsent, type Tone } from '../lib/consent';
import { day, full } from '../lib/format';
import { outcomeInfo, outcomeLabel } from '../lib/outcomes';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, PageBody, PageHeader, Panel, Planned, Row, Status, Table, Tabs, TD, TextArea, TH, useAction } from '../parts';
import { ContactCell, ContactEditor, displayName, Marker, shownPhone } from './ContactEditor';

/**
 * DK03 · Contact (MKT-AUD-06, MKT-CON-01/02, MKT-CRM-01/02, MKT-SUP-01, MKT-AUD-08/09 Target; WF-05, WF-14). Consent
 * per channel derived from the latest ledger entry, lists, segments, owner and the CRM lead; the timeline of sends,
 * opens, clicks, calls, consent changes, imports and hand-overs; the append-only consent ledger. Recording consent
 * appends an entry, never edits one. Suppression is per company by email and phone key. Merge and erase are Target:
 * a server without them says so.
 */
type Tab = 'timeline' | 'ledger' | 'campaigns' | 'calls';
type Open = 'edit' | 'handover' | 'consent' | 'suppress' | 'dnc' | 'merge' | 'erase';

const GRANT_BASIS = BASIS.filter((b) => b.value !== 'unknown');

/** A record that is not there (erased, merged away, or another company's) — not a server without the route. */
const missing = (e: unknown) => e instanceof ApiError && e.status === 404 && !/route/i.test(e.message);

export default function ContactDetail({ id }: { id: number }) {
  const { go } = useTab();
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.contact(org, id), queryFn: ({ signal }) => fetchContact(org, id, signal) });
  if (q.data) return <Detail c={q.data} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb={<Crumb />} title="Contact" back={<IconButton icon="back" label="Back to contacts" onClick={() => go('/marketing/contacts')} />} />
      <PageBody>
        {missing(q.error) ? (
          <Empty
            icon="user-x"
            title="This contact isn’t here"
            hint="It may have been erased or merged into another contact, or it belongs to another company."
            action={
              <Button size="sm" className="mt-1" onClick={() => go('/marketing/contacts')}>
                Back to contacts
              </Button>
            }
          />
        ) : (
          <Loaded q={q} what="This contact">
            {() => null}
          </Loaded>
        )}
      </PageBody>
    </div>
  );
}

function Crumb() {
  const { go } = useTab();
  return (
    <>
      Marketing /{' '}
      <button type="button" className="hover:text-ink hover:underline" onClick={() => go('/marketing/contacts')}>
        Contacts
      </button>
    </>
  );
}

function Detail({ c }: { c: Contact }) {
  const { go } = useTab();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('timeline');
  const [dialog, setDialog] = useState<Open | null>(null);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [busy, run] = useAction();
  const name = displayName(c);
  const close = () => setDialog(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: MK.all });
  const archive = (to: boolean) =>
    void run('archive', async () => {
      await archiveContact(c.id, to);
      toast('success', to ? `${name} archived. Find it under “Archived contacts”.` : `${name} restored.`);
      refresh();
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={<Crumb />}
        back={<IconButton icon="back" label="Back to contacts" onClick={() => go('/marketing/contacts')} />}
        title={name}
        sub={[c.job_title, c.organisation].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <CallAction c={c} />
            <Button icon="zap" onClick={() => setDialog('handover')}>
              Hand over to CRM
            </Button>
            <span ref={moreRef} className="inline-flex">
              <IconButton icon="more" label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="h-8 border border-line bg-surface" />
            </span>
            <Button variant="primary" icon="pen" onClick={() => setDialog('edit')}>
              Edit
            </Button>
          </>
        }
      />
      {menu ? (
        <Menu
          label="More actions"
          anchor={moreRef}
          prefer="bottom"
          align="end"
          width={260}
          onClose={() => setMenu(false)}
          sections={[
            {
              id: 'record',
              items: [
                c.archived_at
                  ? { id: 'restore', label: 'Restore', description: 'Back in Contacts, lists and searches', icon: 'undo', disabled: busy === 'archive', onSelect: () => archive(false) }
                  : { id: 'archive', label: 'Archive', description: 'Hide it from Contacts; consent and suppression stay', icon: 'archive', disabled: busy === 'archive', onSelect: () => archive(true) },
                { id: 'merge', label: 'Merge with another contact…', description: 'Keep both ledgers and timelines', icon: 'merge', onSelect: () => setDialog('merge') },
              ],
            },
            { id: 'erase', items: [{ id: 'erase', label: 'Erase…', description: 'On the person’s request; keeps a hashed suppression key', icon: 'eraser', danger: true, onSelect: () => setDialog('erase') }] },
          ]}
        />
      ) : null}
      <PageBody>
        <div className="mx-auto grid w-full max-w-[1280px] items-start gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          {c.archived_at ? (
            <Notice
              tone="warning"
              icon="archive"
              className="lg:col-span-2"
              action={
                <Button size="sm" loading={busy === 'archive'} onClick={() => archive(false)}>
                  Restore
                </Button>
              }
            >
              This contact was archived on {day(c.archived_at)}. It is hidden from Contacts.
            </Notice>
          ) : null}
          <div className="flex min-w-0 flex-col gap-4">
            <Profile c={c} onConsent={() => setDialog('consent')} />
            <Suppression c={c} onSuppress={() => setDialog('suppress')} onDnc={() => setDialog('dnc')} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel bodyClassName="flex flex-col gap-3 pt-3.5">
              <Tabs label="Contact history" value={tab} onChange={setTab} tabs={TABS} />
              <div role="tabpanel" aria-label={TAB_LABEL[tab]}>
                {tab === 'timeline' ? <Timeline id={c.id} /> : tab === 'ledger' ? <Ledger id={c.id} /> : tab === 'campaigns' ? <Campaigns id={c.id} /> : <Calls id={c.id} />}
              </div>
            </Panel>
            {/* The ledger stays in view under the other tabs; on its own tab it is the tab. */}
            {tab !== 'ledger' ? (
              <Panel title="Consent ledger" action={<span className="pt-0.5 text-[11.5px] text-ink-3">Append-only · entries are never edited</span>} className="overflow-hidden" bodyClassName="px-0 pb-0">
                <Ledger id={c.id} flush />
              </Panel>
            ) : null}
          </div>
        </div>
      </PageBody>

      {dialog === 'edit' ? <ContactEditor contact={c} onClose={close} onSaved={close} /> : null}
      {dialog === 'handover' ? <HandoverDialog c={c} onClose={close} /> : null}
      {dialog === 'consent' ? <ConsentDialog c={c} onClose={close} /> : null}
      {dialog === 'suppress' || dialog === 'dnc' ? <SuppressDialog c={c} kind={dialog} onClose={close} /> : null}
      {dialog === 'merge' ? <MergeDialog c={c} onClose={close} /> : null}
      {dialog === 'erase' ? <EraseDialog c={c} onClose={close} onErased={() => go('/marketing/contacts')} /> : null}
    </div>
  );
}

/** Click-to-call through WorkSuite Phone (MKT-CAL-11) — not for a do-not-call number, nor a masked one. */
function CallAction({ c }: { c: Contact }) {
  if (!c.phone) return null;
  const reason = c.do_not_call ? 'On the do-not-call list' : c.phone_masked ? 'The number is masked for your role' : null;
  if (reason) {
    return (
      <Button icon="phone" disabled title={reason} aria-label={`Call (${reason.toLowerCase()})`}>
        Call
      </Button>
    );
  }
  return <CallButton number={c.phone} contactId={c.id} name={displayName(c)} variant="button" />;
}

const TAB_LABEL: Record<Tab, string> = { timeline: 'Timeline', ledger: 'Consent ledger', campaigns: 'Campaigns', calls: 'Calls' };
const TABS = (Object.keys(TAB_LABEL) as Tab[]).map((id) => ({ id, label: TAB_LABEL[id] }));

/* ------------------------------------------------------------------------ *
 * Left column
 * ------------------------------------------------------------------------ */

function Profile({ c, onConsent }: { c: Contact; onConsent: () => void }) {
  const { go } = useTab();
  const name = displayName(c);
  const e = emailConsent(c.email_consent);
  const p = phoneConsent(c.phone_consent);
  const reach = [c.email, shownPhone(c)].filter(Boolean).join(' · ');
  const topics = (c.topics ?? []).filter((t) => t.subscribed);
  const orgId = c.organisation_id;
  return (
    <Panel bodyClassName="flex flex-col gap-3 pt-4">
      <div className="flex items-start gap-3">
        <Avatar name={name} size={44} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-bold break-words text-ink">{name}</span>
            {c.email_suppressed ? <Marker>Suppressed</Marker> : null}
            {c.do_not_call ? <Marker>Do not call</Marker> : null}
          </div>
          <div className="text-[12px] break-all text-ink-3">{reach || 'No email or phone'}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Status tone={e.tone}>Email: {e.label.toLowerCase()}</Status>
        <Status tone={p.tone}>Phone: {p.label.toLowerCase()}</Status>
        {c.tags.map((t) => (
          <Status key={`tag-${t}`} tone="indigo">
            {t}
          </Status>
        ))}
        {topics.map((t) => (
          <Status key={`topic-${t.id}`} tone="indigo">
            {t.name} topic
          </Status>
        ))}
      </div>
      <div>
        <Row label="Organisation">
          {orgId && c.organisation ? (
            <button type="button" className="text-primary hover:underline" onClick={() => go(`/marketing/organisations/${orgId}`)}>
              {c.organisation}
            </button>
          ) : (
            (c.organisation ?? '—')
          )}
        </Row>
        <Row label="Lists">{c.lists?.length ? c.lists.map((l) => l.name).join(' · ') : '—'}</Row>
        <Row label="Segments">{c.segments?.length ? c.segments.map((s) => `${s.name} (live)`).join(' · ') : '—'}</Row>
        <Row label="Owner">{c.owner?.name ?? '—'}</Row>
        <Row label="Time zone">{c.time_zone ?? 'Company default'}</Row>
        <Row label="CRM lead">{c.crm_lead ? <Mono>{c.crm_lead.number}</Mono> : '—'}</Row>
        <Row label="Source">{c.source ?? '—'}</Row>
      </div>
      <Button icon="shield-check" onClick={onConsent}>
        Record consent
      </Button>
    </Panel>
  );
}

function Suppression({ c, onSuppress, onDnc }: { c: Contact; onSuppress: () => void; onDnc: () => void }) {
  const { go } = useTab();
  return (
    <Panel title="Suppression" sub="Suppression is per company and keyed by email and phone, so it also blocks re-imports.">
      <div className="flex flex-wrap gap-2">
        {c.email_suppressed ? (
          <Status tone="danger">Email suppressed</Status>
        ) : (
          <Button size="sm" icon="x-circle" className="!border-danger/40 !text-danger" disabled={!c.email} title={c.email ? undefined : 'No email address'} onClick={onSuppress}>
            Suppress email
          </Button>
        )}
        {c.do_not_call ? (
          <Status tone="danger">On the do-not-call list</Status>
        ) : (
          <Button size="sm" icon="phone-off" className="!border-danger/40 !text-danger" disabled={!c.phone} title={c.phone ? undefined : 'No phone number'} onClick={onDnc}>
            Do not call
          </Button>
        )}
      </div>
      {c.email_suppressed || c.do_not_call ? (
        <p className="mt-2.5 text-[11.5px] text-ink-3">
          Left out of every {c.email_suppressed && c.do_not_call ? 'send and call' : c.email_suppressed ? 'send' : 'call'}. Lifting a suppression needs a reason and is audited:{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => go('/marketing/consent')}>
            Consent & suppression
          </button>
          .
        </p>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Right column: timeline, ledger, campaigns, calls
 * ------------------------------------------------------------------------ */

const KIND: Record<string, { icon: string; tone: string }> = {
  send: { icon: 'send', tone: 'bg-subtle text-ink-2' },
  open: { icon: 'mail-open', tone: 'bg-selection text-primary' },
  click: { icon: 'link', tone: 'bg-selection text-primary' },
  call: { icon: 'phone', tone: 'bg-subtle text-ink-2' },
  consent: { icon: 'shield-check', tone: 'bg-success-bg text-success' },
  import: { icon: 'upload', tone: 'bg-subtle text-ink-2' },
  handover: { icon: 'zap', tone: 'bg-success-bg text-success' },
  created: { icon: 'user-plus', tone: 'bg-subtle text-ink-2' },
  unsubscribe: { icon: 'bell-off', tone: 'bg-danger-bg text-danger' },
  bounce: { icon: 'alert', tone: 'bg-danger-bg text-danger' },
  note: { icon: 'file-text', tone: 'bg-subtle text-ink-2' },
};

function Timeline({ id }: { id: number }) {
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.timeline(org, id), queryFn: ({ signal }) => fetchTimeline(id, signal) });
  return (
    <Loaded q={q} what="The contact timeline">
      {(rows) =>
        rows.length === 0 ? (
          <Empty icon="history" title="Nothing has happened yet" hint="Sends, opens, clicks, calls, consent changes, imports and hand-overs show here as they happen." />
        ) : (
          <ol className="flex flex-col">
            {rows.map((t) => {
              const k = KIND[t.kind] ?? { icon: 'activity', tone: 'bg-subtle text-ink-2' };
              return (
                <li key={t.id} className="flex gap-3 border-b border-line py-2.5 last:border-b-0">
                  <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', k.tone)}>
                    <Icon name={k.icon} size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold break-words text-ink">{t.title}</div>
                    <div className="text-[11.5px] break-words text-ink-3">{[t.detail, t.actor, full(t.at)].filter(Boolean).join(' · ')}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )
      }
    </Loaded>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A basis code as words: the known ones by their label, any other code made readable ("Import"). */
function basisText(b: string | null): string | null {
  if (!b) return null;
  return BASIS.some((x) => x.value === b) ? basisLabel(b) : capital(b.replace(/_/g, ' '));
}

const GOOD_CHANGES = new Set(['granted', 'opt-in', 'opt_in', 'confirmed', 'subscribed', 'consented']);
const BAD_CHANGES = new Set(['withdrawn', 'opt-out', 'opt_out', 'bounced', 'complained', 'unsubscribed']);

function channelText(e: LedgerEntry): string {
  return e.channel === 'topic' ? `Topic: ${e.topic ?? '—'}` : e.channel === 'email' ? 'Email' : 'Phone';
}

function actorText(e: LedgerEntry): string {
  return e.actor.name ?? (e.actor.kind === 'contact' ? 'Contact' : e.actor.kind === 'system' ? 'System' : '—');
}

/** The append-only consent ledger (MKT-CON-01, C4): every change a new row, none ever edited. */
function Ledger({ id, flush }: { id: number; flush?: boolean }) {
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.ledger(org, id), queryFn: ({ signal }) => fetchContactLedger(id, signal) });
  return (
    <Loaded q={q} what="The consent ledger">
      {(rows) => (
        <div className="flex flex-col gap-2">
          {!flush ? <p className="text-[11.5px] text-ink-3">Append-only · entries are never edited. A correction is a new entry.</p> : null}
          {rows.length === 0 ? (
            <Empty icon="shield-check" title="No consent recorded yet" hint="Without a ledger entry the contact’s consent is unknown, which keeps them out of sends and calls. Record consent with its basis." />
          ) : (
            <Table
              label="Consent ledger"
              className={flush ? '!rounded-none !border-x-0 !border-b-0' : undefined}
              head={
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>Channel</th>
                  <th className={TH}>Change</th>
                  <th className={TH}>Basis / evidence</th>
                  <th className={TH}>By</th>
                </tr>
              }
            >
              {rows.map((e) => {
                const tone = GOOD_CHANGES.has(e.change) ? 'text-success' : BAD_CHANGES.has(e.change) ? 'text-danger' : 'text-ink';
                return (
                  <tr key={e.id}>
                    <td className={cx(TD, 'whitespace-nowrap')}>
                      <Mono className="text-[12px]">{full(e.at)}</Mono>
                    </td>
                    <td className={cx(TD, 'whitespace-nowrap')}>{channelText(e)}</td>
                    <td className={cx(TD, 'font-semibold whitespace-nowrap', tone)}>{e.change.replace(/_/g, ' ')}</td>
                    <td className={cx(TD, 'min-w-[180px] text-ink-2')}>{[basisText(e.basis), e.evidence].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{actorText(e)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
      )}
    </Loaded>
  );
}

const DELIVERY: Record<string, Tone> = { sent: 'success', delivered: 'success', opened: 'success', queued: 'violet', pending: 'violet', scheduled: 'violet', bounced: 'danger', failed: 'danger', suppressed: 'danger', skipped: 'muted' };

function deliveryChip(s: string): { label: string; tone: Tone } {
  const known = CAMPAIGN_STATUS[s as CampaignStatus];
  return known ?? { label: capital(s.replace(/_/g, ' ')), tone: DELIVERY[s] ?? 'muted' };
}

function Campaigns({ id }: { id: number }) {
  const { go } = useTab();
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.contactCampaigns(org, id), queryFn: ({ signal }) => fetchContactCampaigns(id, signal) });
  return (
    <Loaded q={q} what="This contact’s campaigns">
      {(rows) =>
        rows.length === 0 ? (
          <Empty icon="mail" title="No email campaigns yet" hint="Campaigns this contact was sent show here, with what they did with each." />
        ) : (
          <Table
            label="Email campaigns sent to this contact"
            head={
              <tr>
                <th className={TH}>Campaign</th>
                <th className={TH}>Status</th>
                <th className={TH}>Sent</th>
                <th className={TH}>What they did</th>
              </tr>
            }
          >
            {rows.map((r) => {
              const s = deliveryChip(r.status);
              const did = [r.opened && ['Opened', 'success'], r.clicked && ['Clicked', 'indigo'], r.unsubscribed && ['Unsubscribed', 'danger'], r.bounced && ['Bounced', 'danger']].filter(Boolean) as Array<[string, 'success' | 'indigo' | 'danger']>;
              const open = () => go(`/marketing/campaigns/${r.campaign.id}/report`);
              return (
                <tr key={r.campaign.id} onClick={open} className="cursor-pointer hover:bg-subtle/60">
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        open();
                      }}
                      className="text-left font-semibold text-ink hover:underline"
                    >
                      {r.campaign.name}
                    </button>
                  </td>
                  <td className={TD}>
                    <Status tone={s.tone}>{s.label}</Status>
                  </td>
                  <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{day(r.sent_at)}</td>
                  <td className={TD}>
                    {did.length ? (
                      <span className="flex flex-wrap gap-1">
                        {did.map(([label, tone]) => (
                          <Chip key={label} tone={tone}>
                            {label}
                          </Chip>
                        ))}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )
      }
    </Loaded>
  );
}

function Calls({ id }: { id: number }) {
  const { go } = useTab();
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.contactCalls(org, id), queryFn: ({ signal }) => fetchContactCalls(id, signal) });
  return (
    <Loaded q={q} what="This contact’s calls">
      {(rows) =>
        rows.length === 0 ? (
          <Empty icon="phone" title="No calls yet" hint="Attempts from call campaigns show here with their outcome, agent and notes." />
        ) : (
          <Table
            label="Calls with this contact"
            head={
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Campaign</th>
                <th className={TH}>Outcome</th>
                <th className={TH}>Agent</th>
                <th className={cx(TH, 'text-right')}>Attempt</th>
                <th className={TH}>Notes</th>
              </tr>
            }
          >
            {rows.map((a) => {
              const o = outcomeInfo(a.outcome);
              return (
                <tr key={a.id}>
                  <td className={cx(TD, 'whitespace-nowrap')}>
                    <Mono className="text-[12px]">{full(a.at)}</Mono>
                  </td>
                  <td className={TD}>
                    <button type="button" className="text-left text-primary hover:underline" onClick={() => go(`/marketing/calls/${a.campaign.id}`)}>
                      {a.campaign.name}
                    </button>
                  </td>
                  <td className={TD}>{o ? <Status tone={o.tone}>{o.label}</Status> : <span className="text-ink-3">{outcomeLabel(a.outcome)}</span>}</td>
                  <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{a.agent ?? '—'}</td>
                  <td className={cx(TD, 'text-right')}>
                    <Mono>{a.attempt}</Mono>
                  </td>
                  <td className={cx(TD, 'min-w-[160px] text-ink-2')}>{a.notes || '—'}</td>
                </tr>
              );
            })}
          </Table>
        )
      }
    </Loaded>
  );
}

/* ------------------------------------------------------------------------ *
 * Dialogs
 * ------------------------------------------------------------------------ */

function Confirm({ title, children, action, danger, busy, disabled, onConfirm, onClose, width = 480 }: { title: ReactNode; children: ReactNode; action: string; danger?: boolean; busy?: boolean; disabled?: boolean; onConfirm: () => void; onClose: () => void; width?: number }) {
  return (
    <Modal
      title={title}
      width={width}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={disabled} onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">{children}</div>
    </Modal>
  );
}

/** WF-14: to CRM through LeadWriter, channel marketing; LeadWriter decides whether the person is already a lead. */
function HandoverDialog({ c, onClose }: { c: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [busy, run] = useAction();
  const send = () =>
    void run('handover', async () => {
      const r = await handOver(c.id, { notes: notes.trim() || null, owner_id: null });
      toast('success', r.created ? `Handed over as lead ${r.lead_number}.` : `Added an activity to lead ${r.lead_number}.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onClose();
    });
  return (
    <Confirm title="Hand over to CRM" action="Hand over" busy={busy === 'handover'} onConfirm={send} onClose={onClose}>
      <p>{displayName(c)} goes to CRM through LeadWriter with channel marketing. If CRM already knows this person, their lead gets an activity rather than a second lead; the lead number is written back here.</p>
      {c.crm_lead ? (
        <Notice icon="info">
          Already handed over as lead <Mono>{c.crm_lead.number}</Mono>.
        </Notice>
      ) : null}
      <Field label="Notes for sales">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wants a website care quote; call after 2 pm." autoFocus />
      </Field>
    </Confirm>
  );
}

/** WF-05 steps 3 and 6: a change with its basis and evidence, appended to the ledger with this person as the actor. */
function ConsentDialog({ c, onClose }: { c: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<Channel>(c.email || !c.phone ? 'email' : 'phone');
  const [change, setChange] = useState<'granted' | 'withdrawn'>('granted');
  const [basis, setBasis] = useState<Basis>('consent');
  const [evidence, setEvidence] = useState('');
  const [busy, run] = useAction();
  const now = channel === 'email' ? `Email: ${emailConsent(c.email_consent).label.toLowerCase()}` : `Phone: ${phoneConsent(c.phone_consent).label.toLowerCase()}`;
  const reachable = channel === 'email' ? !!c.email : !!c.phone;
  const save = () =>
    void run('consent', async () => {
      await recordConsent(c.id, { channel, change, basis, evidence: evidence.trim() || null });
      toast('success', `${channel === 'email' ? 'Email' : 'Phone'} consent ${change} — added to the ledger.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onClose();
    });
  return (
    <Confirm title="Record consent" action="Add to ledger" busy={busy === 'consent'} disabled={!reachable} onConfirm={save} onClose={onClose} width={520}>
      <p>The change is appended to the consent ledger with you as the actor. Entries are never edited: a correction is a new entry, and the latest one decides the contact’s consent.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Channel" hint={`Now · ${now}`}>
          <Select<Channel>
            aria-label="Channel"
            value={channel}
            onValueChange={setChannel}
            options={[
              { value: 'email', label: 'Email', disabled: !c.email, hint: c.email ? undefined : 'No email address' },
              { value: 'phone', label: 'Phone', disabled: !c.phone, hint: c.phone ? undefined : 'No phone number' },
            ]}
          />
        </Field>
        <Field label="Change">
          <Select<'granted' | 'withdrawn'>
            aria-label="Change"
            value={change}
            onValueChange={setChange}
            options={[
              { value: 'granted', label: 'Granted' },
              { value: 'withdrawn', label: 'Withdrawn' },
            ]}
          />
        </Field>
        <Field label="Basis">
          <Select<Basis> aria-label="Basis" value={basis} onValueChange={setBasis} options={GRANT_BASIS} />
        </Field>
        <Field label="Evidence">
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Verbal on call #C-2291" autoComplete="off" />
        </Field>
      </div>
      {change === 'withdrawn' ? (
        <Notice tone="warning">Withdrawing also suppresses this {channel === 'email' ? 'email address' : 'phone number'} for the whole company, so it leaves every {channel === 'email' ? 'send' : 'call queue'}.</Notice>
      ) : null}
    </Confirm>
  );
}

/** MKT-SUP-01: suppress the email key, or put the phone key on do-not-call, for the whole company. */
function SuppressDialog({ c, kind, onClose }: { c: Contact; kind: 'suppress' | 'dnc'; onClose: () => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const [busy, run] = useAction();
  const email = kind === 'suppress';
  const confirm = () =>
    void run('suppress', async () => {
      await bulkContacts(org, email ? 'suppress_email' : 'do_not_call', [c.id]);
      toast('success', email ? `${c.email ?? 'The email'} is suppressed.` : `${displayName(c)} is on the do-not-call list.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onClose();
    });
  return (
    <Confirm title={email ? 'Suppress email' : 'Do not call'} action={email ? 'Suppress email' : 'Add to do-not-call'} danger busy={busy === 'suppress'} onConfirm={confirm} onClose={onClose}>
      {email ? (
        <p>
          Suppress <b className="font-semibold text-ink">{c.email}</b> for this company? It is left out of every send from now on, and a re-import cannot bring it back. Lifting it later needs a reason.
        </p>
      ) : (
        <p>
          Put <b className="font-semibold text-ink">{shownPhone(c)}</b> on the do-not-call list? Its phone key (last 9 digits) is suppressed for the company: it leaves every call queue now, and a re-import cannot bring it back.
        </p>
      )}
    </Confirm>
  );
}

/** MKT-AUD-08 (Target): two records of one person become one, keeping both ledgers and timelines. */
function MergeDialog({ c, onClose }: { c: Contact; onClose: () => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [other, setOther] = useState<Contact | null>(null);
  const [offered, setOffered] = useState(true);
  const [busy, run] = useAction();
  useEffect(() => {
    const next = text.trim();
    if (next === q) return;
    const t = setTimeout(() => setQ(next), 250);
    return () => clearTimeout(t);
  }, [text, q]);
  const filters = { q, per_page: 8 };
  const found = useQuery({ queryKey: MK.contacts(org, filters), queryFn: ({ signal }) => fetchContacts(org, filters, signal), enabled: q.length >= 2, placeholderData: keepPreviousData });
  const options = q.length >= 2 ? (found.data?.rows ?? []).filter((x) => x.id !== c.id) : [];
  const merge = () =>
    void run('merge', async () => {
      if (!other) return;
      const r = await mergeContacts(c.id, other.id);
      if (!r.offered) {
        setOffered(false);
        toast('warning', r.message);
        return;
      }
      toast('success', `${displayName(other)} merged into ${displayName(c)}.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onClose();
    });
  return (
    <Confirm
      title={
        <span className="flex items-center gap-2">
          Merge with another contact {offered ? null : <Planned />}
        </span>
      }
      action="Merge"
      busy={busy === 'merge'}
      disabled={!other || !offered}
      onConfirm={merge}
      onClose={onClose}
      width={540}
    >
      <p>
        <b className="font-semibold text-ink">{displayName(c)}</b> is kept. The other contact’s consent ledger and timeline join it, and the other record goes.
      </p>
      <Field label="The other contact">
        <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, email or phone" autoFocus autoComplete="off" />
      </Field>
      {q.length >= 2 ? (
        options.length ? (
          <ul role="listbox" aria-label="Contacts found" className="flex max-h-[240px] flex-col overflow-y-auto rounded-[10px] border border-line scroll-thin">
            {options.map((x) => {
              const on = other?.id === x.id;
              return (
                <li key={x.id} role="option" aria-selected={on} className="border-b border-line last:border-b-0">
                  <button type="button" onClick={() => setOther(x)} className={cx('flex w-full items-center gap-2 px-3 py-2 text-left', on ? 'bg-selection' : 'hover:bg-subtle')}>
                    <span className="min-w-0 flex-1">
                      <ContactCell c={x} />
                    </span>
                    {on ? <Icon name="check" size={15} className="shrink-0 text-primary" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : found.isFetching ? (
          <p className="text-[12px] text-ink-3">Searching…</p>
        ) : (
          <p className="text-[12px] text-ink-3">No other contact matches “{q}”.</p>
        )
      ) : null}
      {!offered ? <Notice tone="violet" icon="server">{NOT_OFFERED}</Notice> : null}
    </Confirm>
  );
}

/** MKT-AUD-09 (Target): erase on the person's request, keeping a hashed key so they are not re-imported. */
function EraseDialog({ c, onClose, onErased }: { c: Contact; onClose: () => void; onErased: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [offered, setOffered] = useState(true);
  const [busy, run] = useAction();
  const erase = () =>
    void run('erase', async () => {
      const r = await eraseContact(c.id, reason.trim());
      if (!r.offered) {
        setOffered(false);
        toast('warning', r.message);
        return;
      }
      toast('success', `${displayName(c)} erased. A hashed suppression key is kept, so the person is not re-imported.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onErased();
    });
  return (
    <Confirm
      title={
        <span className="flex items-center gap-2">
          Erase contact {offered ? null : <Planned />}
        </span>
      }
      action="Erase"
      danger
      busy={busy === 'erase'}
      disabled={!reason.trim() || !offered}
      onConfirm={erase}
      onClose={onClose}
    >
      <p>
        Erase <b className="font-semibold text-ink">{displayName(c)}</b> at their request? Their personal details are removed; a hashed suppression key is kept so a later import cannot bring them back. This cannot be undone.
      </p>
      <Field label="Reason" hint="Kept with the audit record.">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Asked by email on 3 Oct 2026 to be forgotten." autoFocus />
      </Field>
      {!offered ? <Notice tone="violet" icon="server">{NOT_OFFERED}</Notice> : null}
    </Confirm>
  );
}
