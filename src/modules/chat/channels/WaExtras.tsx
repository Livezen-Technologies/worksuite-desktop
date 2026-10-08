import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import type { WaMessage } from './whatsapp';

/**
 * What WhatsApp sends besides words and files — a poll, a place, a contact card, a sticker — from the row above the
 * reply box, and how a poll, a contact card and a place look in the conversation. Polls, contact cards and stickers
 * are WhatsApp Web's own (`webJs`); the Business Platform sends places only. As the web inbox has them.
 */

const WA = '/api/whatsapp';
const FIELD = 'h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';
const CHIP = 'inline-flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-subtle disabled:opacity-50';
const openOut = (url: string) => void call('app:openInBrowser', { path: url });

type Extra = 'poll' | 'location' | 'contact';

export function WaExtrasBar({ chatId, webJs, disabled, onSent }: { chatId: number; webJs: boolean; disabled?: boolean; onSent: () => void }) {
  const [open, setOpen] = useState<Extra | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost<{ ok: boolean; error?: string }>(`${WA}/chats/${chatId}/messages`, body),
    onSuccess: (r) => {
      if (r?.ok === false) toast('error', `Not sent. ${r.error ?? ''}`.trim());
      setOpen(null);
      onSent();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const sticker = (f: File) => {
    const form = new FormData();
    form.append('files[]', f, f.name);
    form.append('caption', '');
    form.append('sticker', '1');
    void apiPost(`${WA}/chats/${chatId}/attachments`, form).then(onSent, (e) => toast('error', errorMessage(e)));
  };

  return (
    <div role="group" aria-label="Send something else" className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
      {webJs ? <button type="button" className={CHIP} disabled={disabled} onClick={() => setOpen('poll')}><Icon name="chart" size={13} />Poll</button> : null}
      <button type="button" className={CHIP} disabled={disabled} onClick={() => setOpen('location')}><Icon name="map-pin" size={13} />Location</button>
      {webJs ? <button type="button" className={CHIP} disabled={disabled} onClick={() => setOpen('contact')}><Icon name="contact" size={13} />Contact card</button> : null}
      {webJs ? (
        <>
          <button type="button" className={CHIP} disabled={disabled} onClick={() => picker.current?.click()}><Icon name="smile" size={13} />Sticker</button>
          <input ref={picker} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose a picture to send as a sticker" onChange={(e) => { const f = e.target.files?.[0]; if (f) sticker(f); e.target.value = ''; }} />
        </>
      ) : null}
      {open === 'poll' ? <PollForm busy={send.isPending} onClose={() => setOpen(null)} onSend={(question, options, multiple) => send.mutate({ kind: 'poll', question, options, multiple })} /> : null}
      {open === 'location' ? <LocationForm busy={send.isPending} onClose={() => setOpen(null)} onSend={(v) => send.mutate({ kind: 'location', ...v })} /> : null}
      {open === 'contact' ? <ContactForm busy={send.isPending} onClose={() => setOpen(null)} onSend={(name, phone) => send.mutate({ kind: 'contact', contact: { name, phones: [phone] } })} /> : null}
    </div>
  );
}

function Footer({ ok, busy, label, onClose, onGo }: { ok: boolean; busy: boolean; label: string; onClose: () => void; onGo: () => void }) {
  return (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!ok} loading={busy} onClick={onGo}>{label}</Button>
    </>
  );
}

function PollForm({ busy, onClose, onSend }: { busy: boolean; onClose: () => void; onSend: (q: string, options: string[], multiple: boolean) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ok = !!question.trim() && filled.length >= 2;
  return (
    <Modal title="Create a poll" onClose={onClose} width={440} footer={<Footer ok={ok} busy={busy} label="Send poll" onClose={onClose} onGo={() => onSend(question.trim(), filled, multiple)} />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">Question<input autoFocus value={question} maxLength={255} onChange={(e) => setQuestion(e.target.value)} className={FIELD} placeholder="Ask a question" /></label>
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold text-ink">Answers</span>
          {options.map((o, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={o} maxLength={100} aria-label={`Answer ${i + 1}`} placeholder={`Answer ${i + 1}`} onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))} className={FIELD} />
              {options.length > 2 ? <button type="button" aria-label={`Remove answer ${i + 1}`} onClick={() => setOptions((all) => all.filter((_, j) => j !== i))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-subtle"><Icon name="x" size={14} /></button> : null}
            </div>
          ))}
          {options.length < 12 ? <button type="button" onClick={() => setOptions((all) => [...all, ''])} className="self-start text-[12.5px] font-semibold text-primary">+ Add an answer</button> : null}
        </div>
        <label className="flex items-center gap-2 text-ink-2"><Checkbox checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />Allow more than one answer</label>
      </div>
    </Modal>
  );
}

function LocationForm({ busy, onClose, onSend }: { busy: boolean; onClose: () => void; onSend: (v: { latitude: number; longitude: number; name?: string; address?: string }) => void }) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const la = Number(lat);
  const lo = Number(lng);
  const ok = lat !== '' && lng !== '' && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  const paste = (v: string, set: (s: string) => void) => {
    const m = /@?(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(v);
    if (m) { setLat(m[1]!); setLng(m[2]!); } else set(v);
  };
  const here = () => {
    if (!navigator.geolocation) { setNote('This computer cannot tell where it is.'); return; }
    setNote('Finding where you are…');
    navigator.geolocation.getCurrentPosition((p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setNote(null); }, () => setNote('Your location was not shared. Type the coordinates instead.'), { timeout: 10_000 });
  };
  return (
    <Modal title="Send a location" onClose={onClose} width={440} footer={<Footer ok={ok} busy={busy} label="Send location" onClose={onClose} onGo={() => onSend({ latitude: la, longitude: lo, ...(name.trim() ? { name: name.trim() } : {}), ...(address.trim() ? { address: address.trim() } : {}) })} />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <Button size="sm" icon="map-pin" className="self-start" onClick={here}>Use my current location</Button>
        {note ? <p className="text-[12px] text-ink-3">{note}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 font-semibold text-ink">Latitude<input value={lat} onChange={(e) => paste(e.target.value, setLat)} className={FIELD} placeholder="6.9271" /></label>
          <label className="flex flex-col gap-1 font-semibold text-ink">Longitude<input value={lng} onChange={(e) => paste(e.target.value, setLng)} className={FIELD} placeholder="79.8612" /></label>
        </div>
        <p className="text-[12px] text-ink-3">Or paste a Google Maps link into either box.</p>
        <label className="flex flex-col gap-1 font-semibold text-ink">Place name (optional)<input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1 font-semibold text-ink">Address (optional)<input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} className={FIELD} /></label>
      </div>
    </Modal>
  );
}

function ContactForm({ busy, onClose, onSend }: { busy: boolean; onClose: () => void; onSend: (name: string, phone: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const digits = phone.replace(/\D/g, '');
  return (
    <Modal title="Send a contact card" onClose={onClose} width={420} footer={<Footer ok={!!name.trim() && digits.length >= 7} busy={busy} label="Send card" onClose={onClose} onGo={() => onSend(name.trim(), `+${digits}`)} />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">Name<input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1 font-semibold text-ink">Number, with the country code<input value={phone} onChange={(e) => setPhone(e.target.value)} className={FIELD} placeholder="+94 77 123 4567" /></label>
      </div>
    </Modal>
  );
}

/** A poll in the conversation: each answer with its votes and ours ticked; clicking an answer votes. */
export function PollCard({ m, canVote, onVoted }: { m: WaMessage; canVote: boolean; onVoted: () => void }) {
  const poll = m.poll!;
  const counts = poll.counts ?? {};
  const top = Math.max(1, ...poll.options.map((o) => counts[o] ?? 0));
  const vote = useMutation({ mutationFn: (options: string[]) => apiPost(`${WA}/messages/${m.id}/vote`, { options }), onSuccess: onVoted, onError: (e) => toast('error', errorMessage(e)) });
  const pick = (o: string) => {
    const mine = poll.mine ?? [];
    vote.mutate(mine.includes(o) ? mine.filter((x) => x !== o) : poll.multiple ? [...mine, o] : [o]);
  };
  return (
    <div role="group" aria-label={`Poll: ${poll.name}`} className="min-w-[220px]">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-ink"><Icon name="chart" size={14} className="text-primary" />{poll.name}</p>
      <p className="mb-1.5 text-[11px] text-ink-3">{poll.multiple ? 'Choose one or more' : 'Choose one'} · {poll.voters ?? 0} voted</p>
      <ul className="flex flex-col gap-1.5">
        {poll.options.map((o) => {
          const n = counts[o] ?? 0;
          const mine = (poll.mine ?? []).includes(o);
          return (
            <li key={o}>
              <button type="button" disabled={!canVote || vote.isPending} aria-pressed={mine} onClick={() => pick(o)} className="w-full text-left disabled:cursor-default">
                <span className="flex items-center gap-2">
                  <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', mine ? 'border-primary bg-primary' : 'border-ink-3')}>{mine ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{o}</span>
                  <span className="text-[11.5px] tabular-nums text-ink-3">{n}</span>
                </span>
                <span className="mt-0.5 ml-6 block h-1 rounded-full bg-line"><span className="block h-1 rounded-full bg-primary" style={{ width: `${(n / top) * 100}%` }} /></span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A contact card: each person's name and numbers. */
export function ContactCards({ m }: { m: WaMessage }) {
  const people = ((m.meta as { contacts?: Array<{ name: string; phones: string[] }> } | null | undefined)?.contacts) ?? [];
  if (!people.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {people.map((p, i) => (
        <div key={i} className="flex items-center gap-2 rounded-[8px] bg-subtle px-2.5 py-2">
          <Icon name="contact" size={22} className="shrink-0 text-ink-3" />
          <span className="min-w-0">
            <b className="block truncate text-ink">{p.name}</b>
            {p.phones.map((ph) => <button key={ph} type="button" onClick={() => openOut(`https://wa.me/${ph.replace(/\D/g, '')}`)} className="block text-[12px] text-primary hover:underline">{ph}</button>)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A place: its name and address, opening the map. */
export function LocationCard({ m }: { m: WaMessage }) {
  const p = (m.meta ?? {}) as { latitude?: number; longitude?: number; name?: string | null; address?: string | null; description?: string | null };
  if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null;
  return (
    <button type="button" onClick={() => openOut(`https://www.google.com/maps?q=${p.latitude},${p.longitude}`)} className="mb-1 flex max-w-[280px] items-center gap-2 rounded-[8px] bg-subtle px-2.5 py-2 text-left hover:bg-line/40">
      <Icon name="map-pin" size={22} className="shrink-0 text-danger" />
      <span className="min-w-0">
        <b className="block truncate text-ink">{p.name || p.description || 'Location'}</b>
        <span className="block truncate text-[12px] text-ink-3">{p.address || `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}</span>
      </span>
    </button>
  );
}

interface WaProfileData { available: boolean; about?: string | null; picture?: string | null; is_blocked?: boolean; is_business?: boolean }

/** What WhatsApp shows about the person — picture and "about" line — with Block / Unblock; a group's invite link and settings. */
export function WaProfile({ chatId, group, canManage }: { chatId: number; group: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['whatsapp', 'profile', chatId], queryFn: ({ signal }) => apiGet<WaProfileData>(`${WA}/chats/${chatId}/profile`, undefined, signal), staleTime: 10 * 60_000, retry: false });
  const block = useMutation({
    mutationFn: (on: boolean) => apiPost(`${WA}/chats/${chatId}/${on ? 'block' : 'unblock'}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'profile', chatId] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const p = q.data;
  if (!p?.available) return null;
  return (
    <section aria-label="On WhatsApp" className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
      <div className="flex items-center gap-2.5">
        {p.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <Icon name="contact" size={28} className="shrink-0 text-ink-3" />}
        <span className="min-w-0 flex-1 text-[12px]">
          {p.about ? <span className="block text-ink-2 italic">“{p.about}”</span> : <span className="block text-ink-3">No about line</span>}
          {p.is_business ? <span className="block text-ink-3">WhatsApp Business</span> : null}
        </span>
      </div>
      {!group && canManage ? (
        <Button size="sm" variant={p.is_blocked ? 'secondary' : 'danger'} loading={block.isPending} onClick={() => block.mutate(!p.is_blocked)} className="self-start">{p.is_blocked ? 'Unblock' : 'Block'}</Button>
      ) : null}
      {group && canManage ? <GroupTools chatId={chatId} /> : null}
    </section>
  );
}

/** A group's invite link (show, copy, reset) and who may send and change its details — for the group's admins. */
function GroupTools({ chatId }: { chatId: number }) {
  const [link, setLink] = useState<string | null>(null);
  const [onlyAdminsSend, setOnlyAdminsSend] = useState(false);
  const [onlyAdminsEdit, setOnlyAdminsEdit] = useState(false);
  const get = useMutation({
    mutationFn: (reset: boolean) => (reset ? apiPost<{ link: string }>(`${WA}/groups/${chatId}/invite/revoke`, {}) : apiGet<{ link: string }>(`${WA}/groups/${chatId}/invite`)),
    onSuccess: (d) => setLink(d?.link ?? null),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const settings = useMutation({ mutationFn: (v: Record<string, boolean>) => apiPut(`${WA}/groups/${chatId}/settings`, v), onError: (e) => toast('error', errorMessage(e)) });
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <b className="text-ink">Invite link</b>
      {link ? (
        <div className="flex flex-col gap-1.5">
          <code className="truncate rounded-[6px] bg-subtle px-2 py-1">{link}</code>
          <div className="flex gap-1.5">
            <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast('success', 'Copied'))}>Copy</Button>
            <Button size="sm" loading={get.isPending} onClick={() => get.mutate(true)}>Reset link</Button>
          </div>
        </div>
      ) : <Button size="sm" icon="link" loading={get.isPending} onClick={() => get.mutate(false)} className="self-start">Show invite link</Button>}
      <b className="mt-1 text-ink">Settings</b>
      <label className="flex items-center gap-2 text-ink-2"><Checkbox checked={onlyAdminsSend} onChange={(e) => { setOnlyAdminsSend(e.target.checked); settings.mutate({ admins_only_messages: e.target.checked }); }} />Only admins can send messages</label>
      <label className="flex items-center gap-2 text-ink-2"><Checkbox checked={onlyAdminsEdit} onChange={(e) => { setOnlyAdminsEdit(e.target.checked); settings.mutate({ admins_only_info: e.target.checked }); }} />Only admins can change the group's details</label>
    </div>
  );
}

/** Join a group by its invite link on one of these numbers. */
export function JoinGroup({ accounts, onClose, onJoined }: { accounts: Array<{ id: number; name: string }>; onClose: () => void; onJoined: (chatId: number | null) => void }) {
  const [invite, setInvite] = useState('');
  const [account, setAccount] = useState(accounts[0]?.id ?? 0);
  const join = useMutation({
    mutationFn: () => apiPost<{ chat_id: number | null }>(`${WA}/groups/join`, { account_id: account, invite: invite.trim() }),
    onSuccess: (r) => onJoined(r?.chat_id ?? null),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal title="Join a group by link" onClose={onClose} width={440} footer={<Footer ok={!!invite.trim() && !!account} busy={join.isPending} label="Join group" onClose={onClose} onGo={() => join.mutate()} />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">Invite link<input autoFocus value={invite} onChange={(e) => setInvite(e.target.value)} className={FIELD} placeholder="https://chat.whatsapp.com/…" /></label>
        {accounts.length > 1 ? (
          <label className="flex flex-col gap-1 font-semibold text-ink">Join with
            <select value={account} onChange={(e) => setAccount(Number(e.target.value))} className={FIELD}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
