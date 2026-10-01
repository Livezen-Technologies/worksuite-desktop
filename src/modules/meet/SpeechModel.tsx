import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call, errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Spinner } from '../../components/ui';

/**
 * The speech model meeting transcripts use on this computer (worksuite-desktop#81): a whisper.cpp model file the
 * person adds once — multilingual ones (“base”, “small”) understand Sinhala and Tamil as well as English. Without one,
 * transcripts are made online, if Settings › AI Assistant allows it.
 */
export function SpeechModelSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stt', 'status'], queryFn: () => call('stt:status') });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ['stt'] });
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (q.isLoading) return <Spinner />;
  const m = q.data?.local.model;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {m ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{m.name}</b>
            <span className="text-[12px] text-ink-3">{bytes(m.size)} · meeting transcripts are made on this computer</span>
          </span>
          <Button size="sm" onClick={() => void act(() => call('stt:chooseModel'), 'Speech model changed.')}>
            Change…
          </Button>
          <Button size="sm" variant="danger" onClick={() => void act(() => call('stt:removeModel'), 'Speech model removed.')}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2">
          <span className="flex-1 text-ink-2">No speech model. Transcripts are made online when Settings › AI Assistant allows it.</span>
          <Button size="sm" variant="primary" onClick={() => void act(() => call('stt:chooseModel'), 'Speech model added. Transcripts are made on this computer.')}>
            Add a speech model…
          </Button>
        </div>
      )}
      <p className="text-[12px] text-ink-3">A whisper.cpp model file (ggml). A multilingual one — such as ggml-base or ggml-small — is needed for Sinhala and Tamil; larger ones are more accurate and slower.</p>
    </div>
  );
}
