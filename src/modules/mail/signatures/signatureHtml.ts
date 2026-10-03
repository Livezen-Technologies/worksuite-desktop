import { cleanComposeHtml, composeText } from '../composeHtml';

/**
 * A signature's HTML (worksuite-desktop#166): the {fields} filled from the
 * profile and the From account, cleaned through the composer's allow-list
 * with the fields kept, and made email-safe — tables for layout, inline
 * styles, web-safe fonts with fallbacks, pictures with width and height,
 * no classes and no flexbox — plus the social icons and the pictures sent
 * inside the message (embedded mode).
 */

export const FIELDS = ['name', 'job_title', 'department', 'company', 'phone', 'mobile', 'email', 'website', 'address', 'photo', 'company_logo'] as const;
export type Field = (typeof FIELDS)[number];

export type SignatureValues = Partial<Record<Field | 'brand_colour', string>>;

/** The fields' names, for menus and the details form. */
export const FIELD_LABELS: Record<Field, string> = {
  name: 'Name',
  job_title: 'Job title',
  department: 'Department',
  company: 'Company',
  phone: 'Phone',
  mobile: 'Mobile',
  email: 'Email',
  website: 'Website',
  address: 'Address',
  photo: 'Photo',
  company_logo: 'Company logo',
};

const TOKEN = /\{(name|job_title|title|department|company|phone|mobile|email|website|address|photo|company_logo)\}/g;
const HAS_TOKEN = new RegExp(TOKEN.source);
const PICTURES = new Set(['photo', 'company_logo']);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The values for one message: the From account's own address (and name, when the profile has none). */
export function valuesFor(values: SignatureValues | undefined, from: { email: string; display_name?: string | null } | null): SignatureValues {
  const v = { ...(values ?? {}) };
  if (from?.email) v.email = from.email;
  if (!v.name && from?.display_name && from.display_name !== from.email) v.name = from.display_name;
  return v;
}

const val = (values: SignatureValues, key: string): string => ((key === 'title' ? values.job_title : values[key as Field]) ?? '').trim();

/** A tel: address from a number as people write it. */
export const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;

/** An https address from what people write ("livezen.lk"). */
export const webHref = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

/**
 * The fields filled in. A field with nothing behind it goes, with the "|" or
 * "·" next to it; a line whose fields are all empty goes; a picture field
 * without a picture goes; a link to an empty field keeps its words only.
 */
export function fillSignature(html: string, values: SignatureValues): string {
  if (!html || !/\{[a-z_]+\}/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html}</div></body>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  for (const img of [...root.querySelectorAll('img')]) {
    const m = /^\{(photo|company_logo)\}$/.exec(img.getAttribute('src') ?? '');
    if (!m) continue;
    const url = val(values, m[1]!);
    if (url) img.setAttribute('src', url);
    else {
      const a = img.parentElement?.tagName === 'A' && img.parentElement.childNodes.length === 1 ? img.parentElement : img;
      const line = a.parentElement?.closest('div, p, li, h1, h2, h3, h4');
      a.remove();
      // A line that held only the picture goes too.
      if (line && line !== root && !(line.textContent ?? '').trim() && !line.querySelector('img, hr, table')) line.remove();
    }
  }
  // Fields in a picture's alt text or a title.
  for (const el of [...root.querySelectorAll('[alt], [title]')]) {
    for (const attr of ['alt', 'title']) {
      const v = el.getAttribute(attr);
      if (v && HAS_TOKEN.test(v)) el.setAttribute(attr, v.replace(TOKEN, (_m, k: string) => (PICTURES.has(k) ? '' : val(values, k))).trim());
    }
  }
  for (const a of [...root.querySelectorAll('a')]) {
    const m = /^(tel:|mailto:)?\{(phone|mobile|email|website)\}$/.exec(a.getAttribute('href') ?? '');
    if (!m) continue;
    const v = val(values, m[2]!);
    if (!v) a.replaceWith(...a.childNodes);
    else a.setAttribute('href', m[1] === 'tel:' ? telHref(v) : m[1] === 'mailto:' ? `mailto:${v}` : m[2] === 'website' ? webHref(v) : v);
  }
  const lines = new Map<Element, { filled: number; empty: number }>();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (HAS_TOKEN.test((n as Text).data)) texts.push(n as Text);
  for (const t of texts) {
    const line = t.parentElement?.closest('div, p, li, td, th, h1, h2, h3, h4') ?? root;
    const tally = lines.get(line) ?? { filled: 0, empty: 0 };
    let data = t.data;
    // An empty field takes its separator with it.
    for (const m of [...data.matchAll(TOKEN)]) {
      if (val(values, m[1]!)) continue;
      const k = m[1]!;
      data = data.replace(new RegExp(`\\s*[|·•]\\s*\\{${k}\\}`, 'g'), '').replace(new RegExp(`\\{${k}\\}\\s*[|·•]\\s*`, 'g'), '');
    }
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (const m of data.matchAll(TOKEN)) {
      frag.append(data.slice(at, m.index));
      at = m.index! + m[0].length;
      const v = val(values, m[1]!);
      if (v) tally.filled++;
      else tally.empty++;
      if (!v) continue;
      if (PICTURES.has(m[1]!)) {
        const img = doc.createElement('img');
        img.setAttribute('src', v);
        img.setAttribute('alt', m[1] === 'photo' ? val(values, 'name') : val(values, 'company'));
        img.setAttribute('width', m[1] === 'photo' ? '64' : '120');
        img.setAttribute('style', 'max-width: 100%; height: auto; border: 0');
        frag.append(img);
      } else frag.append(v);
    }
    // Tokens taken out with their separators still count as empty.
    for (const m of t.data.matchAll(TOKEN)) if (!val(values, m[1]!) && !data.includes(m[0])) tally.empty++;
    frag.append(data.slice(at));
    t.replaceWith(frag);
    lines.set(line, tally);
  }
  for (const [line, tally] of lines) {
    if (tally.empty > 0) tidySeparators(line);
    if (line === root || tally.filled > 0 || tally.empty === 0) continue;
    if (line.querySelector('img')) continue;
    if (line.tagName === 'TD' || line.tagName === 'TH') line.innerHTML = '';
    else line.remove();
  }
  return root.innerHTML;
}

const SEP = /^\s*[|·•]\s*$/;

/** "a | | b", "| b" and "a |" — left by empty fields in separate links — as "a | b", "b" and "a". */
function tidySeparators(line: Element): void {
  for (const a of [...line.querySelectorAll('a')]) if (!(a.textContent ?? '').trim() && !a.querySelector('img')) a.remove();
  const doc = line.ownerDocument;
  const texts = () => {
    const out: Text[] = [];
    const w = doc.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if ((n as Text).data.trim()) out.push(n as Text);
    return out;
  };
  for (let guard = 0; guard < 20; guard++) {
    const t = texts();
    const i = t.findIndex((n, k) => SEP.test(n.data) && (k === 0 || k === t.length - 1 || SEP.test(t[k + 1]!.data)));
    if (i < 0) break;
    t[i]!.remove();
  }
  const t = texts();
  if (t[0]) t[0].data = t[0].data.replace(/^\s*[|·•]\s*/, '');
  const end = t[t.length - 1];
  if (end) end.data = end.data.replace(/\s*[|·•]\s*$/, '');
}

/** The fields a signature uses. */
export function fieldsUsed(html: string): Field[] {
  const out: Field[] = [];
  for (const m of html.matchAll(TOKEN)) {
    const f = (m[1] === 'title' ? 'job_title' : m[1]) as Field;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

const SAFE_FIELD_HREF = /^(?:tel:\{(phone|mobile)\}|mailto:\{email\}|\{(website|email|phone|mobile)\})$/;
const PLACE = 'https://field.invalid/';

/**
 * Through the composer's allow-list, with the fields kept where they are
 * addresses (a picture's {photo}, a link's tel:{phone}), and email-safe.
 */
export function cleanSignatureHtml(html: string, ratios: Record<string, number> = {}): string {
  if (!html) return '';
  const held = html
    .replace(/(\shref\s*=\s*")([^"]*)"/gi, (all, pre: string, href: string) => (SAFE_FIELD_HREF.test(href) ? `${pre}${PLACE}href/${encodeURIComponent(href)}"` : all))
    .replace(/(\ssrc\s*=\s*")\{(photo|company_logo)\}"/gi, (_all, pre: string, f: string) => `${pre}${PLACE}src/${f}"`);
  const clean = cleanComposeHtml(held)
    .replace(new RegExp(`${PLACE.replace(/[.]/g, '\\.')}href/([^"]+)`, 'g'), (_all, h: string) => decodeURIComponent(h))
    .replace(new RegExp(`${PLACE.replace(/[.]/g, '\\.')}src/(photo|company_logo)`, 'g'), (_all, f: string) => `{${f}}`);
  return emailSafe(clean, ratios);
}

/**
 * What mail clients need: tables without spacing of their own, pictures with
 * a width and a height (from their proportions, when known) and no border, no
 * flex or grid.
 */
export function emailSafe(html: string, ratios: Record<string, number> = {}): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html}</div></body>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  // Styles are edited as written (the browser's CSSOM would rewrite every colour as rgb()).
  const decls = (el: Element) =>
    (el.getAttribute('style') ?? '')
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
  const write = (el: Element, list: string[]) => (list.length ? el.setAttribute('style', list.join('; ')) : el.removeAttribute('style'));
  const prop = (d: string) => d.slice(0, d.indexOf(':')).trim().toLowerCase();
  for (const el of [...root.querySelectorAll('[style]')]) {
    write(
      el,
      decls(el).filter((d) => {
        const p = prop(d);
        return !(/^(flex|grid|gap|justify-|align-items|position)/.test(p) || (p === 'display' && /flex|grid/i.test(d)));
      }),
    );
  }
  for (const t of [...root.querySelectorAll('table')]) {
    for (const [a, v] of [['border', '0'], ['cellpadding', '0'], ['cellspacing', '0']] as const) if (!t.hasAttribute(a)) t.setAttribute(a, v);
    if (!decls(t).some((d) => prop(d) === 'border-collapse')) write(t, [...decls(t), 'border-collapse: collapse']);
  }
  for (const img of [...root.querySelectorAll('img')]) {
    const styled = /(?:^|;)\s*width:\s*(\d+)px/i.exec(img.getAttribute('style') ?? '')?.[1];
    const w = Number(img.getAttribute('width')) || Number(styled) || 0;
    if (w && !img.getAttribute('width')) img.setAttribute('width', String(w));
    const ratio = ratios[img.getAttribute('src') ?? ''];
    if (w && ratio && !/%/.test(img.getAttribute('width') ?? '')) {
      const h = Math.max(1, Math.round(w * ratio));
      img.setAttribute('height', String(h));
    }
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
    if (!decls(img).some((d) => prop(d) === 'border')) write(img, [...decls(img), 'border: 0']);
  }
  return root.innerHTML;
}

/** The plain-text version that always goes with it. */
export function signatureText(html: string): string {
  return composeText(html);
}

/** Pictures sent inside the message (embedded mode): each hosted address as the picture itself. */
export function withEmbedded(html: string, embedded: Record<string, string> | undefined): string {
  if (!embedded) return html;
  let out = html;
  for (const [url, data] of Object.entries(embedded)) {
    if (!/^data:image\/(png|jpe?g|gif);base64,/i.test(data)) continue;
    out = out.split(`"${esc(url)}"`).join(`"${data}"`).split(`"${url}"`).join(`"${data}"`);
  }
  return out;
}

export const SOCIAL = ['linkedin', 'facebook', 'x', 'instagram', 'youtube', 'whatsapp', 'website'] as const;
export type Social = (typeof SOCIAL)[number];
export const SOCIAL_LABELS: Record<Social, string> = { linkedin: 'LinkedIn', facebook: 'Facebook', x: 'X', instagram: 'Instagram', youtube: 'YouTube', whatsapp: 'WhatsApp', website: 'Website' };

/** The address a social link goes to, from what people paste (a WhatsApp number becomes its wa.me link). */
export function socialHref(kind: Social, input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (kind === 'whatsapp' && /^\+?[\d\s().-]{6,}$/.test(v)) return `https://wa.me/${v.replace(/\D/g, '')}`;
  const url = webHref(v);
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && /\./.test(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** A social icon (a small PNG on the WorkSuite server) linked to the address. */
export function socialIconHtml(kind: Social, href: string, base: string): string {
  const src = `${base.replace(/\/?$/, '/')}${kind}.png`;
  return `<a href="${esc(href)}"><img src="${esc(src)}" alt="${esc(SOCIAL_LABELS[kind])}" width="24" height="24" style="width: 24px; height: 24px; border: 0"></a>&nbsp;`;
}

/** A field as it goes into the editor. */
export function fieldHtml(f: Field): string {
  return `{${f}}`;
}
