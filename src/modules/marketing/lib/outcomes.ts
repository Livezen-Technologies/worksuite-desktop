import type { Outcome } from '../api';
import type { Tone } from './consent';

/**
 * The ten call outcomes (MKT-CAL-04) and what the server does with each (WF-13 step 6): a retry for no answer and
 * busy until the attempt limit (MKT-CAL-05), a Task for a callback (MKT-CAL-06), a phone suppression for do not call
 * (MKT-CAL-09), and the CRM hand-over offered for interested (MKT-CAL-10). In the design's order.
 */
export interface OutcomeInfo {
  id: Outcome;
  label: string;
  tone: Tone;
  /** What saving it does, said under the grid. */
  effect: string;
  /** The contact was reached (the "Reached" figure). */
  reached: boolean;
  /** Ends the contact's run in this campaign. */
  final: boolean;
}

export const OUTCOMES: readonly OutcomeInfo[] = [
  { id: 'interested', label: 'Interested', tone: 'success', effect: 'Offers the CRM hand-over now.', reached: true, final: true },
  { id: 'callback', label: 'Callback', tone: 'indigo', effect: 'Books a callback as a Task and returns the contact when it is due.', reached: true, final: false },
  { id: 'not_interested', label: 'Not interested', tone: 'muted', effect: 'Completes the contact in this campaign.', reached: true, final: true },
  { id: 'no_answer', label: 'No answer', tone: 'warning', effect: 'Tries again after the retry delay, up to the attempt limit.', reached: false, final: false },
  { id: 'busy', label: 'Busy', tone: 'warning', effect: 'Tries again after the retry delay, up to the attempt limit.', reached: false, final: false },
  { id: 'voicemail', label: 'Voicemail', tone: 'muted', effect: 'Completes the attempt; no retry.', reached: false, final: true },
  { id: 'wrong_number', label: 'Wrong number', tone: 'danger', effect: 'Completes the contact; the number is marked wrong.', reached: false, final: true },
  { id: 'not_decision_maker', label: 'Not decision maker', tone: 'muted', effect: 'Completes the contact in this campaign.', reached: true, final: true },
  { id: 'bad_number', label: 'Bad number', tone: 'danger', effect: 'Completes the contact; the number is marked bad.', reached: false, final: true },
  { id: 'do_not_call', label: 'Do not call', tone: 'danger', effect: 'Suppresses this phone number for the whole company, now.', reached: true, final: true },
];

export function outcomeInfo(o: string | null | undefined): OutcomeInfo | null {
  return OUTCOMES.find((x) => x.id === o) ?? null;
}

export function outcomeLabel(o: string | null | undefined): string {
  return outcomeInfo(o)?.label ?? (o ? o.replace(/_/g, ' ') : '—');
}

/** Whether an outcome needs more before it can be saved: a callback needs its time. */
export function outcomeReady(o: Outcome | null, callbackAt: string | null): boolean {
  if (!o) return false;
  if (o === 'callback') return !!callbackAt;
  return true;
}
