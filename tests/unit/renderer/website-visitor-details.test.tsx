// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Edit details on the visitor card: name, email, phone and company, saved to the visitor and — unless untucked — to
 * their WorkSuite contact; a refused field says why beside it.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiPatch: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiPatch } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { VisitorDetailsDialog } from '../../../src/modules/chat/website/panelCards';
import type { WebsiteVisitor } from '../../../src/modules/chat/website/api';

const visitor = { id: 9, label: 'Visitor 9AC3', name: null, email: 'ravi@studio.lk', phone: null, company: null } as unknown as WebsiteVisitor;
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Edit details on the visitor card', () => {
  it('saves the four fields and the contact, and says which contact', async () => {
    vi.mocked(apiPatch).mockResolvedValue({ contact: { id: 41, name: 'Ravi Fernando', created: true } });
    const done = vi.fn();
    render(<VisitorDetailsDialog v={visitor} onClose={vi.fn()} onDone={done} />);
    expect(field('Email').value).toBe('ravi@studio.lk');
    fireEvent.change(field('Name'), { target: { value: 'Ravi Fernando' } });
    fireEvent.change(field('Phone number'), { target: { value: '077 123 4567' } });
    fireEvent.change(field('Company'), { target: { value: 'Studio LK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/api/chat/widget-admin/visitors/9', {
      name: 'Ravi Fernando', email: 'ravi@studio.lk', phone: '077 123 4567', company: 'Studio LK', save_contact: true,
    });
    expect(toast).toHaveBeenCalledWith('success', 'Saved as a new contact: Ravi Fernando.');
  });

  it('can leave Contacts alone, and shows a refused field beside it', async () => {
    vi.mocked(apiPatch).mockRejectedValue(new ApiError(422, "Check the visitor's details", null, { phone: 'Enter a valid phone number' }));
    render(<VisitorDetailsDialog v={visitor} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Also save to Contacts/ }));
    fireEvent.change(field('Phone number'), { target: { value: 'call me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid phone number')).toBeTruthy();
    expect(vi.mocked(apiPatch).mock.calls[0]![1]).not.toHaveProperty('save_contact');
  });
});
