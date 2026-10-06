// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsedProduct } from '../../../src/modules/salon/api';
import { DeskContext, type Desk } from '../../../src/modules/salon/parts';
import { RecordForm } from '../../../src/modules/salon/ServiceRecord';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const recipe: UsedProduct[] = [
  { product_id: 901, name: 'Koleston 6/1', unit: 'g', quantity: 40 },
  { product_id: 902, name: 'Welloxon 6% developer', unit: 'ml', quantity: 40 },
];

/** The record's POSTs, answered as WorkSuite would: a product naming an allergy is held back until confirmed. */
function server() {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      posts.push(body);
      const named = ((body.products as Array<{ product_id: number }> | undefined) ?? []).some((p) => p.product_id === 903);
      if (named && !body.confirm_allergy) {
        return new Response(JSON.stringify({ status: 'error', message: 'Ammonia colour names ammonia.', errors: { code: 'allergy_product', matches: [{ product: 'Ammonia colour', allergy: 'ammonia' }] } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: 'success', data: { record: null }, message: 'Record saved.' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return posts;
}

function form(over: Partial<Parameters<typeof RecordForm>[0]> = {}) {
  const desk = { may: () => true, desk: { id: 1 }, offline: false } as unknown as Desk;
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DeskContext.Provider value={desk}>
        <RecordForm appointmentId={5} record={null} last={null} planned={recipe} onSaved={onSaved} {...over} />
      </DeskContext.Provider>
    </QueryClientProvider>,
  );
  return onSaved;
}

describe('products used on the service record (REC-01, CHK-11)', () => {
  it('starts from the recipe, and does not send it until the stylist changes it', async () => {
    const posts = server();
    const onSaved = form();
    expect(screen.getByText('Koleston 6/1')).toBeTruthy();
    expect(screen.getByText(/From the recipe/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: '6/1 + 20 vol' } });
    fireEvent.click(screen.getByRole('button', { name: /Save to Client 360/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(posts[0]).toEqual({ formula: '6/1 + 20 vol', technique: '', timing: '' });
  });

  it('sends the whole list once written, leaving out what was not used', async () => {
    const posts = server();
    const onSaved = form();

    fireEvent.change(screen.getByLabelText('How much Welloxon 6% developer'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('How much Koleston 6/1'), { target: { value: '0' } });
    expect(screen.getByText(/Taken from the desk’s stock at checkout/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save to Client 360/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(posts[0]?.products).toEqual([{ product_id: 902, quantity: 60 }]);
  });

  it('asks before keeping a product that names one of the client’s allergies, then sends it confirmed', async () => {
    const posts = server();
    const onSaved = form({ record: { id: 3, formula: null, technique: null, timing: null, products: [{ product_id: 903, name: 'Ammonia colour', unit: 'g', quantity: 30 }] } });

    fireEvent.click(screen.getByRole('button', { name: /Save to Client 360/ }));
    await screen.findByText('On the client’s allergy list');
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /It was used — save/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({ products: [{ product_id: 903, quantity: 30 }], confirm_allergy: true });
  });

  it('fills in last time’s products with its formula', () => {
    server();
    form({ last: { formula: '6/1', technique: null, timing: null, products: [{ product_id: 904, name: 'Olaplex No.1', unit: 'ml', quantity: 5 }], at: null } });
    fireEvent.click(screen.getByRole('button', { name: /Same as last time/ }));
    expect(screen.getByText('Olaplex No.1')).toBeTruthy();
    expect(screen.queryByText('Koleston 6/1')).toBeNull();
  });
});
