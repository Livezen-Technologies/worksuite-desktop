/**
 * W02 / D02 Create post — When (SMM-SCH-001/002/003/006, SMM-APR-002/007, WF-03, WF-17, AC-05): a time on the
 * viewer's clock (sent as UTC with the zone it was entered in), the queue, each account's best time, or now; the
 * primary action is Schedule, or Send for approval for a brand with a policy and for anyone who may not publish on
 * every chosen account. It stays disabled, saying why, while any check blocks.
 */
import { Button, cx } from '../../../components/ui';
import { dataOf, rowsOf, useBlackouts, useNextTimes, type Brand } from '../api';
import { currentZone, fromLocalInput, longWhen } from '../lib/time';
import { INPUT, Notice, Panel } from '../parts';
import type { ComposerDraft, WhenMode } from './state';

export type PrimaryKind = 'schedule' | 'now' | 'approval';

export function WhenCard({
  draft,
  accountIds,
  brand,
  canPublish,
  primary,
  blockedBy,
  busy,
  manualNetworks,
  onWhen,
  onMode,
  onPrimary,
  onQueue,
  onSaveDraft,
}: {
  draft: ComposerDraft;
  accountIds: number[];
  brand: Brand | null;
  canPublish: boolean;
  primary: PrimaryKind;
  blockedBy: string | null;
  busy: boolean;
  manualNetworks: string[];
  onWhen: (v: string) => void;
  onMode: (m: WhenMode) => void;
  onPrimary: () => void;
  onQueue: () => void;
  onSaveDraft: () => void;
}) {
  const zone = currentZone();
  const best = dataOf(useNextTimes(accountIds, 'best').data);
  const blackouts = rowsOf(useBlackouts().data);
  const at = draft.mode === 'at' && draft.when ? fromLocalInput(draft.when, zone) : null;
  const inBlackout = at ? blackouts.find((b) => (b.brand_id === null || b.brand_id === brand?.id) && Date.parse(b.starts_at) <= Date.parse(at) && Date.parse(at) < Date.parse(b.ends_at)) : undefined;
  const label = primary === 'approval' ? 'Send for approval' : primary === 'now' ? 'Publish now' : 'Schedule';
  const disabled = busy || !!blockedBy;
  return (
    <Panel title="When">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">Date and time</span>
          <input type="datetime-local" aria-label="Date and time" className={cx(INPUT, 'w-[220px]')} value={draft.when} disabled={draft.mode !== 'at'} onChange={(e) => onWhen(e.target.value)} />
        </label>
        <div className="flex min-w-0 flex-1 flex-col pb-1 text-[12px] text-ink-3">
          <span>
            {zone}
            {best?.window ? ` · each account's best time is ${best.window}` : ''}
          </span>
          {at ? <span>{longWhen(at, zone)}</span> : null}
          {draft.mode === 'best' ? <span className="font-semibold text-primary">Each account posts at its best time in the next 7 days.</span> : null}
          {draft.mode === 'now' ? <span className="font-semibold text-primary">Goes out as soon as you press Publish now.</span> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPublish ? (
          <>
            <Button variant="secondary" icon="list" disabled={disabled} onClick={onQueue} title={blockedBy ?? undefined}>
              Add to queue
            </Button>
            <Button variant={draft.mode === 'best' ? 'primary' : 'ghost'} aria-pressed={draft.mode === 'best'} icon="star" onClick={() => onMode(draft.mode === 'best' ? 'at' : 'best')}>
              Best time
            </Button>
            <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={draft.mode === 'now'} onChange={(e) => onMode(e.target.checked ? 'now' : 'at')} className="h-3.5 w-3.5 accent-[var(--ws-indigo)]" />
              Publish now
            </label>
          </>
        ) : (
          <Button variant="secondary" onClick={onSaveDraft} disabled={busy}>
            Save draft
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="primary" icon={primary === 'approval' ? 'send' : 'calendar-check'} disabled={disabled} title={blockedBy ?? undefined} onClick={onPrimary} loading={busy}>
          {label}
        </Button>
      </div>
      {blockedBy ? <p className="mt-2 text-right text-[12px] text-danger">{blockedBy}</p> : null}
      {inBlackout ? (
        <Notice tone="warning" icon="warning" className="mt-3">
          That time falls in a blackout{inBlackout.reason ? ` (${inBlackout.reason})` : ''}: the post is {inBlackout.mode === 'skip' ? 'skipped' : 'held until it ends'}.
        </Notice>
      ) : null}
      {manualNetworks.length ? (
        <Notice tone="info" icon="bell" className="mt-3">
          {manualNetworks.join(', ')}: the API can’t publish this kind of post, so it becomes a reminder to post it yourself at that time.
        </Notice>
      ) : null}
    </Panel>
  );
}
