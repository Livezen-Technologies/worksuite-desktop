import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MANUAL_SOURCES, PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL, type Meta, type SupportType, type TicketFull } from '@shared/support';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { isMac } from '../../core/bridge';
import { cleanDescription } from '../../core/description';
import { useDraft } from '../../core/drafts';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { RichTextEditor } from '../../components/RichTextEditor';
import { Select } from '../../components/Select';
import { Avatar, Button, FileBadge, Kbd, Modal, TextField, cx } from '../../components/ui';
import { K, MAX_FILES, MAX_FILE_BYTES, agents, createTicket, errorText, findRequesters, newClientId, removeAttachment, uploadAttachment, type RequesterHit } from './api';
import type { DraftFile } from './Composer';
import { creatableOrganizations, defaultOrganization, emptyForm, newTicketInput, requesterEmail, validate, type NewTicketForm, type RequesterChoice } from './newTicketForm';
import { channelIcon, channelLabel } from './parts';
import { tagOf } from './Properties';

/**
 * New ticket (WS-SUPPORT-SRS-001 FR-CRT-01/02, worksuite-desktop#298): a ticket raised by hand — somebody rang,
 * walked in, or asked in passing — from the inbox's New ticket (C) or ⌘K's Create ticket.
 *
 *  - The requester is found among my contacts, customers and colleagues (Contacts' lookup) or added new by name,
 *    email and phone; the server matches a new one to a contact by email where it can.
 *  - The organization starts as the one chosen in the rail's company switcher (or the only one I may raise tickets
 *    in); its teams, categories, tags and people are the ones offered.
 *  - The description is formatted text (the app's editor), the thread's first message; files dropped on it or chosen
 *    go up at once — scanned, at most ten, 25 MB each — and wait at the server for it (`POST attachments`).
 *  - The channel says how it came: Manual, Phone or Walk-in. The requester is emailed the reference unless that is
 *    unticked — never without an address.
 *  - Create (⌘↵ / Ctrl+Enter) sends it with an Idempotency-Key kept until it is done: pressed again after a failure,
 *    it is one ticket. The ticket opens in the reading pane and shows at once in the lists it belongs in
 *    (newTicketForm.ts).
 *
 * What is typed is kept on this computer (`useDraft`, encrypted) until the ticket is raised or the draft discarded,
 * so closing the form — or being offline when Create is pressed — loses nothing. A refusal is said in the form, in
 * the server's words; an older server's is NEEDS_NEWER_SERVER.
 */

/** A file on its way up: kept here (not in the draft) until the server has it. */
interface Upload {
  key: string;
  file: File;
  name: string;
  error: string | null;
}

let uploadSeq = 0;

const LABEL = 'text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase';
const FIELD = 'h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** What was typed in the search, as the new requester's first detail: an address, a number or a name. */
function seedFrom(typed: string): Pick<RequesterChoice, 'name' | 'email' | 'phone'> {
  const v = typed.trim();
  if (EMAIL.test(v)) return { name: '', email: v, phone: '' };
  if (/^\+?[\d\s().-]{6,}$/.test(v)) return { name: '', email: '', phone: v };
  return { name: v, email: '', phone: '' };
}

const KIND_LABEL: Record<string, string> = { contact: 'Contact', customer: 'Customer', employee: 'Colleague' };

export function NewTicketSheet({ meta, selectedOrganization = null, onClose, onCreated }: { meta: Meta | undefined; selectedOrganization?: number | null; onClose: () => void; onCreated: (ticket: TicketFull) => void }) {
  const me = Number(useStore(app, (s) => s.auth?.user?.id ?? 0)) || null;
  const choices = creatableOrganizations(meta);
  const [initial] = useState(() => emptyForm(defaultOrganization(selectedOrganization, choices), me));
  const draft = useDraft<NewTicketForm | null>('support', 'new-ticket', null);
  const kept = draft.value;
  // A draft kept from before, in an organization I may still raise tickets in (else the one the form starts in).
  const f: NewTicketForm = kept ? { ...initial, ...kept, organization: kept.organization === null || !choices.length || choices.some((o) => o.id === kept.organization) ? kept.organization : initial.organization } : initial;
  const latest = useRef(f);
  useEffect(() => {
    latest.current = f;
  });
  const key = useRef<string | null>(null);
  const set = (patch: Partial<NewTicketForm>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    // A changed form is a new request: the retry key is only for sending the same one again.
    key.current = null;
    draft.setValue(next);
  };
  const setRequester = (patch: Partial<RequesterChoice>) => set({ requester: { ...latest.current.requester, ...patch } });

  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [tag, setTag] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const org = f.organization;
  const orgCaps = (meta?.organizations ?? []).find((o) => o.id === org)?.can ?? meta?.can ?? {};
  const mayAssign = orgCaps.assign !== false;
  const people = useQuery({ queryKey: K.agents(`org:${org ?? ''}`), queryFn: () => agents({ organization: org }), enabled: mayAssign, staleTime: 60_000 });
  const inOrg = <T extends { organization_id: number | null }>(list: T[] | undefined) => (list ?? []).filter((x) => org === null || x.organization_id === null || x.organization_id === org);
  const types = (meta?.types?.length ? meta.types : [...TYPES]).filter((t): t is SupportType => (TYPES as readonly string[]).includes(t));
  const suggest = [...new Set(inOrg(meta?.tags).map((x) => x.name))].filter((n) => !f.tags.includes(n));

  const errors = validate(f, { organizations: choices.length });
  const email = requesterEmail(f.requester);
  const uploading = uploads.some((u) => !u.error);
  const dirty = !!(f.subject.trim() || f.html.trim() || f.files.length || f.tags.length || f.requester.found || f.requester.name.trim() || f.requester.email.trim() || f.requester.phone.trim());

  /* ── files ── */
  const upload = async (k: string, file: File, name: string) => {
    try {
      const a = await uploadAttachment(null, file, name);
      setUploads((u) => u.filter((x) => x.key !== k));
      set({ files: [...latest.current.files, { id: a.id, name: a.name, size: a.size, mime: a.mime }] });
    } catch (e) {
      setUploads((u) => u.map((x) => (x.key === k ? { ...x, error: errorText(e, text('It could not be attached.')) } : x)));
    }
  };
  const addFiles = (list: File[]) => {
    let room = MAX_FILES - latest.current.files.length - uploads.length;
    for (const file of list) {
      const name = file.name || text('file');
      if (room <= 0) {
        toast('warning', text('At most {n} files a ticket.', { n: MAX_FILES }));
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast('error', text('{name} is larger than 25 MB.', { name }));
        continue;
      }
      room -= 1;
      const k = `n${++uploadSeq}`;
      setUploads((u) => [...u, { key: k, file, name, error: null }]);
      void upload(k, file, name);
    }
  };
  const dropFile = (x: DraftFile) => {
    set({ files: latest.current.files.filter((y) => y.id !== x.id) });
    // Taken back at the server too: one never claimed is its uploader's alone either way.
    void removeAttachment(x.id).catch(() => undefined);
  };

  /* ── tags ── */
  const addTag = () => {
    const name = tagOf(tag);
    setTag('');
    if (name && !latest.current.tags.includes(name)) set({ tags: [...latest.current.tags, name] });
  };

  /* ── create ── */
  const sending = useRef(false);
  const create = async () => {
    setTried(true);
    // A tag still being typed (⌘↵ straight from its field) goes with it.
    if (tag.trim()) addTag();
    if (sending.current || uploading || Object.keys(errors).length) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    key.current ??= newClientId('ticket');
    try {
      const t = await createTicket(newTicketInput(latest.current), key.current);
      key.current = null;
      toast('success', text('{ref} created.', { ref: t.reference }));
      void draft.clear();
      onCreated(t);
      onClose();
    } catch (e) {
      setFailure(e instanceof ApiError && e.offline ? text('You are offline. The ticket can be created once WorkSuite is back: what you typed is kept.') : errorText(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const discard = () => {
    for (const x of latest.current.files) void removeAttachment(x.id).catch(() => undefined);
    void draft.clear();
    onClose();
  };

  const createKeys = isMac ? '⌘↵' : 'Ctrl+↵';
  const shown = (k: keyof typeof errors) => (tried ? (errors[k] ?? null) : null);
  const opt = (list: Array<{ id: number; name: string }>, none: string) => [{ value: '', label: none }, ...list.map((x) => ({ value: String(x.id), label: x.name }))];
  const total = f.files.reduce((n, x) => n + x.size, 0) + uploads.reduce((n, u) => n + u.file.size, 0);

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
          e.preventDefault();
          void create();
        }
      }}
    >
      <Modal
        title={text('New ticket')}
        labelledBy="support-new-ticket-title"
        onClose={onClose}
        width={720}
        footer={
          <>
            {dirty || draft.restored ? (
              <Button variant="ghost" className="mr-auto" onClick={discard}>
                {text('Discard draft')}
              </Button>
            ) : null}
            <Button onClick={onClose}>{text('Cancel')}</Button>
            <Button
              variant="primary"
              icon="life-buoy"
              loading={busy}
              disabled={uploading}
              title={uploading ? text('Waiting for the files to finish uploading') : undefined}
              onClick={() => void create()}
              aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}
            >
              {text('Create ticket')}
              <Kbd tone="accent" aria-hidden>
                {createKeys}
              </Kbd>
            </Button>
          </>
        }
      >
        <div className="flex max-h-[68vh] flex-col gap-3.5 overflow-y-auto pr-1 scroll-thin">
          {failure ? (
            <p role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
              {failure}
            </p>
          ) : null}
          <RequesterField value={f.requester} onChange={setRequester} error={shown('requester')} emailError={shown('email')} />
          <div className={cx('grid items-start gap-2.5', choices.length > 1 ? 'grid-cols-[minmax(0,1fr)_minmax(0,280px)]' : 'grid-cols-1')}>
            <TextField label={text('Subject')} value={f.subject} onChange={(e) => set({ subject: e.target.value })} error={shown('subject')} placeholder={text('What it is about, in a few words')} />
            {choices.length > 1 ? (
              <Labeled label={text('Company')} error={shown('organization')}>
                <Select
                  label={text('Company')}
                  className="w-full"
                  searchable={choices.length > 6}
                  value={org === null ? '' : String(org)}
                  options={opt(choices, text('Choose…'))}
                  onValueChange={(v) => set({ organization: v ? Number(v) : null, team: null, category: null, assignee: me })}
                />
              </Labeled>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">{text('Description')}</span>
            <RichTextEditor
              value={f.html}
              onChange={(html) => set({ html })}
              clean={cleanDescription}
              label={text('Description')}
              placeholder={text('What the requester asked, in their words')}
              tools={['bold', 'italic', 'underline', 'link', 'bullets', 'numbers', 'clear']}
              allowTel
              onFiles={addFiles}
              minHeight={110}
              maxHeight={260}
              boxClassName="p-2.5 text-[13px] overflow-y-auto scroll-thin"
              toolbarEnd={
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    aria-label={text('Files to attach')}
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []));
                      e.target.value = '';
                    }}
                  />
                  <Button size="sm" variant="ghost" icon="paperclip" onClick={() => fileInput.current?.click()}>
                    {text('Attach')}
                  </Button>
                </>
              }
            />
            {shown('description') ? <span className="text-[12px] text-danger">{shown('description')}</span> : null}
            {f.files.length || uploads.length ? (
              <div className="flex flex-col gap-1">
                <ul aria-label={text('Files to send')} className="flex flex-wrap gap-1.5">
                  {f.files.map((x) => (
                    <li key={x.id} className="flex max-w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface py-1 pr-1 pl-1.5 text-[12px]">
                      <FileBadge name={x.name} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{x.name}</span>
                        <span className="block text-[11px] text-ink-3">{bytes(x.size)}</span>
                      </span>
                      <button type="button" aria-label={text('Remove {name}', { name: x.name })} onClick={() => dropFile(x)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
                        <Icon name="x" size={13} />
                      </button>
                    </li>
                  ))}
                  {uploads.map((u) => (
                    <li key={u.key} className={cx('flex max-w-[280px] items-center gap-2 rounded-[8px] border py-1 pr-1 pl-1.5 text-[12px]', u.error ? 'border-danger/50 bg-danger-bg' : 'border-line bg-surface')}>
                      <FileBadge name={u.name} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{u.name}</span>
                        <span className={cx('block truncate text-[11px]', u.error ? 'text-danger' : 'text-ink-3')}>{u.error ?? text('Uploading and scanning…')}</span>
                      </span>
                      {u.error ? (
                        <button
                          type="button"
                          aria-label={text('Try {name} again', { name: u.name })}
                          onClick={() => {
                            setUploads((list) => list.map((x) => (x.key === u.key ? { ...x, error: null } : x)));
                            void upload(u.key, u.file, u.name);
                          }}
                          className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink"
                        >
                          <Icon name="refresh" size={13} />
                        </button>
                      ) : (
                        <Icon name="spinner" size={13} className="animate-spin-slow text-ink-3" />
                      )}
                      <button type="button" aria-label={text('Remove {name}', { name: u.name })} onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
                        <Icon name="x" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
                <span className="text-[11px] text-ink-3">{text('{n} files · {size} · max 25 MB each · scanned before sending', { n: f.files.length + uploads.length, size: bytes(total) })}</span>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <div className="flex flex-col gap-1">
              <span className={LABEL}>{text('Channel')}</span>
              <div role="radiogroup" aria-label={text('Channel')} className="flex gap-1">
                {MANUAL_SOURCES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={f.source === s}
                    onClick={() => set({ source: s })}
                    className={cx('inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[7px] border text-[12px] font-semibold', f.source === s ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2')}
                  >
                    <Icon name={channelIcon(s)} size={13} />
                    {channelLabel(s)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>{text('Priority')}</span>
              <div role="radiogroup" aria-label={text('Priority')} className="flex gap-1">
                {PRIORITIES.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={f.priority === p} onClick={() => set({ priority: p })} className={cx('h-8 flex-1 rounded-[7px] border text-[12px] font-semibold', f.priority === p ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2')}>
                    {text(PRIORITY_LABEL[p])}
                  </button>
                ))}
              </div>
            </div>
            <Labeled label={text('Type')}>
              <Select label={text('Type')} className="w-full" value={f.type ?? ''} options={[{ value: '', label: text('No type') }, ...types.map((t) => ({ value: t, label: text(TYPE_LABEL[t]) }))]} onValueChange={(v) => set({ type: (v || null) as SupportType | null })} />
            </Labeled>
            <Labeled label={text('Category')}>
              <Select label={text('Category')} className="w-full" value={f.category === null ? '' : String(f.category)} options={opt(inOrg(meta?.categories), text('No category'))} onValueChange={(v) => set({ category: v ? Number(v) : null })} />
            </Labeled>
            <Labeled label={text('Assignee')}>
              <Select
                label={text('Assignee')}
                className="w-full"
                value={f.assignee === null ? '' : String(f.assignee)}
                searchable={(people.data ?? []).length > 6}
                options={[{ value: '', label: text('Unassigned') }, ...(me ? [{ value: String(me), label: text('Me') }] : []), ...(mayAssign ? (people.data ?? []).filter((x) => x.id !== me).map((x) => ({ value: String(x.id), label: x.name })) : [])]}
                onValueChange={(v) => set({ assignee: v ? Number(v) : null })}
              />
            </Labeled>
            <Labeled label={text('Team')}>
              <Select label={text('Team')} className="w-full" value={f.team === null ? '' : String(f.team)} options={opt(inOrg(meta?.teams), text('No team'))} onValueChange={(v) => set({ team: v ? Number(v) : null })} />
            </Labeled>
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">{text('Due')}</span>
              <input type="datetime-local" aria-label={text('Due')} value={f.due} onChange={(e) => set({ due: e.target.value })} className={FIELD} />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">{text('Tags')}</span>
              <span className="flex min-h-8 flex-wrap items-center gap-1 rounded-[8px] border border-line bg-surface px-1.5 py-1">
                {f.tags.map((name) => (
                  <span key={name} className="inline-flex items-center gap-0.5 rounded-full bg-subtle py-0.5 pr-1 pl-2 text-[11.5px] text-ink-2">
                    {name}
                    <button type="button" aria-label={text('Remove the tag {tag}', { tag: name })} onClick={() => set({ tags: latest.current.tags.filter((x) => x !== name) })} className="rounded-full p-0.5 hover:bg-line">
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
                <input
                  value={tag}
                  list="support-new-ticket-tags"
                  onChange={(e) => setTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) return;
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  aria-label={text('Add a tag')}
                  placeholder={f.tags.length ? text('Add…') : text('Add a tag…')}
                  className="h-6 w-20 min-w-0 flex-1 bg-transparent px-1 text-[12px] text-ink outline-none"
                />
                <datalist id="support-new-ticket-tags">
                  {suggest.slice(0, 50).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </span>
            </div>
          </div>
          <label className={cx('flex items-center gap-2 text-[13px]', email ? 'text-ink' : 'text-ink-3')}>
            <Checkbox checked={f.notify && !!email} disabled={!email} onChange={(e) => set({ notify: e.target.checked })} />
            {text('Send the requester a confirmation email')}
            {!email ? <span className="text-[11.5px]">{text('(no email address)')}</span> : null}
          </label>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The requester: a search of my contacts, customers and colleagues (`GET /api/contacts/lookup`), or a new requester by
 * name, email and phone — offered with what was typed, when nobody found is the one.
 */
function RequesterField({ value, onChange, error, emailError }: { value: RequesterChoice; onChange: (patch: Partial<RequesterChoice>) => void; error: string | null; emailError: string | null }) {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 200);
    return () => clearTimeout(t);
  }, [typed]);
  const found = useQuery({ queryKey: K.lookup(q), queryFn: ({ signal }) => findRequesters(q, signal), enabled: value.mode === 'find' && !value.found && q.length >= 2, staleTime: 30_000 });
  const hits = q.length >= 2 ? (found.data ?? []) : [];
  const options: Array<{ key: string; hit: RequesterHit | null }> = [...hits.map((h) => ({ key: `${h.kind}:${h.id}`, hit: h })), ...(typed.trim() ? [{ key: 'new', hit: null }] : [])];
  const highlighted = Math.min(pick, Math.max(0, options.length - 1));
  const choose = (o: { hit: RequesterHit | null }) => {
    if (o.hit) onChange({ mode: 'find', found: o.hit });
    else onChange({ mode: 'new', found: null, ...seedFrom(typed) });
    setTyped('');
    setPick(0);
  };

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={cx(LABEL, 'mb-1')}>{text('Requester')}</legend>
      {value.mode === 'find' && value.found ? (
        <div data-requester={value.found.id} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-subtle px-3 py-2">
          <Avatar name={value.found.name ?? value.found.email} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink">{value.found.name || value.found.email || text('Unknown requester')}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{[text(KIND_LABEL[value.found.kind] ?? 'Contact'), value.found.email, value.found.phone].filter(Boolean).join(' · ')}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange({ found: null })}>
            {text('Change')}
          </Button>
        </div>
      ) : value.mode === 'find' ? (
        <div className="relative">
          <span className="relative flex items-center">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-ink-3" />
            <input
              autoFocus
              type="search"
              role="combobox"
              aria-expanded={options.length > 0}
              aria-controls="support-new-requester-list"
              aria-activedescendant={options.length ? `support-new-requester-${highlighted}` : undefined}
              aria-invalid={error ? true : undefined}
              aria-label={text('Find the requester')}
              placeholder={text('Search your contacts by name, email or phone…')}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setPick(0);
              }}
              onKeyDown={(e) => {
                if (!options.length) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPick((p) => (e.key === 'ArrowDown' ? (p + 1) % options.length : (p - 1 + options.length) % options.length));
                } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  choose(options[highlighted]!);
                }
              }}
              className={cx(FIELD, 'w-full pl-8', error && 'border-danger')}
            />
          </span>
          {options.length ? (
            <ul id="support-new-requester-list" role="listbox" aria-label={text('People found')} className="absolute top-full left-0 z-30 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-xl scroll-thin">
              {options.map((o, i) => (
                <li
                  key={o.key}
                  id={`support-new-requester-${i}`}
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  className={cx('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px]', i === highlighted ? 'bg-selection' : 'hover:bg-subtle')}
                >
                  {o.hit ? (
                    <>
                      <Avatar name={o.hit.name ?? o.hit.email} size={22} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{o.hit.name || o.hit.email}</span>
                        <span className="block truncate text-[11px] text-ink-3">{[o.hit.email, o.hit.phone, o.hit.subtitle].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-3">{text(KIND_LABEL[o.hit.kind] ?? 'Contact')}</span>
                    </>
                  ) : (
                    <>
                      <Icon name="user-plus" size={16} className="text-primary" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-primary">{text('Add “{who}” as a new requester', { who: typed.trim() })}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" onClick={() => onChange({ mode: 'new', found: null })} className="mt-1 text-[12px] font-semibold text-primary hover:underline">
            {text('New requester')}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <TextField label={text('Name')} value={value.name} onChange={(e) => onChange({ name: e.target.value })} autoFocus={!value.name} />
            <TextField label={text('Email')} type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} error={emailError} />
            <TextField label={text('Phone')} type="tel" value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} />
          </div>
          <button type="button" onClick={() => onChange({ mode: 'find' })} className="self-start text-[12px] font-semibold text-primary hover:underline">
            {text('Find a contact instead')}
          </button>
        </>
      )}
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </fieldset>
  );
}

/**
 * A field's name above it, as TextField draws its own. `Select`'s `label` names the list for a screen reader only, so
 * without this the selects here had no visible name, and the company picker sat beside Subject's name, not its box.
 */
function Labeled({ label, error, children }: { label: string; error?: string | false | null; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}
