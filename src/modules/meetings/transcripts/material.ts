import { apiGet } from '../../../core/api';
import { transcriptText, type Transcript } from './api';

/**
 * The meeting's latest finished transcript as text, for drafting the minutes (worksuite-desktop#80, #81); empty when
 * there is none, or it may not be seen. Long ones are cut from the middle, keeping the start and the end.
 */
export async function latestTranscriptText(meetingId: number, max = 12_000): Promise<string> {
  try {
    const list = await apiGet<{ transcripts: Transcript[] }>(`/api/meetings/${meetingId}/transcripts`);
    const t = list.transcripts.find((x) => x.status === 'ready' && x.segments_count > 0);
    if (!t) return '';
    const full = await apiGet<Transcript>(`/api/meetings/transcripts/${t.id}`);
    const text = transcriptText(full.segments ?? []);
    return text.length <= max ? text : `${text.slice(0, max / 2)}\n…\n${text.slice(-max / 2)}`;
  } catch {
    return '';
  }
}
