import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Modal, cx } from '../../components/ui';
import { navigate } from '../../core/tabs';
import { useTextAi, type Engine, type TextTask } from './textTools';

/**
 * What an AI tool made, to look at before using it (worksuite-desktop#53): where it was made (on this computer or
 * online), the text as it arrives, Try again, and the tool's own actions — Replace, Insert, Copy… Nothing is used,
 * sent or saved until the person chooses one. The result can be edited first.
 */
export function AiTextDialog({
  title,
  task,
  input,
  actions,
  onClose,
}: {
  title: string;
  task: TextTask;
  /** The material, read when the tool runs. */
  input: () => string;
  /** What can be done with the result; each closes the dialog. */
  actions: Array<{ label: string; icon?: string; primary?: boolean; run: (text: string) => void | Promise<void> }>;
  onClose: () => void;
}) {
  const ai = useTextAi();
  const [state, setState] = useState<{ phase: 'working' | 'done' | 'error'; text: string; engine: Engine | null; error?: string }>({ phase: 'working', text: '', engine: ai.engine });
  const [run, setRun] = useState(0);
  const ready = ai.engine !== null;
  const settled = ai.settled;

  useEffect(() => {
    if (!ready || !settled) return;
    let alive = true;
    const job = ai.run(task, input(), (t) => alive && setState((s) => (s.phase === 'working' ? { ...s, text: t } : s)));
    job.done.then(
      (r) => alive && setState({ phase: 'done', text: r.text, engine: r.engine }),
      (e: unknown) => alive && setState((s) => ({ ...s, phase: 'error', error: e instanceof Error ? e.message : 'The AI could not do this just now.' })),
    );
    return () => {
      alive = false;
      job.cancel();
    };
    // One run per Try again; the engine choice is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ready, settled, task]);

  const again = () => {
    setState({ phase: 'working', text: '', engine: ai.engine });
    setRun((n) => n + 1);
  };
  const engine = state.engine ?? ai.engine;
  const where = engine === 'local' ? 'Processing locally' : engine === 'online' ? 'Using online AI' : null;

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Icon name="sparkles" size={17} className="text-primary" /> {title}
        </span>
      }
      onClose={onClose}
      width={600}
      footer={
        <>
          {where ? (
            <span data-testid="ai-where" className="mr-auto flex items-center gap-1.5 text-[12px] text-ink-3" title={engine === 'local' ? 'Made on this computer; nothing was sent.' : 'The text was sent to WorkSuite AI to make this.'}>
              <Icon name={engine === 'local' ? 'cpu' : 'sparkles'} size={13} /> {where}
            </span>
          ) : (
            <span className="mr-auto" />
          )}
          {state.phase !== 'working' && ready ? (
            <Button variant="ghost" icon="refresh" onClick={again}>
              Try again
            </Button>
          ) : null}
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.primary ? 'primary' : 'secondary'}
              icon={a.icon}
              disabled={state.phase !== 'done' || !state.text.trim()}
              onClick={() => void Promise.resolve(a.run(state.text)).then(onClose)}
            >
              {a.label}
            </Button>
          ))}
        </>
      }
    >
      {!ready && settled ? (
        <div role="alert" className="space-y-2 text-[13px] text-ink-2">
          <p>{ai.why}</p>
          <Button size="sm" icon="cpu" onClick={() => (onClose(), navigate('/settings/local-ai'))}>
            Set up Local AI
          </Button>
        </div>
      ) : state.phase === 'error' ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-[10px] bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      ) : (
        <div className="space-y-2">
          {state.phase === 'working' ? (
            <p role="status" className="flex items-center gap-2 text-[12.5px] text-ink-3">
              <Icon name="spinner" size={14} className="animate-spin-slow" /> {engine === 'local' ? 'Working on this computer…' : 'Working…'}
            </p>
          ) : null}
          <textarea
            aria-label="Result"
            value={state.text}
            readOnly={state.phase !== 'done'}
            onChange={(e) => setState((s) => ({ ...s, text: e.target.value }))}
            className={cx('min-h-[220px] w-full resize-y rounded-[10px] border border-line bg-surface p-3 text-[13.5px] leading-[1.55] text-ink outline-none focus:border-primary', state.phase === 'working' && 'text-ink-2')}
          />
          {state.phase === 'done' ? <p className="text-[11.5px] text-ink-3">Check it and change anything you like before you use it.</p> : null}
        </div>
      )}
    </Modal>
  );
}
