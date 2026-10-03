import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { formatPhone, toE164 } from '../../core/phone';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { pillOf } from './api';
import { MERGE_FIELDS, defaultChoices, differing, providerLabel, type DuplicatePair, type DuplicateSide, type SyncConflict } from './sync/api';
import { SourceIcons } from './sync/SourceIcon';

const PHONE_FIELDS = new Set(['mobile', 'office_phone', 'home_phone']);

/** A field's value as the merge screen shows it. */
export function shown(field: string, v: unknown): string {
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  if (PHONE_FIELDS.has(field)) return formatPhone(toE164(String(v))) || String(v);
  if (field === 'type') return pillOf(String(v));
  return String(v);
}

/**
 * Tidy up: Possible duplicates (same email, phone number, or name at the same company) merged side by side with a
 * choice per field, and undone if it was wrong; and the Sync conflicts list, where a field both sides changed can be
 * flipped to the value that lost.
 */
export function TidyUp({ tab, onTab, onOpen }: { tab: 'duplicates' | 'conflicts'; onTab: (t: 'duplicates' | 'conflicts') => void; onOpen: (id: number) => void }) {
  const conflicts = useQuery({ queryKey: ['contacts', 'sync', 'conflicts'], queryFn: ({ signal }) => apiGet<SyncConflict[]>('/api/contacts/sync/conflicts', undefined, signal) });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-6 pt-5">
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-[-0.3px] text-ink">Tidy up</h1>
      </div>
      <div role="tablist" aria-label="Tidy up" className="flex gap-1 px-6 pt-3">
        {(
          [
            ['duplicates', 'Possible duplicates', null],
            ['conflicts', 'Sync conflicts', conflicts.data?.length ?? 0],
          ] as const
        ).map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)} className={cx('flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold', tab === id ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
            {label}
            {n ? <span className="rounded-[8px] bg-warning-bg px-1.5 text-[11px] text-warning">{n}</span> : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6 scroll-thin">{tab === 'duplicates' ? <Duplicates onOpen={onOpen} /> : <Conflicts q={conflicts} onOpen={onOpen} />}</div>
    </div>
  );
}

function Duplicates({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const pairs = useQuery({ queryKey: ['contacts', 'duplicates'], queryFn: ({ signal }) => apiGet<DuplicatePair[]>('/api/contacts/duplicates', undefined, signal) });
  const [merging, setMerging] = useState<DuplicatePair | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['contacts'] });

  const dismiss = async (p: DuplicatePair) => {
    try {
      await apiPost('/api/contacts/duplicates/dismiss', { a: p.a.id, b: p.b.id });
      qc.setQueryData<DuplicatePair[]>(['contacts', 'duplicates'], (old) => old?.filter((x) => x !== p));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  if (pairs.isLoading) return <Spinner />;
  if (pairs.error) return <ErrorNote error={pairs.error} onRetry={() => void pairs.refetch()} />;
  const list = pairs.data ?? [];
  return (
    <>
      {!list.length ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-success-bg text-success">
            <Icon name="check-check" size={26} />
          </span>
          <b className="text-[15px] text-ink">No possible duplicates</b>
          <span className="text-[12.5px] text-ink-3">Contacts that share an email, a phone number, or a name at the same company show up here.</span>
        </div>
      ) : (
        <ul role="list" aria-label="Possible duplicates" className="flex flex-col gap-2.5">
          {list.map((p) => (
            <li key={`${p.a.id}-${p.b.id}`} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
              <Side s={p.a} onOpen={onOpen} />
              <Icon name="link" size={15} className="shrink-0 text-ink-3" />
              <Side s={p.b} onOpen={onOpen} />
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="flex gap-1">
                  {p.reasons.map((r) => (
                    <Chip key={r} tone="indigo">
                      {r}
                    </Chip>
                  ))}
                </span>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(p)}>
                    Not the same
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => setMerging(p)}>
                    Merge…
                  </Button>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {merging ? <MergeDialog pair={merging} onClose={() => setMerging(null)} onMerged={refresh} /> : null}
    </>
  );
}

function Side({ s, onOpen }: { s: DuplicateSide; onOpen: (id: number) => void }) {
  return (
    <button type="button" onClick={() => onOpen(s.id)} className="flex min-w-0 flex-1 flex-col rounded-[8px] px-2 py-1 text-left hover:bg-subtle">
      <span className="flex items-center gap-1.5">
        <b className="truncate text-[13.5px] text-ink">{s.display_name}</b>
        <SourceIcons sources={s.sources} size={13} />
      </span>
      <span className="truncate text-[12px] text-ink-3">{[s.company, s.work_email ?? s.personal_email, s.mobile ? shown('mobile', s.mobile) : null].filter(Boolean).join(' · ') || '—'}</span>
    </button>
  );
}

/** Side by side: which contact stays, and for each field they disagree on, whose value. */
export function MergeDialog({ pair, onClose, onMerged }: { pair: DuplicatePair; onClose: () => void; onMerged: () => void }) {
  const [keepA, setKeepA] = useState(true);
  const keep = keepA ? pair.a : pair.b;
  const other = keepA ? pair.b : pair.a;
  const [choose, setChoose] = useState(() => defaultChoices(pair.a, pair.b));
  const [busy, setBusy] = useState(false);
  const fields = differing(pair.a, pair.b);

  const flip = (v: boolean) => {
    setKeepA(v);
    const k = v ? pair.a : pair.b;
    const o = v ? pair.b : pair.a;
    setChoose(defaultChoices(k, o));
  };

  const merge = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ merge_id: number; keep_id: number }>('/api/contacts/merge', { keep_id: keep.id, other_id: other.id, choose });
      onMerged();
      onClose();
      toast('success', `Merged into ${keep.display_name}`, {
        label: 'Undo',
        run: () =>
          void apiPost(`/api/contacts/merges/${r.merge_id}/undo`)
            .then(() => (toast('info', 'Merge undone'), onMerged()))
            .catch((e: unknown) => toast('error', errorMessage(e))),
      }, 10_000);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const col = (s: DuplicateSide, isKeep: boolean) => (
    <label className={cx('flex flex-1 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2', isKeep ? 'border-primary bg-selection/50' : 'border-line')}>
      <input type="radio" name="keep" checked={isKeep} onChange={() => flip(s.id === pair.a.id)} className="accent-[var(--color-primary)]" />
      <span className="min-w-0">
        <b className="block truncate text-[13px] text-ink">{s.display_name}</b>
        <span className="text-[11.5px] text-ink-3">{isKeep ? 'Kept' : 'Merged into it'}{s.updated_at ? ` · changed ${relative(s.updated_at)}` : ''}</span>
      </span>
    </label>
  );

  return (
    <Modal
      title="Merge contacts"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void merge()}>
            Merge
          </Button>
        </>
      }
    >
      <div className="flex gap-2">
        {col(pair.a, keepA)}
        {col(pair.b, !keepA)}
      </div>
      {fields.length ? (
        <div role="table" aria-label="Fields to choose" className="mt-3 overflow-hidden rounded-[10px] border border-line">
          {fields.map((f) => (
            <div role="row" key={f.key} className="flex items-stretch border-t border-line/70 text-[12.5px] first:border-t-0">
              <span role="rowheader" className="w-[120px] shrink-0 bg-ground px-3 py-2 font-semibold text-ink-2">
                {f.label}
              </span>
              {[pair.a, pair.b].map((s) => {
                const side = (s.id === keep.id ? 'keep' : 'other') as 'keep' | 'other';
                const on = choose[f.key] === side;
                return (
                  <label role="cell" key={s.id} className={cx('flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2', on ? 'bg-selection/50' : 'hover:bg-subtle')}>
                    <input type="radio" name={`f-${f.key}`} checked={on} onChange={() => setChoose({ ...choose, [f.key]: side })} className="accent-[var(--color-primary)]" aria-label={`${f.label}: ${shown(f.key, s[f.key])}`} />
                    <span className={cx('min-w-0 truncate', on ? 'font-semibold text-ink' : 'text-ink-2')}>{shown(f.key, s[f.key])}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">The two agree on every field.</p>
      )}
      <p className="mt-3 text-[12px] text-ink-3">Every email and number of the other that is not kept stays on the contact as an extra. Notes, the timeline, groups, synced accounts, WhatsApp conversations and deals move to the kept contact. You can undo the merge.</p>
      {MERGE_FIELDS.length > fields.length && fields.length ? <p className="mt-1 text-[12px] text-ink-3">Fields they agree on are not shown.</p> : null}
    </Modal>
  );
}

const FIELD_LABEL = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.label]));

function Conflicts({ q, onOpen }: { q: UseQueryResult<SyncConflict[]>; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const resolve = async (c: SyncConflict, use: 'local' | 'remote') => {
    try {
      await apiPost(`/api/contacts/sync/conflicts/${c.id}/resolve`, { use });
      qc.setQueryData<SyncConflict[]>(['contacts', 'sync', 'conflicts'], (old) => old?.filter((x) => x.id !== c.id));
      void qc.invalidateQueries({ queryKey: ['contacts', 'detail', c.contact_id] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (!list.length) {
    return <p className="py-10 text-center text-[13px] text-ink-3">No sync conflicts. When a field changes in both WorkSuite and a synced account, the most recent change wins; accounts set to keep a list show those here.</p>;
  }
  return (
    <ul role="list" aria-label="Sync conflicts" className="flex flex-col gap-2.5">
      {list.map((c) => (
        <li key={c.id} className="rounded-[12px] border border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-[13px]">
            <button type="button" onClick={() => onOpen(c.contact_id)} className="font-bold text-ink hover:underline">
              {c.contact_name ?? 'Contact'}
            </button>
            <span className="text-ink-3">· {FIELD_LABEL[c.field] ?? c.field} changed in WorkSuite and {providerLabel(c.provider)}</span>
            <span className="ml-auto text-[12px] text-ink-3">{relative(c.created_at)}</span>
          </div>
          <div className="mt-2 flex gap-2">
            {(['local', 'remote'] as const).map((side) => {
              const kept = c.kept === side;
              const v = side === 'local' ? c.local_value : c.remote_value;
              return (
                <div key={side} className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border px-3 py-2', kept ? 'border-success bg-success-bg/40' : 'border-line')}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">{side === 'local' ? 'WorkSuite' : providerLabel(c.provider)}</span>
                    <span className="block truncate text-[13px] text-ink">{shown(c.field, v)}</span>
                  </span>
                  {kept ? (
                    <Chip tone="success">Kept</Chip>
                  ) : (
                    <Button size="sm" onClick={() => void resolve(c, side)}>
                      Use this
                    </Button>
                  )}
                </div>
              );
            })}
            <Button size="sm" variant="ghost" onClick={() => void resolve(c, c.kept)}>
              Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
