import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LocalAIEvent, LocalAIStatus, LocalModelView } from '@shared/local-ai';
import { call, hasDesktop, on } from './bridge';
import { queryClient } from './query';

/**
 * Local AI (WS-SRS-LAI) as the windows see it: models on this computer, the runtime's state, and asking the
 * default model with its answer streamed back. Everything goes through main; a window never sees a model's path.
 */

export const LOCAL_AI_KEY = ['local-ai'] as const;

let wired = false;
function wire(): void {
  if (wired || !hasDesktop()) return;
  wired = true;
  on('ai:localChanged', () => void queryClient.invalidateQueries({ queryKey: LOCAL_AI_KEY }));
}

export function useLocalAIStatus(enabled = true) {
  useEffect(wire, []);
  return useQuery<LocalAIStatus>({ queryKey: [...LOCAL_AI_KEY, 'status'], queryFn: () => call('ai:localStatus'), enabled: enabled && hasDesktop(), staleTime: 5_000 });
}

export function useLocalModels(enabled = true) {
  useEffect(wire, []);
  return useQuery<LocalModelView[]>({ queryKey: [...LOCAL_AI_KEY, 'models'], queryFn: () => call('ai:localModels'), enabled: enabled && hasDesktop(), staleTime: 5_000 });
}

/**
 * A model is installed, chosen, and not failing (or still in) its readiness check: Local AI can answer. A model
 * installed before the check existed (`untested`) still answers, as it did.
 */
export function localReady(models: LocalModelView[] | undefined): LocalModelView | null {
  return models?.find((m) => m.isDefault && m.state === 'installed' && m.readiness !== 'failed' && m.readiness !== 'testing') ?? null;
}

/**
 * The model first-use setup offers (worksuite-desktop#55): nothing is set up yet, and the catalog has a chat model
 * that suits this computer — the one recommended for it, else Gemma 3 4B, else the smallest that fits, else the smallest.
 */
export function suggestedModel(models: LocalModelView[] | undefined): LocalModelView | null {
  const chat = (models ?? []).filter((m) => m.model.purpose === 'chat');
  if (!chat.length || chat.some((m) => m.state === 'installed')) return null;
  const fitting = chat.filter((m) => m.fits);
  const smallest = (list: LocalModelView[]) => [...list].sort((a, b) => a.model.bytes - b.model.bytes)[0];
  // Nothing fits: still offer the smallest, with the warning that it will be slow, rather than nothing at all.
  return fitting.find((m) => m.recommended) ?? fitting.find((m) => m.model.family === 'gemma3' && /4b/i.test(m.model.name)) ?? smallest(fitting) ?? smallest(chat) ?? null;
}

export interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalAsk {
  /** Resolves with the whole answer (or what there was when it was stopped). */
  done: Promise<{ text: string; cancelled: boolean; tokens: number; ms: number }>;
  cancel(): void;
}

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, '');

/** Asks the default model on this computer; `onText` gets the answer so far as it grows. */
export function askLocal(messages: LocalMessage[], onText: (text: string) => void, opts: { maxTokens?: number; temperature?: number } = {}): LocalAsk {
  const id = newId();
  let text = '';
  let off: () => void = () => undefined;
  const done = new Promise<{ text: string; cancelled: boolean; tokens: number; ms: number }>((resolve, reject) => {
    off = on<LocalAIEvent>('ai:localEvent', (ev) => {
      if (ev.id !== id) return;
      if (ev.type === 'chunk') {
        text += ev.text;
        onText(text);
      } else if (ev.type === 'done') {
        off();
        resolve({ text: ev.text || text, cancelled: ev.cancelled, tokens: ev.tokens, ms: ev.ms });
      } else {
        off();
        reject(new Error(ev.message));
      }
    });
    call('ai:localAsk', { id, messages, ...opts }).catch((e: unknown) => {
      off();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
  return { done, cancel: () => void call('ai:localCancel', { id }).catch(() => undefined) };
}
