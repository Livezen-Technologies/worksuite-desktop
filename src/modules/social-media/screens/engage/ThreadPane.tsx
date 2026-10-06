import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Icon } from '../../../../components/Icon';
import { Menu } from '../../../../components/Menu';
import { Avatar, Button, cx, ErrorNote } from '../../../../components/ui';
import { apiDelete } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { useTab } from '../../../../core/tab-context';
import { toast } from '../../../../core/toasts';
import { accountById, brandById, SK, socialApi, useInvalidate, useSavedReplies, useThread, write, type Account, type Brand, type InboxMessage, type Thread } from '../../api';
import type { SocialAccess } from '../../access';
import { networkInfo } from '../../lib/networks';
import { fillVariables } from '../../lib/text';
import { dueLabel, hhmm, inZone, minutesUntil, whenLabel } from '../../lib/time';
import { full, Notice, OptionalView, TEXTAREA } from '../../parts';
import { AssignModal, ConvertModal } from './InboxModals';

/**
 * W06 / D03 Inbox — the open conversation (I-Inbox, D03 artboards; WF-10, WF-11; SMM-INB-004…012, AI-002, AC-12,
 * AC-13): who it is and where, assign / convert / close, the collision lock, messages and internal notes, the CRM
 * card, the network's reply window, and the reply box with saved replies and the AI suggestion. Sending is always a
 * click: a suggestion only fills the box (AC-13), and a refused reply keeps its text (WF-10).
 */

/**
 * Removing a comment on the network (INB-004) — not in the module client yet; proposed as
 * DELETE /api/social-media/inbox/threads/{id}/remote → 204.
 */
const deleteOnNetwork = (id: number) => write(apiDelete(`/api/social-media/inbox/threads/${id}/remote`));

/** "Messenger", "Instagram comment", "Google review". */
function channelWord(t: Pick<Thread, 'network' | 'kind'>): string {
  const n = networkInfo(t.network).label;
  if (t.kind === 'message') return t.network === 'facebook' ? 'Messenger' : `${n} message`;
  return `${n} ${t.kind}`;
}

function firstName(name: string): string {
  return name.replace(/^@/, '').split(/[\s.]/)[0] ?? name;
}

export function ThreadPane({ threadId, access, ai, accounts, brands, me, now }: { threadId: number; access: SocialAccess; ai: boolean; accounts: Account[]; brands: Brand[]; me: number | null; now: number }) {
  const q = useThread(threadId);
  return (
    <OptionalView q={q} what="Conversations">
      {(t) => <Conversation thread={t} access={access} ai={ai} account={accountById(accounts, t.account_id)} brand={brandById(brands, accountById(accounts, t.account_id)?.brand_id)} me={me} now={now} />}
    </OptionalView>
  );
}

function Conversation({ thread: t, access, ai, account, brand, me, now }: { thread: Thread; access: SocialAccess; ai: boolean; account?: Account; brand?: Brand; me: number | null; now: number }) {
  const { go } = useTab();
  const invalidate = useInvalidate();
  const assignRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<'assign' | 'more' | null>(null);
  const [modal, setModal] = useState<'assign' | 'crm_lead' | 'ticket' | null>(null);

  const refresh = () => invalidate(SK.thread(t.id), SK.threadsAll, SK.status);
  const assign = useMutation({
    mutationFn: (to: { type: 'user' | 'team'; id: number } | null) => socialApi.assign(t.id, to),
    onSuccess: () => {
      setModal(null);
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (s: 'closed' | 'open' | 'spam' | 'hidden') => socialApi.setThreadStatus(t.id, s),
    onSuccess: (_r, s) => {
      toast('success', s === 'closed' ? 'Closed' : s === 'open' ? 'Reopened' : s === 'spam' ? 'Marked as spam' : 'Hidden on the network');
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteOnNetwork(t.id),
    onSuccess: () => {
      toast('success', 'Deleted on the network');
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const network = networkInfo(t.network).label;
  const due = t.status === 'closed' ? null : dueLabel(t.reply_due_at, now);
  const others = (t.viewing ?? []).filter((p) => p.id !== me);
  const mine = t.assignee?.type === 'user' && me !== null && t.assignee.id === me;
  const closed = t.status === 'closed';
  const source = [account?.display_name ?? network, t.post ? `post “${t.post.excerpt}”` : null].filter(Boolean).join(' · ');
  const notOn = `Not available on ${network}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
        <Avatar name={t.participant.name} size={36} src={t.participant.avatar_url} />
        <div className="min-w-[180px] flex-1">
          <div className="truncate text-[14px] font-bold text-ink">{t.participant.name}</div>
          <div className={cx('truncate text-[12px]', due?.state === 'overdue' ? 'text-danger' : due?.state === 'at_risk' ? 'text-warning' : 'text-ink-3')}>
            {[channelWord(t), account?.display_name, due?.text].filter(Boolean).join(' · ')}
          </div>
        </div>
        {access.assign ? (
          <button ref={assignRef} type="button" aria-haspopup="menu" onClick={() => setMenu('assign')} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink hover:bg-subtle">
            Assign: {mine ? 'you' : (t.assignee?.name ?? 'nobody')}
            <Icon name="chevron-down" size={14} className="text-ink-3" />
          </button>
        ) : t.assignee ? (
          <span className="text-[12.5px] text-ink-3">Assigned to {mine ? 'you' : t.assignee.name}</span>
        ) : null}
        {access.convert && access.crm ? (
          <Button icon="user-plus" onClick={() => setModal('crm_lead')}>
            Create CRM lead
          </Button>
        ) : null}
        {access.convert && access.tickets ? (
          t.ticket ? (
            <span className="text-[12.5px] font-semibold text-ink-2">Ticket {t.ticket.number}</span>
          ) : (
            <Button icon="ticket" onClick={() => setModal('ticket')}>
              Create ticket
            </Button>
          )
        ) : null}
        {access.reply ? (
          <Button icon={closed ? 'undo' : 'check'} loading={setStatus.isPending && (setStatus.variables === 'closed' || setStatus.variables === 'open')} onClick={() => setStatus.mutate(closed ? 'open' : 'closed')}>
            {closed ? 'Reopen' : 'Close'}
          </Button>
        ) : null}
        {access.reply ? (
          <button ref={moreRef} type="button" aria-label="More actions" aria-haspopup="menu" onClick={() => setMenu('more')} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
            <Icon name="more" size={18} />
          </button>
        ) : null}
      </header>

      {menu === 'assign' ? (
        <Menu
          label="Assign"
          anchor={assignRef}
          prefer="bottom"
          align="end"
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'a',
              items: [
                { id: 'me', label: 'Assign to me', icon: 'user', disabled: me === null || mine, reason: me === null ? 'Your user id isn’t known to this session' : undefined, onSelect: () => me !== null && assign.mutate({ type: 'user', id: me }) },
                { id: 'none', label: 'Unassign', icon: 'user-x', disabled: !t.assignee, onSelect: () => assign.mutate(null) },
                { id: 'other', label: 'Someone else…', icon: 'users', onSelect: () => setModal('assign') },
              ],
            },
          ]}
        />
      ) : null}
      {menu === 'more' ? (
        <Menu
          label="More actions"
          anchor={moreRef}
          prefer="bottom"
          align="end"
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'm',
              items: [
                { id: 'hide', label: 'Hide on the network', icon: 'eye-off', disabled: !t.actions.hide, reason: t.actions.hide ? undefined : notOn, onSelect: () => setStatus.mutate('hidden') },
                { id: 'delete', label: 'Delete on the network', icon: 'trash', danger: true, disabled: !t.actions.delete, reason: t.actions.delete ? undefined : notOn, onSelect: () => remove.mutate() },
                { id: 'spam', label: 'Mark as spam', icon: 'spam', onSelect: () => setStatus.mutate('spam') },
              ],
            },
          ]}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">
        <div className="flex flex-col gap-3">
          {others.length ? (
            <Notice tone="warning" icon="lock">
              {others.map((p) => p.name).join(', ')} {others.length === 1 ? 'is' : 'are'} replying — check before you send so the customer doesn’t get two answers.
            </Notice>
          ) : null}
          {!t.actions.hide || !t.actions.delete ? (
            <p className="text-[11.5px] text-ink-3">
              {[!t.actions.hide ? 'Hide' : null, !t.actions.delete ? 'delete' : null].filter(Boolean).join(' and ')} not available on {network} for this {t.kind}.
            </p>
          ) : null}
          {t.post ? (
            <button type="button" onClick={() => go(`/social-media/posts/${t.post!.id}`)} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2 text-left text-[12.5px] text-ink-2 hover:bg-subtle">
              <Icon name="link" size={14} className="shrink-0 text-ink-3" />
              <span className="truncate">On the post: {t.post.excerpt}</span>
            </button>
          ) : null}
          {t.crm ? <CrmCard crm={t.crm} /> : null}
          {t.messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </div>
      </div>

      {access.reply ? <ReplyBox key={t.id} thread={t} ai={ai} network={network} brand={brand} now={now} /> : <p className="border-t border-line px-4 py-3 text-[12.5px] text-ink-3">You can read this conversation; replying needs the Inbox reply permission.</p>}

      {modal === 'assign' ? <AssignModal busy={assign.isPending} onClose={() => setModal(null)} onAssign={(to) => assign.mutate(to)} /> : null}
      {modal === 'crm_lead' || modal === 'ticket' ? <ConvertModal thread={t} to={modal} source={source} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function Bubble({ m }: { m: InboxMessage }) {
  const at = hhmm(inZone(m.created_at).minutes);
  if (m.direction === 'note') {
    return (
      <div className="rounded-[10px] border border-warning/30 bg-warning-bg px-3 py-2 text-[13px] text-ink">
        <span className="font-semibold">Internal note by {m.author.name}:</span> {m.body}
        <span className="ml-1.5 text-[11px] text-ink-3">{at}</span>
      </div>
    );
  }
  const out = m.direction === 'out';
  return (
    <div className={cx('flex max-w-[78%] flex-col gap-0.5', out ? 'self-end items-end' : 'self-start')}>
      <div className={cx('rounded-[12px] px-3 py-2 text-[13px] whitespace-pre-wrap text-ink', out ? 'bg-selection' : 'bg-subtle', m.hidden && 'opacity-60')}>{m.body}</div>
      <span className="text-[11px] text-ink-3">
        {m.author.name} · {at}
        {m.ai_used ? ' · AI-assisted' : ''}
        {m.hidden ? ' · hidden' : ''}
        {m.deleted_remote ? ' · deleted on the network' : ''}
      </span>
    </div>
  );
}

function CrmCard({ crm }: { crm: NonNullable<Thread['crm']> }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px]">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[.04em] text-ink-3 uppercase">
        <Icon name="contact" size={13} />
        In CRM
      </div>
      <div className="font-semibold text-ink">{crm.name}</div>
      {crm.company && crm.company !== crm.name ? <div className="text-ink-3">{crm.company}</div> : null}
      {crm.deals.map((d) => (
        <div key={d.id} className="mt-1 flex flex-wrap gap-x-2 text-ink-2">
          <span>{d.name}</span>
          {d.amount !== null ? <span className="font-semibold tabular-nums">{[d.currency, full(d.amount)].filter(Boolean).join(' ')}</span> : null}
          {d.stage ? <span className="text-ink-3">{d.stage}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Reply box
 * ------------------------------------------------------------------------ */

function ReplyBox({ thread: t, ai, network, brand, now }: { thread: Thread; ai: boolean; network: string; brand?: Brand; now: number }) {
  const invalidate = useInvalidate();
  const savedQ = useSavedReplies();
  const saved = savedQ.data?.offered ? savedQ.data.data : [];
  const savedRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const [aiUsed, setAiUsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const vars = { first_name: firstName(t.participant.name), brand: brand?.name ?? null };
  const left = minutesUntil(t.window_ends_at, now);
  const windowShut = left !== null && left <= 0;
  const blocked = mode === 'reply' ? (!t.actions.reply ? `Replying isn’t available on ${network} for this ${t.kind}.` : windowShut ? `The reply window closed ${whenLabel(t.window_ends_at)}; ${network} doesn’t accept a reply after it.` : null) : null;

  const suggest = useMutation({ mutationFn: () => socialApi.suggestReply(t.id), onError: (e) => toast('error', errorMessage(e)) });
  const send = useMutation({
    mutationFn: (close: boolean) => (mode === 'note' ? socialApi.note(t.id, text.trim()) : socialApi.reply(t.id, text.trim(), { close, ai_used: aiUsed })),
    onMutate: () => setError(null),
    onSuccess: () => {
      setText('');
      setAiUsed(false);
      invalidate(SK.thread(t.id), SK.threadsAll, SK.status);
    },
    // WF-10: the network's refusal shows here and the text stays, so nothing is lost.
    onError: (e) => setError(e),
  });

  const expand = (v: string): string => {
    const m = /(^|\s)(\/[A-Za-z0-9_-]+)\s$/.exec(v);
    if (!m) return v;
    const r = saved.find((s) => s.shortcut && `/${s.shortcut.replace(/^\/+/, '')}` === m[2]);
    return r ? `${v.slice(0, m.index + m[1]!.length)}${fillVariables(r.body, vars)}` : v;
  };
  const can = !!text.trim() && !blocked && !send.isPending;
  const submit = (close: boolean) => can && send.mutate(close);
  const suggestion = suggest.data?.reply ?? null;

  return (
    <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label="Write" className="flex gap-1">
          {(['reply', 'note'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cx('h-7 rounded-[7px] px-2.5 text-[12.5px] font-semibold', mode === id ? (id === 'note' ? 'bg-warning-bg text-warning' : 'bg-selection text-primary') : 'text-ink-2 hover:bg-subtle')}>
              {id === 'reply' ? 'Reply' : 'Internal note'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {t.window_ends_at && !windowShut && mode === 'reply' && left !== null ? (
          <span className={cx('text-[11.5px]', left <= 60 ? 'text-warning' : 'text-ink-3')}>Reply window closes in {left < 60 ? `${left} min` : `${Math.floor(left / 60)} h`}</span>
        ) : null}
      </div>

      {ai && mode === 'reply' ? (
        suggestion ? (
          <div className="flex items-start gap-2 rounded-[10px] border border-primary/25 bg-selection px-3 py-2 text-[12.5px] text-ink">
            <Icon name="sparkles" size={15} className="mt-0.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Suggested reply:</span> {suggestion}
            </span>
            <Button
              size="sm"
              onClick={() => {
                setText(suggestion);
                setAiUsed(true);
              }}
            >
              Use
            </Button>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="ghost" icon="sparkles" loading={suggest.isPending} onClick={() => suggest.mutate()}>
              Suggest a reply
            </Button>
          </div>
        )
      ) : null}

      <textarea
        aria-label={mode === 'reply' ? `Reply to ${t.participant.name}` : 'Internal note'}
        className={cx(TEXTAREA, 'min-h-[76px]', mode === 'note' && 'bg-warning-bg/40')}
        placeholder={mode === 'reply' ? `Reply on ${network}… (/shortcut for a saved reply)` : 'Only your team sees notes.'}
        value={text}
        onChange={(e) => {
          const v = expand(e.target.value);
          setText(v);
          if (!v.trim()) setAiUsed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit(false);
          }
        }}
      />
      {blocked ? <p className="text-[12px] text-danger">{blocked}</p> : null}
      {error ? <ErrorNote error={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === 'reply' ? (
          <button ref={savedRef} type="button" aria-haspopup="menu" onClick={() => setMenu(true)} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-semibold text-ink-2 hover:bg-subtle">
            <Icon name="bookmark" size={15} />
            Saved replies
          </button>
        ) : null}
        <span className="flex-1" />
        {mode === 'reply' ? (
          <Button disabled={!can} loading={send.isPending && send.variables === true} onClick={() => submit(true)}>
            Send &amp; close
          </Button>
        ) : null}
        <Button variant="primary" icon="send" disabled={!can} loading={send.isPending && send.variables === false} onClick={() => submit(false)} aria-keyshortcuts="Control+Enter Meta+Enter">
          {mode === 'note' ? 'Add note' : 'Send'}
        </Button>
      </div>

      {menu ? (
        <Menu
          label="Saved replies"
          anchor={savedRef}
          prefer="top"
          align="start"
          width={320}
          onClose={() => setMenu(false)}
          empty={savedQ.data && !savedQ.data.offered ? 'Saved replies aren’t offered by this WorkSuite server yet.' : 'No saved replies yet.'}
          sections={[
            {
              id: 's',
              items: saved.map((r) => ({
                id: String(r.id),
                label: r.name,
                description: r.body.slice(0, 80),
                shortcut: r.shortcut ?? undefined,
                onSelect: () => setText((x) => `${x}${x && !/\s$/.test(x) ? ' ' : ''}${fillVariables(r.body, vars)}`),
              })),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
