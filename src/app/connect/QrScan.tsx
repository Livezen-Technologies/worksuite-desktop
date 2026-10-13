import jsQR from 'jsqr';
import { useEffect, useId, useRef, useState } from 'react';
import { SETUP_LINK_PREFIX } from '@shared/trusted-config';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';

export interface QrScanProps {
  /** A setup link read from the camera, an image or pasted. */
  onLink: (link: string) => void;
  onClose: () => void;
}

/** How often a camera frame is read (ms). */
const SCAN_EVERY = 250;

/** A setup link in what a QR code holds, or null (another QR: a web address, a Wi-Fi code). */
export function setupLinkIn(text: string | null | undefined): string | null {
  const v = (text ?? '').trim();
  return v.toLowerCase().startsWith(SETUP_LINK_PREFIX) ? v : null;
}

/** The text of the QR code in an image's pixels, or null. */
export function decodePixels(data: Uint8ClampedArray, width: number, height: number): string | null {
  const code = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return code?.data ?? null;
}

/** Draws `source` scaled to at most `max` px on its long side and reads the QR in it. */
function decodeFrom(source: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement, max = 1024): string | null {
  if (!w || !h) return null;
  const scale = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodePixels(img.data, img.width, img.height);
}

/** Reads the QR code in an image file (a screenshot of Admin Center's setup QR, a photo of it). */
export async function decodeImageFile(file: File, canvas: HTMLCanvasElement): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return decodeFrom(img, img.naturalWidth, img.naturalHeight, canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Screen 6's dialog — scan the setup QR from Admin Center with the camera, choose an image of it, or paste the setup
 * link. Only a `worksuite://setup` link is taken; nothing connects from here (the address screen shows the server it
 * names, and Continue starts the checks). The camera runs only while this dialog is open.
 */
export function QrScan({ onLink, onClose }: QrScanProps) {
  const titleId = useId();
  const pasteId = useId();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'unavailable'>(() => (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'starting' : 'unavailable'));
  const [note, setNote] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const done = useRef(false);
  const close = useRef(onClose);
  const found = useRef(onLink);
  useEffect(() => {
    close.current = onClose;
    found.current = onLink;
  });

  const canvasEl = () => (canvas.current ??= document.createElement('canvas'));

  const take = (text: string | null): boolean => {
    if (done.current) return true;
    if (text === null) return false;
    const link = setupLinkIn(text);
    if (!link) {
      setNote('That QR code isn’t a WorkSuite setup code. Use the setup QR from Admin Center › Desktop › Trusted servers.');
      return false;
    }
    done.current = true;
    found.current(link);
    return true;
  };

  // The camera, while the dialog is open: a frame read every SCAN_EVERY ms until a setup link is found.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let live = true;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) return;
    media.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(
      (s) => {
        if (!live) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          void v.play?.()?.catch?.(() => undefined);
        }
        setCamera('on');
        timer = setInterval(() => {
          const el = video.current;
          if (!el || el.readyState < 2) return;
          try {
            if (take(decodeFrom(el, el.videoWidth, el.videoHeight, canvasEl(), 720)) && timer) clearInterval(timer);
          } catch {
            // A frame that could not be read: the next one is.
          }
        }, SCAN_EVERY);
      },
      () => live && setCamera('unavailable'),
    );
    return () => {
      live = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Once: the camera opens with the dialog and stops with it.
  }, []);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const chooseImage = async (f: File | undefined) => {
    if (!f) return;
    setNote(null);
    try {
      const text = await decodeImageFile(f, canvasEl());
      if (text === null) setNote('No QR code found in that image. Try a sharper screenshot of the setup QR.');
      else take(text);
    } catch {
      setNote('That image couldn’t be opened.');
    }
  };

  const submitPasted = () => {
    if (!take(pasted.trim() || null) && !pasted.trim()) setNote('Paste the setup link from Admin Center.');
  };

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex w-[380px] max-w-full flex-col gap-3.5 rounded-[18px] bg-navy p-6 text-white shadow-2xl outline-none">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="m-0 text-[15px] font-bold">
            Scan setup QR
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} className="text-navy-ink hover:bg-white/10" />
        </div>
        <div className="relative flex h-[220px] items-center justify-center overflow-hidden rounded-[12px] bg-navy-2">
          <video ref={video} muted playsInline aria-label="Camera" className={camera === 'on' ? 'absolute inset-0 h-full w-full object-cover' : 'hidden'} />
          <div className="relative h-[150px] w-[150px] rounded-[14px] border-[3px] border-[#9FB0FF]" aria-hidden />
          {camera === 'starting' ? <span className="absolute bottom-3 text-[12px] text-navy-ink">Opening the camera…</span> : null}
          {camera === 'unavailable' ? (
            <span role="status" className="absolute inset-x-4 bottom-3 text-center text-[12px] text-navy-ink">
              No camera available — choose an image or paste a setup link.
            </span>
          ) : null}
        </div>
        <p className="m-0 text-[13px] leading-normal text-navy-ink">
          Hold the QR from Admin Center up to your camera — or{' '}
          <button type="button" className="font-semibold text-[#9FB0FF] underline" onClick={() => file.current?.click()}>
            choose an image
          </button>{' '}
          /{' '}
          <button type="button" className="font-semibold text-[#9FB0FF] underline" aria-expanded={pasting} onClick={() => setPasting(true)}>
            paste a setup link
          </button>
          .
        </p>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" data-testid="qr-image" onChange={(e) => void chooseImage(e.target.files?.[0])} />
        {pasting ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitPasted();
            }}
          >
            <label htmlFor={pasteId} className="text-[12.5px] font-semibold">
              Setup link
            </label>
            <input
              id={pasteId}
              autoFocus
              value={pasted}
              spellCheck={false}
              placeholder="worksuite://setup?d=…"
              onChange={(e) => {
                setPasted(e.target.value);
                setNote(null);
              }}
              className="h-10 rounded-[8px] border border-white/20 bg-navy-2 px-3 font-mono text-[12.5px] text-white outline-none placeholder:text-navy-ink/60 focus:border-[#9FB0FF]"
            />
            <Button type="submit" variant="primary" disabled={!pasted.trim()}>
              Use this link
            </Button>
          </form>
        ) : null}
        {note ? (
          <p role="alert" className="m-0 flex items-start gap-2 rounded-[8px] bg-white/10 px-3 py-2 text-[12.5px] text-white">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            {note}
          </p>
        ) : null}
        <div className="text-[11px] text-[#9FB0FF]">Signed by the server · no passwords in the code</div>
      </div>
    </div>
  );
}
