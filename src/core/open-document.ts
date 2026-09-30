import type { InputOf } from '@shared/ipc/contract';
import { officeDocRoute, officeKind, type OfficeDocSource } from '@shared/office';
import { app } from './app-state';
import { navigate } from './tabs';
import { call, errorMessage } from './bridge';
import { toast } from './toasts';

/**
 * Opens a document a module shows — an attachment, an HR document, an
 * invoice — on this computer rather than in the browser: it is downloaded
 * (the transfer manager shows it), then a PDF opens in PDF Studio and
 * anything else, Word, Excel and PowerPoint files included, in the
 * application the system has for it.
 */
export type DocumentSource = Omit<InputOf<'transfers:download'>, 'name' | 'open'>;

export async function openDocument(source: DocumentSource, name: string): Promise<void> {
  try {
    await call('transfers:download', { ...source, name, open: true } as InputOf<'transfers:download'>);
    toast('info', `Opening ${name}…`);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** The signed token of a `/media/{token}` address (a chat attachment's `download_url`), or null. */
export function mediaToken(url: string | null | undefined): string | null {
  const m = /\/media\/([A-Za-z0-9_\-~.]{8,512})(?:[?#]|$)/.exec(url ?? '');
  return m ? m[1]! : null;
}

/**
 * Opens an Office document a module shows — a mail attachment, a tender's document, a chat file — in a WorkSuite
 * DOC / Sheet / Slides tab, inside the app. `path` is where this server serves it (`/api/…` or `/media/…`).
 */
export function openInOffice(src: OfficeDocSource): void {
  navigate(officeDocRoute(src), app.get().organizationId);
}

/**
 * Whether a file that is not in the Drive opens in a WorkSuite DOC / Sheet / Slides tab: the formats its local
 * editor handles (.docx, .xlsx, .pptx). Older formats (.doc, .xls, .odt…) still download and open as before.
 */
export const isOfficeFile = (name: string): boolean => officeKind(name) !== null && /\.(docx|xlsx|pptx)$/i.test(name);
