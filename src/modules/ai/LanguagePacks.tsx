import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OcrLanguage } from '@shared/ocr';
import { Button, Chip, Spinner } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';

/**
 * Settings › Local AI › Language packs (board D10): what is downloaded to this
 * computer for each language, how big it is, and a way to fetch it before it
 * is needed rather than when it is.
 *
 * WHAT THIS VERSION ACTUALLY HAS, AND WHY THE SCREEN IS SMALLER THAN THE
 * DESIGN. Board D10 lists five packs — English writing, Sinhala writing,
 * speech recognition, document intelligence and the chat model — over an ONNX
 * Runtime panel reporting a GPU provider, total pack storage and typing
 * latencies, with a Performance choice beneath it. Of that, this version has
 * the chat model (llama.cpp, listed above), a speech model for meeting
 * transcripts (whisper.cpp, also above), and the reading packs below. There is
 * no ONNX runtime in the app at all, no writing or document-intelligence
 * packs, and no server catalogue that could offer them: `/api/ai/local/catalog`
 * serves GGUF chat models, whose `purpose` is one of chat, embedding or router.
 *
 * So the runtime panel and the Performance choice are deliberately not drawn.
 * A panel reading "ONNX Runtime · Ready" would be false, measured latencies
 * would have nothing to measure, and a Performance setting that no engine
 * consulted would be a control that quietly does nothing — which is worse than
 * its absence, because somebody would set it and believe it. What is here
 * instead is a sentence saying which packs this version has, so the gap is
 * visible rather than implied.
 *
 * The reading packs were already real, downloaded, size- and SHA-256-pinned —
 * they were simply invisible, fetched on the first picture that needed them.
 * That is the part worth having: a person who will be offline can see which
 * languages are there and get the missing one now, instead of discovering at a
 * site with no signal that reading Sinhala needed a connection.
 */
export function LanguagePacks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'ocr', 'status'], queryFn: () => call('ai:ocrStatus') });
  const [busy, setBusy] = useState<OcrLanguage | null>(null);

  const install = async (id: OcrLanguage, label: string) => {
    setBusy(id);
    try {
      await call('ai:ocrInstall', { language: id });
      await qc.invalidateQueries({ queryKey: ['ai', 'ocr'] });
      toast('success', `${label} can now be read without a connection.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const packs = q.data?.languages ?? [];
  const installed = packs.filter((p) => p.installed);
  return (
    <section aria-labelledby="language-packs-title">
      <h3 id="language-packs-title" className="mt-6 mb-1 text-[14px] font-bold text-ink">Language packs</h3>
      <p className="mb-2 text-[12.5px] text-ink-3">
        Reading text from pictures happens on this computer, with one pack per language. Each is checked against the size and
        checksum WorkSuite names before it is ever loaded. Download the ones you need while you have a connection and they
        work without one afterwards.
        {installed.length ? ` Installed: ${bytes(installed.reduce((n, p) => n + p.bytes, 0))}.` : ''}
      </p>

      {q.isLoading ? <Spinner /> : null}
      {q.isError ? <p className="text-[12.5px] text-danger">The language packs on this computer could not be read.</p> : null}

      {packs.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b border-line py-2.5">
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px] font-semibold text-ink">{p.label}</b>
            <span className="block text-[12px] text-ink-3">Reads {p.label} in pictures and screenshots · {bytes(p.bytes)}</span>
          </span>
          {p.installed ? (
            <Chip tone="success">Installed</Chip>
          ) : (
            <Button size="sm" icon="download" loading={busy === p.id} onClick={() => void install(p.id, p.label)}>
              Download
            </Button>
          )}
        </div>
      ))}

      <p className="mt-2 text-[11.5px] text-ink-3">
        These are the packs this version has. Writing help on this computer — spelling, next word and smart replies — and
        reading fields out of documents are not in it yet, so there is nothing to download for them here. The model that
        answers questions and the speech model for meeting transcripts are above.
      </p>
    </section>
  );
}
