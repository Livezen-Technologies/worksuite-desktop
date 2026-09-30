import type { PdfAnnotKind, PdfEditOp, PdfMode, PdfNewAnnot, PdfSessionView } from '@shared/pdf';
import { call } from '../../core/bridge';

/**
 * PDF Studio's editing, as the window drives it (stage D2): the tools, the
 * style they draw with, and the calls. Every change is one operation the
 * main process checks and the engine applies (shared/pdf.ts); the window
 * never holds the document.
 */

export type AnnotTool = Extract<PdfAnnotKind, 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'note' | 'ink' | 'square' | 'circle' | 'line' | 'text' | 'stamp'>;

export const TOOLS: Array<{ id: AnnotTool; label: string; icon: string; key?: string }> = [
  { id: 'highlight', label: 'Highlight', icon: 'highlighter', key: 'Drag across text' },
  { id: 'underline', label: 'Underline', icon: 'type', key: 'Drag across text' },
  { id: 'strikeout', label: 'Strike out', icon: 'minus', key: 'Drag across text' },
  { id: 'squiggly', label: 'Squiggle', icon: 'pen', key: 'Drag across text' },
  { id: 'note', label: 'Note', icon: 'chat', key: 'Click where it goes' },
  { id: 'text', label: 'Text box', icon: 'type', key: 'Drag a box' },
  { id: 'ink', label: 'Draw', icon: 'pen', key: 'Draw freehand' },
  { id: 'square', label: 'Rectangle', icon: 'square', key: 'Drag a box' },
  { id: 'circle', label: 'Ellipse', icon: 'board', key: 'Drag a box' },
  { id: 'line', label: 'Line', icon: 'minus', key: 'Drag from one end to the other' },
  { id: 'stamp', label: 'Stamp', icon: 'check', key: 'Click where it goes' },
];

export const COLORS: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: 'Yellow', rgb: [255, 212, 0] },
  { name: 'Green', rgb: [52, 199, 89] },
  { name: 'Blue', rgb: [0, 122, 255] },
  { name: 'Red', rgb: [230, 57, 70] },
  { name: 'Purple', rgb: [155, 89, 182] },
  { name: 'Black', rgb: [24, 24, 27] },
];

export interface AnnotStyle {
  color: [number, number, number];
  width: number;
  opacity: number;
  stamp: string;
  fontSize: number;
}

export const DEFAULT_STYLE: AnnotStyle = { color: [255, 212, 0], width: 2, opacity: 1, stamp: 'Approved', fontSize: 14 };

/** Highlights are see-through by default, the rest solid. */
export function styleFor(tool: AnnotTool, s: AnnotStyle): { color: [number, number, number]; opacity: number; width: number } {
  if (tool === 'highlight') return { color: s.color, opacity: Math.min(s.opacity, 0.5), width: s.width };
  return { color: s.color, opacity: s.opacity, width: s.width };
}

export function newAnnotId(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `ws-${r}`;
}

export function css([r, g, b]: [number, number, number], a = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const pdfEdit = {
  mode: (session: string, mode: PdfMode, takeover?: boolean) => call('pdf:mode', { session, mode, ...(takeover ? { takeover } : {}) }),
  apply: (session: string, op: PdfEditOp) => call('pdf:edit', { session, op }),
  add: (session: string, page: number, annot: Omit<PdfNewAnnot, 'id'>) => call('pdf:edit', { session, op: { op: 'annot.add', page, annot: { ...annot, id: newAnnotId() } } }),
  undo: (session: string) => call('pdf:undo', { session }),
  redo: (session: string) => call('pdf:redo', { session }),
  annotations: (session: string, page: number) => call('pdf:annotations', { session, page }),
  textSpan: (session: string, page: number, from: [number, number], to: [number, number]) => call('pdf:textSpan', { session, page, from, to }),
  save: (session: string, target: 'version' | 'copy', note?: string) => call('pdf:save', { session, target, ...(note ? { note } : {}) }),
  resolve: (session: string, answer: 'keep_both' | 'upload_as_new_version' | 'use_cloud') => call('pdf:resolve', { session, answer }),
  discard: (session: string) => call('pdf:discard', { session }),
  extract: (session: string, pages: number[]) => call('pdf:extract', { session, pages }),
};

/** Whether changes of this kind can be made in the session's current mode. */
export function canUse(view: PdfSessionView, what: 'annotate' | 'organize'): boolean {
  const e = view.edit;
  if (what === 'annotate') return e.canAnnotate && (view.mode === 'ANNOTATE' || view.mode === 'EDIT');
  return e.canOrganize && view.mode === 'EDIT';
}

/** `page.move`'s `to` for dropping the selected pages before `target` (an index in the document as it is now). */
export function moveTarget(selected: number[], target: number): number {
  return target - selected.filter((p) => p < target).length;
}

/** The title bar's words for where saving has got to (PDF-UI-003). */
export function saveLabel(view: PdfSessionView): { text: string; tone: 'muted' | 'warning' | 'danger' | 'success' } {
  switch (view.saveState) {
    case 'saving':
      return { text: 'Saving…', tone: 'muted' };
    case 'unsaved':
      return { text: 'Unsaved changes', tone: 'warning' };
    case 'saved-locally':
      return { text: 'Saved on this computer', tone: 'warning' };
    case 'saved':
      return view.edit.lastSaved ? { text: `Saved${view.edit.lastSaved.version ? ` · v${view.edit.lastSaved.version}` : ''}`, tone: 'success' } : { text: 'No changes', tone: 'muted' };
    default:
      return { text: 'Read only', tone: 'muted' };
  }
}
