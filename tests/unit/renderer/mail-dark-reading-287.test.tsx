// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
const bridge = vi.hoisted(() => ({ listeners: new Map<string, Set<(p: unknown) => void>>() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: (channel: string, cb: (p: unknown) => void) => {
    const set = bridge.listeners.get(channel) ?? new Set();
    set.add(cb);
    bridge.listeners.set(channel, set);
    return () => set.delete(cb);
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  hasDesktop: () => true,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { contrast, hexToOklch, hueDistance } from '@shared/color';
import { parseSafeLink } from '@shared/mail-files';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { AiWidget, launcherBottom, LAUNCHER_GAP } from '../../../src/app/overlays/AiWidget';
import { aiWidget, ui } from '../../../src/core/ui';
import { assistantSession } from '../../../src/modules/ai/session';
import {
  CARD_COLOURS,
  DARK_COLOURS,
  LIGHT_COLOURS,
  bodyKind,
  darkBackground,
  darkenCss,
  darkenHtml,
  darkeningRisk,
  decideLook,
  designedWidth,
  forceColourScheme,
  hasOwnDarkStyles,
  parseColour,
  readFrameColours,
  readableText,
  readingBody,
  withSenderTheme,
} from '../../../src/modules/mail/bodyLook';
import { MailLinkGuard } from '../../../src/modules/mail/LinkGuard';
import { MessageView } from '../../../src/modules/mail/MessageView';
import { ReadingPane, type OpenTab } from '../../../src/modules/mail/ReadingPane';
import { IMAGE_LINK, isLongSignature, linkParts, linkPictures, parsePictureLink, phoneHref, plainBodyText, renderPlainText, splitPlain, structureHtml } from '../../../src/modules/mail/readable';
import { mailFrameDoc, sanitizeMailHtml } from '../../../src/modules/mail/sanitize';
import type { MailPrefs, Mailbox, MessageRef } from '../../../src/modules/mail/types';
import { BACKGROUND_PICTURES, BANK_ALERT, DARK_AWARE, FORWARD_PLAIN, GMAIL_REPLY, NEWSLETTER, OUTLOOK_PLAIN_REPLY, OUTLOOK_REPLY, OUTLOOK_WEB_REPLY, PLAIN_REPLY, WORDPRESS_PLAIN } from './mail-287-fixtures';

/**
 * worksuite-desktop#287: emails in dark mode, decided per email (plain words in the app's colours, an email's own
 * dark styles, careful darkening, a soft light card when that would read badly), a per-sender switch and a setting;
 * a comfortable reading column with links in plain words, quoted text and long signatures folded; a one-line
 * breadcrumb, tidier tabs, and the floating AI button kept off Mail's action bar.
 */

/** The body as the reading pane would draw it, in one theme. */
function read(raw: string, appDark: boolean, extra: Partial<Parameters<typeof readingBody>[0]> = {}) {
  const clean = sanitizeMailHtml(raw);
  return readingBody({ raw, html: clean.html, styles: clean.styles, remoteImages: clean.remoteImages, plain: plainBodyText(clean.html), appDark, light: LIGHT_COLOURS, dark: DARK_COLOURS, ...extra });
}

/** The colour an element's inline style gives a property. */
function styleColour(html: string, selector: string, prop: 'color' | 'background' | 'background-color'): string {
  const el = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.querySelector(selector);
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(el?.getAttribute('style') ?? '');
  return (m?.[1] ?? '').trim();
}
const attr = (html: string, selector: string, name: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.querySelector(selector)?.getAttribute(name) ?? null;

afterEach(() => {
  cleanup();
  bridge.listeners.clear();
});

describe('which look each email gets, in both themes (#287)', () => {
  it('plain text takes the app’s colours in the dark theme — no white card — and stays light in the light theme', () => {
    const dark = read(WORDPRESS_PLAIN, true);
    expect(dark.kind).toBe('plain');
    expect(dark.look).toEqual({ scheme: 'dark', darken: false, fallback: false });
    expect(dark.frame.colours).toEqual(DARK_COLOURS);
    expect(dark.frame.outer).toBe(DARK_COLOURS.surface);
    const doc = mailFrameDoc(dark.html, 100, dark.frame);
    expect(doc).toContain(`background:${DARK_COLOURS.surface}`);
    expect(doc).toContain(`color:${DARK_COLOURS.ink}`);
    expect(doc).toContain(`a{color:${DARK_COLOURS.link}}`);
    expect(doc).toContain('<div class="ws-col ws-plain ws-read">');
    expect(doc).not.toMatch(/background:#fff(fff)?\b/i);

    const light = read(WORDPRESS_PLAIN, false);
    expect(light.look.scheme).toBe('light');
    expect(light.frame.colours).toEqual(LIGHT_COLOURS);
    expect(mailFrameDoc(light.html, 100, light.frame)).toContain('<div class="ws-col ws-plain ws-read">');
  });

  it('darkens a newsletter and a bank alert; a design laid over background pictures stays light on a soft card', () => {
    for (const raw of [NEWSLETTER, BANK_ALERT]) {
      const r = read(raw, true);
      expect(r.kind).toBe('designed');
      expect(r.look).toEqual({ scheme: 'dark', darken: true, fallback: false });
      expect(read(raw, false).look).toEqual({ scheme: 'light', darken: false, fallback: false });
    }
    expect(darkeningRisk(BACKGROUND_PICTURES)).toEqual({ risky: true, reasons: ['background-images'] });
    expect(darkeningRisk(NEWSLETTER).risky).toBe(false);
    const complex = read(BACKGROUND_PICTURES, true);
    expect(complex.look).toEqual({ scheme: 'light', darken: false, fallback: true });
    expect(complex.frame.colours).toEqual(CARD_COLOURS);
    const doc = mailFrameDoc(complex.html, 100, complex.frame);
    // Slightly off-white, rounded, set in from the pane — never a full white block.
    expect(doc).toContain('class="ws-col ws-designed ws-card"');
    expect(doc).toContain(`.ws-card{background:${CARD_COLOURS.surface};border-radius:12px`);
    expect(doc).toContain(`html,body{margin:0;padding:0;background:${DARK_COLOURS.surface}`);
    expect(CARD_COLOURS.surface).not.toBe('#ffffff');
  });

  it('uses an email’s own dark styles, switched on in its stylesheet whatever the computer says', () => {
    expect(hasOwnDarkStyles(DARK_AWARE)).toBe(true);
    expect(hasOwnDarkStyles('<meta name="color-scheme" content="light dark"><p>Hi</p>')).toBe(false);
    expect(hasOwnDarkStyles('<meta name="color-scheme" content="dark"><p>Hi</p>')).toBe(true);
    const r = read(DARK_AWARE, true);
    expect(r.kind).toBe('native');
    expect(r.look.scheme).toBe('native');
    expect(r.frame.css).toContain('@media (min-width:0px){.card{background:#1c1c1e');
    const doc = mailFrameDoc(r.html, 100, r.frame);
    expect(doc).toContain('<meta name="color-scheme" content="dark">');
    expect(doc).toContain('.card{background:#ffffff;color:#222222}');
    // View in light: the same stylesheet, its dark rules off.
    const light = read(DARK_AWARE, true, { sender: 'light' });
    expect(light.look.scheme).toBe('light');
    expect(light.frame.css).toContain('@media (max-width:0px){.card');
    expect(forceColourScheme('@media screen and (prefers-color-scheme: light){a{}}', 'light')).toBe('@media screen and (min-width:0px){a{}}');
    // Plain HTML never brings its <head> stylesheet.
    expect(read('<style>p{color:red}</style><p>Hi</p>', true).frame.css).toBe('');
  });

  it('lets the setting and a sender’s choice decide before the theme; Always dark darkens even a complex design', () => {
    const base = { kind: 'plain' as const, appDark: true };
    expect(decideLook({ ...base, setting: 'auto' }).scheme).toBe('dark');
    expect(decideLook({ ...base, setting: 'light' }).scheme).toBe('light');
    expect(decideLook({ ...base, appDark: false, setting: 'dark' }).scheme).toBe('dark');
    expect(decideLook({ ...base, setting: 'light', sender: 'dark' }).scheme).toBe('dark');
    expect(decideLook({ ...base, setting: 'dark', sender: 'light' }).scheme).toBe('light');
    expect(decideLook({ kind: 'designed', appDark: true, risky: true })).toEqual({ scheme: 'light', darken: false, fallback: true });
    expect(decideLook({ kind: 'designed', appDark: true, risky: true, setting: 'dark' })).toEqual({ scheme: 'dark', darken: true, fallback: false });
    expect(decideLook({ kind: 'designed', appDark: true, risky: true, sender: 'dark' })).toEqual({ scheme: 'dark', darken: true, fallback: false });
    expect(decideLook({ kind: 'simple', appDark: true })).toEqual({ scheme: 'dark', darken: false, fallback: false });
    expect(bodyKind({ raw: '<p>Hi</p>', html: '<p>Hi</p>', plain: false })).toBe('simple');
    expect(bodyKind({ raw: '<p style="color:#333">Hi</p>', html: '<p style="color:#333">Hi</p>', plain: false })).toBe('designed');
  });
});

describe('colours, light to dark', () => {
  const surface = DARK_COLOURS.surface;
  it('turns light backgrounds dark in their own hue and keeps brand colours and dark bands', () => {
    expect(darkBackground('#ffffff', surface)).toBe(surface);
    const grey = darkBackground('#eeeeee', surface);
    expect(hexToOklch(grey).l).toBeLessThan(0.35);
    // Lighter stays above darker, as it was.
    expect(hexToOklch(darkBackground('#cccccc', surface)).l).toBeGreaterThan(hexToOklch(grey).l);
    const paleBlue = darkBackground('#dbeafe', surface);
    expect(hexToOklch(paleBlue).l).toBeLessThan(0.4);
    for (const brand of ['#e8710a', '#1a73e8', '#0b3d91', '#c62828', '#15803d']) expect(darkBackground(brand, surface)).toBe(brand);
  });

  it('makes text read at 4.5:1 where it would not, keeps a coloured one’s hue, and leaves text that already reads', () => {
    for (const fg of ['#000000', '#333333', '#555555', '#1a0dab', '#c62828']) {
      const out = readableText(fg, surface, DARK_COLOURS.ink);
      expect(contrast(out, surface)).toBeGreaterThanOrEqual(4.5);
    }
    const red = readableText('#c62828', surface, DARK_COLOURS.ink);
    expect(hueDistance(hexToOklch(red).h, hexToOklch('#c62828').h)).toBeLessThan(12);
    expect(readableText('#ffffff', '#0b3d91', DARK_COLOURS.ink)).toBe('#ffffff');
    expect(readableText('#999999', surface, DARK_COLOURS.ink)).toBe('#999999');
    // On a light background kept as it was, text goes darker rather than lighter.
    expect(hexToOklch(readableText('#bbbbbb', '#f9ab00', DARK_COLOURS.ink)).l).toBeLessThan(hexToOklch('#bbbbbb').l);
  });

  it('reads the colours mail writes', () => {
    expect(parseColour('#FFF')).toEqual({ hex: '#ffffff', alpha: 1 });
    expect(parseColour('rgb(204, 204, 204)')).toEqual({ hex: '#cccccc', alpha: 1 });
    expect(parseColour('rgba(0,0,0,.5)')).toEqual({ hex: '#000000', alpha: 0.5 });
    expect(parseColour('WhiteSmoke')).toEqual({ hex: '#f5f5f5', alpha: 1 });
    expect(parseColour('#11223380')?.alpha).toBeCloseTo(0.5, 1);
    for (const no of ['transparent', 'currentColor', 'var(--x)', 'hsl(0 0% 100%)', 'url(x)']) expect(parseColour(no)).toBeNull();
  });

  it('darkens the newsletter element by element: the button and its white text kept, text lightened, the logo on a plate', () => {
    const clean = sanitizeMailHtml(NEWSLETTER);
    const html = darkenHtml(clean.html, { surface, ink: DARK_COLOURS.ink }, clean.remoteImages);
    expect(attr(html, 'table[width="600"]', 'bgcolor')).toBe(surface);
    expect(hexToOklch(attr(html, 'table[width="100%"]', 'bgcolor')!).l).toBeLessThan(0.35);
    expect(styleColour(html, 'a', 'background')).toBe('#e8710a');
    expect(styleColour(html, 'a', 'color')).toBe('#ffffff');
    expect(contrast(styleColour(html, 'h1', 'color'), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(styleColour(html, 'p', 'color'), surface)).toBeGreaterThanOrEqual(4.5);
    // The transparent PNG logo drawn for a white page gets its soft light plate — marked while it is still held back.
    expect(attr(html, 'img', 'data-ws-plate')).toBe('');
    expect(attr(html, 'img', 'data-ws-ph')).toBe('');
    expect(styleColour(html, 'table[width="600"]', 'background')).toBe('');
    expect(attr(html, 'table[width="600"]', 'style')).not.toContain('#dddddd');
  });

  it('darkens the bank alert: the red amount stays red and reads, the brand header and button stay, the white logo gets no plate', () => {
    const clean = sanitizeMailHtml(BANK_ALERT);
    const html = darkenHtml(clean.html, { surface, ink: DARK_COLOURS.ink }, clean.remoteImages);
    const amount = styleColour(html, 'b', 'color');
    expect(contrast(amount, surface)).toBeGreaterThanOrEqual(4.5);
    expect(hueDistance(hexToOklch(amount).h, hexToOklch('#c62828').h)).toBeLessThan(12);
    expect(styleColour(html, 'td[style*="0b3d91"]', 'background')).toBe('#0b3d91');
    expect(attr(html, 'td[style*="0b3d91"]', 'style')).not.toContain('color:');
    expect(styleColour(html, 'a', 'color')).toBe('#ffffff');
    expect(attr(html, 'img', 'data-ws-plate')).toBeNull();
  });

  it('maps a stylesheet’s colours too, and leaves what is not a colour', () => {
    const css = darkenCss('.box{background-color:#ffffff;color:#222;border-bottom:1px solid #e5e5e5}.btn{background:#1a73e8;color:white}.x{width:10px}', { surface, ink: DARK_COLOURS.ink });
    expect(css).toContain(`.box{background-color:${surface};`);
    expect(css).toContain('.btn{background:#1a73e8;color:#ffffff}');
    expect(css).toContain('.x{width:10px}');
    expect(css).not.toContain('#222;');
  });

  it('knows a newsletter’s own width, and that words flow', () => {
    expect(designedWidth(NEWSLETTER)).toBe(600);
    expect(designedWidth('<div style="max-width:640px;margin:auto">x</div>')).toBe(640);
    expect(designedWidth('<table width="100%"><tr><td>x</td></tr></table>')).toBeNull();
  });
});

describe('the frame', () => {
  it('reads words in a centred 720px column at 15px with paragraph gaps; a newsletter keeps its own width, centred', () => {
    const plain = read(WORDPRESS_PLAIN, true);
    const doc = mailFrameDoc(plain.html, 100, plain.frame);
    expect(doc).toContain('.ws-col{box-sizing:border-box;max-width:min(100%,720px);margin:0 auto');
    expect(doc).toContain('.ws-read{font-size:15px;line-height:1.6}');
    expect(doc).toContain('class="ws-col ws-plain ws-read"');
    expect(doc).toContain('.ws-plain>div,.ws-plain>blockquote,.ws-plain>details,.ws-q>div{margin:0 0 .9em}');
    const news = read(NEWSLETTER, true);
    expect(mailFrameDoc(news.html, 100, news.frame)).toContain('max-width:min(100%,632px)');
    const card = read(NEWSLETTER, true, { sender: 'light' });
    expect(mailFrameDoc(card.html, 100, card.frame)).toContain('max-width:min(100%,680px)');
  });

  it('reads the app’s tokens — the colour profile included — and lets nothing but a hex colour into the frame', () => {
    const style = document.createElement('style');
    style.textContent = "[data-theme='dark']{--ws-surface:#0d1117;--ws-ink:#f0f6fc;--ws-indigo:red;background:url(x)}";
    document.head.append(style);
    try {
      const c = readFrameColours('dark');
      expect(c.surface).toBe('#0d1117');
      expect(c.ink).toBe('#f0f6fc');
      expect(c.link).toBe(DARK_COLOURS.link);
      expect(document.querySelector('[data-theme="dark"]')).toBeNull();
    } finally {
      style.remove();
    }
    expect(readFrameColours('light')).toEqual(LIGHT_COLOURS);
  });

  it('keeps an email’s own stylesheet inside its style element, and the boolean callers as they were', () => {
    const doc = mailFrameDoc('<p>x</p>', 100, { scheme: 'native', colours: DARK_COLOURS, outer: DARK_COLOURS.surface, kind: 'native', css: 'a{}</style><script>alert(1)</script>' });
    expect(doc).not.toContain('</style><script>');
    expect(mailFrameDoc('<p>x</p>', 100, true)).toContain('background:#171E33');
    expect(mailFrameDoc('<p>x</p>', 100, false)).toContain('background:#fff');
  });
});

describe('links in plain words', () => {
  it('makes web addresses, email addresses and phone numbers links — and not dates, amounts, IPs or account numbers', () => {
    const parts = linkParts('Call 077 123 4567 or +94 11 234 5678, ref 0012345678901, on 2026-10-05, at 192.168.10.200, write a.b@c.lk, see www.x.com/a(b) and (https://y.lk/path).');
    expect(parts.filter((p) => p.kind !== 'text')).toEqual([
      { kind: 'phone', text: '077 123 4567', href: 'tel:+94771234567' },
      { kind: 'phone', text: '+94 11 234 5678', href: 'tel:+94112345678' },
      { kind: 'email', text: 'a.b@c.lk', href: 'mailto:a.b@c.lk' },
      { kind: 'url', text: 'www.x.com/a(b)', href: 'https://www.x.com/a(b)' },
      { kind: 'url', text: 'https://y.lk/path', href: 'https://y.lk/path' },
    ]);
    expect(phoneHref('112345678', 'Tel: ')).toBe('tel:+94112345678');
    expect(phoneHref('112345678')).toBeNull();
    expect(phoneHref('0771234567', 'Account no: ')).toBeNull();
    expect(phoneHref('1,234,567.00')).toBeNull();
  });

  it('turns the WordPress notice into paragraphs with safe links the window checks when clicked', () => {
    const html = renderPlainText(plainBodyText(sanitizeMailHtml(WORDPRESS_PLAIN).html)!);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = [...doc.querySelectorAll('a')].map((a) => parseSafeLink(a.getAttribute('href') ?? '')?.url);
    expect(links).toEqual(['https://shop.example.lk', 'https://wordpress.org/plugins/akismet/', 'https://wordpress.org/support/forums/', 'mailto:support@shop.example.lk', 'tel:+94771234567']);
    for (const a of doc.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    // Five paragraphs, parted by the blank lines; nl2br's "<br />\n" is one line break, not two.
    const paras = [...doc.querySelectorAll('.ws-plain > div')].map((d) => d.textContent);
    expect(paras).toHaveLength(5);
    expect(paras[1]).toBe('These plugins are now up to date:\n- Akismet Anti-spam (from version 5.3 to 5.3.1) : https://wordpress.org/plugins/akismet/');
    expect(renderPlainText('<script>alert(1)</script> & co')).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  });

  it('tells plain text from HTML with structure of its own', () => {
    expect(plainBodyText('Hello<br>World')).toBe('Hello\nWorld');
    expect(plainBodyText('<pre>Hello\n-- \nAsha</pre>')).toBe('Hello\n--\nAsha');
    expect(plainBodyText('<p>Hello</p>')).toBeNull();
    expect(plainBodyText('<div style="color:red">Hello</div>')).toBeNull();
    expect(plainBodyText(sanitizeMailHtml('See <a href="https://x.lk">https://x.lk</a>').html)).toBe('See https://x.lk');
    expect(plainBodyText(sanitizeMailHtml('See <a href="https://evil.example">https://x.lk</a>').html)).toBeNull();
  });
});

describe('quoted text and signatures', () => {
  it('folds a plain-text reply chain behind “⋯ Show quoted text”, with a short signature shown', () => {
    expect(splitPlain(PLAIN_REPLY)).toEqual({ body: ['Yes, Friday is fine.', '', 'See you there.'], signature: ['Asha'], quote: ['On Mon, 5 Oct 2026 at 10:02, Nimal <nimal@sfcl.example> wrote:', '> Can we meet on Friday?', '> I can come to your office.', '>', '> Nimal'] });
    const html = renderPlainText(PLAIN_REPLY);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fold = doc.querySelector('details.ws-quote')!;
    expect(fold.hasAttribute('open')).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('⋯ Show quoted textHide quoted text');
    expect(fold.querySelector('blockquote')!.textContent).toContain('Can we meet on Friday?');
    expect(doc.querySelector('.ws-sig-short')!.textContent).toContain('Asha');
    expect(doc.querySelector('details.ws-sig')).toBeNull();
  });

  it('folds Outlook’s plain reply at "-----Original Message-----", never a forwarded message, and fades a long signature', () => {
    expect(splitPlain(OUTLOOK_PLAIN_REPLY).quote[0]).toBe('-----Original Message-----');
    expect(renderPlainText(FORWARD_PLAIN)).not.toContain('ws-quote');
    const long = renderPlainText('Thanks.\n-- \nAsha Perera\nHead of Sales\nLivezen\nNo. 12, Flower Road\nColombo 07\n+94 77 123 4567');
    expect(long).toContain('<details class="ws-sig">');
    expect(isLongSignature(['a', 'b', 'c'])).toBe(false);
    expect(isLongSignature('x'.repeat(400))).toBe(true);
  });

  it('folds Gmail, Outlook and Outlook on the web reply chains in HTML, and a long Gmail signature', () => {
    const gmail = structureHtml(sanitizeMailHtml(GMAIL_REPLY).html);
    const g = new DOMParser().parseFromString(gmail, 'text/html');
    expect(g.querySelector('details.ws-quote .gmail_quote')).toBeTruthy();
    expect(g.querySelector('details.ws-sig .gmail_signature')).toBeTruthy();
    expect(g.body.firstElementChild!.textContent).toContain('Friday at 10 works for me');
    const outlook = new DOMParser().parseFromString(structureHtml(sanitizeMailHtml(OUTLOOK_REPLY).html), 'text/html');
    expect(outlook.querySelector('details.ws-quote')!.textContent).toContain('Can we meet on Friday?');
    expect(outlook.querySelector('details.ws-quote')!.textContent).not.toContain('Sounds good');
    const owa = new DOMParser().parseFromString(structureHtml(sanitizeMailHtml(OUTLOOK_WEB_REPLY).html), 'text/html');
    expect(owa.querySelector('details.ws-quote hr')).toBeTruthy();
    expect(owa.querySelector('details.ws-quote')!.textContent).toContain('Could you book the room?');
    // A quote with nothing above it is the message itself: it shows.
    expect(structureHtml('<blockquote type="cite">Everything</blockquote>')).not.toContain('ws-quote');
  });

  it('folds a reply in both themes and keeps the frame free of script', () => {
    for (const dark of [true, false]) {
      const r = read(GMAIL_REPLY, dark);
      const doc = mailFrameDoc(r.html, 100, r.frame);
      expect(doc).toContain('<details class="ws-quote">');
      expect(doc).not.toMatch(/<script|onclick|onerror/i);
    }
  });
});

describe('a sender’s choice and the setting', () => {
  it('keeps a choice that differs from what the email gets anyway, forgets one that matches, and keeps 500 at most', () => {
    expect(withSenderTheme(undefined, 'News@Shop.example', 'light', 'dark')).toEqual({ 'news@shop.example': 'light' });
    expect(withSenderTheme({ 'news@shop.example': 'light' }, 'news@shop.example', 'dark', 'dark')).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`s${i}@x.example`, 'light' as const]));
    const next = withSenderTheme(many, 'new@x.example', 'dark', 'light');
    expect(Object.keys(next)).toHaveLength(500);
    expect(next['s0@x.example']).toBeUndefined();
    expect(next['new@x.example']).toBe('dark');
  });
});

// ── the reading pane ───────────────────────────────────────────────────────────────────────────────────────

const ACCOUNT: Mailbox = { id: 2, email: 'me@livezen.example', display_name: 'Me', shared: false, unread: 0, in_unified: true, provider: 'imap', colour: 'indigo', auth_state: 'ok' };
const REF: MessageRef = { uid: '102', folder: 'inbox', mailbox: '2' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let message: Record<string, unknown>;

function Harness({ prefs: initial = {}, onPrefs, backLabel = 'All Accounts · Inbox' }: { prefs?: MailPrefs; onPrefs?: (p: Partial<MailPrefs>) => void; backLabel?: string }) {
  const [prefs, setPrefs] = useState<MailPrefs>(initial);
  return (
    <TabProvider tabId="t" route="/mail" active>
      <MessageView
        msgRef={REF}
        backLabel={backLabel}
        onBack={() => undefined}
        onReply={() => undefined}
        onGone={() => undefined}
        onPrev={null}
        onNext={null}
        prefs={prefs}
        onPrefs={(patch) => {
          onPrefs?.(patch);
          setPrefs((p) => ({ ...p, ...patch }));
        }}
        focus={false}
        onFocus={() => undefined}
        boxes={[ACCOUNT]}
        localStore={false}
        offline={false}
        account={ACCOUNT}
      />
    </TabProvider>
  );
}
const show = (props: Parameters<typeof Harness>[0] = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
const frame = () => document.querySelector('iframe[title="Message"]') as HTMLIFrameElement | null;

describe('the reading pane (#287)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
    message = { id: 102, message_id: '<n-1@shop.example>', from_name: 'Shop', from_email: 'News@Shop.example', subject: 'Spring sale', to: ['me@livezen.example'], cc: [], body_html: WORDPRESS_PLAIN, is_starred: false, is_read: true, attachments: [], created_at: '2026-10-05 09:00:00' };
    app.set({ resolvedTheme: 'dark', status: { network: 'ONLINE' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@livezen.example' } } as never, auth: { server: { origin: 'https://ws.example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path.endsWith('/context')) return { sender: null, security: { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' } };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages/102') return { data: message, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
  });
  afterEach(() => app.set({ resolvedTheme: 'light' }));

  it('shows plain text dark in the dark theme, and ☀ View in light remembers the sender', async () => {
    const onPrefs = vi.fn();
    show({ onPrefs });
    await waitFor(() => expect(frame()?.dataset.bodyScheme).toBe('dark'));
    expect(frame()!.dataset.bodyKind).toBe('plain');
    expect(frame()!.getAttribute('srcdoc')).toContain(`background:${DARK_COLOURS.surface}`);
    expect(frame()!.getAttribute('srcdoc')).toContain('tel%3A%2B94771234567');
    expect(frame()!.style.colorScheme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'View in light' }));
    expect(onPrefs).toHaveBeenCalledWith({ bodyThemeSenders: { 'news@shop.example': 'light' } });
    await waitFor(() => expect(frame()!.dataset.bodyScheme).toBe('light'));
    expect(frame()!.getAttribute('srcdoc')).toContain('<div class="ws-col ws-plain ws-read ws-card">');
    fireEvent.click(screen.getByRole('button', { name: 'View in dark' }));
    // Back to what the email gets anyway: the choice is forgotten.
    expect(onPrefs).toHaveBeenLastCalledWith({ bodyThemeSenders: {} });
    await waitFor(() => expect(frame()!.dataset.bodyScheme).toBe('dark'));
  });

  it('follows Show emails in dark mode and a sender kept light, and offers no switch in the light theme', async () => {
    show({ prefs: { bodyTheme: 'light' } });
    await waitFor(() => expect(frame()?.dataset.bodyScheme).toBe('light'));
    expect(screen.getByRole('button', { name: 'View in dark' })).toBeTruthy();
    cleanup();
    show({ prefs: { bodyThemeSenders: { 'news@shop.example': 'light' } } });
    await waitFor(() => expect(frame()?.dataset.bodyScheme).toBe('light'));
    cleanup();
    app.set({ resolvedTheme: 'light' });
    show();
    await waitFor(() => expect(frame()?.dataset.bodyScheme).toBe('light'));
    expect(screen.queryByRole('button', { name: 'View in dark' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View in light' })).toBeNull();
  });

  it('keeps the breadcrumb on one line, cut short with an ellipsis, with the whole name as its tooltip', async () => {
    show({ backLabel: 'All Accounts · Inbox' });
    const back = await screen.findByRole('button', { name: 'Back to All Accounts · Inbox' });
    expect(back.className).toContain('whitespace-nowrap');
    expect(back.className).toContain('max-w-[260px]');
    expect(back.getAttribute('title')).toBe('Back to All Accounts · Inbox (Esc)');
    expect(back.dataset.breadcrumb).toBe('label');
    const label = back.querySelector('span')!;
    expect(label.className).toContain('truncate');
    expect(label.textContent).toBe('All Accounts · Inbox');
  });

  it('marks the action bar so the floating AI button stands above it', async () => {
    show();
    const bar = await screen.findByRole('toolbar', { name: 'Reply and actions' });
    expect(bar.hasAttribute('data-ai-launcher-lift')).toBe(true);
  });

  it('opens a picture of the body in the image viewer when the frame hands its link back', async () => {
    message = { ...message, body_html: `<p>The site plan:</p><img src="${PNG}" width="320" height="200" alt="Site plan">` };
    show();
    await waitFor(() => expect(frame()?.getAttribute('srcdoc')).toContain('ws-img'));
    const doc = new DOMParser().parseFromString(frame()!.getAttribute('srcdoc')!, 'text/html');
    const link = parseSafeLink(doc.querySelector('a.ws-img')!.getAttribute('href')!)!;
    expect(link.url.startsWith(IMAGE_LINK)).toBe(true);
    // Another reader's picture does nothing here.
    act(() => bridge.listeners.get('mail:link')!.forEach((cb) => cb({ url: `${IMAGE_LINK}otherframe1/0`, text: '' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => bridge.listeners.get('mail:link')!.forEach((cb) => cb(link)));
    const viewer = await screen.findByRole('dialog', { name: 'Site plan' });
    expect(within(viewer).getByRole('img', { name: 'Site plan' }).getAttribute('src')).toBe(PNG);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Site plan' })).toBeNull();
  });
});

describe('pictures as links to the viewer', () => {
  it('links shown pictures, never placeholders, icons, pictures already in a link or ones the viewer may not show', () => {
    const origin = 'https://ws.example.test';
    const html = `<img src="${PNG}" width="300" alt="a"><img src="${PNG}" width="16" height="16"><a href="#"><img src="${PNG}"></a><img src="data:image/svg+xml;base64,PHN2Zz4=" width="300"><img src="${origin}/mail-image?u=1&s=2" alt="b"><img data-ws-ph="" src="${PNG}" width="300">`;
    const out = linkPictures(html, 'frame12345', origin);
    expect(out.pictures).toEqual([
      { src: PNG, alt: 'a' },
      { src: `${origin}/mail-image?u=1&s=2`, alt: 'b' },
    ]);
    expect(out.html.match(/class="ws-img"/g)).toHaveLength(2);
    expect(parsePictureLink(`${IMAGE_LINK}frame12345/1`)).toEqual({ frame: 'frame12345', index: 1 });
    expect(parsePictureLink('https://x.example/1')).toBeNull();
  });
});

describe('the message tabs (#287)', () => {
  const tabs: OpenTab[] = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, ref: { uid: String(i), folder: 'inbox', mailbox: '1' }, subject: `Subject ${i}`, from: `Sender ${i}` }));
  it('limits each tab’s width, shows Close on the open one and on hover, and +N lists every open message', async () => {
    const onActivate = vi.fn();
    render(
      <ReadingPane tabs={tabs} activeKey="k1" onActivate={onActivate} onClose={() => undefined} empty={null}>
        <p>body</p>
      </ReadingPane>,
    );
    const strip = screen.getByRole('tablist', { name: 'Open messages' });
    const shown = within(strip).getAllByRole('tab');
    expect(shown).toHaveLength(4);
    expect(shown[0]!.className).toContain('max-w-[200px]');
    const closeOf = (tab: HTMLElement) => tab.querySelector('[data-tab-close]')!;
    expect(closeOf(shown[1]!).className).toContain('opacity-100');
    expect(closeOf(shown[0]!).className).toContain('opacity-0');
    expect(closeOf(shown[0]!).className).toContain('group-hover:opacity-100');
    fireEvent.click(within(strip).getByRole('button', { name: '2 more open messages' }));
    const menu = await screen.findByRole('menu', { name: 'Open messages' });
    expect(within(menu).getAllByRole('menuitemcheckbox').length + within(menu).queryAllByRole('menuitem').length).toBe(6);
    fireEvent.click(within(menu).getByText('Subject 5'));
    expect(onActivate).toHaveBeenCalledWith(tabs[5]);
  });
});

// ── the floating AI button ─────────────────────────────────────────────────────────────────────────────────

describe('the floating AI button never covers Mail’s action bar (#287)', () => {
  const ws = { left: 0, top: 0, right: 1200, bottom: 800 };
  it('stands 8px above a bar under its corner, and stays put for a bar elsewhere or none', () => {
    expect(launcherBottom(ws, [])).toBe(LAUNCHER_GAP);
    expect(launcherBottom(ws, [{ left: 500, top: 746, right: 1200, bottom: 800 }])).toBe(62);
    expect(launcherBottom(ws, [{ left: 0, top: 746, right: 600, bottom: 800 }])).toBe(LAUNCHER_GAP);
    expect(launcherBottom(ws, [{ left: 500, top: 100, right: 1200, bottom: 154 }])).toBe(LAUNCHER_GAP);
    // The floating action bar, a pill near the middle: clear of the corner unless it reaches it.
    expect(launcherBottom(ws, [{ left: 400, top: 740, right: 800, bottom: 788 }])).toBe(LAUNCHER_GAP);
    expect(launcherBottom(ws, [{ left: 900, top: 740, right: 1160, bottom: 788 }])).toBe(68);
    expect(launcherBottom(ws, [{ left: 0, top: 0, right: 0, bottom: 0 }])).toBe(LAUNCHER_GAP);
  });

  it('rises above the reading pane’s bar on screen, and back down when it goes', async () => {
    const rect = (r: { left: number; top: number; right: number; bottom: number }) => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;
    const workspace = document.createElement('div');
    workspace.setAttribute('data-ai-workspace', '');
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(rect(ws));
    const bar = document.createElement('div');
    bar.setAttribute('data-ai-launcher-lift', '');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect({ left: 480, top: 746, right: 1200, bottom: 800 }));
    vi.spyOn(bar, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    const host = document.createElement('div');
    workspace.append(bar, host);
    document.body.append(workspace);
    assistantSession.reset();
    aiWidget.set({ open: false, maximized: false });
    ui.set({ dock: null });
    app.set({ prefs: { ai: { display: 'widget' } } as never });
    try {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AiWidget />
        </QueryClientProvider>,
        { container: host },
      );
      const bubble = await screen.findByTestId('ai-bubble');
      const corner = bubble.closest('[data-launcher-bottom]') as HTMLElement;
      expect(corner.dataset.launcherBottom).toBe('62');
      expect(corner.style.bottom).toBe('62px');
      await act(async () => {
        bar.remove();
        await new Promise((r) => setTimeout(r, 40));
      });
      await waitFor(() => expect(corner.dataset.launcherBottom).toBe(String(LAUNCHER_GAP)));
      expect(corner.style.bottom).toBe('');
    } finally {
      workspace.remove();
    }
  });
});

// ── links clicked in a message ─────────────────────────────────────────────────────────────────────────────

describe('a phone number clicked in a message (#287)', () => {
  beforeEach(() => {
    vi.mocked(call).mockReset().mockResolvedValue(null as never);
    nav.navigate.mockReset();
  });
  it('offers WhatsApp and a call instead of dialling at once; a picture link is left to its reader', async () => {
    app.set({ apps: [{ id: 'whatsapp' }] as never, status: { network: 'ONLINE' } as never });
    render(<MailLinkGuard />);
    const fire = (url: string) => act(() => bridge.listeners.get('mail:link')!.forEach((cb) => cb({ url, text: '' })));
    fire(`${IMAGE_LINK}frame12345/0`);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(call).not.toHaveBeenCalled();
    fire('tel:+94771234567');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '+94 77 123 4567' })).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith('app:openExternal', expect.anything());
    fireEvent.click(within(dialog).getByRole('menuitem', { name: 'Open the WhatsApp conversation' }));
    expect(nav.navigate).toHaveBeenCalledWith('/chat?channel=whatsapp&to=94771234567');
    fire('tel:+94771234567');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('menuitem', { name: 'Call' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'tel:+94771234567' });
  });
});

describe('sanitising is as strict as before (#287)', () => {
  it('keeps the head stylesheet apart and cleaned, drops the sender’s own reader markers, and never lets script in', () => {
    const r = sanitizeMailHtml('<html><head><style>@import url(https://x.example/a.css); .a{background:url(https://t.example/p.gif)} .b{background:image-set("https://t.example/q.png" 1x)}</style></head><body><p class="a" data-ws-plate data-ws-slot style="background-image:-webkit-image-set(\'https://t.example/r.png\' 1x)">Hi</p><script>alert(1)</script></body></html>');
    expect(r.styles).not.toContain('@import');
    expect(r.styles).not.toContain('t.example');
    expect(r.html).not.toContain('<style');
    expect(r.html).not.toContain('data-ws-plate');
    expect(r.html).not.toContain('data-ws-slot');
    expect(r.html).not.toContain('t.example');
    expect(r.html).not.toContain('<script');
    // The reader's folds and links are its own markup round the cleaned body: no handlers, no scripts.
    const out = read('<p>Hi</p><img src=x onerror=alert(1)><div class="gmail_quote">On Mon, A wrote:<blockquote>old</blockquote></div>', true);
    expect(mailFrameDoc(out.html, 100, out.frame)).not.toMatch(/onerror|<script/i);
  });
});
