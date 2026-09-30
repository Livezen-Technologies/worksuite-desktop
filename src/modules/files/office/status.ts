import type { OfficeMode } from './api';
import type { OfficeSessionState } from './OfficeSession';

const MODE_LABELS: Record<OfficeMode, string> = { VIEW: 'Viewing', EDIT: 'Editing', COMMENT: 'Commenting', REVIEW: 'Reviewing' };

export function modeLabel(m: OfficeMode): string {
  return MODE_LABELS[m] ?? m;
}

function hhmm(t: number | string | null | undefined): string | null {
  if (t === null || t === undefined) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The title bar's save line (OO-SAV): what the editor has not handed over
 * yet, then what the server says about getting it into Drive — its own
 * sentence when a save is late or failed — then when it was last saved.
 */
export function saveLine(s: Pick<OfficeSessionState, 'phase' | 'loaded' | 'dirty' | 'save' | 'savedAt' | 'connection' | 'mode'>): { text: string; tone: 'muted' | 'warning' | 'danger'; retry: boolean } | null {
  if (s.phase !== 'ready' || !s.loaded) return null;
  if (s.connection === 'reconnecting') return { text: 'Reconnecting…', tone: 'warning', retry: false };
  const save = s.save;
  if (save?.state === 'save_failed') return { text: save.message || 'Save failed', tone: 'danger', retry: save.retry_available };
  if (save?.state === 'save_pending') return { text: save.message || 'Saving is delayed', tone: 'warning', retry: save.retry_available };
  if (s.dirty || save?.state === 'saving') return { text: 'Saving…', tone: 'muted', retry: false };
  if (s.mode === 'VIEW') return null;
  const at = hhmm(s.savedAt) ?? hhmm(save?.last_version?.at);
  return { text: at ? `Saved · ${at}` : 'Saved', tone: 'muted', retry: false };
}
