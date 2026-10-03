import { useEffect, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Spinner } from '../../components/ui';

/**
 * Spell check’s languages (worksuite-desktop#188), in Settings › Mail ›
 * Signatures. What this computer's spell checker has decides what
 * can be chosen; a language it has no dictionary for (Sinhala — Chromium has
 * none) is shown unavailable with the reason. On macOS the system's own
 * languages are used. A right-click on an underlined word offers corrections.
 */

type State = { choices: Array<{ code: string; label: string; available: boolean; reason?: string }>; current: string[]; system: boolean };

export function SpellingSettings() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    call('mail:spellLanguages').then(
      (s) => live && setState(s),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  const toggle = async (code: string, on: boolean) => {
    if (!state) return;
    const next = on ? [...state.current, code] : state.current.filter((c) => c !== code);
    try {
      const current = await call('mail:setSpellLanguages', { languages: next });
      setState({ ...state, current });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <section aria-label={text('Spelling')} className="mt-6 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13.5px] text-ink">
      <h3 className="text-[15px] font-bold text-ink">{text('Spelling')}</h3>
      <p className="text-[12px] text-ink-3">{text('Misspelt words are underlined as you write; right-click one for corrections or to add it to the dictionary.')}</p>
      {error ? <p className="text-[12.5px] text-ink-3">{text('Spell check languages can be chosen in the desktop app only.')}</p> : !state ? <Spinner label="" /> : null}
      {state?.system ? <p className="text-[12.5px] text-ink-2">{text('On macOS, spelling follows the languages set in System Settings › Keyboard › Text Input.')}</p> : null}
      {state && !state.system ? (
        <ul className="flex flex-col gap-2">
          {state.choices.map((c) => (
            <li key={c.code} className="flex flex-col gap-0.5">
              <label className="flex items-center gap-2">
                <Checkbox aria-label={text('Check spelling in {language}', { language: text(c.label) })} checked={state.current.includes(c.code)} disabled={!c.available || (state.current.length === 1 && state.current.includes(c.code))} onChange={(e) => void toggle(c.code, e.target.checked)} />
                <span className={c.available ? '' : 'text-ink-3'}>{text(c.label)}</span>
              </label>
              {c.reason ? <span className="pl-7 text-[12px] text-ink-3">{text(c.reason)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
