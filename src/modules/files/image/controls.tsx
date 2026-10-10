import { useId, type ReactNode } from 'react';
import { Switch, cx } from '../../../components/ui';

/**
 * The editor's panel controls, on its dark ground (NFR-12: the editor stays dark by design): a heading, a labelled
 * slider with its value, a segmented choice, colour swatches and a switch row. Every one is labelled for a screen
 * reader and works from the keyboard.
 */

export const PANEL_TEXT = 'text-[#E6ECFA]';
export const MUTED = 'text-[#8C9BC0]';
export const FIELD = 'h-8 w-full rounded-[8px] border border-[#24314F] bg-[#0B1120] px-2.5 text-[13px] text-[#E6ECFA] outline-none focus:border-[#5B7BFF] placeholder:text-[#5E6B8C]';
export const TILE = 'rounded-[10px] border border-[#24314F] bg-[#121B33] hover:border-[#3A4C7A]';
export const TILE_ON = 'rounded-[10px] border-2 border-[#5B7BFF] bg-[#1A2650]';

export function Head({ title, onReset, children }: { title: string; onReset?: (() => void) | null; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="flex-1 text-[15px] font-bold text-white">{title}</h2>
      {children}
      {onReset ? (
        <button type="button" onClick={onReset} className="text-[12px] font-semibold text-[#AFC0E8] hover:text-white hover:underline">
          Reset
        </button>
      ) : null}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="mt-1 text-[11px] font-bold tracking-[0.07em] text-[#8C9BC0] uppercase">{children}</span>;
}

export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' | 'success' | 'info' }) {
  const t = { muted: 'border-[#24314F] text-[#AFC0E8]', warning: 'border-[#6B4E12] bg-[#2A2210] text-[#FDE68A]', success: 'border-[#1E4D3D] bg-[#10261F] text-[#9EE6C3]', info: 'border-[#2D3E73] bg-[#121B33] text-[#C9D4FF]' }[tone];
  return <p className={cx('rounded-[10px] border px-3 py-2.5 text-[12px] leading-[1.5]', t)}>{children}</p>;
}

export function Slider({ label, value, min, max, step = 1, unit = '', signed = false, onChange, onDone, disabled, format }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; signed?: boolean; onChange: (v: number) => void; onDone?: () => void; disabled?: boolean; format?: (v: number) => string }) {
  const id = useId();
  const shown = format ? format(value) : `${signed && value > 0 ? '+' : ''}${step < 1 ? value.toFixed(1) : Math.round(value)}${unit}`;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cx('flex flex-col gap-1', disabled && 'opacity-50')}>
      <div className="flex items-center text-[12.5px]">
        <label htmlFor={id} className="flex-1 text-[#E6ECFA]">
          {label}
        </label>
        <span className="font-mono text-[11.5px] text-[#AFC0E8]">{shown}</span>
      </div>
      <input
        id={id}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        onKeyUp={onDone}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[#5B7BFF]"
        style={{ background: `linear-gradient(to right, #5B7BFF ${pct}%, #24314F ${pct}%)` }}
      />
    </div>
  );
}

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[10px] border border-[#24314F] bg-[#0B1120] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx('h-7 flex-1 rounded-[7px] px-2 text-[12.5px] font-semibold disabled:opacity-40', value === o.value ? 'bg-[#23349E] text-white' : 'text-[#AFC0E8] hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SWATCHES = ['#FFFFFF', '#1B1F2E', '#23349E', '#3B5BDB', '#F59E0B', '#E5484D', '#12A594', '#F4EFE6'];

export function Swatches({ label, value, onChange, colours = SWATCHES }: { label: string; value: string; onChange: (c: string) => void; colours?: string[] }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {colours.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c.toLowerCase()} aria-label={c} title={c} onClick={() => onChange(c)} className={cx('h-[26px] w-[26px] rounded-[7px] border', value.toLowerCase() === c.toLowerCase() ? 'border-2 border-[#7FA2FF] ring-2 ring-[#5B7BFF]/40' : 'border-[#3A4C7A]')} style={{ background: c }} />
      ))}
      <label htmlFor={id} className="relative flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] border border-[#3A4C7A] text-[15px] text-[#AFC0E8] hover:text-white" title="Another colour">
        +
        <input id={id} type="color" aria-label={`${label}: another colour`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

export function SwitchRow({ label, sub, checked, onChange, disabled }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[12.5px] text-[#E6ECFA]">{label}</span>
        {sub ? (
          <span id={id} className="text-[11.5px] text-[#8C9BC0]">
            {sub}
          </span>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} describedBy={sub ? id : undefined} />
    </div>
  );
}

export function Chip({ on, children, onClick, title, disabled }: { on?: boolean; children: ReactNode; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} title={title} disabled={disabled} onClick={onClick} className={cx('h-7 rounded-[8px] border px-2.5 text-[12px] font-semibold disabled:opacity-40', on ? 'border-[#5B7BFF] bg-[#1A2650] text-white' : 'border-[#24314F] text-[#C9D4FF] hover:border-[#3A4C7A] hover:text-white')}>
      {children}
    </button>
  );
}

export function DarkButton({ children, onClick, primary, disabled, title, icon, className, ...rest }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; title?: string; icon?: ReactNode; className?: string; 'aria-label'?: string; 'aria-pressed'?: boolean; 'aria-haspopup'?: 'menu'; 'aria-expanded'?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className={cx('inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold whitespace-nowrap disabled:opacity-40', primary ? 'bg-[#3B5BDB] text-white hover:bg-[#4C6EF5]' : 'border border-[#2A3A66] text-[#E6ECFA] hover:bg-white/10', className)}
    >
      {icon}
      {children}
    </button>
  );
}
