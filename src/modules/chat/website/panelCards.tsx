import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Modal, TextField } from '../../../components/ui';
import { Checkbox } from '../../../components/Checkbox';
import { SharedFiles, type SharedFile } from '../kit/SharedFiles';
import { useNow } from '../../calls/parts';
import { ApiError, apiPatch, apiPost } from '../../../core/api';
import { tagList, websiteAction, WEBSITE, type WebsiteVisitor } from './api';
import { PANEL_CARD as CARD, PANEL_HEADING as HEADING } from './rowParts';

/**
 * The cards both side panels draw (UX-DRW-01, UX-CLS-02): the open thread's visitor details drawer (C-02) and the closed
 * chat's summary (C-06). One set, so the contact, the tags, the files and blocking say and do the same in each.
 */

/** The visitor's clock now, from their browser's time zone (UX-DRW-01); nothing for a zone this computer does not know. */
export function visitorLocalTime(tz: string | null | undefined, now: number): string | null {
  if (!tz) return null;
  try {
    return new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch {
    return null;
  }
}

/**
 * How to reach them (UX-DRW-01): the email with Copy, the phone, and where they are with their local time. `title`
 * heads the card ("Contact" in C-06's summary); `children` are lines after these, such as how many chats they have had.
 */
export function ContactCard({ v, title, children }: { v: WebsiteVisitor | null; title?: string; children?: ReactNode }) {
  const now = useNow(30_000);
  const local = visitorLocalTime(v?.timezone, now);
  if (!v?.email && !v?.phone && !v?.city && !v?.country && !children) return null;
  return (
    <div className={CARD}>
      {title ? <h3 className={HEADING}>{title}</h3> : null}
      {v?.email ? (
        <div className="flex items-center gap-2">
          <Icon name="mail" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate font-semibold text-ink selectable" title={v.email}>{v.email}</span>
          <button type="button" aria-label={text('Copy email')} title={text('Copy email')} onClick={() => void navigator.clipboard.writeText(v.email!).then(() => toast('success', text('Copied.')))} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="copy" size={13} />
          </button>
        </div>
      ) : null}
      {v?.phone ? (
        <div className="flex items-center gap-2">
          <Icon name="phone" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate font-semibold text-ink selectable">{v.phone}</span>
        </div>
      ) : null}
      {v?.city || v?.country ? (
        <div className="flex items-center gap-2">
          <Icon name="map-pin" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 text-ink-2">
            <span>{[v.city, v.country].filter(Boolean).join(', ')}</span>
            {local ? <span className="text-ink-3"> · {text('{time} local', { time: local })}</span> : null}
          </span>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** The chat's tags (UX-DRW-01, UX-CLS-02): removed with their ×, added with "+ Tag"; read-only for somebody who cannot reply. */
export function TagsCard({ conversationId, tags: raw, canEdit, onDone }: { conversationId: number; tags: string[] | string | null | undefined; canEdit: boolean; onDone: () => void }) {
  const [tagging, setTagging] = useState<string | null>(null);
  const tags = tagList(raw);
  const save = (next: string[]) =>
    void websiteAction(conversationId, 'tag', { tags: next.join(',') }).then(
      () => onDone(),
      (e) => toast('error', errorMessage(e)),
    );
  return (
    <div className={CARD}>
      <h3 className={HEADING}>Tags</h3>
      <div className="flex flex-wrap gap-[5px]">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-[8px] bg-selection px-2 py-0.5 text-[11px] font-semibold text-primary">
            {t}
            {canEdit ? (
              <button type="button" aria-label={text('Remove tag {tag}', { tag: t })} onClick={() => save(tags.filter((x) => x !== t))} className="text-primary/70 hover:text-primary">
                <Icon name="x" size={10} />
              </button>
            ) : null}
          </span>
        ))}
        {canEdit ? (
          tagging === null ? (
            <button type="button" onClick={() => setTagging('')} className="rounded-[8px] border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink">
              + {text('Tag')}
            </button>
          ) : (
            <input
              autoFocus
              aria-label={text('New tag')}
              value={tagging}
              maxLength={40}
              onChange={(e) => setTagging(e.target.value)}
              onBlur={() => setTagging(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTagging(null);
                if (e.key === 'Enter' && tagging.trim()) {
                  save([...tags, tagging.trim().replace(/,/g, ' ')]);
                  setTagging(null);
                }
              }}
              className="h-6 w-24 rounded-[8px] border border-primary bg-surface px-1.5 text-[11px] outline-none"
            />
          )
        ) : !tags.length ? (
          <span className="text-[11px] text-ink-3">{text('No tags')}</span>
        ) : null}
      </div>
    </div>
  );
}

/** The files shared in the chat, with their count (UX-DRW-01, UX-CLS-02); nothing when there are none. */
export function SharedFilesCard({ files }: { files: SharedFile[] }) {
  if (!files.length) return null;
  return (
    <div className={CARD}>
      <h3 className={HEADING}>Shared files · {files.length}</h3>
      <SharedFiles files={files} />
    </div>
  );
}

/**
 * Block this visitor (GATE-08, SEC-10): for how long — a week unless somebody chooses otherwise; until lifted sends no
 * days — and why. From the drawer's Block (C-02) and the closed chat's Block visitor (C-06).
 */
/**
 * Block, for a day, a week, a month or until lifted, with a reason (GATE-08): on the visitor's chat when there is one,
 * else on the visitor themselves — somebody browsing in Visitors online who has not written yet (C-07).
 */
export function BlockDialog({ conversationId, visitorId, name, onClose, onDone }: { conversationId: number | null; visitorId?: number; name: string; onClose: () => void; onDone: () => void }) {
  const [blockFor, setBlockFor] = useState('7');
  const [blockWhy, setBlockWhy] = useState('');
  return (
    <Modal
      title="Block this visitor?"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose();
              const reason = blockWhy.trim() || null;
              const done = conversationId !== null
                ? websiteAction(conversationId, 'block', { reason, ...(blockFor ? { days: Number(blockFor) } : {}) })
                : apiPost(`${WEBSITE}/visitors/${visitorId}/block`, { days: blockFor ? Number(blockFor) : null, reason });
              void done.then(
                () => (toast('success', 'Visitor blocked.'), onDone()),
                (e) => toast('error', errorMessage(e)),
              );
            }}
          >
            Block
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">{name} will no longer be able to start chats on your websites until the block ends. You can lift it sooner on the web, under Website chats › Blocked visitors.</p>
      <div className="mt-3 grid gap-3">
        <Select
          label="For"
          value={blockFor}
          options={[{ value: '1', label: 'A day' }, { value: '7', label: 'A week' }, { value: '30', label: 'A month' }, { value: '', label: 'Until somebody lifts it' }]}
          onValueChange={(v) => setBlockFor(String(v))}
        />
        <TextField label="Reason" placeholder="Spam, abuse…" maxLength={190} value={blockWhy} onChange={(e) => setBlockWhy(e.target.value)} />
      </div>
    </Modal>
  );
}

/**
 * Edit the visitor's details — name, email, phone and company — from the visitor card, and save them to their WorkSuite
 * contact too (the linked one, one with the same email in your book, or a new one), which links the visitor to it.
 */
export function VisitorDetailsDialog({ v, onClose, onDone }: { v: WebsiteVisitor; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(v.name ?? '');
  const [email, setEmail] = useState(v.email ?? '');
  const [phone, setPhone] = useState(v.phone ?? '');
  const [company, setCompany] = useState(v.company ?? '');
  const [toContacts, setToContacts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await apiPatch<{ contact: { id: number; name: string; created: boolean } | null }>(`${WEBSITE}/visitors/${v.id}`, {
        name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(), ...(toContacts ? { save_contact: true } : {}),
      });
      toast('success', r.contact ? (r.contact.created ? text('Saved as a new contact: {name}.', { name: r.contact.name }) : text('Saved to {name} in Contacts.', { name: r.contact.name })) : text('Visitor details saved.'));
      onClose();
      onDone();
    } catch (e) {
      const fields = e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as Record<string, string>) : {};
      setErrors(fields);
      if (!Object.keys(fields).length) toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Visitor details"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <TextField label="Name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" maxLength={190} value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextField label="Phone number" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
        <TextField label="Company" maxLength={190} value={company} onChange={(e) => setCompany(e.target.value)} />
        <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink">
          <Checkbox checked={toContacts} onChange={(e) => setToContacts(e.target.checked)} className="mt-0.5" />
          <span>
            Also save to Contacts
            <span className="block text-[12px] text-ink-3">Updates the visitor&apos;s contact, or one with the same email, or adds a new one.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
