import type { Rectangle } from 'electron';

/**
 * Presenting a deck (worksuite-desktop#321): which screen the slides go on and where the presenter view goes.
 *
 * With one screen the slides fill the screen the app is on. With two or more, the slides fill another one — the
 * largest that is not the app's — and the presenter view (current and next slide, notes, timer, clock) takes the
 * screen the app is on, as PowerPoint and Keynote do on a laptop with a projector.
 */
export interface ShowDisplay {
  id: number;
  bounds: Rectangle;
}

export interface ShowPlan {
  slides: number;
  presenter: number | null;
}

export const SHOW_ID = /^[A-Za-z0-9-]{8,64}$/;

export function planShow(displays: ShowDisplay[], hereId: number | null, primaryId: number, wantPresenter = true): ShowPlan | null {
  if (!displays.length) return null;
  const here = displays.find((d) => d.id === hereId) ?? displays.find((d) => d.id === primaryId) ?? displays[0]!;
  const others = displays.filter((d) => d.id !== here.id).sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  const away = others[0];
  if (!away) return { slides: here.id, presenter: null };
  return { slides: away.id, presenter: wantPresenter ? here.id : null };
}

/** The address of a show's window, relative to the app's page. */
export const showHash = (role: 'slideshow' | 'presenter', id: string): string => `/window/${role}?id=${encodeURIComponent(id)}`;

/** A presentation's editor configuration (ONLYOFFICE's `documentType`: `slide`, formerly `presentation`). */
export function isSlidesConfig(config: unknown): boolean {
  const t = config && typeof config === 'object' ? (config as Record<string, unknown>).documentType : null;
  return t === 'slide' || t === 'presentation';
}

/** The Present keys in an editor: ⌘⏎ (Ctrl+Enter) or F5 from the start, with ⇧ from the current slide. */
export function presentKey(input: { key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }, platform: string): { fromCurrent: boolean } | null {
  if (input.alt) return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (input.key === 'F5' && !input.control && !input.meta) return { fromCurrent: input.shift };
  if (input.key === 'Enter' && mod) return { fromCurrent: input.shift };
  return null;
}
