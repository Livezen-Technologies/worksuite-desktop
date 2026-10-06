import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Present } from '@shared/support';
import { text } from '../../core/i18n';
import { Avatar, cx } from '../../components/ui';
import { K, here, presence } from './api';

/**
 * Who else is on a ticket (FR-COM-11, the collision bar: "Nimal is viewing", "Nimal is typing a note…"), so two
 * agents do not answer the same customer at once.
 *
 * While a ticket is in front of somebody this says so — on opening it, every 30 seconds while it stays open, when
 * they start and stop typing (a reply or a note), and `left` when it closes — and shows who else the server says is
 * there. The others hear of it from the server's `support.presence` hints (live.ts); a heartbeat that changes
 * nothing tells nobody. Typing a note shows as viewing to anybody who may not read notes: the server decides that.
 */
export const HEARTBEAT_MS = 30_000;

export function useTicketPresence(ticketId: number | null, opts: { here: boolean; typing: 'reply' | 'note' | null }): Present[] {
  const qc = useQueryClient();
  const enabled = ticketId !== null && ticketId > 0;
  // The server forgets a person not confirmed for a minute: ask again at that pace too, in case a hint was missed.
  const q = useQuery({ queryKey: K.presence(ticketId ?? 0), queryFn: () => presence(ticketId!), enabled, refetchInterval: 60_000, staleTime: 15_000 });
  const typing = useRef(opts.typing);
  const said = useRef<string | null>(null);

  // Here: on opening, every 30 s, and left on closing.
  useEffect(() => {
    if (!enabled || !opts.here) return;
    const id = ticketId!;
    let stopped = false;
    const beat = () => {
      const now = typing.current;
      said.current = now ?? 'viewing';
      void here(id, now ? 'typing' : 'viewing', now ?? undefined).then(
        (present) => {
          if (!stopped) qc.setQueryData(K.presence(id), present);
        },
        () => undefined,
      );
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      said.current = null;
      void here(id, 'left').catch(() => undefined);
    };
  }, [enabled, ticketId, opts.here, qc]);

  // Typing started or stopped (or changed from a reply to a note): said at once, not at the next beat.
  useEffect(() => {
    typing.current = opts.typing;
    if (!enabled || !opts.here || said.current === null) return;
    const now = opts.typing ?? 'viewing';
    if (said.current === now) return;
    said.current = now;
    const id = ticketId!;
    void here(id, opts.typing ? 'typing' : 'viewing', opts.typing ?? undefined).then((present) => qc.setQueryData(K.presence(id), present), () => undefined);
  }, [opts.typing, enabled, opts.here, ticketId, qc]);

  return q.data ?? [];
}

/** "Nimal is viewing", "Nimal is typing a note…", "Nimal and 2 others are viewing". */
export function presenceWords(present: Present[]): string | null {
  if (!present.length) return null;
  const typer = present.find((p) => p.state === 'typing');
  const first = (p: Present) => p.name.trim().split(/\s+/)[0] || text('Someone');
  if (typer) {
    const what = typer.mode === 'note' ? text('a note') : typer.mode === 'reply' ? text('a reply') : null;
    return what ? text('{name} is typing {what}…', { name: first(typer), what }) : text('{name} is typing…', { name: first(typer) });
  }
  if (present.length === 1) return text('{name} is viewing', { name: first(present[0]!) });
  return text('{name} and {count} more are viewing', { name: first(present[0]!), count: present.length - 1 });
}

/** The collision bar: who else is here, warning before two agents reply. Nothing when nobody is. */
export function Collision({ present, className }: { present: Present[]; className?: string }) {
  const words = presenceWords(present);
  if (!words) return null;
  const typing = present.some((p) => p.state === 'typing');
  return (
    <span role="status" className={cx('inline-flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-[12px] font-semibold', typing ? 'bg-warning-bg text-warning-ink' : 'bg-subtle text-ink-2', className)}>
      <span className="flex -space-x-1.5">
        {present.slice(0, 3).map((p) => (
          <Avatar key={p.user_id} name={p.name} size={20} className="ring-2 ring-surface" />
        ))}
      </span>
      <span className="truncate">{words}</span>
    </span>
  );
}
