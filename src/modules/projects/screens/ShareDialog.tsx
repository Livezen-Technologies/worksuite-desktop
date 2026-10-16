import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from '../../../core/toasts';
import { todayInZone } from '../../../core/time';
import { Checkbox } from '../../../components/Checkbox';
import { DateField } from '../../../components/DateField';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { errorText, fmtDay } from '../portfolio';
import { DEFAULT_SECTIONS, LINK_SECTIONS, LINK_STATE, MIN_PASSWORD, ck, cread, cwrite, generatePassword, type ClientAccess, type ClientUpdate, type LinkSection, type NewLinkAnswer, type ShareLink } from './client-api';
import { fmtStamp } from './gov-kit';
import { Chip, ErrorLine, Failed, Field, Loading, Mono, Nothing, Tabs, areaClass, inputClass, needsConnection, useAsk } from './kit';

/**
 * "Share with client" on a project: its password-protected status links and the updates written for the client.
 *
 * A link opens `{server}/ps/{token}` for anyone with its password; it shows only the sections ticked, until it
 * expires or is withdrawn. Its address is shown ONCE, when it is made (only a hash is kept), and the password is
 * never emailed — the person making it sends it another way. Links need `can_manage`; client updates
 * `can_post_updates`. Every change needs WorkSuite (disabled offline); what was read stays readable.
 */

type Pane = 'links' | 'updates';

const sectionWords = (s: string[]) => s.map((k) => LINK_SECTIONS.find((x) => x.key === k)?.label ?? k).join(', ');

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', `${what} copied`);
  } catch {
    toast('error', `The ${what.toLowerCase()} could not be copied — select it and copy it yourself.`);
  }
}

export function ShareDialog({ projectId, projectName, offline, onClose }: { projectId: number; projectName: string; offline: boolean; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>('links');
  const q = useQuery({ queryKey: ck.access(projectId), queryFn: ({ signal }) => cread.access(projectId, { signal }) });
  const d = q.data?.data;
  // Escape reaches every open dialog's listener, this one first: while a Withdraw / Delete question is open over it,
  // Escape answers that question only.
  const closeUnlessAsking = () => {
    if (document.querySelectorAll('[role="dialog"]').length > 1) return;
    onClose();
  };
  return (
    <Modal title={`Share ${projectName} with the client`} onClose={closeUnlessAsking} width={760}>
      <div className="flex flex-col gap-3">
        <Tabs<Pane>
          label="Client sharing"
          value={pane}
          onChange={setPane}
          tabs={[
            { key: 'links', label: 'Status links', count: d ? (d.links ?? []).filter((l) => l.state === 'active').length : null },
            { key: 'updates', label: 'Client updates', count: d ? (d.updates ?? []).length : null },
          ]}
        />
        {q.isLoading ? <Loading label="Loading client sharing" /> : !d ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : pane === 'links' ? <Links projectId={projectId} d={d} offline={offline} /> : <Updates projectId={projectId} d={d} offline={offline} />}
      </div>
    </Modal>
  );
}

// ── status links ───────────────────────────────────────────────────────────

function Links({ projectId, d, offline }: { projectId: number; d: ClientAccess; offline: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useAsk();
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<NewLinkAnswer | null>(null);
  const [repass, setRepass] = useState<ShareLink | null>(null);
  const links = d.links ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ck.access(projectId) });
  const offlineTitle = (what: string) => (offline ? needsConnection(what) : undefined);

  const withdraw = async (l: ShareLink) => {
    if (!(await confirm({ title: `Withdraw “${l.label}”?`, message: 'The link stops opening at once, for everyone who has it. This cannot be undone — make a new link to share again.', confirmLabel: 'Withdraw', danger: true }))) return;
    try {
      await cwrite.revokeLink(projectId, l.id);
      toast('success', 'Link withdrawn');
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'The link could not be withdrawn.'));
    }
  };

  if (made) return <Made answer={made} onDone={() => setMade(null)} />;
  if (repass) return <ChangePassword projectId={projectId} link={repass} offline={offline} onClose={() => setRepass(null)} onDone={refresh} />;
  if (making)
    return (
      <NewLink
        projectId={projectId}
        d={d}
        offline={offline}
        onCancel={() => setMaking(false)}
        onMade={(a) => {
          setMaking(false);
          setMade(a);
          refresh();
        }}
      />
    );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-ink-3">Anyone with a link and its password sees the sections it shows — nothing else of the project, and never money.</p>
        {d.can_manage ? (
          <Button size="sm" variant="primary" icon="plus" disabled={offline} title={offlineTitle('Making a link')} onClick={() => setMaking(true)}>
            New link
          </Button>
        ) : null}
      </div>
      {links.length === 0 ? (
        <Nothing text="No status links yet." />
      ) : (
        <ul aria-label="Status links" className="flex flex-col rounded-[12px] border border-line">
          {links.map((l) => {
            const st = LINK_STATE[l.state] ?? LINK_STATE.active;
            return (
              <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line/70 px-3.5 py-2.5 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-[13px] text-ink">{l.label}</b>
                    <Chip tone={st.tone}>{st.label}</Chip>
                    <Mono className="text-[11px] text-ink-3">{l.token_prefix}…</Mono>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-3">
                    {l.guest ? `For ${l.guest.name} (${l.guest.email})` : 'For anyone with the password'} · Shows {sectionWords(l.sections ?? []) || '—'}
                  </span>
                  <span className="block text-[11.5px] text-ink-3">
                    {l.expires_at ? `${l.state === 'expired' ? 'Expired' : 'Expires'} ${fmtDay(l.expires_at, { year: true })}` : 'No expiry'} · {l.views === 1 ? '1 view' : `${l.views ?? 0} views`}
                    {l.last_viewed_at ? `, last ${fmtStamp(l.last_viewed_at)}` : ''}
                    {l.created_at ? ` · made ${fmtDay(l.created_at)}` : ''}
                  </span>
                </span>
                {d.can_manage && l.state === 'active' ? (
                  <span className="flex gap-1.5">
                    <Button size="sm" aria-label={`Change the password of ${l.label}`} disabled={offline} title={offlineTitle('Changing a password')} onClick={() => setRepass(l)}>
                      Change password
                    </Button>
                    <Button size="sm" variant="danger" aria-label={`Withdraw ${l.label}`} disabled={offline} title={offlineTitle('Withdrawing a link')} onClick={() => void withdraw(l)}>
                      Withdraw
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </div>
  );
}

/** Password and confirm, with Generate (a strong random one, shown so it can be copied) and Copy. */
function PasswordFields({ value, confirm, onChange, onConfirm }: { value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  const generate = () => {
    const p = generatePassword();
    onChange(p);
    onConfirm(p);
    setShown(true);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Password" required hint={`At least ${MIN_PASSWORD} characters.`}>
          <input type={shown ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, 'font-mono')} />
        </Field>
        <Field label="Confirm password" required>
          <input type={shown ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} className={cx(inputClass, 'font-mono')} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" icon="key" onClick={generate}>
          Generate
        </Button>
        <Button size="sm" icon="copy" disabled={!value} onClick={() => void copy(value, 'Password')}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Show'}
        </Button>
      </div>
    </div>
  );
}

function passwordProblem(p: string, c: string): string | null {
  if (p.length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (p !== c) return 'The two passwords are not the same.';
  return null;
}

function NewLink({ projectId, d, offline, onCancel, onMade }: { projectId: number; d: ClientAccess; offline: boolean; onCancel: () => void; onMade: (a: NewLinkAnswer) => void }) {
  const guests = d.guests ?? [];
  const offered = (d.sections?.length ? LINK_SECTIONS.filter((s) => d.sections.includes(s.key)) : LINK_SECTIONS) as typeof LINK_SECTIONS;
  const [label, setLabel] = useState('');
  const [guest, setGuest] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [sections, setSections] = useState<LinkSection[]>(DEFAULT_SECTIONS.filter((s) => offered.some((o) => o.key === s)));
  const [expires, setExpires] = useState('');
  const [email, setEmail] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (k: LinkSection) => setSections((s) => (s.includes(k) ? s.filter((x) => x !== k) : LINK_SECTIONS.map((x) => x.key).filter((x) => x === k || s.includes(x))));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const bad = passwordProblem(password, again);
    if (bad) return setErr(bad);
    if (!sections.length) return setErr('Choose at least one thing the link shows.');
    setBusy(true);
    try {
      const a = await cwrite.createLink(projectId, {
        password,
        sections,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(guest ? { guest_id: Number(guest) } : {}),
        ...(expires ? { expires_on: expires } : {}),
        ...(guest && email ? { send_email: true } : {}),
      });
      onMade(a);
    } catch (e2) {
      setErr(errorText(e2, 'The link could not be made.'));
      setBusy(false);
    }
  };

  return (
    <form aria-label="New status link" onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Label" hint="So your team can tell links apart. Blank = “For …” or “Client status link”.">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={150} className={inputClass} />
        </Field>
        <Field label="For" hint={guests.length ? undefined : 'Add external members on the Team tab to make a link for one of them.'}>
          <Select
            aria-label="For"
            value={guest}
            onValueChange={(v) => {
              setGuest(v);
              if (!v) setEmail(false);
            }}
            options={[{ value: '', label: 'Anyone with the password' }, ...guests.map((g) => ({ value: String(g.id), label: `${g.name}${g.company ? ` · ${g.company}` : ''}` }))]}
            className={inputClass}
          />
        </Field>
      </div>
      <PasswordFields value={password} confirm={again} onChange={setPassword} onConfirm={setAgain} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-semibold text-ink">What it shows</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {offered.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5 text-[13px] text-ink">
              <Checkbox checked={sections.includes(s.key)} onChange={() => toggle(s.key)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 items-start gap-2.5">
        <Field label="Expires" hint="Blank = until it is withdrawn.">
          <DateField aria-label="Expires" value={expires} onChange={setExpires} min={todayInZone()} clearable placeholder="Never" />
        </Field>
        {guest ? (
          <label className="mt-6 flex items-start gap-1.5 text-[13px] text-ink">
            <Checkbox checked={email} onChange={(e) => setEmail(e.target.checked)} />
            <span>
              Email the link to them
              <span className="block text-[11.5px] text-ink-3">The email has the link only, never the password.</span>
            </span>
          </label>
        ) : null}
      </div>
      {err ? <ErrorLine>{err}</ErrorLine> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Making a link') : undefined}>
          Make link
        </Button>
      </div>
    </form>
  );
}

/** The new link's address, shown this once. */
function Made({ answer, onDone }: { answer: NewLinkAnswer; onDone: () => void }) {
  return (
    <section aria-label="Link made" className="flex flex-col gap-3">
      <p className="text-[13px] font-semibold text-ink">Link made. Copy it now — it is not shown again.</p>
      <div className="flex gap-2">
        <input readOnly aria-label="Link address" value={answer.url} onFocus={(e) => e.currentTarget.select()} className={cx(inputClass, 'font-mono')} />
        <Button icon="copy" variant="primary" onClick={() => void copy(answer.url, 'Link')}>
          Copy
        </Button>
      </div>
      <p className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink">
        Send the password separately — by phone or in another message. It is never in the link{answer.emailed ? ' or the email' : ''}.
      </p>
      {answer.emailed && answer.link.guest ? <p className="text-[12.5px] text-ink-2">The link was emailed to {answer.link.guest.name} ({answer.link.guest.email}).</p> : null}
      {answer.warning ? <ErrorLine>{answer.warning}</ErrorLine> : null}
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </section>
  );
}

function ChangePassword({ projectId, link, offline, onClose, onDone }: { projectId: number; link: ShareLink; offline: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const bad = passwordProblem(password, again);
    if (bad) return setErr(bad);
    setErr('');
    setBusy(true);
    try {
      await cwrite.updateLink(projectId, link.id, { password });
      toast('success', 'Password changed — send the new one separately');
      onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e, 'The password could not be changed.'));
      setBusy(false);
    }
  };
  return (
    <form aria-label="Change password" onSubmit={(e) => (e.preventDefault(), void save())} className="flex flex-col gap-3">
      <p className="text-[13px] font-semibold text-ink">New password for “{link.label}”</p>
      <p className="text-[12.5px] text-ink-2">The link stays the same. Anyone viewing it with the old password is signed out of it.</p>
      <PasswordFields value={password} confirm={again} onChange={setPassword} onConfirm={setAgain} />
      {err ? <ErrorLine>{err}</ErrorLine> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Changing a password') : undefined}>
          Change password
        </Button>
      </div>
    </form>
  );
}

// ── client updates ─────────────────────────────────────────────────────────

function Updates({ projectId, d, offline }: { projectId: number; d: ClientAccess; offline: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useAsk();
  const [editing, setEditing] = useState<ClientUpdate | null>(null);
  const updates = d.updates ?? [];
  const can = !!d.can_post_updates;
  const refresh = () => void qc.invalidateQueries({ queryKey: ck.access(projectId) });

  const remove = async (u: ClientUpdate) => {
    if (!(await confirm({ title: `Delete “${u.title}”?`, message: 'It comes off every status link that shows updates.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await cwrite.deleteUpdate(projectId, u.id);
      toast('success', 'Update deleted');
      if (editing?.id === u.id) setEditing(null);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'The update could not be deleted.'));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-3">What you write here shows on the status links that show updates — written for the client, not the team.</p>
      {can ? <Composer key={editing?.id ?? 'new'} projectId={projectId} editing={editing} offline={offline} onDone={() => (setEditing(null), refresh())} onCancel={() => setEditing(null)} /> : null}
      {updates.length === 0 ? (
        <Nothing text="No client updates yet." />
      ) : (
        <ul aria-label="Client updates" className="flex flex-col rounded-[12px] border border-line">
          {updates.map((u) => (
            <li key={u.id} className="flex items-start gap-3 border-t border-line/70 px-3.5 py-2.5 first:border-t-0">
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] text-ink">{u.title}</b>
                <span className="block text-[11.5px] text-ink-3">
                  {u.posted_by_name ?? 'Someone'} · {fmtStamp(u.created_at)}
                  {u.updated_at && u.updated_at !== u.created_at ? ' · edited' : ''}
                </span>
                {u.body ? <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-ink-2">{u.body}</p> : null}
              </span>
              {can ? (
                <span className="flex gap-1.5">
                  <Button size="sm" aria-label={`Edit ${u.title}`} disabled={offline} title={offline ? needsConnection('Editing an update') : undefined} onClick={() => setEditing(u)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" aria-label={`Delete ${u.title}`} disabled={offline} title={offline ? needsConnection('Deleting an update') : undefined} onClick={() => void remove(u)}>
                    Delete
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}

function Composer({ projectId, editing, offline, onDone, onCancel }: { projectId: number; editing: ClientUpdate | null; offline: boolean; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Give the update a title.');
    setErr('');
    setBusy(true);
    try {
      if (editing) {
        await cwrite.editUpdate(projectId, editing.id, { title: title.trim(), body: body.trim() });
        toast('success', 'Update saved');
      } else {
        await cwrite.postUpdate(projectId, { title: title.trim(), ...(body.trim() ? { body: body.trim() } : {}) });
        toast('success', 'Update posted');
        setTitle('');
        setBody('');
      }
      onDone();
    } catch (e2) {
      setErr(errorText(e2, 'The update could not be saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form aria-label={editing ? 'Edit update' : 'New update'} onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-[12px] border border-line bg-ground px-3.5 py-3">
      <Field label="Title" required>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={190} placeholder="Bidder onboarding is live" className={inputClass} />
      </Field>
      <Field label="Update">
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} className={areaClass} />
      </Field>
      {err ? <ErrorLine>{err}</ErrorLine> : null}
      <div className="flex justify-end gap-2">
        {editing ? <Button onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Posting an update') : undefined}>
          {editing ? 'Save update' : 'Post update'}
        </Button>
      </div>
    </form>
  );
}
