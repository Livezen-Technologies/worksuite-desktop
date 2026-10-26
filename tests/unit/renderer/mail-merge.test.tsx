// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));

import { apiGet } from '../../../src/core/api';
import { MailMerge, fillMerge, missingTokens, parseMergeList } from '../../../src/modules/mail/MailMerge';

/** Mail merge (ENH-MAIL-03 DMO-CMP-18). */

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/contact-groups') return [{ id: 3, name: 'Clients', count: 2 }];
    if (path === '/api/contacts/expand') return { members: [{ name: 'Pat Silva', email: 'Pat@client.lk' }, { name: null, email: 'kim@x.org' }, { name: 'Bad', email: 'not-an-address' }] };
    throw new Error(path);
  }) as never);
});
afterEach(() => cleanup());

describe('the list and the tokens', () => {
  it('reads a pasted list with a header, skipping bad and repeated addresses', () => {
    const r = parseMergeList('Email, Name, Company\npat@client.lk, Pat Silva, Silva Builders\nPAT@client.lk, Again, X\nnope, No, Y\n"kim@x.org";"Kim";"K Ltd"');
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([
      { email: 'pat@client.lk', name: 'Pat Silva', first_name: 'Pat', company: 'Silva Builders' },
      { email: 'kim@x.org', name: 'Kim', first_name: 'Kim', company: 'K Ltd' },
    ]);
    expect(parseMergeList('name\nPat').error).toBe('The header line needs an “email” column.');
  });

  it('fills tokens, escaping them in HTML, and leaves unknown ones as written', () => {
    const row = { email: 'a@b.lk', name: '<Pat>', first_name: 'Pat' };
    expect(fillMerge('Hi {{ first_name }}, {{name}} {{unknown}}', row, false)).toBe('Hi Pat, <Pat> {{unknown}}');
    expect(fillMerge('<p>{{name}}</p>', row, true)).toBe('<p>&lt;Pat&gt;</p>');
    expect(missingTokens(['Hi {{first_name}} at {{company}}'], [{ email: 'a@b.lk', first_name: 'A', company: 'X' }, { email: 'c@d.lk', first_name: '' }])).toEqual(['first_name', 'company']);
  });
});

describe('sending', () => {
  it('previews each person and sends them one at a time, saying what failed', async () => {
    const sendOne = vi.fn(async (row: { email: string }, _m: { subject: string; html: string; text: string }) => {
      if (row.email === 'kim@x.org') throw new Error('Mailbox full');
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MailMerge message={{ subject: 'Offer for {{first_name}}', html: '<p>Dear {{name}}</p>', text: 'Dear {{name}}' }} onSendOne={sendOne} onClose={vi.fn()} pauseMs={0} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/contact-groups'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Contact group' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Clients (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText('Preview for pat@client.lk (1 of 2)')).toBeTruthy();
    expect(screen.getByText('Offer for Pat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Offer for')).toBeTruthy();
    expect(screen.getByText(/Some people have no value for: \{\{first_name\}\}, \{\{name\}\}/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 separate messages' }));
    // "1 of 2 sent." is on screen as soon as the first one has gone, before the pause and the second (failing) send:
    // waiting for it raced the rest of the run. The run is over when the second one's failure is shown.
    expect(await screen.findByText('kim@x.org: Mailbox full')).toBeTruthy();
    expect(screen.getByText('1 of 2 sent.')).toBeTruthy();
    expect(sendOne.mock.calls.map(([r, m]) => [r.email, m.subject, m.html])).toEqual([
      ['pat@client.lk', 'Offer for Pat', '<p>Dear Pat Silva</p>'],
      ['kim@x.org', 'Offer for ', '<p>Dear </p>'],
    ]);
  });
});
