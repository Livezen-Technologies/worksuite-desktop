// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { documentServerOrigin } from '../../../shared/office';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ viewId: '5d0c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10' })), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn(), toasts: { get: () => ({ items: [] }), set: () => undefined, subscribe: () => () => undefined } }));
vi.mock('../../../src/core/tab-context', () => ({ useTabTitle: () => undefined }));

const { apiGet, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { ClassicEditor, classicApiUrl } = await import('../../../src/modules/office/ClassicEditor');

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

afterEach(() => {
  cleanup();
  vi.mocked(call).mockClear();
});

describe('the EuroOffice editor on a server with only /api/office/config', () => {
  it("builds the Document Server's own script address, which the editor view accepts", () => {
    expect(classicApiUrl('https://docs.example.com/')).toBe('https://docs.example.com/web-apps/apps/api/documents/api.js');
    expect(documentServerOrigin('https://docs.example.com', classicApiUrl('https://docs.example.com'), { allowInsecureLocal: false })).toEqual({ origin: 'https://docs.example.com', apiUrl: 'https://docs.example.com/web-apps/apps/api/documents/api.js' });
    expect(documentServerOrigin('https://ex.com/ds/', classicApiUrl('https://ex.com/ds/'), { allowInsecureLocal: false })).not.toHaveProperty('error');
  });

  it('opens the signed configuration in the editor view inside the app', async () => {
    const config = { document: { title: 'Budget.xlsx', fileType: 'xlsx', key: 'k1', url: 'https://ws.example/office/file/t' }, editorConfig: { mode: 'edit' }, token: 'jwt' };
    vi.mocked(apiGet).mockResolvedValue({ ds_url: 'https://docs.example.com', config, editable: true });
    wrap(<ClassicEditor tabKey="t1" fileId={42} routeName={null} active />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('office:open', expect.objectContaining({ fileId: 42, documentServerUrl: 'https://docs.example.com', apiUrl: 'https://docs.example.com/web-apps/apps/api/documents/api.js', config })));
    expect(apiGet).toHaveBeenCalledWith('/api/office/config/42');
    const open = vi.mocked(call).mock.calls.find((c) => c[0] === 'office:open')![1] as { sessionId: string };
    expect(open.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('Budget.xlsx')).toBeTruthy();
  });

  it('says why when the server has no editor, and offers the installed app', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(503, 'Office editing is not configured', null));
    wrap(<ClassicEditor tabKey="t2" fileId={7} routeName="Plan.docx" active />);
    await waitFor(() => expect(screen.getByText(/not configured/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open in the installed app' })).toBeTruthy();
    expect(vi.mocked(call).mock.calls.some((c) => c[0] === 'office:open')).toBe(false);
  });
});
