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
  // The server's whisper.cpp models (G-11): local speech stays off until one is downloaded here (Q-05).
  const cat = useQuery({ queryKey: ['stt', 'catalog'], queryFn: () => call('stt:catalog'), staleTime: 5 * 60_000 });
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
      {cat.data?.required && !m ? <p className="text-[12px] text-danger">Your company has switched online transcription off: transcripts need a speech model on this computer.</p> : null}
      {cat.data?.preferred && !cat.data.required && !m ? <p className="text-[12px] text-ink-2">Your company prefers transcripts made on this computer. Download a speech model below.</p> : null}
      {cat.data?.models.length ? (
        <ul aria-label="Speech models from WorkSuite" className="flex flex-col gap-1">
          {cat.data.models.map((x) => (
            <li key={x.id} className="flex items-center gap-2 rounded-[8px] bg-subtle px-3 py-1.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">{x.name}</b>
                <span className="text-[12px] text-ink-3">{bytes(x.bytes)}{x.languages.length ? ` · ${x.languages.join(', ')}` : ''} · checked by SHA-256 before it is kept</span>
              </span>
              {x.installed ? (
                <span className="text-[12px] font-semibold text-success">In use</span>
              ) : (
                <Button size="sm" onClick={() => void act(() => call('stt:install', { id: x.id }), 'Speech model downloaded. Transcripts are made on this computer.')}>
                  Download
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : cat.data?.error ? <p className="text-[12px] text-ink-3">{cat.data.error}</p> : null}
      <p className="text-[12px] text-ink-3">A whisper.cpp model file (ggml). A multilingual one — such as ggml-base or ggml-small — is needed for Sinhala and Tamil; larger ones are more accurate and slower.</p>
    </div>
  );
}
