import { useQuery, useQueryClient } from '@tanstack/react-query';
import { whatsappRoute } from '@shared/channels';
import { useState, type ReactNode } from 'react';
import { useCanOpen } from '../../core/access';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { createMeeting, openMeeting } from '../meet/api';
import { SOCIAL, addressOf, birthdayOf, digits, initials, pillOf, stampLabel, subLine, typeOf, type Activity, type Contact, type ContactDetail, type ContactNote } from './api';
import { WhatsappSend } from './WhatsappSend';

type Tab = 'det' | 'notes' | 'act';

const ACTIVITY: Record<string, { icon: string; color: string }> = {
  email: { icon: 'mail', color: '#23349E' },
  chat: { icon: 'chat', color: '#0E7C86' },
  meeting: { icon: 'video', color: '#7C3AED' },
  call: { icon: 'phone', color: '#0E7C86' },
  task: { icon: 'check-circle', color: '#1F7A4D' },
  note: { icon: 'file-text', color: '#B45309' },
  favorite: { icon: 'star', color: '#D97706' },
  updated: { icon: 'compose', color: '#5B6275' },
  created: { icon: 'plus', color: '#1F7A4D' },
};

/** Tell the contact's timeline what was done from here; a failure is not worth an error. */
function logAct(id: number, type: 'email' | 'chat' | 'meeting' | 'task' | 'call', title: string): Promise<unknown> {
  return apiPost(`/api/contacts/${id}/log`, { type, title }).catch(() => undefined);
}

/**
 * One contact (ContactDrawer): who they are, one click to mail, chat, meet,
 * schedule or make a task, then their details, your notes and the timeline.
 */
export function ContactDrawer({ id, card, onClose, onEdit, onGone }: { id: number; card?: Contact; onClose: () => void; onEdit: (c: ContactDetail) => void; onGone: () => void }) {
  const qc = useQueryClient();
  const { navigate } = useTab();
  const [tab, setTab] = useState<Tab>('det');
  const [deleting, setDeleting] = useState(false);
  // Each quick action opens another app; one the person was not given is not offered.
  const canMail = useCanOpen('mail');
  const canChat = useCanOpen('chat');
  const canMeet = useCanOpen('meet');
  const canCalendar = useCanOpen('calendar');
  const canTasks = useCanOpen('tasks');
  const detail = useQuery({ queryKey: ['contacts', 'detail', id], queryFn: ({ signal }) => apiGet<ContactDetail>(`/api/contacts/${id}`, undefined, signal) });
  const notes = useQuery({ queryKey: ['contacts', 'notes', id], queryFn: ({ signal }) => apiGet<ContactNote[]>(`/api/contacts/${id}/notes`, undefined, signal) });
  const found: (Contact & Partial<ContactDetail>) | undefined = detail.data ?? card;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['contacts'] });

  // Opened by a link to a contact not in the list shown: its own record, once it arrives.
  if (!found) {
    return (
      <>
        <div className="no-drag absolute inset-0 z-20 bg-[#0F1B3D]/[.18]" onMouseDown={onClose} />
        <aside role="dialog" aria-label="Contact" className="no-drag absolute top-0 right-0 bottom-0 z-30 flex w-[460px] max-w-full flex-col border-l border-line bg-surface shadow-[-20px_0_50px_rgb(var(--ws-shadow-rgb)/.14)]">
          <div className="flex h-14 shrink-0 items-center border-b border-line pr-2.5 pl-5">
            <b className="flex-1 text-[15px] text-ink">Contact</b>
            <HeadButton label="Close" onClick={onClose}>
              <Icon name="x" size={17} />
            </HeadButton>
          </div>
          <div className="p-4">{detail.error ? <ErrorNote error={detail.error} onRetry={() => void detail.refetch()} /> : <Spinner />}</div>
        </aside>
      </>
    );
  }
  const c = found;
  const email = c.work_email || c.personal_email;

  const toggle = async (what: 'favorite' | 'archive') => {
    try {
      const r = await apiPost<{ is_favorite?: boolean; is_archived?: boolean }>(`/api/contacts/${id}/${what}`);
      qc.setQueryData<ContactDetail>(['contacts', 'detail', id], (old) => (old ? { ...old, ...r } : old));
      if (what === 'archive') toast('success', r.is_archived ? 'Archived' : 'Restored');
      else toast('success', r.is_favorite ? 'Added to favorites' : 'Removed from favorites');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const remove = async () => {
    setDeleting(false);
    try {
      await apiDelete(`/api/contacts/${id}`);
      toast('success', 'Contact deleted');
      refresh();
      onGone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const actions: Array<{ label: string; icon: string; shown: boolean; on: boolean; go: () => void }> = [
    {
      label: 'Email',
      icon: 'mail',
      shown: canMail,
      on: !!email,
      go: () => {
        if (!email) return toast('info', 'No email on file');
        void logAct(id, 'email', `Emailed ${email}`);
        navigate(`/mail?compose=1&to=${encodeURIComponent(email)}`);
      },
    },
    {
      label: 'Chat',
      icon: 'chat',
      shown: canChat,
      on: !!c.user_id,
      go: async () => {
        if (!c.user_id) return toast('info', 'Link this contact to a team member to chat');
        try {
          const r = await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: c.user_id });
          void logAct(id, 'chat', `Started a chat with ${c.display_name}`);
          navigate(`/chat?room=${r.room_id}`);
        } catch (e) {
          toast('error', `Could not open chat. ${errorMessage(e)}`);
        }
      },
    },
    {
      label: 'Meet',
      icon: 'video',
      shown: canMeet,
      on: true,
      go: async () => {
        try {
          const m = await createMeeting({ title: `Meeting with ${c.display_name}` });
          void logAct(id, 'meeting', `Started a meeting with ${c.display_name}`);
          await openMeeting(m.uuid, m.title);
        } catch (e) {
          toast('error', `Could not start meeting. ${errorMessage(e)}`);
        }
      },
    },
    {
      label: 'Schedule',
      icon: 'calendar',
      shown: canCalendar,
      on: true,
      go: () => {
        void logAct(id, 'meeting', `Opened Calendar to schedule with ${c.display_name}`);
        navigate(`/calendar?new=1&title=${encodeURIComponent(`Meeting with ${c.display_name}`)}`);
      },
    },
    {
      label: 'Task',
      icon: 'check-circle',
      shown: canTasks,
      on: true,
      go: () => {
        void logAct(id, 'task', `Opened Tasks for ${c.display_name}`);
        navigate(`/tasks?new=1&title=${encodeURIComponent(`Follow up with ${c.display_name}`)}`);
      },
    },
  ].filter((a) => a.shown);

  const tone = typeOf(c.type).tone;
  const color = c.avatar_color ?? '#23349E';
  const noteCount = notes.data?.length ?? 0;

  return (
    <>
      <div className="no-drag absolute inset-0 z-20 bg-[#0F1B3D]/[.18]" onMouseDown={onClose} />
      <aside role="dialog" aria-label={`Contact ${c.display_name}`} className="no-drag absolute top-0 right-0 bottom-0 z-30 flex w-[460px] max-w-full flex-col border-l border-line bg-surface shadow-[-20px_0_50px_rgb(var(--ws-shadow-rgb)/.14)]">
        <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-line pr-2.5 pl-5">
          <b className="flex-1 text-[15px] text-ink">Contact</b>
          <HeadButton label={c.is_favorite ? 'Remove from favorites' : 'Add to favorites'} pressed={c.is_favorite} onClick={() => void toggle('favorite')} className="text-[#D97706]">
            <Icon name="star" size={17} className={c.is_favorite ? 'fill-current' : ''} />
          </HeadButton>
          <HeadButton label="Edit" disabled={!detail.data} onClick={() => detail.data && onEdit(detail.data)}>
            <Icon name="compose" size={17} />
          </HeadButton>
          <HeadButton label={c.is_archived ? 'Restore' : 'Archive'} onClick={() => void toggle('archive')}>
            <Icon name={c.is_archived ? 'undo' : 'archive'} size={17} />
          </HeadButton>
          <HeadButton label="Delete" onClick={() => setDeleting(true)} className="text-danger">
            <Icon name="trash" size={17} />
          </HeadButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <HeadButton label="Close" onClick={onClose}>
            <Icon name="x" size={17} />
          </HeadButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin">
          {c.is_archived ? (
            <div className="mx-4 mt-3 flex items-center gap-2 rounded-[10px] border border-line bg-ground px-3 py-2 text-[12.5px] text-ink-2">
              <Icon name="archive" size={15} className="text-ink-3" />
              <span className="flex-1">This contact is archived. It is hidden from lists and pickers.</span>
              <button type="button" onClick={() => void toggle('archive')} className="h-[26px] rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-bold text-primary">Restore</button>
            </div>
          ) : null}
          <div className="flex shrink-0 flex-col items-center gap-1 px-5 pt-5 pb-4" style={{ background: `linear-gradient(180deg, ${color}14 0%, transparent 100%)` }}>
            <span className={cx('flex h-[76px] w-[76px] items-center justify-center rounded-full text-[26px] font-bold text-white shadow-[0_0_0_4px_var(--color-surface),0_6px_18px_rgb(var(--ws-shadow-rgb)/.15)]', c.is_archived && 'opacity-55')} style={{ background: color }}>
              {initials(c.display_name)}
            </span>
            <b className="mt-2.5 text-center text-[19px] tracking-[-0.2px] text-ink">{c.display_name}</b>
            <span className="text-center text-[13px] text-ink-2">{subLine(c)}</span>
            <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
              <span className={cx('inline-flex h-5 items-center rounded-[10px] px-2 text-[11px] font-bold', tone)}>{pillOf(c.type)}</span>
              {c.labels.map((l) => (
                <span key={l} className="inline-flex h-5 items-center rounded-[10px] bg-subtle px-2 text-[11px] font-semibold text-ink-2">{l}</span>
              ))}
            </div>
            {actions.length ? (
              <div className="mt-3.5 flex gap-1.5">
                {actions.map((a) => (
                  <span key={a.label} className="flex w-16 flex-col items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={a.label}
                      title={a.on ? a.label : a.label === 'Email' ? 'No email on file' : 'Link this contact to a team member to chat'}
                      onClick={() => void a.go()}
                      className={cx('flex h-[46px] w-[46px] items-center justify-center rounded-full border', a.on ? 'border-[#DCE2F5] bg-selection text-primary hover:brightness-95 dark:border-line' : 'border-line bg-ground text-ink-3')}
                    >
                      <Icon name={a.icon} size={19} />
                    </button>
                    <span className="text-[11.5px] font-semibold text-ink-2">{a.label}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div role="tablist" aria-label="Contact" className="sticky top-0 z-[1] flex shrink-0 gap-1 border-b border-line bg-surface px-4">
            {(
              [
                ['det', 'Details', 0],
                ['notes', 'Notes', noteCount],
                ['act', 'Activity', 0],
              ] as const
            ).map(([k, l, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('flex h-[42px] items-center gap-1.5 px-2.5 text-[13px]', tab === k ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-semibold text-ink-3 hover:text-ink')}>
                {l}
                {n ? <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-selection px-[5px] text-[10.5px] text-primary">{n}</span> : null}
              </button>
            ))}
          </div>
          {tab === 'det' ? (
            detail.error && !detail.data ? (
              <div className="p-4"><ErrorNote error={detail.error} onRetry={() => void detail.refetch()} /></div>
            ) : (
              <Details c={c} loading={detail.isLoading} />
            )
          ) : tab === 'notes' ? (
            <Notes id={id} list={notes.data} loading={notes.isLoading} />
          ) : (
            <Timeline id={id} />
          )}
        </div>
      </aside>
      {deleting ? (
        <Modal
          title="Delete contact"
          onClose={() => setDeleting(false)}
          width={380}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => void remove()}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">Delete {c.display_name}?</p>
        </Modal>
      ) : null}
    </>
  );
}

function HeadButton({ label, onClick, children, className, pressed, disabled }: { label: string; onClick: () => void; children: ReactNode; className?: string; pressed?: boolean; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cx('flex h-8 w-8 items-center justify-center rounded-[9px] hover:bg-subtle disabled:opacity-40', className ?? 'text-ink-2')}>
      {children}
    </button>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', 'Copied');
  } catch {
    toast('error', 'Could not copy.');
  }
}

type Row = { k: string; icon: string; v: string; wide?: boolean; go?: () => void; phone?: string; copy?: boolean };

/** Communication, Business and More, then social links and the notes field. */
function Details({ c, loading }: { c: Contact & Partial<ContactDetail>; loading: boolean }) {
  const { navigate } = useTab();
  // An address opens Mail's compose, and a number WhatsApp, only for whoever has them; the copy button stays.
  const canMail = useCanOpen('mail');
  const canWhatsapp = useCanOpen('whatsapp');
  const [menu, setMenu] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const mail = (to: string) => {
    void logAct(c.id, 'email', `Emailed ${to}`);
    navigate(`/mail?compose=1&to=${encodeURIComponent(to)}`);
  };
  const web = (url: string) => void call('app:openExternal', { url: /^https?:\/\//i.test(url) ? url.replace(/^http:/i, 'https:') : `https://${url}` });
  const groups = (c.groups ?? []).map((g) => g.name).join(', ');
  const sections: Array<{ t: string; rows: Array<Row | null> }> = [
    {
      t: 'Communication',
      rows: [
        c.work_email ? { k: 'Work email', icon: 'mail', v: c.work_email, wide: true, copy: true, go: canMail ? () => mail(c.work_email!) : undefined } : null,
        c.personal_email ? { k: 'Personal email', icon: 'mail', v: c.personal_email, copy: true, go: canMail ? () => mail(c.personal_email!) : undefined } : null,
        c.mobile ? { k: 'Mobile', icon: 'mobile', v: c.mobile, phone: c.mobile } : null,
        c.office_phone ? { k: 'Office phone', icon: 'phone', v: c.office_phone, phone: c.office_phone } : null,
        c.home_phone ? { k: 'Home phone', icon: 'phone', v: c.home_phone, phone: c.home_phone } : null,
        c.website ? { k: 'Website', icon: 'globe', v: c.website, go: () => web(c.website!) } : null,
      ],
    },
    {
      t: 'Business',
      rows: [
        c.company ? { k: 'Company', icon: 'building', v: c.company } : null,
        c.department ? { k: 'Department', icon: 'briefcase', v: c.department } : null,
        c.customer_id ? { k: 'Customer ID', icon: 'id-card', v: c.customer_id } : null,
        c.employee_id ? { k: 'Employee ID', icon: 'id-card', v: c.employee_id } : null,
        c.vendor_id ? { k: 'Vendor ID', icon: 'id-card', v: c.vendor_id } : null,
        c.tax_number ? { k: 'Tax number', icon: 'tag', v: c.tax_number } : null,
      ],
    },
    {
      t: 'More',
      rows: [
        c.street !== undefined && addressOf(c as ContactDetail) ? { k: 'Address', icon: 'map-pin', v: addressOf(c as ContactDetail), wide: true } : null,
        c.birthday ? { k: 'Birthday', icon: 'cake', v: birthdayOf(c.birthday), wide: true } : null,
        groups ? { k: 'Groups', icon: 'users', v: groups, wide: true } : null,
      ],
    },
  ];
  const social = SOCIAL.filter((s) => c.social?.[s.key]);
  const shown = sections.map((s) => ({ t: s.t, rows: s.rows.filter((r): r is Row => !!r) })).filter((s) => s.rows.length);

  return (
    <div className="flex flex-col gap-2.5 px-4 pt-3 pb-4">
      {loading ? <Spinner /> : null}
      {!loading && !shown.length && !social.length && !c.notes ? <p className="py-6 text-center text-[12.5px] text-ink-3">Nothing more on file. Edit the contact to add details.</p> : null}
      {shown.map((s) => (
        <section key={s.t} aria-label={s.t} className="shrink-0 rounded-[12px] border border-line">
          <div className="rounded-t-[12px] bg-ground px-3 py-[7px] text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">{s.t}</div>
          <div className="grid grid-cols-2">
            {s.rows.map((r) => (
              <div key={r.k} className={cx('relative flex min-w-0 items-center gap-2.5 border-t border-line/60 px-3 py-[7px]', (r.wide || s.rows.length === 1) && 'col-span-2')}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-ground text-ink-2"><Icon name={r.icon} size={15} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] text-ink-3">{r.k}</span>
                  {r.go || r.phone ? (
                    <button type="button" aria-haspopup={r.phone ? 'menu' : undefined} aria-expanded={r.phone ? menu === r.k : undefined} onClick={() => (r.phone ? setMenu(menu === r.k ? null : r.k) : r.go!())} className="truncate text-left text-[13px] font-semibold text-primary hover:underline">
                      {r.v}
                    </button>
                  ) : (
                    <span className="text-[13px] leading-[1.4] font-semibold break-words text-ink">{r.v}</span>
                  )}
                </span>
                {r.go || r.phone || r.copy ? (
                  <button type="button" title="Copy" aria-label={`Copy ${r.k.toLowerCase()}`} onClick={() => void copy(r.v)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-subtle hover:text-ink">
                    <Icon name="copy" size={13} />
                  </button>
                ) : null}
                {r.phone && menu === r.k ? (
                  <PhoneMenu
                    phone={r.phone}
                    onClose={() => setMenu(null)}
                    onWhatsapp={canWhatsapp ? () => (setMenu(null), setWhatsapp(r.phone!)) : undefined}
                    onCall={() => {
                      setMenu(null);
                      void logAct(c.id, 'call', `Called ${r.phone}`);
                      void call('app:openExternal', { url: `tel:+${digits(r.phone!)}` });
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
      {social.length ? (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {social.map((s) => (
            <button key={s.key} type="button" title={c.social![s.key]} onClick={() => void call('app:openExternal', { url: s.url(c.social![s.key]!) })} className="flex h-[26px] items-center gap-1.5 rounded-[13px] border border-line px-2.5 text-[12px] font-semibold text-primary hover:bg-subtle">
              <Icon name="link" size={12} /> {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {c.notes ? <div className="shrink-0 rounded-[10px] border border-[#F6E3B4] bg-[#FFF8E6] px-3 py-2.5 text-[12.5px] leading-[1.5] whitespace-pre-wrap text-[#5C4A12] dark:border-warning/30 dark:bg-warning-bg dark:text-warning">{c.notes}</div> : null}
      {whatsapp ? <WhatsappSend phone={whatsapp} name={c.display_name} contactId={c.id} onClose={() => setWhatsapp(null)} /> : null}
    </div>
  );
}

/** Call, and — for whoever has WhatsApp — send on it or open the conversation there (Chat › WhatsApp). */
function PhoneMenu({ phone, onClose, onWhatsapp, onCall }: { phone: string; onClose: () => void; onWhatsapp?: () => void; onCall: () => void }) {
  const { navigate } = useTab();
  const d = digits(phone);
  const item = 'flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[12.5px] font-semibold text-ink hover:bg-ground';
  return (
    <>
      <div className="fixed inset-0 z-10" onMouseDown={onClose} />
      <div role="menu" aria-label="Phone" className="absolute top-10 left-12 z-20 flex w-[230px] flex-col rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.16)]">
        {onWhatsapp && d.length >= 7 ? (
          <>
            <button type="button" role="menuitem" autoFocus onClick={onWhatsapp} className={item}>
              <Icon name="send" size={15} className="text-[#15803D]" /> Send a WhatsApp message
            </button>
            <button type="button" role="menuitem" onClick={() => (onClose(), navigate(whatsappRoute({ to: d })))} className={item}>
              <Icon name="user" size={15} className="text-ink-2" /> Open the conversation
            </button>
          </>
        ) : null}
        <button type="button" role="menuitem" onClick={onCall} className={item}>
          <Icon name="phone" size={15} className="text-ink-2" /> Call
        </button>
      </div>
    </>
  );
}

/** Your notes on the contact: pinned ones first, each editable. */
function Notes({ id, list, loading }: { id: number; list: ContactNote[] | undefined; loading: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['contacts', 'notes', id] });
  const sorted = [...(list ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await apiPost(`/api/contacts/${id}/notes`, { body });
      setText('');
      refresh();
      void qc.invalidateQueries({ queryKey: ['contacts', 'activity', id] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const put = async (noteId: number, body: Record<string, unknown>) => {
    try {
      await apiPut(`/api/contact-notes/${noteId}`, body);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remove = async () => {
    const n = deleting;
    setDeleting(null);
    if (!n) return;
    try {
      await apiDelete(`/api/contact-notes/${n}`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="overflow-hidden rounded-[12px] border border-line focus-within:border-primary">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void add();
            }
          }}
          aria-label="Add a note"
          placeholder="Add a note…"
          maxLength={5000}
          className="block h-16 w-full resize-none bg-surface px-3 py-2.5 text-[13px] text-ink outline-none"
        />
        <div className="flex items-center justify-between border-t border-line bg-ground py-1.5 pr-2 pl-3">
          <span className="text-[11px] text-ink-3">Ctrl + Enter to add</span>
          <button type="button" disabled={!text.trim()} onClick={() => void add()} className="h-7 rounded-[8px] bg-primary px-3.5 text-[12px] font-bold text-white disabled:opacity-50">Add</button>
        </div>
      </div>
      {loading ? <Spinner /> : null}
      {sorted.map((n) => (
        <div key={n.id} role="article" aria-label={n.pinned ? 'Pinned note' : 'Note'} className={cx('rounded-[12px] border px-3 py-2.5', n.pinned ? 'border-[#F6E3B4] bg-[#FFF8E6] dark:border-warning/30 dark:bg-warning-bg' : 'border-line bg-surface')}>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
            {n.pinned ? (
              <>
                <span className="flex items-center gap-[3px] font-bold text-[#B45309] dark:text-warning"><Icon name="pin" size={11} /> Pinned</span>
                <span>·</span>
              </>
            ) : null}
            <span className="flex-1">{stampLabel(n.created_at)}</span>
            <button type="button" title={n.pinned ? 'Unpin' : 'Pin'} aria-label={n.pinned ? 'Unpin' : 'Pin'} onClick={() => void put(n.id, { pinned: !n.pinned })} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle">
              <Icon name={n.pinned ? 'pin-off' : 'pin'} size={13} />
            </button>
            <button type="button" title="Edit" aria-label="Edit note" onClick={() => setEditing({ id: n.id, body: n.body })} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle">
              <Icon name="compose" size={13} />
            </button>
            <button type="button" title="Delete" aria-label="Delete note" onClick={() => setDeleting(n.id)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-danger hover:bg-subtle">
              <Icon name="trash" size={13} />
            </button>
          </div>
          {editing?.id === n.id ? (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <textarea autoFocus value={editing.body} maxLength={5000} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Note" className="h-20 w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
              <div className="flex justify-end gap-1.5">
                <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!editing.body.trim()} onClick={() => void put(n.id, { body: editing.body.trim() }).then(() => setEditing(null))}>Save</Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-[13px] leading-[1.5] whitespace-pre-wrap text-ink">{n.body}</div>
          )}
        </div>
      ))}
      {list && !list.length ? <div className="p-7 text-center text-[12.5px] text-ink-3">No notes yet</div> : null}
      {deleting ? (
        <Modal
          title="Delete note"
          onClose={() => setDeleting(null)}
          width={360}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void remove()}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">Delete this note? It cannot be brought back.</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** What has happened with the contact, newest first. */
function Timeline({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['contacts', 'activity', id], queryFn: ({ signal }) => apiGet<Activity[]>(`/api/contacts/${id}/activities`, undefined, signal) });
  const list = q.data ?? [];
  return (
    <div className="flex flex-col px-5 py-4">
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {list.map((a, i) => {
        const k = ACTIVITY[a.type] ?? { icon: 'activity', color: '#5B6275' };
        return (
          <div key={a.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border" style={{ background: `${k.color}14`, borderColor: `${k.color}30`, color: k.color }}>
                <Icon name={k.icon} size={14} />
              </span>
              {i < list.length - 1 ? <span className="w-0.5 flex-1 bg-line" /> : null}
            </div>
            <div className="flex flex-col gap-0.5 pt-1 pb-4">
              <span className="text-[13px] font-semibold text-ink">{a.title}</span>
              <span className="text-[11.5px] text-ink-3">{stampLabel(a.created_at)}</span>
            </div>
          </div>
        );
      })}
      {q.isSuccess && !list.length ? <div className="p-7 text-center text-[12.5px] text-ink-3">No activity yet</div> : null}
    </div>
  );
}
