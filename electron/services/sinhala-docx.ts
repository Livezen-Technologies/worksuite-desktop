import { inflateRawSync } from 'node:zlib';
import { convert, profileForFont, type Profile } from '@worksuite/sinhala-core';
import { createZip } from './zip';

/**
 * A whole .docx converted on this computer (blueprint §6.3, WF-SI-03), the way the plugin walks a document in the
 * editor (§4 "How it edits the document"): every run whose font is in a profile's `fontNames` (FMAbhaya,
 * DL-Manel-bold …) has its text converted to Unicode and its font switched to the target Unicode font. Body,
 * tables, headers, footers, footnotes, endnotes and comments are walked; everything else in the package is copied
 * byte for byte. Characters the profile does not map stay as they were and are counted (never dropped).
 *
 * Pure Node (zlib only), so the worker runs it and the tests call it directly.
 */

export interface ZipFile {
  name: string;
  data: Buffer;
}

/** Limits that keep a hostile package from filling memory. */
const MAX_ENTRY = 200 * 1024 * 1024;
const MAX_TOTAL = 500 * 1024 * 1024;
const MAX_ENTRIES = 5000;

/** Reads a ZIP (stored or deflated entries, no zip64, no encryption) through its central directory. */
export function readZip(buf: Buffer): ZipFile[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a Word document (no ZIP directory).');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error('The document has too many parts.');
  let p = buf.readUInt32LE(eocd + 16);
  const files: ZipFile[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The document is damaged (ZIP directory).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error('The document is encrypted.');
    if (size > MAX_ENTRY || (total += size) > MAX_TOTAL) throw new Error('The document is too large to convert here.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('The document is damaged (ZIP entry).');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
    else throw new Error(`The document uses a ZIP method this cannot read (${method}).`);
    if (name.endsWith('/')) continue;
    files.push({ name, data });
  }
  return files;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? m;
  });
}
export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const attrEscape = (s: string): string => xmlEscape(s).replace(/"/g, '&quot;');

/** The parts of a .docx with runs of text. */
export const DOCX_TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

export interface DocxConvertOptions {
  profiles: Profile[];
  /** The target Unicode font (the organisation's, Noto Sans Sinhala by default). */
  targetFont: string;
  /** A profile id: runs whose font names no profile are left alone either way; this one is used for them all. */
  force?: string | null;
}

export interface DocxConvertStats {
  runsTotal: number;
  runsConverted: number;
  unmappedCount: number;
  /** The profile (and version) the most runs used, or the forced one. */
  profile: string;
  profileVersion: string;
  preview: Array<{ before: string; after: string }>;
}

const RUN = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
const FONTS = /<w:rFonts\b([^>]*?)\/?>/;
const TEXT = /<w:t((?:\s[^>]*)?)>([\s\S]*?)<\/w:t>/g;

function fontNamesOf(attrs: string): string[] {
  const names: string[] = [];
  for (const m of attrs.matchAll(/w:(ascii|hAnsi|cs|eastAsia)="([^"]*)"/g)) names.push(xmlUnescape(m[2]!));
  return names;
}

/** One part's XML: legacy runs converted, their fonts switched. */
export function convertPartXml(xml: string, o: DocxConvertOptions, stats: DocxConvertStats, used: Map<string, number>): string {
  const forced = o.force ? (o.profiles.find((p) => p.id === o.force) ?? null) : null;
  const font = attrEscape(o.targetFont);
  return xml.replace(RUN, (run: string) => {
    const f = FONTS.exec(run);
    if (!f) return run;
    const legacy = profileForFont(fontNamesOf(f[1] ?? ''), o.profiles);
    if (!legacy) return run;
    const profile = forced ?? legacy;
    stats.runsTotal++;
    let before = '';
    let after = '';
    const converted = run.replace(TEXT, (_m: string, attrs: string, body: string) => {
      const text = xmlUnescape(body);
      const r = convert(text, profile, 'toUnicode');
      stats.unmappedCount += r.unmapped.length;
      before += text;
      after += r.text;
      const a = /xml:space=/.test(attrs) ? attrs : `${attrs} xml:space="preserve"`;
      return `<w:t${a}>${xmlEscape(r.text)}</w:t>`;
    });
    if (before === '') return run;
    stats.runsConverted++;
    used.set(`${profile.id}\u0000${profile.version}`, (used.get(`${profile.id}\u0000${profile.version}`) ?? 0) + 1);
    if (stats.preview.length < 10 && before !== after) stats.preview.push({ before: before.slice(0, 200), after: after.slice(0, 200) });
    // The theme's fonts would win over the named ones: the run names the target font for every script, and only that.
    return converted.replace(FONTS, `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>`);
  });
}

/** Converts a .docx's legacy runs; the package is otherwise unchanged. */
export function convertDocx(bytes: Uint8Array, o: DocxConvertOptions, now = new Date()): { bytes: Buffer; stats: DocxConvertStats } {
  const files = readZip(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (!files.some((f) => f.name === 'word/document.xml')) throw new Error('This is not a Word document (.docx).');
  const stats: DocxConvertStats = { runsTotal: 0, runsConverted: 0, unmappedCount: 0, profile: o.force ?? '', profileVersion: '', preview: [] };
  const used = new Map<string, number>();
  const out = files.map((f) => (DOCX_TEXT_PART.test(f.name) ? { name: f.name, data: Buffer.from(convertPartXml(f.data.toString('utf8'), o, stats, used), 'utf8') } : f));
  const top = [...used.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top) {
    const [id, version] = top.split('\u0000');
    stats.profile = id ?? stats.profile;
    stats.profileVersion = version ?? '';
  } else if (o.force) {
    stats.profileVersion = o.profiles.find((p) => p.id === o.force)?.version ?? '';
  }
  // [Content_Types].xml first, as Word writes it.
  out.sort((a, b) => (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));
  return { bytes: createZip(out, now), stats };
}
