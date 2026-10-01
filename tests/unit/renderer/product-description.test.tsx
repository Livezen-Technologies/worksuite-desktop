// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DescriptionEditor, DescriptionView } from '../../../src/components/DescriptionEditor';
import { cleanDescription, descriptionHtml, descriptionText } from '../../../src/core/description';
import ProductSheet from '../../../src/modules/inventory/ProductSheet';
import { bodyOf, draftOf } from '../../../src/modules/inventory/api';

const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), call: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGet: net.get, apiPost: net.post, apiPut: net.put, apiDelete: vi.fn(), request: vi.fn(), apiUrl: (s: string) => s }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/inventory/ProductPictures', () => ({ default: () => null, sendPictures: vi.fn() }));

beforeEach(() => {
  net.get.mockReset().mockImplementation((path: string) => Promise.resolve(path.includes('categories') ? { categories: [] } : path.includes('brands') ? { brands: [] } : { units: [] }));
  net.post.mockReset(); net.put.mockReset(); net.call.mockReset();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn((cmd: string, _: boolean, value: string) => {
    const box = screen.getByRole('textbox', { name: 'Description' });
    if (cmd === 'insertHTML') box.innerHTML += value;
    if (cmd === 'insertText') box.textContent = value;
    if (cmd === 'bold') box.innerHTML = `<b>${box.innerHTML}</b>`;
    return true;
  }) });
});
afterEach(cleanup);

function edit(value = '') {
  const change = vi.fn();
  render(<DescriptionEditor initial={value} onChange={change} />);
  return { box: screen.getByRole('textbox', { name: 'Description' }), change };
}
function product(id: number | null = null) {
  const close = vi.fn(); const saved = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ProductSheet id={id} org="1" companies={[]} canCost={false} onClose={close} onSaved={saved} onManageCategories={vi.fn()} />
  </QueryClientProvider>);
  return { close, saved };
}

describe('Product rich descriptions (#66)', () => {
  it('preserves legacy text, angle brackets, ampersands, line breaks and all three languages', () => {
    const text = 'English < 10 & 20\nසිංහල\nதமிழ்';
    const { box, change } = edit(text);
    expect(box.innerHTML).toBe('English &lt; 10 &amp; 20<br>සිංහල<br>தமிழ்');
    expect(descriptionText(text)).toBe(text);
    expect(change).not.toHaveBeenCalled();
  });
  it('keeps headings, formatting, lists and safe links but removes styles and active content', () => {
    const html = cleanDescription('<h1 style="color:red">Title</h1><p><b>B</b><i>I</i><u>U</u></p><ul><li>A</li></ul><ol><li>B</li></ol><a href="https://example.com" onclick="bad()">Link</a><a href="javascript:bad()">Bad</a><script>bad()</script><iframe src="bad"></iframe><img src="bad"><svg>bad</svg>');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<b>B</b><i>I</i><u>U</u>');
    expect(html).toContain('<ul><li>A</li></ul><ol><li>B</li></ol>');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/style=|onclick|javascript:|script|iframe|img|svg/);
  });
  it('sanitizes formatted paste and preserves plain text line breaks', () => {
    const { box, change } = edit();
    fireEvent.paste(box, { clipboardData: { getData: (type: string) => type === 'text/html' ? '<h2 style="color:red">Heading</h2><script>alert(1)</script>' : '' } });
    expect(change).toHaveBeenLastCalledWith('<h2>Heading</h2>');
    fireEvent.paste(box, { clipboardData: { getData: (type: string) => type === 'text/plain' ? 'සිංහල\nதமிழ்' : '' } });
    expect(change).toHaveBeenLastCalledWith('<h2>Heading</h2>සිංහල<br>தமிழ்');
  });
  it('provides labelled tools, keyboard formatting, undo/redo and expansion', () => {
    const { box, change } = edit('One');
    for (const name of ['Bold', 'Italic', 'Underline', 'Bullet list', 'Numbered list', 'Insert link', 'Undo', 'Redo', 'Clear formatting']) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'b', ctrlKey: true });
    expect(change).toHaveBeenLastCalledWith('<b>One</b>');
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    expect(box.innerHTML).toBe('One');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(box.innerHTML).toBe('<b>One</b>');
    fireEvent.click(screen.getByRole('button', { name: 'Clear formatting' }));
    expect(box.innerHTML).toBe('One');
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    expect(box.style.minHeight).toBe('360px');
  });
  it('rejects unsafe editor link addresses and preserves content during composition', () => {
    const { box, change } = edit('தமிழ்');
    fireEvent.keyDown(box, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByText('Add link'));
    expect(screen.getByRole('alert').textContent).toContain('https');
    fireEvent.keyDown(box, { key: 'b', ctrlKey: true, isComposing: true });
    expect(change).not.toHaveBeenCalled();
  });
  it('renders safe formatting and opens links externally', () => {
    render(<DescriptionView value={'<h2>Title</h2><ul><li>Item</li></ul><a href="https://example.com">Details</a><script>bad()</script>'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('Item');
    fireEvent.click(screen.getByRole('link', { name: 'Details' }));
    expect(net.call).toHaveBeenCalledWith('app:openExternal', { url: 'https://example.com' });
    expect(descriptionHtml('<img src=x onerror=bad()>')).toBe('');
  });
  it('provides portable plain text for integrations and cleans the save body', () => {
    const d = { ...draftOf(), name: 'Product', description: '<h2>Details</h2><p>සිංහල<br>தமிழ்</p><ul><li>One</li><li>Two</li></ul><script>bad()</script>' };
    expect(bodyOf(d, false).body.description).not.toContain('script');
    expect(bodyOf(d, false, 'text').body.description).toBe('Details\nසිංහල\nதமிழ்\nOne\nTwo');
  });
  it('retains a formatted draft on save failure and asks before discarding', async () => {
    net.post.mockRejectedValue(new Error('Save failed. Try again.'));
    const { close, saved } = product();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Product' } });
    const box = screen.getByRole('textbox', { name: 'Description' });
    box.innerHTML = '<h2>සිංහල</h2><p>தமிழ்</p>';
    fireEvent.input(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Save failed. Try again.');
    expect(net.post).toHaveBeenCalledWith('/api/inventory/products', expect.objectContaining({ name: 'Product', description: '<h2>සිංහල</h2><p>தமிழ்</p>' }));
    expect(box.innerHTML).toBe('<h2>සිංහල</h2><p>தமிழ்</p>');
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(box.innerHTML).toContain('தமிழ்');
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('reopens an existing formatted description and updates it only on Save', async () => {
    net.get.mockImplementation((path: string) => Promise.resolve(path.endsWith('/products/7') ? { product: { id: 7, name: 'Existing', description: '<h2>Details</h2><p>One<br>Two</p>', kind: 'product' } } : path.includes('categories') ? { categories: [] } : path.includes('brands') ? { brands: [] } : { units: [] }));
    net.put.mockResolvedValue({ product: { id: 7 } });
    const { saved } = product(7);
    const box = await screen.findByRole('textbox', { name: 'Description' });
    expect(box.innerHTML).toBe('<h2>Details</h2><p>One<br>Two</p>');
    expect(net.put).not.toHaveBeenCalled();
    box.innerHTML = '<h2>Updated</h2><ol><li>தமிழ்</li></ol>';
    fireEvent.input(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(7));
    expect(net.put).toHaveBeenCalledWith('/api/inventory/products/7', expect.objectContaining({ description: '<h2>Updated</h2><ol><li>தமிழ்</li></ol>' }));
  });
  it('closes an unchanged form without a discard warning', async () => {
    const { close } = product();
    await waitFor(() => expect(net.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).toBeNull();
  });
});
