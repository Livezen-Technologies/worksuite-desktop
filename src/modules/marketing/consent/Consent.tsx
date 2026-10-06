import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, cx, Empty, Modal } from '../../../components/ui';
import {
  addSuppression,
  exportLedgerCsv,
  fetchLedger,
  fetchSuppressions,
  MK,
  NOT_OFFERED,
  removeSuppression,
  useSettings,
  useTopics,
  type Channel,
  type LedgerEntry,
  type LedgerFilters,
  type Suppression,
  type SuppressionFilters,
} from '../api';
import { basisLabel, suppressionReason, type Tone } from '../lib/consent';
import { count, day, full, isoDay } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, PageBody, PageHeader, Pager, Panel, Planned, saveCsv, Status, Table, Tabs, TD, TextArea, TH, useAction, useDebounced } from '../parts';

/**
 * DK12 / W12 · Consent & suppression (MKT-CON-01/02/07/09, MKT-SUP-01…05; WF-05, WF-11; AC-03, AC-13). The company's
 * suppression list — email and phone keys, whatever the reason — the append-only consent ledger, the do-not-call list
 * and the topics contacts choose in the preference centre, as tabs addressed `?tab=suppression|ledger|dnc|topics`.
 *
 * The ledger is evidence (constraint C4): it is read and filtered here, never edited or deleted; a correction is a new
 * entry recorded from the contact. Removing a suppression (MKT-SUP-05) and exporting the ledger (MKT-CON-07) are
 * Target: a server without them says so, and nothing changes.
 */
type TabId = 'suppression' | 'ledger' | 'dnc' | 'topics';
const TAB_IDS: readonly string[] = ['suppression', 'ledger', 'dnc', 'topics'];

// The unfiltered first pages double as the tabs' counts (the same query keys as the tables they head).
const ALL: SuppressionFilters = { type: '', reason: '', q: '', page: 1 };
const DNC: SuppressionFilters = { type: 'phone', reason: 'do_not_call', q: '', page: 1 };
const NO_LEDGER_FILTER: LedgerFilters = { channel: '', from: '', to: '', q: '', page: 1 };

export default function Consent() {
  const org = useMarketingOrg();
  const { query, go } = useTab();
  const asked = query.get('tab') ?? '';
  const tab = (TAB_IDS.includes(asked) ? asked : 'suppression') as TabId;
  const [adding, setAdding] = useState(false);
  const [ledger, setLedger] = useState<LedgerFilters>(NO_LEDGER_FILTER);
  const [busy, run] = useAction();
  const all = useQuery({ queryKey: MK.suppressions(org, ALL), queryFn: ({ signal }) => fetchSuppressions(org, ALL, signal) });
  const dnc = useQuery({ queryKey: MK.suppressions(org, DNC), queryFn: ({ signal }) => fetchSuppressions(org, DNC, signal) });

  // The ledger's own filters when it is open; the whole ledger from the other tabs.
  const exportLedger = () =>
    void run('export', async () => {
      const r = await exportLedgerCsv(org, tab === 'ledger' ? ledger : NO_LEDGER_FILTER);
      if (!r.offered) {
        toast('info', NOT_OFFERED);
        return;
      }
      await saveCsv(`consent-ledger-${isoDay(new Date())}`, r.data);
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Audience"
        title="Consent & suppression"
        sub="Append-only consent ledger and per-company suppression by email or phone key"
        actions={
          <>
            <Button icon="download" loading={busy === 'export'} onClick={exportLedger}>
              Export ledger
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add suppression
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <Tabs<TabId>
            label="Consent and suppression"
            value={tab}
            onChange={(id) => go(`/marketing/consent?tab=${id}`)}
            tabs={[
              { id: 'suppression', label: `Suppression list${all.data ? ` (${count(all.data.total)})` : ''}` },
              { id: 'ledger', label: 'Consent ledger' },
              { id: 'dnc', label: `Do-not-call${dnc.data ? ` (${count(dnc.data.total)})` : ''}` },
              { id: 'topics', label: 'Topics' },
            ]}
          />
          {tab === 'suppression' ? (
            <Suppressions key="all" org={org} base={ALL} />
          ) : tab === 'dnc' ? (
            <Suppressions key="dnc" org={org} base={DNC} />
          ) : tab === 'ledger' ? (
            <Ledger org={org} f={ledger} onChange={setLedger} />
          ) : (
            <TopicsTab />
          )}
          <InfoCards />
        </div>
      </PageBody>
      {adding ? <AddSuppression org={org} initial={tab === 'dnc' ? 'phone' : 'email'} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------------ */

/** Why a key cannot be suppressed as typed; null while empty (Save stays off) or when it will do. */
export function suppressionKeyError(type: Channel, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter an email address, like name@example.lk.';
  return v.replace(/\D/g, '').length >= 9 ? null : 'Enter the whole number: suppression matches its last 9 digits.';
}

const CHANGES: Record<string, { label: string; tone: Tone }> = {
  granted: { label: 'Granted', tone: 'success' },
  'opt-in': { label: 'Opt-in', tone: 'success' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  subscribed: { label: 'Subscribed', tone: 'success' },
  pending: { label: 'Pending', tone: 'violet' },
  withdrawn: { label: 'Withdrawn', tone: 'danger' },
  'opt-out': { label: 'Opt-out', tone: 'danger' },
  unsubscribed: { label: 'Unsubscribed', tone: 'danger' },
  bounced: { label: 'Bounced', tone: 'danger' },
  complained: { label: 'Complained', tone: 'danger' },
};

/** A ledger row's change as a chip: granted, withdrawn, opt-in, opt-out, bounced, complained, pending, confirmed. */
export function ledgerChange(change: string | null | undefined): { label: string; tone: Tone } {
  const raw = (change ?? '').trim();
  return CHANGES[raw.toLowerCase().replace(/_/g, '-')] ?? { label: raw.replace(/[_-]+/g, ' ') || '—', tone: 'muted' };
}

/** Who made the change: the person's name; "Contact" for the preference centre and one-click; "System" for mail reports. */
export function ledgerActor(a: LedgerEntry['actor'] | null | undefined): string {
  if (!a) return '—';
  if (a.kind === 'contact') return 'Contact';
  if (a.kind === 'system') return 'System';
  return a.name?.trim() || 'A WorkSuite user';
}

function channelLabel(e: LedgerEntry): string {
  if (e.channel === 'email') return 'Email';
  if (e.channel === 'phone') return 'Phone';
  return e.topic ? `Topic · ${e.topic}` : 'Topic';
}

/* ------------------------------------------------------------------------ *
 * Suppression list and do-not-call (MKT-SUP-01…05)
 * ------------------------------------------------------------------------ */

function Suppressions({ org, base }: { org: string; base: SuppressionFilters }) {
  const { go } = useTab();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<Suppression | null>(null);
  const term = useDebounced(q.trim());
  const f: SuppressionFilters = { ...base, q: term, page };
  const list = useQuery({ queryKey: MK.suppressions(org, f), queryFn: ({ signal }) => fetchSuppressions(org, f, signal), placeholderData: keepPreviousData });
  const dncOnly = base.reason === 'do_not_call';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative min-w-[220px] flex-1 sm:max-w-[380px]">
          <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <Input
            type="search"
            aria-label={dncOnly ? 'Search the do-not-call list' : 'Search the suppression list'}
            placeholder={dncOnly ? 'Search a phone key' : 'Search an address or phone key'}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </span>
        <span className="ml-auto text-[12px] text-ink-3">{dncOnly ? 'Phone keys match on their last 9 digits, for the whole company.' : 'Email and phone keys, for the whole company.'}</span>
      </div>
      <Loaded q={list} what={dncOnly ? 'The do-not-call list' : 'The suppression list'}>
        {(p) =>
          p.rows.length === 0 ? (
            <div className="rounded-[12px] border border-line bg-surface">
              {term ? (
                <Empty icon="search" title={`Nothing matches “${term}”`} hint="Search by the address, or by the last digits of a phone number." />
              ) : dncOnly ? (
                <Empty icon="phone-off" title="No number is on the do-not-call list" hint="A “Do not call” call outcome adds the number here at once. Add one by hand with Add suppression." />
              ) : (
                <Empty icon="shield-check" title="Nothing is suppressed yet" hint="Unsubscribes, hard bounces, complaints and do-not-call outcomes appear here as they happen. Add a role mailbox or a request by hand with Add suppression." />
              )}
            </div>
          ) : (
            <div className={cx('flex flex-col', list.isPlaceholderData && 'opacity-60')}>
              <Table
                label={dncOnly ? 'Do-not-call list' : 'Suppression list'}
                head={
                  <tr>
                    <th className={TH}>Key</th>
                    <th className={TH}>Type</th>
                    <th className={TH}>Reason</th>
                    <th className={TH}>Source</th>
                    <th className={TH}>Since</th>
                    <th className={TH}>Scope</th>
                    <th className={TH}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                }
              >
                {p.rows.map((s) => {
                  const r = suppressionReason(s.reason);
                  const who = s.contact;
                  return (
                    <tr key={s.id}>
                      <td className={TD}>
                        <Mono className="text-[12px] break-all">{s.key}</Mono>
                        {who ? (
                          <button type="button" className="block text-[11.5px] font-semibold text-primary hover:underline" onClick={() => go(`/marketing/contacts/${who.id}`)}>
                            {who.name}
                          </button>
                        ) : null}
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>{s.type}</td>
                      <td className={TD}>
                        <Status tone={r.tone}>{r.label}</Status>
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>
                        {s.source ?? '—'}
                        {s.note ? <span className="block max-w-[260px] truncate text-[11.5px] text-ink-3" title={s.note}>{s.note}</span> : null}
                      </td>
                      <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{day(s.since)}</td>
                      <td className={cx(TD, 'text-ink-2')}>{s.scope ?? '—'}</td>
                      <td className={cx(TD, 'text-right')}>
                        <Button size="sm" variant="ghost" aria-label={`Remove the suppression of ${s.key}`} onClick={() => setRemoving(s)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pager page={p.page} pages={p.pages} total={p.total} perPage={p.perPage} onPage={setPage} />
            </div>
          )
        }
      </Loaded>
      {removing ? <RemoveSuppression s={removing} onClose={() => setRemoving(null)} /> : null}
    </div>
  );
}

function AddSuppression({ org, initial, onClose }: { org: string; initial: Channel; onClose: () => void }) {
  const qc = useQueryClient();
  const title = useId();
  const [type, setType] = useState<Channel>(initial);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState<'manual' | 'do_not_call'>(initial === 'phone' ? 'do_not_call' : 'manual');
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  const problem = suppressionKeyError(type, value);
  const ready = !!value.trim() && !problem;

  const save = () =>
    void run('add', async () => {
      const key = value.trim();
      const why = type === 'email' ? 'manual' : reason;
      await addSuppression(org, { type, value: key, reason: why, note: note.trim() || null });
      toast('success', why === 'do_not_call' ? `${key} is on the do-not-call list.` : `${key} is suppressed for the whole company.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onClose();
    });

  return (
    <Modal
      title="Add suppression"
      labelledBy={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'add'} disabled={!ready} onClick={save}>
            Add suppression
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select<Channel>
              aria-label="Type"
              value={type}
              onValueChange={(t) => {
                setType(t);
                if (t === 'email') setReason('manual');
              }}
              options={[
                { value: 'email', label: 'Email address' },
                { value: 'phone', label: 'Phone number' },
              ]}
            />
          </Field>
          <Field label="Reason">
            <Select<'manual' | 'do_not_call'>
              aria-label="Reason"
              value={type === 'email' ? 'manual' : reason}
              onValueChange={setReason}
              options={[
                { value: 'manual', label: 'Manual' },
                { value: 'do_not_call', label: 'Do not call', disabled: type === 'email', hint: type === 'email' ? 'Phone numbers only' : undefined },
              ]}
            />
          </Field>
        </div>
        <Field label={type === 'email' ? 'Email address' : 'Phone number'} error={problem} hint={type === 'email' ? 'Blocked for the whole company, whether or not it belongs to a contact.' : 'Matched on its last 9 digits, for the whole company.'}>
          <Input autoFocus inputMode={type === 'email' ? 'email' : 'tel'} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={problem ? true : undefined} className="font-mono" placeholder={type === 'email' ? 'info@example.lk' : '+94 77 123 4567'} />
        </Field>
        <Field label="Note" hint="Optional. Why, and who asked — kept with the suppression.">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-[64px]" />
        </Field>
      </form>
    </Modal>
  );
}

/** MKT-SUP-05 (Target): removal needs a reason, is audited, and needs a manager's permission. */
function RemoveSuppression({ s, onClose }: { s: Suppression; onClose: () => void }) {
  const qc = useQueryClient();
  const title = useId();
  const [reason, setReason] = useState('');
  const [planned, setPlanned] = useState(false);
  const [busy, run] = useAction();
  const r = suppressionReason(s.reason);
  const ready = reason.trim().length > 0 && !planned;

  const remove = () =>
    void run('remove', async () => {
      const res = await removeSuppression(s.id, reason.trim());
      if (!res.offered) {
        setPlanned(true);
        return;
      }
      toast('success', `${s.key} is no longer suppressed.`);
      void qc.invalidateQueries({ queryKey: MK.all });
      onClose();
    });

  return (
    <Modal
      title="Remove suppression"
      labelledBy={title}
      onClose={onClose}
      width={480}
      footer={
        planned ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="danger" loading={busy === 'remove'} disabled={!ready} onClick={remove}>
              Remove suppression
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px] text-ink-2">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-[13px] font-semibold text-ink break-all">{s.key}</Mono>
          <Status tone={r.tone}>{r.label}</Status>
          <span className="text-ink-3">since {day(s.since)}</span>
        </div>
        <p className="m-0">Marketing could reach this key again: campaigns would send to it and call queues could include it. Removal is audited with your reason, and needs a manager’s permission.</p>
        {planned ? (
          <Notice tone="violet" icon="info">
            <span className="flex flex-col items-start gap-1.5">
              <span>Removing a suppression is planned. This WorkSuite server does not offer it yet, so nothing was changed — {s.key} stays suppressed.</span>
              <Planned />
            </span>
          </Notice>
        ) : (
          <Field label="Reason" hint="Required. Kept with the audit record.">
            <TextArea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[72px]" placeholder="The contact asked again in writing on …" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ *
 * Consent ledger (MKT-CON-01/02/07, AC-13)
 * ------------------------------------------------------------------------ */

function Ledger({ org, f, onChange }: { org: string; f: LedgerFilters; onChange: (f: LedgerFilters) => void }) {
  const { go } = useTab();
  const term = useDebounced((f.q ?? '').trim());
  const shown: LedgerFilters = { ...f, q: term };
  const list = useQuery({ queryKey: MK.consentLedger(org, shown), queryFn: ({ signal }) => fetchLedger(org, shown, signal), placeholderData: keepPreviousData });
  const set = (patch: Partial<LedgerFilters>) => onChange({ ...f, page: 1, ...patch });
  const backwards = !!f.from && !!f.to && f.from > f.to;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select<NonNullable<LedgerFilters['channel']>>
          aria-label="Channel"
          value={f.channel ?? ''}
          onValueChange={(channel) => set({ channel })}
          className="w-[150px]"
          options={[
            { value: '', label: 'All channels' },
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone' },
            { value: 'topic', label: 'Topics' },
          ]}
        />
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
          From
          <Input type="date" value={f.from ?? ''} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className="w-[150px]" />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
          To
          <Input type="date" value={f.to ?? ''} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className="w-[150px]" />
        </label>
        <span className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
          <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <Input type="search" aria-label="Search the consent ledger" placeholder="Search a contact or evidence" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} className="pl-8" />
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
          <Icon name="lock" size={13} />
          Append-only · entries are never edited
        </span>
      </div>
      {backwards ? <p className="m-0 text-[12px] text-danger">The start date is after the end date, so nothing can match.</p> : null}
      <Loaded q={list} what="The consent ledger">
        {(p) =>
          p.rows.length === 0 ? (
            <div className="rounded-[12px] border border-line bg-surface">
              <Empty
                icon="history"
                title={f.channel || f.from || f.to || term ? 'No ledger entry matches these filters' : 'The ledger is empty'}
                hint={f.channel || f.from || f.to || term ? 'Widen the dates or clear the search.' : 'Consent recorded on a contact, imports with a consent decision, preference-centre changes and mail reports each add an entry here.'}
              />
            </div>
          ) : (
            <div className={cx('flex flex-col', list.isPlaceholderData && 'opacity-60')}>
              <Table
                label="Consent ledger"
                head={
                  <tr>
                    <th className={TH}>When</th>
                    <th className={TH}>Contact</th>
                    <th className={TH}>Channel</th>
                    <th className={TH}>Change</th>
                    <th className={TH}>Basis / evidence</th>
                    <th className={TH}>By</th>
                  </tr>
                }
              >
                {p.rows.map((e) => {
                  const c = e.contact;
                  const change = ledgerChange(e.change);
                  return (
                    <tr key={e.id}>
                      <td className={cx(TD, 'whitespace-nowrap')}>
                        <Mono className="text-[12px] text-ink-2">{full(e.at)}</Mono>
                      </td>
                      <td className={TD}>
                        {c ? (
                          <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => go(`/marketing/contacts/${c.id}`)}>
                            {c.name}
                          </button>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>{channelLabel(e)}</td>
                      <td className={TD}>
                        <Status tone={change.tone}>{change.label}</Status>
                      </td>
                      <td className={cx(TD, 'max-w-[320px]')}>
                        <span className="block text-ink">{basisLabel(e.basis)}</span>
                        {e.evidence ? (
                          <span className="block truncate text-[11.5px] text-ink-3" title={e.evidence}>
                            {e.evidence}
                          </span>
                        ) : null}
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>{ledgerActor(e.actor)}</td>
                    </tr>
                  );
                })}
              </Table>
              <Pager page={p.page} pages={p.pages} total={p.total} perPage={p.perPage} onPage={(page) => onChange({ ...f, page })} />
            </div>
          )
        }
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Topics (MKT-CON-04)
 * ------------------------------------------------------------------------ */

function TopicsTab() {
  const { go } = useTab();
  const q = useTopics();
  return (
    <Panel
      title="Topics"
      sub="What contacts can choose to hear about in the preference centre linked from every email"
      action={
        <Button size="sm" icon="tag" onClick={() => go('/marketing/topics')}>
          Manage topics
        </Button>
      }
      bodyClassName="px-0 pb-1"
    >
      <Loaded q={q} what="Topics">
        {(topics) =>
          topics.length === 0 ? (
            <Empty icon="tag" title="No topics yet" hint="Create topics such as Services news or Tenders, and target campaigns at a topic. Contacts choose theirs in the preference centre." />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {topics.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[12.5px]">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] text-ink">{t.name}</b>
                    {t.description ? <span className="block truncate text-ink-3">{t.description}</span> : null}
                  </span>
                  {!t.public ? <Status tone="muted">Hidden from the preference centre</Status> : null}
                  <span className="shrink-0 text-right text-ink-2">
                    <Mono className="font-semibold text-ink">{count(t.subscribers_count)}</Mono> {t.subscribers_count === 1 ? 'subscriber' : 'subscribers'}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * The three notes under the tabs
 * ------------------------------------------------------------------------ */

function InfoCards() {
  const settings = useSettings();
  const doubleOptIn = settings.data?.consent.double_opt_in === true;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Info title="How suppression works">Suppression is checked at queue time and again at send time, and survives deleting or re-importing a contact.</Info>
      <Info title="Consent ledger">The ledger records every consent change with channel, basis, evidence and actor. Corrections are new entries, never edits.</Info>
      <Info title="Double opt-in">
        {doubleOptIn ? (
          'Web sign-ups stay pending until the confirmation link is used.'
        ) : (
          <>
            Double opt-in for web sign-ups is planned. Today, form sign-ups are recorded as <b className="text-ink">granted · web form</b>.
            <span className="mt-2 block">
              <Planned />
            </span>
          </>
        )}
      </Info>
    </div>
  );
}

function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[12px] border border-line bg-surface px-4 py-3">
      <h2 className="m-0 text-[13px] font-bold text-ink">{title}</h2>
      <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-2">{children}</p>
    </section>
  );
}
