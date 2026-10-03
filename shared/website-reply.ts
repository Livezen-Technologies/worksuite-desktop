import type { MutationInput } from './ipc/contract';

/** What the outbox calls a reply to a website visitor; the thread shows pending replies without it. */
export const WEBSITE_REPLY_LABEL = 'Reply to a website visitor: ';

/** The longest reply the server takes (GATE-06). */
export const WEBSITE_REPLY_MAX = 4000;

/**
 * A reply to a website visitor, as the outbox sends it (RDC-07): pending while offline, sent once on reconnecting.
 * The thread's composer and a notification's inline reply (RDC-15) both send exactly this, so a reply from a banner
 * goes the same way as one typed in the conversation.
 */
export function websiteReplyMutation(conversationId: number, words: string, replyTo: number | null = null): MutationInput {
  return {
    module: 'website-chat',
    entity: 'reply',
    entityId: String(conversationId),
    label: `${WEBSITE_REPLY_LABEL}${words.slice(0, 160)}`,
    method: 'POST',
    path: `/api/chat/widget-admin/conversations/${conversationId}/reply`,
    // Answering one visitor message: the quote shows above the reply for both sides (RDC-10).
    body: { message: words.slice(0, WEBSITE_REPLY_MAX), ...(replyTo ? { reply_to: replyTo } : {}) },
    queueIfOffline: true,
  };
}

/** The composer's draft for a website conversation: a refused inline reply is kept there to send again. */
export const websiteDraftKey = (conversationId: number): { module: string; context: string } => ({ module: 'website-chat', context: `conversation:${conversationId}` });
