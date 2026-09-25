import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { createMeeting, openMeeting } from './api';

/**
 * "Meet" in a conversation's header: a meeting for the people in it, now.
 * The server posts the invitation card into the conversation and tells its
 * members; the meeting opens here in its own window.
 */
export async function startMeetingFromChat(roomId: string | number, name?: string): Promise<void> {
  try {
    const m = await createMeeting({ roomId, title: name ? `Meeting · ${name}` : undefined });
    await openMeeting(m.uuid, m.title);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}
