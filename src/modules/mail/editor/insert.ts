/**
 * Things put into a message from the Insert menu (worksuite-desktop#188),
 * as email-safe HTML: inline styles only, and nothing a mail client would
 * strip (no classes, no scripts, buttons as styled links).
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const HR_HTML = '<hr style="border: none; border-top: 1px solid #cccccc; margin: 12px 0"><div><br></div>';

export function quoteHtml(inner = '<br>'): string {
  return `<blockquote style="margin: 0 0 0 0.8ex; border-left: 3px solid #cccccc; padding-left: 1ex; color: #555555">${inner}</blockquote><div><br></div>`;
}

export function codeBlockHtml(text = ''): string {
  return `<pre style="font-family: Consolas, Menlo, Courier New, monospace; font-size: 13px; background-color: #f6f8fa; border: 1px solid #e1e4e8; padding: 8px 10px; white-space: pre-wrap">${text ? esc(text) : '<br>'}</pre><div><br></div>`;
}

export function inlineCodeHtml(text: string): string {
  return `<code style="font-family: Consolas, Menlo, Courier New, monospace; font-size: 13px; background-color: #f6f8fa; padding: 1px 4px">${esc(text || 'code')}</code>&nbsp;`;
}

export function dateTimeHtml(when: Date, kind: 'date' | 'time' | 'both', locale?: string): string {
  const date = when.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return esc(kind === 'date' ? date : kind === 'time' ? time : `${date}, ${time}`);
}

/**
 * A button that works in every mail client: a link styled as a button, with
 * a table around it so Outlook (which ignores padding on links) still shows
 * a coloured block.
 */
export function buttonHtml(label: string, href: string, colour = '#1a56db'): string {
  const c = /^#[0-9a-f]{3,6}$/i.test(colour) ? colour : '#1a56db';
  return `<table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse"><tbody><tr><td bgcolor="${c}" style="background-color: ${c}; padding: 10px 18px; text-align: center"><a href="${esc(href)}" style="color: #ffffff; font-weight: bold; text-decoration: none">${esc(label)}</a></td></tr></tbody></table><div><br></div>`;
}

export function meetingLinkHtml(url: string, title: string, intro: string): string {
  return `<p>${esc(intro)} <a href="${esc(url)}">${esc(title || url)}</a></p>`;
}

/** Mail merge's fields, as MailMerge fills them. */
export const MERGE_FIELDS = ['first_name', 'name', 'email', 'company'] as const;

export function mergeFieldHtml(field: string): string {
  return `{{${field.replace(/[^a-z0-9_]/gi, '')}}}`;
}

/** Characters people look for and cannot type. */
export const SPECIAL_CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['©', 'Copyright'], ['®', 'Registered'], ['™', 'Trade mark'], ['°', 'Degree'], ['±', 'Plus or minus'], ['×', 'Multiply'], ['÷', 'Divide'],
  ['€', 'Euro'], ['£', 'Pound'], ['¥', 'Yen'], ['₹', 'Rupee'], ['රු', 'Sri Lankan rupee'], ['§', 'Section'], ['¶', 'Paragraph'],
  ['•', 'Bullet'], ['…', 'Ellipsis'], ['–', 'En dash'], ['—', 'Em dash'], ['“', 'Left quote'], ['”', 'Right quote'],
  ['←', 'Left arrow'], ['→', 'Right arrow'], ['↑', 'Up arrow'], ['↓', 'Down arrow'], ['✓', 'Check mark'], ['✗', 'Cross'],
  ['½', 'One half'], ['¼', 'One quarter'], ['¾', 'Three quarters'], ['µ', 'Micro'], ['Ω', 'Ohm'], ['≈', 'Approximately'], ['≠', 'Not equal'], ['≤', 'Less or equal'], ['≥', 'Greater or equal'],
];

/** A to-do line: a box to tick, as characters every mail client shows. */
export const CHECK_OFF = '☐';
export const CHECK_ON = '☑';
export function checklistHtml(lines: string[]): string {
  const items = (lines.length ? lines : ['']).map((l) => `<li>${CHECK_OFF} ${l ? esc(l) : '<br>'}</li>`).join('');
  return `<ul style="list-style-type: none; padding-left: 4px; margin-left: 0">${items}</ul>`;
}

/** The fonts offered: ones every computer and mail client has. */
export const FONTS: ReadonlyArray<readonly [string, string]> = [
  ['', 'Default'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Calibri, Carlito, Arial, sans-serif', 'Calibri'],
  ['Georgia, Times New Roman, serif', 'Georgia'],
  ['Tahoma, Verdana, sans-serif', 'Tahoma'],
  ['Times New Roman, Times, serif', 'Times New Roman'],
  ['Trebuchet MS, Arial, sans-serif', 'Trebuchet MS'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['Courier New, Courier, monospace', 'Courier New'],
];

export const SIZES: ReadonlyArray<readonly [string, string]> = [
  ['12px', 'Small'],
  ['', 'Normal'],
  ['18px', 'Large'],
  ['24px', 'Huge'],
];

export const LINE_SPACINGS = ['1', '1.15', '1.5', '2'] as const;
