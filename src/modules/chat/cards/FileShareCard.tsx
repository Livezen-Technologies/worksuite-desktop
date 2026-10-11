import { useState } from 'react';
import { canOpenLink } from '@shared/access';
import { useVisibleIds } from '../../../core/access';
import { apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { bytes } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { FileBadge } from '../../../components/ui';
import { CardFrame, Chip, type CardAction } from './CardFrame';

type Level = 'view' | 'comment' | 'edit' | 'full';

/** One item on a share card, as the server worked it out for this reader (ShareCards::card). */
export interface ShareItem {
  type: 'file' | 'folder';
  id?: number;
  available: boolean;
  name?: string;
  extension?: string | null;
  size?: number | null;
  count?: number | null;
  level?: Level;
  can_download?: boolean;
  link?: string;
  show?: string;
}

/**
 * A `drive.share` card (worksuite-desktop#164): somebody shared files or
 * folders with the reader, or with a team they are in. The server works out
 * for each reader what is still theirs to open, their access now, and whether
 * it changed or was taken away since — a change of access redraws it.
 */
export interface FileShareCardData {
  kind: 'drive.share';
  available?: boolean;
  mine?: boolean;
  sharer?: string;
  to?: 'person' | 'team';
  team?: string | null;
  level?: Level;
  level_now?: Level | null;
  state?: 'shared' | 'changed' | 'removed';
  count?: number;
  note?: string | null;
  items?: ShareItem[];
  can_request_edit?: boolean;
}

export const LEVEL_WORDS: Record<Level, string> = { view: 'Can view', comment: 'Can comment', edit: 'Can edit', full: 'Full access' };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "a file", "a folder", "5 files", "3 items". */
export function shareWhat(items: Array<Pick<ShareItem, 'type'>>): string {
  const n = items.length;
  const types = new Set(items.map((i) => i.type));
  const noun = types.size === 1 && types.has('folder') ? 'folder' : types.size === 1 ? 'file' : 'item';
  return n === 1 ? `a ${noun}` : plural(n, noun);
}

/** "Nimal shared a file with you", "You shared 3 files with Design". */
export function shareHeadline(c: FileShareCardData): string {
  const what = shareWhat(c.items ?? []);
  const whom = c.to === 'team' ? (c.team ?? 'the team') : c.mine ? 'them' : 'you';
  return `${c.mine ? 'You' : (c.sharer ?? 'Somebody')} shared ${what} with ${whom}`;
}

function facts(i: ShareItem): string {
  if (i.type === 'folder') return i.count != null ? `Folder · ${plural(i.count, 'item')}` : 'Folder';
  const ext = (i.extension ?? i.name?.split('.').pop() ?? '').toUpperCase();
  return `${ext || 'File'}${i.size ? ` · ${bytes(i.size)}` : ''}`;
}

export function FileShareCard({ card, onOpen }: { card: FileShareCardData; onOpen: (link: string) => void }) {
  const visible = useVisibleIds();
  const [asked, setAsked] = useState(false);
  const items = card.items ?? [];
  const open = items.filter((i) => i.available);
  const folder = items.length > 0 && items.every((i) => i.type === 'folder');
  const kind = folder ? 'folder' : 'file';
  const label = card.to === 'team' ? `Drive · Shared with ${card.team ?? 'the team'}` : card.mine ? 'Drive · You shared' : 'Drive · Shared with you';
  const level = card.level ?? 'view';

  if (card.state === 'removed' || open.length === 0) {
    return (
      <CardFrame
        kind={kind}
        label={label}
        state="noaccess"
        gone={{ title: 'No longer shared', sub: card.mine ? 'Nobody here can open it now.' : `${card.sharer ?? 'The person who shared it'} stopped sharing ${shareWhat(items) === 'a folder' ? 'this folder' : items.length === 1 ? 'this file' : 'these'} with you.` }}
      />
    );
  }

  const one = items.length === 1 ? open[0] : undefined;
  const go = (link?: string) => (link && canOpenLink(link, visible) ? () => onOpen(link) : undefined);
  const requestEdit = async (i: ShareItem) => {
    try {
      await apiPost(`/api/drive/access/${i.type}/${i.id}/request-edit`, {});
      setAsked(true);
      toast('success', 'Edit access requested. The owner will be told.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const actions: CardAction[] = [];
  if (one) {
    const openIt = go(one.link);
    if (openIt) actions.push({ label: one.type === 'folder' ? 'Open folder' : 'Open', tone: 'primary', onClick: openIt });
    if (one.type === 'file' && one.can_download && one.id) {
      actions.push({ label: 'Download', onClick: () => void call('transfers:download', { fileId: String(one.id), name: one.name ?? 'download' }).then(() => toast('success', 'Downloading.'), () => toast('error', 'That could not be downloaded.')) });
    }
    const show = go(one.show);
    if (show) actions.push({ label: 'Show in Files', onClick: show });
    if (card.can_request_edit && one.id) actions.push({ label: asked ? 'Edit access requested' : 'Request edit access', disabled: asked, onClick: () => void requestEdit(one) });
  } else {
    const show = go('/files?view=shared');
    if (show) actions.push({ label: 'Show in Files', tone: 'primary', onClick: show });
  }

  const now = card.level_now ?? level;
  return (
    <CardFrame kind={kind} label={label} actions={actions}>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <span className="text-[12.5px] text-ink-2 dark:text-[#C9CFE6]">
          <b className="text-ink dark:text-[#E8EBF7]">{shareHeadline(card)}</b> · {LEVEL_WORDS[level]}
        </span>
        {card.state === 'changed' ? (
          <span>
            <Chip tone="amber">Access changed to {LEVEL_WORDS[now]}</Chip>
          </span>
        ) : null}
        {one ? (
          <div className="flex items-center gap-3">
            {one.type === 'folder' ? (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[#FDF1DF] text-[#F0A43A] dark:bg-[#2A2213]">
                <Icon name="folder" size={24} />
              </span>
            ) : (
              <FileBadge name={one.name ?? 'file'} size={44} />
            )}
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[14.5px]">{one.name}</b>
              <span className="block truncate text-[12.5px] text-ink-3 dark:text-[#8D96B8]">{facts(one)}</span>
            </span>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {items.slice(0, 5).map((i, n) =>
              i.available ? (
                <li key={`${i.type}${i.id ?? n}`}>
                  <button type="button" disabled={!go(i.link)} onClick={(e) => (e.stopPropagation(), go(i.link)?.())} className="flex w-full items-center gap-2.5 rounded-[8px] px-1 py-1 text-left hover:bg-subtle disabled:hover:bg-transparent dark:hover:bg-[#1A2442]">
                    {i.type === 'folder' ? <Icon name="folder" size={18} className="shrink-0 text-[#F0A43A]" /> : <FileBadge name={i.name ?? 'file'} size={26} />}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{i.name}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-3 dark:text-[#8D96B8]">{facts(i)}</span>
                  </button>
                </li>
              ) : (
                <li key={`gone${n}`} className="flex items-center gap-2.5 px-1 py-1 text-[12.5px] text-ink-3">
                  <Icon name="lock" size={14} className="shrink-0" />
                  No longer shared with you
                </li>
              ),
            )}
            {items.length > 5 ? <li className="px-1 text-[12px] text-ink-3">and {items.length - 5} more</li> : null}
          </ul>
        )}
      </div>
    </CardFrame>
  );
}
