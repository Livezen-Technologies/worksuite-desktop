import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { parseTs } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import type { MessageStates } from './states';
import type { MessageRef, MessageRow } from './types';

/**
 * Catch up (ENH-MAIL-03 DMO-AI-01): back after a while away (eight hours or
 * more since Mail was last in front of you), a short digest of what matters
 * — unread mail from VIPs, mail that @mentions you, and flagged mail due —
 * each one click from opening. It is worked out from what WorkSuite already
 * has; no AI reads the mail for it. Settings › Mail can turn it off.
 */

const SEEN = 'ws.mail.lastSeen';
export const AWAY_MS = 8 * 3_600_000;

function readSeen(): number | null {
  try {
    const v = Number(window.localStorage.getItem(SEEN));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeSeen(at: number): void {
  try {
    window.localStorage.setItem(SEEN, String(at));
  } catch {
    // Not remembered: the next start simply shows no digest.
  }
}

export interface CatchUpItem {
  kind: 'vip' | 'mention' | 'due';
  title: string;
  who: string;
  ref: MessageRef;
}

/** What matters since `since`: VIP mail and mentions still unread, and flags due by the end of today. */
export function catchUpDigest(since: number, rows: MessageRow[], vips: string[], states: MessageStates | null | undefined, mentions: MessageRow[], endOfToday: number): CatchUpItem[] {
  const vip = new Set(vips.map((v) => v.toLowerCase()));
  const after = (m: MessageRow) => parseTs(m.created_at).getTime() >= since;
  const refOf = (m: MessageRow): MessageRef => ({ uid: String(m.id), folder: m.folder_slug ?? 'inbox', mailbox: m.mailbox ? String(m.mailbox.id) : null });
  const out: CatchUpItem[] = [];
  const seen = new Set<string>();
  const add = (i: CatchUpItem) => {
    const k = `${i.ref.mailbox}:${i.ref.folder}:${i.ref.uid}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(i);
  };
  for (const m of rows) if (!m.is_read && after(m) && vip.has(m.from_email.toLowerCase())) add({ kind: 'vip', title: m.subject, who: m.from_name || m.from_email, ref: refOf(m) });
  for (const m of mentions) if (!m.is_read && after(m)) add({ kind: 'mention', title: m.subject, who: m.from_name || m.from_email, ref: refOf(m) });
  for (const f of Object.values(states?.flags ?? {})) {
    if (f.completed_at || !f.due_at) continue;
    if (parseTs(f.due_at).getTime() > endOfToday) continue;
    add({ kind: 'due', title: f.subject, who: f.from_name || f.from_email, ref: { uid: f.uid, folder: f.folder, mailbox: f.mailbox ? String(f.mailbox) : null } });
  }
  return out;
}

export function CatchUp({ enabled, rows, vips, states, onOpen }: { enabled: boolean; rows: MessageRow[]; vips: string[]; states: MessageStates | null | undefined; onOpen: (ref: MessageRef) => void }) {
  // Back from how long? Read once at start, and again whenever the window comes back after a long sleep.
  const [since, setSince] = useState<number | null>(() => {
    const last = readSeen();
    return last !== null && Date.now() - last >= AWAY_MS ? last : null;
  });
  useEffect(() => {
    const touch = () => {
      if (document.visibilityState !== 'visible') return;
      const last = readSeen();
      if (last !== null && Date.now() - last >= AWAY_MS) setSince(last);
      writeSeen(Date.now());
    };
    touch();
    const t = setInterval(touch, 60_000);
    document.addEventListener('visibilitychange', touch);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', touch);
    };
  }, []);
  const mentions = useQuery({
    queryKey: ['mail', 'catch-up', 'mentions', since],
    queryFn: async () => {
      try {
        return (await apiGet<{ messages?: MessageRow[] }>('/api/mail/search', { q: '', scope: 'all', mentioned: 1 })).messages ?? [];
      } catch {
        return [];
      }
    },
    enabled: enabled && since !== null,
    staleTime: 10 * 60_000,
  });
  if (!enabled || since === null) return null;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const items = catchUpDigest(since, rows, vips, states, mentions.data ?? [], end.getTime());
  if (!items.length) return null;
  const label = { vip: text('VIP'), mention: text('Mentioned you'), due: text('Flag due') };
  return (
    <section role="region" aria-label={text('Catch up')} className="shrink-0 border-b border-line bg-selection px-4 py-2.5 text-[13px] text-ink">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon name="sparkles" size={14} className="text-primary" />
        <b className="flex-1">{text('While you were away · {n}', { n: items.length })}</b>
        <Button size="sm" variant="ghost" onClick={() => setSince(null)}>
          Dismiss
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.slice(0, 6).map((i) => (
          <li key={`${i.kind}-${i.ref.mailbox}-${i.ref.folder}-${i.ref.uid}`}>
            <button type="button" onClick={() => onOpen(i.ref)} className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-surface">
              <span className="w-[104px] shrink-0 text-[11.5px] font-bold text-primary uppercase">{label[i.kind]}</span>
              <span className="min-w-0 flex-1 truncate">
                <b>{i.who}</b> · {i.title || text('(no subject)')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
