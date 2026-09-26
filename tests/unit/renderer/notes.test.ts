// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { diffWords, saveBody, showBody, TEMPLATES } from '../../../src/modules/notes/api';
import { placeOf, placeOptions } from '../../../src/modules/notes/Dialogs';

describe('comparing a version with the note now', () => {
  it('marks the words taken out and put in, and keeps the rest', () => {
    const d = diffWords('Bay board uses red for waiting parts', 'Bay board uses amber for waiting parts');
    expect(d?.filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(['red']);
    expect(d?.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['amber']);
    expect(d?.map((p) => p.text).join('')).toContain('Bay board uses');
  });

  it('handles an empty side, and declines texts too long to compare quickly', () => {
    expect(diffWords('', 'new words')).toEqual([{ text: 'new words', kind: 'added' }]);
    expect(diffWords('old words', '')).toEqual([{ text: 'old words', kind: 'removed' }]);
    expect(diffWords('a '.repeat(1000), 'b '.repeat(1000))).toBeNull();
  });
});

describe('filing a note', () => {
  const notebooks = [{ id: 1, name: 'Livezen', color: '#23349E', icon: null, type: 'team', count: 2 }];
  const sections = [{ id: 7, notebook_id: 1, name: 'Meetings', color: null, count: 1 }];

  it('offers each notebook and each of its sections', () => {
    expect(placeOptions(notebooks, sections)).toEqual([
      { value: '', label: 'No notebook' },
      { value: 'n1', label: 'Livezen' },
      { value: 's7', label: 'Livezen › Meetings' },
    ]);
  });

  it('files into a section with its notebook', () => {
    expect(placeOf('s7', sections)).toEqual({ notebook_id: 1, section_id: 7 });
    expect(placeOf('n1', sections)).toEqual({ notebook_id: 1, section_id: null });
    expect(placeOf('', sections)).toEqual({ notebook_id: null, section_id: null });
  });
});

describe('a note body', () => {
  it('keeps a picture as its file id to save, and shows it from the note', () => {
    const html = '<p>Board</p><img data-file-id="42" alt="board" src="blob:app://bundle/x">';
    expect(saveBody(html)).toBe('<p>Board</p><img alt="board" data-file-id="42">');
    expect(showBody(html, 5)).toContain('src="app://bundle/__api/api/notes/5/images/42"');
  });

  it('keeps to-dos, headings and tables, and only safe styles', () => {
    const html = '<h1>Plan</h1><ul><li>☑ Done</li><li>☐ Next</li></ul><table><tr><td colspan="2" style="text-align: center; background: url(https://x.test/a.png); position: fixed">Cell</td></tr></table><p style="color: red; behavior: url(x)">Red</p>';
    const out = saveBody(html);
    expect(out).toContain('<h1>Plan</h1>');
    expect(out).toContain('<li>☑ Done</li><li>☐ Next</li>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('style="text-align: center"');
    expect(out).not.toMatch(/url\(|position|behavior/);
    expect(out).toContain('<p style="color: red">Red</p>');
  });

  it('drops what could run, or reach outside', () => {
    const out = saveBody('<p>Hi</p><script>x()</script><iframe src="https://evil.test"></iframe><img src="https://evil.test/p.png"><a href="javascript:x()">bad</a><a href="tel:+94112345678">call</a><input type="checkbox">');
    expect(out).toBe('<p>Hi</p><a>bad</a><a href="tel:+94112345678" target="_blank" rel="noopener noreferrer">call</a>');
  });

  it('offers the six templates, each with a title', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['Blank note', 'Meeting notes', 'Project documentation', 'Standard operating procedure', 'Daily journal', 'To-do list']);
    expect(TEMPLATES.every((t) => t.title)).toBe(true);
    expect(saveBody(TEMPLATES.find((t) => t.key === 'todo')!.body)).toContain('☐');
  });
});

describe('the text a comparison reads', () => {
  it('keeps a line per paragraph, heading and list item, so words do not run together', async () => {
    const { readableText } = await import('../../../src/core/rich');
    expect(readableText('<h2>Agenda</h2><ul><li>One</li><li>☐ Two</li></ul><p>Done<br>now</p>')).toBe('Agenda\nOne\n☐ Two\nDone\nnow');
  });
});
