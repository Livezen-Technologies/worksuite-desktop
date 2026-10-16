import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Avatar, Button, Modal, cx } from '../../../components/ui';
import { errorText } from '../portfolio';
import { GUEST_ROLE, GUEST_ROLES, ck, cread, cwrite, type Guest, type GuestCandidate, type GuestRole } from './client-api';
import { Chip, ErrorLine, Failed, Field, Loading, Nothing, Panel, areaClass, inputClass, needsConnection, useAsk } from './kit';

/**
 * A project's external members (server ClientAccess): people who follow the project without being on its team — a
 * client's contact, an engineer at a partner company (who may have WorkSuite at their own company), a consultant.
 * They are never given staff access across the company boundary (G-01); they see the project through a
 * password-protected status link ("Share with client"). Listed for everyone who reaches the project; Add, Edit and
 * Remove for `can_manage`, and only online.
 */

export function ExternalMembers({ projectId, offline }: { projectId: number; offline: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useAsk();
  const q = useQuery({ queryKey: ck.access(projectId), queryFn: ({ signal }) => cread.access(projectId, { signal }) });
  const [editing, setEditing] = useState<Guest | 'new' | null>(null);
  const data = q.data?.data;
  const guests = data?.guests ?? [];
  const canManage = !!data?.can_manage;
  const refresh = () => void qc.invalidateQueries({ queryKey: ck.access(projectId) });
  const offlineTitle = (what: string) => (offline ? needsConnection(what) : undefined);

  const remove = async (g: Guest) => {
    if (!(await confirm({ title: `Remove ${g.name}?`, message: 'They come off the project, and the status links made for them stop opening at once.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await cwrite.removeGuest(projectId, g.id);
      toast('success', `${g.name} removed — their links no longer open`);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'They could not be removed.'));
    }
  };

  return (
    <Panel
      title="External members"
      sub="clients and people at other companies — they follow the project through a status link"
      action={
        canManage ? (
          <Button size="sm" icon="plus" disabled={offline} title={offlineTitle('Adding an external member')} onClick={() => setEditing('new')}>
            Add
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <Loading label="Loading external members" />
      ) : !data ? (
        <Failed error={q.error} onRetry={() => void q.refetch()} />
      ) : guests.length === 0 ? (
        <Nothing text="No external members yet." />
      ) : (
        <ul aria-label="External members" className="flex flex-col">
          {guests.map((g) => {
            const role = GUEST_ROLE[g.role] ?? GUEST_ROLE.client;
            return (
              <li key={g.id} className="flex items-center gap-2.5 border-t border-line/70 px-3.5 py-2 first:border-t-0">
                <Avatar name={g.name} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">
                    {g.name}
                    {g.company ? <span className="font-normal text-ink-3"> · {g.company}</span> : null}
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {g.email}
                    {g.note ? ` · ${g.note}` : ''}
                  </span>
                </span>
                <Chip tone={role.tone}>{role.label}</Chip>
                {canManage ? (
                  <span className="flex gap-1.5">
                    <Button size="sm" aria-label={`Edit ${g.name}`} disabled={offline} title={offlineTitle('Editing an external member')} onClick={() => setEditing(g)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" aria-label={`Remove ${g.name}`} disabled={offline} title={offlineTitle('Removing an external member')} onClick={() => void remove(g)}>
                      Remove
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? <GuestDialog projectId={projectId} guest={editing === 'new' ? null : editing} offline={offline} onClose={() => setEditing(null)} onDone={refresh} /> : null}
      {dialog}
    </Panel>
  );
}

type Way = 'outside' | 'company';

/** Add (two ways: someone outside WorkSuite, or a WorkSuite person at another company) or edit an external member. */
export function GuestDialog({ projectId, guest, offline, onClose, onDone }: { projectId: number; guest: Guest | null; offline: boolean; onClose: () => void; onDone: () => void }) {
  const [way, setWay] = useState<Way>('outside');
  const [name, setName] = useState(guest?.name ?? '');
  const [email, setEmail] = useState(guest?.email ?? '');
  const [company, setCompany] = useState(guest?.company ?? '');
  const [role, setRole] = useState<GuestRole>(guest?.role ?? 'client');
  const [note, setNote] = useState(guest?.note ?? '');
  const [picked, setPicked] = useState<GuestCandidate | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr('');
    if (!guest && way === 'company' && !picked) return setErr('Find and choose the person to add.');
    if ((guest || way === 'outside') && !name.trim()) return setErr('Enter their name.');
    if (!guest && way === 'outside' && !/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter a valid email address.');
    setBusy(true);
    try {
      if (guest) {
        await cwrite.updateGuest(projectId, guest.id, { name: name.trim(), company: company.trim(), role, note: note.trim() });
        toast('success', `${name.trim()} updated`);
      } else if (way === 'company' && picked) {
        await cwrite.addGuest(projectId, { user_id: picked.user_id, name: picked.name, email: picked.email, ...(picked.company ? { company: picked.company } : {}), role, ...(note.trim() ? { note: note.trim() } : {}) });
        toast('success', `${picked.name} added as an external member`);
      } else {
        await cwrite.addGuest(projectId, { name: name.trim(), email: email.trim(), ...(company.trim() ? { company: company.trim() } : {}), role, ...(note.trim() ? { note: note.trim() } : {}) });
        toast('success', `${name.trim()} added as an external member`);
      }
      onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e, guest ? 'The change could not be saved.' : 'They could not be added.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={guest ? `Edit ${guest.name}` : 'Add an external member'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Saving') : undefined} onClick={() => void save()}>
            {guest ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {guest ? (
          <p className="text-[12px] text-ink-3">{guest.email}</p>
        ) : (
          <div role="radiogroup" aria-label="Who to add" className="grid grid-cols-2 gap-2">
            {(
              [
                ['outside', 'Someone outside', 'A client contact or anyone without WorkSuite'],
                ['company', 'Someone at another company', 'A WorkSuite person at another company'],
              ] as Array<[Way, string, string]>
            ).map(([k, label, hint]) => (
              <button key={k} type="button" role="radio" aria-checked={way === k} onClick={() => (setWay(k), setErr(''))} className={cx('flex flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-start', way === k ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
                <span className={cx('text-[12.5px] font-semibold', way === k ? 'text-primary' : 'text-ink')}>{label}</span>
                <span className="text-[11px] text-ink-3">{hint}</span>
              </button>
            ))}
          </div>
        )}
        {!guest && way === 'company' ? (
          <CandidateSearch projectId={projectId} picked={picked} onPick={setPicked} />
        ) : (
          <>
            <Field label="Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} className={inputClass} />
            </Field>
            {!guest ? (
              <Field label="Email" required hint="Where a status link can be emailed. Never the password.">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={190} className={inputClass} />
              </Field>
            ) : null}
            <Field label="Company">
              <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={190} className={inputClass} />
            </Field>
          </>
        )}
        <Field label="Role">
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as GuestRole)} options={GUEST_ROLES.map((r) => ({ value: r, label: GUEST_ROLE[r].label }))} className={inputClass} />
        </Field>
        <Field label="Note" hint="Only your team sees this.">
          <textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={areaClass} />
        </Field>
        {err ? <ErrorLine>{err}</ErrorLine> : null}
      </div>
    </Modal>
  );
}

/** Finds WorkSuite people outside the project's company (`guest-candidates?q=`, 2 characters or more). */
function CandidateSearch({ projectId, picked, onPick }: { projectId: number; picked: GuestCandidate | null; onPick: (c: GuestCandidate | null) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const search = useQuery({ queryKey: ck.candidates(projectId, q), queryFn: ({ signal }) => cread.candidates(projectId, q, { signal }), enabled: q.length >= 2, staleTime: 30_000 });
  const people = search.data?.data.people ?? [];

  if (picked)
    return (
      <div className="flex items-center gap-2.5 rounded-[10px] border border-primary/50 bg-selection px-3 py-2">
        <Avatar name={picked.name} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-ink">{picked.name}</span>
          <span className="block truncate text-[11px] text-ink-3">
            {picked.email}
            {picked.company ? ` · ${picked.company}` : ''}
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => onPick(null)}>
          Change
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-1.5">
      <Field label="Find a person" hint="Name or email, 2 letters or more. People at this project's company join the team instead.">
        <input type="search" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search WorkSuite people…" className={inputClass} />
      </Field>
      {q.length >= 2 ? (
        search.isLoading ? (
          <Loading label="Searching" />
        ) : search.error ? (
          <ErrorLine>{errorText(search.error, 'The search did not work.')}</ErrorLine>
        ) : people.length === 0 ? (
          <p className="px-1 text-[12px] text-ink-3">Nobody at another company matches “{q}”.</p>
        ) : (
          <ul aria-label="People found" className="flex max-h-[220px] flex-col overflow-y-auto rounded-[10px] border border-line scroll-thin">
            {people.map((p) => (
              <li key={p.user_id}>
                <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-start hover:bg-subtle">
                  <Avatar name={p.name} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{p.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {p.email}
                      {p.company ? ` · ${p.company}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
