import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet } from '../../core/api';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { SAVE_REFUSED, saveServerFile, useMaySave } from './audience-files';
import { act, companyName, firstCompany, may, Pager, ReasonSheet, Refused, SearchField, TABLE, TD, TH, Tabs, useDebounced } from './audience-parts';
import { btn, btnPrimary, btnSmall, Card, Field, input, n, PageHeader, Pill, Planned, Sheet, type PillTone } from './parts';
import { RepermissionCard } from './email-governance';
import type { ConsentTab } from './routes';
import Topics from './Topics';
import { CHANNEL_WORD, companiesWhere, refusal, type LedgerEntry, type Options, type Suppressed } from './types';

const PER = 50;

interface LedgerFilter {
  channel: string;
  status: string;
  q: string;
  from: string;
  to: string;
}

const REASON_TONE: Record<string, PillTone> = { unsubscribed: 'blue', hard_bounce: 'red', complaint: 'red', do_not_call: 'amber', manual: 'slate', legal: 'violet', invalid_email: 'amber', invalid_phone: 'amber' };

/**
 * Consent & suppression (DK12, the web's W12; MKT-CON-01, MKT-CON-07,
 * MKT-SUP-01 – MKT-SUP-05): the addresses and numbers nothing is sent to, the
 * append-only ledger of every consent given and withdrawn, the do-not-call
 * list, and the topics people choose between.
 *
 * Suppression is kept by the address or number itself, so it outlives the
 * contact — a person deleted and imported again next month is still
 * unsubscribed. Lifting one asks why, and the server keeps the reason with
 * the record. The ledger is never edited: a correction is a new entry, made
 * on the contact.
 */
export default function Consent({ org, options, tab, onTab, onContact, onCampaign }: { org: string; options: Options; tab: ConsentTab; onTab: (t: ConsentTab) => void; onContact: (id: number) => void; onCampaign?: (id: number) => void }) {
  const maySave = useMaySave();
  const [adding, setAdding] = useState(false);
  const [ledger, setLedger] = useState<LedgerFilter>({ channel: '', status: '', q: '', from: '', to: '' });
  const suppressedCount = useCount(org, {});
  const dncCount = useCount(org, { channel: 'phone', reason: 'do_not_call' });
  const count = (v: number | undefined) => (v === undefined ? '' : ` (${n(v)})`);

  const exportLedger = async () => {
    try {
      const name = await saveServerFile({ method: 'GET', path: '/api/marketing/consents/export', query: withOrg(org, { ...ledger }) }, 'consent-ledger.csv');
      if (name) toast('success', `Saved ${name}.`);
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Audience']}
        title="Consent & suppression"
        sub="Append-only consent ledger and per-company suppression by email or phone key"
        actions={
          <>
            {may(options, 'export') ? (
              <button type="button" className={btn} disabled={!maySave} title={maySave ? 'Save the consent ledger, as filtered, as a CSV file' : SAVE_REFUSED} onClick={() => void exportLedger()}>
                <Icon name="download" size={15} /> Export ledger
              </button>
            ) : null}
            {may(options, 'suppression') ? (
              <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
                <Icon name="plus" size={15} /> Add suppression
              </button>
            ) : null}
          </>
        }
      />

      <Tabs<ConsentTab>
        label="Consent and suppression"
        value={tab}
        onChange={onTab}
        tabs={[
          { id: 'suppression', label: `Suppression list${count(suppressedCount)}` },
          { id: 'ledger', label: 'Consent ledger' },
          { id: 'dnc', label: `Do-not-call${count(dncCount)}` },
          { id: 'topics', label: 'Topics' },
        ]}
      />

      <div role="tabpanel" aria-label={tab}>
        {tab === 'suppression' ? <SuppressionList key="all" org={org} options={options} onContact={onContact} /> : null}
        {tab === 'dnc' ? <SuppressionList key="dnc" org={org} options={options} onContact={onContact} dnc /> : null}
        {tab === 'ledger' ? <Ledger org={org} options={options} filter={ledger} onFilter={setLedger} onContact={onContact} /> : null}
        {tab === 'topics' ? <Topics org={org} options={options} embedded /> : null}
      </div>

      {tab !== 'topics' ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Card title="How suppression works">
            <p className="m-0 text-[12.5px] leading-[1.55] text-ink-2">
              Suppression is checked at queue time <i>and</i> again at send time, and survives deleting or re-importing a contact.
            </p>
          </Card>
          <Card title="Consent ledger">
            <p className="m-0 text-[12.5px] leading-[1.55] text-ink-2">The ledger records every consent change with channel, basis, evidence and actor. Corrections are new entries, never edits.</p>
          </Card>
          <Card title="Double opt-in">
            <p className="m-0 text-[12.5px] leading-[1.55] text-ink-2">
              Double opt-in for web sign-ups is planned. Today, form sign-ups are recorded as <b>granted · web form</b>.
            </p>
            <div className="mt-2">
              <Planned />
            </div>
          </Card>
          <RepermissionCard orgId={org ? Number(org.split(',')[0]) : (companiesWhere(options, 'campaign_create')[0]?.id ?? null)}
            canCreate={companiesWhere(options, 'campaign_create').length > 0} onOpen={onCampaign} />
        </div>
      ) : null}

      {adding ? <AddSuppression org={org} options={options} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/** How many a suppression filter holds, for a tab's label; nothing when the server does not say. */
function useCount(org: string, extra: Record<string, string>): number | undefined {
  const q = useQuery({
    queryKey: ['marketing', 'suppressions', org, 'count', extra],
    queryFn: ({ signal }) => apiGet<{ total?: number }>('/api/marketing/suppressions', withOrg(org, { ...extra, per_page: 1 }), signal),
    retry: false,
  });
  return q.data?.total;
}

/** The suppression list — or, with `dnc`, the numbers on the do-not-call list — with a way to lift one, giving why. */
function SuppressionList({ org, options, onContact, dnc = false }: { org: string; options: Options; onContact: (id: number) => void; dnc?: boolean }) {
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 300);
  const [channel, setChannel] = useState('');
  const [reason, setReason] = useState('');
  const key = JSON.stringify([org, q, channel, reason]);
  const [paging, setPaging] = useState({ key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const [lifting, setLifting] = useState<Suppressed | null>(null);
  const [busy, setBusy] = useState(false);
  const filter = dnc ? { channel: 'phone', reason: 'do_not_call' } : { channel, reason };
  const list = useQuery({
    queryKey: ['marketing', 'suppressions', org, filter, q, page],
    queryFn: ({ signal }) => apiGet<{ items: Suppressed[]; total: number }>('/api/marketing/suppressions', withOrg(org, { ...filter, q, page, per_page: PER }), signal),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];

  const lift = async (s: Suppressed, why: string) => {
    setBusy(true);
    if (await act(() => send('DELETE', `/api/marketing/suppressions/${s.id}`, { reason: why }), 'Lifted.')) setLifting(null);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={typed} onChange={setTyped} label={dnc ? 'Search the do-not-call list' : 'Search suppressions'} placeholder={dnc ? 'Number' : 'Address or number'} className="w-full max-w-[280px]" />
        {!dnc ? (
          <>
            <Select<string> aria-label="Type" value={channel} onValueChange={setChannel} className={cx('w-auto', channel && 'bg-selection')} options={[{ value: '', label: 'Every type' }, ...options.channels]} />
            <Select<string> aria-label="Reason" value={reason} onValueChange={setReason} className={cx('w-auto', reason && 'bg-selection')} options={[{ value: '', label: 'Any reason' }, ...options.reasons]} />
          </>
        ) : null}
      </div>
      <section aria-label={dnc ? 'Do-not-call list' : 'Suppression list'} className="min-w-0 overflow-hidden rounded-[12px] border border-line bg-surface">
        {list.isLoading ? <Spinner /> : null}
        {list.error && !list.data ? (
          <div className="p-3">
            <Refused error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : null}
        {list.data && rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="m-0 text-[14px] font-semibold text-ink">{q || channel || reason ? 'Nothing matches.' : dnc ? 'Nobody is on the do-not-call list.' : 'Nothing is suppressed.'}</p>
            <p className="m-0 mt-1 text-[12.5px] text-ink-3">Addresses and numbers land here when somebody unsubscribes or asks not to be called, when mail bounces or is reported, or when you add them.</p>
          </div>
        ) : null}
        {rows.length ? (
          <div className="overflow-x-auto scroll-thin">
            <table className={cx(TABLE, 'min-w-[820px]')}>
              <thead>
                <tr>
                  {['Key', 'Type', 'Reason', 'Source', 'Since', 'Scope', 'Contact'].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={TH}>
                    <span className="sr-only">Lift</span>
                  </th>
                </tr>
              </thead>
              <tbody className={cx(list.isPlaceholderData && 'opacity-60')}>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className={cx(TD, 'font-mono text-[12px] break-all')}>{s.value}</td>
                    <td className={cx(TD, 'text-ink-2')}>{s.channel}</td>
                    <td className={TD}>
                      <Pill tone={REASON_TONE[s.reason] ?? 'slate'}>{s.reason_label}</Pill>
                    </td>
                    <td className={cx(TD, 'max-w-[220px] text-ink-2')}>{[s.note, s.by].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{dateLabel(s.created_at) || '—'}</td>
                    <td className={cx(TD, 'text-ink-2')}>{companyName(options, s.org_id)}</td>
                    <td className={TD}>
                      {s.contact ? (
                        <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onContact(s.contact!.id)}>
                          {s.contact.name}
                        </button>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className={cx(TD, 'text-right')}>
                      {may(options, 'suppression', s.org_id) ? (
                        <button type="button" className={btnSmall} onClick={() => setLifting(s)} aria-label={`Lift the suppression on ${s.value}`}>
                          Lift
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data && list.data.total > PER ? <Pager page={page} per={PER} total={list.data.total} onPage={(p) => setPaging({ key, page: p })} /> : null}
      </section>

      {lifting ? (
        <ReasonSheet
          title={`Lift the suppression on ${lifting.value}?`}
          intro={
            lifting.reason === 'unsubscribed' || lifting.reason === 'do_not_call'
              ? 'They asked not to be contacted. Lift it only if they have asked to hear from you again — recording their consent on the contact lifts it for you, with the evidence.'
              : 'Messages may be sent to it again. The contacts it touched keep their status until somebody changes it, and consent has to be given again.'
          }
          label="Why it is lifted"
          placeholder="They wrote asking to hear from us again"
          min={3}
          action="Lift it"
          danger
          busy={busy}
          onClose={() => setLifting(null)}
          onSubmit={(why) => void lift(lifting, why)}
        />
      ) : null}
    </div>
  );
}

/**
 * The consent ledger across contacts (MKT-CON-01, MKT-CON-07): every consent
 * given or withdrawn, by whom, on what basis and when. Read-only, by design.
 */
function Ledger({ org, options, filter, onFilter, onContact }: { org: string; options: Options; filter: LedgerFilter; onFilter: (f: LedgerFilter) => void; onContact: (id: number) => void }) {
  const [typed, setTyped] = useState(filter.q);
  const q = useDebounced(typed.trim(), 300);
  const asked = { ...filter, q };
  const key = JSON.stringify([org, asked]);
  const [paging, setPaging] = useState({ key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const set = (k: keyof LedgerFilter, v: string) => onFilter({ ...filter, [k]: v });
  const list = useQuery({
    queryKey: ['marketing', 'consents', org, asked, page],
    queryFn: ({ signal }) => apiGet<{ items: LedgerEntry[]; total: number }>('/api/marketing/consents', withOrg(org, { ...asked, page, per_page: PER }), signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const rows = list.data?.items ?? [];
  const missing = list.error instanceof ApiError && list.error.status === 404;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SearchField value={typed} onChange={(v) => (setTyped(v), onFilter({ ...filter, q: v.trim() }))} label="Search the ledger" placeholder="Name, email or phone" className="w-full max-w-[260px]" />
        <Select<string> aria-label="Channel" value={filter.channel} onValueChange={(v) => set('channel', v)} className={cx('w-auto', filter.channel && 'bg-selection')} options={[{ value: '', label: 'Every channel' }, ...options.channels]} />
        <Select<string>
          aria-label="Change"
          value={filter.status}
          onValueChange={(v) => set('status', v)}
          className={cx('w-auto', filter.status && 'bg-selection')}
          options={[{ value: '', label: 'Granted or withdrawn' }, { value: 'granted', label: 'Granted' }, { value: 'withdrawn', label: 'Withdrawn' }]}
        />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          From
          <input type="date" className={cx(input, 'w-[150px]')} value={filter.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          To
          <input type="date" className={cx(input, 'w-[150px]')} value={filter.to} onChange={(e) => set('to', e.target.value)} />
        </label>
      </div>
      <section aria-label="Consent ledger" className="min-w-0 overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
          <h2 className="m-0 text-[14px] font-bold text-ink">Consent ledger</h2>
          <span className="text-[11.5px] text-ink-3">Append-only · entries are never edited</span>
        </div>
        {list.isLoading ? <Spinner /> : null}
        {missing ? <p className="m-0 px-4 pb-4 text-[12.5px] text-ink-3">This server does not list the ledger across contacts yet. Each contact&apos;s own ledger is on their page.</p> : null}
        {list.error && !missing && !list.data ? (
          <div className="px-3 pb-3">
            <Refused error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : null}
        {list.data && rows.length === 0 ? <p className="m-0 px-4 pb-4 text-[12.5px] text-ink-3">Nothing recorded matches.</p> : null}
        {rows.length ? (
          <div className="overflow-x-auto scroll-thin">
            <table className={cx(TABLE, 'min-w-[820px]')}>
              <thead>
                <tr>
                  {['When', 'Contact', 'Channel', 'Change', 'Basis / evidence', 'By', 'Scope'].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={cx(list.isPlaceholderData && 'opacity-60')}>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td className={cx(TD, 'font-mono text-[12px] whitespace-nowrap')}>
                      {dateLabel(h.at)} {timeLabel(h.at)}
                    </td>
                    <td className={TD}>
                      {h.contact ? (
                        <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onContact(h.contact!.id)}>
                          {h.contact.name}
                        </button>
                      ) : (
                        <span className="text-ink-3">Deleted contact</span>
                      )}
                    </td>
                    <td className={TD}>{CHANNEL_WORD[h.channel] ?? h.channel}</td>
                    <td className={TD}>
                      <Pill tone={h.status === 'granted' ? 'green' : 'amber'}>{h.status}</Pill>
                    </td>
                    <td className={cx(TD, 'max-w-[280px] text-ink-2')}>
                      {h.source_label}
                      {h.source_ref ? ` · ${h.source_ref}` : ''}
                      {h.note ? <span className="block text-[12px] text-ink-3">“{h.note}”</span> : null}
                    </td>
                    <td className={cx(TD, 'text-ink-2')}>{h.by ?? 'The system'}</td>
                    <td className={cx(TD, 'text-ink-2')}>{companyName(options, h.org_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data && list.data.total > PER ? <Pager page={page} per={PER} total={list.data.total} onPage={(p) => setPaging({ key, page: p })} /> : null}
      </section>
    </div>
  );
}

/** An address or number suppressed by hand: a role mailbox, or somebody who asked by phone. */
function AddSuppression({ org, options, onClose }: { org: string; options: Options; onClose: () => void }) {
  const managers = companiesWhere(options, 'suppression');
  const [orgId, setOrgId] = useState(firstCompany(options, 'suppression', org));
  const [channel, setChannel] = useState('email');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('manual');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await send('POST', '/api/marketing/suppressions', { org_id: Number(orgId), channel, value: value.trim(), reason, note });
      toast('success', r.message ?? 'Suppressed.');
      await refreshMarketing();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Add suppression"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || value.trim() === '' || orgId === ''} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Suppress'}
          </button>
        </>
      }
    >
      {managers.length > 1 ? (
        <Field label="Company">
          <Select<string> aria-label="Company" value={orgId} placeholder="Which company?" onValueChange={setOrgId} options={managers.map((c) => ({ value: String(c.id), label: c.name }))} className={input} />
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select<string> aria-label="Type" value={channel} onValueChange={setChannel} options={options.channels} className={input} />
        </Field>
        <Field label="Reason">
          <Select<string> aria-label="Reason" value={reason} onValueChange={setReason} options={options.reasons} className={input} />
        </Field>
      </div>
      <Field label={channel === 'email' ? 'Email address' : 'Number'}>
        <input autoFocus className={input} type={channel === 'email' ? 'email' : 'tel'} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label="Note">
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why, in a few words" />
      </Field>
      <p className="m-0 text-[12px] text-ink-3">Any contact with it stops being marketed to on this channel, now and whenever they are added again.</p>
    </Sheet>
  );
}
