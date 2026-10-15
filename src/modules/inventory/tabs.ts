/**
 * Products in tabs (the "Desktop products" design): beside the list, the products opened from it each keep a tab of
 * their own, so a person can go back and forth between a few without losing their place. The tabs ride on the
 * address — `?tab=prod&open=12,15,9&product=15` — so they come back with the app's tab after a restart, and a tab
 * can be torn into a window of its own like any other.
 *
 * At most `MAX_OPEN` stay open: opening one more closes the oldest that is not the one showing.
 */
export const MAX_OPEN = 8;

/** The ids on the address, in order, each once; anything that is not an id is dropped. */
export function parseOpen(v: string | null | undefined): number[] {
  const out: number[] = [];
  for (const part of (v ?? '').split(',')) {
    const t = part.trim();
    if (!/^\d+$/.test(t)) continue;
    const id = Number(t);
    if (id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

export const serializeOpen = (ids: readonly number[]): string => ids.join(',');

/** One more product open (or the one already open brought forward), keeping to `max`. */
export function openTab(ids: readonly number[], id: number, max = MAX_OPEN): number[] {
  if (ids.includes(id)) return [...ids];
  const next = [...ids, id];
  while (next.length > Math.max(1, max)) next.splice(next.findIndex((x) => x !== id), 1);
  return next;
}

/**
 * A tab closed: the list without it, and which product shows next — the same one when another tab was closed, else
 * the one to its right (or left, at the end), or none when it was the last.
 */
export function closeTab(ids: readonly number[], active: number | null, id: number): { ids: number[]; active: number | null } {
  const at = ids.indexOf(id);
  if (at < 0) return { ids: [...ids], active };
  const next = ids.filter((x) => x !== id);
  if (active !== id) return { ids: next, active };
  return { ids: next, active: next[at] ?? next[at - 1] ?? null };
}

/** The tab `step` away from the one showing, wrapping round (Ctrl+Tab and Ctrl+Shift+Tab in the pane). */
export function stepTab(ids: readonly number[], active: number | null, step: 1 | -1): number | null {
  if (!ids.length) return null;
  const at = active === null ? -1 : ids.indexOf(active);
  if (at < 0) return ids[0]!;
  return ids[(at + step + ids.length) % ids.length]!;
}

/** The address of a product in a tab of the app's own (Open in new tab), or a window of its own. */
export const productRoute = (id: number) => `/inventory?tab=prod&open=${id}&product=${id}`;
