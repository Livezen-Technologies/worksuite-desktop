import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Avatar, Button, Modal } from '../../../components/ui';
import { createContact, fetchSources, isNotOffered, matchContact, MK, NOT_OFFERED, updateContact, type Basis, type Contact, type ContactInput, type MatchResult } from '../api';
import { BASIS, basisLabel, emailConsent, phoneConsent } from '../lib/consent';
import { phoneKey } from '../lib/dedupe';
import { maskPhone } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Field, Input, Notice } from '../parts';

/**
 * WF-02 · Add or edit a contact (MKT-AUD-01/02). Email or phone is required. A new contact is matched first — email
 * key, then phone key (last 9 digits), then name at organisation — and a match is shown with what would change, to
 * update instead of creating a duplicate; never silently. A new contact takes its first consent per channel with a
 * basis ("unknown" is allowed and keeps it out of sends and calls); later changes are ledger entries made on the
 * contact's page. A suppressed key still saves, and says it cannot be added to sends.
 *
 * Also how a contact is shown in Audience's tables (name, the phone masked where the role says so, suppression).
 */

/* ------------------------------------------------------------------------ *
 * How a contact is shown
 * ------------------------------------------------------------------------ */

/** The name a contact goes by; never blank. */
export function displayName(c: Pick<Contact, 'name' | 'first_name' | 'last_name' | 'email' | 'phone'>): string {
  return c.name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || c.phone || 'Unnamed contact';
}

/** The phone as this person may see it: masked when their role may not edit contacts (MKT-AUD-07). */
export function shownPhone(c: Pick<Contact, 'phone' | 'phone_masked'>): string | null {
  if (!c.phone) return null;
  return c.phone_masked && !c.phone.includes('*') ? maskPhone(c.phone) : c.phone;
}

/** The same number however it is written: by the dedupe key (last 9 digits), or every digit for a short one. */
const samePhone = (a: string, b: string) => (phoneKey(a) ?? a.replace(/\D/g, '')) === (phoneKey(b) ?? b.replace(/\D/g, ''));

/** A small red marker beside a name: "Suppressed", "Do not call". */
export function Marker({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-[4px] bg-danger-bg px-1 py-px text-[10.5px] font-bold whitespace-nowrap text-danger">{children}</span>;
}

/** Avatar, name and email · phone, with the suppression markers (DK02's Contact column). */
export function ContactCell({ c, onOpen }: { c: Contact; onOpen?: () => void }) {
  const name = displayName(c);
  const reach = [c.email, shownPhone(c)].filter(Boolean).join(' · ');
  return (
    <div className="flex min-w-[200px] items-center gap-2.5">
      <Avatar name={name} size={28} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              className="truncate text-left font-semibold text-ink hover:underline"
            >
              {name}
            </button>
          ) : (
            <span className="truncate font-semibold text-ink">{name}</span>
          )}
          {c.email_suppressed ? <Marker>Suppressed</Marker> : null}
          {c.do_not_call ? <Marker>Do not call</Marker> : null}
        </div>
        <div className="truncate text-[11.5px] text-ink-3">{reach || '—'}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * The form and its pure helpers
 * ------------------------------------------------------------------------ */

/** Tags typed as "vendor, Tenders" — trimmed, without repeats; any script is kept as typed. */
export function parseTags(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[,،、，]/)) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** "matched on email key" — the dedupe key a match was found by. */
export function matchedOn(key: MatchResult['key']): string {
  return key === 'email_key' ? 'email key' : key === 'phone_key' ? 'phone key (last 9 digits)' : key === 'name_org' ? 'name at organisation' : 'an existing record';
}

export type ChangeField = 'first_name' | 'last_name' | 'email' | 'phone' | 'organisation' | 'job_title' | 'time_zone' | 'tags' | 'email_consent' | 'phone_consent';

export interface Change {
  field: ChangeField;
  label: string;
  from: string;
  to: string;
}

const sameText = (a: string, b: string) => a.trim() === b.trim();
const sameFolded = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What updating a matched record with the new contact's details would change (WF-02 step 5). A blank field changes
 * nothing; the email and organisation compare without case and the phone by its key; tags are added, never removed;
 * consent counts only where it is granted and the record does not have it yet. The source stays the record's own.
 */
export function changesFor(existing: Contact, input: ContactInput): Change[] {
  const out: Change[] = [];
  const text = (field: ChangeField, label: string, before: string | null, after: string | null | undefined, same: (a: string, b: string) => boolean = sameText) => {
    if (!after?.trim()) return;
    if (before && same(before, after)) return;
    out.push({ field, label, from: before || '—', to: after.trim() });
  };
  text('first_name', 'First name', existing.first_name, input.first_name);
  text('last_name', 'Last name', existing.last_name, input.last_name);
  text('email', 'Email', existing.email, input.email, sameFolded);
  if (!existing.phone_masked) text('phone', 'Phone', existing.phone, input.phone, (a, b) => samePhone(a, b));
  text('organisation', 'Organisation', existing.organisation, input.organisation, sameFolded);
  text('job_title', 'Job title', existing.job_title, input.job_title);
  text('time_zone', 'Time zone', existing.time_zone, input.time_zone);
  const added = (input.tags ?? []).filter((t) => !existing.tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  if (added.length) out.push({ field: 'tags', label: 'Tags', from: existing.tags.join(', ') || '—', to: [...existing.tags, ...added].join(', ') });
  const e = input.consent?.email;
  if (e?.state === 'subscribed' && existing.email_consent !== 'subscribed') out.push({ field: 'email_consent', label: 'Email consent', from: emailConsent(existing.email_consent).label, to: `Subscribed · ${basisLabel(e.basis)}` });
  const p = input.consent?.phone;
  if (p?.state === 'consented' && existing.phone_consent !== 'consented') out.push({ field: 'phone_consent', label: 'Phone consent', from: phoneConsent(existing.phone_consent).label, to: `Consented · ${basisLabel(p.basis)}` });
  return out;
}

/** The whole record as it would be after those changes: the record's own values, the changed ones replaced. */
export function updateFor(existing: Contact, input: ContactInput, changes: Change[]): ContactInput {
  const has = (f: ChangeField) => changes.some((c) => c.field === f);
  const first = has('first_name') ? (input.first_name ?? null) : existing.first_name;
  const last = has('last_name') ? (input.last_name ?? null) : existing.last_name;
  const named = has('first_name') || has('last_name');
  const out: ContactInput = {
    first_name: first,
    last_name: last,
    name: named ? [first, last].filter(Boolean).join(' ') || existing.name : existing.name,
    email: has('email') ? (input.email ?? null) : existing.email,
    organisation: has('organisation') ? (input.organisation ?? null) : existing.organisation,
    organisation_id: has('organisation') ? null : existing.organisation_id,
    job_title: has('job_title') ? (input.job_title ?? null) : existing.job_title,
    tags: has('tags') ? [...existing.tags, ...(input.tags ?? []).filter((t) => !existing.tags.some((x) => x.toLowerCase() === t.toLowerCase()))] : existing.tags,
    source: existing.source,
    time_zone: has('time_zone') ? (input.time_zone ?? null) : existing.time_zone,
    owner_id: existing.owner?.id ?? null,
  };
  // A masked number is not the number: it is left as the server has it.
  if (!existing.phone_masked) out.phone = has('phone') ? (input.phone ?? null) : existing.phone;
  const email = has('email_consent') ? input.consent?.email : undefined;
  const phone = has('phone_consent') ? input.consent?.phone : undefined;
  if (email || phone) out.consent = { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
  return out;
}

const FALLBACK_ZONES = ['UTC', 'Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];

/** Every IANA zone this runtime knows, UTC first; a short list where it cannot say. */
export function timeZones(): string[] {
  try {
    const all = Intl.supportedValuesOf('timeZone');
    if (all.length) return all.includes('UTC') ? all : ['UTC', ...all];
  } catch {
    /* an older runtime */
  }
  return FALLBACK_ZONES;
}

const GRANT_BASIS = BASIS.filter((b) => b.value !== 'unknown');

interface Form {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  organisation: string;
  job_title: string;
  tags: string;
  source: string;
  time_zone: string;
  email_state: 'subscribed' | 'unknown';
  email_basis: Basis;
  email_evidence: string;
  phone_state: 'consented' | 'unknown';
  phone_basis: Basis;
  phone_evidence: string;
}

function formOf(c: Contact | null): Form {
  return {
    first_name: c ? (c.first_name ?? (c.last_name ? '' : c.name)) : '',
    last_name: c?.last_name ?? '',
    email: c?.email ?? '',
    phone: c ? (shownPhone(c) ?? '') : '',
    organisation: c?.organisation ?? '',
    job_title: c?.job_title ?? '',
    tags: (c?.tags ?? []).join(', '),
    source: c ? (c.source ?? '') : 'Manual',
    time_zone: c?.time_zone ?? '',
    email_state: 'unknown',
    email_basis: 'consent',
    email_evidence: '',
    phone_state: 'unknown',
    phone_basis: 'consent',
    phone_evidence: '',
  };
}

const blank = (s: string) => s.trim() || null;

/** What is sent: the whole contact; a new one with its first consent for each channel it has. */
function inputOf(f: Form, contact: Contact | null): ContactInput {
  const first = blank(f.first_name);
  const last = blank(f.last_name);
  const email = blank(f.email);
  const phone = blank(f.phone);
  const organisation = blank(f.organisation);
  const input: ContactInput = {
    first_name: first,
    last_name: last,
    name: [first, last].filter(Boolean).join(' ') || null,
    email,
    organisation,
    // Unchanged, the organisation keeps its link; renamed, the server links it by name.
    organisation_id: contact && organisation === (contact.organisation ?? null) ? contact.organisation_id : null,
    job_title: blank(f.job_title),
    tags: parseTags(f.tags),
    source: blank(f.source),
    time_zone: blank(f.time_zone),
  };
  if (!contact?.phone_masked) input.phone = phone;
  if (contact) {
    input.owner_id = contact.owner?.id ?? null;
    return input;
  }
  const granted = (state: string) => state !== 'unknown';
  input.consent = {
    ...(email ? { email: { state: f.email_state, basis: granted(f.email_state) ? f.email_basis : 'unknown', evidence: granted(f.email_state) ? blank(f.email_evidence) : null } } : {}),
    ...(phone ? { phone: { state: f.phone_state, basis: granted(f.phone_state) ? f.phone_basis : 'unknown', evidence: granted(f.phone_state) ? blank(f.phone_evidence) : null } } : {}),
  };
  return input;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------------ *
 * The editor
 * ------------------------------------------------------------------------ */

export function ContactEditor({ contact, onClose, onSaved }: { contact?: Contact | null; onClose: () => void; onSaved: (c: Contact) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const formId = useId();
  const sourcesId = useId();
  const editing = contact ?? null;
  const [f, setF] = useState<Form>(() => formOf(editing));
  const [match, setMatch] = useState<{ key: MatchResult['key']; contact: Contact; input: ContactInput } | null>(null);
  const [saving, setSaving] = useState(false);
  const sources = useQuery({ queryKey: MK.sources(org), queryFn: ({ signal }) => fetchSources(org, signal), staleTime: 60_000 });
  const currentZone = editing?.time_zone ?? null;
  const zones = useMemo(() => {
    const all = timeZones();
    return currentZone && !all.includes(currentZone) ? [currentZone, ...all] : all;
  }, [currentZone]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const phoneLocked = !!editing?.phone_masked;
  const email = f.email.trim();
  const phone = f.phone.trim();
  const emailBad = email !== '' && !EMAIL_RE.test(email);
  const phoneBad = !phoneLocked && phone !== '' && phone.replace(/\D/g, '').length < 7;
  const reachable = email !== '' || phone !== '';
  const valid = reachable && !emailBad && !phoneBad;
  const changes = match ? changesFor(match.contact, match.input) : [];

  const finish = (c: Contact, done: string) => {
    if (c.email_suppressed || c.do_not_call) {
      const why = c.email_suppressed && c.do_not_call ? 'their email is suppressed and their phone is on the do-not-call list' : c.email_suppressed ? 'their email is suppressed' : 'their phone is on the do-not-call list';
      toast('warning', `${displayName(c)} is saved, but ${why} for this company, so they cannot be added to ${c.email_suppressed ? 'sends' : 'call queues'}.`);
    } else {
      toast('success', done);
    }
    void qc.invalidateQueries({ queryKey: MK.all });
    onSaved(c);
  };

  const fail = (e: unknown) => toast('error', isNotOffered(e) ? NOT_OFFERED : errorMessage(e));

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (editing) {
        finish(await updateContact(editing.id, inputOf(f, editing)), 'Contact saved.');
        return;
      }
      const input = inputOf(f, null);
      const m = await matchContact(org, { email: input.email, phone: input.phone, first_name: input.first_name, last_name: input.last_name, name: input.name, organisation: input.organisation });
      if (m?.contact) {
        setMatch({ key: m.key, contact: m.contact, input });
        return;
      }
      const c = await createContact(org, input);
      finish(c, `${displayName(c)} added.`);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!match || saving) return;
    if (changes.length === 0) {
      onSaved(match.contact);
      return;
    }
    setSaving(true);
    try {
      finish(await updateContact(match.contact.id, updateFor(match.contact, match.input, changes)), `${displayName(match.contact)} updated.`);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const zoneOptions = [{ value: '', label: 'Company default' }, ...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))];

  return (
    <Modal
      title={editing ? `Edit ${displayName(editing)}` : match ? 'Already in Marketing' : 'Add contact'}
      width={640}
      onClose={onClose}
      footer={
        match ? (
          <>
            <Button disabled={saving} onClick={() => setMatch(null)}>
              Back
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void updateExisting()}>
              {changes.length ? 'Update existing' : 'Open existing'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!valid}>
              {editing ? 'Save' : 'Add contact'}
            </Button>
          </>
        )
      }
    >
      {match ? (
        <MatchView match={match} changes={changes} />
      ) : (
        <form
          id={formId}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <Input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} autoFocus autoComplete="off" />
            </Field>
            <Field label="Last name">
              <Input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Email" error={emailBad ? 'Enter an address like name@company.lk.' : null}>
              <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} aria-invalid={emailBad || undefined} autoComplete="off" />
            </Field>
            <Field label="Phone" hint={phoneLocked ? 'Masked for your role; it is left as it is.' : undefined} error={phoneBad ? 'Enter at least 7 digits.' : null}>
              <Input type="tel" value={f.phone} disabled={phoneLocked} onChange={(e) => set('phone', e.target.value)} aria-invalid={phoneBad || undefined} autoComplete="off" />
            </Field>
            <Field label="Organisation">
              <Input value={f.organisation} onChange={(e) => set('organisation', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Job title">
              <Input value={f.job_title} onChange={(e) => set('job_title', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Tags" hint="Separate tags with commas." className="sm:col-span-2">
              <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="vendor, Tenders" autoComplete="off" />
            </Field>
            <Field label="Source">
              <Input value={f.source} onChange={(e) => set('source', e.target.value)} list={sourcesId} autoComplete="off" />
              <datalist id={sourcesId}>
                {(sources.data ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Time zone" hint="Sends at local time and calling hours use it.">
              <Select aria-label="Time zone" value={f.time_zone} onValueChange={(v) => set('time_zone', v)} options={zoneOptions} />
            </Field>
          </div>
          {!reachable ? <p className="-mt-1 text-[12px] text-ink-3">Email or phone is required.</p> : null}
          {editing ? (
            <p className="text-[12px] text-ink-3">Consent is not edited here: record a change on the contact’s page, where it is appended to the consent ledger.</p>
          ) : (
            <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line px-3.5 pt-1 pb-3.5">
              <legend className="px-1 text-[12.5px] font-bold text-ink">First consent</legend>
              <p className="text-[12px] text-ink-3">Written to the consent ledger with its basis. “Unknown” is allowed: the contact is kept, but excluded from sends and calls until consent is recorded.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email consent" hint={email ? undefined : 'Needs an email address.'}>
                  <Select
                    aria-label="Email consent"
                    value={f.email_state}
                    disabled={!email}
                    onValueChange={(v) => set('email_state', v)}
                    options={[
                      { value: 'unknown', label: 'Unknown — excluded from sends' },
                      { value: 'subscribed', label: 'Subscribed' },
                    ]}
                  />
                </Field>
                <Field label="Email basis">
                  <Select aria-label="Email basis" value={f.email_state === 'unknown' ? 'unknown' : f.email_basis} disabled={!email || f.email_state === 'unknown'} onValueChange={(v) => set('email_basis', v)} options={f.email_state === 'unknown' ? BASIS : GRANT_BASIS} />
                </Field>
                {email && f.email_state === 'subscribed' ? (
                  <Field label="Email evidence" className="sm:col-span-2">
                    <Input value={f.email_evidence} onChange={(e) => set('email_evidence', e.target.value)} placeholder="Signed up at the trade fair, 3 Oct" autoComplete="off" />
                  </Field>
                ) : null}
                <Field label="Phone consent" hint={phone ? undefined : 'Needs a phone number.'}>
                  <Select
                    aria-label="Phone consent"
                    value={f.phone_state}
                    disabled={!phone}
                    onValueChange={(v) => set('phone_state', v)}
                    options={[
                      { value: 'unknown', label: 'Unknown — excluded from calls' },
                      { value: 'consented', label: 'Consented' },
                    ]}
                  />
                </Field>
                <Field label="Phone basis">
                  <Select aria-label="Phone basis" value={f.phone_state === 'unknown' ? 'unknown' : f.phone_basis} disabled={!phone || f.phone_state === 'unknown'} onValueChange={(v) => set('phone_basis', v)} options={f.phone_state === 'unknown' ? BASIS : GRANT_BASIS} />
                </Field>
                {phone && f.phone_state === 'consented' ? (
                  <Field label="Phone evidence" className="sm:col-span-2">
                    <Input value={f.phone_evidence} onChange={(e) => set('phone_evidence', e.target.value)} placeholder="Verbal on call #C-2291" autoComplete="off" />
                  </Field>
                ) : null}
              </div>
            </fieldset>
          )}
        </form>
      )}
    </Modal>
  );
}

/** The record the new contact matched, and what updating it would change (WF-02 step 5). */
function MatchView({ match, changes }: { match: { key: MatchResult['key']; contact: Contact }; changes: Change[] }) {
  const m = match.contact;
  return (
    <div className="flex flex-col gap-3.5">
      <Notice tone="warning" icon="users">
        <b className="font-semibold">Already in Marketing — matched on {matchedOn(match.key)}.</b> Update the existing record rather than adding the same person twice.
      </Notice>
      <div className="flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-3">
        <Avatar name={displayName(m)} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-ink">{displayName(m)}</div>
          <div className="truncate text-[12px] text-ink-3">{[m.email ?? 'No email', shownPhone(m) ?? 'No phone'].join(' · ')}</div>
          {m.organisation ? <div className="truncate text-[12px] text-ink-3">{[m.job_title, m.organisation].filter(Boolean).join(' · ')}</div> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[12.5px] font-bold text-ink">{changes.length ? 'What would change' : 'Nothing would change'}</h3>
        {changes.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
            {changes.map((c) => (
              <li key={c.field} className="flex flex-wrap items-baseline gap-x-2 px-3.5 py-2 text-[12.5px]">
                <span className="w-[110px] shrink-0 font-semibold text-ink-2">{c.label}</span>
                <span className="min-w-0 break-words text-ink-3 line-through decoration-ink-3/50">{c.from}</span>
                <span aria-hidden className="text-ink-3">→</span>
                <span className="sr-only">becomes</span>
                <span className="min-w-0 font-medium break-words text-ink">{c.to}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-3">The existing record already has these details. Open it to work with it.</p>
        )}
      </div>
      {m.email_suppressed || m.do_not_call ? (
        <Notice tone="danger">
          {m.email_suppressed ? 'This person’s email is suppressed for the company' : 'This person’s phone is on the do-not-call list'}: updating the record does not lift it, and they stay out of {m.email_suppressed ? 'sends' : 'call queues'}.
        </Notice>
      ) : null}
    </div>
  );
}
