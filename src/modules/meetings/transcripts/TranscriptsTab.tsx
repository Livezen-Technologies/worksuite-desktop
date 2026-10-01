import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost, apiPut, apiUrl } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, Chip, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { LANGUAGE_LABEL, plan, type SpeechLanguage } from '../../meet/transcribe/engine';
import { decode, transcribeRecording } from '../../meet/transcribe/recording';
import type { Detail } from '../api';
import { stamp, transcriptText, UNIDENTIFIED, type Delivery, type Recipient, type Transcript, type TranscriptFormat, type TranscriptSegment } from './api';

/**
 * Transcripts (worksuite-desktop#81), in the meeting's details: the ones made during the meeting and from its
 * recordings, each to read, correct, export and email; and Generate a transcript for a recording. Who sees them is
 * the meeting's setting; who may correct and email them is said on each.
 */

const STATUS: Record<Transcript['status'], [string, 'muted' | 'indigo' | 'success' | 'danger']> = {
  active: ['Transcribing', 'indigo'],
  processing: ['Processing', 'indigo'],
  ready: ['Ready', 'success'],
  failed: ['Failed', 'danger'],
  cancelled: ['Cancelled', 'muted'],
};

export function TranscriptsTab({ d }: { d: Detail }) {
  const id = d.meeting.id;
  const q = useQuery({
    queryKey: ['meetings', id, 'transcripts'],
    queryFn: ({ signal }) => apiGet<{ transcripts: Transcript[] }>(`/api/meetings/${id}/transcripts`, undefined, signal),
    refetchInterval: (query) => (query.state.data?.transcripts.some((t) => t.status === 'active' || t.status === 'processing') ? 5_000 : false),
  });
  const [open, setOpen] = useState<number | null>(null);
  const rows = q.data?.transcripts ?? [];
  const recordings = (d.recordings ?? []).filter((r) => r.status === 'ready');
  if (open) return <TranscriptView id={open} title={d.meeting.title} onBack={() => setOpen(null)} />;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[15px] font-bold text-ink">Transcripts</h2>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && !rows.length ? <p className="text-ink-3">No transcripts yet. Start one during the meeting, or make one from a recording below.</p> : null}
      {rows.map((t) => (
        <button key={t.id} type="button" onClick={() => setOpen(t.id)} className="flex items-center gap-2.5 rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-ink">{t.source === 'live' ? 'During the meeting' : 'From a recording'} · {LANGUAGE_LABEL[t.language]}</b>
            <span className="text-[12px] text-ink-3">{[t.started_at ? `${dateLabel(t.started_at)} ${timeLabel(t.started_at)}` : null, `${t.segments_count} segments`, t.engine === 'local' ? 'transcribed on a computer' : t.engine === 'online' ? 'transcribed online' : null].filter(Boolean).join(' · ')}</span>
            {t.status === 'failed' && t.error ? <span className="text-[12px] text-danger">{t.error}</span> : null}
          </span>
          {t.status === 'processing' ? <span className="text-[12px] font-semibold text-primary">{t.progress}%</span> : null}
          <Chip tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Chip>
        </button>
      ))}
      {recordings.length ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <b className="text-ink">Make a transcript from a recording</b>
          {recordings.map((r) => (
            <GenerateFromRecording key={r.id} meetingId={id} recording={r} onDone={(tid) => (void q.refetch(), setOpen(tid))} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type Run = { state: 'idle' } | { state: 'decoding' } | { state: 'transcribing'; pct: number; cancel: () => void } | { state: 'failed'; error: string } | { state: 'cancelled' };

/** Generate Transcript for a recording: decoded here, transcribed in pieces (this computer first), with progress, Cancel and Try again. */
function GenerateFromRecording({ meetingId, recording, onDone }: { meetingId: number; recording: NonNullable<Detail['recordings']>[number]; onDone: (transcriptId: number) => void }) {
  const [language, setLanguage] = useState<SpeechLanguage>('en');
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const go = async () => {
    const p = await plan();
    if (!p.engine) {
      setRun({ state: 'failed', error: p.note ?? 'Nothing can transcribe now.' });
      return;
    }
    let tid: number | null = null;
    try {
      setRun({ state: 'decoding' });
      const t = await apiPost<Transcript>(`/api/meetings/${meetingId}/transcripts`, { source: 'recording', recording_id: recording.id, language });
      tid = t.id;
      const res = await fetch(recording.drive_file_id ? apiUrl(`/api/files/${recording.drive_file_id}/download`) : apiUrl(`/api/meet/recordings/${recording.id}/file`));
      if (!res.ok) throw new Error(`The recording could not be read (${res.status}).`);
      const samples = await decode(await res.blob());
      const job = transcribeRecording(t.id, samples, language, (pct) => setRun((r) => (r.state === 'transcribing' ? { ...r, pct } : r)));
      setRun({ state: 'transcribing', pct: 0, cancel: job.cancel });
      const end = await job.done;
      await apiPost(`/api/meetings/transcripts/${t.id}/finish`, { status: end });
      if (end === 'cancelled') setRun({ state: 'cancelled' });
      else {
        setRun({ state: 'idle' });
        toast('success', 'The transcript is ready to review.');
        onDone(t.id);
      }
    } catch (e) {
      const error = errorMessage(e);
      if (tid) await apiPost(`/api/meetings/transcripts/${tid}/finish`, { status: 'failed', error }).catch(() => undefined);
      setRun({ state: 'failed', error });
    }
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ink">{recording.title}</span>
        <Select<SpeechLanguage> aria-label="Language spoken" value={language} disabled={run.state === 'decoding' || run.state === 'transcribing'} options={(Object.keys(LANGUAGE_LABEL) as SpeechLanguage[]).map((k) => ({ value: k, label: LANGUAGE_LABEL[k] }))} onValueChange={setLanguage} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
        {run.state === 'transcribing' ? (
          <Button size="sm" onClick={() => run.cancel()}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" variant="primary" loading={run.state === 'decoding'} onClick={() => void go()}>
            {run.state === 'failed' || run.state === 'cancelled' ? 'Try again' : 'Generate transcript'}
          </Button>
        )}
      </div>
      {run.state === 'decoding' ? <span className="text-[12px] text-ink-3">Reading the recording…</span> : null}
      {run.state === 'transcribing' ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Transcribed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={run.pct}>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${run.pct}%` }} />
        </div>
      ) : null}
      {run.state === 'failed' ? (
        <span className="text-[12px] text-danger" role="alert">
          {run.error}
        </span>
      ) : null}
      {run.state === 'cancelled' ? <span className="text-[12px] text-ink-3">Cancelled. What was transcribed so far is kept.</span> : null}
    </div>
  );
}

/** One transcript: read, correct (on the version read), export, email. */
export function TranscriptView({ id, title, onBack }: { id: number; title: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['meetings', 'transcript', id],
    queryFn: ({ signal }) => apiGet<Transcript>(`/api/meetings/transcripts/${id}`, undefined, signal),
    refetchInterval: (query) => (query.state.data && (query.state.data.status === 'active' || query.state.data.status === 'processing') ? 4_000 : false),
  });
  const [editing, setEditing] = useState<TranscriptSegment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data;
  const segments = editing ?? t.segments ?? [];
  const working = t.status === 'active' || t.status === 'processing';
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const next = await apiPut<Transcript>(`/api/meetings/transcripts/${id}`, { segments: editing, base_version: t.version });
      qc.setQueryData(['meetings', 'transcript', id], next);
      setEditing(null);
      toast('success', 'Corrections saved.');
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? 'Somebody else corrected it meanwhile. Your changes are still here; open it again to see theirs before saving.' : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const exportAs = (format: 'txt' | 'pdf') =>
    void call('transfers:download', { transcriptExport: { id, format }, name: `${title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 180)} - transcript.${format}` }).catch((e) => toast('error', errorMessage(e)));
  const set = (i: number, patch: Partial<TranscriptSegment>) => setEditing((list) => (list ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} className="font-semibold text-primary hover:underline">
            ‹ Transcripts
          </button>
        ) : null}
        <h2 className="flex-1 text-[15px] font-bold text-ink">
          Transcript · {LANGUAGE_LABEL[t.language]}
        </h2>
        <Chip tone={STATUS[t.status][1]}>{STATUS[t.status][0]}{t.status === 'processing' ? ` ${t.progress}%` : ''}</Chip>
      </div>
      <p className="text-[12px] text-ink-3">Machine-made transcripts can be wrong. Unclear parts are marked; speakers nobody could tell are “{UNIDENTIFIED}”.{t.edited_at ? ` Corrected ${dateLabel(t.edited_at)}.` : ''}</p>
      {t.status === 'failed' && t.error ? <p className="rounded-[9px] bg-danger-bg px-3 py-2 text-danger">{t.error}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
              Save corrections
            </Button>
            <Button size="sm" onClick={() => setEditing(null)}>
              Discard
            </Button>
          </>
        ) : (
          <>
            {t.can.correct && !working ? (
              <Button size="sm" icon="compose" onClick={() => setEditing(t.segments ?? [])}>
                Correct
              </Button>
            ) : null}
            <Button size="sm" icon="copy" onClick={() => void navigator.clipboard.writeText(transcriptText(segments)).then(() => toast('success', 'Transcript copied.'))}>
              Copy
            </Button>
            <Button size="sm" icon="download" onClick={() => exportAs('txt')}>
              TXT
            </Button>
            <Button size="sm" icon="download" onClick={() => exportAs('pdf')}>
              PDF
            </Button>
            {t.can.email && t.status === 'ready' ? (
              <Button size="sm" variant="primary" icon="send" onClick={() => setEmailing(true)}>
                Email transcript…
              </Button>
            ) : null}
          </>
        )}
      </div>
      {t.auto_email.enabled ? (
        <p className="text-[12px] text-ink-2">{t.auto_emailed_at ? `Emailed automatically ${dateLabel(t.auto_emailed_at)} to the people chosen.` : `It will be emailed automatically to ${t.auto_email.participant_ids.length} ${t.auto_email.participant_ids.length === 1 ? 'person' : 'people'} once it is ready.`}</p>
      ) : null}
      {!segments.length ? <p className="text-ink-3">{working ? 'Nothing transcribed yet.' : 'Nothing was transcribed.'}</p> : null}
      <ol className="flex flex-col gap-1.5">
        {segments.map((s, i) => (
          <li key={`${s.start_ms}-${i}`} className={cx('grid gap-2 rounded-[8px] px-2 py-1.5 [grid-template-columns:64px_150px_1fr]', s.uncertain && 'bg-[#FFF9EC] dark:bg-warning-bg')}>
            <span className="pt-0.5 font-mono text-[12px] text-ink-3">{stamp(s.start_ms)}</span>
            {editing ? (
              <input aria-label={`Speaker at ${stamp(s.start_ms)}`} value={s.speaker} placeholder={UNIDENTIFIED} onChange={(e) => set(i, { speaker: e.target.value })} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
            ) : (
              <b className={cx('truncate', s.speaker ? 'text-ink' : 'text-ink-3 italic')}>{s.speaker || UNIDENTIFIED}</b>
            )}
            {editing ? (
              <span className="flex flex-col gap-1">
                <textarea aria-label={`What was said at ${stamp(s.start_ms)}`} value={s.text} rows={Math.min(5, Math.ceil(s.text.length / 70) || 1)} onChange={(e) => set(i, { text: e.target.value })} className="rounded-[7px] border border-line bg-surface px-2 py-1 text-[13px] text-ink" />
                <label className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                  <Checkbox checked={s.uncertain} onChange={(e) => set(i, { uncertain: e.target.checked })} /> Unclear
                </label>
              </span>
            ) : (
              <span className="text-ink selectable">
                {s.text}
                {s.uncertain ? <span className="ml-1 text-[11.5px] font-semibold text-[#9A5B00]">(unclear)</span> : null}
              </span>
            )}
          </li>
        ))}
      </ol>
      {t.can.email ? <Deliveries id={id} /> : null}
      {emailing ? <EmailTranscriptDialog t={t} title={title} onClose={() => setEmailing(false)} /> : null}
    </div>
  );
}

function Deliveries({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['meetings', 'transcript', id, 'deliveries'], queryFn: ({ signal }) => apiGet<{ deliveries: Delivery[] }>(`/api/meetings/transcripts/${id}/deliveries`, undefined, signal) });
  const rows = q.data?.deliveries ?? [];
  if (!rows.length) return null;
  const retry = async (d: Delivery) => {
    try {
      const r = await apiPost<Delivery>(`/api/meetings/transcripts/${id}/deliveries/${d.id}/retry`);
      toast(r.status === 'sent' ? 'success' : 'error', r.status === 'sent' ? `Sent to ${d.name}.` : (r.error ?? 'It could not be sent.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
    void q.refetch();
  };
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <b className="text-ink">Emailed</b>
      {rows.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-[12.5px]">
          <span className="min-w-0 flex-1 truncate text-ink">
            {d.name} <span className="text-ink-3">{d.email}</span>
          </span>
          <span className="text-ink-3">{d.format === 'link' ? 'link' : d.format.toUpperCase()} · v{d.version}{d.automatic ? ' · automatic' : ''}</span>
          {d.status === 'sent' ? <span className="font-semibold text-success">Sent{d.sent_at ? ` ${timeLabel(d.sent_at)}` : ''}</span> : null}
          {d.status === 'failed' ? (
            <>
              <span className="font-semibold text-danger" title={d.error ?? undefined}>
                Failed
              </span>
              <button type="button" onClick={() => void retry(d)} className="font-semibold text-primary hover:underline">
                Retry
              </button>
            </>
          ) : null}
          {d.status === 'queued' ? <span className="text-ink-3">Sending…</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Email Transcript: whom (only people who may see it), subject, message, how — a preview, then a confirmation before anything is sent. */
export function EmailTranscriptDialog({ t, title, onClose }: { t: Transcript; title: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['meetings', 'transcript', t.id, 'recipients'], queryFn: ({ signal }) => apiGet<{ recipients: Recipient[]; formats: TranscriptFormat[] }>(`/api/meetings/transcripts/${t.id}/recipients`, undefined, signal) });
  const [picked, setPicked] = useState<number[]>([]);
  const [subject, setSubject] = useState(`Transcript: ${title}`);
  const [message, setMessage] = useState('');
  const [format, setFormat] = useState<TranscriptFormat>('link');
  const [step, setStep] = useState<'compose' | 'confirm' | 'done'>('compose');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ deliveries: Delivery[]; skipped: Array<{ name: string; why: string }> } | null>(null);
  const allowed = (q.data?.recipients ?? []).filter((r) => r.allowed);
  const excluded = (q.data?.recipients ?? []).filter((r) => !r.allowed);
  const formats = q.data?.formats ?? ['link'];
  const send = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ deliveries: Delivery[]; skipped: Array<{ name: string; why: string }> }>(`/api/meetings/transcripts/${t.id}/email`, { participant_ids: picked, subject, message, format });
      setResult(r);
      setStep('done');
      void qc.invalidateQueries({ queryKey: ['meetings', 'transcript', t.id, 'deliveries'] });
    } catch (e) {
      toast('error', errorMessage(e));
      setStep('compose');
    } finally {
      setBusy(false);
    }
  };
  const how = format === 'link' ? 'a link to the transcript in WorkSuite — they sign in to read it' : `the transcript attached as ${format.toUpperCase()}`;
  return (
    <Modal
      title={step === 'confirm' ? 'Send the transcript?' : step === 'done' ? 'Transcript sent' : 'Email transcript'}
      onClose={onClose}
      width={560}
      footer={
        step === 'compose' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!picked.length || !subject.trim()} onClick={() => setStep('confirm')}>
              Review and send
            </Button>
          </>
        ) : step === 'confirm' ? (
          <>
            <Button onClick={() => setStep('compose')}>Back</Button>
            <Button variant="primary" loading={busy} onClick={() => void send()}>
              Send to {picked.length} {picked.length === 1 ? 'person' : 'people'}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {step === 'compose' && q.data ? (
        <div className="flex flex-col gap-2.5 text-[13px]">
          <b className="text-ink">To</b>
          <div className="flex max-h-[26vh] flex-col gap-1 overflow-y-auto scroll-thin">
            {allowed.map((r) => (
              <label key={r.participant_id} className="flex items-center gap-2 rounded-[7px] px-1 py-1 hover:bg-subtle">
                <Checkbox checked={picked.includes(r.participant_id)} onChange={() => setPicked(picked.includes(r.participant_id) ? picked.filter((x) => x !== r.participant_id) : [...picked, r.participant_id])} />
                <span className="flex-1 text-ink">{r.name}</span>
                <span className="text-[11.5px] text-ink-3">{r.email}</span>
              </label>
            ))}
            {excluded.map((r) => (
              <div key={r.participant_id} className="flex items-center gap-2 px-1 py-1 text-ink-3">
                <span className="w-4" />
                <span className="flex-1">{r.name}</span>
                <span className="text-[11.5px]">{r.why}</span>
              </div>
            ))}
          </div>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Subject
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 font-normal text-ink" />
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Message <span className="font-normal text-ink-3">Optional, above the transcript.</span>
            <textarea value={message} maxLength={5000} rows={3} onChange={(e) => setMessage(e.target.value)} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 font-normal text-ink" />
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Send as
            <Select<TranscriptFormat>
              value={format}
              options={formats.map((f) => ({ value: f, label: f === 'link' ? 'A link (they sign in to read it)' : f === 'pdf' ? 'A PDF attached' : 'A text file attached' }))}
              onValueChange={setFormat}
              className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-ink"
            />
          </label>
          {formats.length === 1 ? <span className="text-[12px] text-ink-3">In this meeting only the hosts may see transcripts, so it is sent as a link that checks who opens it.</span> : null}
        </div>
      ) : null}
      {step === 'confirm' ? (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="text-ink-2">Nothing has been sent yet. This is what {picked.length === 1 ? 'they get' : `the ${picked.length} people get`}:</p>
          <div className="rounded-[10px] border border-line bg-subtle p-3">
            <b className="text-ink">{subject}</b>
            {message ? <p className="mt-1.5 whitespace-pre-line text-ink">{message}</p> : null}
            <p className="mt-1.5 text-ink-2">
              The transcript of “{title}”, as {how}.
            </p>
            <p className="mt-1.5 text-[11.5px] text-ink-3">Machine-made transcripts can be wrong. Parts marked “unclear” were hard to hear.</p>
          </div>
          <p className="text-[12px] text-ink-3">To: {allowed.filter((r) => picked.includes(r.participant_id)).map((r) => r.name).join(', ')}</p>
        </div>
      ) : null}
      {step === 'done' && result ? (
        <div className="flex flex-col gap-1.5 text-[13px]">
          {result.deliveries.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="flex-1 text-ink">{d.name}</span>
              <span className={d.status === 'sent' ? 'font-semibold text-success' : 'font-semibold text-danger'}>{d.status === 'sent' ? 'Sent' : `Failed — ${d.error ?? ''}`}</span>
            </div>
          ))}
          {result.skipped.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-ink-3">
              <span className="flex-1">{s.name}</span>
              <span>Not sent — {s.why}</span>
            </div>
          ))}
          {result.deliveries.some((d) => d.status === 'failed') ? <p className="text-[12px] text-ink-3">Failed ones can be sent again from the list under the transcript.</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
