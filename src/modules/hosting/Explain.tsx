import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { createStore, useStore } from '../../core/store';
import { explain } from './api';
import { Btn, Note, useReadOnly } from './parts';

/**
 * "Explain with AI" (HDM-AI-01): a DNS record or a certificate check in plain words, from the server's AI route. Where
 * the server has none (a 404), the button goes away for the rest of the session rather than failing each time.
 */
export const aiMissing = createStore<{ dns: boolean; certificate: boolean }>({ dns: false, certificate: false });

export function Explain({ kind, id, domain, label }: { kind: 'dns' | 'certificate'; id: number | string; domain?: number; label?: string }) {
  const ro = useReadOnly();
  const missing = useStore(aiMissing, (s) => s[kind]);
  const [state, setState] = useState<{ key: string; busy: boolean; text: string | null; error: string | null }>({ key: '', busy: false, text: null, error: null });
  const key = `${kind}:${domain ?? ''}:${id}`;
  if (missing || ro) return null;
  const mine = state.key === key ? state : { key, busy: false, text: null, error: null };
  const run = async () => {
    setState({ key, busy: true, text: null, error: null });
    try {
      const r = await explain(kind, id, domain);
      if (r === null) {
        aiMissing.set({ [kind]: true } as Partial<{ dns: boolean; certificate: boolean }>);
        return;
      }
      setState({ key, busy: false, text: r || text('The server had nothing to add.'), error: null });
    } catch (e) {
      setState({ key, busy: false, text: null, error: errorMessage(e) });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Btn disabled={mine.busy} onClick={() => void run()}>
          {mine.busy ? 'Explaining…' : (label ?? text('Explain with AI'))}
        </Btn>
      </div>
      {mine.text ? (
        <Note tone="info">
          <span className="whitespace-pre-wrap">{mine.text}</span>
        </Note>
      ) : null}
      {mine.error ? <Note tone="error">{mine.error}</Note> : null}
    </div>
  );
}
