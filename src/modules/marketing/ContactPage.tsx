import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner, Switch } from '../../components/ui';
import { send } from './api';
import { SAVE_REFUSED, saveServerFile, useMaySave } from './audience-files';
import { ContactSheet } from './audience-contact';
import { act, CHANNELS, ConfirmSheet, countryName, emailWord, MoreMenu, phoneWord, ReasonSheet, Refused, TABLE, TD, TH, Tabs, useLists } from './audience-parts';
import { btn, btnBad, btnPrimary, btnSmall, Card, humanise, Initials, input, Line, PageHeader, Pill } from './parts';
import type { PastCall } from './calls';
import { CHANNEL_WORD, LAWFUL_BASIS, refusal, type Channel, type LawfulBasis, type ContactCampaign, type ContactDetail, type Options, type TimelineEntry } from './types';

type Tab = 'timeline' | 'ledger' | 'campaigns' | 'calls';
type Doing = { kind: 'edit' } | { kind: 'convert' } | { kind: 'delete' } | { kind: 'consent'; channel: Channel; status: 'granted' | 'withdrawn' } | { kind: 'suppress'; channel: 'email' | 'phone' } | { kind: 'erase' } | { kind: 'repermission' } | null;

/** A number as a phone dials it: digits and a leading plus. A masked one ("077 *** 4521") cannot be dialled. */
const dial = (phone: string | null | undefined) => (phone && !phone.includes('*') ? phone.replace(/[^\d+]/g, '') : '');

/**
 * One contact, whole (DK03, the web's W03; MKT-AUD-01, MKT-AUD-06,
 * MKT-CON-01, MKT-CON-04, MKT-CRM-01, MKT-CRM-02, MKT-CAL-11): who they are,
 * what they agreed to and how we know, what they must not be sent, the lists
 * and topics they are on, and everything that has happened to them.
 *
 * Consent is recorded here as a person's deliberate act — somebody asked, and
 * the one recording it says how, with their name on it. That is the only kind
 * of grant the server lets lift an unsubscribe or a do-not-call; a bounce, a
 * complaint or a legal suppression stays whatever is recorded. The ledger is
 * append-only: a correction is a new entry, and no row here can be changed.
 */
export default function ContactPage({ id, options, onBack, onOpen, onCampaign }: { id: number; options: Options; onBack: () => void; onOpen: (id: number) => void; onCampaign: (id: number) => void }) {
  const [tab, setTab] = useState<Tab>('timeline');
  const [doing, setDoing] = useState<Doing>(null);
  const [busy, setBusy] = useState(false);
  /* CON-01: the basis a grant recorded here is kept under. */
  const [basis, setBasis] = useState<LawfulBasis>('consent');
  const maySave = useMaySave();
  const q = useQuery({
    queryKey: ['marketing', 'contact', id],
    queryFn: ({ signal }) => apiGet<ContactDetail>(`/api/marketing/contacts/${id}`, undefined, signal),
    retry: false,
  });
  const c = q.data;

  if (q.isLoading) return <Spinner label="Loading the contact…" />;
  if (!c) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader crumbs={['Contacts']} onCrumb={onBack} title="Contact" />
        <Refused error={q.error} fallback="That contact could not be loaded." onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const company = options.companies.find((co) => co.id === c.org_id);
  const maySuppress = Boolean(company?.can.suppression);
  const number = dial(c.phone);
  const blocked = (ch: Channel) => c.suppressed.find((s) => s.channel === ch);
  const run = async (fn: () => Promise<{ message: string | null }>, fallback: string) => {
    setBusy(true);
    const ok = await act(fn, fallback);
    setBusy(false);
    if (ok) setDoing(null);
    return ok;
  };

  /* Click-to-call (MKT-CAL-11): the WorkSuite phone places it from the person's extension; without one the number is copied. */
  const callThem = async () => {
    if (!number) return;
    try {
      await apiPost('/api/voip/call', { number });
      toast('success', `Calling ${c.phone ?? number} on your WorkSuite phone`);
    } catch {
      try {
        await navigator.clipboard.writeText(c.phone ?? number);
        toast('success', 'No WorkSuite phone connected — number copied');
      } catch {
        toast('error', `No WorkSuite phone connected — call ${c.phone ?? number}`);
      }
    }
  };

  const remove = async () => {
    if (await run(() => send('DELETE', `/api/marketing/contacts/${c.id}`), 'Deleted.')) onBack();
  };

  /* A masked number is not ours to type into the suppression list; the server suppresses the number it holds. */
  const suppress = (channel: 'email' | 'phone', note: string) =>
    channel === 'phone' && c.phone?.includes('*')
      ? run(() => send('POST', '/api/marketing/contacts/bulk', { action: 'suppress', ids: [c.id], value: 'phone' }), 'Suppressed.')
      : run(() => send('POST', '/api/marketing/suppressions', { org_id: c.org_id, channel, value: channel === 'email' ? c.email : c.phone, reason: channel === 'email' ? 'manual' : 'do_not_call', note }), 'Suppressed.');

  const handedOver = Boolean(c.crm_lead) && c.status === 'converted';

  /* CON-11: everything held on them, saved where the person picks. */
  const exportData = async (format: 'json' | 'csv') => {
    if (!maySave) {
      toast('error', SAVE_REFUSED);
      return;
    }
    try {
      const name = await saveServerFile({ method: 'GET', path: `/api/marketing/contacts/${c.id}/export`, query: { format } }, `contact-${c.id}-data.${format}`);
      if (name) toast('success', `Saved ${name}`);
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  const more = [
    { id: 'export-json', label: 'Export their data (JSON)', icon: 'download', onSelect: () => void exportData('json') },
    { id: 'export-csv', label: 'Export their data (CSV)', icon: 'download', onSelect: () => void exportData('csv') },
    ...(c.can.edit && c.email && c.doi_status === 'pending'
      ? [{ id: 'doi', label: 'Resend the confirmation email', icon: 'mail', onSelect: () => void run(() => send('POST', `/api/marketing/contacts/${c.id}/double-opt-in`), 'Confirmation email sent.') }]
      : []),
    ...(c.can.edit && c.email && c.consent.email !== 'withdrawn' && !blocked('email')
      ? [{ id: 'repermission', label: 'Ask again for permission', icon: 'refresh', onSelect: () => setDoing({ kind: 'repermission' }) }]
      : []),
    ...(c.can.delete
      ? [
          { id: 'delete', label: 'Delete contact', icon: 'trash', danger: true, onSelect: () => setDoing({ kind: 'delete' }) },
          { id: 'erase', label: 'Erase on request…', icon: 'alert', danger: true, onSelect: () => setDoing({ kind: 'erase' }) },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Contacts']}
        onCrumb={onBack}
        title={c.name}
        sub={[c.job_title, c.company?.name].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            {c.phone ? (
              <button type="button" className={btn} disabled={!number} title={number ? `Call ${c.phone} on your WorkSuite phone` : 'The number is masked: changing contacts in this company is not yours to do.'} onClick={() => void callThem()}>
                <Icon name="phone" size={15} /> Call
              </button>
            ) : null}
            {c.can.convert && !handedOver ? (
              <button type="button" className={btn} onClick={() => setDoing({ kind: 'convert' })}>
                <Icon name="zap" size={15} /> Hand over to CRM
              </button>
            ) : null}
            {c.can.edit ? (
              <button type="button" className={btnPrimary} onClick={() => setDoing({ kind: 'edit' })}>
                Edit
              </button>
            ) : null}
            <MoreMenu label={`More for ${c.name}`} items={more} />
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Profile c={c} options={options} />

          <Card title="Suppression">
            <p className="m-0 text-[12.5px] text-ink-3">Suppression is per company and keyed by email and phone, so it also blocks re-imports.</p>
            {c.suppressed.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.suppressed.map((s) => (
                  <Pill key={`${s.channel}-${s.reason}`} tone="red">
                    {CHANNEL_WORD[s.channel]}: {s.reason.replace(/_/g, ' ')}
                  </Pill>
                ))}
              </div>
            ) : null}
            {maySuppress ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {c.email && !blocked('email') ? (
                  <button type="button" className={btnBad} onClick={() => setDoing({ kind: 'suppress', channel: 'email' })}>
                    Suppress email
                  </button>
                ) : null}
                {c.phone && !blocked('phone') ? (
                  <button type="button" className={btnBad} onClick={() => setDoing({ kind: 'suppress', channel: 'phone' })}>
                    Do not call
                  </button>
                ) : null}
              </div>
            ) : null}
          </Card>

          <ListsCard c={c} busy={busy} onRun={run} />

          {(c.topics ?? []).length > 0 ? (
            <Card title="Topics">
              <ul className="m-0 flex list-none flex-col p-0">
                {(c.topics ?? []).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 border-b border-line/70 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink">{t.name}</span>
                      {t.description ? <span className="block truncate text-[11.5px] text-ink-3">{t.description}</span> : null}
                    </span>
                    {c.can.edit ? (
                      <Switch checked={t.receives} disabled={busy} label={`${t.name}: hears about it`} onChange={(v) => void run(() => send('POST', `/api/marketing/contacts/${c.id}/topics`, { topic_id: t.id, receive: v }), 'Recorded.')} />
                    ) : (
                      <Pill tone={t.receives ? 'green' : 'amber'}>{t.receives ? 'Hears about it' : 'Opted out'}</Pill>
                    )}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-2 text-[11.5px] text-ink-3">Change one only when they asked. Everybody who may be emailed hears about every topic until they say otherwise, on their preferences page or to you.</p>
            </Card>
          ) : null}
        </div>

        <Card className="min-w-0">
          <Tabs<Tab>
            label="About this contact"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'timeline', label: 'Timeline' },
              { id: 'ledger', label: 'Consent ledger' },
              { id: 'campaigns', label: 'Campaigns' },
              { id: 'calls', label: 'Calls' },
            ]}
          />
          <div role="tabpanel" aria-label={tab} className="pt-3">
            {tab === 'timeline' ? <Timeline c={c} busy={busy} onRun={run} /> : null}
            {tab === 'ledger' ? <Ledger c={c} onRecord={(channel, status) => setDoing({ kind: 'consent', channel, status })} /> : null}
            {tab === 'campaigns' ? <Campaigns id={c.id} onCampaign={onCampaign} /> : null}
            {tab === 'calls' ? <Calls id={c.id} /> : null}
          </div>
        </Card>
      </div>

      {doing?.kind === 'edit' ? <ContactSheet options={options} org={String(c.org_id)} contact={c} onClose={() => setDoing(null)} onSaved={() => setDoing(null)} onOpen={(other) => (setDoing(null), onOpen(other))} /> : null}
      {doing?.kind === 'convert' ? (
        <ConfirmSheet title="Hand over to CRM?" action="Hand over" busy={busy} onClose={() => setDoing(null)} onYes={() => void run(() => send('POST', `/api/marketing/contacts/${c.id}/convert`), 'Handed to CRM.')}>
          A lead is made in CRM with where they came from, their tags and lists, and what they agreed to — or, when CRM already has them, the two are linked and nothing is copied. The lead&apos;s number then shows here.
        </ConfirmSheet>
      ) : null}
      {doing?.kind === 'delete' ? (
        <ConfirmSheet title={`Delete ${c.name}?`} action="Delete" danger busy={busy} onClose={() => setDoing(null)} onYes={() => void remove()}>
          An address or number they unsubscribed or were suppressed on stays suppressed, so adding them again later cannot start marketing to them.
        </ConfirmSheet>
      ) : null}
      {doing?.kind === 'consent' ? (
        <ReasonSheet
          title={`${CHANNEL_WORD[doing.channel]}: ${doing.status === 'granted' ? 'they agreed' : 'they asked to stop'}`}
          intro={
            doing.status === 'granted' ? (
              <>
                Record it only when they said yes themselves. Say how, so anybody asked later can answer: on a call, in an email, at the counter.
                <label className="mt-2.5 flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
                  Lawful basis
                  <Select<string> aria-label="Lawful basis" value={basis} onValueChange={(v) => setBasis(v as LawfulBasis)} options={(Object.keys(LAWFUL_BASIS) as LawfulBasis[]).map((k) => ({ value: k, label: LAWFUL_BASIS[k] }))} className={input} />
                </label>
              </>
            ) : (
              'Their address or number is suppressed for this, so nothing is sent to it again until they agree once more.'
            )
          }
          label={doing.status === 'granted' ? 'How they agreed' : 'How they asked (optional)'}
          placeholder={doing.status === 'granted' ? 'Verbal, on a call on 3 Oct' : 'Replied to the newsletter asking to stop'}
          min={doing.status === 'granted' ? 3 : 0}
          action={doing.status === 'granted' ? 'Record consent' : 'Record withdrawal'}
          danger={doing.status === 'withdrawn'}
          busy={busy}
          onClose={() => setDoing(null)}
          onSubmit={(note) =>
            void run(
              () => send('POST', `/api/marketing/contacts/${c.id}/consent`, { channel: doing.channel, status: doing.status, note, ...(doing.status === 'granted' ? { lawful_basis: basis, consent_wording: note } : {}) }),
              'Recorded.',
            )
          }
        />
      ) : null}
      {doing?.kind === 'repermission' ? (
        <ConfirmSheet title="Ask again for permission?" action="Send" busy={busy} onClose={() => setDoing(null)} onYes={() => void run(() => send('POST', '/api/marketing/contacts/repermission', { ids: [c.id] }), 'Re-permission email sent.')}>
          They get an email asking whether they still want to hear from you, with a button that records their consent. Nothing changes if they do not answer.
        </ConfirmSheet>
      ) : null}
      {doing?.kind === 'erase' ? (
        <ReasonSheet
          title={`Erase ${c.name}?`}
          intro="Their personal data is deleted for good — name, address, numbers, notes, lists, timeline. Only a hashed key is kept so they are never added or imported again. This cannot be undone."
          label="Type ERASE to confirm"
          placeholder="ERASE"
          min={5}
          action="Erase for good"
          danger
          busy={busy}
          onClose={() => setDoing(null)}
          onSubmit={(typed) => {
            if (typed !== 'ERASE') {
              toast('error', 'Nothing was erased: type ERASE to confirm.');
              return;
            }
            void run(() => send('POST', `/api/marketing/contacts/${c.id}/erase`, { confirm: 'ERASE' }), 'Erased.').then((ok) => ok && onBack());
          }}
        />
      ) : null}
      {doing?.kind === 'suppress' ? (
        <ReasonSheet
          title={doing.channel === 'email' ? `Suppress ${c.email}?` : `Do not call ${c.name}?`}
          intro={doing.channel === 'email' ? 'No campaign email goes to this address again, now or whenever they are imported again, until it is lifted with a reason.' : 'The number goes on the do-not-call list: no call campaign rings it.'}
          label="Note (optional)"
          placeholder="Asked on the phone"
          action={doing.channel === 'email' ? 'Suppress email' : 'Do not call'}
          danger
          busy={busy}
          onClose={() => setDoing(null)}
          onSubmit={(note) => void suppress(doing.channel, note)}
        />
      ) : null}
    </div>
  );
}

/** The card at the top left: who they are, how they may be reached, and where they sit. */
function Profile({ c, options }: { c: ContactDetail; options: Options }) {
  const email = emailWord(c, options);
  const phone = phoneWord(c, options);
  const where = [c.city, c.country_name ?? (c.country ? countryName(c.country) : null)].filter(Boolean).join(', ');
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Initials name={c.name} size={44} />
        <div className="min-w-0">
          <b className="block text-[15px] break-words text-ink">{c.name}</b>
          <span className="block text-[12px] break-all text-ink-3">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No address or number'}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone={email.tone}>Email: {email.label.toLowerCase()}</Pill>
        <Pill tone={phone.tone}>Phone: {phone.label.toLowerCase()}</Pill>
        {c.whatsapp && c.consent.whatsapp ? <Pill tone={c.consent.whatsapp === 'granted' ? 'green' : 'red'}>WhatsApp: {c.consent.whatsapp === 'granted' ? 'consented' : 'withdrawn'}</Pill> : null}
      </div>
      {c.tags.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {c.tags.map((t) => (
            <Pill key={t} tone="blue">
              {t}
            </Pill>
          ))}
        </div>
      ) : null}
      <div className="mt-2.5">
        <Line label="Organisation">{c.company?.name ?? '—'}</Line>
        <Line label="Lists">{c.lists.length ? c.lists.map((l) => l.name).join(' · ') : 'None'}</Line>
        <Line label="Status">{c.status_label}</Line>
        <Line label="Owner">{c.owner?.name ?? 'Nobody'}</Line>
        <Line label="Where">{where || '—'}</Line>
        {/* AUD-01: their own zone, else their country's; it decides calling hours and local-time sends. */}
        {c.time_zone ?? c.local_zone ? (
          <Line label="Time zone">
            {c.time_zone ?? c.local_zone}
            {c.local_time ? <span className="text-ink-3"> · {c.local_time} there now</span> : null}
            {!c.time_zone ? <span className="text-ink-3"> (from country)</span> : null}
          </Line>
        ) : null}
        {c.doi_status ? (
          <Line label="Double opt-in">
            <Pill tone={c.doi_status === 'confirmed' ? 'green' : 'amber'}>{c.doi_status === 'confirmed' ? 'Confirmed' : 'Waiting for confirmation'}</Pill>
          </Line>
        ) : null}
        <Line label="Came from">{c.source_label}</Line>
        {c.language ? <Line label="Language">{c.language}</Line> : null}
        {Object.entries(c.source_detail).map(([k, v]) => (
          <Line key={k} label={humanise(k).replace(/^Utm/, 'UTM')}>
            {v}
          </Line>
        ))}
        {Object.entries(c.custom).map(([k, v]) => (
          <Line key={`custom-${k}`} label={k}>
            {v || '—'}
          </Line>
        ))}
        <Line label="CRM lead">{c.crm_lead ? (c.crm_lead.number ?? `#${c.crm_lead.id}`) + (c.crm_lead.status ? ` · ${c.crm_lead.status}` : '') : '—'}</Line>
        <Line label="Added">{dateLabel(c.created_at) || '—'}</Line>
      </div>
    </Card>
  );
}

/** The lists they are on, with the way off each and onto another. */
function ListsCard({ c, busy, onRun }: { c: ContactDetail; busy: boolean; onRun: (fn: () => Promise<{ message: string | null }>, fallback: string) => Promise<boolean> }) {
  const lists = useLists(String(c.org_id));
  const on = new Set(c.lists.map((l) => l.id));
  const addable = (lists.data?.items ?? []).filter((l) => l.org_id === c.org_id && !on.has(l.id));
  return (
    <Card title="Lists">
      {c.lists.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">On no list.</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {c.lists.map((l) => (
          <span key={l.id} className="inline-flex h-6 items-center gap-1 rounded-full bg-subtle px-2 text-[12px] text-ink">
            {l.name}
            {l.archived ? <span className="text-ink-3">(archived)</span> : null}
            {c.can.lists ? (
              <button type="button" aria-label={`Take off ${l.name}`} disabled={busy} className="flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:text-danger" onClick={() => void onRun(() => send('DELETE', `/api/marketing/lists/${l.id}/members`, { ids: [c.id] }), 'Taken off.')}>
                <Icon name="x" size={11} />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {c.can.lists && addable.length > 0 ? (
        <div className="mt-2.5">
          <Select<string>
            aria-label="Add to a list"
            value=""
            placeholder="Add to a list…"
            disabled={busy}
            onValueChange={(v) => void onRun(() => send('POST', `/api/marketing/lists/${v}/members`, { ids: [c.id] }), 'Added.')}
            options={addable.map((l) => ({ value: String(l.id), label: l.name }))}
            className={input}
          />
        </div>
      ) : null}
    </Card>
  );
}

const KIND_ICON: Array<[RegExp, string]> = [
  [/^email_/, 'mail'],
  [/^call/, 'phone'],
  [/^convert/, 'zap'],
  [/^consent/, 'shield-check'],
  [/^(suppressed|unsuppressed)/, 'shield-alert'],
  [/^import/, 'upload'],
  [/^note/, 'file-text'],
  [/^(tags|topics)/, 'tag'],
  [/^owner/, 'user'],
  [/^status/, 'flag'],
];

function TimelineIcon({ kind }: { kind: string }) {
  const name = KIND_ICON.find(([re]) => re.test(kind))?.[1] ?? 'activity';
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-selection text-primary">
      <Icon name={name} size={14} />
    </span>
  );
}

/** Everything that has happened to them, newest first, and a note to add to it. */
function Timeline({ c, busy, onRun }: { c: ContactDetail; busy: boolean; onRun: (fn: () => Promise<{ message: string | null }>, fallback: string) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  const add = async () => {
    if (note.trim() === '') return;
    if (await onRun(() => send('POST', `/api/marketing/contacts/${c.id}/notes`, { note: note.trim() }), 'Noted.')) setNote('');
  };
  return (
    <div className="flex flex-col gap-3">
      {c.can.edit ? (
        <div className="flex items-start gap-2">
          <textarea aria-label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className={cx(input, '!h-auto min-w-0 flex-1 resize-none py-2')} />
          <button type="button" className={btnSmall} disabled={busy || note.trim() === ''} onClick={() => void add()}>
            Add note
          </button>
        </div>
      ) : null}
      {c.timeline.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">Nothing has happened yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {c.timeline.map((t: TimelineEntry) => (
            <li key={t.id} className="flex gap-3 border-b border-line/70 py-2.5 last:border-b-0">
              <TimelineIcon kind={t.kind} />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-semibold break-words text-ink">{t.title}</p>
                {typeof t.meta?.note === 'string' ? <p className="m-0 text-[12.5px] whitespace-pre-line text-ink-2">{t.meta.note}</p> : null}
                <p className="m-0 text-[11.5px] text-ink-3">
                  {t.actor ?? 'The system'} · {dateLabel(t.at)} {timeLabel(t.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * What they agreed to, per channel, and the append-only ledger behind it
 * (MKT-CON-01, MKT-CON-02): the current word is the latest entry, and a change
 * is a new entry with how it was given. No entry is ever edited.
 */
function Ledger({ c, onRecord }: { c: ContactDetail; onRecord: (channel: Channel, status: 'granted' | 'withdrawn') => void }) {
  const reach = (ch: Channel) => (ch === 'email' ? c.email : ch === 'phone' ? c.phone : (c.whatsapp ?? c.phone));
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col rounded-[10px] border border-line p-0" aria-label="Consent now">
        {CHANNELS.map((ch) => {
          const word = c.consent[ch];
          const s = c.suppressed.find((x) => x.channel === ch);
          return (
            <li key={ch} className="flex flex-wrap items-center gap-2 border-b border-line/70 px-3 py-2 text-[13px] last:border-b-0">
              <span className="w-20 font-semibold text-ink">{CHANNEL_WORD[ch]}</span>
              {word === 'granted' ? <Pill tone="green">Agreed</Pill> : word === 'withdrawn' ? <Pill tone="amber">Asked to stop</Pill> : <Pill>Nothing said yet</Pill>}
              {s ? <Pill tone="red">Suppressed: {s.reason.replace(/_/g, ' ')}</Pill> : null}
              {!reach(ch) ? <span className="text-[12px] text-ink-3">No {ch === 'email' ? 'address' : 'number'}</span> : null}
              {c.can.edit && reach(ch) ? (
                <span className="ml-auto flex gap-1.5">
                  {word !== 'granted' ? (
                    <button type="button" className={btnSmall} onClick={() => onRecord(ch, 'granted')}>
                      They agreed
                    </button>
                  ) : null}
                  {word !== 'withdrawn' ? (
                    <button type="button" className={btnSmall} onClick={() => onRecord(ch, 'withdrawn')}>
                      They asked to stop
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[13.5px] font-bold text-ink">Consent ledger</h3>
        <span className="text-[11.5px] text-ink-3">Append-only · entries are never edited</span>
      </div>
      {c.consent_history.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">Nothing recorded yet.</p>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className={cx(TABLE, 'min-w-[560px]')}>
            <thead>
              <tr>
                {['When', 'Channel', 'Change', 'Basis / evidence', 'By'].map((h) => (
                  <th key={h} scope="col" className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.consent_history.map((h) => (
                <tr key={h.id}>
                  <td className={cx(TD, 'font-mono text-[12px] whitespace-nowrap')}>
                    {dateLabel(h.at)} {timeLabel(h.at)}
                  </td>
                  <td className={TD}>{CHANNEL_WORD[h.channel]}</td>
                  <td className={TD}>
                    <Pill tone={h.status === 'granted' ? 'green' : 'amber'}>{h.status}</Pill>
                  </td>
                  <td className={cx(TD, 'text-ink-2')}>
                    {h.lawful_basis ? <b className="mr-1 font-semibold">{LAWFUL_BASIS[h.lawful_basis] ?? h.lawful_basis} ·</b> : null}
                    {h.source_label}
                    {h.topic_id ? <span className="ml-1 text-[11.5px] text-ink-3">(topic)</span> : null}
                    {h.source_ref ? ` · ${h.source_ref}` : ''}
                    {h.note ? <span className="block text-[12px] text-ink-3">“{h.note}”</span> : null}
                    {h.wording && h.wording !== h.note ? <span className="block text-[12px] text-ink-3">Wording: “{h.wording}”</span> : null}
                    {h.evidence ? <span className="block text-[11px] text-ink-3">{h.evidence}</span> : null}
                  </td>
                  <td className={cx(TD, 'text-ink-2')}>{h.actor === 'contact' ? 'The contact' : (h.by ?? 'The system')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The campaigns they were in, as their copy went. A server a part behind has no such list; it says so. */
function Campaigns({ id, onCampaign }: { id: number; onCampaign: (id: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'contact', id, 'campaigns'],
    queryFn: ({ signal }) => apiGet<{ items: ContactCampaign[] }>(`/api/marketing/contacts/${id}/campaigns`, undefined, signal),
    retry: false,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) {
    return q.error instanceof ApiError && q.error.status === 404 ? <p className="m-0 text-[12.5px] text-ink-3">This server does not list a contact&apos;s campaigns yet.</p> : <Refused error={q.error} onRetry={() => void q.refetch()} />;
  }
  const rows = q.data?.items ?? [];
  if (rows.length === 0) return <p className="m-0 text-[12.5px] text-ink-3">Not in any email campaign yet.</p>;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className={cx(TABLE, 'min-w-[520px]')}>
        <thead>
          <tr>
            {['Campaign', 'Their copy', 'Sent', 'What they did'].map((h) => (
              <th key={h} scope="col" className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const did = [r.opened && 'Opened', r.clicked && 'Clicked', r.unsubscribed && 'Unsubscribed', r.bounced && 'Bounced'].filter(Boolean) as string[];
            return (
              <tr key={r.campaign_id}>
                <td className={TD}>
                  <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onCampaign(r.campaign_id)}>
                    {r.name}
                  </button>
                </td>
                <td className={cx(TD, 'text-ink-2')}>{humanise(r.status)}</td>
                <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{dateLabel(r.sent_at) || '—'}</td>
                <td className={TD}>
                  {did.length ? (
                    <span className="flex flex-wrap gap-1">
                      {did.map((w) => (
                        <Pill key={w} tone={w === 'Bounced' || w === 'Unsubscribed' ? 'red' : 'green'}>
                          {w}
                        </Pill>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every call made to them, in a campaign or not, with how it ended. */
function Calls({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ['marketing', 'contact', id, 'calls'],
    queryFn: ({ signal }) => apiGet<{ items: PastCall[] }>(`/api/marketing/contacts/${id}/calls`, undefined, signal),
    retry: false,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Refused error={q.error} fallback={refusal(q.error, 'The calls could not be loaded.')} onRetry={() => void q.refetch()} />;
  const rows = q.data?.items ?? [];
  if (rows.length === 0) return <p className="m-0 text-[12.5px] text-ink-3">Nobody has called them yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((r) => (
        <li key={r.id} className="flex gap-3 border-b border-line/70 py-2.5 last:border-b-0">
          <TimelineIcon kind="call" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-semibold text-ink">
              {r.outcome_label}
              {r.campaign ? <span className="font-normal text-ink-3"> · {r.campaign}</span> : null}
            </p>
            {r.notes ? <p className="m-0 text-[12.5px] whitespace-pre-line text-ink-2">{r.notes}</p> : null}
            <p className="m-0 text-[11.5px] text-ink-3">
              {r.by ?? 'Somebody'} · {dateLabel(r.at)} {timeLabel(r.at)}
              {r.follow_up_at ? ` · call back ${dateLabel(r.follow_up_at)} ${timeLabel(r.follow_up_at)}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

