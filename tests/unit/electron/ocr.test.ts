import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { linesOf, OcrService, type TessWorker } from '../../../electron/services/ocr';
import { OCR_LANGUAGE_FILES, type OcrLanguage, type OcrLanguageFile, type OcrProgress } from '../../../shared/ocr';

const data = (lang: string) => Buffer.from(`${lang} traineddata `.repeat(50));
const files = Object.fromEntries(
  (['eng', 'sin', 'tam'] as const).map((id) => [id, { id, label: OCR_LANGUAGE_FILES[id].label, url: `https://cdn.test/${id}.traineddata.gz`, bytes: data(id).length, sha256: createHash('sha256').update(data(id)).digest('hex') }]),
) as Record<OcrLanguage, OcrLanguageFile>;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function service(over: { body?: (url: string) => Buffer; worker?: Partial<TessWorker> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ws-ocr-'));
  dirs.push(dir);
  const fetched: string[] = [];
  const progress: OcrProgress[] = [];
  const created: Array<{ languages: OcrLanguage[]; langPath: string }> = [];
  const terminate = vi.fn(async () => undefined);
  const recognize = vi.fn(async () => ({
    data: {
      confidence: 91.6,
      blocks: [
        { paragraphs: [{ lines: [{ words: [{ text: 'Invoice', confidence: 96.2 }, { text: 'total:', confidence: 95 }] }, { words: [{ text: 'ශ්‍රී', confidence: 94 }] }] }] },
        { paragraphs: [{ lines: [{ words: [{ text: 'தமிழ்', confidence: 95 }, { text: ' ', confidence: 0 }, { text: 'xx', confidence: 21.4 }] }] }] },
      ],
    },
  }));
  const ocr = new OcrService({
    dir,
    files,
    fetch: async (url) => {
      fetched.push(url);
      const lang = /\/(\w+)\.traineddata/.exec(url)![1]!;
      return new Response(new Uint8Array(over.body?.(url) ?? data(lang)), { status: 200 });
    },
    createWorker: async (languages, langPath) => {
      created.push({ languages, langPath });
      return { recognize, terminate, ...over.worker } as TessWorker;
    },
    progress: (_sender, p) => progress.push(p),
    idleMs: 60_000,
  });
  return { ocr, dir, fetched, progress, created, recognize, terminate };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('reading text in images on this computer (#59)', () => {
  it('fetches English, Sinhala and Tamil once, checked, then reads with all three in reading order', async () => {
    const s = service();
    expect((await s.ocr.status()).languages.map((l) => l.installed)).toEqual([false, false, false]);
    const r = await s.ocr.recognize(1, { id: 'job-00001', png: PNG });
    expect(s.fetched).toEqual(['https://cdn.test/eng.traineddata.gz', 'https://cdn.test/sin.traineddata.gz', 'https://cdn.test/tam.traineddata.gz']);
    expect(readFileSync(join(s.dir, 'sin.traineddata.gz'))).toEqual(data('sin'));
    expect(s.created).toEqual([{ languages: ['eng', 'sin', 'tam'], langPath: s.dir }]);
    expect(r).toMatchObject({ languages: ['eng', 'sin', 'tam'], confidence: 92, cancelled: false });
    expect(r.lines).toEqual([
      { words: [{ text: 'Invoice', confidence: 96 }, { text: 'total:', confidence: 95 }] },
      { words: [{ text: 'ශ්‍රී', confidence: 94 }] },
      { words: [] },
      { words: [{ text: 'தமிழ்', confidence: 95 }, { text: 'xx', confidence: 21 }] },
    ]);
    expect(s.progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['downloading', 'loading', 'recognizing']));
    expect(s.progress.filter((p) => p.stage === 'downloading').at(-1)?.progress).toBe(1);

    // The next picture: nothing fetched again, the same reader.
    await s.ocr.recognize(1, { id: 'job-00002', png: PNG });
    expect(s.fetched).toHaveLength(3);
    expect(s.created).toHaveLength(1);
    expect((await s.ocr.status()).languages.every((l) => l.installed)).toBe(true);
  });

  it('never uses a language file that does not match, and says so', async () => {
    const s = service({ body: (url) => (url.includes('sin') ? Buffer.alloc(files.sin.bytes, 1) : data(/\/(\w+)\.traineddata/.exec(url)![1]!)) });
    await expect(s.ocr.recognize(1, { id: 'job-00003', png: PNG })).rejects.toThrow('The Sinhala text-reading data did not match what WorkSuite expects');
    expect(existsSync(join(s.dir, 'sin.traineddata.gz'))).toBe(false);
    expect(existsSync(join(s.dir, 'sin.traineddata.gz.part'))).toBe(false);
    expect(s.created).toHaveLength(0);

    const big = service({ body: () => Buffer.alloc(files.eng.bytes + 10) });
    await expect(big.ocr.recognize(1, { id: 'job-00004', png: PNG, languages: ['eng'] })).rejects.toThrow('larger than expected');
  });

  it('stops a picture being read at once, and the next one starts a new reader', async () => {
    let started: () => void = () => undefined;
    const reading = new Promise<void>((r) => (started = r));
    const s = service({
      worker: {
        recognize: () => {
          started();
          return new Promise(() => undefined);
        },
      },
    });
    const job = s.ocr.recognize(1, { id: 'job-00005', png: PNG });
    await reading;
    s.ocr.cancel('job-00005');
    expect(await job).toMatchObject({ cancelled: true, lines: [] });
    expect(s.terminate).toHaveBeenCalled();

    // One cancelled before it ran is skipped.
    s.ocr.cancel('job-00006');
    expect(await s.ocr.recognize(1, { id: 'job-00006', png: PNG })).toMatchObject({ cancelled: true });
    expect(s.created).toHaveLength(1);
  });

  it('reads only the languages asked for', async () => {
    const s = service();
    await s.ocr.recognize(1, { id: 'job-00007', png: PNG, languages: ['tam', 'eng'] });
    expect(s.fetched).toEqual(['https://cdn.test/eng.traineddata.gz', 'https://cdn.test/tam.traineddata.gz']);
    expect(s.created[0]!.languages).toEqual(['eng', 'tam']);
  });

  it('pins every language file this build downloads by size and SHA-256', () => {
    for (const f of Object.values(OCR_LANGUAGE_FILES)) {
      expect(f.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@tesseract\.js-data\/(eng|sin|tam)@1\.0\.0\/4\.0\.0_best_int\/\w+\.traineddata\.gz$/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(1_000_000);
    }
  });

  it('keeps lines from a page with no layout', () => {
    expect(linesOf({ text: 'one two\nthree', confidence: 80 })).toEqual([
      { words: [{ text: 'one', confidence: 80 }, { text: 'two', confidence: 80 }] },
      { words: [{ text: 'three', confidence: 80 }] },
    ]);
    expect(linesOf({ blocks: null })).toEqual([]);
  });
});
