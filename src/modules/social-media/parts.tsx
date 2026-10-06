import { Checkbox } from '../../components/Checkbox';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../core/api';
import { createStore, useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Button, cx, Empty, ErrorNote, Spinner } from '../../components/ui';
import { isNotOffered, NOT_OFFERED, rowsOf, useBrands, type Account, type Brand, type Optional, type PostMedia } from './api';
import { networkInfo } from './lib/networks';
import { ACCOUNT_STATUS, accountStatusLabel, POST_STATUS, TARGET_STATUS, TONE_CLASS, type AccountStatus, type PostStatus, type TargetStatus, type Tone } from './lib/status';

/**
 * Social Media Manager's shared pieces (design "WorkSuite Social Media Manager — UI", 18 artboards): neutral letter
 * chips for networks (never logos), round status pills, page headers with a breadcrumb, KPI tiles, the brand scope,
 * and the honest states — not offered by this server, refused, not measured.
 */

/* ------------------------------------------------------------------------ *
 * Networks and accounts
 * ------------------------------------------------------------------------ */

/** A network's letter chip ("Fb", "Ig", "in", "X", "YT", "TT", "G", "P", "@"). */
export function NetChip({ network, size = 22, className }: { network: string; size?: number; className?: string }) {
  const n = networkInfo(network);
  return (
    <span
      title={n.label}
      role="img"
      aria-label={n.label}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-[6px] font-sans font-bold text-white', className)}
      style={{ width: size, height: size, background: n.colour, fontSize: Math.max(9, Math.round(size * 0.45)) }}
    >
      {n.short}
    </span>
  );
}

export function NetChips({ networks, size = 22, max = 5 }: { networks: string[]; size?: number; max?: number }) {
  const shown = networks.slice(0, max);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {shown.map((n) => (
        <NetChip key={n} network={n} size={size} />
      ))}
      {networks.length > max ? <span className="text-[11px] font-semibold text-ink-3">+{networks.length - max}</span> : null}
    </span>
  );
}

/** An account on one line: chip, name and what it is ("TechHubiz Sri Lanka · Facebook Page"). */
export function AccountLabel({ account, sub, size = 22, className }: { account: Pick<Account, 'network' | 'display_name' | 'handle' | 'account_type'>; sub?: ReactNode; size?: number; className?: string }) {
  const n = networkInfo(account.network);
  return (
    <span className={cx('flex min-w-0 items-center gap-2.5', className)}>
      <NetChip network={account.network} size={size} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold text-ink">{account.display_name}</span>
        <span className="truncate text-[11.5px] text-ink-3">{sub ?? [account.handle, account.account_type ? `${n.label} ${account.account_type}` : n.accountNoun].filter(Boolean).join(' · ')}</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------ *
 * Status pills
 * ------------------------------------------------------------------------ */

export function Pill({ tone, children, className, title }: { tone: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap', TONE_CLASS[tone], className)}>
      {children}
    </span>
  );
}

export function PostStatusPill({ status, className }: { status: PostStatus; className?: string }) {
  const s = POST_STATUS[status] ?? { label: status, tone: 'muted' as const };
  return (
    <Pill tone={s.tone} className={className}>
      {s.label}
    </Pill>
  );
}

export function TargetStatusPill({ status, className }: { status: TargetStatus; className?: string }) {
  const s = TARGET_STATUS[status] ?? { label: status, tone: 'muted' as const };
  return (
    <Pill tone={s.tone} className={className}>
      {s.label}
    </Pill>
  );
}

export function AccountStatusPill({ account }: { account: Pick<Account, 'status' | 'token_expires_at'> }) {
  const s = ACCOUNT_STATUS[account.status as AccountStatus] ?? { label: account.status, tone: 'muted' as const };
  return <Pill tone={s.tone}>{accountStatusLabel(account.status, account.token_expires_at)}</Pill>;
}

/* ------------------------------------------------------------------------ *
 * Page frame
 * ------------------------------------------------------------------------ */

/** The page header: breadcrumb above the title, the brand scope and the page's actions on the right (every artboard). */
export function PageHeader({ crumb, title, actions, scope = true, back }: { crumb: string; title: ReactNode; actions?: ReactNode; scope?: boolean; back?: ReactNode }) {
  return (
    <header className="flex min-h-[68px] shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {back}
        <div className="min-w-0">
          <div className="truncate text-[11.5px] text-ink-3">Social Media Manager · {crumb}</div>
          <h1 className="truncate text-[20px] leading-tight font-bold text-ink">{title}</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {scope ? <BrandScope /> : null}
        {actions}
      </div>
    </header>
  );
}

/** The scroll area under a page header. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('min-h-0 flex-1 overflow-y-auto bg-ground p-5 scroll-thin', className)}>{children}</div>;
}

/** A white section with a title and a link on the right (Coming up / Open calendar). */
export function Panel({ title, sub, action, children, className, bodyClassName }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('flex min-w-0 flex-col rounded-[14px] border border-line bg-surface', className)}>
      {title !== undefined ? (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-ink">{title}</h2>
            {sub ? <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cx('min-h-0 flex-1 px-5 pb-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A text link in a panel's corner ("Open calendar", "All 11"). */
export function PanelLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 text-[13px] font-semibold text-primary underline-offset-2 hover:underline">
      {children}
    </button>
  );
}

/** A KPI tile (W01, W07, A03). `value` null is "Not measured", never a zero (WF-12). */
export function Kpi({ label, value, sub, tone, title }: { label: string; value: ReactNode | null; sub?: ReactNode; tone?: 'success' | 'danger' | 'warning' | 'muted'; title?: string }) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink-3';
  return (
    <div title={title} className="flex min-w-0 flex-col gap-1 rounded-[12px] border border-line bg-surface px-4 py-3">
      <span className="truncate text-[12px] text-ink-3">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {value === null ? <span className="text-[14px] font-semibold text-ink-3">Not measured</span> : <span className="text-[24px] leading-none font-bold text-ink tabular-nums">{value}</span>}
        {sub ? <span className={cx('text-[12px] font-semibold', colour)}>{sub}</span> : null}
      </span>
    </div>
  );
}

/** Underlined tabs along the top of a page ("Waiting for me (4) · Sent by me (3) · …"). */
export function UnderlineTabs<T extends string>({ value, onChange, tabs, label, className }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: ReactNode; count?: number | null }>; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex min-w-0 flex-wrap items-end gap-x-5 gap-y-1 border-b border-line', className)}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cx('-mb-px flex h-9 items-center gap-1 border-b-2 px-0.5 text-[13px] whitespace-nowrap', on ? 'border-primary font-bold text-primary' : 'border-transparent font-medium text-ink-2 hover:text-ink')}
          >
            {t.label}
            {t.count !== undefined && t.count !== null ? <span className="tabular-nums">({t.count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** A segmented switch (Month · Week · List). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-[9px] border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={cx('h-full rounded-[7px] px-3 text-[12.5px] font-semibold', o.id === value ? 'bg-selection text-primary' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Honest states
 * ------------------------------------------------------------------------ */

/** This WorkSuite server has no such endpoint yet (NFR-10). */
export function NotOffered({ what, detail, compact }: { what: string; detail?: ReactNode; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] bg-subtle px-3 py-2.5 text-[12.5px] text-ink-3">
        <Icon name="server" size={15} className="mt-px shrink-0" />
        <span>
          {what} isn’t offered by this WorkSuite server yet.{detail ? <span className="block">{detail}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <Empty
      icon="server"
      title={`${what} isn’t offered by this WorkSuite server yet`}
      hint={
        <>
          {NOT_OFFERED}
          {detail ? <span className="mt-1 block">{detail}</span> : null}
        </>
      }
    />
  );
}

/** A refusal said plainly: no permission, not offered, or the server's own words. */
export function Refused({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.forbidden) return <Empty icon="lock" title="You don’t have permission for this" hint={error.message} />;
  if (isNotOffered(error)) return <NotOffered what="This" />;
  return (
    <div className="p-4">
      <ErrorNote error={error} onRetry={onRetry} />
    </div>
  );
}

type OptionalQuery<T> = { data?: Optional<T>; isLoading: boolean; error: unknown; refetch: () => unknown };

/** Loading, refused, not offered, or the content: the one switch every optional view goes through. */
export function OptionalView<T>({ q, what, children, compact }: { q: OptionalQuery<T>; what: string; children: (data: T) => ReactNode; compact?: boolean }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Refused error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  if (!q.data.offered) return <NotOffered what={what} compact={compact} />;
  return <>{children(q.data.data)}</>;
}

/** A band of note (the kill switch, an attention banner, "Times shown in Asia/Colombo"). */
export function Notice({ tone = 'info', icon = 'info', children, action, className }: { tone?: 'info' | 'warning' | 'success' | 'danger'; icon?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  const tones = {
    info: 'border-primary/25 bg-selection text-ink',
    warning: 'border-warning/30 bg-warning-bg text-warning-ink dark:text-warning',
    success: 'border-success/30 bg-success-bg text-ink',
    danger: 'border-danger/30 bg-danger-bg text-danger',
  } as const;
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'status' : undefined} className={cx('flex flex-wrap items-center gap-2.5 rounded-[12px] border px-4 py-3 text-[13px]', tones[tone], className)}>
      <Icon name={icon} size={17} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Form bits
 * ------------------------------------------------------------------------ */

export const INPUT = 'h-9 w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary disabled:opacity-60';
export const TEXTAREA = 'w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary disabled:opacity-60';

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function NativeSelect({ value, onChange, children, label, className, disabled }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; className?: string; disabled?: boolean }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx(className && /(^|\s)w-/.test(className) ? INPUT.replace('w-full ', '') : INPUT, 'pr-8', className)}>
      {children}
    </select>
  );
}

/** A table that scrolls sideways in a narrow window; heads in small capitals as the design draws them. */
export function Table({ head, children, className, minWidth }: { head: ReactNode[]; children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cx('min-w-0 overflow-x-auto scroll-thin', className)}>
      <table className="w-full border-collapse text-left text-[13px]" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr className="border-b border-line text-[11px] font-semibold tracking-[.04em] text-ink-3 uppercase">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2.5 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const TD = 'px-3 py-2.5 align-middle';
export const TR = 'border-b border-line/70 last:border-b-0';

/** A destructive action that asks once: the button turns into "Confirm". */
export function ConfirmButton({ label, confirm, onConfirm, variant = 'danger', icon, loading, size = 'md' }: { label: string; confirm: string; onConfirm: () => void; variant?: 'danger' | 'secondary' | 'ghost'; icon?: string; loading?: boolean; size?: 'sm' | 'md' }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size={size}
        variant="danger"
        icon={icon}
        loading={loading}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirm}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  ) : (
    <Button size={size} variant={variant} icon={icon} loading={loading} onClick={() => setArmed(true)}>
      {label}
    </Button>
  );
}

/** A small checkbox with its words, for filters and legends. */
export function Check({ checked, onChange, children, swatch }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; swatch?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2 select-none">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {swatch ? <span className={cx('h-2.5 w-2.5 rounded-[3px]', swatch)} aria-hidden /> : null}
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------------ */

const TILE_TONES = ['#1e3a8a', '#0f766e', '#9a3412', '#4338ca', '#9f1239', '#3f6212', '#155e75', '#92400e'];

/** A picture or video as a tile: its preview when the server made one, else a coloured block with its size ("1080×1350"). */
export function MediaTile({ media, className, label = true, onRemove }: { media: Pick<PostMedia, 'name' | 'kind' | 'width' | 'height' | 'thumb_url' | 'duration_seconds' | 'file_id'>; className?: string; label?: boolean; onRemove?: () => void }) {
  const tone = TILE_TONES[Math.abs(media.file_id) % TILE_TONES.length]!;
  const dims = media.width && media.height ? `${media.width}×${media.height}` : media.kind === 'document' ? 'Document' : media.kind.toUpperCase();
  return (
    <div className={cx('group relative overflow-hidden rounded-[10px]', className)} style={{ background: tone }} title={media.name}>
      {media.thumb_url ? <img src={media.thumb_url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : null}
      {media.kind === 'video' ? (
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-[6px] bg-black/45 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
          <Icon name="play" size={11} />
          {media.duration_seconds ? `${Math.floor(media.duration_seconds / 60)}:${String(Math.round(media.duration_seconds % 60)).padStart(2, '0')}` : 'Video'}
        </span>
      ) : null}
      {label ? <span className="absolute bottom-1.5 left-1.5 rounded-[5px] bg-black/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{dims}</span> : null}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${media.name}`} onClick={onRemove} className="absolute top-1.5 right-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white group-hover:flex focus-visible:flex">
          <Icon name="x" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Brand scope
 * ------------------------------------------------------------------------ */

/** Which brand the screens show (all, or one): kept while the module is open, shared by every screen. */
export const scope = createStore<{ brandId: number | null }>({ brandId: null });

export function useBrandScope(): [number | null, (id: number | null) => void] {
  const id = useStore(scope, (s) => s.brandId);
  return [id, (v) => scope.set({ brandId: v })];
}

function BrandDot({ brand }: { brand: Pick<Brand, 'name' | 'color'> | null }) {
  if (!brand) {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-subtle text-ink-2" aria-hidden>
        <Icon name="grid" size={12} />
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[9px] font-bold text-white" style={{ background: brand.color || '#0f172a' }} aria-hidden>
      {initialsOf(brand.name)}
    </span>
  );
}

/** "TechHubiz" → "TH", "CreativeFX" → "CF": the capitals of a brand's name, else its first two letters. */
function initialsOf(name: string): string {
  const caps = name.replace(/[^A-Z]/g, '');
  return (caps.length >= 2 ? caps.slice(0, 2) : name.slice(0, 2)).toUpperCase();
}

/** The header's brand selector: everything is filtered by the brands someone can access (W01 note). */
export function BrandScope() {
  const brands = rowsOf(useBrands().data);
  const [id, setId] = useBrandScope();
  const current = brands.find((b) => b.id === id) ?? null;
  return (
    <label className="relative inline-flex h-8 items-center gap-2 rounded-[8px] border border-line bg-surface pr-7 pl-2 text-[12.5px] font-semibold text-ink">
      <BrandDot brand={current} />
      <span className="max-w-[180px] truncate">{current ? current.name : 'All brands'}</span>
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-2 text-ink-3" />
      <select aria-label="Brand" value={id ?? ''} onChange={(e) => setId(e.target.value ? Number(e.target.value) : null)} className="absolute inset-0 cursor-pointer opacity-0">
        <option value="">All brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Numbers as the design writes them: 48,215 · 412k · 4.6%. */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 100_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

export function full(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US');
}

export function pct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`;
}

/** "+12%", "−12 min", "+0.4 pt". */
export function delta(n: number | null | undefined, kind: 'pct' | 'pt' | 'abs' | 'min' = 'pct'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  const v = Math.abs(n);
  if (kind === 'pct') return `${sign}${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}%`;
  if (kind === 'pt') return `${sign}${v.toFixed(1)} pt`;
  if (kind === 'min') return `${sign}${Math.round(v)} min`;
  return `${sign}${v.toLocaleString('en-US')}`;
}
