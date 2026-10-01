import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Modal, Spinner } from '../../components/ui';
import type { AutoEmail, TranscriptFormat } from '../meetings/transcripts/api';
import { LANGUAGE_LABEL, plan, type SpeechLanguage } from './transcribe/engine';
import { meet } from './session';

/**
 * Start Transcription (worksuite-desktop#81): the language, where the transcribing happens (said plainly — on this
 * computer, or on the WorkSuite server when that is allowed), and whether the transcript is emailed after the
 * meeting, to whom. Everybody in the meeting is told it is on.
 */
export function StartTranscriptionDialog({ onClose }: { onClose: () => void }) {
  const [language, setLanguage] = useState<SpeechLanguage>('en');
  const [auto, setAuto] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [format, setFormat] = useState<TranscriptFormat>('link');
  const [busy, setBusy] = useState(false);
  const engine = useQuery({ queryKey: ['stt', 'plan'], queryFn: plan, staleTime: 30_000 });
  // The meeting's people, for the email after it: only the ones with an address can be chosen.
  const people = useQuery({
    queryKey: ['meet', meet.uuid, 'record-people'],
    queryFn: async () => (await apiGet<{ participants: Array<{ id: number; name: string; email: string | null }> }>(`/api/meetings/${await meet.meetingRecord()}`)).participants.filter((p) => p.email),
    enabled: auto,
  });
  const start = async () => {
    setBusy(true);
    const autoEmail: AutoEmail | null = auto && picked.length ? { enabled: true, participant_ids: picked, format } : null;
    await meet.startTranscription(language, autoEmail);
    setBusy(false);
    onClose();
  };
  const field = 'h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink';
  return (
    <Modal
      title="Start transcription"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!engine.data?.engine || (auto && !picked.length)} onClick={() => void start()}>
            Start transcription
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Language spoken
          <Select<SpeechLanguage> value={language} options={(Object.keys(LANGUAGE_LABEL) as SpeechLanguage[]).map((k) => ({ value: k, label: LANGUAGE_LABEL[k] }))} onValueChange={setLanguage} className={field} />
        </label>
        {engine.isLoading ? <Spinner /> : null}
        {engine.data ? (
          <p className={engine.data.engine ? 'rounded-[9px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2' : 'rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger'} role="status">
            {engine.data.engine === 'local' ? 'Transcribed on this computer. What is said does not leave it to be transcribed.' : engine.data.note}
          </p>
        ) : null}
        <p className="text-[12.5px] text-ink-2">Everybody in the meeting sees that it is being transcribed. Each person’s words are labelled with their name; a guest who gave none is an unidentified speaker. Unclear speech is marked.</p>
        <label className="flex items-center gap-2 font-semibold text-ink">
          <Checkbox checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Email the transcript after the meeting
        </label>
        {auto ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
            <span className="text-[12px] text-ink-3">Sent once, only if the transcript is made, and only to the people chosen who may see it.</span>
            {people.isLoading ? <Spinner /> : null}
            {people.error ? <p className="text-[12px] text-danger">{errorMessage(people.error)}</p> : null}
            <div className="flex max-h-[30vh] flex-col gap-1 overflow-y-auto scroll-thin">
              {(people.data ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-[7px] px-1 py-1 hover:bg-subtle">
                  <Checkbox checked={picked.includes(p.id)} onChange={() => setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id])} />
                  <span className="flex-1 text-ink">{p.name}</span>
                  <span className="text-[11.5px] text-ink-3">{p.email}</span>
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 font-semibold text-ink">
              Send it as
              <Select<TranscriptFormat>
                value={format}
                options={[
                  { value: 'link', label: 'A link (they sign in to read it)' },
                  { value: 'pdf', label: 'A PDF attached' },
                  { value: 'txt', label: 'A text file attached' },
                ]}
                onValueChange={setFormat}
                className={field}
              />
            </label>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
