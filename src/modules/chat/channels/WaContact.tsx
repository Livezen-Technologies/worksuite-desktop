import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, apiGet } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { formatPhone, waDigits } from '../../../core/phone';
import { navigate } from '../../../core/tabs';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import type { MenuItem } from '../../../components/Menu';
import { Avatar, Button, ErrorNote, Modal, Spinner, avatarTone, cx } from '../../../components/ui';
import { pillOf, SOCIAL, typeOf, type Contact, type ContactForm, type ContactType } from '../../contacts/api';
import { EditDrawer } from '../../contacts/EditDrawer';
import { addPhoneToContact } from '../../contacts/phones';
import { mediaUrl } from '../types';
import { WA, useWaSettings } from './whatsapp';
import type { WaWho } from './wa-names';

/**
 * The contact behind a WhatsApp conversation (worksuite-desktop#176): its picture, the panel opened from the header,
 * and the two ways to put an unknown number in Contacts — a new contact, prefilled, or the number added to one that
 * exists. `waContactMenuItems()` is the same two actions (or "Open contact") for a conversation's right-click menu.
 */

/** Where a contact opens in Contacts. */
export const contactRoute = (id: number) => `/contacts?open=${id}`;

/**
 * The conversation's picture: the contact's photo, then the WhatsApp one, then initials — a person icon, never "+".
 * The icon sits on the colour that always goes with that number (#155), so an unknown number looks the same in every
 * row and every time, and two of them side by side can be told apart.
 */
export function WaAvatar({ who, size = 34, className }: { who: Pick<WaWho, 'name' | 'avatars' | 'initialsOf' | 'group'> & Partial<Pick<WaWho, 'e164'>>; size?: number; className?: string }) {
  const src = who.avatars.map((u) => mediaUrl(u)).find(Boolean) ?? null;
  if (!who.initialsOf && !src) {
    return (
      <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full', avatarTone(who.e164 ?? who.name), who.group && '!rounded-[9px]', className)} style={{ width: size, height: size }}>
        <Icon name={who.group ? 'users' : 'user'} size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return <Avatar name={who.initialsOf || who.name} size={size} src={src} className={cx(who.group && '!rounded-[9px]', className)} />;
}

/** "Add to contacts" / "Link to existing contact", or "Open contact": for a conversation's right-click menu. */
export function waContactMenuItems(who: WaWho, act: { add: () => void; link: () => void; open: (id: number) => void }): MenuItem[] {
  if (who.group) return [];
  if (who.contact) return [{ id: 'wa-open-contact', label: 'Open contact', icon: 'contact', onSelect: () => act.open(who.contact!.id) }];
  if (!who.e164) return [];
  return [
    { id: 'wa-add-contact', label: 'Add to contacts', icon: 'user-plus', onSelect: act.add },
    { id: 'wa-link-contact', label: 'Link to existing contact', icon: 'link', onSelect: act.link },
  ];
}

/** After Contacts changed for WhatsApp's sake: the names re-read everywhere at once. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['contacts'] });
    void qc.invalidateQueries({ queryKey: ['whatsapp'] });
  };
}

/**
 * A new contact for an unknown number, prefilled: the number (as mobile and WhatsApp), the WhatsApp profile name, the
 * type WhatsApp's settings give new contacts (Customer unless changed) and a "WhatsApp" label for where it came from.
 */
export function AddToContacts({ who, onClose }: { who: WaWho; onClose: () => void }) {
  const settings = useWaSettings(true);
  const refresh = useRefresh();
  if (settings.isLoading) return null;
  const type = String(settings.data?.settings?.whatsapp_new_contact_type ?? 'customer') as ContactType;
  const shown = who.e164 ? formatPhone(who.e164) : '';
  const defaults: Partial<ContactForm> = {
    display_name: who.profileName ?? '',
    mobile: shown,
    type,
    labels: 'WhatsApp',
    social: Object.fromEntries(SOCIAL.map((s) => [s.key, s.key === 'whatsapp' ? (who.e164 ?? '') : ''])),
  };
  return (
    <EditDrawer
      contact={null}
      defaults={defaults}
      groups={[]}
      onClose={onClose}
      onSaved={() => {
        refresh();
        onClose();
      }}
    />
  );
}

/** Find a contact and add this number to it. */
export function LinkToContact({ who, onClose }: { who: WaWho; onClose: () => void }) {
  const [q, setQ] = useState(who.profileName ?? '');
  const [busy, setBusy] = useState<number | null>(null);
  const refresh = useRefresh();
  const term = q.trim();
  const found = useQuery({
    queryKey: ['contacts', 'link-search', term],
    enabled: term.length >= 2,
    queryFn: async ({ signal }) => {
      const mine = await apiGet<Contact[]>('/api/contacts', { q: term }, signal);
      // A company's book too, for whoever may see it; refused or absent is simply none.
      const org = await apiGet<Contact[] | { contacts: Contact[] }>('/api/contacts', { q: term, scope: 'org' }, signal).catch(() => [] as Contact[]);
      const more = Array.isArray(org) ? org : (org.contacts ?? []);
      const seen = new Set(mine.map((c) => c.id));
      return [...mine, ...more.filter((c) => !seen.has(c.id))].slice(0, 30);
    },
    staleTime: 10_000,
  });
  const link = async (c: Contact) => {
    if (!who.e164) return;
    setBusy(c.id);
    try {
      const r = await addPhoneToContact(c.id, who.e164);
      toast('success', `${formatPhone(who.e164)} added to ${c.display_name}${r.field === 'whatsapp' ? ' as their WhatsApp number' : ''}`);
      refresh();
      onClose();
    } catch (e) {
      toast('error', `Not added. ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Link to an existing contact" onClose={onClose} width={460} footer={<Button onClick={onClose}>Cancel</Button>}>
      <div className="flex flex-col gap-3 text-[12.5px]">
        <p className="text-ink-2">Add <b className="text-ink">{who.e164 ? formatPhone(who.e164) : 'this number'}</b> to a contact you already have. Its conversations are then named after them.</p>
        <label className="flex h-[34px] items-center gap-2 rounded-[8px] border border-line px-2.5 text-ink-3 focus-within:border-primary">
          <Icon name="search" size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name, company or email" aria-label="Search contacts" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
        </label>
        {found.isLoading && term.length >= 2 ? <Spinner /> : found.error ? <ErrorNote error={found.error} onRetry={() => void found.refetch()} /> : null}
        {found.data && !found.data.length ? <p className="py-3 text-center text-ink-3">No contact matches.</p> : null}
        {found.data?.length ? (
          <ul aria-label="Contacts" className="flex max-h-[300px] flex-col gap-1 overflow-y-auto scroll-thin">
            {found.data.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={busy !== null} onClick={() => void link(c)} className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-subtle disabled:opacity-60">
                  <Avatar name={c.display_name} size={28} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] text-ink">{c.display_name}</b>
                    <span className="block truncate text-[11.5px] text-ink-3">{[c.company, c.mobile ?? c.office_phone].filter(Boolean).join(' · ') || pillOf(c.type)}</span>
                  </span>
                  {busy === c.id ? <Icon name="spinner" size={14} className="animate-spin-slow text-ink-3" /> : <Icon name="plus" size={14} className="text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}

interface BookContact {
  contact: { id: number; name: string; company: string | null; job_title: string | null; type: string; work_email: string | null; personal_email: string | null; avatar: string | null; labels: string[]; can_edit: boolean };
  phones: Array<{ field: string; e164: string; display: string }>;
  records: {
    deals: Array<{ id: number; name: string; amount: string | number | null; currency: string | null; stage: string | null }> | null;
    invoices: Array<{ id: number; number: string; status: string; total: string | number; currency: string | null; due_date: string | null }> | null;
    tenders: Array<{ id: number; reference: string | null; title: string; stage: string | null; outcome: string | null }> | null;
  };
  notes: Array<{ id: number; body: string; pinned: number | boolean; created_at: string }>;
  activity: Array<{ id: number; type: string; title: string; created_at: string }>;
  conversations: Array<{ id: number; account_name: string; last_message: string | null; unread: number }>;
}

const FIELD: Record<string, string> = { whatsapp: 'WhatsApp', mobile: 'Mobile', office_phone: 'Office', home_phone: 'Home' };

/**
 * The panel opened from a conversation's header: who they are in Contacts — company, type, email, every number,
 * the CRM records that name them (for whoever may see those), notes and recent activity — and "Open in Contacts".
 * For a number in nobody's contacts it offers to add it; for one in several, to pick which they are.
 */
export function ContactPanel({ who, chatId, onClose, onPick, onAdd, onLink }: { who: WaWho; chatId: number; onClose: () => void; onPick: (id: number) => void; onAdd: () => void; onLink: () => void }) {
  const id = who.contact?.id ?? 0;
  const q = useQuery({
    queryKey: ['contacts', 'whatsapp-panel', id],
    queryFn: ({ signal }) => apiGet<BookContact>(`${WA}/book-contacts/${id}`, undefined, signal),
    enabled: id > 0,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.forbidden)) && n < 2,
  });
  const d = q.data;
  return (
    <aside aria-label="Contact" className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-[55px] shrink-0 items-center gap-2 border-b border-line px-3.5">
        <b className="flex-1 text-[14px] text-ink">{who.group ? 'Group' : 'Contact'}</b>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle"><Icon name="x" size={15} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5 text-[12.5px] scroll-thin">
        <div className="flex flex-col items-center gap-1.5 pt-1 text-center">
          <WaAvatar who={who} size={64} />
          <b className="text-[15px] text-ink">{who.name}</b>
          {who.subtitle ? <span className="text-ink-3">{who.subtitle}</span> : null}
          {who.phoneDisplay ? <span className="text-ink-2">{who.phoneDisplay}</span> : null}
          {d ? <span className={cx('rounded-full px-2 py-px text-[11px] font-bold', typeOf(d.contact.type).tone)}>{pillOf(d.contact.type)}</span> : null}
        </div>
        {who.candidates.length > 1 ? (
          <section aria-label="Contacts with this number" className="rounded-[10px] border border-line p-2">
            <p className="mb-1 px-1 font-semibold text-ink">{who.candidates.length} contacts have this number</p>
            {who.candidates.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === id} onClick={() => onPick(c.id)} className={cx('flex w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left', c.id === id ? 'bg-selection' : 'hover:bg-subtle')}>
                <span className="min-w-0 flex-1 truncate"><b className="text-ink">{c.name}</b>{c.company ? <span className="text-ink-3"> · {c.company}</span> : null}</span>
                {c.id === id ? <Icon name="check" size={13} className="text-primary" /> : null}
              </button>
            ))}
          </section>
        ) : null}
        {who.group ? (
          <p className="text-ink-3">Members are named from your contacts in the conversation. Group ID and members are on the web.</p>
        ) : !who.contact ? (
          <div className="flex flex-col gap-2">
            <p className="text-ink-2">{who.profileName ? <>They call themselves <b className="text-ink">{who.profileName}</b> on WhatsApp. </> : null}This number is not in your contacts.</p>
            <Button variant="primary" icon="user-plus" onClick={onAdd}>Add to contacts</Button>
            <Button icon="link" onClick={onLink}>Link to existing contact</Button>
          </div>
        ) : q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : d ? (
          <>
            <Section title="Details">
              {d.contact.job_title ? <Line icon="briefcase" text={d.contact.job_title} /> : null}
              {d.contact.company ? <Line icon="building" text={d.contact.company} /> : null}
              {[d.contact.work_email, d.contact.personal_email].filter(Boolean).map((e) => <Line key={e} icon="mail" text={e!} />)}
              {d.phones.map((p) => <Line key={p.e164} icon="phone" text={`${p.display} · ${FIELD[p.field] ?? p.field}${p.e164 === who.e164 ? ' · this chat' : ''}`} />)}
              {d.contact.labels.length ? <Line icon="tag" text={d.contact.labels.join(', ')} /> : null}
            </Section>
            {d.records.deals?.length ? <Section title="Deals">{d.records.deals.map((x) => <Line key={x.id} icon="handshake" text={[x.name, x.stage, x.amount ? `${x.currency ?? ''} ${x.amount}`.trim() : null].filter(Boolean).join(' · ')} />)}</Section> : null}
            {d.records.invoices?.length ? <Section title="Invoices">{d.records.invoices.map((x) => <Line key={x.id} icon="receipt" text={[x.number, x.status, `${x.currency ?? ''} ${x.total}`.trim()].join(' · ')} />)}</Section> : null}
            {d.records.tenders?.length ? <Section title="Tenders">{d.records.tenders.map((x) => <Line key={x.id} icon="file-text" text={[x.reference, x.title, x.outcome ?? x.stage].filter(Boolean).join(' · ')} />)}</Section> : null}
            {d.notes.length ? <Section title="Notes">{d.notes.map((n) => <p key={n.id} className="line-clamp-3 rounded-[8px] bg-ground px-2 py-1.5 whitespace-pre-wrap text-ink-2">{n.body}</p>)}</Section> : null}
            {d.activity.length ? <Section title="Recent activity">{d.activity.map((a) => <Line key={a.id} icon={a.type === 'email' ? 'mail' : a.type === 'call' ? 'phone' : 'activity'} text={a.title} />)}</Section> : null}
            {d.conversations.filter((c) => c.id !== chatId).length ? (
              <Section title="Other WhatsApp conversations">
                {d.conversations.filter((c) => c.id !== chatId).map((c) => (
                  <button key={c.id} type="button" onClick={() => navigate(`/chat?channel=whatsapp&wa=${c.id}`)} className="truncate text-left text-primary hover:underline">On {c.account_name}{c.unread ? ` · ${c.unread} unread` : ''}</button>
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
        {!who.group && who.e164 && who.contact ? (
          <Button icon="contact" onClick={() => navigate(contactRoute(who.contact!.id))}>Open in Contacts</Button>
        ) : null}
        {!who.group && who.e164 && who.contact ? (
          <button type="button" onClick={() => void navigator.clipboard?.writeText(`+${waDigits(who.e164!)}`)} className="self-center text-[11.5px] text-ink-3 hover:underline">Copy number</button>
        ) : null}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Line({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-ink">
      <Icon name={icon} size={13} className="shrink-0 text-ink-3" />
      <span className="min-w-0 truncate" title={text}>{text}</span>
    </span>
  );
}
