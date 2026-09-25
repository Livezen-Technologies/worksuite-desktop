// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml, parseAddresses, textToHtml } from '@/modules/mail/sanitize';
import { accelerator, commandForAccelerator, conflicts, effectiveShortcuts } from '@/core/commands';
import { addDays, listStamp, parseTs, setRegional, wallMinutes, wallTimeLabel } from '@/core/time';

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
});
