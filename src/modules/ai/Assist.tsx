import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { offeredActions, resultLabel, useWriter, write, writerProblem, WRITER_MAX } from './writer';

/**
 * What the AI Assistant does with a piece of text — the same in Quick Ask
 * and in the dock: Translate (into a language chosen here), Rewrite, Shorten,
 * Make professional, Fix grammar; Make a task; Ask WorkSuite. The answer is
 * shown, and nothing happens with it until the person chooses: Insert, Copy,
 * or Open in WorkSuite.
 */
export function Assist({
  text,
  onText,
  language,
  label = 'SELECTED TEXT',
  placeholder = 'Type or paste the text to work on',
  insert,
  onOpen,
  onTask,
  onSearch,
  autoFocus,
  seed,
}: {
  text: string;
  onText: (t: string) => void;
  /** Where Translate goes unless another language is chosen (Settings › AI Assistant). */
  language: string;
  label?: string;
  placeholder?: string;
  /** Insert into the app Quick Ask was opened over, when it can. */
  insert?: { label: string; run: (result: string) => void };
  onOpen?: (text: string, result: string | null) => void;
  onTask: (text: string) => void;
  onSearch: (text: string) => void;
  autoFocus?: boolean;
  /** An answer already given (Quick Ask's, opened in WorkSuite), shown until the next one. */
  seed?: string | null;
}) {
  const info = useWriter();
  const actions = offeredActions(info.data);
  const [lang, setLang] = useState(language);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ action: string; text: string; language: string } | null>(seed ? { action: 'result', text: seed, language } : null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const languages = info.data?.languages?.length ? info.data.languages : [language];
  const empty = text.trim() === '';
  const unavailable = info.isError ? writerProblem(info.error) : info.data && !info.data.available ? 'No AI connection is configured for this workspace yet.' : null;

  const run = async (action: string) => {
    if (empty || busy) return;
    setBusy(action);
    setError(null);
    setCopied(false);
    try {
      setResult({ action, text: await write(action, text, action === 'translate' ? { language: lang } : {}), language: lang });
    } catch (e) {
      setError(writerProblem(e));
    } finally {
      setBusy(null);
    }
  };

  const chip = 'flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-bold tracking-[0.08em] text-ink-3">{label}</span>
        <textarea
          value={text}
          onChange={(e) => onText(e.target.value.slice(0, WRITER_MAX))}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={4}
          aria-label="Text for the assistant"
          className="max-h-40 min-h-[76px] resize-none rounded-[10px] border border-line bg-subtle/60 px-3 py-2 text-[13px] leading-[1.5] text-ink outline-none focus:border-primary"
        />
        {text.length > WRITER_MAX - 1000 ? <span className="text-[11px] text-ink-3">{text.length.toLocaleString()} of {WRITER_MAX.toLocaleString()} characters</span> : null}
      </label>
      {unavailable ? <p className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-strong dark:text-warning">{unavailable}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="What to do with the text">
        {actions.map((a) =>
          a.key === 'translate' ? (
            <span key={a.key} className="flex items-center gap-1">
              <button type="button" className={cx(chip, busy === a.key && 'border-primary text-primary')} disabled={empty || !!busy || !!unavailable} onClick={() => void run(a.key)}>
                <Icon name="globe" size={13} /> {busy === a.key ? 'Translating…' : a.label}
              </button>
              <Select label="Translate into" value={lang} options={languages.map((l) => ({ value: l, label: l }))} onValueChange={setLang} />
            </span>
          ) : (
            <button key={a.key} type="button" className={cx(chip, busy === a.key && 'border-primary text-primary')} disabled={empty || !!busy || !!unavailable} onClick={() => void run(a.key)}>
              {busy === a.key ? 'Working…' : a.label}
            </button>
          ),
        )}
        <button type="button" className={chip} disabled={empty} onClick={() => onTask(text)}>
          <Icon name="tasks" size={13} /> Make a task
        </button>
        <button type="button" className={chip} disabled={empty} onClick={() => onSearch(text)}>
          <Icon name="search" size={13} /> Ask WorkSuite
        </button>
      </div>
      {error ? (
        <p role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      {result ? (
        <section aria-label="The assistant's answer" className="flex min-h-0 flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
          <span className="text-[10.5px] font-bold tracking-[0.08em] text-teal">{resultLabel(result.action, result.language)}</span>
          <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-[1.55] text-ink selectable scroll-thin">{result.text}</p>
          <div className="flex flex-wrap gap-1.5">
            {insert ? (
              <button type="button" onClick={() => insert.run(result.text)} className="h-8 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">
                {insert.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(result.text).then(
                  () => setCopied(true),
                  () => setError('Copying was not allowed here.'),
                )
              }
              className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {onOpen ? (
              <button type="button" onClick={() => onOpen(text, result.text)} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                Open in WorkSuite
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
