import { useEffect, useState } from 'react';
import type { Transfer } from '@shared/types';
import { transferSections, transferSummary } from '@shared/transfers';
import { CONNECTION_LOST, STALLED, uploadPercent } from '@shared/uploads';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { closeOverlay } from '../../core/ui';
import { bytes, duration } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Empty, IconButton, cx } from '../../components/ui';
import { Popover, PopoverHeader } from './Popover';

/**
 * Transfer Center (FR-XFR-03, UI-12; worksuite-desktop#94): every module's
 * uploads and downloads in one queue — the ones moving now with progress,
 * speed and time left, the ones waiting with their place in the queue, and
 * what has finished or failed. Transfers run in the main process, so closing
 * this panel or switching apps never stops them.
 */
export function TransferCenter() {
  const transfers = useStore(app, (s) => s.transfers);
  const { active, queued, paused, finished } = transferSections(transfers);
  const waiting = [...queued, ...paused];
  const done = finished.slice(0, 30);
  const summary = transferSummary(transfers);
  const run = (ch: 'transfers:pauseAll' | 'transfers:resumeAll' | 'transfers:clearFinished') => void call(ch).catch((e) => toast('error', errorMessage(e)));
  return (
    <Popover label="Transfers" width={460} offset={112}>
      <PopoverHeader
        title="Transfers"
        action={
          <IconButton
            icon="settings"
            label="Drive settings"
            size={15}
            onClick={() => {
              closeOverlay();
              navigate('/files?view=settings');
            }}
          />
        }
      />
      {transfers.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2" data-transfer-toolbar>
          <span className="min-w-0 flex-1 text-[12px] font-semibold text-ink-2" data-transfer-summary>
            {summary ?? 'Nothing moving'}
          </span>
          {active.length || queued.length ? (
            <Button size="sm" variant="ghost" icon="pause" onClick={() => run('transfers:pauseAll')}>
              Pause all
            </Button>
          ) : null}
          {paused.length ? (
            <Button size="sm" variant="ghost" icon="play" onClick={() => run('transfers:resumeAll')}>
              Resume all
            </Button>
          ) : null}
          {finished.length ? (
            <Button size="sm" variant="ghost" onClick={() => run('transfers:clearFinished')}>
              Clear finished
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {transfers.length === 0 ? <Empty icon="transfers" title="No transfers" hint="Downloads and uploads from every app appear here." /> : null}
        {active.length ? <Group title="Active" items={active} /> : null}
        {waiting.length ? <Group title="Queued" items={waiting} /> : null}
        {done.length ? <Group title="Completed & failed" items={done} /> : null}
      </div>
    </Popover>
  );
}

function Group({ title, items }: { title: string; items: Transfer[] }) {
  return (
    <section aria-label={title}>
      <h3 className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        {title} <span className="font-semibold">{items.length}</span>
      </h3>
      {items.map((t) => (
        <TransferRow key={t.id} t={t} />
      ))}
    </section>
  );
}

/** Seconds until a waiting retry, kept current while it is shown. */
function useSecondsUntil(iso: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : null;
}

/** What a waiting transfer is waiting for: its turn, or the time it is tried again. */
export function waitingLine(t: Transfer, secondsLeft: number | null): string {
  if (t.state === 'paused') return t.error ? `Paused · ${t.error}` : `Paused · ${bytes(t.bytes)} of ${bytes(t.total)}`;
  // The connection went (or stalled): it carries on by itself from the last part the server has (#249).
  if (t.retryAt && (t.error === CONNECTION_LOST || t.error === STALLED)) return `${t.error}${secondsLeft ? ` · next try in ${duration(secondsLeft)}` : ''}`;
  if (t.retryAt) return `Trying again ${secondsLeft ? `in ${duration(secondsLeft)}` : 'now'} · try ${(t.attempts ?? 0) + 1}${t.error ? ` · ${t.error}` : ''}`;
  return t.position ? `Queued · #${t.position} in line` : 'Queued';
}

function TransferRow({ t }: { t: Transfer }) {
  const pct = uploadPercent(t.bytes, t.total);
  const eta = t.speed > 0 && t.total > 0 ? duration((t.total - t.bytes) / t.speed) : null;
  const left = useSecondsUntil(t.state === 'queued' ? t.retryAt : null);
  const act = (ch: 'transfers:pause' | 'transfers:resume' | 'transfers:cancel' | 'transfers:retry' | 'transfers:open' | 'transfers:reveal') => call(ch, { id: t.id }).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" data-transfer={t.state}>
      <Icon name={t.direction === 'upload' ? 'upload' : 'download'} size={17} className={t.direction === 'upload' ? 'text-primary' : 'text-teal'} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{t.name}</div>
        {t.state === 'running' ? (
          <>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-3">
              {pct}% · {bytes(t.bytes)} / {bytes(t.total)} · {bytes(t.speed)}/s{eta ? ` · ${eta} left` : ''}
            </div>
          </>
        ) : t.state === 'queued' || t.state === 'paused' ? (
          <div className={cx('truncate text-[11.5px]', t.retryAt ? 'text-warning' : 'text-ink-3')}>{waitingLine(t, left)}</div>
        ) : (
          <div className={cx('text-[11.5px]', t.state === 'failed' ? 'text-danger' : 'text-ink-3')}>
            {t.state === 'done' ? `${bytes(t.total)} · ${t.direction === 'upload' ? 'uploaded' : 'saved'}` : t.state === 'failed' ? `${t.bytes > 0 && t.total > 0 ? `Stopped at ${pct}% · ` : ''}${t.error ?? 'Failed'}` : 'Cancelled'}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5">
        {t.state === 'running' || t.state === 'queued' ? <IconButton icon="pause" label="Pause" size={15} onClick={() => void act('transfers:pause')} /> : null}
        {t.state === 'paused' ? <IconButton icon="play" label="Resume" size={15} onClick={() => void act('transfers:resume')} /> : null}
        {/* Retry carries on from the parts the server already has (#249): nothing is sent twice. */}
        {t.state === 'failed' ? <IconButton icon="refresh" label={t.bytes > 0 ? 'Retry — continues from where it stopped' : 'Retry'} size={15} onClick={() => void act('transfers:retry')} /> : null}
        {t.state === 'done' && t.direction === 'download' && !t.destination.startsWith('Kept in WorkSuite') ? (
          <>
            <IconButton icon="external" label="Open" size={15} onClick={() => void act('transfers:open')} />
            <IconButton icon="folder-open" label="Show in folder" size={15} onClick={() => void act('transfers:reveal')} />
          </>
        ) : null}
        {t.state === 'running' || t.state === 'paused' || t.state === 'queued' ? <IconButton icon="x" label="Cancel" size={15} onClick={() => void act('transfers:cancel')} /> : null}
      </div>
    </div>
  );
}
