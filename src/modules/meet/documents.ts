import { officeDocRoute, officeKind, officeRoute } from '@shared/office';
import { mediaToken } from '../../core/open-document';
import type { ChatFile } from '../chat/types';
import type { DriveCard } from '../chat/cards/DriveMeetCards';

export interface SharedDocument {
  message_id: number;
  sender_name: string;
  created_at: string;
  file?: ChatFile;
  card?: DriveCard;
}

/** Only a per-reader, available Drive file may address an integrated editor. */
export function documentRoute(document: SharedDocument): string | null {
  const card = document.card;
  if (card) {
    if (card.available !== true || card.kind !== 'drive.file' || !Number.isSafeInteger(card.id) || card.id! <= 0 || !card.name) return null;
    if (/\.pdf$/i.test(card.name)) return `/pdf?file=${card.id}`;
    if (officeKind(card.name)) return officeRoute(card.id!, { name: card.name });
    return null;
  }
  const file = document.file;
  if (!file || !/\.(docx|xlsx|pptx)$/i.test(file.filename)) return null;
  const token = mediaToken(file.download_url);
  return token ? officeDocRoute({ kind: 'api', path: `/media/${token}?download=1`, name: file.filename }) : null;
}
