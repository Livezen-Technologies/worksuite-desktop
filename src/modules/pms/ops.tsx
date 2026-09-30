import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Select } from '../../components/Select';
import { Button } from '../../components/ui';
import { apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Ask, type AskField } from '../garage/parts';
import { codeOf, errorText, K, pPost, type ActionOption } from './api';

/**
 * What the operations screens share (housekeeping, maintenance, guest
 * requests, lost and found): the moves the server offers on a record, each
 * asking for what it `needs` before it is sent with the record's `version`;
 * a person to give the work to; a file saved on this computer.
 *
 * Every move is online only (PMS-DSK-003): the record's state is the
 * server's, and a move made against an old copy would be a conflict.
 */

/** The words for what a move needs said, by the server's field name. */
const NEED: Record<string, { label: string; type?: AskField['type']; hint?: string }> = {
  reason: { label: 'Reason' },
  resolution: { label: 'What was done', type: 'textarea' },
  storage_place: { label: 'Stored at', hint: 'A shelf, a locker, the safe.' },
  returned_to: { label: 'Returned to', hint: 'Who took it, and how (in person, by courier).' },
  claimant: { label: 'Claimed by', hint: 'The guest or person who says it is theirs.' },
  note: { label: 'Note', type: 'textarea' },
};

/** The fields a move asks for; `assignee` is a person, chosen with the picker instead. */
export function needFields(o: Pick<ActionOption, 'needs'>): AskField[] {
  return o.needs.filter((n) => n !== 'assignee' && n !== 'assigned_to').map((n) => ({ name: n, label: NEED[n]?.label ?? n.replace(/_/g, ' '), type: NEED[n]?.type, hint: NEED[n]?.hint, required: true }));
}

/**
 * Runs a record's moves: `POST {base}/{action}` with its `version`, asking
 * first for what the move needs. A conflict reloads the record and says so.
 */
export function useActions(invalidate: QueryKey[], onDone?: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ base: string; o: ActionOption; version: number; extra: Record<string, unknown>; fields: AskField[] } | null>(null);

  const reload = () => invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
  const send = async (base: string, action: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await pPost<{ warnings?: string[] }>(`${base}/${action}`, body);
      toast('success', r.message);
      (r.data?.warnings ?? []).forEach((w) => toast('info', w));
      setAsking(null);
      reload();
      onDone?.();
      return true;
    } catch (e) {
      const c = codeOf(e);
      setError(c === 'conflict' || c === 'version_conflict' ? `${errorText(e)} It has been reloaded.` : errorText(e, 'Nothing was changed.'));
      setAsking(null);
      reload();
      return false;
    } finally {
      setBusy(false);
    }
  };
  /** A move as the server offered it: straight away, or after its dialog. */
  const run = (base: string, o: ActionOption, version: number, extra: Record<string, unknown> = {}, more: AskField[] = []) => {
    const fields = [...needFields(o).filter((f) => !(f.name in extra)), ...more];
    if (fields.length === 0) return void send(base, o.action, { version, ...extra });
    setAsking({ base, o, version, extra, fields });
  };
  const dialog: ReactNode = asking ? (
    <Ask
      title={asking.o.label}
      fields={asking.fields}
      busy={busy}
      danger={['cancel', 'dispose', 'fail'].includes(asking.o.action)}
      confirm={asking.o.label}
      onClose={() => setAsking(null)}
      onSubmit={(v) => void send(asking.base, asking.o.action, { version: asking.version, ...asking.extra, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) })}
    />
  ) : null;
  return { run, send, busy, error, setError, dialog };
}

/** The moves of a record as buttons, the primary one filled, destructive ones plain. */
export function ActionButtons({ options, primary, busy, online, onPick, skip = [] }: { options: ActionOption[] | undefined; primary?: string | null; busy: boolean; online: boolean; onPick: (o: ActionOption) => void; skip?: string[] }) {
  return (
    <>
      {(options ?? [])
        .filter((o) => !skip.includes(o.action))
        .map((o) => (
          <Button key={o.action} size="sm" variant={o.action === primary ? 'primary' : 'secondary'} disabled={busy || !online} title={online ? undefined : 'Needs WorkSuite'} onClick={() => onPick(o)}>
            {o.label}
          </Button>
        ))}
    </>
  );
}

/** The company's people, as the desktop's other apps choose them (Team Chat's directory). */
export function useDirectory(enabled = true): { people: Array<{ id: number; name: string }>; loading: boolean; error: unknown } {
  const q = useQuery({
    queryKey: K.directory,
    queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number | string; name: string }> }>('/api/chat/directory', undefined, signal),
    staleTime: 5 * 60_000,
    retry: false,
    enabled,
  });
  const people = (q.data?.users ?? []).map((u) => ({ id: Number(u.id), name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
  return { people, loading: q.isLoading, error: q.error };
}

/**
 * A person to give work to. The server says who may take it (the permission
 * at this property) and refuses anyone else in its own words; the picker
 * lists `people` when the server gave its own list (housekeeping's staff),
 * else the company directory.
 */
export function PersonPick({ label, value, onChange, people, disabled }: { label: string; value: number | null; onChange: (id: number | null) => void; people?: Array<{ id: number; name: string; hint?: string }>; disabled?: boolean }) {
  const dir = useDirectory(!people);
  const list = people ?? dir.people;
  return (
    <Select<string>
      aria-label={label}
      value={value ? String(value) : ''}
      placeholder="Choose a person…"
      searchable
      disabled={disabled}
      loading={!people && dir.loading}
      empty={dir.error ? errorText(dir.error) : 'Nobody matches.'}
      options={list.map((p) => ({ value: String(p.id), label: p.name, hint: 'hint' in p ? (p as { hint?: string }).hint : undefined }))}
      onValueChange={(v) => onChange(v ? Number(v) : null)}
      className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink"
    />
  );
}

/** Whether this person's organization lets files be saved from WorkSuite on this computer (`desktop.downloads`). */
export function useMaySave(): boolean {
  return useStore(app, (s) => {
    const p = s.bootstrap?.permissions;
    return !p || p.includes('*') || p.includes('desktop.downloads');
  });
}

/** A file from the server saved where the person chooses (the save dialog). */
export async function saveBytes(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const safe = name.replace(/[/\\]/g, '-').slice(0, 200) || 'worksuite-file';
  const r = await call('office:saveCopy', { name: safe, bytes });
  return r?.name ?? null;
}
