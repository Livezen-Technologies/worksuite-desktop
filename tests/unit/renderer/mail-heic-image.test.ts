// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const convert = vi.hoisted(() => vi.fn());
vi.mock('heic-to/csp', () => ({ heicTo: convert }));
const { prepareImage } = await import('../../../src/modules/mail/editor/images');

afterEach(() => vi.unstubAllGlobals());

it('converts an untyped HEIC file to JPEG before the normal inline image pipeline', async () => {
  const jpeg = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
  convert.mockResolvedValue(jpeg);
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:jpeg');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('Image', class {
    naturalWidth = 100; naturalHeight = 80; onload: (() => void) | null = null;
    private source = '';
    set src(value: string) { this.source = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this.source; }
  });
  try {
    const file = new File(['original-heic'], 'photo.HEIC');
    const ready = await prepareImage(file);
    expect(convert).toHaveBeenCalledWith({ blob: file, type: 'image/jpeg', quality: 0.85 });
    expect(URL.createObjectURL).toHaveBeenCalledWith(jpeg);
    expect(ready).toMatchObject({ src: 'data:image/jpeg;base64,anBlZy1ieXRlcw==', width: 100, height: 80, bytes: jpeg.size });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:jpeg');
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});
