// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true }));

const { call } = await import('../../../src/core/bridge');
const { markdownPlain, parseInline, parseMarkdown } = await import('../../../src/core/markdown');
const { Markdown } = await import('../../../src/components/Markdown');
const { answerPreview } = await import('../../../src/modules/ai/session');

afterEach(cleanup);

/** The reply in the issue's screenshot, as the assistant wrote it. */
const REPLY = `
Here is your day with your **3 tasks** and *one* meeting:

* Finish the **Q3 report**
* Call *Nimal* about \`INV-204\`
  - ask about the PO
* Review [the brief](https://app.worksuite.lk/files/9)

1. First
2. Second`;

describe('AI answers in Markdown (worksuite-desktop#150)', () => {
  it('parses bold, italic, code, struck words and links, and leaves lone marks as they are', () => {
    expect(parseInline('a **b** *c* _d_ ~~e~~ `f`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'del', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'f' },
    ]);
    expect(parseInline('2 * 3 * 4 and snake_case_name')).toEqual([{ t: 'text', v: '2 * 3 * 4 and snake_case_name' }]);
    expect(parseInline('**bold with *italic* inside**')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'bold with ' }, { t: 'em', c: [{ t: 'text', v: 'italic' }] }, { t: 'text', v: ' inside' }] }]);
  });

  it('parses lists, nested items, numbered lists, headings, quotes, rules and code blocks', () => {
    const blocks = parseMarkdown('## Today\n\n- one\n  - one.a\n- two\n\n3. three\n4. four\n\n> quoted\n\n---\n\n```\nx < y\n```');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'list', 'list', 'quote', 'hr', 'code']);
    const [, bullets, numbered] = blocks as [unknown, { items: Array<{ sub: { items: unknown[] } | null }> }, { ordered: boolean; start: number }];
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0]!.sub?.items).toHaveLength(1);
    expect(numbered).toMatchObject({ ordered: true, start: 3 });
    expect(blocks[5]).toEqual({ t: 'code', v: 'x < y' });
  });

  it('draws the reply with no raw marks left, and no blank lines above it', () => {
    const { container } = render(<Markdown text={REPLY} />);
    expect(container.textContent).not.toMatch(/\*\*|\*[A-Za-z]|`/);
    expect(container.querySelector('strong')?.textContent).toBe('3 tasks');
    expect(container.querySelector('em')?.textContent).toBe('one');
    expect(container.querySelectorAll('ul > li')).toHaveLength(4);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('code')?.textContent).toBe('INV-204');
    // The leading newline is not a blank line: the first block is the first sentence.
    expect(container.firstElementChild?.firstElementChild?.textContent).toMatch(/^Here is your day/);
  });

  it('never turns an answer into markup: HTML stays text, and only web addresses are links', () => {
    const evil = '<img src=x onerror="alert(1)"> <script>alert(2)</script> [click](javascript:alert(3)) [data](data:text/html,hi) **<b>x</b>**';
    const { container } = render(<Markdown text={evil} />);
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain('click');
  });

  it('opens a link the way every other WorkSuite link opens, never in this window', () => {
    render(<Markdown text="See [the guide](https://example.com/guide) or https://example.org." />);
    const link = screen.getByText('the guide');
    expect(link.getAttribute('href')).toBe('https://example.com/guide');
    fireEvent.click(link);
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://example.com/guide' });
    expect(screen.getByText('https://example.org').tagName).toBe('A');
  });

  it("the launcher's preview shows the answer's words, not its marks", () => {
    expect(markdownPlain('**Done.** Two *tasks*:\n\n- one\n- two')).toBe('Done. Two tasks:\n• one\n• two');
    expect(answerPreview([{ role: 'assistant', text: '\n**Ready**: your *report*' }], false)).toBe('Ready: your report');
  });
});
