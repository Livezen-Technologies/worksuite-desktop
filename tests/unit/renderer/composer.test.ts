// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { typingLine } from '../../../src/modules/chat/typing';
import { frequentEmoji, noteEmojiUsed, searchEmoji } from '../../../src/modules/chat/emoji';

describe('the typing line above the composer', () => {
  it('names one, two, or two and how many more', () => {
    expect(typingLine([])).toBeNull();
    expect(typingLine(['Samali'])).toBe('Samali is typing…');
    expect(typingLine(['Samali', 'Chamudi'])).toBe('Samali and Chamudi are typing…');
    expect(typingLine(['Samali', 'Chamudi', 'Nimal'])).toBe('Samali, Chamudi and 1 other are typing…');
    expect(typingLine(['Samali', 'Chamudi', 'Nimal', 'Ruwan'])).toBe('Samali, Chamudi and 2 others are typing…');
  });
});

describe('the emoji picker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('finds emoji by the start of each word typed', () => {
    expect(searchEmoji('thumbs')).toEqual(['👍', '👎']);
    expect(searchEmoji('thumbs up')).toEqual(['👍']);
    expect(searchEmoji('HEART').includes('❤️')).toBe(true);
    expect(searchEmoji('zzzqq')).toEqual([]);
    expect(searchEmoji('  ').length).toBeGreaterThan(100);
  });

  it('puts what this person uses most first, and always offers sixteen', () => {
    expect(frequentEmoji()).toHaveLength(16);
    noteEmojiUsed('🚀');
    noteEmojiUsed('🚀');
    noteEmojiUsed('🧠');
    const f = frequentEmoji();
    expect(f.slice(0, 2)).toEqual(['🚀', '🧠']);
    expect(f).toHaveLength(16);
    expect(new Set(f).size).toBe(16);
  });

  it('still works when the stored counts are unreadable', () => {
    localStorage.setItem('ws.chat.emoji.used', '{not json');
    expect(frequentEmoji()).toHaveLength(16);
    noteEmojiUsed('✅');
    expect(frequentEmoji()[0]).toBe('✅');
  });
});
