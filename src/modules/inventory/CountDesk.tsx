import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { useWedge } from '../../core/scanner';
import { useStore } from '../../core/store';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Sheet } from '../../components/PageKit';
import { num, qty, signed } from './api';
import { countAct, countKind, KC, lookupProducts, saveCountLines, type CountDetail } from './control';
import { countedNow, countReducer, newSession, queueLabel, savedWords, unsent, varianceOf, waiting, type CountEvent, type CountSession } from './countSync';
import { countSheetHtml } from './labels';
import { Signed } from '../../components/ListKit';

/**
 * A count sheet being counted, on the desktop (the "Desktop offline count" design): one box takes every scan — each
 * adds one to its line — and a typed number sets a line. It keeps working offline from this computer's copy; what was
 * counted is kept here at once and goes to WorkSuite through the app's offline queue, line by line saying where it is.
 * Posting the differences to stock waits for the connection (countSync.ts has the rules).
 */
const PENDING = ['offline', 'pending'] as const;
const SEND_AFTER_MS = 1200;

export default function CountDesk({ id, detail, currency, onBack, onOpenAdjustment }: { id: number; detail: CountDetail; currency: string | null; onBack: () => void; onOpenAdjustment: (id: number) => void }) {
  const qc = useQueryClient();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const draft = useDraft<CountSession>('inventory', `count:${id}`, newSession(id));
  const s = draft.value.countId === id ? draft.value : newSession(id);
  const ref = useRef(s);
  useEffect(() => {
    ref.current = s;
  });
  const dispatch = useCallback(
    (e: CountEvent) => {
      const next = countReducer(ref.current, e);
      if (next === ref.current) return;
      ref.current = next;
      draft.setValue(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.setValue],
  );
  const c = detail.count;
  const lines = detail.lines;
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const submittedAt = useRef(0);

  const pending = useQuery({
    queryKey: PENDING,
    queryFn: () => call('offline:pending'),
    refetchInterval: offline || Object.values(s.lines).some((l) => l.state === 'queued') ? 4_000 : 30_000,
  });
  const queue = (pending.data ?? []).filter((m: OfflineMutation) => m.module === 'inventory');
  const mine = queue.filter((m) => m.entity === 'count' && m.entityId === String(id));

  // Send what was counted here: at once when WorkSuite answers, into the queue when it does not.
  const flush = useCallback(
    async (retryFailed = false) => {
      const out = unsent(ref.current, retryFailed);
      if (!out.length || sending.current) return;
      sending.current = true;
      const sent = Object.fromEntries(out.map((l) => [String(l.id), l.counted_qty]));
      const at = new Date().toISOString();
      try {
        const r = await call('offline:submit', {
          module: 'inventory',
          entity: 'count',
          entityId: String(id),
          label: queueLabel(c.reference, out.length),
          method: 'PUT',
          path: `/api/inventory/counts/${id}/lines`,
          body: { lines: out },
          queueIfOffline: true,
        });
        if (r.delivered) dispatch({ type: 'submitted', sent, outcome: 'sent', at });
        else if (r.queued) dispatch({ type: 'submitted', sent, outcome: 'queued', at });
        else {
          dispatch({ type: 'submitted', sent, outcome: 'failed', at });
          dispatch({ type: 'message', ok: false, text: r.error ?? 'WorkSuite did not take the counts.' });
        }
      } catch (e) {
        dispatch({ type: 'submitted', sent, outcome: 'failed', at });
        dispatch({ type: 'message', ok: false, text: errorMessage(e) });
      } finally {
        sending.current = false;
        submittedAt.current = Date.now();
        void qc.invalidateQueries({ queryKey: PENDING });
      }
    },
    [c.reference, dispatch, id, qc],
  );
  const toSend = unsent(s).length;
  useEffect(() => {
    if (!toSend || !draft.loaded) return;
    const t = setTimeout(() => void flush(), SEND_AFTER_MS);
    return () => clearTimeout(t);
  }, [toSend, s, flush, draft.loaded]);

  // The queue delivered (or someone changed the same count online): the lines say so.
  const queued = Object.values(s.lines).some((l) => l.state === 'queued');
  useEffect(() => {
    if (!queued || !pending.data || pending.dataUpdatedAt <= submittedAt.current) return;
    if (mine.some((m) => m.state === 'CONFLICT' || m.state === 'FAILED')) dispatch({ type: 'conflict' });
    else if (!mine.some((m) => m.state === 'PENDING' || m.state === 'SYNCING')) {
      dispatch({ type: 'synced', at: new Date().toISOString() });
      toast('success', `${c.reference} — the counts kept on this computer reached WorkSuite.`);
      void qc.invalidateQueries({ queryKey: KC.count(id) });
    }
  }, [queued, pending.data, pending.dataUpdatedAt, mine, dispatch, c.reference, qc, id]);

  const scan = async (raw: string) => {
    const text = raw.trim();
    setCode('');
    if (!text || !draft.loaded) return;
    const before = ref.current;
    dispatch({ type: 'scan', code: text, lines, reference: c.reference });
    if (ref.current.last !== before.last || ref.current.lines !== before.lines || offline) return;
    // Not a code on the sheet: WorkSuite may know it as a product's barcode. Learn it, so it scans offline too.
    try {
      const t = text.toLowerCase();
      const known = (await lookupProducts('', text, null)).filter((p) => [p.code, p.barcode].some((x) => x && x.toLowerCase() === t));
      const found = known.find((p) => lines.some((l) => Number(l.product_id) === Number(p.id)));
      if (!found) {
        if (known[0]) dispatch({ type: 'message', ok: false, text: `${known[0].name} is not on ${c.reference}. Nothing was counted.` });
        return;
      }
      dispatch({ type: 'learn', code: text, productId: Number(found.id) });
      dispatch({ type: 'scan', code: text, lines, reference: c.reference });
    } catch {
      /* the refusal already says it */
    }
  };
  useWedge((code) => void scan(code), !confirm);
  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const sync = () => {
    void flush(true);
    void call('offline:replay')
      .then(() => qc.invalidateQueries({ queryKey: PENDING }))
      .catch((e: unknown) => toast('error', errorMessage(e)));
  };
  const print = () => {
    const html = countSheetHtml(
      { reference: c.reference, warehouse: c.warehouse, note: countKind(c.kind) },
      lines.map((l) => ({ name: `${l.name}${l.variant_label ? ` — ${l.variant_label}` : ''}`, code: l.code, bin: l.bin, expected: qty(l.expected_qty) })),
    );
    void call('print:print', { html, title: c.reference }).catch((e) => toast('error', errorMessage(e)));
  };
  const post = async () => {
    setBusy(true);
    try {
      // Anything counted here goes first, straight to WorkSuite.
      const out = unsent(ref.current, true);
      if (out.length) {
        await saveCountLines(id, out);
        dispatch({ type: 'submitted', sent: Object.fromEntries(out.map((l) => [String(l.id), l.counted_qty])), outcome: 'sent', at: new Date().toISOString() });
      }
      const r = await countAct(id, 'post');
      toast('success', `${c.reference} posted to stock`);
      await draft.clear();
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      if (r.adjustment_id) onOpenAdjustment(r.adjustment_id);
      else onBack();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const counted = lines.filter((l) => countedNow(s, l) !== null).length;
  const unsentHere = waiting(s);
  const postBlock = offline ? 'Post to stock (needs connection)' : mine.length ? 'Post to stock (sending counts…)' : null;
  const seesCost = lines.some((l) => l.unit_cost !== null);
  const waitingCount = queue.length + (toSend ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {offline ? (
        <div role="status" className="shrink-0 border-b border-line bg-warning-bg px-6 py-2 text-[13px] text-warning-ink">
          <b>You're offline.</b> Counting keeps working from this computer's copy. Your counts send automatically when the connection is back — nothing is posted to stock until then.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-5 scroll-thin">
          <div className="flex items-center gap-2.5">
            <button type="button" className={btnSmall} onClick={onBack} aria-label="Back to stock counts">
              ← Counts
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[18px] text-ink">{[c.reference, countKind(c.kind), c.warehouse].filter(Boolean).join(' · ')}</b>
              <span className="truncate text-[12.5px] text-ink-3">
                {[c.scope === 'all' ? 'Everything in the warehouse' : `By ${c.scope}`, c.started_at ? `expected frozen ${dateLabel(c.started_at)} ${timeLabel(c.started_at)}` : null, `${counted} of ${lines.length} counted`].filter(Boolean).join(' · ')}
              </span>
            </div>
            <button type="button" className={btn} onClick={print}>
              Print sheet
            </button>
            <button type="button" className={btnPrimary} disabled={!!postBlock || busy || counted === 0} title={postBlock ?? undefined} onClick={() => setConfirm(true)}>
              {postBlock ?? 'Post to stock'}
            </button>
          </div>

          <div className="flex min-h-[60px] items-center gap-3.5 rounded-[12px] bg-primary px-[18px] py-2 text-white dark:bg-ground">
            <label htmlFor="count-scan" className="text-[14px] font-bold">
              Scan
            </label>
            <input
              id="count-scan"
              ref={scanRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void scan(code);
                }
              }}
              aria-describedby="count-scan-hint"
              placeholder="Scan a product"
              autoComplete="off"
              spellCheck={false}
              disabled={!draft.loaded}
              className="h-9 w-[260px] rounded-[8px] border border-white/20 bg-white/10 px-3 font-mono text-[14px] text-white outline-none placeholder:text-ink-4 focus:border-indigo-bright"
            />
            <div className="flex min-w-0 flex-1 flex-col" role="status" aria-live="polite">
              <span className={cx('truncate text-[14px] font-semibold', s.message && !s.message.ok && 'text-stage-danger')}>{s.message?.text ?? 'Ready for a scan.'}</span>
              <span id="count-scan-hint" className="text-[12.5px] text-stage-gray-ink">
                Each scan adds 1 · type a number to set the count
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-ground text-left text-[12px] font-semibold text-ink-3">
                  <th className="border-b border-line px-3 py-2">Product</th>
                  <th className="border-b border-line px-3 py-2">Bin</th>
                  <th className="border-b border-line px-3 py-2 text-right">Expected</th>
                  <th className="w-[110px] border-b border-line px-3 py-2 text-right">Counted</th>
                  <th className="border-b border-line px-3 py-2 text-right">Variance</th>
                  {seesCost ? <th className="border-b border-line px-3 py-2 text-right">Value</th> : null}
                  <th className="border-b border-line px-3 py-2">Saved</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const now = countedNow(s, l);
                  const v = varianceOf(now, l.expected_qty);
                  const val = v === null || l.unit_cost === null ? null : v * (num(l.unit_cost) ?? 0);
                  const mineLine = s.lines[String(l.id)];
                  const just = s.last === l.id;
                  return (
                    <tr key={l.id} data-count-line={l.code ?? l.id} className={cx('border-b border-line/60 last:border-b-0', just && 'bg-info-soft dark:bg-selection/40')}>
                      <td className="px-3 py-2">
                        <b className="text-ink">
                          {l.name}
                          {l.variant_label ? ` — ${l.variant_label}` : ''}
                        </b>{' '}
                        {just ? <span className="text-[12px] text-ink-3">just scanned</span> : null}
                        <span className="block font-mono text-[11.5px] text-ink-3">{l.code ?? ''}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-2">{l.bin ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{qty(l.expected_qty)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <LineInput key={`${l.id}:${now ?? ''}`} value={now} label={`Counted ${l.code ?? l.name}`} onSet={(text) => dispatch({ type: 'set', lineId: l.id, text, lines })} />
                      </td>
                      <td className="px-3 py-2 text-right">{v === null ? <span className="text-ink-3">not counted</span> : <Signed value={v} text={signed(v)} />}</td>
                      {seesCost ? <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{val === null ? '' : signed(Math.round(val))}</td> : null}
                      <td className={cx('px-3 py-2 text-[12.5px]', mineLine?.state === 'conflict' || mineLine?.state === 'failed' ? 'font-semibold text-danger' : 'text-ink-3')}>
                        {mineLine ? savedWords(mineLine, timeLabel) : num(l.counted_qty) !== null ? 'on WorkSuite' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!lines.length ? <p className="m-0 px-3 py-4 text-[13px] text-ink-3">No lines on this sheet.</p> : null}
          </div>
          <span className="text-[12px] text-ink-3">An empty count is not a count of zero — those lines are left out of the adjustment. {currency && seesCost ? `Values in ${currency}.` : ''}</span>
        </main>
        <aside aria-label="Sync queue" className="flex w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface px-4 py-5 scroll-thin">
          <b className="text-[14px] text-ink">Waiting to send</b>
          <span role="status" className={cx('flex items-center gap-2 text-[12.5px]', offline ? 'text-warning-ink' : 'text-ink-2')}>
            <span className={cx('inline-block h-2 w-2 rounded-full', offline ? 'bg-amber' : waitingCount ? 'bg-primary' : 'bg-green')} />
            {offline ? `Offline · ${waitingCount} ${waitingCount === 1 ? 'change' : 'changes'} waiting` : waitingCount ? `Sending ${waitingCount} ${waitingCount === 1 ? 'change' : 'changes'}…` : unsentHere ? 'Sending…' : 'Everything is sent'}
          </span>
          {toSend ? <QueueRow label={queueLabel(c.reference, toSend)} state="on this computer" /> : null}
          {queue.map((m) => (
            <QueueRow key={m.id} label={m.label} state={m.state === 'CONFLICT' ? 'needs a decision' : m.state === 'FAILED' ? 'not sent' : m.state === 'SYNCING' ? 'sending' : 'queued'} bad={m.state === 'CONFLICT' || m.state === 'FAILED'} />
          ))}
          {pending.isLoading ? <Spinner /> : null}
          {!toSend && !queue.length && !pending.isLoading ? <span className="text-[12.5px] text-ink-3">Nothing is waiting.</span> : null}
          <p className="m-0 text-[12.5px] text-ink-3">If someone else changed the same count online, you'll be asked which value to keep — nothing is overwritten silently.</p>
          <button type="button" className={btn} onClick={sync}>
            Try to sync now
          </button>
        </aside>
      </div>
      {confirm ? (
        <Sheet
          title={`Post ${c.reference}?`}
          width={440}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(false)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void post()}>
                {busy ? 'Posting…' : 'Post to stock'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">
            The {counted} counted {counted === 1 ? 'line is' : 'lines are'} compared with what was expected, and the differences are posted as one adjustment. Lines left empty are left out.
          </span>
        </Sheet>
      ) : null}
    </div>
  );
}

function QueueRow({ label, state, bad }: { label: string; state: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-2 text-[12.5px]">
      <span className="min-w-0 truncate text-ink">{label}</span>
      <span className={cx('shrink-0', bad ? 'font-semibold text-danger' : 'text-ink-3')}>{state}</span>
    </div>
  );
}

/** A line's count, typed: set on Enter or on leaving the box. */
function LineInput({ value, label, onSet }: { value: number | null; label: string; onSet: (text: string) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const commit = () => {
    if (text !== (value === null ? '' : String(value))) onSet(text);
  };
  return (
    <input
      className="h-[30px] w-[90px] rounded-[8px] border border-line bg-surface px-2 text-right text-[13.5px] font-semibold text-ink tabular-nums outline-none focus:border-primary"
      value={text}
      placeholder="—"
      inputMode="decimal"
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** Whether a count opens on the counting desk rather than the side panel: open for counting, for someone who may count. */
export const countsHere = (status: string | undefined, mayAdjust: boolean) => mayAdjust && (status === 'counting' || status === 'review');
