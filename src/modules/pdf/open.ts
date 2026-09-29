import type { PdfSource } from '@shared/pdf';
import { activate, openTab, tabsStore } from '../../core/tabs';
import { routeFor } from './client';

/**
 * The PDF hand-off (CoreFilePreviewWorkspace's job for application/pdf, SRS
 * §2.1): other screens open a PDF in PDF Studio through here — each PDF in a
 * tab of its own (PDF-UI-004), and the tab already showing it brought to the
 * front instead of a second copy.
 */
export function openPdf(source: PdfSource, title?: string): void {
  const route = routeFor(source);
  const open = tabsStore.get().tabs.find((t) => t.route === route);
  if (open) activate(open.id);
  else openTab(route, { title: title ?? 'PDF' });
}
