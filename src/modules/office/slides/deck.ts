import type { NavAction } from './keys';

/**
 * Moving through a deck (worksuite-desktop#321): the slide number always inside the deck, whatever was asked.
 * Pure, shared by the viewer, the slideshow and the presenter view.
 */
export function clampSlide(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

export function moveSlide(index: number, count: number, action: NavAction): number {
  switch (action) {
    case 'next':
      return clampSlide(index + 1, count);
    case 'prev':
      return clampSlide(index - 1, count);
    case 'first':
      return 0;
    case 'last':
      return clampSlide(count - 1, count);
  }
}

/** "Slide 3 of 8". */
export function slideLabel(index: number, count: number): string {
  if (count <= 0) return 'No slides';
  return `Slide ${clampSlide(index, count) + 1} of ${count}`;
}

/** Where a slideshow starts: the first slide, or the one on screen (⇧⌘⏎, "from current slide"). */
export function startSlide(current: number, count: number, fromCurrent: boolean): number {
  return fromCurrent ? clampSlide(current, count) : 0;
}

/** The slide shown after this one in the presenter view, or null on the last. */
export function nextSlide(index: number, count: number): number | null {
  return index + 1 < count ? index + 1 : null;
}

/** A speaker note as shown: its text, or "No speaker notes" when it has none. */
export function noteText(notes: readonly string[], index: number): string {
  const t = (notes[index] ?? '').trim();
  return t || 'No speaker notes';
}
