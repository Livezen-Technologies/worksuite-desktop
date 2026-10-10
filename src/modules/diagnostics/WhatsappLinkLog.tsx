import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { timeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/** One link attempt as the server logs it (GET /api/whatsapp/link-attempts, worksuite-desktop#323). */
export interface LinkAttemptLog {
  id: number | null;
  account_id: number;
  account_name: string | null;
  state: 'starting' | 'waiting' | 'scanned' | 'connected' | 'failed' | 'cancelled';
  method: 'qr' | 'pairing';
  started_at: string | null;
  ended_at: string | null;
  elapsed_seconds: number;
  phone?: string | null;
  error: { code: string; title: string; message: string; detail: string | null } | null;
  events: Array<{ at: string; event: string; note: string | null }>;
}

const STATE_WORDS: Record<LinkAttemptLog['state'], string> = {
  starting: 'Starting',
  waiting: 'Waiting for scan',
  scanned: 'Scanned',
  connected: 'Connected',
  failed: 'Error',
  cancelled: 'Replaced',
};

const EVENT_WORDS: Record<string, string> = {
  start: 'Started',
  qr_shown: 'QR code shown',
  pairing_code: 'Pairing code shown',
  scanned: 'Scanned',
  connected: 'Connected',
  error: 'Error',
  cancelled: 'Replaced by a new attempt',
};

/** The tone of an attempt's badge: green connected, red failed, grey otherwise. */
export function attemptTone(state: LinkAttemptLog['state']): 'success' | 'danger' | 'muted' {
  return state === 'connected' ? 'success' : state === 'failed' ? 'danger' : 'muted';
}

/**
 * Help → Diagnostics: each attempt to link a WhatsApp Web number on the server — when it started, showed a code, was
 * scanned and connected, or the error that ended it with the server's reason. Shown to whoever may link numbers; for
 * anybody else (or a server without the log) the section is simply absent.
 */
export function WhatsappLinkLog() {
  const log = useQuery({
    queryKey: ['diagnostics', 'whatsapp-link-attempts'],
    queryFn: ({ signal }) => apiGet<{ attempts: LinkAttemptLog[]; logging?: boolean }>('/api/whatsapp/link-attempts', { limit: 30 }, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [open, setOpen] = useState<number | null>(null);
  if (log.isError || !log.data) return null;
  const attempts = log.data.attempts;

  return (
    <section aria-label="WhatsApp linking" className="mt-8 rounded-[12px] border border-line bg-surface p-5">
      <h2 className="text-[15px] font-bold text-ink">WhatsApp linking</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">Each attempt to link a WhatsApp Web number on the server: started, code shown, scanned, connected — or the error, with the server&apos;s reason.</p>
      {!attempts.length ? (
        <p className="mt-3 text-[12.5px] text-ink-3">{log.data.logging === false ? 'The server does not keep a linking log yet.' : 'No link attempts yet.'}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {attempts.map((a, i) => {
            const key = a.id ?? i;
            const tone = attemptTone(a.state);
            return (
              <li key={key} className="rounded-[8px] border border-line">
                <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[12.5px] hover:bg-subtle">
                  <Icon name={open === key ? 'chevron-down' : 'chevron-right'} size={14} className="shrink-0 text-ink-3" />
                  <b className="min-w-0 flex-1 truncate text-ink">{a.account_name ?? `Number ${a.account_id}`}{a.method === 'pairing' ? ' · pairing code' : ''}</b>
                  <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold', tone === 'success' ? 'bg-success-bg text-success' : tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-subtle text-ink-2')}>{STATE_WORDS[a.state] ?? a.state}</span>
                  <span className="shrink-0 text-ink-3">{a.started_at ? timeLabel(a.started_at) : ''} · {a.elapsed_seconds}s</span>
                </button>
                {open === key ? (
                  <div className="border-t border-line px-3 py-2 text-[12px] text-ink-2 selectable">
                    {a.error ? <p className="m-0 mb-1.5"><b className="text-danger">{a.error.title}.</b> {a.error.detail ?? ''}</p> : null}
                    <ol className="m-0 flex flex-col gap-0.5 p-0">
                      {a.events.map((e, j) => (
                        <li key={j} className="flex gap-2">
                          <span className="w-[72px] shrink-0 font-mono text-ink-3">{timeLabel(e.at)}</span>
                          <span>{EVENT_WORDS[e.event] ?? e.event}{e.note ? ` — ${e.note}` : ''}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
