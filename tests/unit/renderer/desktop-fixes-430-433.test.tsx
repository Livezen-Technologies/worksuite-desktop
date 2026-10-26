// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<object>()), call: vi.fn(async () => undefined), on: () => () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiPut: vi.fn(async () => ({ saved: true })) }));
vi.mock('../../../src/modules/account/regional', () => ({
  useRegional: () => ({ data: undefined }),
  useZones: () => ({ data: [] }),
  useSaveRegional: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { apiPut } from '../../../src/core/api';
import { CallAction } from '../../../src/modules/chat/kit/CallCard';
import { showStatus, ALL_TASKS } from '../../../src/modules/tasks/queries';
import { Details } from '../../../src/modules/account/General';
import type { MyProfile } from '../../../src/modules/account/api';
import type { Task } from '../../../src/modules/tasks/api';

afterEach(() => cleanup());
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('#431 the call card’s Call back', () => {
  it('is a filled button with the call’s icon, not pale text on pale green', () => {
    const onClick = vi.fn();
    render(<CallAction action="Call back" video={false} onClick={onClick} />);
    const b = screen.getByRole('button', { name: /Call back/ });
    expect(b.className).toContain('bg-primary');
    expect(b.className).toContain('text-white');
    expect(b.className).not.toContain('bg-success-bg');
    expect(b.querySelector('svg')).not.toBeNull();
    expect(b.title).toBe('Call back with a voice call');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('keeps Join green', () => {
    render(<CallAction action="Join" video onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: /Join/ }).className).toContain('bg-success');
  });
});

describe('#430 / #433 a task moved or completed stays where it was put', () => {
  const task = (id: number, status: Task['status']) => ({ id, title: `T${id}`, status }) as Task;
  it('stops a poll already on its way, so it cannot put the old status back', async () => {
    const qc = new QueryClient();
    qc.setQueryData(ALL_TASKS.queryKey, { data: { tasks: [task(1, 'todo'), task(2, 'todo')] } });
    qc.setQueryData(['tasks', 'shared'], { data: { tasks: [task(1, 'todo')] } });
    // A poll that started before the click and answers after it, with the old status.
    let answer: (v: unknown) => void = () => undefined;
    const stale = qc.fetchQuery({ queryKey: ALL_TASKS.queryKey, queryFn: () => new Promise((r) => (answer = r)), staleTime: 0 });
    await showStatus(qc, [1], 'done');
    answer({ data: { tasks: [task(1, 'todo'), task(2, 'todo')] } });
    await stale.catch(() => undefined);
    const all = qc.getQueryData<{ data: { tasks: Task[] } }>(ALL_TASKS.queryKey)!;
    expect(all.data.tasks.map((t) => t.status)).toEqual(['done', 'todo']);
    expect(qc.getQueryData<{ data: { tasks: Task[] } }>(['tasks', 'shared'])!.data.tasks[0]!.status).toBe('done');
  });
});

describe('#432 an additional display name', () => {
  const base: MyProfile = { id: 1, name: 'Kasun Perera', phone: null, email: 'k@x.lk', avatar: null, timezone: null, department: null, designation: null, company: null };
  it('saves the preferred name beside the name, which is left as it is', async () => {
    wrap(<Details p={{ ...base, preferred_name: null, editable: ['name', 'preferred_name', 'phone'] }} />);
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: ' Kas ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/users/me/profile', { name: 'Kasun Perera', preferred_name: 'Kas', phone: '' }));
  });
  it('is not offered by an older server', () => {
    wrap(<Details p={{ ...base, editable: ['name', 'phone'] }} />);
    expect(screen.queryByLabelText('Preferred name')).toBeNull();
  });
});
