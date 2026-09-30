import { call } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { serverHasOffice, type OfficeMode } from './api';

/**
 * Open a Drive Office file (OO-DSK): in a WorkSuite Office window of its own
 * when the server has WorkSuite Office — the window explains a refusal (the
 * company's "desktop" switch off, no Document Server) and offers the way
 * round — and on the web, as before, when it does not.
 */
export async function openOffice(f: { id: number; name: string }, mode: OfficeMode | null = null): Promise<void> {
  try {
    if (await serverHasOffice()) {
      await call('office:open', { fileId: f.id, name: f.name, mode });
      return;
    }
  } catch (e) {
    toast('error', e instanceof Error ? e.message : 'The document could not be opened.');
    return;
  }
  await call('app:openInBrowser', { path: `/editor/${f.id}` }).catch(() => undefined);
}
