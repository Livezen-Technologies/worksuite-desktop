import { cx } from '../../../components/ui';
import { rowsOf, useExtensions, useIvrs, useQueues, useRingGroups, type Destination } from '../api';
import { INPUT } from '../parts';

/**
 * Where a call goes — an extension, a queue, a ring group, a menu, voicemail, an outside number, a message, or
 * hang up — picked from what exists (A07, A08 overflow). A target that no longer exists is shown as missing, so a
 * menu key cannot point at nothing unnoticed.
 */
export const DEST_KINDS: Array<{ id: Destination['kind']; label: string }> = [
  { id: 'extension', label: 'Extension' },
  { id: 'queue', label: 'Queue' },
  { id: 'ring_group', label: 'Ring group' },
  { id: 'ivr', label: 'Menu (IVR)' },
  { id: 'voicemail', label: 'Voicemail' },
  { id: 'external', label: 'Outside number' },
  { id: 'announcement', label: 'Message, then hang up' },
  { id: 'hangup', label: 'Hang up' },
];

export function useTargets() {
  const exts = useExtensions();
  const queues = useQueues();
  const groups = useRingGroups();
  const ivrs = useIvrs();
  return {
    extension: (exts.data ?? []).map((e) => ({ value: e.extension, label: `${e.extension} · ${e.user_name ?? e.name}` })),
    queue: rowsOf(queues.data).map((q) => ({ value: q.number, label: `${q.number} · ${q.name}` })),
    ring_group: rowsOf(groups.data).map((g) => ({ value: g.number, label: `${g.number} · ${g.name}` })),
    ivr: rowsOf(ivrs.data).map((i) => ({ value: String(i.number ?? i.id), label: `${i.number ?? ''} · ${i.name}`.replace(/^ · /, '') })),
    voicemail: (exts.data ?? []).filter((e) => e.voicemail).map((e) => ({ value: e.extension, label: `Mailbox ${e.extension} · ${e.user_name ?? e.name}` })),
  };
}

/** Is the destination's target still there? */
export function resolves(d: Destination | null | undefined, t: ReturnType<typeof useTargets>): boolean {
  if (!d) return true;
  if (d.missing) return false;
  if (d.kind === 'external' || d.kind === 'announcement' || d.kind === 'hangup') return true;
  const list = t[d.kind as keyof typeof t] as Array<{ value: string }> | undefined;
  return !list || list.length === 0 || list.some((x) => x.value === d.value);
}

export function describeDest(d: Destination | null | undefined): string {
  if (!d) return 'Not set';
  const kind = DEST_KINDS.find((k) => k.id === d.kind)?.label ?? d.kind;
  if (d.kind === 'hangup') return 'Hang up';
  return `${kind}${d.label ? ` · ${d.label}` : d.value ? ` ${d.value}` : ''}${d.missing ? ' (missing)' : ''}`;
}

export function DestinationPicker({ value, onChange, label }: { value: Destination | null; onChange: (d: Destination) => void; label: string }) {
  const t = useTargets();
  const kind = value?.kind ?? 'extension';
  const list = (t as Record<string, Array<{ value: string; label: string }>>)[kind];
  const ok = resolves(value, t);
  return (
    <span className="flex min-w-0 gap-1.5">
      <select aria-label={`${label}: kind`} value={kind} onChange={(e) => onChange({ kind: e.target.value as Destination['kind'], value: null })} className={cx(INPUT, 'w-[42%]')}>
        {DEST_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      {list ? (
        <select aria-label={`${label}: target`} value={value?.value ?? ''} onChange={(e) => onChange({ kind, value: e.target.value, label: list.find((x) => x.value === e.target.value)?.label ?? null })} className={cx(INPUT, 'min-w-0 flex-1', !ok && 'border-danger text-danger')}>
          <option value="">Choose…</option>
          {!ok && value?.value ? <option value={value.value}>{value.value} (missing)</option> : null}
          {list.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      ) : kind === 'external' || kind === 'announcement' ? (
        <input value={value?.value ?? ''} onChange={(e) => onChange({ kind, value: e.target.value })} placeholder={kind === 'external' ? '+94 77 455 1290' : 'Closed message (text or Drive file)'} aria-label={`${label}: target`} className={cx(INPUT, 'min-w-0 flex-1')} />
      ) : null}
    </span>
  );
}

/** Only the target, for a kind chosen elsewhere (a short code's "Points at"). */
export function TargetSelect({ kind, value, onChange, label }: { kind: string; value: string; onChange: (v: string) => void; label: string }) {
  const t = useTargets();
  const list = (t as Record<string, Array<{ value: string; label: string }>>)[kind];
  if (!list) return <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={INPUT} placeholder={kind === 'external' ? '+94 77 455 1290' : ''} />;
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">Choose…</option>
      {value && !list.some((x) => x.value === value) ? <option value={value}>{value} (missing)</option> : null}
      {list.map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
    </select>
  );
}
