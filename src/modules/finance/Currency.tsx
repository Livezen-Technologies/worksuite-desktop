import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { btnSmall, Field } from '../hr/parts';
import { shortDate } from './api';
import { fxState, methodWords, type CurrencyOption, type FxBlock } from './insight';
import { Notice } from './parts';

/**
 * Showing a report in another currency, and the sentence that has to go with
 * it (FR-FIN-10.03).
 *
 * The translation is the server's, at its rates: amounts earned and spent take
 * the day-weighted average for the window, balances the rate on its last day.
 * Nothing is posted — the ledger stays in its own currency, and so does the
 * transactions file.
 *
 * THE NOTICE IS NOT OPTIONAL. A translated figure looks exactly like an
 * untranslated one, so this always says which currency the figures are in,
 * at which rate, from when, by which method. And when the rate is missing it
 * says so and the figures stay in the base currency: the server refuses to
 * translate rather than taking the rate to be one, and this is the half of
 * that the reader can see. A selector that quietly did nothing would be worse
 * than none — the reader would believe they were reading dollars.
 */
export function CurrencyPicker({ value, options, base, onChange, label = 'Currency' }: { value: string; options: CurrencyOption[]; base: string; onChange: (code: string) => void; label?: string }) {
  // The base is its own option rather than an empty placeholder, which the picker would draw dimmed.
  const list = [{ value: base, label: `${base} — as kept in the books` }, ...options.filter((o) => o.code !== base).map((o) => ({ value: o.code, label: `${o.code} — ${o.name}` }))];
  return (
    <Field label={label} className="w-[250px]">
      <Select aria-label={label} searchable value={value || base} options={list} onValueChange={(v) => onChange(v === base ? '' : v)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
    </Field>
  );
}

/**
 * What the translation did, or why it could not.
 *
 * `positionFx` is the second rate a page holding balances takes. When it is
 * missing and the average is not, the server translates the flows and leaves
 * the balances — one label over two currencies — so the page says it cannot
 * show them and offers the books' own currency instead.
 */
export function FxNotice({ fx, positionFx, onBase, over }: { fx: FxBlock | undefined; positionFx?: FxBlock; onBase?: () => void; /** The window the average was taken over, when it is not the page's. */ over?: string }) {
  const state = fxState(fx, positionFx);
  if (!fx || state === 'base') return null;

  if (state === 'refused') {
    return (
      <Notice tone="amber">
        <Icon name="warning" size={14} className="mr-1 inline" />
        <b>
          Still showing {fx.base}
          {fx.requested ? ` — not ${fx.requested}` : ''}.
        </b>{' '}
        {fx.why} Nothing on this page has been converted, so every figure is the company’s own currency.
      </Notice>
    );
  }

  if (state === 'mixed') {
    return (
      <Notice tone="red" className="flex flex-col items-start gap-2">
        <span>
          <b>
            This cannot be shown in {fx.currency}.
          </b>{' '}
          There is a rate for what was earned and spent, but not for balances on the last day of the period: {positionFx?.why ?? `no ${fx.base} to ${fx.currency} rate for that date.`} Some figures would be translated and some not, under one label, so none are shown. Add the rate under Exchange rates, or read it in {fx.base}.
        </span>
        {onBase ? (
          <button type="button" className={btnSmall} onClick={onBase}>
            Show it in {fx.base}
          </button>
        ) : null}
      </Notice>
    );
  }

  const how = methodWords(fx.method, over);
  return (
    <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">
      Shown in <b className="font-semibold text-ink-2">{fx.currency}</b>, translated from {fx.base} at {fx.rate}
      {fx.rate_date ? ` (${shortDate(fx.rate_date)})` : ''}
      {how ? `, ${how}` : ''}
      {fx.inverted ? ', derived from the reverse pair' : ''}. {fx.note}
      {positionFx?.translated ? (
        <>
          {' '}
          Balances take {positionFx.rate}
          {positionFx.rate_date ? `, the rate on ${shortDate(positionFx.rate_date)}` : ''}.
        </>
      ) : null}
      {fx.caveat ? (
        <>
          {' '}
          <b className="font-semibold text-warning-ink dark:text-warning">{fx.caveat}</b>
        </>
      ) : null}
    </p>
  );
}
