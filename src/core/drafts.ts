import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './bridge';

// Saves still waiting out their debounce, so a draft can be written now —
// before the same conversation opens in another window (#103), which reads it.
const pending = new Map<string, () => Promise<void>>();

export function hasPendingDrafts(): boolean {
  return pending.size > 0;
}

/** Writes every draft still waiting to be saved, and resolves once they are. */
export async function flushDrafts(): Promise<void> {
  const saves = [...pending.values()];
  pending.clear();
  await Promise.all(saves.map((save) => save()));
}

/**
 * Draft recovery (FR-OFF-07, NFR-REL-02): an editor's content is saved,
 * encrypted, within a second of the last change (well inside the five-second
 * bound), and offered back when the same editor opens again — after a crash,
 * a restart or an expired session.
 */
export function useDraft<T>(module: string, context: string, initial: T): {
  value: T;
  setValue: (v: T) => void;
  restored: boolean;
  clear: () => Promise<void>;
  /** A change is waiting to be written, or being written. */
  saving: boolean;
  /** When this editor's draft was last written on this computer (ISO), or null before the first save. */
  savedAt: string | null;
} {
  const [value, setValueState] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);

  useEffect(() => {
    let alive = true;
    call('offline:getDraft', { module, context })
      .then((d) => {
        if (alive && d && d.content !== null && d.content !== undefined) {
          setValueState(d.content as T);
          latest.current = d.content as T;
          setRestored(true);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [module, context]);

  const setValue = useCallback(
    (v: T) => {
      latest.current = v;
      setValueState(v);
      if (timer.current) clearTimeout(timer.current);
      const key = `${module}\u0000${context}`;
      const save = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.delete(key);
        return call('offline:saveDraft', { module, context, content: latest.current }).then(
          () => {
            setSaving(false);
            setSavedAt(new Date().toISOString());
          },
          () => setSaving(false),
        );
      };
      pending.set(key, save);
      setSaving(true);
      timer.current = setTimeout(() => { void save(); }, 800);
    },
    [module, context],
  );

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        pending.delete(`${module}\u0000${context}`);
        void call('offline:saveDraft', { module, context, content: latest.current }).catch(() => undefined);
      }
    },
    [module, context],
  );

  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.delete(`${module}\u0000${context}`);
    await call('offline:deleteDraft', { module, context }).catch(() => undefined);
    setRestored(false);
    setSaving(false);
  }, [module, context]);

  return { value, setValue, restored, clear, saving, savedAt };
}
