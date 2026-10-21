import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { FileViewer } from '../../components/FileViewer';
import { Button, Spinner, cx } from '../../components/ui';
import { fetchAgenda, fetchAnnotations, fmtDate, K, liveLimits, saveAnnotation, type AgendaItem, type Annotation, type Meeting } from './api';
import { FlagChip, Muted, Status } from './parts';

type Draft = { page: number; quote: string; note: string; share: 'private' | 'shared'; kind: NonNullable<Annotation['kind']> };
const blank = (page = 1): Draft => ({ page, quote: '', note: '', share: 'private', kind: 'highlight' });

/**
 * Saves an annotation: to the server when it answers, else into the vault's queue (FR-OFF-02), where a later edit of
 * the same note replaces the earlier one. Returns where it went.
 */
export async function keepAnnotation(meetingId: number, paperId: number, d: Draft, ref: string, offline: boolean): Promise<'server' | 'queued'> {
  const body = { paper_id: paperId, page: d.page, quote: d.quote.trim() || null, note: d.note.trim() || null, share: d.share, kind: d.kind };
  if (!offline) {
    try {
      await saveAnnotation(meetingId, body);
      return 'server';
    } catch (e) {
      // Only an unreachable server queues; a refusal is the person's to see.
      if (!/reach|network|offline/i.test(errorMessage(e))) throw e;
    }
  }
  await call('board:queueAdd', { kind: 'annotation', meetingId, ref, body });
  return 'queued';
}

/** The pack reader with my annotations (Reader design; D-02 → paper), online or from the offline vault. */
export default function Reader({ meetingId, item, meeting }: { meetingId: number; item: number | null; meeting: Meeting | null }) {
  const qc = useQueryClient();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const vaultPack = useQuery({ queryKey: ['board', 'vaultPack', meetingId], queryFn: () => call('board:packOpen', { meetingId }), retry: false, enabled: offline || !meeting });
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal), enabled: !offline && !!meeting });
  const notes = useQuery({ queryKey: K.annotations(meetingId, 'mine'), queryFn: ({ signal }) => fetchAnnotations(meetingId, 'mine', signal), enabled: !offline && !!meeting });
  const fromVault = !!vaultPack.data && (offline || !meeting);
  const items: AgendaItem[] = fromVault ? ((vaultPack.data!.manifest.agenda as AgendaItem[] | undefined) ?? []) : (agenda.data ?? []);
  const [cur, setCur] = useState<number | null>(item);
  const sel = items.find((i) => i.id === cur) ?? items.find((i) => i.paper) ?? null;
  const [draft, setDraft] = useState<Draft>(blank());
  const [ref, setRef] = useState(() => `a${Date.now().toString(36)}`);
  const live = meeting?.status === 'live' || meeting?.status === 'in_progress';
  const limits = liveLimits(meeting?.my_role, live);
  const shownItems = limits.allItems ? items : items.filter((i) => meeting?.participants?.some((p) => p.item_only?.includes(i.number)));

  // The vault's pack file, read in place: a blob address that lives as long as the page.
  const blobUrl = useMemo(() => (fromVault && vaultPack.data?.file ? URL.createObjectURL(new Blob([vaultPack.data.file as BlobPart], { type: 'application/pdf' })) : null), [fromVault, vaultPack.data]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const myNotes: Annotation[] = fromVault ? ((vaultPack.data!.manifest.notes as Annotation[] | undefined) ?? []) : (notes.data ?? []);
  const paperNotes = myNotes.filter((n) => !sel || n.item === sel.number || n.paper === sel.paper?.name);

  const save = useMutation({
    mutationFn: () => {
      if (!sel?.paper) throw new Error('Choose a paper first.');
      if (!draft.note.trim() && !draft.quote.trim()) throw new Error('Quote the text or write a note.');
      return keepAnnotation(meetingId, sel.paper.id, draft, ref, offline || fromVault);
    },
    onSuccess: (where) => {
      toast('success', where === 'queued' ? 'Saved on this computer; it syncs when you reconnect.' : 'Note saved.');
      setDraft(blank(draft.page));
      setRef(`a${Date.now().toString(36)}`);
      void qc.invalidateQueries({ queryKey: K.annotations(meetingId, 'mine') });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const ack = useMutation({
    mutationFn: () => call('board:queueAdd', { kind: 'ack', meetingId, ref: `ack-${meetingId}`, body: { version: fromVault ? vaultPack.data!.summary.version : (meeting?.pack?.version ?? 1) } }),
    onSuccess: () => { toast('success', 'Acknowledged. It is sent with your next sync.'); void call('board:sync').catch(() => undefined); },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if ((offline || !meeting) && vaultPack.isPending) return <Spinner />;
  if ((offline || !meeting) && !vaultPack.data) return <p className="m-6 text-[13px] text-ink-2">{vaultPack.error ? errorMessage(vaultPack.error) : 'This pack is not available offline.'}</p>;
  const title = fromVault ? vaultPack.data!.summary.title : (meeting?.title ?? '');

  return (
    <div className="grid h-full grid-cols-[230px_1fr_300px]">
      <nav aria-label="Pack contents" className="flex flex-col overflow-y-auto border-r border-line bg-surface p-2 scroll-thin">
        <div className="px-1.5 pb-2"><div className="text-[13px] font-bold">{title}</div><Muted>{fromVault ? `Pack v${vaultPack.data!.summary.version} · offline · expires ${fmtDate(vaultPack.data!.summary.expiresAt)}` : meeting?.pack ? `Pack v${meeting.pack.version}${meeting.pack.pages ? ` · ${meeting.pack.pages} pages` : ''}` : ''}</Muted></div>
        <ol>
          {shownItems.map((i) => (
            <li key={i.id}><button type="button" aria-current={sel?.id === i.id ? 'true' : undefined} onClick={() => setCur(i.id)} className={cx('flex w-full gap-2 rounded-[8px] px-2 py-2 text-left text-[12.5px]', sel?.id === i.id ? 'bg-[#EEF1FD] font-semibold text-primary dark:bg-selection' : 'text-ink-2 hover:bg-subtle')}><b className="w-[24px] shrink-0">{i.number}</b><span className="flex-1">{i.title} <FlagChip flag={i.flag} /></span></button></li>
          ))}
        </ol>
        <Button size="sm" className="mt-auto" loading={ack.isPending} onClick={() => ack.mutate()}>Acknowledge pack</Button>
      </nav>
      <section className="min-h-0 bg-subtle" aria-label="Paper">
        {fromVault ? (blobUrl ? <FileViewer path="" url={blobUrl} name={`${title}.pdf`} /> : <p className="m-6 text-[13px]">The pack file is not in the offline copy.</p>)
          : sel?.paper ? <FileViewer key={sel.paper.id} path={`/api/board/papers/${sel.paper.id}/file?member=me`} name={sel.paper.name} />
          : <p className="m-6 text-[13px] text-ink-3">This item has no paper.</p>}
      </section>
      <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin" aria-label="My annotations">
        <div className="flex items-center justify-between text-[13px] font-bold">My notes {fromVault || offline ? <Status tone="warning">Offline</Status> : null}</div>
        <ul className="space-y-1.5">
          {paperNotes.map((n) => (
            <li key={n.id} className={cx('rounded-[8px] border-l-4 bg-subtle p-2 text-[12px]', n.share === 'shared' ? 'border-primary' : 'border-[#EAB308]')}>
              <div className="font-semibold">p {n.page} · {n.share === 'shared' ? 'Shared' : 'Private'}</div>
              {n.quote ? <div className="font-serif">“{n.quote}”</div> : null}
              {n.note ? <div>{n.note}</div> : null}
            </li>
          ))}
          {!paperNotes.length ? <li><Muted>No notes on this paper.</Muted></li> : null}
        </ul>
        <fieldset className="mt-2 space-y-1.5 rounded-[8px] border border-line p-2 text-[12px]" disabled={!sel?.paper && !fromVault}>
          <legend className="px-1 font-semibold">Add a note</legend>
          <label className="flex items-center gap-2">Tool
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })} className="flex-1 rounded border border-line bg-surface p-1">
              {['highlight', 'underline', 'strike', 'pen', 'text', 'sticky', 'shape', 'bookmark'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">Page<input type="number" min={1} value={draft.page} onChange={(e) => setDraft({ ...draft, page: Math.max(1, Number(e.target.value) || 1) })} className="w-[70px] rounded border border-line bg-surface p-1" /></label>
          <textarea aria-label="Quoted text" value={draft.quote} onChange={(e) => setDraft({ ...draft, quote: e.target.value })} placeholder="Quoted text" className="h-[44px] w-full rounded border border-line bg-surface p-1" />
          <textarea aria-label="Note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Your note" className="h-[60px] w-full rounded border border-line bg-surface p-1" />
          <div className="flex gap-1.5" role="radiogroup" aria-label="Who sees it">
            {(['private', 'shared'] as const).map((s) => <Button key={s} size="sm" role="radio" aria-checked={draft.share === s} variant={draft.share === s ? 'primary' : 'secondary'} onClick={() => setDraft({ ...draft, share: s })}>{s === 'private' ? 'Private' : 'Shared'}</Button>)}
          </div>
          <Button size="sm" variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate()}>Save note</Button>
        </fieldset>
        <Muted>Private notes are only yours and never appear in minutes or exports.</Muted>
        {!limits.download ? <Muted>Your role cannot download papers during the live meeting.</Muted> : null}
      </aside>
    </div>
  );
}
