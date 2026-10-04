import { canOpenLink } from '@shared/access';
import { CardFrame } from '../cards/CardFrame';
import { DriveShareCard, type DriveCard } from '../cards/DriveMeetCards';
import { FileShareCard, type FileShareCardData } from '../cards/FileShareCard';
import { RecordCards } from '../cards/RecordCards';
import type { TeamChatMessage } from './model';

/**
 * A Team Chat message's record or share card (worksuite-desktop#164), drawn inside the kit's RecordMessage. Team Chat
 * hands it to the list as a renderer; a website chat has none. Moved here from Thread with the kit (#229).
 */
export function MessageRecords({ m, named, openLink, visible }: { m: TeamChatMessage; named: boolean; openLink: (link: string) => void; visible: ReadonlySet<string> }) {
  if (named) return <RecordCards text={m.message} />;
  const card = m.card;
  if (!card) return null;
  if (card.kind === 'drive.share') return <FileShareCard card={card as unknown as FileShareCardData} onOpen={openLink} />;
  if (card.kind.startsWith('drive.')) return <DriveShareCard card={card as DriveCard} onOpen={openLink} />;
  return (
    <CardFrame
      kind="link"
      label={card.heading ?? card.kind.split('.')[0]}
      state={card.available === false ? 'noaccess' : 'ok'}
      gone={card.available === false ? { title: 'You don’t have access', sub: card.why ?? '' } : undefined}
      actions={card.available !== false && card.link && canOpenLink(card.link, visible) ? [{ label: 'Open', onClick: () => openLink(card.link!) }] : []}
    >
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <b className="text-[13px]">
          {card.name ?? card.what ?? ''}
          {card.who ? ` · ${card.who}` : ''}
        </b>
        {card.owner ? <span className="text-[12px] text-ink-3">{card.owner}</span> : null}
      </div>
    </CardFrame>
  );
}
