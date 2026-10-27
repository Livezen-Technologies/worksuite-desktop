import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { ApiError } from '../../core/api';
import { toast } from '../../core/toasts';
import { FileViewer } from '../../components/FileViewer';
import { Button, Spinner, cx } from '../../components/ui';
import {
  acknowledgePack, currentPackVersion, fetchAgenda, fetchAnnotations, fetchPack, fetchPaper, flagOf, fmtDate, isLive, K, liveLimits, paperFilePath, roleOf, saveAnnotation, titleCase,
  type AgendaItem, type Annotation, type AnnotationKind, type Meeting, type Visibility,
} from './api';
import { FlagChip, Muted, Status } from './parts';

const KINDS: AnnotationKind[] = ['highlight', 'underline', 'strike', 'pen', 'note', 'sticky', 'shape', 'bookmark'];
const VIS: Array<[Visibility, string]> = [['PRIVATE', 'Private'], ['SECRETARY', 'Secretary'], ['COMMITTEE', 'Committee'], ['EVERYONE', 'Everyone']];

type Draft = { page: number; quote: string; note: string; visibility: Visibility; kind: AnnotationKind };
const blank = (page = 1): Draft => ({ page, quote: '', note: '', visibility: 'PRIVATE', kind: 'highlight' });

/** The `POST /annotations` body for a draft (FR-ANN): the quoted text is the anchor, the note is the body. */
export function annotationBody(meetingId: number, paperVersionId: number, d: Draft, ref: string) {
  return { board_meeting_id: meetingId, paper_version_id: paperVersionId, page: d.page, kind: d.kind, body: d.note.trim() || null, anchor: d.quote.trim() ? { text: d.quote.trim() } : null, visibility: d.visibility, client_uuid: ref };
}

/**
 * Saves an annotation: to the server when it answers, else into the vault's queue (FR-OFF-02), sent later through
 * `POST /annotations/sync`, where a later edit of the same note (same `client_uuid`) replaces the earlier one.
 */
export async function keepAnnotation(meetingId: number, paperVersionId: number, d: Draft, ref: string, offline: boolean): Promise<'server' | 'queued'> {
  const body = annotationBody(meetingId, paperVersionId, d, ref);
  if (!offline) {
    try {
      await saveAnnotation({ ...body, updated_at: new Date().toISOString() });
      return 'server';
    } catch (e) {
      // Only an unreachable server queues; a refusal is the person's to see.
      if (!(e instanceof ApiError && e.offline) && !/reach|network|offline/i.test(errorMessage(e))) throw e;
    }
  }
  const { board_meeting_id: _m, ...queued } = body;
  await call('board:queueAdd', { kind: 'annotation', meetingId, ref, body: queued });
  return 'queued';
}

/** The pack reader with my annotations (Reader design; D-02 → paper), online or from the offline vault. */
export default function Reader({ meetingId, item, meeting }: { meetingId: number; item: number | null; meeting: Meeting | null }) {
  const qc = useQueryClient();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const fromVault = offline || !meeting;
  const vaultPack = useQuery({ queryKey: ['board', 'vaultPack', meetingId], queryFn: () => call('board:packOpen', { meetingId }), retry: false, enabled: fromVault });
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal), enabled: !fromVault });
  const pack = useQuery({ queryKey: K.pack(meetingId), queryFn: ({ signal }) => fetchPack(meetingId, signal), enabled: !fromVault });
  const notes = useQuery({ queryKey: K.annotations(meetingId, 'mine'), queryFn: ({ signal }) => fetchAnnotations(meetingId, 'mine', signal), enabled: !fromVault });
  const kept = fromVault ? vaultPack.data?.manifest ?? null : null;
  const items: AgendaItem[] = kept ? kept.agenda : (agenda.data ?? []);
  const [cur, setCur] = useState<number | null>(item);
  const sel = items.find((i) => i.id === cur) ?? items.find((i) => i.papers?.length) ?? null;
  const paperRef = sel?.papers?.[0] ?? null;
  const paper = useQuery({ queryKey: K.paper(paperRef?.id ?? 0), queryFn: ({ signal }) => fetchPaper(paperRef!.id, signal), enabled: !fromVault && !!paperRef });
  // Offline, the grant manifest names the paper version this member may read for each item.
  const keptPapers = (kept?.grant.papers as Array<{ paper_id: number; paper_version_id: number; agenda_item_id: number }> | undefined) ?? [];
  const versionId = fromVault ? (keptPapers.find((p) => p.agenda_item_id === sel?.id)?.paper_version_id ?? null) : (paper.data?.current_version?.id ?? null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [ref, setRef] = useState(() => `a${Date.now().toString(36)}`);
  const limits = liveLimits(roleOf(meeting), isLive(meeting));
  const shownItems = limits.allItems ? items : items.filter((i) => meeting?.participants?.some((p) => p.item_only_id === i.id));

  // The vault's pack file, read in place: a blob address that lives as long as the page.
  const blobUrl = useMemo(() => (fromVault && vaultPack.data?.file ? URL.createObjectURL(new Blob([vaultPack.data.file as BlobPart], { type: 'application/pdf' })) : null), [fromVault, vaultPack.data]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const myNotes = (kept ? (kept.notes as unknown as Annotation[]) : (notes.data ?? []));
  const paperNotes = myNotes.filter((n) => !versionId || n.paper_version_id === versionId);

  const save = useMutation({
    mutationFn: () => {
      if (!versionId) throw new Error('Choose a paper first.');
      if (!draft.note.trim() && !draft.quote.trim()) throw new Error('Quote the text or write a note.');
      return keepAnnotation(meetingId, versionId, draft, ref, fromVault);
    },
    onSuccess: (where) => {
      toast('success', where === 'queued' ? 'Saved on this computer; it syncs when you reconnect.' : 'Note saved.');
      setDraft(blank(draft.page));
      setRef(`a${Date.now().toString(36)}`);
      void qc.invalidateQueries({ queryKey: K.annotations(meetingId, 'mine') });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const packVersion = currentPackVersion(pack.data);
  const ack = useMutation({
    mutationFn: async () => {
      if (!fromVault && packVersion) return acknowledgePack(packVersion.id).then(() => 'sent' as const);
      await call('board:queueAdd', { kind: 'ack', meetingId, ref: `ack-${meetingId}`, body: packVersion ? { pack_version_id: packVersion.id } : {} });
      void call('board:sync').catch(() => undefined);
      return 'queued' as const;
    },
    onSuccess: (r) => toast('success', r === 'sent' ? 'Acknowledged.' : 'Acknowledged. It is sent with your next sync.'),
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (fromVault && vaultPack.isPending) return <Spinner />;
  if (fromVault && !vaultPack.data) return <p className="m-6 text-[13px] text-ink-2">{vaultPack.error ? errorMessage(vaultPack.error) : 'This pack is not available offline.'}</p>;
  const title = kept ? kept.meeting.title : (meeting?.title ?? '');
  const fileName = `${paperRef?.title ?? paper.data?.title ?? 'paper'}.pdf`;

  return (
    <div className="grid h-full grid-cols-[230px_1fr_300px]">
      <nav aria-label="Pack contents" className="flex flex-col overflow-y-auto border-r border-line bg-surface p-2 scroll-thin">
        <div className="px-1.5 pb-2"><div className="text-[13px] font-bold">{title}</div><Muted>{fromVault ? `Pack v${vaultPack.data!.summary.version} · offline · expires ${fmtDate(vaultPack.data!.summary.expiresAt)}` : packVersion ? `Pack v${packVersion.version}${packVersion.pages ? ` · ${packVersion.pages} pages` : ''}` : ''}</Muted></div>
        <ol>
          {shownItems.map((i) => (
            <li key={i.id} style={{ paddingInlineStart: `${(i.depth ?? 0) * 12}px` }}><button type="button" aria-current={sel?.id === i.id ? 'true' : undefined} onClick={() => setCur(i.id)} className={cx('flex w-full gap-2 rounded-[8px] px-2 py-2 text-left text-[12.5px]', sel?.id === i.id ? 'bg-selection font-semibold text-primary dark:bg-selection' : 'text-ink-2 hover:bg-subtle')}><b className="w-[24px] shrink-0">{i.number}</b><span className="flex-1">{i.title} <FlagChip flag={flagOf(i.flags)} /></span></button></li>
          ))}
        </ol>
        <Button size="sm" className="mt-auto" loading={ack.isPending} disabled={!fromVault && !packVersion} onClick={() => ack.mutate()}>Acknowledge pack</Button>
      </nav>
      <section className="min-h-0 bg-subtle" aria-label="Paper">
        {fromVault ? (blobUrl ? <FileViewer path="" url={blobUrl} name={`${title}.pdf`} /> : <p className="m-6 text-[13px]">The pack file is not in the offline copy.</p>)
          : versionId ? <FileViewer key={versionId} path={paperFilePath(versionId)} name={fileName} />
          : paper.isFetching ? <Spinner />
          : <p className="m-6 text-[13px] text-ink-3">This item has no paper.</p>}
      </section>
      <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin" aria-label="My annotations">
        <div className="flex items-center justify-between text-[13px] font-bold">My notes {fromVault ? <Status tone="warning">Offline</Status> : null}</div>
        <ul className="space-y-1.5">
          {paperNotes.map((n) => (
            <li key={n.id} className={cx('rounded-[8px] border-l-4 bg-subtle p-2 text-[12px]', n.visibility !== 'PRIVATE' ? 'border-primary' : 'border-amber')}>
              <div className="font-semibold">p {n.page ?? '—'} · {titleCase(n.kind)} · {n.visibility === 'PRIVATE' ? 'Private' : titleCase(n.visibility)}</div>
              {n.anchor?.text ? <div className="font-serif">“{n.anchor.text}”</div> : null}
              {n.body ? <div>{n.body}</div> : null}
            </li>
          ))}
          {!paperNotes.length ? <li><Muted>No notes on this paper.</Muted></li> : null}
        </ul>
        <fieldset className="mt-2 space-y-1.5 rounded-[8px] border border-line p-2 text-[12px]" disabled={!versionId}>
          <legend className="px-1 font-semibold">Add a note</legend>
          <label className="flex items-center gap-2">Tool
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AnnotationKind })} className="flex-1 rounded border border-line bg-surface p-1">
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">Page<input type="number" min={1} value={draft.page} onChange={(e) => setDraft({ ...draft, page: Math.max(1, Number(e.target.value) || 1) })} className="w-[70px] rounded border border-line bg-surface p-1" /></label>
          <textarea aria-label="Quoted text" value={draft.quote} onChange={(e) => setDraft({ ...draft, quote: e.target.value })} placeholder="Quoted text" className="h-[44px] w-full rounded border border-line bg-surface p-1" />
          <textarea aria-label="Note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Your note" className="h-[60px] w-full rounded border border-line bg-surface p-1" />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who sees it">
            {VIS.map(([v, l]) => <Button key={v} size="sm" role="radio" aria-checked={draft.visibility === v} variant={draft.visibility === v ? 'primary' : 'secondary'} onClick={() => setDraft({ ...draft, visibility: v })}>{l}</Button>)}
          </div>
          <Button size="sm" variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate()}>Save note</Button>
        </fieldset>
        <Muted>Private notes are only yours and never appear in minutes or exports.</Muted>
        {!limits.download ? <Muted>Your role cannot download papers during the live meeting.</Muted> : null}
      </aside>
    </div>
  );
}
