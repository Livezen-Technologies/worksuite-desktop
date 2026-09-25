/**
 * @mentions in the composer. The server searches who can be mentioned
 * (`rooms/{id}/mentionable`); the composer only needs to know which word, if
 * any, the caret is in.
 */

/** The word being typed after an "@", if the caret is in one. */
export function mentionQuery(text: string, caret: number): { start: number; word: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, word: m[2]! } : null;
}
