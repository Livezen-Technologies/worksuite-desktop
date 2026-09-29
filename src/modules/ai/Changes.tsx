import { useState } from 'react';
import { cx } from '../../components/ui';
import { ActionCard } from './ActionCard';
import { usePending } from './assistant';

/**
 * Your AI changes (WS-AI-SRS-001 FR-CNF-06, DSK-5): what the assistant
 * proposed for you, in any window or on the web — waiting, or done and still
 * undoable. A notification about a waiting change opens this.
 */
export function Changes() {
  const [which, setWhich] = useState<'open' | 'recent'>('open');
  const q = usePending(which);
  const list = (q.data ?? []).filter((a) => a.status !== 'superseded');
  const tab = (w: 'open' | 'recent', label: string) => (
    <button type="button" role="tab" aria-selected={which === w} onClick={() => setWhich(w)}
      className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', which === w ? 'bg-subtle text-primary' : 'text-ink-3 hover:bg-subtle')}>
      {label}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" aria-label="Which changes" className="flex gap-1">
        {tab('open', 'Waiting for you')}
        {tab('recent', 'Recent')}
      </div>
      {q.isLoading ? <p className="text-[12.5px] text-ink-3">Loading…</p> : null}
      {q.isError ? <p className="text-[12.5px] text-danger">Your changes could not be loaded.</p> : null}
      {!q.isLoading && !q.isError && list.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">
          {which === 'open' ? 'Nothing is waiting. When the assistant proposes a change, it waits here until you decide.' : 'The assistant has not proposed any changes yet.'}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
        {list.map((a) => <ActionCard key={a.id} action={a} />)}
      </div>
    </div>
  );
}
