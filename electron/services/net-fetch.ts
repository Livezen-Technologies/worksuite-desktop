import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage, Session } from 'electron';
import { Readable, Writable } from 'node:stream';
import { responseHeaders } from '@shared/http-headers';
import { logger } from '../main/log';

const log = logger('net-fetch');

/** `net.request` (or a test's stand-in). */
export type NetRequest = (options: ClientRequestConstructorOptions) => ClientRequest;

export type NetFetchInit = RequestInit & {
  bypassCustomProtocolHandlers?: boolean;
  /**
   * How many bytes of the body the network has taken so far, from Chromium's own count (`getUploadProgress`), every
   * UPLOAD_PROGRESS_MS while it goes and once more when the answer comes (worksuite-desktop#265: the speed test's
   * upload). What is written to the request is buffered at once, whatever the line's speed, so only this says how fast
   * the body actually goes out.
   */
  onUploadProgress?: (bytes: number) => void;
};

const UPLOAD_PROGRESS_MS = 50;

const NULL_BODY = [101, 204, 205, 304];

/**
 * `fetch` over Chromium's network stack, as `net.fetch` / `session.fetch` are, but whose RESPONSE headers can never
 * crash the main process (worksuite-desktop#253).
 *
 * Electron's own `net.fetch` copies each response header into a `Headers` with `set()` inside the request's
 * 'response' listener. Chromium hands it the header bytes decoded as UTF-8, so a download whose
 * `Content-Disposition` carries a raw UTF-8 name — "FORM TECH-10 — Bid Security (Bank Guarantee).pdf" — arrives
 * as U+2014, `set()` throws "Cannot convert argument to a ByteString… value of 8212" from an event listener (an
 * uncaught exception in the main process), and the fetch never settles: the viewer waits on "Opening the file…"
 * for ever. Request headers were made safe in #238; this is the other direction.
 *
 * This is the same request, built with `net.request`: every header goes through `responseHeaders`, which writes a
 * value back as the bytes it came in and `Content-Disposition` as RFC 5987, and anything that still goes wrong
 * rejects THIS fetch — never the process.
 */
export function createNetFetch(request: NetRequest, session?: Session): (input: string | URL | Request, init?: NetFetchInit) => Promise<Response> {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      let req: Request;
      try {
        req = new Request(input, init);
      } catch (e) {
        reject(e);
        return;
      }
      const reason = () => (req.signal.reason as unknown) ?? new DOMException('The operation was aborted.', 'AbortError');
      const cancelBody = (why: unknown) => {
        if (req.body && !req.bodyUsed) req.body.cancel(why).catch(() => undefined);
      };
      if (req.signal.aborted) {
        cancelBody(reason());
        reject(reason());
        return;
      }

      let cr: ClientRequest;
      try {
        const origin = req.headers.get('origin') ?? undefined;
        const credentials = req.credentials !== 'same-origin' || origin ? req.credentials : 'include';
        cr = request({
          ...(session ? { session } : {}),
          method: req.method,
          url: req.url,
          origin,
          credentials,
          cache: req.cache,
          referrerPolicy: req.referrerPolicy,
          redirect: req.redirect,
          bypassCustomProtocolHandlers: !!init?.bypassCustomProtocolHandlers,
        });
        if (req.mode && (req.mode !== 'cors' || origin)) cr.setHeader('Sec-Fetch-Mode', req.mode);
        req.headers.forEach((v, k) => cr.setHeader(k, v));
      } catch (e) {
        cancelBody(e);
        reject(e);
        return;
      }

      let progress: NodeJS.Timeout | null = null;
      let uploaded = -1;
      const reportUpload = () => {
        try {
          const p = cr.getUploadProgress();
          if (p.current > uploaded) {
            uploaded = p.current;
            init!.onUploadProgress!(p.current);
          }
        } catch {
          /* the count is a nicety */
        }
      };
      const stopProgress = (last: boolean) => {
        if (!progress) return;
        clearInterval(progress);
        progress = null;
        if (last) reportUpload();
      };
      if (init?.onUploadProgress && req.body && typeof cr.getUploadProgress === 'function') {
        progress = setInterval(reportUpload, UPLOAD_PROGRESS_MS);
        progress.unref?.();
      }

      let aborted = false;
      req.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          stopProgress(false);
          reject(reason());
          cancelBody(reason());
          try {
            cr.abort();
          } catch {
            /* already gone */
          }
        },
        { once: true },
      );

      cr.on('response', (resp: IncomingMessage) => {
        stopProgress(true);
        if (aborted) return;
        try {
          const headers = responseHeaders(resp.headers, (name) => log.warn('response header left out', { header: name }));
          const body = NULL_BODY.includes(resp.statusCode) || req.method === 'HEAD' ? null : (Readable.toWeb(resp as unknown as Readable) as unknown as ReadableStream<Uint8Array>);
          resolve(new Response(body, { headers, status: resp.statusCode, statusText: safeStatusText(resp.statusMessage) }));
        } catch (e) {
          // Never an uncaught exception: this request fails, and its screen offers Retry.
          log.warn('response could not be read', { error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 160)}` : String(e) });
          try {
            cr.abort();
          } catch {
            /* already gone */
          }
          reject(e);
        }
      });
      cr.on('error', (e: Error) => {
        stopProgress(false);
        reject(e);
      });

      if (req.body) {
        req.body.pipeTo(Writable.toWeb(cr as unknown as Writable) as unknown as WritableStream<Uint8Array>).then(
          () => cr.end(),
          (e: unknown) => {
            stopProgress(false);
            reject(e);
          },
        );
      } else {
        cr.end();
      }
    });
}

/** A status line's text, as a `Response` accepts it (a reason phrase in UTF-8 would throw too). */
function safeStatusText(text: string | undefined): string {
  const t = String(text ?? '');
  return /^[\t\x20-\x7e\x80-\xff]*$/.test(t) ? t : '';
}
