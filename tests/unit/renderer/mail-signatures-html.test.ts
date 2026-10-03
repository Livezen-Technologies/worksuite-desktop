// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { chooseSignature, composeBody } from '../../../src/modules/mail/composeHtml';
import { darkModeRisk } from '../../../src/modules/mail/editor/images';
import { cleanSignatureHtml, emailSafe, fieldsUsed, fillSignature, socialHref, socialIconHtml, valuesFor, withEmbedded } from '../../../src/modules/mail/signatures/signatureHtml';
import { SIGNATURE_TEMPLATES, renderTemplate } from '../../../src/modules/mail/signatures/templates';

/**
 * Mail signatures (worksuite-desktop#166): the fields filled at compose time,
 * the email-safe output, the templates, which signature goes where, and
 * the dark-mode check. How the HTML looks in Gmail, Outlook, Apple Mail,
 * dark mode and on phones cannot be run here; these check the structure
 * those clients depend on.
 */

const ME = { name: 'Asha Perera', job_title: 'Engineer', department: '', company: 'Livezen', phone: '+94 11 234 5678', mobile: '', email: 'asha@livezen.lk', website: 'livezen.lk', address: 'Colombo', photo: '', company_logo: 'https://ws.example/s/logo?inline=1', brand_colour: '#AA2200' };

describe('fields', () => {
  it('fills text, links and pictures, and drops what has nothing behind it', () => {
    const html =
      '<div>{name} · {department}</div><div>{mobile}</div><div><a href="tel:{phone}">{phone}</a> | <a href="tel:{mobile}">{mobile}</a></div>' +
      '<div><a href="{website}">Web</a></div><div><img src="{company_logo}" alt="logo"></div><div><img src="{photo}" alt="me"></div><div>{title}</div>';
    const out = fillSignature(html, ME);
    expect(out).toContain('<div>Asha Perera</div>');
    expect(out).not.toMatch(/\{|\}/);
    expect(out).toContain('<a href="tel:+94112345678">+94 11 234 5678</a></div>');
    expect(out).not.toContain(' | ');
    expect(out).toContain('<a href="https://livezen.lk">Web</a>');
    expect(out).toContain('src="https://ws.example/s/logo?inline=1"');
    expect(out).not.toContain('alt="me"');
    expect(out).toContain('<div>Engineer</div>');
    expect(out.match(/<div>/g)).toHaveLength(5);
    expect(fieldsUsed(html)).toEqual(['name', 'department', 'mobile', 'phone', 'website', 'company_logo', 'photo', 'job_title']);
  });

  it('uses the From account’s address', () => {
    expect(valuesFor(ME, { email: 'sales@livezen.lk', display_name: 'Sales' }).email).toBe('sales@livezen.lk');
    expect(valuesFor({}, { email: 'x@y.lk', display_name: 'Pat' }).name).toBe('Pat');
    expect(fillSignature('<div><a href="mailto:{email}">{email}</a></div>', valuesFor(ME, { email: 'sales@livezen.lk' }))).toBe('<div><a href="mailto:sales@livezen.lk">sales@livezen.lk</a></div>');
  });
});

describe('email-safe output', () => {
  it('keeps field addresses through the allow-list and strips scripts, handlers, classes and flex', () => {
    const out = cleanSignatureHtml('<div class="x" onclick="steal()" style="display: flex; color: #333333">Hi<script>alert(1)</script></div><a href="tel:{mobile}">{mobile}</a><img src="{photo}" alt=""><a href="javascript:alert(1)">bad</a><a href="tel:+94 77 1">call</a>');
    expect(out).not.toMatch(/class=|onclick|script|flex|javascript/);
    expect(out).toContain('color: #333333');
    expect(out).toContain('href="tel:{mobile}"');
    expect(out).toContain('src="{photo}"');
    expect(out).toContain('href="tel:+94 77 1"');
  });

  it('gives tables no spacing of their own and pictures a width and height', () => {
    const out = emailSafe('<table><tbody><tr><td><img src="https://e/l.png" style="width: 120px"></td></tr></tbody></table>', { 'https://e/l.png': 0.5 });
    expect(out).toContain('<table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse">');
    expect(out).toContain('<img src="https://e/l.png" style="width: 120px; border: 0" width="120" height="60" alt="">');
  });

  it('puts pictures inside the message in embedded mode', () => {
    expect(withEmbedded('<img src="https://ws/s/a?inline=1">', { 'https://ws/s/a?inline=1': 'data:image/png;base64,AAAA' })).toBe('<img src="data:image/png;base64,AAAA">');
    expect(withEmbedded('<img src="https://ws/s/a">', { 'https://ws/s/a': 'javascript:x' })).toBe('<img src="https://ws/s/a">');
  });

  it('links social icons hosted on the server', () => {
    expect(socialHref('whatsapp', '+94 77 123 4567')).toBe('https://wa.me/94771234567');
    expect(socialHref('linkedin', 'linkedin.com/in/asha')).toBe('https://linkedin.com/in/asha');
    expect(socialHref('x', 'not a link')).toBeNull();
    expect(socialIconHtml('linkedin', 'https://linkedin.com/in/asha', 'https://ws.example/mail-assets/social')).toBe('<a href="https://linkedin.com/in/asha"><img src="https://ws.example/mail-assets/social/linkedin.png" alt="LinkedIn" width="24" height="24" style="width: 24px; height: 24px; border: 0"></a>&nbsp;');
  });
});

describe('templates', () => {
  it('has eight, each email-safe once filled', () => {
    expect(SIGNATURE_TEMPLATES.map((t) => t.name)).toEqual(['Simple', 'Classic with logo', 'Photo card', 'Corporate banner', 'Minimal line', 'Social', 'Bilingual', 'Legal footer']);
    for (const t of SIGNATURE_TEMPLATES) {
      const html = cleanSignatureHtml(renderTemplate(t.id, { values: ME, socialBase: 'https://ws.example/mail-assets/social/' }));
      expect(html, t.id).toContain('Asha Perera');
      expect(html, t.id).not.toMatch(/class=|display:\s*flex|<style|\{[a-z_]+\}/);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const img of doc.querySelectorAll('img')) expect(img.getAttribute('width'), `${t.id} ${img.getAttribute('src')}`).toMatch(/^\d+$/);
      for (const table of doc.querySelectorAll('table')) expect(table.getAttribute('cellpadding'), t.id).toBe('0');
      for (const el of doc.querySelectorAll<HTMLElement>('[style*="font-family"]')) expect(el.style.fontFamily, t.id).toMatch(/sans-serif|serif/);
    }
  });

  it('takes the company’s brand colour and logo, and leaves out a photo they do not have', () => {
    const html = renderTemplate('photo-card', { values: ME, socialBase: '' });
    expect(html).toContain('#AA2200');
    expect(html).toContain('https://ws.example/s/logo?inline=1');
    expect(html).not.toContain('{photo}');
    expect(renderTemplate('bilingual', { values: ME, socialBase: '' })).toMatch(/Noto Sans Sinhala/);
    expect(renderTemplate('legal-footer', { values: ME, socialBase: '' })).toContain('CONFIDENTIALITY NOTICE');
  });
});

describe('which signature, and where', () => {
  const sigs = [
    { id: 1, is_default: true },
    { id: 2, is_default: false },
    { id: 3, is_default: false },
  ];
  it('follows the account’s own choice, then the one for every account; a reply can have none', () => {
    const settings = [
      { mailbox: null, new_id: 1, reply_id: 2, placement: 'above_quote' as const },
      { mailbox: 7, new_id: 3, reply_id: null, placement: 'below_quote' as const },
    ];
    expect(chooseSignature(sigs, settings, '7', 'new')).toEqual({ signature: sigs[2], placement: 'below_quote' });
    expect(chooseSignature(sigs, settings, '7', 'reply')).toEqual({ signature: null, placement: 'below_quote' });
    expect(chooseSignature(sigs, settings, '4', 'forward')).toEqual({ signature: sigs[1], placement: 'above_quote' });
    expect(chooseSignature(sigs, undefined, '4', 'new').signature?.id).toBe(1);
  });

  it('puts the signature below the quoted message when the account says so', () => {
    const html = '<div>Thanks</div><div><br></div><div><br></div><div>-- </div><div>Asha</div>';
    const quote = 'On Thu Pat wrote:\n> Hello';
    const above = composeBody(html, quote);
    expect(above.html.indexOf('Asha')).toBeLessThan(above.html.indexOf('<blockquote'));
    const below = composeBody(html, quote, 'below_quote');
    expect(below.html.indexOf('Asha')).toBeGreaterThan(below.html.indexOf('<blockquote'));
    expect(below.text).toBe('Thanks\n\nOn Thu Pat wrote:\n> Hello\n\n--\nAsha');
  });
});

describe('dark mode', () => {
  const px = (rgba: number[][]) => rgba.flat();
  it('warns about a see-through logo with dark marks, not a solid or a light one', () => {
    expect(darkModeRisk(px([[0, 0, 0, 0], [20, 20, 20, 255]]))).toBe(true);
    expect(darkModeRisk(px([[255, 255, 255, 255], [20, 20, 20, 255]]))).toBe(false);
    expect(darkModeRisk(px([[0, 0, 0, 0], [240, 240, 240, 255]]))).toBe(false);
  });
});
