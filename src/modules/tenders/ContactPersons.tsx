import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useCanOpen } from '../../core/access';
import { call, errorMessage } from '../../core/bridge';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, Initials, input, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { ScheduleDialog } from '../meetings/ScheduleDialog';
import { K } from './api';
import {
  createContactPerson,
  DuplicateFound,
  fetchContactPersons,
  K3,
  linkContact,
  matchedWords,
  meetingPreset,
  newPersonBody,
  roleBody,
  ROLES,
  searchContacts,
  telUrl,
  unlinkContactPerson,
  updateContactPerson,
  type Candidate,
  type ContactPerson,
  type NewPerson,
  type PersonDetails,
  type Role,
  type RoleDraft,
} from './persons';

/**
 * Contact Persons: the people outside the bid team a tender deals with — the
 * buyer's procurement officer, their technical contact, a supplier's
 * representative. Each is a Contacts record linked here with a role on this
 * tender; one of them is the Primary Contact. Their details are Contacts', so
 * a number corrected there is corrected here.
 *
 * From each: open them in Contacts, write to them (the Mail composer, or the
 * computer's mail program where Mail is not open to this person), call them,
 * or schedule a meeting about this tender with them invited.
 */
export default function ContactPersons({ tender }: { tender: { id: number; title: string; reference?: string | null } }) {
  const id = tender.id;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K3.persons(id), queryFn: ({ signal }) => fetchContactPersons(id, signal) });
  const [sheet, setSheet] = useState<'new' | 'link' | { role: ContactPerson } | null>(null);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  const [meeting, setMeeting] = useState<PersonDetails | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canMail = useCanOpen('mail');
  const canContacts = useCanOpen('contacts');
  const canMeet = useCanOpen('meet');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K3.persons(id) });
    // The tender's history gains a line for every change.
    void qc.invalidateQueries({ queryKey: K.tender(id) });
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { items, can } = q.data;
  const listed = items.map((p) => p.contact_id);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const email = (to: string) => {
    if (canMail) navigate(`/mail?compose=1&to=${encodeURIComponent(to)}`);
    else void call('app:openExternal', { url: `mailto:${to}` });
  };
  const dial = (phone: string) => {
    const url = telUrl(phone);
    if (url) void call('app:openExternal', { url });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-[13.5px] text-ink">
            {items.length ? `${items.length} ${items.length === 1 ? 'contact person' : 'contact persons'}` : 'Nobody listed yet'}
          </b>
          <span className="text-[12px] text-ink-3">Details come from Contacts and stay in step with it. Listing somebody here gives them no access to the tender.</span>
        </span>
        {can.manage ? (
          <>
            <button type="button" className={btn} onClick={() => setSheet('link')}>
              <Icon name="link" size={15} /> Link existing contact
            </button>
            <button type="button" className={btnPrimary} onClick={() => setSheet('new')}>
              <Icon name="plus" size={15} /> Add new contact
            </button>
          </>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Contact persons">
        {items.length ? (
          items.map((p) => {
            const c = p.contact;
            const name = c?.display_name ?? (p.missing ? 'Deleted from Contacts' : 'A contact you cannot view');
            return (
              <div key={p.id} data-person={p.id} className="flex items-start gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
                <Initials name={c?.display_name ?? '?'} size={34} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className={cx('text-[13px]', c ? 'text-ink' : 'text-ink-3')}>{name}</b>
                    {p.is_primary ? <Pill tone="blue">Primary Contact</Pill> : null}
                    <Pill tone="grey">{p.role_label}</Pill>
                  </span>
                  {c ? (
                    <>
                      {c.job_title || c.company ? <span className="truncate text-ink-2">{[c.job_title, c.company].filter(Boolean).join(' · ')}</span> : null}
                      <span className="flex flex-wrap gap-x-3 text-ink-3">
                        {c.email ? <span>{c.email}</span> : null}
                        {c.phone ? <span>{c.phone}</span> : null}
                        {!c.email && !c.phone ? <span>No email or phone in Contacts.</span> : null}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-3">{p.missing ? 'The record was deleted in Contacts. Unlink it, or link the person again.' : 'Their details are in Contacts, where you do not have access to this record.'}</span>
                  )}
                  {unlinking === p.id ? (
                    <span className="mt-1 flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle px-2.5 py-1.5" role="group" aria-label="Confirm unlink">
                      <span className="text-ink">Unlink {c?.display_name ?? 'this contact'}? Their record in Contacts stays.</span>
                      <button type="button" className={btnSmall + ' !text-danger'} disabled={busy !== null} onClick={() => void act(`unlink:${p.id}`, () => unlinkContactPerson(id, p.id), 'Unlinked. The contact is still in Contacts.').then(() => setUnlinking(null))}>
                        Unlink
                      </button>
                      <button type="button" className={btnSmall} onClick={() => setUnlinking(null)}>
                        Keep
                      </button>
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {c && canContacts ? (
                    <IconAction icon="contact" label={`Open ${c.display_name} in Contacts`} onClick={() => navigate(`/contacts?open=${c.id}`)} />
                  ) : null}
                  {c?.email ? <IconAction icon="mail" label={`Email ${c.display_name}`} onClick={() => email(c.email!)} /> : null}
                  {c?.phone && telUrl(c.phone) ? <IconAction icon="phone" label={`Call ${c.display_name}`} onClick={() => dial(c.phone!)} /> : null}
                  {c && canMeet ? <IconAction icon="calendar" label={`Schedule a meeting with ${c.display_name}`} onClick={() => setMeeting(c)} /> : null}
                  {can.manage ? (
                    <>
                      {!p.is_primary && !p.missing ? (
                        <button type="button" className={btnSmall} disabled={busy !== null} onClick={() => void act(`primary:${p.id}`, () => updateContactPerson(id, p.id, { is_primary: true }), `${c?.display_name ?? 'They'} is now the Primary Contact.`)}>
                          Make primary
                        </button>
                      ) : null}
                      <IconAction icon="compose" label={`Change ${c?.display_name ?? 'their'} role`} onClick={() => setSheet({ role: p })} />
                      <IconAction icon="trash" label={`Unlink ${c?.display_name ?? 'this contact'}`} danger onClick={() => setUnlinking(p.id)} />
                    </>
                  ) : null}
                </span>
              </div>
            );
          })
        ) : (
          <Empty text={can.manage ? 'No contact persons yet. Link somebody already in Contacts, or add a new contact.' : 'No contact persons yet.'} />
        )}
      </div>

      {sheet === 'new' ? <NewSheet tenderId={id} first={!items.length} listed={listed} onClose={() => setSheet(null)} onSaved={refresh} /> : null}
      {sheet === 'link' ? <LinkSheet tenderId={id} first={!items.length} onClose={() => setSheet(null)} onSaved={refresh} /> : null}
      {sheet && typeof sheet === 'object' ? <RoleSheet tenderId={id} person={sheet.role} onClose={() => setSheet(null)} onSaved={refresh} /> : null}
      {meeting ? <ScheduleDialog preset={meetingPreset(tender, meeting)} onClose={() => setMeeting(null)} /> : null}
    </div>
  );
}

function IconAction({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx(btnSmall, '!h-7 !w-7 justify-center !px-0', danger && '!text-danger')} onClick={onClick}>
      <Icon name={icon} size={13} />
    </button>
  );
}

function RoleFields({ d, setD }: { d: RoleDraft; setD: (d: RoleDraft) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label="Role on this tender">
        <Select<string> aria-label="Role on this tender" value={d.role} onValueChange={(v) => setD({ ...d, role: v as Role | '' })} options={[{ value: '', label: 'Choose a role' }, ...ROLES]} className={input} />
      </Field>
      {d.role === 'OTHER' ? (
        <Field label="Their role">
          <input aria-label="Their role" value={d.role_other} maxLength={120} onChange={(e) => setD({ ...d, role_other: e.target.value })} placeholder="e.g. Site engineer" className={input} />
        </Field>
      ) : null}
    </div>
  );
}

function PrimaryBox({ first, value, onChange }: { first: boolean; value: boolean; onChange: (v: boolean) => void }) {
  if (first) return <p className="m-0 text-[12px] text-ink-3">The first contact person is the Primary Contact.</p>;
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink">
      <Checkbox checked={value} onChange={(e) => onChange(e.target.checked)} />
      Make them the Primary Contact
    </label>
  );
}

function CandidateRow({ c, action }: { c: Candidate; action: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
      <Initials name={c.display_name} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px] text-ink">{c.display_name}</b>
        <span className="truncate text-ink-3">{[c.job_title, c.company, c.email, c.phone].filter(Boolean).join(' · ') || 'No other details'}</span>
        {c.matched_on?.length ? <span className="text-[11.5px] text-warning-ink dark:text-warning">{matchedWords(c)}</span> : null}
      </span>
      {action}
    </div>
  );
}

function LinkSheet({ tenderId, first, onClose, onSaved }: { tenderId: number; first: boolean; onClose: () => void; onSaved: () => void }) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [role, setRole] = useState<RoleDraft>({ role: '', role_other: '' });
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needle = term.trim();
  const found = useQuery({ queryKey: K3.search(tenderId, needle), queryFn: ({ signal }) => searchContacts(tenderId, needle, signal), enabled: needle.length >= 2 });

  const save = async () => {
    const { body, error: e } = roleBody(role);
    if (!picked) return setError('Choose who to link.');
    if (!body) return setError(e);
    setBusy(true);
    setError(null);
    try {
      await linkContact(tenderId, picked.id, body, primary);
      toast('success', `${picked.display_name} is now a contact person on this tender.`);
      onSaved();
      onClose();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Link existing contact"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !picked} onClick={() => void save()}>
            {busy ? 'Linking…' : 'Link'}
          </button>
        </>
      }
    >
      <Field label="Find in Contacts" hint="By name, organization, email or phone.">
        <input aria-label="Find in Contacts" autoFocus value={term} onChange={(e) => (setTerm(e.target.value), setPicked(null))} placeholder="Name, organization, email or phone" className={input} />
      </Field>
      {needle.length >= 2 ? (
        <div className="max-h-[240px] overflow-y-auto rounded-[10px] border border-line scroll-thin" aria-label="Contacts found">
          {found.isLoading ? (
            <Spinner />
          ) : found.error ? (
            <ErrorNote error={found.error} onRetry={() => void found.refetch()} />
          ) : found.data?.length ? (
            found.data.map((c) => (
              <CandidateRow
                key={c.id}
                c={c}
                action={
                  c.linked ? (
                    <span className="text-[12px] text-ink-3">Already listed</span>
                  ) : (
                    <button type="button" aria-pressed={picked?.id === c.id} className={cx(btnSmall, picked?.id === c.id && '!border-primary !text-primary')} onClick={() => setPicked(c)}>
                      {picked?.id === c.id ? 'Chosen' : 'Choose'}
                    </button>
                  )
                }
              />
            ))
          ) : (
            <Empty text="Nobody in Contacts matches. Add them as a new contact instead." />
          )}
        </div>
      ) : null}
      <RoleFields d={role} setD={setRole} />
      <PrimaryBox first={first} value={primary} onChange={setPrimary} />
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function NewSheet({ tenderId, first, listed, onClose, onSaved }: { tenderId: number; first: boolean; listed: number[]; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<NewPerson>({ display_name: '', job_title: '', company: '', email: '', phone: '' });
  const [role, setRole] = useState<RoleDraft>({ role: '', role_other: '' });
  const [primary, setPrimary] = useState(false);
  const [matches, setMatches] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof NewPerson) => (e: { target: { value: string } }) => (setP({ ...p, [k]: e.target.value }), setMatches(null));

  const create = async (force: boolean) => {
    const { body: person, error: e1 } = newPersonBody(p);
    if (!person) return setError(e1);
    const { body, error: e2 } = roleBody(role);
    if (!body) return setError(e2);
    setBusy(true);
    setError(null);
    try {
      await createContactPerson(tenderId, person, body, { force, primary });
      toast('success', `${person.display_name} was added to Contacts and is now a contact person on this tender.`);
      onSaved();
      onClose();
    } catch (x) {
      if (x instanceof DuplicateFound) setMatches(x.matches);
      else setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  const linkInstead = async (c: Candidate) => {
    const { body, error: e } = roleBody(role);
    if (!body) return setError(e);
    setBusy(true);
    setError(null);
    try {
      await linkContact(tenderId, c.id, body, primary);
      toast('success', `${c.display_name} is now a contact person on this tender.`);
      onSaved();
      onClose();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Add new contact"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          {matches ? (
            <button type="button" className={btn} disabled={busy} onClick={() => void create(true)}>
              {busy ? 'Creating…' : 'Create a new contact anyway'}
            </button>
          ) : (
            <button type="button" className={btnPrimary} disabled={busy || !p.display_name.trim()} onClick={() => void create(false)}>
              {busy ? 'Checking…' : 'Add'}
            </button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Name">
          <input aria-label="Name" autoFocus value={p.display_name} onChange={set('display_name')} maxLength={200} className={input} />
        </Field>
        <Field label="Job title">
          <input aria-label="Job title" value={p.job_title} onChange={set('job_title')} maxLength={150} className={input} />
        </Field>
        <Field label="Organization">
          <input aria-label="Organization" value={p.company} onChange={set('company')} maxLength={200} className={input} />
        </Field>
        <Field label="Email">
          <input aria-label="Email" type="email" value={p.email} onChange={set('email')} maxLength={191} className={input} />
        </Field>
        <Field label="Phone">
          <input aria-label="Phone" value={p.phone} onChange={set('phone')} maxLength={40} className={input} />
        </Field>
      </div>
      <RoleFields d={role} setD={setRole} />
      <PrimaryBox first={first} value={primary} onChange={setPrimary} />
      {matches ? (
        <div className="flex flex-col gap-1.5" aria-label="Possible duplicates">
          <p className="m-0 text-[12.5px] font-semibold text-warning-ink dark:text-warning">
            {matches.length === 1 ? 'This looks like somebody already in Contacts.' : 'These look like people already in Contacts.'} Link them instead, so their details stay in one place.
          </p>
          <div className="rounded-[10px] border border-line">
            {matches.map((c) => (
              <CandidateRow
                key={c.id}
                c={c}
                action={
                  c.linked || listed.includes(c.id) ? (
                    <span className="text-[12px] text-ink-3">Already listed</span>
                  ) : (
                    <button type="button" className={btnSmall} disabled={busy} onClick={() => void linkInstead(c)}>
                      Link {c.display_name}
                    </button>
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : null}
      <p className="m-0 text-[12px] text-ink-3">They are saved in Contacts — in the tender's company book when you may add to it, otherwise in your own contacts.</p>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function RoleSheet({ tenderId, person, onClose, onSaved }: { tenderId: number; person: ContactPerson; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<RoleDraft>({ role: person.role, role_other: person.role_other ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const { body, error: e } = roleBody(role);
    if (!body) return setError(e);
    setBusy(true);
    setError(null);
    try {
      await updateContactPerson(tenderId, person.id, { role: body.role, role_other: body.role_other ?? null });
      toast('success', 'Saved.');
      onSaved();
      onClose();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`${person.contact?.display_name ?? 'Contact person'}: role`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <RoleFields d={role} setD={setRole} />
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
