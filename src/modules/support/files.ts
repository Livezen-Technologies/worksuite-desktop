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
