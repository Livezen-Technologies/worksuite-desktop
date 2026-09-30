import type { InputOf } from '@shared/ipc/contract';
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
