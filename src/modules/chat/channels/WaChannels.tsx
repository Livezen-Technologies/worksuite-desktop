import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Empty, Modal, Spinner, cx } from '../../../components/ui';
import type { WaAccount } from './whatsapp';

/**
 * WhatsApp Channels — one-way broadcasts — on this company's WhatsApp Web numbers, as the web has them: the channels
 * each number follows or runs beside the chosen one's latest posts; follow by link, leave, post to one the number
 * runs, or create one.
 */

const WA = '/api/whatsapp';
const FIELD = 'h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';

interface WaChannelRow { id: number; account_id: number; account_name: string; name: string | null; description: string | null; invite: string | null; role: string; can_post: boolean; subscribers: number | null; unread: number }
interface WaPost { id: string; kind: string; body: string; timestamp: number | null; has_media: boolean }

export function WaChannels({ accounts, onClose }: { accounts: WaAccount[]; onClose: () => void }) {
  const qc = useQueryClient();
  const webJs = accounts.filter((a) => a.provider === 'web_js' && a.status === 'connected');
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState<'follow' | 'create' | null>(null);
  const list = useQuery({ queryKey: ['whatsapp', 'channels'], queryFn: ({ signal }) => apiGet<{ channels: WaChannelRow[] }>(`${WA}/channels`, undefined, signal) });
  const channels = list.data?.channels ?? [];
  const current = channels.find((c) => c.id === open) ?? null;
  const leave = useMutation({
    mutationFn: (id: number) => apiDelete(`${WA}/channels/${id}`),
    onSuccess: () => { setOpen(null); void qc.invalidateQueries({ queryKey: ['whatsapp', 'channels'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });

  return (
    <Modal title="WhatsApp channels" onClose={onClose} width={860}>
      <div className="flex h-[520px] min-h-0 gap-0 overflow-hidden rounded-[10px] border border-line">
        <aside aria-label="Channels" className="flex w-[280px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="flex gap-1.5 border-b border-line p-2">
            <Button size="sm" variant="primary" icon="plus" disabled={!webJs.length} onClick={() => setAdding('follow')} className="flex-1">Follow</Button>
            <Button size="sm" disabled={!webJs.length} onClick={() => setAdding('create')}>New</Button>
          </div>
          {!webJs.length ? <p className="m-3 rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-ink-2">Channels need a linked WhatsApp Web number.</p> : null}
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {list.isLoading ? <Spinner /> : null}
            {!list.isLoading && !channels.length && webJs.length ? <Empty icon="megaphone" title="No channels yet" hint="Follow one by its link." /> : null}
            {channels.map((c) => (
              <button key={c.id} type="button" aria-current={c.id === open ? 'true' : undefined} onClick={() => setOpen(c.id)} className={cx('flex w-full items-center gap-2.5 px-3 py-2 text-left', c.id === open ? 'bg-selection' : 'hover:bg-subtle')}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-primary"><Icon name="megaphone" size={15} /></span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] text-ink">{c.name || 'Channel'}</b>
                  <span className="block truncate text-[11.5px] text-ink-3">{c.role === 'owner' ? 'Yours' : c.role === 'admin' ? 'Admin' : 'Following'} · {c.account_name}</span>
                </span>
                {c.unread > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">{c.unread}</span> : null}
              </button>
            ))}
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col bg-ground">
          {current ? <Posts key={current.id} channel={current} onLeave={() => leave.mutate(current.id)} /> : <Empty icon="megaphone" title="Choose a channel" hint="Its latest posts show here." />}
        </section>
      </div>
      {adding ? <AddChannel mode={adding} accounts={webJs} onClose={() => setAdding(null)} onDone={(id) => { setAdding(null); void qc.invalidateQueries({ queryKey: ['whatsapp', 'channels'] }); if (id) setOpen(id); }} /> : null}
    </Modal>
  );
}

function Posts({ channel, onLeave }: { channel: WaChannelRow; onLeave: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const posts = useQuery({ queryKey: ['whatsapp', 'channel-posts', channel.id], queryFn: ({ signal }) => apiGet<{ messages: WaPost[]; partial: boolean }>(`${WA}/channels/${channel.id}/messages`, undefined, signal), refetchInterval: 60_000 });
  const post = useMutation({
    mutationFn: () => apiPost(`${WA}/channels/${channel.id}/messages`, { text: text.trim() }),
    onSuccess: () => { setText(''); void qc.invalidateQueries({ queryKey: ['whatsapp', 'channel-posts', channel.id] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const list = [...(posts.data?.messages ?? [])].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return (
    <>
      <header className="flex items-center gap-2 border-b border-line bg-surface px-3.5 py-2.5">
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13.5px] text-ink">{channel.name}</b>
          <span className="block truncate text-[12px] text-ink-3">{channel.description || channel.account_name}{channel.subscribers != null ? ` · ${channel.subscribers.toLocaleString()} followers` : ''}</span>
        </span>
        {channel.invite ? <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(channel.invite!).then(() => toast('success', 'Link copied'))}>Copy link</Button> : null}
        <Button size="sm" variant="danger" onClick={onLeave}>Leave</Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3.5 scroll-thin">
        {posts.isLoading ? <Spinner /> : null}
        {posts.isError ? <p className="text-[12.5px] text-danger">{errorMessage(posts.error)}</p> : null}
        {!posts.isLoading && !list.length ? <p className="text-[12.5px] text-ink-3">{posts.data?.partial ? 'New posts show here as they arrive.' : 'No posts yet.'}</p> : null}
        {list.map((m) => (
          <article key={m.id} className="max-w-[560px] rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink">
            {m.has_media ? <p className="mb-0.5 text-[11.5px] text-ink-3">{m.kind === 'image' ? 'Picture' : m.kind === 'video' ? 'Video' : 'Attachment'} — open it in WhatsApp</p> : null}
            {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
            {m.timestamp ? <p className="mt-0.5 text-[11px] text-ink-3">{new Date(m.timestamp * 1000).toLocaleString()}</p> : null}
          </article>
        ))}
      </div>
      {channel.can_post ? (
        <div className="flex gap-2 border-t border-line bg-surface p-2.5">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} aria-label="Post to the channel" placeholder="Post to the channel" className="min-w-0 flex-1 resize-none rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary" />
          <Button variant="primary" disabled={!text.trim()} loading={post.isPending} onClick={() => post.mutate()} className="self-end">Post</Button>
        </div>
      ) : null}
    </>
  );
}

function AddChannel({ mode, accounts, onClose, onDone }: { mode: 'follow' | 'create'; accounts: WaAccount[]; onClose: () => void; onDone: (id: number | null) => void }) {
  const [account, setAccount] = useState(accounts[0]?.id ?? 0);
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const go = useMutation({
    mutationFn: () => (mode === 'follow'
      ? apiPost<{ id: number }>(`${WA}/channels/follow`, { account_id: account, invite: invite.trim() })
      : apiPost<{ id: number }>(`${WA}/channels`, { account_id: account, name: name.trim(), description: description.trim() || undefined })),
    onSuccess: (r) => onDone(r?.id ?? null),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const ok = !!account && (mode === 'follow' ? !!invite.trim() : !!name.trim());
  return (
    <Modal title={mode === 'follow' ? 'Follow a channel' : 'Create a channel'} onClose={onClose} width={420} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} loading={go.isPending} onClick={() => go.mutate()}>{mode === 'follow' ? 'Follow' : 'Create'}</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        {mode === 'follow' ? (
          <label className="flex flex-col gap-1 font-semibold text-ink">Channel link<input autoFocus value={invite} onChange={(e) => setInvite(e.target.value)} className={FIELD} placeholder="https://whatsapp.com/channel/…" /></label>
        ) : (
          <>
            <label className="flex flex-col gap-1 font-semibold text-ink">Name<input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={FIELD} /></label>
            <label className="flex flex-col gap-1 font-semibold text-ink">Description (optional)<textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary" /></label>
          </>
        )}
        {accounts.length > 1 ? (
          <label className="flex flex-col gap-1 font-semibold text-ink">On the number<select value={account} onChange={(e) => setAccount(Number(e.target.value))} className={FIELD}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        ) : null}
      </div>
    </Modal>
  );
}
