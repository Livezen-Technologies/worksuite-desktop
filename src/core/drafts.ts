import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './bridge';

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
} {
  const [value, setValueState] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
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
      timer.current = setTimeout(() => {
        void call('offline:saveDraft', { module, context, content: latest.current }).catch(() => undefined);
      }, 800);
    },
    [module, context],
  );

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void call('offline:saveDraft', { module, context, content: latest.current }).catch(() => undefined);
      }
    },
    [module, context],
  );

  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await call('offline:deleteDraft', { module, context }).catch(() => undefined);
    setRestored(false);
  }, [module, context]);

  return { value, setValue, restored, clear };
}
