import type { Attachment } from '@shared/support';
import { mediaToken, openDocument } from '../../core/open-document';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { attachmentLink, errorText } from './api';

/**
 * A file on a ticket, opened on this computer (FR-DSK-06): the server's ten-minute `/media/{token}` link goes to the
 * download manager like any signed media file (`chatMedia`, the contract's name for one), which hands a PDF to PDF
 * Studio and anything else to the application the system has for it; the transfers panel can reveal it in Finder or
 * Explorer. The bytes never pass through the page.
 */
export async function openAttachment(a: Pick<Attachment, 'id' | 'name'>): Promise<void> {
  try {
    const r = await attachmentLink(a.id);
    const token = mediaToken(r.url);
    if (!token) {
      toast('error', text('The server did not give a link to {name}.', { name: a.name }));
      return;
    }
    await openDocument({ chatMedia: token }, a.name);
  } catch (e) {
    toast('error', errorText(e, text('{name} could not be opened.', { name: a.name })));
  }
}

/** The server's links last ten minutes: one is used again for eight, then asked for afresh. */
const LINK_TTL = 8 * 60_000;
const links = new Map<number, { path: string | null; at: number }>();
const asking = new Map<number, Promise<string | null>>();

/**
 * A file's signed `/media/{token}` path, to show a picture inline or in the viewer (#332): the same link Open uses,
 * kept for a while so a thread of pictures asks once for each. Null when the server gives none (no Drive file).
 */
export function mediaPath(id: number): Promise<string | null> {
  const kept = links.get(id);
  if (kept && Date.now() - kept.at < LINK_TTL) return Promise.resolve(kept.path);
  const busy = asking.get(id);
  if (busy) return busy;
  const ask = attachmentLink(id)
    .then((r) => {
      const token = mediaToken(r.url);
      const path = token ? `/media/${token}` : null;
      links.set(id, { path, at: Date.now() });
      return path;
    })
    .finally(() => asking.delete(id));
  asking.set(id, ask);
  return ask;
}

/** The link already known for a file and still good, if any: a picture drawn again is not asked for again. */
export function keptMediaPath(id: number): string | null | undefined {
  const kept = links.get(id);
  return kept && Date.now() - kept.at < LINK_TTL ? kept.path : undefined;
}

/** Forgets the links (for tests). */
export function forgetMediaPaths(): void {
  links.clear();
  asking.clear();
}
