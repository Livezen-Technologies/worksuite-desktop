import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { isProxyPathAllowed } from '../../../electron/services/api-proxy';

describe('Garage through the API proxy', () => {
  it('lets the Garage screens read and write, and the timer’s offline queue replay', () => {
    expect(isProxyPathAllowed('/api/garage/v1/board', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/my-work', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/work-orders/9/start', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/parts-usage/7/issue', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/../users', 'GET')).toBe(false);
  });
});
