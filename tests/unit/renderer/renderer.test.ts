// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml, parseAddresses, textToHtml } from '@/modules/mail/sanitize';
import { accelerator, commandForAccelerator, conflicts, effectiveShortcuts } from '@/core/commands';
import { addDays, conversationStamp, listStamp, parseTs, setRegional, wallMinutes, wallTimeLabel } from '@/core/time';

describe('mail sanitising', () => {
  it('removes scripts, handlers and javascript: links; forces links out; blocks remote images', () => {
    const r = sanitizeMailHtml(`<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="x"></iframe>
      <a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a>
      <img src="https://tracker.example/pixel.gif"><img src="data:image/png;base64,AAAA"><form action="https://x"><input></form>`);
    expect(r.html).not.toMatch(/script|onclick|iframe|javascript:|<form|<input/i);
    expect(r.html).toContain('target="_blank"');
    expect(r.html).not.toContain('tracker.example');
    expect(r.html).toContain('data:image/png');
    expect(r.blockedImages).toBe(1);
  });
  it('escapes composed text and splits recipients', () => {
    expect(textToHtml('<b>hi</b>\nthere')).toBe('&lt;b&gt;hi&lt;/b&gt;<br>there');
    expect(parseAddresses('a@b.c, d@e.f;\n g@h.i')).toEqual(['a@b.c', 'd@e.f', 'g@h.i']);
  });
});

describe('shortcut registry (FR-SRCH-04)', () => {
  it('normalises Cmd on macOS and Ctrl elsewhere', () => {
    const e = { key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
    expect(accelerator(e, true)).toBe('Mod+K');
    expect(accelerator({ ...e, metaKey: false, ctrlKey: true }, false)).toBe('Mod+K');
    expect(accelerator({ key: '!', code: 'Digit1', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, false)).toBe('Mod+Shift+1');
  });
  it('detects conflicts after remapping', () => {
    const map = effectiveShortcuts({ lock: 'Mod+K' });
    expect(conflicts(map)).toEqual([{ accelerator: 'Mod+K', commands: ['search', 'lock'] }]);
    expect(commandForAccelerator(map, 'Mod+K')).toBe('search');
  });
});

describe('WorkSuite time', () => {
  it('reads naive stamps as UTC and keeps calendar wall-clock digits as written', () => {
    setRegional({ timezone: 'Asia/Colombo', timeFormat: '24' });
    expect(parseTs('2026-09-25 10:00:00').toISOString()).toBe('2026-09-25T10:00:00.000Z');
    expect(wallTimeLabel('2026-09-25 09:00:00')).toMatch(/09:00|9:00/);
    expect(wallMinutes('2026-09-25 16:30:00')).toBe(990);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(listStamp(null)).toBe('');
  });

  // worksuite-desktop#155: a conversation list's stamp, on the reader's calendar (Colombo, UTC+5:30).
  it('stamps a conversation with the time today, Yesterday, the weekday within a week, the date before', () => {
    setRegional({ timezone: 'Asia/Colombo', timeFormat: '24', locale: 'en-GB' });
    // Saturday 3 October 2026, 12:00 in Colombo.
    const now = new Date('2026-10-03T06:30:00Z');
    expect(conversationStamp('2026-10-03 03:15:00', now)).toMatch(/^0?8:45$/);
    // Just after midnight in Colombo is still today, though it is the day before in UTC.
    expect(conversationStamp('2026-10-02 18:40:00', now)).toMatch(/^0?0:10$/);
    expect(conversationStamp('2026-10-02 10:00:00', now)).toBe('Yesterday');
    expect(conversationStamp('2026-09-30 10:00:00', now)).toBe('Wed');
    expect(conversationStamp('2026-09-27 10:00:00', now)).toBe('Sun');
    // A week ago and older: the date, so a weekday never means two days.
    expect(conversationStamp('2026-09-26 10:00:00', now)).toMatch(/^26 Sept?$/);
    expect(conversationStamp('2026-08-14 10:00:00', now)).toBe('14 Aug');
    expect(conversationStamp(null, now)).toBe('');
    expect(conversationStamp('not a date', now)).toBe('');
    setRegional({});
  });
});
