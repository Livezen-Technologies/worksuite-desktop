import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { btnSmall } from '../hr/parts';
import {
  fetchProductImages,
  K,
  mainProductImage,
  orderProductImages,
  PICTURE_LIMIT,
  PICTURE_TYPES,
  pictureProblem,
  pictureSrc,
  removeProductImage,
  shrinkPicture,
  uploadProductImage,
  type ProductImage,
} from './api';

/**
 * A product's pictures, in the product form.
 *
 * Editing a product, each change goes to the server as it is made — added,
 * dragged into order, made the main one, removed. A new product has no id to
 * hang pictures on yet, so they wait here (`pending`) and the form sends them
 * once the product is saved (`sendPictures`). Either way the first picture is
 * the product's own: lists, labels and the point of sale show it.
 */
export default function ProductPictures({ productId, pending, onPending }: { productId: number | null; pending: File[]; onPending: (files: File[]) => void }) {
  const qc = useQueryClient();
  const images = useQuery({
    queryKey: K.images(productId ?? 0),
    queryFn: ({ signal }) => fetchProductImages(productId!, signal),
    enabled: !!productId,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const previews = usePreviews(productId ? NONE : pending);

  const tiles: Array<{ key: string; src: string; label: string }> = productId
    ? (images.data ?? []).map((i) => ({ key: String(i.id), src: pictureSrc(i.url), label: i.caption ?? `Picture ${i.position + 1}` }))
    : pending.map((f, n) => ({ key: `${n}:${f.name}`, src: previews[n] ?? '', label: f.name }));
  const room = PICTURE_LIMIT - tiles.length;

  const saved = (next: ProductImage[]) => {
    qc.setQueryData(K.images(productId!), next);
    void qc.invalidateQueries({ queryKey: ['inventory', 'products'] });
    void qc.invalidateQueries({ queryKey: ['inventory', 'product', productId!] });
  };

  const add = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const ok: File[] = [];
    for (const f of files) {
      const bad = pictureProblem(f);
      if (bad) toast('error', bad);
      else ok.push(f);
    }
    if (ok.length > room) toast('error', `A product has at most ${PICTURE_LIMIT} pictures; ${ok.length - Math.max(room, 0)} not added.`);
    const take = ok.slice(0, Math.max(room, 0));
    if (take.length === 0) return;
    if (!productId) {
      onPending([...pending, ...take]);
      return;
    }
    setBusy('add');
    try {
      const failed = await sendPictures(productId, take, (next) => saved(next));
      if (failed.length === 0) toast('success', take.length === 1 ? 'Picture added' : `${take.length} pictures added`);
    } finally {
      setBusy(null);
    }
  };

  const change = async (what: string, run: () => Promise<ProductImage[]>) => {
    setBusy(what);
    try {
      saved(await run());
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** Put the tile at `from` at `to`, keeping the rest in their order. */
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= tiles.length) return;
    if (!productId) {
      const next = [...pending];
      const [f] = next.splice(from, 1);
      next.splice(to, 0, f!);
      onPending(next);
      return;
    }
    const ids = (images.data ?? []).map((i) => i.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id!);
    void change('order', () => orderProductImages(productId, ids));
  };

  const remove = (n: number) => {
    if (!productId) {
      onPending(pending.filter((_, i) => i !== n));
      return;
    }
    const img = images.data?.[n];
    if (img) void change(`remove:${img.id}`, () => removeProductImage(productId, img.id));
  };

  const makeMain = (n: number) => {
    if (!productId) {
      move(n, 0);
      return;
    }
    const img = images.data?.[n];
    if (img) void change(`main:${img.id}`, () => mainProductImage(productId, img.id));
  };

  const dropFiles = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setOver(false);
    void add(e.dataTransfer.files);
  };

  return (
    <div
      role="group"
      aria-label="Pictures"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={dropFiles}
      className={cx('rounded-[10px] border border-dashed p-2.5', over ? 'border-primary bg-[#F4F6FE] dark:bg-selection/40' : 'border-line')}
    >
      {productId && images.isLoading ? <span className="text-[12px] text-ink-3">Loading pictures…</span> : null}
      {productId && images.error ? <span className="text-[12px] text-danger">{errorMessage(images.error)}</span> : null}
      {tiles.length > 0 ? (
        <ul className="mb-2 grid grid-cols-4 gap-2" aria-label="Gallery">
          {tiles.map((t, n) => (
            <li
              key={t.key}
              draggable={!busy}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/x-picture', String(n));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/x-picture')) e.preventDefault();
              }}
              onDrop={(e) => {
                const from = e.dataTransfer.getData('text/x-picture');
                if (from === '') return;
                e.preventDefault();
                e.stopPropagation();
                move(Number(from), n);
              }}
              className="group relative aspect-square overflow-hidden rounded-[8px] border border-line bg-subtle"
            >
              {t.src ? <img src={t.src} alt={t.label} className="size-full object-contain" draggable={false} /> : null}
              {n === 0 ? <span className="absolute top-1 left-1 rounded-[5px] bg-primary px-1.5 py-px text-[10.5px] font-bold text-white">Main</span> : null}
              <span className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                {n > 0 ? (
                  <TileButton label={`Make ${t.label} the main picture`} disabled={!!busy} onClick={() => makeMain(n)}>
                    ★
                  </TileButton>
                ) : null}
                {n > 0 ? (
                  <TileButton label={`Move ${t.label} earlier`} disabled={!!busy} onClick={() => move(n, n - 1)}>
                    ‹
                  </TileButton>
                ) : null}
                {n < tiles.length - 1 ? (
                  <TileButton label={`Move ${t.label} later`} disabled={!!busy} onClick={() => move(n, n + 1)}>
                    ›
                  </TileButton>
                ) : null}
                <TileButton label={`Remove ${t.label}`} disabled={!!busy} onClick={() => remove(n)}>
                  ✕
                </TileButton>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="button" className={btnSmall} disabled={!!busy || room <= 0} onClick={() => pick.current?.click()}>
          {busy === 'add' ? 'Adding…' : tiles.length ? 'Add more pictures' : 'Add pictures'}
        </button>
        <span className="text-[11.5px] text-ink-3">
          {room <= 0
            ? `${PICTURE_LIMIT} pictures — the most a product has.`
            : `Or drop them here. JPEG, PNG, WebP or GIF, up to ${PICTURE_LIMIT}. The first is the main picture${tiles.length > 1 ? '; drag to reorder' : ''}.`}
          {!productId && pending.length ? ' They are added when you save.' : ''}
        </span>
      </div>
      <input
        ref={pick}
        type="file"
        accept={PICTURE_TYPES.join(',')}
        multiple
        hidden
        aria-label="Choose pictures"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function TileButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-6 place-items-center rounded-[6px] bg-surface/95 text-[12px] font-bold text-ink shadow hover:bg-surface disabled:opacity-50">
      {children}
    </button>
  );
}

/** One empty list, so an edit (which has no pictures waiting) does not re-run the previews every render. */
const NONE: File[] = [];

/** Object URLs for pictures not sent yet, let go when the list changes or the form closes. */
function usePreviews(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') {
      setUrls([]);
      return;
    }
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => {
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [files]);
  return urls;
}

/**
 * Send pictures to a product one at a time (the API proxy takes one request
 * at a time well, and one bad file does not lose the rest), each made small
 * enough first. Says what the server refused; answers the files it refused.
 */
export async function sendPictures(productId: number, files: File[], onGallery: (images: ProductImage[]) => void): Promise<File[]> {
  const failed: File[] = [];
  for (const f of files) {
    try {
      onGallery(await uploadProductImage(productId, await shrinkPicture(f), f.name));
    } catch (e) {
      failed.push(f);
      toast('error', `${f.name}: ${errorMessage(e)}`);
    }
  }
  return failed;
}
