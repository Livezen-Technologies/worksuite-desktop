import type { ToastMessage } from '@shared/types';
import { createStore } from './store';

export interface Toast extends ToastMessage {
  id: number;
  action?: { label: string; run: () => void };
}

export const toasts = createStore<{ items: Toast[] }>({ items: [] });
let seq = 0;

export function toast(kind: Toast['kind'], text: string, action?: Toast['action'], ttlMs = kind === 'error' ? 7000 : 4500): void {
  const id = ++seq;
  toasts.set((s) => ({ items: [...s.items.slice(-3), { id, kind, text, action }] }));
  setTimeout(() => dismiss(id), ttlMs);
}

export function dismiss(id: number): void {
  toasts.set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}
