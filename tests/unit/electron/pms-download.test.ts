import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }));

import { pmsDownloadInput, pmsFilePath } from '@shared/pms-files';
import { IpcRouter } from '../../../electron/ipc/router';
import { pmsDownload } from '../../../electron/services/pms-download';
import { isDesktopError } from '../../../electron/main/errors';

function fakeIpc() {
  const handlers = new Map<string, (e: unknown, p: unknown) => unknown>();
  return { handlers, handle: (ch: string, fn: (e: unknown, p: unknown) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) };
}
const event = () => ({ sender: { id: 1, reload: vi.fn() }, senderFrame: { url: 'app://bundle/index.html', parent: null } });
const deps = (hasPermission: (k: string) => boolean) => ({ isTrustedSender: () => true, isLocked: () => false, isSignedIn: () => true, hasPermission, audit: vi.fn(), onAbuse: vi.fn() });
const TRANSFER = { id: 't', direction: 'download', name: 'letter.pdf', source: 'WorkSuite Files', destination: '/dl', bytes: 0, total: 0, state: 'queued', speed: 0, error: null, createdAt: '' };

describe('Hotel PMS files saved on this computer (pms:download)', () => {
  it('builds the address from what the page names, never from a path', () => {
    expect(pmsFilePath({ kind: 'guest-document', document: 5 })).toBe('/api/pms/v1/guest-documents/5');
    expect(pmsFilePath({ kind: 'report', property: 1, report: 'occupancy', format: 'xlsx', query: { from: '2026-09-18', to: '2026-09-18', room_type_id: '' } })).toBe('/api/pms/v1/properties/1/reports/occupancy?from=2026-09-18&to=2026-09-18&format=xlsx');
    for (const bad of [
      { file: { kind: 'guest-document', document: 0 }, name: 'x' },
      { file: { kind: 'report', property: 1, report: '../users', format: 'csv', query: {} }, name: 'x' },
      { file: { kind: 'report', property: 1, report: 'occupancy', format: 'exe', query: {} }, name: 'x' },
      { file: { kind: 'report', property: 1, report: 'occupancy', format: 'csv', query: { from: 'a&b=c' } }, name: 'x' },
      { file: { kind: 'report', property: 1, report: 'occupancy', format: 'csv', query: { format: 'json' } }, name: 'x' },
      { file: { kind: 'path', path: '/api/users' }, name: 'x' },
    ])
      expect(pmsDownloadInput.safeParse(bad).success).toBe(false);
  });

  it('is refused by the channel without desktop.downloads, and audited when allowed', async () => {
    const ipc = fakeIpc();
    let allowed = false;
    const d = deps((k) => k !== 'desktop.downloads' || allowed);
    const router = new IpcRouter(ipc as never, d as never);
    const handler = vi.fn(async () => TRANSFER);
    router.handle('pms:download', handler as never);
    router.install();
    const input = { file: { kind: 'guest-document', document: 5 }, name: 'letter.pdf' };
    expect(await ipc.handlers.get('pms:download')!(event(), input)).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(handler).not.toHaveBeenCalled();
    allowed = true;
    expect(await ipc.handlers.get('pms:download')!(event(), input)).toMatchObject({ name: 'letter.pdf' });
    expect(d.audit).toHaveBeenCalledWith('pms:download', { ok: true });
  });

  it('checks the policy again in the main process at the moment of saving', async () => {
    const download = vi.fn(async () => TRANSFER as never);
    let may = false;
    const input = { file: { kind: 'report' as const, property: 1, report: 'occupancy', format: 'csv' as const, query: { from: '2026-09-18' } }, name: 'occupancy.csv' };
    let err: unknown = null;
    try {
      await pmsDownload({ mayDownload: () => may, download }, input);
    } catch (e) {
      err = e;
    }
    expect(isDesktopError(err) && err.code).toBe('POLICY_DENIED');
    expect(download).not.toHaveBeenCalled();
    may = true;
    await pmsDownload({ mayDownload: () => may, download }, input);
    expect(download).toHaveBeenCalledWith('/api/pms/v1/properties/1/reports/occupancy?from=2026-09-18&format=csv', 'occupancy.csv', false, null);
  });
});
