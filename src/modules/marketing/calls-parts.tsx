import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { text } from '../../core/i18n';
import { addDays, dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { withOrg } from './api';
import { OUTCOMES, type AgentLive, type CallCampaign, type CallScript, type CallStatus } from './calls';
import { btn, btnPrimary, Sheet, type PillTone } from './parts';
import type { MarketingList, Options, Pair, Segment } from './types';

/**
 * What the call screens share (WS-MKT-SRS-001 §16, W10/W11, D01): the campaigns, scripts and audience names they
 * read, the campaign's status in the design's tones, the ten outcomes in the server's words, a question before an act
 * that cannot be taken back, and click-to-call through the WorkSuite phone.
 *
 * Who may be called, who holds a contact and what an outcome does are the server's; these only show its answers.
 */

/** A call campaign's status in the design's five tones: calling green, paused amber, finished blue. */
export const CALL_PILL: Record<CallStatus, PillTone> = { draft: 'slate', active: 'green', paused: 'amber', completed: 'blue', cancelled: 'red' };

/** An agent's state on the supervisor's view (W10): on a call, wrapping up, or idle for so long. */
export function agentState(a: Pick<AgentLive, 'state' | 'idle_minutes'>): { tone: PillTone; label: string } {
  if (a.state === 'on_call') return { tone: 'green', label: 'On call' };
  if (a.state === 'wrap_up') return { tone: 'blue', label: 'Wrap-up' };
  return { tone: 'amber', label: a.idle_minutes === null ? 'Idle' : text('Idle {n} min', { n: a.idle_minutes }) };
}

/** The ten ways a call ends, as the server names them (`options.call_outcomes`), or the client's list on a server a part behind. */
export function outcomesOf(options: Options | undefined): Pair[] {
  const given = options?.call_outcomes;
  return given && given.length ? given : OUTCOMES.map((o) => ({ value: o.key, label: o.label }));
}

/** Call campaigns in the chosen companies: the list, the queue's campaign filter. */
export function useCallCampaigns(org: string, status = '') {
  return useQuery({
    queryKey: ['marketing', 'calls', 'campaigns', org, status],
    queryFn: ({ signal }) => apiGet<{ items: CallCampaign[] }>('/api/marketing/calls/campaigns', withOrg(org, { status }), signal),
    retry: false,
  });
}

/** Every script the reader may read, in every company (a campaign picks one of its own company's). */
export function useCallScripts(archived = false) {
  return useQuery({
    queryKey: ['marketing', 'calls', 'scripts', archived],
    queryFn: ({ signal }) => apiGet<{ items: CallScript[] }>('/api/marketing/calls/scripts', archived ? { archived: 1 } : undefined, signal),
    retry: false,
  });
}

/** One company's lists and segments by name: a campaign's audience is picked from them. */
export function useAudienceNames(orgId: number | null) {
  const org = orgId ? String(orgId) : '';
  const lists = useQuery({
    queryKey: ['marketing', 'calls', 'lists', org],
    queryFn: ({ signal }) => apiGet<{ items: MarketingList[] }>('/api/marketing/lists', withOrg(org), signal),
    enabled: !!org,
    retry: false,
  });
  // Uncounted: counting each segment is a query over every contact, and a picker needs none of it.
  const segments = useQuery({
    queryKey: ['marketing', 'calls', 'segments', org],
    queryFn: ({ signal }) => apiGet<{ items: Segment[] }>('/api/marketing/segments', withOrg(org, { brief: 1 }), signal),
    enabled: !!org,
    retry: false,
  });
  const of = (items: Array<{ id: number; name: string; org_id: number }> | undefined) => (items ?? []).filter((i) => i.org_id === orgId).map((i) => ({ id: i.id, name: i.name }));
  return { lists: of(lists.data?.items), segments: of(segments.data?.items), loading: lists.isLoading || segments.isLoading };
}

/** When a contact is due, the way the D01 list says it: "now", "14:00", "tomorrow 10:30", "8 Oct 09:00". */
export function dueLabel(stamp: string | null | undefined, now = new Date()): string {
  if (!stamp) return text('now');
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '—';
  return d.getTime() <= now.getTime() ? text('now') : atLabel(stamp);
}

/** A time the server gave, on the reader's clock: "14:00", "tomorrow 10:30", "yesterday 16:00", "8 Oct 2026 09:00". */
export function atLabel(stamp: string | null | undefined): string {
  if (!stamp) return '—';
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '—';
  const day = dayKey(d);
  const today = todayInZone();
  if (day === today) return timeLabel(stamp);
  if (day === addDays(today, 1)) return text('tomorrow {time}', { time: timeLabel(stamp) });
  if (day === addDays(today, -1)) return text('yesterday {time}', { time: timeLabel(stamp) });
  return `${dateLabel(stamp)} ${timeLabel(stamp)}`;
}

/** The digits a phone system dials: "+94 77 123 4567" → "+94771234567". */
export function dialDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^\d+]/g, '');
}

/**
 * Click-to-call (MKT-CAL-11): the WorkSuite phone rings the agent's extension, then the contact. Without a phone
 * system that answers, the number is copied to ring from another phone — as Website chat's call-backs do.
 */
export async function dial(phone: string | null | undefined): Promise<'phone' | 'copied' | null> {
  const number = dialDigits(phone);
  if (!number) {
    toast('error', text('There is no number to call.'));
    return null;
  }
  try {
    await apiPost('/api/voip/call', { number });
    toast('success', text('Calling {phone} on your WorkSuite phone', { phone: phone ?? number }));
    return 'phone';
  } catch {
    try {
      await navigator.clipboard.writeText(phone ?? number);
      toast('success', text('No WorkSuite phone connected — number copied'));
    } catch {
      toast('error', text('No WorkSuite phone connected — call {phone}', { phone: phone ?? number }));
    }
    return 'copied';
  }
}

export const btnDanger = 'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] bg-danger px-3.5 text-[13px] font-bold whitespace-nowrap text-white hover:opacity-90 disabled:opacity-50';

/** A question before an act that cannot be taken back: start calling, finish, never call again. */
export function ConfirmSheet({ title, body, action, danger, busy, onClose, onYes }: { title: string; body: ReactNode; action: string; danger?: boolean; busy?: boolean; onClose: () => void; onYes: () => void }) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={danger ? btnDanger : btnPrimary} onClick={onYes} disabled={busy} autoFocus>
            {action}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-ink-2">{body}</div>
    </Sheet>
  );
}

/** The small uppercase heading inside a card ("CALL · LISTS", "1. INTRODUCTION"). */
export function Caption({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{children}</div>;
}

/** A field's own error, read out with it. */
export function FieldError({ text: message }: { text: string | undefined }) {
  return message ? <span role="alert" className="text-[11.5px] font-medium text-danger">{message}</span> : null;
}

/**
 * The Next contact key from other apps, in the shell's grammar: the main process holds ⌘⇧N / Ctrl+Shift+N while no
 * WorkSuite window is in front (`electron/services/marketing-shortcut.ts`, NEXT_CONTACT_SHORTCUT — kept equal by a test).
 */
export const NEXT_CONTACT_GLOBAL = 'Mod+Shift+N';

/** The same act inside WorkSuite: the shell's command, with its own key (`core/commands.ts`). */
export const CLAIM_COMMAND = 'marketing-claim-next';
