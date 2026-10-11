// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Remote support on the desktop (WS-MEET-ENH-01 RC10, RC11, RC17).
 *
 * The three things worth protecting, in order of how much it would cost to
 * get them wrong:
 *
 *  1. **AI assist's boundary.** The panel prints the server's own sentence
 *     about what assist reads, and the buttons exist only when the server says
 *     assist is enabled. Nothing here decides either.
 *  2. **A code is spent once.** It is asked for once per dialog, the countdown
 *     stops offering it the moment it expires, and the home code box redeems a
 *     support code only after the meeting lookup has said no such code.
 *  3. **The person being helped is not the agent.** The server strips the
 *     notes and the AI from their panel; the screen must not put them back.
 */

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { apiGet, apiPost, apiPut } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { SessionPanel } = await import('../../../src/modules/meet/support/SessionPanel');
const { SupportCodeDialog } = await import('../../../src/modules/meet/support/SupportCodeDialog');

const UUID = 'b5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a77';

const panel = (over: Record<string, unknown> = {}) => ({
  uuid: UUID,
  title: 'Support · printer',
  ticket: { id: 42, reference: 'TS-1042', subject: 'Printer will not print', priority: 'High', status: 'open' },
  agent: { id: 7, name: 'Hasarinda' },
  supported: { id: 9, name: 'Nadeesha' },
  reason: 'Printer stopped after the update',
  device: 'Nadeesha’s ThinkPad · Windows 11',
  started_at: '2026-10-11 10:00:00',
  ended_at: null,
  control: null,
  recording: 'Off',
  files: [],
  notes: 'Checked the queue.',
  outcome: null,
  ai: { enabled: true, assist: true, reads: 'AI assist reads this session’s chat and your notes only — never the screen, keystrokes or clipboard.' },
  is_agent: true,
  ...over,
});

const mount = (node: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset().mockResolvedValue(null as never);
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(toast).mockReset();
  app.set({ auth: { user: { id: 7, name: 'Hasarinda' }, server: { origin: 'https://app.worksuite.lk' } } } as never);
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(cleanup);

describe('the Session tab', () => {
  it('shows who is helped, the ticket, the computer and the reason', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    mount(<SessionPanel uuid={UUID} />);

    expect(await screen.findByText('Nadeesha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'TS-1042' })).toBeTruthy();
    expect(screen.getByText(/Printer will not print/)).toBeTruthy();
    expect(screen.getByText('Nadeesha’s ThinkPad · Windows 11')).toBeTruthy();
    expect(screen.getByText('Printer stopped after the update')).toBeTruthy();
  });

  it('says plainly that nobody is controlling the computer, before saying anything else', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    mount(<SessionPanel uuid={UUID} />);

    // A blank row would be read as a failure; this is the reassuring truth.
    expect(await screen.findByText(/Nobody is controlling this computer/)).toBeTruthy();
  });

  it('names what control was allowed, by whom, and the second factor', async () => {
    vi.mocked(apiGet).mockResolvedValue(
      panel({ control: { status: 'CONTROL_ACTIVE', caps_label: 'Mouse and keyboard', approved_at: '2026-10-11 10:05:00', approved_by: 'Nadeesha', mfa_passed: true, duration: '15 min' } }) as never,
    );
    mount(<SessionPanel uuid={UUID} />);

    expect(await screen.findByText(/Control is active\. Mouse and keyboard\. Allowed by Nadeesha\. Confirmed with a second factor\./)).toBeTruthy();
  });

  it('opens the ticket without closing the meeting window', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'TS-1042' }));

    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('windows:open', expect.objectContaining({ kind: 'support-quick', route: '/support/quick/42' })));
  });

  it('ends the session with an outcome, and says what ending it does', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    vi.mocked(apiPost).mockResolvedValue({ seconds: 1_320, outcome: 'resolved' } as never);
    mount(<SessionPanel uuid={UUID} />);

    expect(await screen.findByText(/Control ends and the meeting closes for everyone\. TS-1042 is told how it went\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));

    await waitFor(() => expect(vi.mocked(apiPost)).toHaveBeenCalledWith(`/api/meet/support/sessions/${UUID}/end`, { outcome: 'resolved' }));
    expect(vi.mocked(toast)).toHaveBeenCalledWith('success', 'Support session ended after 22 min.');
  });

  it('offers nothing to end, and no notes, to the person being helped', async () => {
    // The server has already removed the notes and the AI from their panel.
    vi.mocked(apiGet).mockResolvedValue(panel({ is_agent: false, notes: undefined, ai: undefined }) as never);
    mount(<SessionPanel uuid={UUID} />);

    expect(await screen.findByText(/Helped by Hasarinda/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Notes' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'AI assist' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Invite with a code/ })).toBeNull();
  });
});

describe('the agent’s notes', () => {
  it('save when the agent clicks away, and not before', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Notes' }));

    const box = screen.getByLabelText(/Your notes/);

    fireEvent.change(box, { target: { value: 'Reinstalled the driver.' } });
    expect(vi.mocked(apiPut)).not.toHaveBeenCalled();

    fireEvent.blur(box);
    await waitFor(() => expect(vi.mocked(apiPut)).toHaveBeenCalledWith(`/api/meet/support/sessions/${UUID}/notes`, { notes: 'Reinstalled the driver.' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
  });
});

describe('AI assist', () => {
  it('prints the server’s own sentence about what it reads', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI assist' }));

    // The server's words, not a paraphrase: one promise, said once.
    expect(screen.getByText(/never the screen, keystrokes or clipboard/)).toBeTruthy();
  });

  it('is absent entirely when the server has not enabled it', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel({ ai: { enabled: false, assist: false, reads: '' } }) as never);
    mount(<SessionPanel uuid={UUID} />);

    await screen.findByText('Nadeesha');
    expect(screen.queryByRole('tab', { name: 'AI assist' })).toBeNull();
  });

  it('offers a checklist only where the policy allows more than a summary', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel({ ai: { enabled: true, assist: false, reads: 'x' } }) as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI assist' }));

    expect(screen.getByRole('button', { name: /Summarise so far/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Draft checklist/ })).toBeNull();
  });

  it('shows a draft as a draft, and keeps nothing until asked', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel() as never);
    vi.mocked(apiPost).mockResolvedValue({ kind: 'summary', text: 'The printer stopped after the update.', items: [], draft: true } as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI assist' }));
    fireEvent.click(screen.getByRole('button', { name: /Summarise so far/ }));

    expect(await screen.findByText('Summary · draft')).toBeTruthy();
    // Drafting is the only request so far: nothing has been kept.
    expect(vi.mocked(apiPost).mock.calls.every(([path]) => !String(path).endsWith('/keep'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Copy to chat' }));
    await waitFor(() =>
      expect(vi.mocked(apiPost)).toHaveBeenCalledWith(`/api/meet/support/sessions/${UUID}/keep`, { target: 'chat', text: 'Summary\nThe printer stopped after the update.' }),
    );
  });

  it('ticking a step only writes it into the notes — the agent does the step', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel({ notes: '' }) as never);
    vi.mocked(apiPost).mockResolvedValue({ kind: 'checklist', text: '', items: ['Restart the spooler', 'Reinstall the driver'], draft: true } as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI assist' }));
    fireEvent.click(screen.getByRole('button', { name: /Draft checklist/ }));

    const list = await screen.findByText('Troubleshooting checklist · draft');

    expect(screen.getByText('You do each step yourself. Ticking only updates your notes.')).toBeTruthy();
    fireEvent.click(within(list.parentElement as HTMLElement).getByRole('checkbox', { name: /Restart the spooler/ }));

    await waitFor(() => expect(vi.mocked(apiPut)).toHaveBeenCalledWith(`/api/meet/support/sessions/${UUID}/notes`, { notes: '✓ Restart the spooler' }));
  });

  it('cannot add to a ticket when the session has none', async () => {
    vi.mocked(apiGet).mockResolvedValue(panel({ ticket: null }) as never);
    vi.mocked(apiPost).mockResolvedValue({ kind: 'summary', text: 'Something.', items: [], draft: true } as never);
    mount(<SessionPanel uuid={UUID} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI assist' }));
    fireEvent.click(screen.getByRole('button', { name: /Summarise so far/ }));
    await screen.findByText('Summary · draft');

    expect(screen.getByRole('button', { name: 'Add to ticket notes' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /Draft ticket note/ })).toBeNull();
  });
});

describe('the support code', () => {
  const code = { code: '847291663', display: '847 291 663', expires_in: 600, invite_url: 'https://app.worksuite.lk/meet/x' };

  it('asks for one code, shows it in threes with how long it has, and says it works once', async () => {
    vi.mocked(apiPost).mockResolvedValue(code as never);
    mount(<SupportCodeDialog uuid={UUID} agent="Hasarinda" onClose={() => undefined} />);

    expect(await screen.findByText('847 291 663')).toBeTruthy();
    // The countdown is split across nodes as it ticks, so the line is read whole.
    expect(screen.getByRole('status').textContent).toMatch(/Expires in (9:5\d|10:00) · works once/);
    expect(vi.mocked(apiPost).mock.calls.filter(([p]) => String(p).endsWith('/code'))).toHaveLength(1);
  });

  it('copies the code, the link to the web join page, and an invitation that says what it permits', async () => {
    vi.mocked(apiPost).mockResolvedValue(code as never);
    mount(<SupportCodeDialog uuid={UUID} agent="Hasarinda" onClose={() => undefined} />);
    await screen.findByText('847 291 663');

    fireEvent.click(screen.getByRole('button', { name: /Copy code/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('847 291 663'));

    fireEvent.click(screen.getByRole('button', { name: /Copy invite link/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app.worksuite.lk/support/join?code=847291663'));

    fireEvent.click(screen.getByRole('button', { name: /Copy invitation/ }));
    await waitFor(() => expect(vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0]).toMatch(/until you allow it/));
  });

  it('stops offering a code that has expired', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(apiPost).mockResolvedValue({ ...code, expires_in: 2 } as never);
      mount(<SupportCodeDialog uuid={UUID} agent="Hasarinda" onClose={() => undefined} />);
      await vi.waitFor(() => expect(screen.getByText('847 291 663')).toBeTruthy());
      await vi.advanceTimersByTimeAsync(3_000);

      // A code on screen is a code somebody reads out, so it is taken away.
      expect(screen.getByText('This code has expired.')).toBeTruthy();
      expect(screen.queryByText('847 291 663')).toBeNull();
      expect(screen.getByRole('button', { name: /Copy code/ }).hasAttribute('disabled')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what went wrong, with a way to try again', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('This support session has ended.'));
    mount(<SupportCodeDialog uuid={UUID} agent={null} onClose={() => undefined} />);

    expect(await screen.findByText('This support session has ended.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('the room a support session reduces to (RC-SUP-03)', () => {
  it('is what MeetRoom asks for, not a second list written here', async () => {
    // The filter is one function, shared with the tests above; what this
    // guards is that the room actually goes through it, and that the Session
    // tab is added for a support session and for nothing else.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${process.cwd()}/src/modules/meet/MeetRoom.tsx`, 'utf8');

    expect(src).toMatch(/const support = meet\.info\?\.session_kind === 'support'/);
    expect(src).toMatch(/support \? supportTabs\(tabs\) : tabs/);
    expect(src).toMatch(/tabs=\{roomTabs\(\[/);
    expect(src).toMatch(/\.\.\.\(support \? \[\{ id: 'Session'/);
  });
});
