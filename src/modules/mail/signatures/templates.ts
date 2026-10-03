import { fillSignature, socialIconHtml, type SignatureValues } from './signatureHtml';

/**
 * Ready-made signatures (worksuite-desktop#166): Simple, Classic with logo,
 * Photo card, Corporate banner, Minimal line, Social, Bilingual and Legal
 * footer. Each is written with the {fields} and the company's brand colour,
 * and is email-safe: tables for layout, inline styles, web-safe fonts with
 * fallbacks, pictures with a width and height, no classes and no flexbox.
 * Choosing one fills it from the profile and the company (fillSignature,
 * which also drops lines with nothing to show) and opens it in the editor.
 */

export interface TemplateContext {
  values: SignatureValues;
  /** Where the social icons are (the server's /mail-assets/social/). */
  socialBase: string;
}

export interface SignatureTemplateDef {
  id: string;
  name: string;
  description: string;
  html: (brand: string, ctx: TemplateContext) => string;
}

const FONT = 'font-family: Arial, Helvetica, sans-serif';
const DEFAULT_BRAND = '#1F4E79';
const TABLE = 'border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse"';

export const brandOf = (v: SignatureValues) => (/^#[0-9a-f]{3,8}$/i.test(v.brand_colour ?? '') ? v.brand_colour! : DEFAULT_BRAND);

const nameLine = (brand: string, size = 16) => `<div style="${FONT}; font-size: ${size}px; font-weight: bold; color: ${brand}">{name}</div>`;
const titleLine = `<div style="${FONT}; font-size: 13px; color: #555555">{job_title} · {department}</div>`;
const companyLine = `<div style="${FONT}; font-size: 13px; font-weight: bold; color: #333333">{company}</div>`;
const contactLines = (brand: string) =>
  `<div style="${FONT}; font-size: 12px; color: #555555">` +
  `<a href="tel:{phone}" style="color: #555555; text-decoration: none">{phone}</a> | <a href="tel:{mobile}" style="color: #555555; text-decoration: none">{mobile}</a></div>` +
  `<div style="${FONT}; font-size: 12px"><a href="mailto:{email}" style="color: ${brand}; text-decoration: none">{email}</a> | <a href="{website}" style="color: ${brand}; text-decoration: none">{website}</a></div>` +
  `<div style="${FONT}; font-size: 12px; color: #777777">{address}</div>`;
const logo = (w: number) => `<img src="{company_logo}" alt="{company}" width="${w}" style="width: ${w}px; max-width: 100%; height: auto; border: 0">`;

export const SIGNATURE_TEMPLATES: SignatureTemplateDef[] = [
  {
    id: 'simple',
    name: 'Simple',
    description: 'Name, title and how to reach you.',
    html: (b) => `<div style="${FONT}; font-size: 14px; color: #222222">Kind regards,</div><div><br></div>${nameLine(b, 15)}${titleLine}${companyLine}${contactLines(b)}`,
  },
  {
    id: 'classic-logo',
    name: 'Classic with logo',
    description: 'Your company logo beside your details.',
    html: (b) =>
      `<table ${TABLE}><tbody><tr>` +
      `<td valign="top" width="130" style="padding: 0 14px 0 0; vertical-align: top">${logo(120)}</td>` +
      `<td valign="top" style="padding: 0 0 0 14px; border-left: 2px solid ${b}; vertical-align: top">${nameLine(b)}${titleLine}${companyLine}${contactLines(b)}</td>` +
      `</tr></tbody></table>`,
  },
  {
    id: 'photo-card',
    name: 'Photo card',
    description: 'Your photo, your details, the logo underneath.',
    html: (b) =>
      `<table ${TABLE}><tbody><tr>` +
      `<td valign="top" width="84" style="padding: 0 12px 0 0; vertical-align: top"><img src="{photo}" alt="{name}" width="72" height="72" style="width: 72px; height: 72px; border: 0; border-radius: 36px"></td>` +
      `<td valign="top" style="vertical-align: top">${nameLine(b)}${titleLine}${contactLines(b)}<div style="padding: 6px 0 0 0">${logo(90)}</div></td>` +
      `</tr></tbody></table>`,
  },
  {
    id: 'corporate-banner',
    name: 'Corporate banner',
    description: 'A band in your brand colour with the company name.',
    html: (b) =>
      `<table ${TABLE} width="480"><tbody>` +
      `<tr><td style="padding: 0 0 8px 0">${nameLine(b, 17)}${titleLine}</td></tr>` +
      `<tr><td bgcolor="${b}" style="background-color: ${b}; padding: 10px 14px"><table ${TABLE} width="100%"><tbody><tr>` +
      `<td valign="middle" style="${FONT}; font-size: 15px; font-weight: bold; color: #ffffff; vertical-align: middle">{company}</td>` +
      `<td valign="middle" align="right" style="vertical-align: middle; text-align: right">${logo(80)}</td>` +
      `</tr></tbody></table></td></tr>` +
      `<tr><td style="padding: 8px 0 0 0">${contactLines(b)}</td></tr>` +
      `</tbody></table>`,
  },
  {
    id: 'minimal-line',
    name: 'Minimal line',
    description: 'Everything on one or two quiet lines.',
    html: (b) =>
      `<div style="${FONT}; font-size: 13px; color: #333333"><b style="color: ${b}">{name}</b> | {job_title} | {company}</div>` +
      `<div style="${FONT}; font-size: 12px; color: #777777"><a href="tel:{phone}" style="color: #777777; text-decoration: none">{phone}</a> | <a href="{website}" style="color: #777777; text-decoration: none">{website}</a></div>`,
  },
  {
    id: 'social',
    name: 'Social',
    description: 'Your details with social icons under them.',
    html: (b, ctx) =>
      `${nameLine(b)}${titleLine}${companyLine}${contactLines(b)}` +
      `<div style="padding: 6px 0 0 0">${socialIconHtml('linkedin', 'https://www.linkedin.com/', ctx.socialBase)}${socialIconHtml('facebook', 'https://www.facebook.com/', ctx.socialBase)}${socialIconHtml('x', 'https://x.com/', ctx.socialBase)}${socialIconHtml('website', '{website}', ctx.socialBase)}</div>`,
  },
  {
    id: 'bilingual',
    name: 'Bilingual',
    description: 'English, with your name and title in Sinhala or Tamil.',
    html: (b) =>
      `${nameLine(b)}${titleLine}` +
      `<div style="font-family: Iskoola Pota, Nirmala UI, Latha, Noto Sans Sinhala, Noto Sans Tamil, Arial, sans-serif; font-size: 15px; font-weight: bold; color: ${b}">ඔබගේ නම · உங்கள் பெயர்</div>` +
      `<div style="font-family: Iskoola Pota, Nirmala UI, Latha, Noto Sans Sinhala, Noto Sans Tamil, Arial, sans-serif; font-size: 13px; color: #555555">තනතුර · பதவி</div>` +
      `${companyLine}${contactLines(b)}`,
  },
  {
    id: 'legal-footer',
    name: 'Legal footer',
    description: 'Your details and a confidentiality notice.',
    html: (b) =>
      `${nameLine(b, 15)}${titleLine}${companyLine}${contactLines(b)}` +
      `<hr style="border: none; border-top: 1px solid #dddddd; margin: 10px 0">` +
      `<div style="${FONT}; font-size: 10px; line-height: 1.4; color: #888888">CONFIDENTIALITY NOTICE: This email and any attachments are confidential and intended only for the person or organisation to whom they are addressed. If you received it by mistake, please tell the sender and delete it; do not copy, use or share it.</div>`,
  },
];

/** A ready-made signature with the person's details and the company's branding filled in. */
export function renderTemplate(id: string, ctx: TemplateContext): string {
  const t = SIGNATURE_TEMPLATES.find((x) => x.id === id);
  if (!t) return '';
  // Social links to the website field are kept as the website when there is one.
  return fillSignature(t.html(brandOf(ctx.values), ctx), ctx.values);
}
