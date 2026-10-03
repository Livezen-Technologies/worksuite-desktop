import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useTab } from '../../core/tab-context';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal, Spinner, cx } from '../../components/ui';

/**
 * Link mail to a tender, a customer or a deal (api/mail/links). From the list's right-click menu (one message or
 * all those selected) and the reader's More menu; the reader shows what a message is linked to, and a tender's
 * page shows the mail linked to it. Kinds the person may not see, or whose module is off, are not offered.
 */

export type RecordKind = 'tender' | 'customer' | 'deal';

/** A message as the server names it: `stateItem` in states.ts. */
export interface LinkItem {
  mailbox: number;
  folder: string;
  uid: string;
  message_id?: string;
  subject?: string;
  from_name?: string;
  from_email?: string;
  received_at?: string;
}

export interface RecordLink {
  id: number;
  mailbox: number;
  folder: string;
  uid: string;
  message_id: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  received_at: string | null;
  record_type: RecordKind;
  record_id: number;
  record_name?: string;
}

export interface LinkTarget {
  type: RecordKind;
  id: number;
  name: string;
  sub: string | null;
  suggested?: boolean;
}

export const KIND_LABEL: Record<RecordKind, string> = { tender: 'Tender', customer: 'Customer', deal: 'Deal' };
const KIND_ICON: Record<RecordKind, string> = { tender: 'briefcase', customer: 'building', deal: 'handshake' };

export const linkKeys = {
  message: (i: Pick<LinkItem, 'mailbox' | 'folder' | 'uid'>) => ['mail', 'links', i.mailbox, i.folder, i.uid] as const,
  record: (kind: RecordKind, id: number) => ['mail', 'links', 'record', kind, id] as const,
};

/** null when the server has no such call yet (an older WorkSuite): then nothing about links is shown. */
async function optional<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T | null> {
  try {
    return await apiGet<T>(path, params);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
    throw e;
  }
}

export function useMessageLinks(item: LinkItem | null, enabled = true) {
  return useQuery({
    queryKey: item ? linkKeys.message(item) : ['mail', 'links', 'none'],
    queryFn: () => optional<{ kinds: RecordKind[]; links: RecordLink[] }>('/api/mail/links', { mailbox: item!.mailbox, folder: item!.folder, uid: item!.uid, message_id: item!.message_id }),
    enabled: enabled && !!item,
    staleTime: 60_000,
  });
}

export function useRecordMail(kind: RecordKind, id: number, enabled = true) {
  return useQuery({
    queryKey: linkKeys.record(kind, id),
    queryFn: () => optional<{ record: { type: RecordKind; id: number; name: string }; messages: RecordLink[] }>(`/api/mail/links/record/${kind}/${id}`),
    enabled,
    staleTime: 60_000,
  });
}

export const linkMessages = (items: LinkItem[], type: RecordKind, id: number) => apiPost<{ links: RecordLink[]; record_name: string }>('/api/mail/links', { items, type, id });
export const unlinkMessage = (linkId: number) => apiDelete(`/api/mail/links/${linkId}`);
export const fetchTargets = (type: RecordKind, q: string, from?: string, signal?: AbortSignal) => apiGet<{ items: LinkTarget[] }>('/api/mail/links/targets', { type, q, from }, signal);

/** Where a linked record opens in the app: a tender's page, a deal on the pipeline. A customer has no page here. */
export function recordRoute(kind: RecordKind, id: number): string | null {
  if (kind === 'tender') return `/tenders?open=${id}`;
  if (kind === 'deal') return `/crm?deal=${id}`;
  return null;
}

/** Where a linked message opens in Mail. */
export function messageRoute(l: Pick<RecordLink, 'mailbox' | 'folder' | 'uid'>): string {
  const q = new URLSearchParams({ folder: l.folder, msg: l.uid, mf: l.folder });
  // Mailbox 0 is the person's own WorkSuite store: the page's own box then.
  if (l.mailbox) {
    q.set('box', String(l.mailbox));
    q.set('mbx', String(l.mailbox));
  }
  return `/mail?${q}`;
}

/** "Link to tender / customer / deal…" — pick the kind, search, pick a record. */
export function LinkRecordDialog({ items, kinds, onClose }: { items: LinkItem[]; kinds?: RecordKind[]; onClose: () => void }) {
  const qc = useQueryClient();
  const first = items[0];
  // The kinds on offer: given by the caller, or asked of the server with the first message.
  const asked = useMessageLinks(kinds ? null : (first ?? null));
  const offered = kinds ?? asked.data?.kinds ?? [];
  const [kind, setKind] = useState<RecordKind | null>(null);
  const active = kind && offered.includes(kind) ? kind : (offered[0] ?? null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const from = items.length === 1 ? first?.from_email : undefined;
  const targets = useQuery({
    queryKey: ['mail', 'links', 'targets', active, debounced, from ?? ''],
    queryFn: ({ signal }) => fetchTargets(active!, debounced, from, signal),
    enabled: !!active,
    staleTime: 30_000,
  });
  const linked = new Set((asked.data?.links ?? []).map((l) => `${l.record_type}:${l.record_id}`));

  const pick = async (t: LinkTarget) => {
    setBusy(t.id);
    try {
      const r = await linkMessages(items, t.type, t.id);
      void qc.invalidateQueries({ queryKey: ['mail', 'links'] });
      toast('success', items.length === 1 ? text('Linked to {name}.', { name: r.record_name ?? t.name }) : text('{n} messages linked to {name}.', { n: items.length, name: r.record_name ?? t.name }));
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const title = items.length === 1 ? text('Link to tender, customer or deal') : text('Link {n} messages', { n: items.length });
  return (
    <Modal title={title} labelledBy="mail-link-record" width={480} onClose={onClose} footer={<Button onClick={onClose}>{text('Cancel')}</Button>}>
      <div className="flex flex-col gap-3 p-4">
        {!kinds && asked.isLoading ? <Spinner /> : null}
        {!asked.isLoading && offered.length === 0 ? (
          <p className="text-[13px] text-ink-2">{asked.data === null ? text('This WorkSuite server cannot link mail to records yet.') : text('You do not have access to tenders, customers or deals.')}</p>
        ) : null}
        {offered.length > 1 ? (
          <div role="tablist" aria-label={text('Kind of record')} className="flex gap-1">
            {offered.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active === k}
                onClick={() => setKind(k)}
                className={cx('inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold', active === k ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}
              >
                <Icon name={KIND_ICON[k]} size={14} />
                {text(KIND_LABEL[k])}
              </button>
            ))}
          </div>
        ) : null}
        {active ? (
          <>
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={text('Search {kind}s by name or reference', { kind: text(KIND_LABEL[active]).toLowerCase() })}
              aria-label={text('Search')}
              className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-primary"
            />
            <ul role="list" aria-label={text('Records')} className="max-h-[320px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
              {targets.isLoading ? (
                <li className="p-3">
                  <Spinner />
                </li>
              ) : null}
              {(targets.data?.items ?? []).map((t) => {
                const already = items.length === 1 && linked.has(`${t.type}:${t.id}`);
                return (
                  <li key={`${t.type}:${t.id}`}>
                    <button
                      type="button"
                      disabled={busy !== null || already}
                      onClick={() => void pick(t)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-subtle disabled:opacity-60"
                    >
                      <Icon name={KIND_ICON[t.type]} size={14} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-ink">{t.name}</span>
                        {t.sub ? <span className="block truncate text-[12px] text-ink-3">{t.sub}</span> : null}
                      </span>
                      {t.suggested ? <Chip tone="indigo">{text('From this sender')}</Chip> : null}
                      {already ? <Chip tone="success">{text('Linked')}</Chip> : null}
                      {busy === t.id ? <Spinner /> : null}
                    </button>
                  </li>
                );
              })}
              {!targets.isLoading && targets.data?.items.length === 0 ? <li className="px-3 py-2 text-[13px] text-ink-3">{text('Nothing found.')}</li> : null}
              {targets.error ? <li className="px-3 py-2 text-[13px] text-danger">{errorMessage(targets.error)}</li> : null}
            </ul>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** The reader's chips: what this message is linked to, each opening its record, each with ✕ to unlink. */
export function LinkedRecordChips({ item, navigate, offline }: { item: LinkItem; navigate: (route: string) => void; offline?: boolean }) {
  const qc = useQueryClient();
  const links = useMessageLinks(item, !offline);
  const list = links.data?.links ?? [];
  if (list.length === 0) return null;
  const unlink = async (l: RecordLink) => {
    try {
      await unlinkMessage(l.id);
      void qc.invalidateQueries({ queryKey: ['mail', 'links'] });
      toast('success', text('Unlinked from {name}.', { name: l.record_name ?? '' }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <>
      {list.map((l) => {
        const route = recordRoute(l.record_type, l.record_id);
        return (
          <span key={l.id} className="inline-flex items-center gap-0.5 rounded-full bg-selection pr-1 pl-2 text-[12px] font-semibold text-primary" data-testid="mail-record-link">
            <Icon name={KIND_ICON[l.record_type]} size={12} />
            {route ? (
              <button type="button" onClick={() => navigate(route)} className="max-w-[220px] truncate hover:underline" title={text('Open {kind} {name}', { kind: text(KIND_LABEL[l.record_type]).toLowerCase(), name: l.record_name ?? '' })}>
                {l.record_name}
              </button>
            ) : (
              <span className="max-w-[220px] truncate" title={text(KIND_LABEL[l.record_type])}>
                {l.record_name}
              </span>
            )}
            <button type="button" onClick={() => void unlink(l)} aria-label={text('Unlink from {name}', { name: l.record_name ?? '' })} className="ml-0.5 rounded-full p-0.5 hover:bg-primary/10">
              <Icon name="x" size={11} />
            </button>
          </span>
        );
      })}
    </>
  );
}

/** A record's page: the mail linked to it, newest first, each opening in Mail. */
export function RecordMail({ kind, id }: { kind: RecordKind; id: number }) {
  const { navigate } = useTab();
  const q = useRecordMail(kind, id);
  if (q.isLoading) return <Spinner />;
  if (q.data === null) return <p className="p-4 text-[13px] text-ink-2">{text('This WorkSuite server cannot link mail to records yet.')}</p>;
  if (q.error) return <p className="p-4 text-[13px] text-danger">{errorMessage(q.error)}</p>;
  const rows = q.data?.messages ?? [];
  if (rows.length === 0)
    return <p className="p-4 text-[13px] text-ink-2">{text('No email is linked yet. In Mail, right-click a message and choose “Link to tender, customer or deal…”.')}</p>;
  return (
    <ul role="list" aria-label={text('Linked email')} className="divide-y divide-line rounded-[10px] border border-line bg-surface">
      {rows.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => navigate(messageRoute(m))} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle">
            <Icon name="mail" size={14} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-ink">{m.subject || text('(no subject)')}</span>
              <span className="block truncate text-[12px] text-ink-3">{m.from_name || m.from_email || ''}</span>
            </span>
            {m.received_at ? <span className="shrink-0 text-[12px] text-ink-3">{dateLabel(m.received_at)}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
