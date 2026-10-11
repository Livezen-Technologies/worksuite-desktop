// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanReplyHtml, linkReplyUrls, replacePickerToken, replyText } from '../../../src/modules/support/richReply';

describe('Helpdesk rich replies', () => {
  it('keeps formatting and inline images while stripping executable content and remote trackers', () => {
    const html = cleanReplyHtml('<p><strong>Hello</strong><code>x</code></p><img src="data:image/png;base64,AAAA" onerror="alert(1)"><img src="https://tracker.example/a"><script>alert(1)</script><a href="javascript:alert(1)">bad</a>');
    expect(html).toContain('<strong>Hello</strong>');
    expect(html).toContain('<code>x</code>');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toMatch(/onerror|javascript:|<script|tracker.example/);
  });
  it('links pasted URLs without relinking existing links or code', () => {
    const html = linkReplyUrls('<p>See https://example.com/docs.</p><code>https://code.example</code><a href="https://existing.example">https://existing.example</a>');
    const box = document.createElement('div'); box.innerHTML = html;
    expect(box.querySelectorAll('a')).toHaveLength(2);
    expect(box.querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs');
    expect(box.querySelector('code')?.querySelector('a')).toBeNull();
  });
  it('inserts a saved response without removing surrounding formatting', () => {
    const html = replacePickerToken('<p><strong>Dear customer</strong> /hello</p>', '/hello', 'Hello Sam');
    expect(html).toContain('<strong>Dear customer</strong>');
    expect(replyText(html)).toBe('Dear customer Hello Sam');
    expect(replyText('<img src="data:image/png;base64,AAAA">')).toBe('[Image]');
  });
});
