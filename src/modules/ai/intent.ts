import { isHowTo, type Guide } from './help/guides';

export type AskIntent = 'guidance' | 'action' | 'data' | 'general';
/** Classify the current message, without letting an earlier guide decide its intent. */
export function requestIntent(text: string): AskIntent {
  if (isHowTo(text)) return 'guidance';
  if (/^\s*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:create|make|send|add|schedule|book|share|delete|remove|update|change|set|assign|approve|reject|pay|cancel)\b/i.test(text)) return 'action';
  if (/\b(sales|revenue|invoices?|orders?|payments?|customers?|stock|balance|total|overdue|unread)\b/i.test(text) && /\b(show|know|tell|list|what|which|how much|how many|today|yesterday|total|report)\b/i.test(text)) return 'data';
  return 'general';
}
/** Only today's unfiltered sales total is supported by the deterministic reporting route. */
export function isTodaySales(text: string): boolean {
  if (requestIntent(text) !== 'data') return false;
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/[?.!]/g, '').trim();
  return /^(?:(?:can|could|may) i (?:know|see|get)|(?:can|could|would) you (?:show|tell|give) me|(?:please )?(?:show|tell|give)(?: me)?|what (?:is|are)|how much (?:are|were))?\s*(?:the )?(?:today'?s? (?:total |overall )?sales|(?:total |overall )?sales (?:for )?today)(?: total)?(?: please)?$/.test(t);
}
/** A guide carries forward only for a short, referential follow-up to the immediately preceding guide. */
export function guideFollowUp(text: string, guide: Guide | null | undefined): boolean {
  if (!guide || ['data', 'action'].includes(requestIntent(text))) return false;
  return /^(?:and\b|what (?:about|next)\b|then\b|why\b|which\b|can you explain\b)/i.test(text.trim()) && !/\b(sales|revenue|invoices?|payments?|customers?|today|yesterday)\b/i.test(text);
}
export function intentContext(text: string): string {
  const intent = requestIntent(text);
  return `Answer the latest request first. Earlier messages are context only; a change of topic replaces earlier instructions. Current intent: ${intent}. ${intent === 'data' ? 'Read authorized business data through available functions. Never invent a total or substitute a how-to guide. State any missing access or unsupported reporting scope.' : intent === 'action' ? 'This is a request to prepare an action, not a request for a guide. Use authorized action functions and require confirmation; if unavailable, explain that limitation.' : intent === 'guidance' ? 'Explain the requested steps; do not execute actions.' : ''}`;
}
