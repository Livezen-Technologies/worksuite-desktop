import { describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn(async (_path: string, _query?: unknown, _signal?: unknown): Promise<unknown> => ({}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGet: (p: string, q?: unknown, s?: unknown) => apiGet(p, q, s) }));

import { searchProducts } from '../../../src/modules/pos/api';

/**
 * worksuite-desktop#296: while the till's copy is empty or still loading, and only then, the counter asks WorkSuite's
 * own search (`GET api/pos/products/search`) — the till's company, and the products as the grid reads them.
 */
describe('POS search on the server, while the copy loads', () => {
  it('asks for the till’s company and reads the products as the catalogue’s', async () => {
    apiGet.mockResolvedValueOnce({ items: [{ id: '9', code: 'TEA-1', barcode: '4790001', name: 'Ceylon tea', unit: 'pkt', category: 'Tea', price: '450', discount_pct: 0, tax_rate: 18, image_url: '/api/pos/products/9/image' }, { id: 'x', name: 'Not one' }] });
    const found = await searchProducts('cey', 3);
    expect(apiGet).toHaveBeenCalledWith('/api/pos/products/search', { q: 'cey', limit: 30, org: 3 }, undefined);
    expect(found).toEqual([{ id: 9, code: 'TEA-1', barcode: '4790001', name: 'Ceylon tea', unit: 'pkt', category: 'Tea', price: 450, discount_pct: 0, tax_rate: 18, image: true }]);
  });
});
