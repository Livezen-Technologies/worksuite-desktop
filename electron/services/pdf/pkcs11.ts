import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Signing with a smart card or USB token (WS-SRS-PDFPRO-001 PRO-SIG-002):
 * the person's own key, which never leaves the token, reached through the
 * token's PKCS#11 library by OpenSC's `pkcs11-tool`.
 *
 * The server prepares the signature (`prepare`), this signs the signed
 * attributes it hands over, and the server embeds the result (`complete`) —
 * the same two steps as a PKCS#12 file, so nothing about the key reaches
 * WorkSuite but its certificate.
 *
 * THE PIN is passed to pkcs11-tool in its environment (`--pin env:…`, OpenSC
 * 0.23+), never on its command line where other processes could read it,
 * never logged, never kept. The token locks itself after its own number of
 * wrong PINs; this says so rather than retrying.
 */

export interface TokenCert {
  module: string;
  token: string;
  id: string;
  label: string;
  /** The certificate, DER, base64. */
  der: string;
}

export interface TokenInfo {
  module: string;
  token: string;
  manufacturer: string;
  certs: TokenCert[];
}

type Run = (bin: string, args: string[], env?: Record<string, string>) => Promise<{ stdout: string; code: number }>;

/** Where token libraries usually are; a library chosen by the person is tried first. */
export const MODULE_CANDIDATES: Record<NodeJS.Platform | string, string[]> = {
  linux: ['/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so', '/usr/lib/opensc-pkcs11.so', '/usr/lib64/opensc-pkcs11.so', '/usr/lib/x86_64-linux-gnu/pkcs11/opensc-pkcs11.so',
    '/usr/lib/libeToken.so', '/usr/lib/libeTPkcs11.so', '/usr/lib/softhsm/libsofthsm2.so'],
  darwin: ['/Library/OpenSC/lib/opensc-pkcs11.so', '/usr/local/lib/opensc-pkcs11.so', '/opt/homebrew/lib/opensc-pkcs11.so', '/usr/local/lib/libeTPkcs11.dylib'],
  win32: ['C:\\Windows\\System32\\opensc-pkcs11.dll', 'C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll', 'C:\\Windows\\System32\\eTPKCS11.dll'],
};

const TOOL_CANDIDATES: Record<NodeJS.Platform | string, string[]> = {
  linux: ['/usr/bin/pkcs11-tool', '/usr/local/bin/pkcs11-tool'],
  darwin: ['/Library/OpenSC/bin/pkcs11-tool', '/usr/local/bin/pkcs11-tool', '/opt/homebrew/bin/pkcs11-tool'],
  win32: ['C:\\Program Files\\OpenSC Project\\OpenSC\\tools\\pkcs11-tool.exe'],
};

const defaultRun: Run = (bin, args, env) => new Promise((resolve) => {
  execFile(bin, args, { env: { ...process.env, ...env }, timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    // pkcs11-tool tells what went wrong (CKR_PIN_INCORRECT…) on stderr.
    resolve({ stdout: `${String(stdout ?? '')}\n${String(stderr ?? '')}`, code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0 });
  });
});

export class TokenSigner {
  constructor(
    private readonly run: Run = defaultRun,
    private readonly platform: string = process.platform,
    private readonly exists: (p: string) => boolean = existsSync,
    private readonly extraEnv: Record<string, string> = {},
  ) {}

  tool(): string | null {
    return (TOOL_CANDIDATES[this.platform] ?? []).find((p) => this.exists(p)) ?? null;
  }

  modules(preferred?: string | null): string[] {
    const list = [...(preferred ? [preferred] : []), ...(MODULE_CANDIDATES[this.platform] ?? [])];

    return [...new Set(list)].filter((p) => this.exists(p));
  }

  /** The tokens present and the certificates on each (no PIN needed: certificates are public). */
  async list(preferred?: string | null): Promise<{ available: boolean; reason: string | null; tokens: TokenInfo[] }> {
    const tool = this.tool();

    if (!tool) return { available: false, reason: 'Install OpenSC to sign with a smart card or USB token.', tokens: [] };

    const mods = this.modules(preferred);

    if (!mods.length) return { available: false, reason: 'No smart card or token library was found on this computer. Choose your token\'s PKCS#11 library.', tokens: [] };

    const tokens: TokenInfo[] = [];

    for (const module of mods) {
      const slots = await this.run(tool, ['--module', module, '--list-token-slots'], this.extraEnv);

      for (const block of slots.stdout.split(/\n(?=Slot )/)) {
        const label = /token label\s*:\s*(.+)/.exec(block)?.[1]?.trim();

        if (!label) continue;

        const manufacturer = /token manufacturer\s*:\s*(.+)/.exec(block)?.[1]?.trim() ?? '';
        const objs = await this.run(tool, ['--module', module, '--token-label', label, '--list-objects', '--type', 'cert'], this.extraEnv);
        const certs: TokenCert[] = [];

        for (const o of objs.stdout.split(/\n(?=Certificate Object)/)) {
          const id = /ID:\s*([0-9a-fA-F]+)/.exec(o)?.[1];

          if (!id) continue;

          const certLabel = /label:\s*(.+)/.exec(o)?.[1]?.trim() ?? id;
          const der = await this.readCert(tool, module, label, id);

          if (der) certs.push({ module, token: label, id, label: certLabel, der });
        }

        tokens.push({ module, token: label, manufacturer, certs });
      }
    }

    return { available: true, reason: tokens.length ? null : 'No token is plugged in.', tokens };
  }

  private async readCert(tool: string, module: string, token: string, id: string): Promise<string | null> {
    const dir = await mkdtemp(join(tmpdir(), 'ws-p11-'));

    try {
      const out = join(dir, 'cert.der');
      const r = await this.run(tool, ['--module', module, '--token-label', token, '--read-object', '--type', 'cert', '--id', id, '--output-file', out], this.extraEnv);

      return r.code === 0 && existsSync(out) ? (await readFile(out)).toString('base64') : null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Signs `data` (the server's signed attributes) with the token's key `id`:
   * SHA-256 with RSA PKCS#1 v1.5, or ECDSA-SHA256 as a DER sequence.
   */
  async sign(input: { module: string; token: string; id: string; pin: string; data: Uint8Array; ec: boolean }): Promise<Uint8Array> {
    const tool = this.tool();

    if (!tool) throw new Error('Install OpenSC to sign with a smart card or USB token.');

    if (!this.modules(input.module).includes(input.module)) throw new Error('That token library is not on this computer.');

    if (!/^[0-9a-fA-F]{1,64}$/.test(input.id)) throw new Error('That is not a key on the token.');

    const dir = await mkdtemp(join(tmpdir(), 'ws-p11-'));

    try {
      await writeFile(join(dir, 'in.bin'), input.data);
      const args = ['--module', input.module, '--token-label', input.token, '--login', '--pin', 'env:WS_TOKEN_PIN', '--sign', '--id', input.id,
        '--mechanism', input.ec ? 'ECDSA-SHA256' : 'SHA256-RSA-PKCS', ...(input.ec ? ['--signature-format', 'openssl'] : []),
        '--input-file', join(dir, 'in.bin'), '--output-file', join(dir, 'sig.bin')];
      const r = await this.run(tool, args, { ...this.extraEnv, WS_TOKEN_PIN: input.pin });

      if (r.code !== 0 || !existsSync(join(dir, 'sig.bin'))) {
        throw new Error(/PIN_INCORRECT|CKR_PIN_INCORRECT/.test(r.stdout) ? 'That PIN is not right. The token locks itself after a few wrong tries.'
          : /PIN_LOCKED/.test(r.stdout) ? 'The token is locked. Unlock it with its PUK or ask your administrator.' : 'The token did not sign.');
      }

      return new Uint8Array(await readFile(join(dir, 'sig.bin')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
