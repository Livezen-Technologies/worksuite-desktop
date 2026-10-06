import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useApproveLeave, useCoverFirst, WaitingForCover } from '../hr/coverRule';
import { WaitingInvitations } from './WaitingInvitations';
import { facets, inOrgs, KINDS, type WaitingItem, type WaitingKind } from './waiting';

/**
 * The rows of Waiting for me (worksuite-desktop#263), on the Home card and on the page with all of them: what it is
 * in the title, the rest in the subtitle (both truncate; the tooltip has it all), and its quick actions as small
 * icon buttons, so a long name is never cut short by big ones. A row opens its own item. Approve on leave follows
 * the cover rule (hr/coverRule.tsx): it asks first while the cover has not accepted, and never fails with a toast.
 */
const LOOK: Record<WaitingKind, { icon: string; tone: string }> = {
  cover: { icon: 'users', tone: 'bg-warning-bg text-warning' },
  leave: { icon: 'calendar-clock', tone: 'bg-warning-bg text-warning' },
  timesheet: { icon: 'file-sheet', tone: 'bg-selection text-primary' },
  expense: { icon: 'wallet', tone: 'bg-success-bg text-success' },
  request: { icon: 'inbox', tone: 'bg-subtle text-ink-2' },
  resignation: { icon: 'file-text', tone: 'bg-subtle text-ink-2' },
  other: { icon: 'file-text', tone: 'bg-subtle text-ink-2' },
  invitation: { icon: 'calendar-check', tone: 'bg-selection text-primary' },
  announcement: { icon: 'megaphone', tone: 'bg-danger-bg text-danger' },
};

export function WaitingRows({ items, onOpen, onOpenLeave, label = 'Waiting for you' }: { items: WaitingItem[]; onOpen: (item: WaitingItem) => void; onOpenLeave: (id: number) => void; label?: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const approval = useApproveLeave({ onOpen: onOpenLeave });
  const run = async (it: WaitingItem, path: string, body: Record<string, unknown>, done: string) => {
    setBusy(it.key);
    try {
      await apiPost(path, body);
      toast('success', done);
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <ul className="m-0 flex list-none flex-col p-0" aria-label={label}>
        {items.map((it) => (
          <Row
            key={it.key}
            it={it}
            busy={busy === it.key || (it.kind === 'leave' && approval.busy === it.id)}
            onOpen={() => onOpen(it)}
            onApprove={() => void approval.approve(it.id)}
            onDecline={() => void run(it, `/api/hr/leave/requests/${it.id}/decide`, { decision: 'rejected' }, `Declined ${it.title}.`)}
            onCover={(answer) => void run(it, `/api/hr/leave/requests/${it.id}/cover`, { answer }, answer === 'accepted' ? 'You are covering it.' : 'You declined to cover it.')}
            onApproveSheet={() => void run(it, `/api/hr/timesheets/${it.id}/approve`, { note: '' }, 'Timesheet approved.')}
          />
        ))}
      </ul>
      {approval.dialog}
    </>
  );
}

function Row({ it, busy, onOpen, onApprove, onDecline, onCover, onApproveSheet }: { it: WaitingItem; busy: boolean; onOpen: () => void; onApprove: () => void; onDecline: () => void; onCover: (answer: 'accepted' | 'declined') => void; onApproveSheet: () => void }) {
  const look = LOOK[it.kind];
  const coverFirst = useCoverFirst(it.kind === 'leave' ? it.id : -1);
  return (
    <li className="flex items-center gap-2 border-t border-line py-2.5" data-waiting={it.key}>
      <button type="button" onClick={onOpen} title={it.detail} aria-label={`Open ${it.title}`} className="-ml-1 flex min-w-0 flex-1 items-center gap-3 rounded-[8px] py-0.5 pl-1 text-left hover:bg-subtle">
        <span aria-hidden="true" className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', look.tone)}>
          <Icon name={look.icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold text-ink">{it.title}</span>
          {it.subtitle ? <span className="truncate text-[12px] text-ink-3">{it.subtitle}</span> : null}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        {it.kind === 'leave' && it.decides ? (
          <>
            {coverFirst ? <WaitingForCover className="!h-7 !rounded-[7px] !px-2 !text-[11.5px]" /> : <Act icon="check" tip="Approve" label={`Approve ${it.title}`} good disabled={busy} onClick={onApprove} />}
            <Act icon="x" tip="Decline" label={`Decline ${it.title}`} disabled={busy} onClick={onDecline} />
          </>
        ) : it.kind === 'cover' ? (
          <>
            <Act icon="check" tip="Accept cover" label={`Accept cover: ${it.title}`} good disabled={busy} onClick={() => onCover('accepted')} />
            <Act icon="x" tip="Decline cover" label={`Decline cover: ${it.title}`} disabled={busy} onClick={() => onCover('declined')} />
          </>
        ) : it.kind === 'timesheet' ? (
          <Act icon="check" tip="Approve" label={`Approve ${it.title}`} good disabled={busy} onClick={onApproveSheet} />
        ) : (
          <Icon name="chevron-right" size={15} className="text-ink-3" />
        )}
      </span>
    </li>
  );
}

function Act({ icon, tip, label, good, disabled, onClick }: { icon: string; tip: string; label: string; good?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={tip}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-line bg-surface disabled:opacity-50',
        good ? 'text-success enabled:hover:border-success/40 enabled:hover:bg-success-bg' : 'text-danger enabled:hover:border-danger/40 enabled:hover:bg-danger-bg',
      )}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/**
 * Waiting for me, all of it (#263): every item from every app, filtered by kind and by organisation, each count the
 * length of the list it gives. Rows are the card's, with the same quick actions. HR's Leave › Waiting on me stays
 * as it is, for leave and HR's own approvals.
 */
export function WaitingPage({
  items,
  loading,
  error,
  onRetry,
  onBack,
  onOpen,
  onOpenLeave,
  canMeetings,
  onOpenLink,
  orgName,
}: {
  items: WaitingItem[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onBack: () => void;
  onOpen: (item: WaitingItem) => void;
  onOpenLeave: (id: number) => void;
  canMeetings: boolean;
  onOpenLink: (link: string) => void;
  orgName: (id: string) => string | null;
}) {
  const [kind, setKind] = useState<WaitingKind | ''>('');
  const [org, setOrg] = useState('');
  const f = facets(items, kind, org);
  // A filter whose items have all gone (answered, approved) lets go, rather than showing nothing.
  const k = kind && f.kinds.some((x) => x.id === kind) ? kind : '';
  const o = org && f.orgs.some((x) => x.id === org) ? org : '';
  const shown = items.filter((i) => (!k || i.kind === k) && inOrgs(i, o ? [o] : []));
  const groups = KINDS.map((g) => ({ ...g, items: shown.filter((i) => i.kind === g.id) })).filter((g) => g.items.length);
  const inOrg = items.filter((i) => inOrgs(i, o ? [o] : [])).length;
  const ofKind = items.filter((i) => !k || i.kind === k).length;
  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 scroll-thin">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[13px] font-medium text-primary hover:underline">
          <Icon name="chevron-left" size={14} />
          Home
        </button>
        <header className="flex flex-col gap-1">
          <h1 className="m-0 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">Waiting for me</h1>
          <p className="m-0 text-[13px] text-ink-3">Everything that needs you, from every app: approve, answer or open it here.</p>
        </header>
        {items.length ? (
          <div className="flex flex-col gap-2">
            <Filters label="Type">
              <Pill label="All" on={!k} n={inOrg} onClick={() => setKind('')} />
              {f.kinds.map((x) => (
                <Pill key={x.id} label={x.label} on={k === x.id} n={x.n} onClick={() => setKind(k === x.id ? '' : x.id)} />
              ))}
            </Filters>
            {f.orgs.length ? (
              <Filters label="Organisation">
                <Pill label="All organisations" on={!o} n={ofKind} onClick={() => setOrg('')} />
                {f.orgs.map((x) => (
                  <Pill key={x.id} label={x.name ?? orgName(x.id) ?? `Organisation ${x.id}`} on={o === x.id} n={x.n} onClick={() => setOrg(o === x.id ? '' : x.id)} />
                ))}
              </Filters>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <div aria-busy="true" aria-label="Loading Waiting for me" className="flex flex-col gap-2 py-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-4 animate-pulse rounded bg-subtle motion-reduce:animate-none" style={{ width: `${90 - i * 18}%` }} />
            ))}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="flex items-center gap-2 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
            <Icon name="alert" size={15} />
            <span className="min-w-0 flex-1">{error instanceof Error ? error.message : 'Part of this could not be loaded.'}</span>
            <button type="button" onClick={onRetry} className="font-semibold underline">
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !shown.length ? (
          <p className="m-0 flex items-center gap-2 py-2 text-[13px] text-ink-3">
            <Icon name="check-circle" size={15} /> {items.length ? 'Nothing here for these filters.' : 'Nothing waiting for you.'}
          </p>
        ) : null}
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label} className="rounded-[14px] border border-line bg-surface px-5 pt-4 pb-2">
            <h2 className="m-0 mb-1 flex items-center gap-2 text-[15px] font-semibold text-ink">
              {g.label}
              <span className="rounded-full bg-subtle px-2 py-px text-[11.5px] font-bold text-ink-2 tabular">{g.items.length}</span>
            </h2>
            {g.id === 'invitation' ? (
              <WaitingInvitations items={g.items.map((i) => i.invitation!).filter(Boolean)} canMeetings={canMeetings} onOpen={onOpenLink} limit={g.items.length} />
            ) : (
              <WaitingRows items={g.items} onOpen={onOpen} onOpenLeave={onOpenLeave} label={g.label} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Filters({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {children}
    </div>
  );
}

function Pill({ label, on, n, onClick }: { label: string; on: boolean; n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${label} (${n})`}
      onClick={onClick}
      className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold whitespace-nowrap', on ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
    >
      {label}
      <span className={cx('rounded-full px-1.5 text-[11px] font-bold tabular', on ? 'bg-primary text-white' : 'bg-subtle text-ink-2')}>{n}</span>
    </button>
  );
}
