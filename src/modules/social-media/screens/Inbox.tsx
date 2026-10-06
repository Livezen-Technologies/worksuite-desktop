import { useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, Spinner } from '../../../components/ui';
import { useNow } from '../../../core/use-now';
import { useTab } from '../../../core/tab-context';
import { dataOf, rowsOf, useAccounts, useBrands, useModuleStatus, useThreads, type InboxCounts, type InboxFilters, type ThreadRow } from '../api';
import { useSocialAccess } from '../access';
import type { InboxKind } from '../lib/networks';
import { ageLabel, dueLabel } from '../lib/time';
import { INPUT, NetChip, NotOffered, PageBody, PageHeader, Refused, useBrandScope } from '../parts';
import { RulesModal, SavedRepliesModal } from './engage/InboxModals';
import { typingIn, useMyId } from './engage/shared';
import { ThreadPane } from './engage/ThreadPane';

/**
 * W06 / D03 Unified inbox (I-Inbox p.47, D03-Desktop-Inbox; WF-09, WF-10, WF-11; SMM-INB-001…012, AI-002, DSK-005,
 * AC-11…13): views with counts and account toggles on the left, the conversations in the middle, the open one on the
 * right. `/social-media/inbox/<id>` opens a thread; `?view=mine|unassigned|closed_today` and `?kind=` pick the view,
 * so links from the rail and Overview land on the right list. J / K move to the next / previous conversation.
 */
type ViewId = 'open' | 'mine' | 'unassigned' | 'closed_today' | `kind:${InboxKind}`;

const VIEWS: Array<{ id: ViewId; label: string; count: keyof InboxCounts }> = [
  { id: 'open', label: 'All open', count: 'all_open' },
  { id: 'mine', label: 'Assigned to me', count: 'assigned_to_me' },
  { id: 'unassigned', label: 'Unassigned', count: 'unassigned' },
  { id: 'kind:comment', label: 'Comments', count: 'comment' },
  { id: 'kind:message', label: 'Messages', count: 'message' },
  { id: 'kind:mention', label: 'Mentions', count: 'mention' },
  { id: 'kind:review', label: 'Reviews', count: 'review' },
  { id: 'closed_today', label: 'Closed today', count: 'closed_today' },
];

const KIND_WORD: Record<InboxKind, string> = { message: 'Message', comment: 'Comment', review: 'Review', mention: 'Mention' };

function viewFrom(query: URLSearchParams): ViewId {
  const kind = query.get('kind');
  if (kind && kind in KIND_WORD) return `kind:${kind as InboxKind}`;
  const v = query.get('view');
  return v === 'mine' || v === 'unassigned' || v === 'closed_today' ? v : 'open';
}

function filtersOf(view: ViewId): InboxFilters {
  return view.startsWith('kind:') ? { view: 'open', kind: view.slice(5) as InboxKind } : { view: view as InboxFilters['view'] };
}

function viewQuery(view: ViewId): string {
  if (view === 'open') return '';
  return view.startsWith('kind:') ? `?kind=${view.slice(5)}` : `?view=${view}`;
}

export default function Inbox({ threadId }: { threadId: number | null }) {
  const { go, query } = useTab();
  const status = dataOf(useModuleStatus().data);
  const access = useSocialAccess(status?.permissions);
  const me = useMyId();
  const now = useNow(30_000).getTime();
  const [brandId] = useBrandScope();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [modal, setModal] = useState<'saved' | 'rules' | null>(null);
  const q = useDeferredValue(search.trim());

  const view = viewFrom(query);
  const accounts = rowsOf(useAccounts().data).filter((a) => brandId === null || a.brand_id === brandId);
  const brands = rowsOf(useBrands().data);
  const threadsQ = useThreads({ ...filtersOf(view), brand_id: brandId, account_id: picked.length === 1 ? picked[0] : null, q: q || null });
  const data = dataOf(threadsQ.data);
  const rows = (data?.threads ?? []).filter((r) => picked.length === 0 || picked.includes(r.account_id));
  const selected = threadId ?? rows[0]?.id ?? null;
  const suffix = viewQuery(view);

  // DSK-005: J / K walk the list when nobody is typing and no dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k !== 'j' && k !== 'k') return;
      if (rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === selected);
      const n = i < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, i + (k === 'j' ? 1 : -1)));
      if (rows[n] && rows[n].id !== selected) {
        e.preventDefault();
        go(`/social-media/inbox/${rows[n].id}${suffix}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, go, suffix]);

  const toggle = (id: number) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const counts = data?.counts ?? null;

  return (
    <>
      <PageHeader
        crumb="Inbox"
        title="Inbox"
        actions={
          <>
            <Button icon="bookmark" onClick={() => setModal('saved')}>
              Saved replies
            </Button>
            {access.settings ? (
              <Button icon="sliders" onClick={() => setModal('rules')}>
                Rules
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody className="flex min-h-0 gap-0 p-0">
        <nav aria-label="Inbox views" className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-3 scroll-thin">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => go(`/social-media/inbox${viewQuery(v.id)}`)}
              className={cx('flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', view === v.id ? 'bg-selection font-bold text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}
            >
              <span className="flex-1 truncate">{v.label}</span>
              {counts ? <span className="text-[12px] text-ink-3 tabular-nums">{counts[v.count]}</span> : null}
            </button>
          ))}
          <div className="mt-4 mb-1.5 px-2.5 text-[11px] font-semibold tracking-[.04em] text-ink-3 uppercase">Accounts</div>
          {accounts.length ? (
            <div className="flex flex-wrap gap-1.5 px-2.5">
              {accounts.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <button key={a.id} type="button" aria-pressed={on} aria-label={a.display_name} title={`${a.display_name} · ${a.handle ?? ''}`} onClick={() => toggle(a.id)} className={cx('rounded-[8px] p-0.5 ring-2', on ? 'ring-primary' : 'ring-transparent hover:ring-line', picked.length > 0 && !on && 'opacity-50')}>
                    <NetChip network={a.network} size={24} />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-2.5 text-[12px] text-ink-3">No accounts.</p>
          )}
        </nav>

        <section aria-label="Conversations" className="flex w-[360px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="border-b border-line p-3">
            <label className="relative block">
              <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
              <input aria-label="Search conversations" className={cx(INPUT, 'pl-8')} placeholder="Search people, text, posts" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {threadsQ.isLoading ? (
              <Spinner />
            ) : threadsQ.error ? (
              <Refused error={threadsQ.error} onRetry={() => void threadsQ.refetch()} />
            ) : threadsQ.data && !threadsQ.data.offered ? (
              <div className="p-3">
                <NotOffered what="The unified inbox" compact />
              </div>
            ) : rows.length === 0 ? (
              <Empty icon="inbox" title="Nothing here" hint={q ? 'No conversation matches the search.' : 'New comments, messages, mentions and reviews land here.'} />
            ) : (
              <ul>
                {rows.map((r) => (
                  <li key={r.id}>
                    <Row row={r} on={r.id === selected} now={now} onOpen={() => go(`/social-media/inbox/${r.id}${suffix}`)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col bg-surface">
          {selected ? (
            <ThreadPane key={selected} threadId={selected} access={access} ai={!!status?.ai_enabled} accounts={accounts} brands={brands} me={me} now={now} />
          ) : threadsQ.data && !threadsQ.data.offered ? (
            <div className="p-4">
              <NotOffered what="Replies, notes and assignment" compact />
            </div>
          ) : (
            <Empty icon="chat" title="Pick a conversation" hint="J and K move through the list." />
          )}
        </section>
      </PageBody>
      {modal === 'saved' ? <SavedRepliesModal canManage={access.settings || access.reply} onClose={() => setModal(null)} /> : null}
      {modal === 'rules' ? <RulesModal onClose={() => setModal(null)} /> : null}
    </>
  );
}

function Row({ row: r, on, now, onOpen }: { row: ThreadRow; on: boolean; now: number; onOpen: () => void }) {
  const due = r.status === 'closed' ? null : dueLabel(r.reply_due_at, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={on ? 'true' : undefined}
      className={cx(
        'flex w-full gap-2.5 border-b border-l-[3px] border-b-line px-3 py-2.5 text-left',
        on ? 'border-l-primary bg-selection' : due?.state === 'overdue' ? 'border-l-danger hover:bg-subtle' : due?.state === 'at_risk' ? 'border-l-warning hover:bg-subtle' : 'border-l-transparent hover:bg-subtle',
      )}
    >
      <NetChip network={r.network} size={22} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cx('min-w-0 flex-1 truncate text-[13px] text-ink', r.unread ? 'font-bold' : 'font-semibold')}>{r.participant.name}</span>
          <span className="shrink-0 text-[11.5px] text-ink-3">{ageLabel(r.last_message_at, now)}</span>
        </span>
        <span className="line-clamp-2 text-[12.5px] text-ink-2">
          {r.kind === 'review' && r.rating ? (
            <span className="mr-1 text-warning" aria-label={`${r.rating} of 5 stars`}>
              {'★'.repeat(Math.round(r.rating))}
              {'☆'.repeat(Math.max(0, 5 - Math.round(r.rating)))}
            </span>
          ) : null}
          {r.excerpt}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <Tag>{KIND_WORD[r.kind] ?? r.kind}</Tag>
          {r.intent === 'sales' ? <Tag tone="primary">Sales intent</Tag> : r.intent === 'support' ? <Tag>Support</Tag> : r.intent === 'spam' ? <Tag tone="danger">Likely spam</Tag> : null}
          {r.sentiment === 'negative' ? <Tag tone="danger">Negative</Tag> : null}
          {r.assignee ? <Tag>{r.assignee.name}</Tag> : null}
          {due && due.state !== 'ok' ? <span className={cx('text-[11px] font-semibold', due.state === 'overdue' ? 'text-danger' : 'text-warning')}>{due.text}</span> : null}
        </span>
      </span>
    </button>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: 'primary' | 'danger' }) {
  return <span className={cx('inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-semibold', tone === 'primary' ? 'bg-selection text-primary' : tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-subtle text-ink-2')}>{children}</span>;
}
