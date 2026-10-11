import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationDevice } from '../../../electron/services/notification-device';
import { DesktopError } from '../../../electron/main/errors';
import type { HttpClient } from '../../../electron/services/http';

const devices: NotificationDevice[] = [];
afterEach(() => { devices.forEach((device) => device.stop()); devices.length = 0; });
function device(post: ReturnType<typeof vi.fn>) {
  const result = new NotificationDevice({ post } as unknown as HttpClient, () => ({ focused: true, lastInputAt: 123, viewing: 'chat:4' }));
  devices.push(result);
  result.start();
  return result;
}
describe('server-selected notification device', () => {
  it('includes presence and only shows the server-selected claim', async () => {
    const post = vi.fn().mockResolvedValueOnce({ deviceId: 'device' }).mockResolvedValueOnce({ notify: false }).mockResolvedValueOnce({ notify: true });
    const d = device(post);
    expect(await d.claim('chat:7', 'chat:4')).toBe(false);
    expect(await d.claim('chat:8', 'chat:4')).toBe(true);
    expect(post).toHaveBeenLastCalledWith('/api/notifications/devices/claim', expect.objectContaining({ client: 'desktop', focused: true, viewing: 'chat:4', key: 'chat:8', contextKey: 'chat:4' }));
  });
  it('retains legacy alerts only when the server lacks the endpoint', async () => {
    const d = device(vi.fn().mockRejectedValue(new DesktopError('NOT_FOUND', 'Old server', 404)));
    expect(await d.claim('chat:7', 'chat:4')).toBe(true);
  });
  it('does not create competing alerts during a network outage', async () => {
    const d = device(vi.fn().mockRejectedValue(new Error('offline')));
    expect(await d.claim('chat:7', 'chat:4')).toBe(false);
  });
  it('discards a claim granted after sign-out', async () => {
    let grant!: (answer: { notify: boolean }) => void;
    const post = vi.fn().mockResolvedValueOnce({ deviceId: 'device' }).mockImplementationOnce(() => new Promise((resolve) => { grant = resolve; }));
    const d = device(post);
    const pending = d.claim('chat:7', 'chat:4');
    await vi.waitFor(() => expect(grant).toBeDefined());
    d.stop();
    grant({ notify: true });
    expect(await pending).toBe(false);
  });
});
