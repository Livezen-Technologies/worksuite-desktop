import { useQuery } from '@tanstack/react-query';
import { canOpenLink } from '@shared/access';
import { useVisibleIds } from '../../../core/access';
import { ApiError, apiGet } from '../../../core/api';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { call } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { FileBadge } from '../../../components/ui';
import { openMeeting } from '../../meet/api';
import { CardFrame, Chip } from './CardFrame';

/**
 * A Drive file or folder the server has already worked out for this reader
 * (MessageCards → DriveChat::card): its name, type, size and owner, or that
 * it is not theirs to open.
 */
export interface DriveCard {
  kind: string;
  available?: boolean;
  why?: string;
  type?: 'file' | 'folder';
  id?: number;
  name?: string;
  extension?: string | null;
  size?: number | null;
  owner?: string;
  link?: string;
  note?: string | null;
}

const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function DriveShareCard({ card, onOpen }: { card: DriveCard; onOpen: (link: string) => void }) {
  const visible = useVisibleIds();
  const folder = card.type === 'folder' || card.kind === 'drive.folder';
  if (card.available === false) {
    return <CardFrame kind={folder ? 'folder' : 'file'} state="noaccess" gone={{ title: 'You don’t have access', sub: card.why ?? `Ask the owner to share this ${folder ? 'folder' : 'file'} with you.` }} />;
  }
  const ext = (card.extension ?? card.name?.split('.').pop() ?? '').toUpperCase();
  // Open goes into Files: only for whoever has it. The file itself was sent to them, so Download stays.
  const actions = [
    ...(canOpenLink(card.link, visible) ? [{ label: 'Open', tone: 'primary' as const, onClick: () => card.link && onOpen(card.link) }] : []),
    ...(!folder && card.id ? [{ label: 'Download', onClick: () => void call('transfers:download', { fileId: String(card.id), name: card.name ?? 'download' }).then(() => toast('success', 'Downloading.'), () => toast('error', 'That could not be downloaded.')) }] : []),
  ];
  return (
    <CardFrame kind={folder ? 'folder' : 'file'} actions={actions} foot={card.owner ? `From ${card.owner}` : undefined}>
      <div className="flex items-center gap-3 px-3.5 py-3.5">
        {folder ? (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-[#FDF1DF] text-[#F0A43A] dark:bg-[#2A2213]">
            <Icon name="folder" size={26} />
          </span>
        ) : (
          <FileBadge name={card.name ?? 'file'} size={48} />
        )}
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[15px]">{card.name ?? (folder ? 'Folder' : 'File')}</b>
          <span className="block truncate text-[12.5px] text-ink-3 dark:text-[#8D96B8]">
            {folder ? 'Folder' : `${ext || 'File'}${card.size ? ` · ${bytes(card.size)}` : ''}`}
            {card.owner ? ` · ${card.owner}` : ''}
          </span>
          {card.note ? <span className="mt-1 block text-[12.5px] text-ink-2 dark:text-[#C9CFE6]">{card.note}</span> : null}
        </span>
      </div>
    </CardFrame>
  );
}

interface MeetPublic {
  title: string | null;
  host_name: string | null;
  ended: boolean;
  locked: boolean;
  needs_passcode: boolean;
}

/**
 * A meeting link in a message, read afresh for whoever looks, from the
 * meeting's public facts (`/api/meet/{uuid}/public`: what a guest's link
 * page shows). Unlike `/api/meet/{uuid}` it has no side effects — no chat
 * room made, no join token minted — so a card can ask it every minute. It
 * cannot tell who is in the call right now, so the card does not claim to.
 */
export function MeetShareCard({ uuid }: { uuid: string }) {
  const q = useQuery({
    queryKey: ['chat', 'card', 'meet', uuid],
    queryFn: ({ signal }) => apiGet<MeetPublic>(`/api/meet/${uuid}/public`, undefined, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const origin = useStore(app, (x) => x.auth?.server?.origin) ?? 'https://app.worksuite.lk';
  const copy = () => void navigator.clipboard.writeText(`${origin.replace(/\/+$/, '')}/meet/${uuid}`).then(() => toast('success', 'Meeting link copied.'));
  if (q.isLoading) return <CardFrame kind="meet" state="loading" />;
  if (q.error || !q.data) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410);
    return <CardFrame kind="meet" state={gone ? 'deleted' : 'noaccess'} gone={gone ? { title: 'This meeting is not there any more', sub: 'The link may be old, or the meeting was removed.' } : undefined} />;
  }
  const m = q.data;
  if (m.ended) return <CardFrame kind="meet" state="ended" gone={{ title: 'This meeting has ended', sub: m.host_name ? `It was hosted by ${m.host_name}.` : 'The link no longer starts it.' }} />;
  return (
    <CardFrame
      kind="meet"
      actions={[
        { label: 'Join', tone: 'go', onClick: () => void openMeeting(uuid, m.title) },
        { label: 'Copy link', onClick: copy },
      ]}
      foot={m.needs_passcode ? 'Needs its passcode' : undefined}
    >
      <div className="flex flex-col gap-2 px-3.5 py-3.5">
        <b className="text-[16px]">{m.title || 'WorkSuite meeting'}</b>
        <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3 dark:text-[#8D96B8]">
          {m.host_name ? <span>Hosted by {m.host_name}</span> : null}
          {m.locked ? (
            <Chip tone="amber">
              <Icon name="lock" size={12} />
              Locked by the host
            </Chip>
          ) : null}
        </span>
        <div className="flex items-center gap-2 rounded-[10px] bg-well px-2.5 py-2 dark:bg-[#0F1629]">
          <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:text-[#8D96B8]">Meeting ID</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{uuid}</code>
          <button type="button" aria-label="Copy meeting link" onClick={(e) => (e.stopPropagation(), copy())} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink dark:hover:bg-[#1A2442]">
            <Icon name="copy" size={14} />
          </button>
        </div>
      </div>
    </CardFrame>
  );
}
