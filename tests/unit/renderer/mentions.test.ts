import { describe, expect, it } from 'vitest';
import { mentionQuery } from '../../../src/modules/chat/mentions';

/** The composer offers people to mention only while the caret is in an @word. */
describe('mentionQuery', () => {
  it('finds the word after an @ at the caret', () => {
    expect(mentionQuery('Thanks @Nu', 10)).toEqual({ start: 7, word: 'Nu' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, word: '' });
  });

  it('ignores an @ inside a word, like an email address', () => {
    expect(mentionQuery('mail ada@example', 16)).toBeNull();
  });

  it('stops offering once the word is finished or the caret is elsewhere', () => {
    expect(mentionQuery('Thanks @Nuwan ', 14)).toBeNull();
    expect(mentionQuery('Thanks @Nu and more', 19)).toBeNull();
    expect(mentionQuery('Thanks @Nu and more', 10)).toEqual({ start: 7, word: 'Nu' });
  });
});
