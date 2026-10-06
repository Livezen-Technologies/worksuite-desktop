import { useState, type ReactNode } from 'react';
import { ApiError, apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { refreshMarketing, send } from './api';
import { CountrySelect, firstCompany, useMeId } from './audience-parts';
import { btn, btnPrimary, Field, input, Sheet } from './parts';
import { companiesWhere, fieldErrors, peopleOf, refusal, type Channel, type Contact, type ContactRow, type Options } from './types';

/**
 * Adding a contact, or changing one (MKT-AUD-01), in a sheet over the list or
 * the contact's page — the web's ContactForm, field for field.
 *
 * Only the reach needs saying — an address or a number; everything else can
 * follow. The server says what is wrong with a value, beside it, and whether
 * the person is somebody already here (MKT-AUD-02): then "Open them" goes to
 * the contact they already are, rather than making a second.
 */

/** What the form holds: text as typed, and the company it is for. */
export interface Draft {
  org_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  whatsapp: string;
  job_title: string;
  company: string;
  country: string;
  city: string;
  industry: string;
  language: string;
  owner_id: string;
  status: string;
  source_channel: string;
  tags: string;
  /** For a new contact only: what they agreed to. A change of mind on an existing one is recorded as consent, with a note. */
  consent: Record<Channel, boolean>;
}

export function blankDraft(orgId: string, owner: number | null): Draft {
  return {
    org_id: orgId, first_name: '', last_name: '', email: '', phone: '', whatsapp: '', job_title: '', company: '', country: '', city: '',
    industry: '', language: '', owner_id: owner === null ? '' : String(owner), status: 'new', source_channel: 'manual', tags: '',
    consent: { email: false, phone: false, whatsapp: false },
  };
}

export function draftOf(c: Contact): Draft {
  return {
    org_id: String(c.org_id), first_name: c.first_name ?? '', last_name: c.last_name ?? '', email: c.email ?? '', phone: c.phone ?? '',
    whatsapp: c.whatsapp ?? '', job_title: c.job_title ?? '', company: c.company?.name ?? '', country: c.country ?? '', city: c.city ?? '',
    industry: c.industry ?? '', language: c.language ?? '', owner_id: c.owner ? String(c.owner.id) : '', status: c.status,
    source_channel: c.source, tags: c.tags.join(', '), consent: { email: false, phone: false, whatsapp: false },
  };
}

/** The body a draft sends: the server checks every value, and blanks say "none". */
export function bodyOf(d: Draft, isNew: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: d.first_name, last_name: d.last_name, email: d.email, phone: d.phone, whatsapp: d.whatsapp, job_title: d.job_title,
    company: d.company, country: d.country, city: d.city, industry: d.industry, language: d.language,
    owner_id: d.owner_id === '' ? null : Number(d.owner_id), status: d.status, tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
  };
  if (isNew) {
    body.org_id = d.org_id === '' ? null : Number(d.org_id);
    body.source_channel = d.source_channel;
    body.consent = Object.fromEntries(Object.entries(d.consent).filter(([, yes]) => yes).map(([ch]) => [ch, 'granted']));
  }
  return body;
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-9);

/**
 * The contact the server matched, found again by what was typed: a 409 names
 * them, but the desktop's API client keeps only the refusal's sentence, so the
 * one with the same address — or the same last nine digits — is looked up.
 */
async function findDuplicate(d: Draft, self: number | null): Promise<number | null> {
  const q = d.email.trim() || d.phone.trim() || `${d.first_name} ${d.last_name}`.trim();
  if (!q || d.org_id === '') return null;
  try {
    const r = await apiGet<{ items: ContactRow[] }>('/api/marketing/contacts', { org: d.org_id, q, per_page: 5 });
    const others = r.items.filter((c) => c.id !== self);
    const hit =
      others.find((c) => d.email.trim() !== '' && (c.email ?? '').toLowerCase() === d.email.trim().toLowerCase()) ??
      others.find((c) => digits(d.phone) !== '' && digits(c.phone) === digits(d.phone)) ??
      others[0];
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

/** A new contact (no `contact`) or a change to one, in a sheet. */
export function ContactSheet({ options, org, contact, onClose, onSaved, onOpen }: {
  options: Options;
  org: string;
  contact?: Contact | null;
  onClose: () => void;
  /** Saved: the contact's id (a new one's from the server). */
  onSaved: (id: number) => void;
  /** "Open them": the contact the server says this already is. */
  onOpen: (id: number) => void;
}) {
  const isNew = !contact;
  const me = useMeId();
  const [draft, setDraft] = useState<Draft>(() => {
    if (contact) return draftOf(contact);
    const orgId = firstCompany(options, 'create', org);
    const mine = me !== null && peopleOf(options, Number(orgId) || null).some((p) => p.value === String(me));
    return blankDraft(orgId, mine ? me : null);
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [said, setSaid] = useState<string | null>(null);
  const [dup, setDup] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const makers = companiesWhere(options, 'create');

  const save = async () => {
    setBusy(true);
    setErrors({});
    setSaid(null);
    setDup(null);
    try {
      const r = await send<{ id?: number } | null>(isNew ? 'POST' : 'PUT', isNew ? '/api/marketing/contacts' : `/api/marketing/contacts/${contact.id}`, bodyOf(draft, isNew));
      toast('success', r.message ?? 'Saved.');
      await refreshMarketing();
      onSaved(isNew ? Number(r.data?.id ?? 0) : contact.id);
    } catch (e) {
      setErrors(fieldErrors(e));
      setSaid(refusal(e));
      if (e instanceof ApiError && e.status === 409) setDup(await findDuplicate(draft, contact?.id ?? null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={isNew ? 'Add contact' : `Edit ${contact.name}`}
      width={620}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || draft.org_id === '' || (isNew && makers.length === 0)} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Add contact' : 'Save'}
          </button>
        </>
      }
    >
      {said ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <span className="min-w-0 flex-1">{said}</span>
          {dup ? (
            <button type="button" className="font-bold underline" onClick={() => onOpen(dup)}>
              Open them
            </button>
          ) : null}
        </div>
      ) : null}
      {isNew && makers.length === 0 ? <p className="m-0 text-[13px] text-ink-2">You may not add contacts in any of your companies.</p> : <ContactForm draft={draft} onChange={setDraft} options={options} errors={errors} isNew={isNew} />}
    </Sheet>
  );
}

/** The fields themselves: the reach first, the rest behind "More details" on a new contact. */
export function ContactForm({ draft, onChange, options, errors, isNew }: { draft: Draft; onChange: (d: Draft) => void; options: Options; errors: Record<string, string>; isNew: boolean }) {
  const [more, setMore] = useState(!isNew);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const makers = companiesWhere(options, 'create');
  const orgId = draft.org_id === '' ? null : Number(draft.org_id);
  const hint = (k: string, plain?: ReactNode) => (errors[k] ? <span className="text-danger">{errors[k]}</span> : plain);
  const text = (k: keyof Draft, label: string, extra: { type?: string; placeholder?: string; plain?: ReactNode; autoFocus?: boolean; maxLength?: number } = {}) => (
    <Field label={label} hint={hint(k, extra.plain)}>
      <input
        className={input}
        type={extra.type ?? 'text'}
        value={draft[k] as string}
        onChange={(e) => set(k, e.target.value)}
        placeholder={extra.placeholder}
        autoFocus={extra.autoFocus}
        maxLength={extra.maxLength}
        aria-invalid={errors[k] ? true : undefined}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-3">
      {isNew && makers.length > 1 ? (
        <Field label="Company" hint={hint('org_id')}>
          <Select<string> aria-label="Company" value={draft.org_id} placeholder="Which company is this contact for?" onValueChange={(v) => onChange({ ...draft, org_id: v, owner_id: '' })} options={makers.map((c) => ({ value: String(c.id), label: c.name }))} className={input} />
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text('first_name', 'First name', { autoFocus: isNew })}
        {text('last_name', 'Last name')}
        {text('email', 'Email', { type: 'email', plain: 'An address or a number is needed; either will do.' })}
        {text('phone', 'Phone', { type: 'tel', placeholder: '+94 77 123 4567' })}
        {text('company', 'Organisation', { plain: 'Found by name, or added.' })}
        {text('job_title', 'Job title')}
      </div>

      {isNew ? (
        <fieldset className="m-0 rounded-[10px] border border-line px-3 pt-1 pb-2.5">
          <legend className="px-1 text-[12px] font-semibold text-ink-2">They agreed to be contacted by</legend>
          <div className="flex flex-wrap gap-4 text-[13px] text-ink">
            {(['email', 'phone', 'whatsapp'] as Channel[]).map((ch) => (
              <label key={ch} className="flex items-center gap-2">
                <Checkbox checked={draft.consent[ch]} onChange={(e) => set('consent', { ...draft.consent, [ch]: e.target.checked })} />
                {ch === 'email' ? 'Email' : ch === 'phone' ? 'Telephone' : 'WhatsApp'}
              </label>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-[11.5px] text-ink-3">Tick only what they said yes to. It is kept as evidence, with your name and the time.</p>
        </fieldset>
      ) : null}

      {!more ? (
        <button type="button" onClick={() => setMore(true)} className="self-start text-[12.5px] font-bold text-primary hover:underline">
          More details — country, owner, tags…
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text('whatsapp', 'WhatsApp', { type: 'tel', plain: 'Only when it is not the phone number.' })}
          <Field label="Country" hint={hint('country')}>
            <CountrySelect label="Country" value={draft.country} onChange={(v) => set('country', v)} />
          </Field>
          {text('city', 'City')}
          {text('industry', 'Industry')}
          {text('language', 'Language', { plain: 'As its code: en, si, ta, ar.', maxLength: 12 })}
          <Field label="Owner" hint={hint('owner_id')}>
            <Select<string> aria-label="Owner" value={draft.owner_id} onValueChange={(v) => set('owner_id', v)} options={[{ value: '', label: 'Nobody' }, ...peopleOf(options, orgId)]} className={input} />
          </Field>
          <Field label="Status" hint={hint('status')}>
            <Select<string> aria-label="Status" value={draft.status} onValueChange={(v) => set('status', v)} options={options.statuses} className={input} />
          </Field>
          {isNew ? (
            <Field label="Came from">
              <Select<string> aria-label="Came from" value={draft.source_channel} onValueChange={(v) => set('source_channel', v)} options={options.sources} className={input} />
            </Field>
          ) : null}
          <div className="sm:col-span-2">{text('tags', 'Tags', { placeholder: 'vendor, expo-2026', plain: 'Separated by commas.' })}</div>
        </div>
      )}
    </div>
  );
}
