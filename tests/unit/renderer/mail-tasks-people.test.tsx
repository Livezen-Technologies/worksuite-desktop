// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { setRegional } from '../../../src/core/time';
import { parseSignature } from '../../../src/modules/mail/AddContact';
import { meetingRoute, messageLink, taskDescription } from '../../../src/modules/mail/MessageTask';
import { runQuickStep, taskDueDay, type QuickStep, type Runner } from '../../../src/modules/mail/quickSteps';
import { RecipientField } from '../../../src/modules/mail/Recipients';
import { parseQuery } from '../../../src/modules/mail/SearchView';
import type { MessageRow } from '../../../src/modules/mail/types';

/**
 * ENH-MAIL-03 tasks and people: Create task from a message and from a Quick
 * Step (DMO-TSK-05), Copy to folder / Log in CRM / helpdesk ticket Quick
 * Step actions (DMO-QS-02), contact groups in To/Cc (DMO-PPL-02) and the
 * Mentioned me search (DMO-CMP-14).
 */

const row = (over: Partial<MessageRow> = {}): MessageRow => ({ id: 12, from_name: 'Pat <Silva>', from_email: 'Pat@Client.example', subject: 'BOQ & plan', preview: 'Please send the BOQ', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', ...over });
const step = (actions: QuickStep['actions']): QuickStep => ({ id: 1, name: 'S', icon: 'zap', shortcut: null, tooltip: null, actions, ask_fields: [], org: false, position: 0 });

beforeEach(() => {
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  app.set((s) => ({ ...s, auth: { ...(s.auth ?? {}), server: { origin: 'https://ws.example' } } as never }));
});
afterEach(() => cleanup());

describe('a task from a message (DMO-TSK-05)', () => {
  it('links back to the message and keeps the sender’s name as text', () => {
    const link = messageLink({ uid: '12', folder: 'label:Clients', mailbox: '4' });
    expect(link).toBe('https://ws.example/mail?msg=12&folder=label%3AClients&mailbox=4');
    const html = taskDescription(row(), link);
    expect(html).toContain('Pat &lt;Silva&gt; &lt;Pat@Client.example&gt;');
    expect(html).toContain(`<a href="${link.replace(/&/g, '&amp;')}">Open the email: BOQ &amp; plan</a>`);
    expect(taskDescription(row(), '')).not.toContain('<a');
  });

  it('works out the due day on the person’s calendar', () => {
    // 2026-10-07 is a Wednesday.
    expect(['today', 'tomorrow', 'week', 'next-week', 'none'].map((w) => taskDueDay(w, '2026-10-07'))).toEqual(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-16', null]);
  });
});

describe('Quick Step actions (DMO-QS-02, DMO-TSK-05)', () => {
  const runner = (crm: { leads?: unknown[]; accounts?: unknown[] } = {}) => {
    const posts: Array<[string, unknown]> = [];
    const r: Runner = {
      action: vi.fn(async () => 'done' as const),
      move: vi.fn(async () => 'done' as const),
      state: vi.fn(async () => 'done' as const),
      post: vi.fn(async (path: string, body: unknown) => (posts.push([path, body]), {})) as unknown as Runner['post'],
      get: vi.fn(async (path: string) => {
        if (path === '/api/crm/leads') return { leads: crm.leads ?? [] };
        if (path === '/api/crm/accounts') return { accounts: crm.accounts ?? [] };
        return { body_html: '<p>Please send the <b>BOQ</b></p>', attachments: [] };
      }) as unknown as Runner['get'],
    };
    return { r, posts };
  };
  const target = { row: row(), mailbox: '4', folder: 'inbox' };

  it('copies to a folder, and makes a task for someone on a list with the way back', async () => {
    const { r, posts } = runner();
    const report = await runQuickStep(step([{ type: 'copy', folder: 'label:Projects' }, { type: 'create_task', when: 'tomorrow', assignee_id: 7, list_id: 3 }]), [target], r);
    expect(report.failed).toBe(0);
    expect(posts[0]).toEqual(['/api/mail/folders-tree/copy', { from: 'inbox', to: 'Projects', uids: [12], mailbox: '4' }]);
    expect(posts[1]![0]).toBe('/api/tasks');
    expect(posts[1]![1]).toMatchObject({ title: 'BOQ & plan', assignee_id: 7, list_id: 3, due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), description: expect.stringContaining('https://ws.example/mail?msg=12') });
  });

  it('logs the email on the lead with exactly the sender’s address, else the account, else says so', async () => {
    const a = runner({ leads: [{ id: 5, email: 'pat@client.example.org' }, { id: 6, email: 'PAT@client.example' }] });
    await runQuickStep(step([{ type: 'create_crm_activity' }]), [target], a.r);
    expect(a.posts).toEqual([['/api/crm/leads/6/activity', { kind: 'email', title: 'Email: BOQ & plan', body: expect.stringContaining('Please send the BOQ') }]]);

    const b = runner({ leads: [], accounts: [{ id: 9, email: 'pat@client.example' }] });
    await runQuickStep(step([{ type: 'create_crm_activity' }]), [target], b.r);
    expect(b.posts[0]![0]).toBe('/api/crm/accounts/9/activity');

    const c = runner({ leads: [{ id: 5, email: 'someone@client.example' }] });
    const report = await runQuickStep(step([{ type: 'create_crm_activity' }, { type: 'archive' }]), [target], c.r);
    expect(c.posts).toEqual([]);
    expect(report.errors).toEqual(['BOQ & plan: No CRM lead or account has the address pat@client.example.']);
    expect(c.r.action).not.toHaveBeenCalled();
  });

  it('raises a helpdesk ticket from the sender with the message text', async () => {
    const { r, posts } = runner();
    await runQuickStep(step([{ type: 'create_ticket' }]), [target], r);
    expect(posts).toEqual([['/api/tickets', { subject: 'BOQ & plan', requester_name: 'Pat <Silva>', requester_email: 'Pat@Client.example', body: expect.stringMatching(/^Please send the BOQ[\s\S]*From the email: https:\/\/ws\.example\/mail\?msg=12/) }]]);
  });
});

describe('contact groups in To and Cc (DMO-PPL-02)', () => {
  it('offers your groups and the organisation’s lists; a group goes in as its members', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => {
      if (path === '/api/mail/autocomplete') return { suggestions: [] };
      if (path === '/api/contacts/lookup') {
        expect(String(params?.kinds)).toContain('group');
        return { results: [{ kind: 'group', id: 3, name: 'Site team', email: null, members: 2 }, { kind: 'group', id: 4, name: 'Empty', email: null, members: 0 }, { kind: 'list', id: 8, name: 'Sales', email: 'sales@livezen.lk', subtitle: 'Distribution list' }] };
      }
      if (path === '/api/contacts/expand') return { members: [{ name: 'Nimal', email: 'nimal@x.org' }, { name: 'Kamal', email: 'kamal@x.org' }] };
      throw new ApiError(404, path, null);
    }) as never);
    const names: Record<string, string> = {};
    let value = '';
    function Field() {
      const [v, setV] = useState('');
      value = v;
      return <RecipientField label="To" value={v} onChange={setV} names={names} onName={(e, n) => (names[e.toLowerCase()] = n)} />;
    }
    render(<Field />);
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'Si' } });
    const list = await screen.findByRole('listbox', { name: 'Suggestions' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Contact group · 2 people'), expect.stringContaining('sales@livezen.lk')]);
    fireEvent.click(within(options[0]!).getByRole('button'));
    await waitFor(() => expect(value).toBe('nimal@x.org, kamal@x.org'));
    expect(apiGet).toHaveBeenCalledWith('/api/contacts/expand', { kind: 'group', id: 3 });
    expect(names['kamal@x.org']).toBe('Kamal');
  });
});

describe('Mentioned me (DMO-CMP-14)', () => {
  it('is a search operator the index answers', () => {
    expect(parseQuery('is:mentioned BOQ')).toMatchObject({ mentioned: true, words: 'BOQ' });
    expect(parseQuery('BOQ').mentioned).toBe(false);
  });
});

describe('add sender to contacts from the signature (DMO-PPL-04)', () => {
  it('reads name, title, company, numbers and site under the sign-off, not from what is quoted', () => {
    const body = ['Hi Asha,', '', 'The BOQ is attached.', '', 'Best regards,', 'Pat Silva | Senior Quantity Surveyor', 'Silva Builders (Pvt) Ltd', 'M: +94 77 123 4567 | T: 011 234 5678', 'F: 011 234 9999', 'www.silvabuilders.lk', 'pat@silva.lk', '', 'On Mon, Asha wrote:', '> Kim Perera', '> M: +94 71 000 0000'].join('\n');
    expect(parseSignature(body, 'Pat Silva', 'pat@silva.lk')).toEqual({ name: 'Pat Silva', job_title: 'Senior Quantity Surveyor', company: 'Silva Builders (Pvt) Ltd', mobile: '+94 77 123 4567', office_phone: '011 234 5678', website: 'www.silvabuilders.lk' });
  });

  it('fills nothing it cannot read', () => {
    expect(parseSignature('Sounds good, see you then.', 'Kim', 'kim@x.org')).toEqual({ name: 'Kim', job_title: '', company: '', mobile: '', office_phone: '', website: '' });
    expect(parseSignature('Thanks,\nPat\n0771234567', null, 'p@x.org')).toMatchObject({ name: '', job_title: '', mobile: '0771234567' });
  });
});

describe('Reply with meeting (DMO-CAL-06)', () => {
  it('opens a new event with the thread’s subject and people, less this mailbox', () => {
    const route = meetingRoute({ subject: 'RE: Fwd: Site visit', from_email: 'Pat@Client.example', to: ['Me <me@livezen.lk>', 'kim@livezen.lk'], cc: ['pat@client.example'] }, 'ME@livezen.lk', 'https://ws.example/mail?msg=1');
    const q = new URLSearchParams(route.split('?')[1]);
    expect(route.startsWith('/calendar?')).toBe(true);
    expect(q.get('new')).toBe('1');
    expect(q.get('title')).toBe('Site visit');
    expect(q.get('people')).toBe('pat@client.example,kim@livezen.lk');
    expect(q.get('description')).toBe('About the email: https://ws.example/mail?msg=1');
  });
});
