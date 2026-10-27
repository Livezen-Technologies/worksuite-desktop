import { useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { askAi, saveDescription, type AiAnswer, type EditorSettings } from './api';
import { Chip, DarkButton, FIELD, Head } from './controls';
import { applyAiSteps, type Recipe, type Rect } from './recipe';

/**
 * The AI assistant (AI-01…11, P06). It suggests; the editor edits. A suggestion comes back as ordinary editor steps,
 * previewed on the canvas ("Preview — not applied") until Apply puts them in the recipe and the undo history. Nothing
 * is sent until the person asks; the picture goes downscaled to 1536 px with no EXIF or GPS. The conversation lives
 * only as long as this panel: it is not saved with the picture.
 */
interface Turn {
  me?: string;
  action?: string;
  answer?: AiAnswer;
  /** The steps as the editor understood them. */
  used?: string[];
  recipe?: Recipe;
  applied?: boolean;
  error?: string;
}

export interface AiPanelProps {
  fileId: number | null;
  ai: NonNullable<EditorSettings['ai']>;
  recipe: Recipe;
  picture: { w: number; h: number };
  /** The picture as it looks now, ready to send (≤ 1536 px, re-encoded). */
  makeImage: () => Promise<Blob>;
  onPreview: (r: Recipe | null, crops: Rect[]) => void;
  onApply: (r: Recipe, summary: string) => void;
  onEditPanel: (tool: 'filters' | 'adjust' | 'crop') => void;
}

export function AiPanel(p: AiPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const allowed = (a: string) => a === 'generative' || !p.ai.actions || p.ai.actions.includes(a as never);
  const provider = answered || p.ai.provider_label || 'WorkSuite AI · Org default';

  const ask = async (action: 'suggest' | 'alt_text' | 'caption' | 'crop', text: string, ratio?: string) => {
    if (!p.fileId || busy) return;
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    setTurns((t) => [...t, { me: text }]);
    try {
      const image = await p.makeImage();
      const answer = await askAi(p.fileId, { action, prompt: action === 'suggest' ? text : undefined, ratio, image }, ctl.signal);
      if (answer.provider) setAnswered(answer.provider);
      let turn: Turn = { answer, action };
      if (answer.steps?.length) {
        const { recipe, used } = applyAiSteps(p.recipe, answer.steps, p.picture);
        turn = { ...turn, recipe, used };
        p.onPreview(recipe, []);
      } else if (answer.crops?.length) p.onPreview(null, answer.crops);
      setTurns((t) => [...t, turn]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setTurns((t) => [...t, { error: errorMessage(e) }]);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const apply = (i: number) => {
    const turn = turns[i];
    if (!turn?.recipe) return;
    p.onApply(turn.recipe, (turn.used ?? []).join(', '));
    setTurns((t) => t.map((x, n) => (n === i ? { ...x, applied: true } : x)));
  };

  const send = () => {
    const text = prompt.trim();
    if (!text) return;
    setPrompt('');
    void ask('suggest', text);
  };

  const chips: Array<{ label: string; run: () => void; action: string; disabled?: string }> = [
    { label: 'Auto-enhance', action: 'suggest', run: () => void ask('suggest', 'Auto-enhance this photo') },
    { label: 'Warmer sky', action: 'suggest', run: () => void ask('suggest', 'Make the sky warmer') },
    { label: 'Crop for Instagram', action: 'crop', run: () => void ask('crop', 'Suggest a crop for an Instagram post', '4:5') },
    { label: 'Write alt text', action: 'alt_text', run: () => void ask('alt_text', 'Write alt text') },
    { label: 'Suggest caption', action: 'caption', run: () => void ask('caption', 'Suggest a caption') },
    { label: 'Remove background', action: 'generative', run: () => undefined, disabled: p.ai.unavailable?.generative ?? (p.ai.image_model ? 'Generative edits are not available in the desktop editor yet.' : 'Needs image model') },
  ];
  const shown = chips.filter((c) => allowed(c.action));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Head title="AI assistant">
        <span data-testid="ai-provider" className="text-[12px] text-stage-accent">{provider}</span>
      </Head>
      <p className="text-[12px] leading-[1.5] text-stage-accent">Runs through your organization’s AI provider. Nothing is sent until you ask; the picture goes small, without its location or camera details. Suggestions arrive as normal editing steps you can change or undo.</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <Chip key={c.label} disabled={!!c.disabled || busy} title={c.disabled} onClick={c.run}>
            {c.label}
          </Chip>
        ))}
      </div>
      {shown.some((c) => c.action === 'generative' && c.disabled === 'Needs image model') ? <span className="text-[11.5px] text-ink-4">Remove background needs an image model — not configured for this organization.</span> : null}
      <div aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-thin">
        {turns.map((t, i) =>
          t.me ? (
            <p key={i} className="ml-8 self-end rounded-[12px] bg-brand-soft px-3 py-2 text-[12.5px] text-white">
              {t.me}
            </p>
          ) : t.error ? (
            <p key={i} className="rounded-[10px] border border-stage-gray-2 bg-stage-gray px-3 py-2 text-[12.5px] text-stage-danger">
              {t.error}
            </p>
          ) : (
            <div key={i} className="flex flex-col gap-2 rounded-[12px] border border-stage-line-soft bg-stage-2 px-3 py-2.5 text-[12.5px] text-stage-ink">
              {t.answer?.summary ? <span>{t.answer.summary}</span> : null}
              {t.used?.length ? (
                <>
                  <span>{`Here is a plan — ${t.used.length} ${t.used.length === 1 ? 'step' : 'steps'}, previewed on the canvas:`}</span>
                  <ul className="flex flex-col divide-y divide-primary">
                    {t.used.map((u) => (
                      <li key={u} className="py-1.5">
                        {u}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <DarkButton primary disabled={t.applied} onClick={() => apply(i)}>
                      {t.applied ? 'Applied' : `Apply ${t.used.length} ${t.used.length === 1 ? 'step' : 'steps'}`}
                    </DarkButton>
                    {!t.applied ? (
                      <DarkButton onClick={() => (apply(i), p.onEditPanel('filters'))}>Adjust first</DarkButton>
                    ) : null}
                    {!t.applied ? <DarkButton onClick={() => p.onPreview(null, [])}>Discard</DarkButton> : null}
                  </div>
                </>
              ) : null}
              {(t.answer?.steps || t.answer?.dropped) && !t.used?.length ? <span className="text-ink-4">The suggestion used tools this editor does not have, so nothing was changed.</span> : null}
              {t.answer?.crops?.length ? <span>{`${t.answer.crops.length} suggested ${t.answer.crops.length === 1 ? 'crop is' : 'crops are'} on the picture — click one to use it.`}</span> : null}
              {t.answer?.text && (t.action === 'alt_text' || t.action === 'caption') ? <Words text={t.answer.text} kind={t.action === 'alt_text' ? 'alt' : 'caption'} fileId={p.fileId} /> : t.answer?.text ? <span>{t.answer.text}</span> : null}
            </div>
          ),
        )}
        {busy ? (
          <span className="flex items-center gap-2 text-[12px] text-stage-accent">
            <Icon name="spinner" size={14} className="animate-spin" />
            Thinking…
            <button type="button" onClick={() => abort.current?.abort()} className="font-semibold underline">
              Stop
            </button>
          </span>
        ) : null}
      </div>
      {allowed('suggest') ? (
        <div className="flex items-center gap-1.5">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} maxLength={500} placeholder="Describe a change…" aria-label="Describe a change" className={cx(FIELD, 'h-10')} />
          <DarkButton aria-label="Send" disabled={!prompt.trim() || busy} onClick={send} icon={<Icon name="send" size={14} />}>
            {''}
          </DarkButton>
        </div>
      ) : null}
    </div>
  );
}

function Words({ text, kind, fileId }: { text: string; kind: 'alt' | 'caption'; fileId: number | null }) {
  const [saved, setSaved] = useState(false);
  const words = kind === 'alt' ? text.slice(0, 250) : text;
  return (
    <>
      <q className="italic">{words}</q>
      <div className="flex gap-2">
        {fileId ? (
          <DarkButton
            disabled={saved}
            onClick={() =>
              void saveDescription(fileId, words).then(
                () => (setSaved(true), toast('success', 'Saved to the file’s description')),
                (e) => toast('error', errorMessage(e)),
              )
            }
          >
            {saved ? 'Saved to the description' : 'Save to file description'}
          </DarkButton>
        ) : null}
        <DarkButton onClick={() => void navigator.clipboard?.writeText(words).then(() => toast('success', 'Copied'))}>Copy</DarkButton>
      </div>
    </>
  );
}
