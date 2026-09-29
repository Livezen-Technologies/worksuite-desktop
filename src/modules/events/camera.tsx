import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { call } from '../../core/bridge';
import { Refusal } from './parts';

/**
 * Scanning with this computer's camera (EV-CHK-003 "device camera"), where
 * the system reads QR codes itself: Chromium's `BarcodeDetector` (macOS has
 * it; Windows and Linux builds of Chromium do not). Nothing is added to read
 * codes in the page. Without it the desk says so, and a USB scanner or the
 * typed number does the job. The picture stays on this computer: frames are
 * read here and dropped.
 */

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

function ctor(): DetectorCtor | null {
  const c = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof c === 'function' ? c : null;
}

export function cameraAvailable(): boolean {
  return ctor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function Camera({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onCode);
  useEffect(() => {
    done.current = onCode;
  });

  useEffect(() => {
    const C = ctor();
    if (!C) return;
    let stream: MediaStream | null = null;
    let stop = false;
    let timer: number | null = null;
    void (async () => {
      try {
        await call('media:access', { kind: 'camera' }).catch(() => ({ granted: true }));
        const formats = (await C.getSupportedFormats?.()) ?? ['qr_code'];
        if (!formats.includes('qr_code')) {
          setError('This computer’s camera cannot read QR codes. Use a USB scanner, or type the registration number.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new C({ formats: ['qr_code'] });
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const text = found[0]?.rawValue?.trim();
            if (text) {
              stop = true;
              done.current(text);
              return;
            }
          } catch {
            /* a frame not ready yet */
          }
          timer = window.setTimeout(() => void tick(), 180);
        };
        void tick();
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'WorkSuite may not use the camera. Allow it in the system’s privacy settings.' : 'The camera could not be opened.');
      }
    })();
    return () => {
      stop = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Modal title="Scan with the camera" onClose={onClose} width={560} footer={<Button onClick={onClose}>Close</Button>}>
      {error ? <Refusal text={error} /> : null}
      <video ref={video} muted playsInline className="aspect-video w-full rounded-[12px] bg-black object-cover" aria-label="Camera picture" />
      <p className="mb-0 text-[12px] text-ink-3">Hold the ticket’s QR code up to the camera.</p>
    </Modal>
  );
}
