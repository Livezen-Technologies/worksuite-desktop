import { useQuery } from '@tanstack/react-query';
import { actionLabel, cardActions, isVerifiedWorkSuiteMail, itemLabel, parseItemHeader, type ItemAction, type ItemLink } from '@shared/item-links';
import { linkPrefs } from '@shared/link-prefs';
import { app } from '../../core/app-state';
import { fetchItemStatus, openItemLink, type ItemStatus } from '../../core/item-links';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import type { MessageContext } from './types';
import { workSuiteHosts } from './worksuiteLinks';

/**
 * The action card above a WorkSuite notification email (worksuite-desktop#170).
 *
 * The email's X-WorkSuite-Item header names the item, so the card never reads
 * the HTML. It is drawn only for mail that is verified WorkSuite mail — from
 * WorkSuite's sender, with SPF, DKIM and DMARC passing as the receiving server
 * recorded them, and the server agreeing. Mail that carries the header without
 * all of that gets a warning and never a button.
 */

export type WorkSuiteMail = { link: ItemLink; verified: boolean };

/** The item a message carries, and whether it can be trusted; null for ordinary mail. */
export function workSuiteMailItem(from: string | null | undefined, context: Pick<MessageContext, 'security' | 'worksuite_item'> | null | undefined): WorkSuiteMail | null {
  const wi = context?.worksuite_item;
  if (!wi) return null;
  const link = parseItemHeader(wi.header);
  if (!link) return null;
  // WorkSuite's own sender, and the signed-in server's (a self-hosted WorkSuite sends from its own domain).
  const senders = workSuiteHosts().flatMap((h) => (h ? [`no-reply@${h}`, `notifications@${h}`] : []));
  return { link, verified: isVerifiedWorkSuiteMail({ from, security: context?.security, serverVerified: wi.verified, senders }) };
}

const ICON: Record<string, string> = {
  file: 'file',
  folder: 'folder',
  shared: 'folder-open',
  meeting: 'video',
  event: 'calendar',
  note: 'notebook',
  task: 'tasks',
  reminder: 'snooze',
  alert: 'warning',
  chat: 'chat',
  message: 'chat',
  mention: 'at',
  tender: 'file-text',
  invoice: 'receipt',
  expense: 'wallet',
  lead: 'users',
  deal: 'handshake',
};

/** The words for an item's state, when it cannot be acted on. */
export function stateWords(type: string, status: ItemStatus | null | undefined): string | null {
  if (!status) return null;
  if (!status.allowed || status.state === 'access_removed') return status.state_label ?? 'Access removed';
  if (status.state === 'missing') return status.state_label ?? 'No longer available';
  if (status.state === 'ended') return status.state_label ?? (type === 'meeting' ? 'Meeting ended' : 'Ended');
  if (status.state === 'completed') return status.state_label ?? (type === 'task' || type === 'reminder' ? 'Task already completed' : 'Completed');
  return null;
}

/** The buttons for an item in its state: none when access is gone, no Join for a meeting that ended, no Mark done twice. */
export function buttonsFor(type: string, status: ItemStatus | null | undefined): ItemAction[] {
  const all = cardActions(type);
  if (status && (!status.allowed || status.state === 'access_removed' || status.state === 'missing')) return [];
  if (status?.state === 'ended') return all.filter((a) => a !== 'join');
  if (status?.state === 'completed') return all.filter((a) => a !== 'done' && a !== 'snooze');
  return all;
}

export function openFromMail(link: ItemLink, action: ItemAction, status: ItemStatus | null | undefined): void {
  void openItemLink({ ...link, action, explicitAction: action !== 'open' }, { source: 'email', place: linkPrefs(app.get().prefs).mailLinks, status: status ?? undefined });
}

export function WorkSuiteCard({ mail, offline }: { mail: WorkSuiteMail; offline: boolean }) {
  const { link, verified } = mail;
  const online = useStore(app, (s) => s.status?.network !== 'OFFLINE');
  const status = useQuery({
    queryKey: ['links', 'item', link.org, link.type, link.id],
    queryFn: () => fetchItemStatus(link),
    enabled: verified && online && !offline,
    staleTime: 60_000,
  });

  if (!verified) {
    return (
      <div role="alert" className="mx-6 mt-3 flex items-start gap-2 rounded-[8px] border border-warning bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
        <Icon name="shield-alert" size={15} className="mt-0.5 shrink-0" />
        <span>{text('This email says it is from WorkSuite, but that could not be verified. Its buttons are not shown — don’t trust its links or attachments.')}</span>
      </div>
    );
  }

  const s = status.data ?? null;
  const state = stateWords(link.type, s);
  const buttons = buttonsFor(link.type, s);
  const meta = [s?.kind_label ?? itemLabel(link.type), s?.size ? bytes(s.size) : null, s?.sharer ? text('Shared by {name}', { name: s.sharer }) : null, s?.detail ?? null].filter(Boolean).join(' · ');

  return (
    <section aria-label={text('WorkSuite item')} className="mx-6 mt-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-subtle px-3.5 py-2.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-selection text-primary">
        <Icon name={ICON[link.type] ?? 'link'} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-ink">{s?.title ?? text('A WorkSuite {item}', { item: itemLabel(link.type) })}</div>
        <div className="truncate text-[12px] text-ink-3">
          {meta}
          {state ? <span className="ml-1 font-semibold text-warning">· {state}</span> : null}
          {!online || offline ? <span className="ml-1">· {text('Offline')}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {buttons.map((a, i) => (
          <Button key={a} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => openFromMail(link, a, s)}>
            {actionLabel(a)}
          </Button>
        ))}
      </div>
    </section>
  );
}
