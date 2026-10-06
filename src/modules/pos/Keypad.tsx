import type { InputHTMLAttributes, ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { clean, grouped, type PadRules } from './keypad';

/**
 * The till's number pad and the big amount it types into, shared by payment, cash in and out, and counting the
 * drawer. The pad is for the touch screen; the amount is a field, so a keyboard types into it as well.
 */
const DEFAULT_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back'];

const LABEL: Record<string, string> = { back: 'Delete', clear: 'Clear', next: 'Next', '.': 'Point' };

export function Keypad({
  onKey,
  keys = DEFAULT_KEYS,
  size = 'md',
  tone = 'key',
  labels = {},
  disabled,
  className,
}: {
  onKey: (key: string) => void;
  keys?: string[];
  /** 64px keys (md) or 76px (lg, the register's open and close). */
  size?: 'md' | 'lg';
  /** `key`: grey keys in a white dialog; `panel`: white keys on the grey ground. */
  tone?: 'key' | 'panel';
  labels?: Record<string, ReactNode>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Number pad" className={cx('grid grid-cols-3 gap-2', size === 'lg' && 'gap-2.5', className)}>
      {keys.map((k) => {
        const label = labels[k] ?? (k === 'back' ? <Icon name="backspace" size={24} /> : LABEL[k] ?? k);
        const word = /^[a-z]+$/.test(k);
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            aria-label={typeof label === 'string' ? label : (LABEL[k] ?? k)}
            // Keep the focus where it is (the amount, or the count being typed): the pad only types.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onKey(k)}
            className={cx(
              'flex items-center justify-center font-mono font-bold text-ink active:scale-[.97] disabled:opacity-40',
              size === 'lg' ? 'h-[76px] rounded-pos-lg text-[26px]' : 'h-touch-xl rounded-pos text-[22px]',
              word && 'font-sans text-[16px]',
              tone === 'key' ? 'bg-pos-key hover:brightness-95' : 'bg-pos-panel shadow-[inset_0_0_0_1px_var(--pos-line)] hover:bg-pos-key',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The amount being typed, big and right-aligned (thousands grouped as it is typed). `value` is the plain typed
 * figure ("7000.5"); a keyboard's typing is cleaned the same way the pad's is.
 */
export function BigAmount({
  value,
  onChange,
  rules,
  size = 'md',
  currency,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> & { value: string; onChange: (v: string) => void; rules?: PadRules; size?: 'md' | 'lg'; currency?: string }) {
  return (
    <label className={cx('flex items-center gap-3 rounded-pos border-2 border-primary bg-pos-panel px-[18px]', size === 'lg' ? 'h-[68px]' : 'h-touch-xl', className)}>
      {currency ? <span className="font-mono text-[16px] font-bold text-ink-3">{currency}</span> : null}
      <input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        {...rest}
        value={grouped(value)}
        onChange={(e) => onChange(clean(e.target.value, rules))}
        className={cx('bare-focus min-w-0 flex-1 bg-transparent text-right font-mono font-bold text-ink outline-none placeholder:text-ink-3/60', size === 'lg' ? 'text-[32px]' : 'text-[30px]')}
      />
    </label>
  );
}
