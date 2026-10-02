import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { text, useLanguage } from '../core/i18n';

/**
 * The one dropdown (replaces every native <select> in the app).
 *
 * A button that opens a floating list: check mark on the chosen option,
 * arrow keys, Home/End, Enter and Escape, type-ahead, and a search box once
 * a list is longer than six options (or whenever `searchable` is set). The
 * list is drawn in a portal so it is never clipped by a panel or a dialog,
 * sits below the button — or above it when there is no room — and follows
 * it on scroll.
 *
 * Two ways to give it options, so converting a native select is a rename:
 *  - `<option>` / `<optgroup>` children, with `onChange(e)` reading
 *    `e.target.value` exactly as a native select's handler does;
 *  - an `options` array, with `onValueChange(v)` handing back the option's
 *    own value (a number stays a number).
 * An option whose value is '' is the placeholder: shown dimmed when chosen.
 */
export interface SelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  group?: string;
  disabled?: boolean;
}

export interface SelectProps<T = string> {
  value: T | null | undefined;
  onChange?: (e: { target: { value: string } }) => void;
  onValueChange?: (v: NoInfer<T>) => void;
  /** Typed by `value`: every option's value must be one `value` could hold. */
  options?: Array<SelectOption<NoInfer<T>>>;
  children?: ReactNode;
  'aria-label'?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  id?: string;
  title?: string;
  autoFocus?: boolean;
  /** Before the list opens (the notes toolbar keeps the editor's selection with it). */
  onMouseDown?: () => void;
  /**
   * A list the caller searches — customers across the installation, say,
   * where the options are a page of answers from the server: what is typed is
   * handed over, and the options are shown as given rather than filtered
   * here. The chosen option has to stay among them for its label to show.
   */
  onSearch?: (term: string) => void;
  /** The caller is fetching the options (a search in flight). */
  loading?: boolean;
  /** What the list says when there is nothing in it: "No customer matches", not "Nothing to choose". */
  empty?: string;
}

/** Plain text of an option's children (text, numbers, nested fragments). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** The options described by <option>/<optgroup> children, in order. */
export function optionsFromChildren(children: ReactNode, group?: string): Array<SelectOption<string>> {
  const out: Array<SelectOption<string>> = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string; hidden?: boolean }>;
    if (el.type === Fragment) {
      out.push(...optionsFromChildren(el.props.children, group));
    } else if (el.type === 'optgroup') {
      out.push(...optionsFromChildren(el.props.children, el.props.label));
    } else if (el.type === 'option') {
      if (el.props.hidden) return;
      const label = textOf(el.props.children);
      out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label, disabled: !!el.props.disabled, group });
    }
  });
  return out;
}

/** Case- and accent-insensitive match on the label, the hint and the group. */
export function matches(o: SelectOption<unknown>, q: string): boolean {
  if (!q) return true;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(q.trim());
  return [o.label, o.hint ?? '', o.group ?? ''].some((s) => norm(s).includes(n));
}

const SEARCH_FROM = 7;

/**
 * What a caller's class list says about the dropdown, since class order
 * cannot override Tailwind utilities: layout (width, flex, margins) is kept
 * as given; a short control (h-7/h-8/30px) gets the compact size; white text
 * means it sits on a dark viewer; `bg-selection` marks a filter that is set.
 * Colours, borders and padding come from here, so every dropdown looks alike.
 */
const KEEP = /^!?(w-|min-w-|max-w-|flex-|flex$|grow|shrink|basis-|m[trblxy]?-|self-|col-span|order-)/;
export function lookOf(className = ''): { size: 'sm' | 'md'; dark: boolean; active: boolean; layout: string } {
  const t = className.split(/\s+/).filter(Boolean);
  const plain = t.map((x) => x.replace(/^!/, ''));
  return {
    size: plain.some((x) => /^h-(6|7|8|\[2\dpx\]|\[30px\])$/.test(x)) ? 'sm' : 'md',
    dark: plain.includes('text-white'),
    active: plain.includes('bg-selection'),
    layout: t.filter((x) => KEEP.test(x)).join(' '),
  };
}

export function Select<T = string>(props: SelectProps<T>) {
  useLanguage();
  const { value, onChange, onValueChange, children, disabled, className, placeholder, title } = props;
  const ariaLabel = props['aria-label'] ?? props.label;
  const options = useMemo<Array<SelectOption<T | string>>>(() => (props.options ? props.options : optionsFromChildren(children)), [props.options, children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const remote = !!props.onSearch;
  const searchable = remote || (props.searchable ?? options.length >= SEARCH_FROM);
  const current = options.find((o) => String(o.value) === String(value ?? ''));
  const shown = useMemo(() => (searchable && !remote ? options.filter((o) => matches(o, query)) : options), [options, query, searchable, remote]);
  const onSearch = props.onSearch;
  const search = useCallback((q: string) => {
    setQuery(q);
    onSearch?.(q);
  }, [onSearch]);

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 200), 440, vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const below = vh - r.bottom - 10;
    const above = r.top - 10;
    const want = Math.min(340, 44 + options.length * 34 + (searchable ? 46 : 0));
    if (below >= want || below >= above) setPos({ left, width, top: r.bottom + 4, maxHeight: Math.max(0, Math.min(340, below)) });
    else setPos({ left, width, bottom: vh - r.top + 4, maxHeight: Math.max(0, Math.min(340, above)) });
  }, [options.length, searchable]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    search('');
    if (refocus) trigger.current?.focus();
  }, [search]);

  /** Where the highlight starts for a search: the chosen option if it is listed, else the first that can be chosen. */
  const startAt = (q: string) => {
    const list = searchable && !remote ? options.filter((o) => matches(o, q)) : options;
    const i = q ? -1 : list.findIndex((o) => String(o.value) === String(value ?? ''));
    return i >= 0 ? i : list.findIndex((o) => !o.disabled);
  };

  const openList = (initial = '') => {
    if (disabled) return;
    const q = searchable ? initial : '';
    search(q);
    setActive(startAt(q));
    place();
    setOpen(true);
  };

  const choose = (o: SelectOption<T | string>) => {
    if (o.disabled) return;
    close();
    if (String(o.value) === String(value ?? '')) return;
    onChange?.({ target: { value: String(o.value) } });
    onValueChange?.(o.value as T);
  };

  // Follow the button on scroll and resize; close when the click lands elsewhere.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = (e: Event) => {
      if (pop.current && e.target instanceof Node && pop.current.contains(e.target)) return;
      place();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (trigger.current?.contains(t) || pop.current?.contains(t)) return;
      close(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open, place, close]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open || active < 0) return;
    pop.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const move = (from: number, step: number) => {
    if (!shown.length) return -1;
    let i = from;
    for (let n = 0; n < shown.length; n++) {
      i = (i + step + shown.length) % shown.length;
      if (!shown[i]!.disabled) return i;
    }
    return from;
  };

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (e.key === 'ArrowDown') setActive((a) => move(a, 1));
      else if (e.key === 'ArrowUp') setActive((a) => move(a < 0 ? 0 : a, -1));
      else if (e.key === 'Home') setActive(move(-1, 1));
      else setActive(move(0, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = shown[active];
      if (o) choose(o);
    } else if (e.key === 'Escape') {
      // Only the list closes; the dialog around it stays open.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return onListKey(e);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openList();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (searchable) return openList(e.key);
      // Type-ahead: letters typed in quick succession pick the next option that starts with them.
      const now = Date.now();
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + e.key.toLowerCase() : e.key.toLowerCase(), at: now };
      const hit = options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (hit) choose(hit);
    }
  };

  const placeholderShown = !current || current.value === '';
  const look = lookOf(className);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={props.id}
        autoFocus={props.autoFocus}
        onMouseDown={props.onMouseDown}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        data-value={String(value ?? '')}
        disabled={disabled}
        title={title ?? current?.label}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        className={[
          'bare-focus flex max-w-full min-w-0 cursor-pointer items-center gap-2 border text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-default disabled:opacity-50',
          look.size === 'sm' ? 'h-[30px] rounded-[7px] px-2 text-[12.5px]' : 'h-[34px] rounded-[8px] px-2.5 text-[13px]',
          look.dark
            ? 'border-[#2A3A66] bg-[#16254F] text-white hover:border-[#3B4E85]'
            : look.active
              ? 'border-primary bg-selection font-semibold text-primary'
              : open
                ? 'border-primary bg-surface text-ink ring-2 ring-primary/20'
                : 'border-line bg-surface text-ink hover:border-[#C2C9DA] focus-visible:border-primary dark:hover:border-ink-3/60',
          look.layout,
        ].join(' ')}
      >
        <span className={'min-w-0 flex-1 truncate ' + (placeholderShown && !look.active ? (look.dark ? 'text-white/60' : 'text-ink-3') : '')}>{current ? current.label : (placeholder ?? (value ? String(value) : text('Choose…')))}</span>
        <Icon name="chevron-down" size={14} className={'shrink-0 transition-transform ' + (look.dark ? 'text-white/70 ' : look.active ? 'text-primary ' : 'text-ink-3 ') + (open ? 'rotate-180' : '')} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={pop}
              className="no-drag animate-in fixed z-[80] flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.22)]"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
              onKeyDown={onListKey}
            >
              {searchable ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5">
                  <Icon name="search" size={14} className="shrink-0 text-ink-3" />
                  <input
                    autoFocus
                    aria-label={text('Search {label}', { label: ariaLabel ?? text('options') })}
                    aria-controls={listId}
                    value={query}
                    onChange={(e) => (search(e.target.value), setActive(startAt(e.target.value)))}
                    placeholder={text('Search…')}
                    className="bare-focus h-[38px] min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                  />
                  {query ? (
                    <button type="button" aria-label={text('Clear the search')} onClick={() => (search(''), setActive(startAt('')))} className="flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
                      <Icon name="x" size={12} />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div id={listId} role="listbox" aria-label={ariaLabel} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto py-1 scroll-thin">
                {shown.map((o, i) => {
                  const head = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
                  const on = String(o.value) === String(value ?? '');
                  return (
                    <Fragment key={`${String(o.value)}-${i}`}>
                      {head ? <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">{head}</div> : null}
                      <div
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={on}
                        aria-disabled={o.disabled || undefined}
                        data-value={String(o.value)}
                        data-index={i}
                        onMouseEnter={() => !o.disabled && setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(o)}
                        className={
                          'mx-1 flex min-h-[32px] cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1 text-[13px] ' +
                          (o.disabled ? 'cursor-default text-ink-3/60 ' : i === active ? 'bg-selection text-ink ' : 'text-ink ') +
                          (o.value === '' ? 'text-ink-3 ' : '')
                        }
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={'truncate ' + (on ? 'font-semibold' : '')}>{o.label}</span>
                          {o.hint ? <span className="truncate text-[11.5px] text-ink-3">{o.hint}</span> : null}
                        </span>
                        {on ? <Icon name="check" size={14} className="shrink-0 text-primary" /> : null}
                      </div>
                    </Fragment>
                  );
                })}
                {!shown.length ? <div className="px-3 py-3 text-center text-[12.5px] text-ink-3">{props.loading ? text('Searching…') : (props.empty ?? (query ? text('Nothing matches “{query}”.', { query }) : text('Nothing to choose.')))}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
