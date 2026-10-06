/**
 * The counter's look, as class names over the POS tokens (src/styles.css, `.pos-scope`): a category's tile tint, and
 * the badges. Literal strings, so Tailwind sees every one of them.
 */
export const TINTS = [
  'bg-pos-tint-indigo text-pos-tint-indigo-ink',
  'bg-pos-tint-green text-pos-tint-green-ink',
  'bg-pos-tint-sky text-pos-tint-sky-ink',
  'bg-pos-tint-pink text-pos-tint-pink-ink',
  'bg-pos-tint-amber text-pos-tint-amber-ink',
  'bg-pos-tint-slate text-pos-tint-slate-ink',
] as const;

/** The same category always gets the same tint; a product with none is slate. */
export function tintOf(category: string | null | undefined): (typeof TINTS)[number] {
  if (!category) return TINTS[5];
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return TINTS[h % 5]!;
}

export const BADGE = {
  promo: 'bg-pos-promo text-pos-promo-ink',
  stock: 'bg-pos-stock text-pos-stock-ink',
  stockLow: 'bg-pos-stock-low text-pos-stock-low-ink',
  stockOut: 'bg-pos-stock-out text-pos-stock-out-ink',
  gold: 'bg-pos-tier-gold text-pos-tier-gold-ink',
  account: 'bg-pos-tier-account text-pos-tier-account-ink',
  blind: 'bg-pos-blind text-pos-blind-ink',
} as const;

/** A selected tile, chip or row: the pale fill with the indigo ring. */
export const ON = 'bg-pos-on shadow-[inset_0_0_0_2px_var(--pos-on-ring)]';
/** A resting tile: the panel with its hairline. */
export const OFF = 'bg-pos-panel shadow-[inset_0_0_0_1px_var(--pos-line)]';
