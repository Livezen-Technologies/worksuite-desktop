import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { LockServer } from '@shared/pms-locks';
import { ACK, ENQ, NAK, parse } from './frame';

/**
 * The two ways a desk reaches an on-site lock server: a framed TCP link (SHIP, Saflok) and a JSON web interface
 * (Visionline, Vostio, Ambiance). Both connect only where the settings say, time out, and — with TLS and a pinned
 * fingerprint — check the server's certificate against the pin before a byte of the request is written.
 */

export class LockLinkError extends Error {}

const DEFAULT_TIMEOUT = 15_000;

function normalFingerprint(fp: string | undefined): string | null {
  const s = (fp ?? '').replace(/:/g, '').toUpperCase();
  return s.length === 64 ? s : null;
}

/** A connected socket to the lock server: plain, or TLS with its certificate checked (CA chain, or the pin). */
export function connect(server: LockServer): Promise<net.Socket> {
  const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT;
  const hostname = server.host.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const pin = normalFingerprint(server.fingerprint);
    const sock: net.Socket = server.tls
      ? tls.connect({ host: hostname, port: server.port, servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: pin === null })
      : net.connect({ host: hostname, port: server.port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new LockLinkError(`The lock server at ${server.host}:${server.port} did not answer in ${Math.round(timeout / 1000)} s.`));
    }, timeout);
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(new LockLinkError(`The lock server at ${server.host}:${server.port} could not be reached: ${(e as Error).message}`));
    });
    sock.once(server.tls ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      if (server.tls && pin !== null) {
        const got = ((sock as tls.TLSSocket).getPeerCertificate()?.fingerprint256 ?? '').replace(/:/g, '').toUpperCase();
        if (got !== pin) {
          sock.destroy();
          reject(new LockLinkError('The lock server’s certificate is not the one pinned in this desk’s settings.'));
          return;
        }
      }
      sock.removeAllListeners('error');
      resolve(sock);
    });
  });
}

/**
 * Send a framed request and wait for the answer frame (after an ACK), acknowledging it. `enq`: send ENQ only and
 * wait for ACK. The socket is closed afterwards.
 */
export async function exchange(server: LockServer, request: Buffer | 'enq', separator: string): Promise<{ command: string; fields: string[] } | 'ack'> {
  const sock = await connect(server);
  const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT;
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      sock.removeAllListeners('data');
      sock.end();
      sock.destroy();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new LockLinkError('The lock server took the request but did not answer in time.'))), timeout);
    sock.on('error', (e) => done(() => reject(new LockLinkError(`The link to the lock server broke: ${e.message}`))));
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 65_536) return done(() => reject(new LockLinkError('The lock server sent more than a key answer.')));
      const p = parse(buf, separator);
      if (p.acks.includes(NAK)) return done(() => reject(new LockLinkError('The lock server refused the request (NAK).')));
      if (request === 'enq') {
        if (p.acks.includes(ACK)) done(() => resolve('ack'));
        return;
      }
      if (!p.frame) return;
      if (!p.frame.lrcOk) {
        sock.write(Buffer.from([NAK]));
        return done(() => reject(new LockLinkError('The lock server’s answer arrived damaged (checksum).')));
      }
      sock.write(Buffer.from([ACK]));
      const f = p.frame;
      done(() => resolve(f));
    });
    sock.write(request === 'enq' ? Buffer.from([ENQ]) : request);
  });
}

export interface HttpAnswer {
  status: number;
  json: unknown;
}

/** A JSON request to the lock server's web interface. Only the configured host and port are ever asked. */
export async function httpJson(server: LockServer, method: 'GET' | 'POST', path: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpAnswer> {
  const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT;
  const sock = await connect(server);
  const text = body === null || body === undefined ? '' : JSON.stringify(body);
  const lib = server.tls ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        host: server.host.replace(/^\[|\]$/g, ''),
        port: server.port,
        path,
        createConnection: () => sock,
        headers: { Accept: 'application/json', ...(text ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)) } : {}), ...headers },
        timeout,
      } as http.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 1_048_576) req.destroy(new LockLinkError('The lock server sent more than a key answer.'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          sock.destroy();
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new LockLinkError('The lock server did not answer in time.')));
    req.on('error', (e) => {
      sock.destroy();
      reject(e instanceof LockLinkError ? e : new LockLinkError(`The lock server could not be reached: ${e.message}`));
    });
    if (text) req.write(text);
    req.end();
  });
}

export function md5Base64(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('base64');
}
