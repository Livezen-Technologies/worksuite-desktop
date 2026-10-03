import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { cx } from '../../components/ui';
import type { Suggestion } from './Recipients';

/**
 * @mentions while writing (ENH-MAIL-03 DMO-CMP-14): typing "@" and a few
 * letters in the message offers people from the recipient lookup; choosing
 * one writes "@Name" as a mailto link (so it stands out, here and for the
 * reader) and adds the person to To.
 */

const AT = /(?:^|[\s(])@([^\s@<>]{2,40})$/u;

interface Typing {
  q: string;
  node: Text;
  start: number;
  end: number;
  top: number;
  left: number;
}

/** The "@word" right before the caret in the editor, if there is one. */
export function mentionAtCaret(editor: HTMLElement): Omit<Typing, 'top' | 'left'> | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return null;
  if ((node.parentElement?.closest('a') ?? null) !== null) return null;
  const before = (node.textContent ?? '').slice(0, sel.anchorOffset);
  const m = AT.exec(before);
  if (!m) return null;
  return { q: m[1]!, node: node as Text, start: sel.anchorOffset - m[1]!.length - 1, end: sel.anchorOffset };
}

/** Put "@Name" (a mailto link) in place of what was typed, and a space after it. */
export function insertMention(editor: HTMLElement, at: { node: Text; start: number; end: number }, person: { name: string; email: string }): void {
  const range = document.createRange();
  range.setStart(at.node, at.start);
  range.setEnd(at.node, at.end);
  range.deleteContents();
  const link = document.createElement('a');
  link.href = `mailto:${person.email}`;
  link.textContent = `@${person.name}`;
  const space = document.createTextNode(' ');
  range.insertNode(space);
  range.insertNode(link);
  const sel = window.getSelection();
  const caret = document.createRange();
  caret.setStart(space, 1);
  caret.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(caret);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

export function MentionPopup({ editor, onMention }: { editor: RefObject<HTMLDivElement | null>; onMention: (p: { name: string; email: string }) => void }) {
  const [typing, setTyping] = useState<Typing | null>(null);
  const [found, setFound] = useState<Suggestion[]>([]);
  const [pick, setPick] = useState(0);
  const state = useRef({ typing, found, pick });
  useEffect(() => {
    state.current = { typing, found, pick };
  });
  const choose = (s: Suggestion) => {
    const el = editor.current;
    const t = state.current.typing;
    if (!el || !t || !s.email) return;
    const person = { name: s.name || s.email, email: s.email };
    insertMention(el, t, person);
    setTyping(null);
    setFound([]);
    onMention(person);
  };
  const chooser = useRef(choose);
  useEffect(() => {
    chooser.current = choose;
  });

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    const look = () => {
      const at = mentionAtCaret(el);
      if (!at) return setTyping(null);
      const r = document.createRange();
      r.setStart(at.node, at.start);
      r.setEnd(at.node, at.end);
      const box = typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : el.getBoundingClientRect();
      setTyping({ ...at, top: box.bottom + 4, left: box.left });
    };
    const key = (e: KeyboardEvent) => {
      const { typing: t, found: f, pick: p } = state.current;
      if (!t || f.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setPick((p + (e.key === 'ArrowDown' ? 1 : -1) + f.length) % f.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        chooser.current(f[p] ?? f[0]!);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setTyping(null);
      }
    };
    const leave = () => setTimeout(() => setTyping(null), 150);
    el.addEventListener('input', look);
    el.addEventListener('keyup', look);
    el.addEventListener('keydown', key, true);
    el.addEventListener('blur', leave);
    return () => {
      el.removeEventListener('input', look);
      el.removeEventListener('keyup', look);
      el.removeEventListener('keydown', key, true);
      el.removeEventListener('blur', leave);
    };
  }, [editor]);

  const q = typing?.q ?? '';
  useEffect(() => {
    if (!q) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      apiGet<{ results?: Suggestion[] }>('/api/contacts/lookup', { q, kinds: 'contact,employee,customer,vendor', limit: 6 }, ctl.signal)
        .then((r) => {
          setFound((r?.results ?? []).filter((s) => s.email).slice(0, 6));
          setPick(0);
        })
        .catch(() => setFound([]));
    }, 150);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  if (!typing || found.length === 0) return null;
  return createPortal(
    <ul role="listbox" aria-label={text('Mention someone')} style={{ top: typing.top, left: typing.left }} className="fixed z-[80] w-[280px] overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-lg">
      {found.map((s, i) => (
        <li
          key={`${s.kind}:${s.id}`}
          role="option"
          aria-selected={i === pick}
          onMouseDown={(e) => {
            e.preventDefault();
            choose(s);
          }}
          className={cx('flex cursor-default flex-col px-3 py-1.5 text-[13px]', i === pick ? 'bg-selection' : 'hover:bg-subtle')}
        >
          <span className="truncate font-semibold text-ink">{s.name || s.email}</span>
          <span className="truncate text-[12px] text-ink-3">{s.email}</span>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
