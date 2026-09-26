import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { changedLines, diffLines, hunks } from './diff';
import type { DriveFile } from './api';
import { Select } from '../../components/Select';

interface Opened {
  id: number;
  name: string;
  content: string;
  version: number;
  language: string | null;
  size: number;
  line_ending: 'LF' | 'CRLF' | 'CR';
  bom: boolean;
  editable: boolean;
  lock: { user_id: number; user_name: string | null; mine: boolean; since: string } | null;
  breadcrumb: Array<{ id: number; name: string }>;
}
interface VersionRow {
  id: number;
  version: number;
  size: number;
  note: string | null;
  author: string | null;
  created_at: string;
}

const LINE = 22;
const PAD = 10;
const LANG: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', json: 'JSON', php: 'PHP', py: 'Python', md: 'Markdown', txt: 'Text', css: 'CSS', scss: 'SCSS', html: 'HTML', xml: 'XML', yml: 'YAML', yaml: 'YAML', sql: 'SQL', sh: 'Shell', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift', csv: 'CSV', log: 'Log' };

/** How the file indents: tabs, or the smallest run of leading spaces. */
export function indentOf(text: string): { tabs: boolean; size: number } {
  const lines = text.split('\n').slice(0, 400);
  if (lines.filter((l) => l.startsWith('\t')).length > lines.filter((l) => /^ {2,}\S/.test(l)).length) return { tabs: true, size: 1 };
  const sizes = lines.map((l) => /^( +)\S/.exec(l)?.[1]!.length ?? 0).filter((n) => n > 0);
  return { tabs: false, size: sizes.length ? Math.max(2, Math.min(8, Math.min(...sizes))) : 2 };
}

/** Tidy a text: JSON is laid out again; anything else loses trailing spaces and ends with one newline. */
export function formatText(text: string, ext: string, indent: { tabs: boolean; size: number }): string {
  if (ext === 'json') {
    try {
      return `${JSON.stringify(JSON.parse(text), null, indent.tabs ? '\t' : indent.size)}\n`;
    } catch {
      /* not valid JSON: tidy it like text */
    }
  }
  return `${text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * The code editor (DriveCode): the file on the right, editable; an earlier
 * version on the left with what changed marked on both sides. It holds the
 * file's edit lock while open, saves a new version with ⌘S, and refuses to
 * save over somebody else's newer version.
 */
export function CodeEditor({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'editor', file.id], queryFn: ({ signal }) => apiGet<Opened>(`/api/drive/editor/${file.id}`, undefined, signal), gcTime: 0 });
  const versions = useQuery({ queryKey: ['files', 'editor-versions', file.id], queryFn: ({ signal }) => apiGet<{ current: number; versions: VersionRow[] }>(`/api/drive/editor/${file.id}/versions`, undefined, signal), gcTime: 0 });
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ text: string; version: number } | null>(null);
  const [against, setAgainst] = useState<string>('auto');
  const [readOnly, setReadOnly] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);

  // The file arrives: it is what is saved, and what is being edited.
  const o = q.data;
  if (o && saved === null) {
    setSaved({ text: o.content, version: o.version });
    setText(o.content);
    setReadOnly(!o.editable);
  }

  // Hold the edit lock while open (it lasts five minutes; renewed every four).
  useEffect(() => {
    if (!o?.editable) return;
    let stopped = false;
    const take = async () => {
      try {
        const r = await apiPost<{ taken: boolean; lock: { user_name: string | null; since: string } | null }>(`/api/drive/editor/${file.id}/lock`);
        if (!stopped) setLockedBy(r.taken ? null : `${r.lock?.user_name ?? 'Somebody'} has had it open since ${r.lock?.since ?? 'earlier'}`);
      } catch {
        /* the save still checks */
      }
    };
    void take();
    const t = setInterval(() => void take(), 4 * 60_000);
    return () => {
      stopped = true;
      clearInterval(t);
      void apiDelete(`/api/drive/editor/${file.id}/lock`).catch(() => undefined);
    };
  }, [o?.editable, file.id]);

  const history = versions.data?.versions ?? [];
  const chosen = against === 'auto' ? (history[0] ? String(history[0].id) : 'none') : against;
  const old = useQuery({
    queryKey: ['files', 'editor-version', file.id, chosen],
    queryFn: ({ signal }) => apiGet<{ version: number; content: string }>(`/api/drive/editor/${file.id}/versions/${chosen}`, undefined, signal),
    enabled: chosen !== 'none' && chosen !== 'saved',
  });
  const leftText = chosen === 'saved' ? (saved?.text ?? null) : chosen === 'none' ? null : (old.data?.content ?? null);
  const current = text ?? '';
  const lines = current.split('\n');
  const leftLines = leftText?.split('\n') ?? null;
  const diff = leftLines ? changedLines(leftLines, lines) : null;
  const ops = leftLines ? diffLines(leftLines, lines) : null;
  const dirty = saved !== null && current !== saved.text;
  const ext = (file.extension ?? file.name.split('.').pop() ?? '').toLowerCase();
  const indent = indentOf(current);
  const locked = readOnly || !!lockedBy || !o?.editable;

  const save = async (force = false) => {
    if (!o || saving || locked || !saved) return;
    setSaving(true);
    try {
      const r = await apiPost<{ version: number }>(`/api/drive/editor/${file.id}`, { content: current, version: force ? 0 : saved.version, line_ending: o.line_ending, bom: o.bom });
      setSaved({ text: current, version: r.version });
      setConflict(null);
      toast('success', `Saved as version ${r.version}`);
      void versions.refetch();
      void qc.invalidateQueries({ queryKey: ['files', 'list'] });
      void qc.invalidateQueries({ queryKey: ['files', 'versions', file.id] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      else toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  /** After a refused save: their newer version becomes the text; yours is shown beside it to copy from. */
  const loadTheirs = async () => {
    const mine = current;
    const r = await q.refetch();
    if (!r.data) return;
    setSaved({ text: r.data.content, version: r.data.version });
    setText(r.data.content);
    setConflict(null);
    void versions.refetch();
    toast('info', 'Their version is loaded. Yours is copied, so you can paste back what you need.');
    await navigator.clipboard.writeText(mine).catch(() => undefined);
  };
  const close = () => {
    if (dirty && !window.confirm('Close without saving your changes?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]:not([aria-label^="Edit"])')) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const follow = () => {
    const el = area.current;
    if (!el) return;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
    if (backdrop.current) backdrop.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (left.current) left.current.scrollTop = el.scrollTop;
    const before = el.value.slice(0, el.selectionStart);
    const ln = before.split('\n').length;
    setCursor({ ln, col: el.selectionStart - before.lastIndexOf('\n') });
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || locked) return;
    e.preventDefault();
    const el = e.currentTarget;
    const unit = indent.tabs ? '\t' : ' '.repeat(indent.size);
    const { selectionStart: s, selectionEnd: end } = el;
    const next = current.slice(0, s) + unit + current.slice(end);
    setText(next);
    requestAnimationFrame(() => el.setSelectionRange(s + unit.length, s + unit.length));
  };

  const numbers = lines.map((_, i) => i + 1).join('\n');
  const where = [...(o?.breadcrumb ?? []).map((b) => b.name)].join(' › ') || 'My Drive';

  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit ${file.name}`} className="no-drag fixed inset-0 z-50 flex flex-col bg-[#0D1424] text-[13px] text-[#E6ECFA]">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[#1E2C57] bg-[#0F1B3D] px-4">
        <button type="button" aria-label="Back" onClick={close} className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] hover:bg-white/10"><Icon name="chevron-left" size={18} /></button>
        <b className="truncate text-[14px]">{file.name}</b>
        <span className="truncate text-[12px] text-[#AFC0E8]">{where} · {LANG[ext] ?? (o?.language || 'Text')}</span>
        {o ? (
          <span className={cx('shrink-0 rounded-[10px] px-[9px] py-[3px] text-[11.5px] font-bold', saving ? 'bg-[#16254F] text-[#AFC6FF]' : dirty ? 'bg-[#3D2E12] text-[#FFD28A]' : 'bg-[#123D33] text-[#9EE6C3]')}>
            {saving ? 'Saving…' : dirty ? 'Not saved' : `Saved · version ${saved?.version ?? o.version}`}
          </span>
        ) : null}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-[#C3CEEA]">
          Compare with
          <Select aria-label="Compare with" value={chosen} onChange={(e) => setAgainst(e.target.value)} className="h-8 max-w-[260px] rounded-[7px] border border-[#2A3A66] bg-[#16254F] px-2 text-white">
            <option value="none">Nothing</option>
            {dirty ? <option value="saved">The last save (version {saved?.version})</option> : null}
            {history.map((v) => (
              <option key={v.id} value={v.id}>Version {v.version} · {v.author ?? 'someone'} · {listStamp(v.created_at)}</option>
            ))}
          </Select>
        </label>
        <button type="button" disabled={locked} onClick={() => setText(formatText(current, ext, indent))} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10 disabled:opacity-40">Format</button>
        {o?.editable ? (
          <button type="button" aria-pressed={readOnly} onClick={() => setReadOnly(!readOnly)} className={cx('h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10', readOnly && 'bg-white/10')}>
            {readOnly ? 'Edit' : 'Open read-only'}
          </button>
        ) : null}
        <button type="button" disabled={locked || !dirty || saving} onClick={() => void save()} className="h-[34px] rounded-[8px] bg-[#3B5BDB] px-3.5 font-bold text-white hover:brightness-110 disabled:opacity-40">Save (⌘S)</button>
        <button type="button" aria-label="Close editor" onClick={close} className="ml-1 flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[18px] hover:bg-white/10">×</button>
      </div>
      {lockedBy || (o && !o.editable) || conflict ? (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-[#1E2C57] bg-[#2A2210] px-4 py-2 text-[12.5px] text-[#FFD28A]">
          <Icon name={conflict ? 'warning' : 'lock'} size={14} />
          <span className="flex-1">{conflict ?? (lockedBy ? `${lockedBy}, so it opens read-only here.` : 'You can read this file but not change it.')}</span>
          {conflict ? (
            <>
              <button type="button" onClick={() => void loadTheirs()} className="rounded-[6px] border border-[#6B5626] px-2 py-0.5 font-semibold hover:bg-white/5">Load theirs</button>
              <button type="button" onClick={() => window.confirm('Save your text over their newer version? Theirs stays in Versions.') && void save(true)} className="rounded-[6px] border border-[#6B5626] px-2 py-0.5 font-semibold hover:bg-white/5">Save mine over it</button>
            </>
          ) : null}
        </div>
      ) : null}
      <div className={cx('grid min-h-0 flex-1 gap-px bg-[#1E2C57]', leftText !== null ? 'grid-cols-2' : 'grid-cols-1')}>
        {leftText !== null ? (
          <section aria-label="Earlier version" className="flex min-h-0 flex-col bg-[#0D1424]">
            <div className="flex h-[34px] shrink-0 items-center bg-[#111A31] px-3.5 text-[12px] font-semibold text-[#AFC0E8]">
              {chosen === 'saved' ? `Version ${saved?.version} · as last saved` : `Version ${old.data?.version ?? ''} · ${history.find((v) => String(v.id) === chosen)?.author ?? ''}`}
            </div>
            <div ref={left} className="min-h-0 flex-1 overflow-hidden font-mono text-[12.5px]" style={{ lineHeight: `${LINE}px`, paddingTop: PAD }}>
              {leftLines!.length > 5000 ? (
                <pre className="px-3 whitespace-pre text-[#D6DEF2]">{leftText}</pre>
              ) : null}
              {leftLines!.length > 5000 ? null : leftLines!.map((l, i) => (
                <div key={i} className={cx('flex', diff?.removed.has(i) && 'bg-[rgba(196,50,28,0.22)]')}>
                  <span className="w-11 shrink-0 pr-3.5 text-right text-[#5D6B91] select-none">{i + 1}</span>
                  <span className={cx('whitespace-pre', diff?.removed.has(i) ? 'text-[#FFB4A3]' : 'text-[#D6DEF2]')}>{l || ' '}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section aria-label="This version" className="flex min-h-0 flex-col bg-[#0D1424]">
          {leftText !== null ? (
            <div className="flex h-[34px] shrink-0 items-center bg-[#111A31] px-3.5 text-[12px] font-semibold text-[#AFC0E8]">
              Version {saved?.version ?? ''}{dirty ? ' + your changes' : ''} · you · {locked ? 'read-only' : 'editable'}
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1 overflow-hidden font-mono text-[12.5px]" style={{ lineHeight: `${LINE}px` }}>
            {q.isLoading ? <Spinner /> : null}
            {q.error ? <p className="p-4 text-[#FFB4A3]">{errorMessage(q.error)}</p> : null}
            {o ? (
              <>
                <div ref={gutter} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 w-11 pr-3.5 text-right whitespace-pre text-[#5D6B91] select-none" style={{ paddingTop: PAD }}>
                  {numbers}
                </div>
                <div className="pointer-events-none absolute inset-y-0 right-0 left-11 overflow-hidden">
                  <div ref={backdrop} className="relative" style={{ height: PAD * 2 + lines.length * LINE }}>
                    {diff
                      ? [...diff.added].map((i) => <div key={i} className="absolute right-[-4000px] left-0 bg-[rgba(31,122,77,0.25)]" style={{ top: PAD + i * LINE, height: LINE }} />)
                      : null}
                  </div>
                </div>
                <textarea
                  ref={area}
                  aria-label="File contents"
                  value={current}
                  readOnly={locked}
                  spellCheck={false}
                  wrap="off"
                  onChange={(e) => setText(e.target.value)}
                  onScroll={follow}
                  onSelect={follow}
                  onKeyDown={onKeyDown}
                  className="bare-focus absolute inset-y-0 right-0 left-11 resize-none bg-transparent pr-4 whitespace-pre text-[#D6DEF2] caret-white outline-none"
                  style={{ lineHeight: `${LINE}px`, paddingTop: PAD, paddingBottom: PAD, tabSize: indent.size }}
                />
              </>
            ) : null}
          </div>
        </section>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-[18px] bg-[#0F1B3D] px-3.5 text-[11.5px] text-[#AFC0E8]">
        <span>{ops && diff ? `${hunks(ops)} ${hunks(ops) === 1 ? 'change' : 'changes'} · +${diff.plus} −${diff.minus}` : leftText !== null ? 'Too different to mark line by line' : dirty ? 'Changed since the last save' : 'No changes'}</span>
        <span>Ln {cursor.ln}, Col {cursor.col}</span>
        <span>{indent.tabs ? 'Tabs' : `Spaces: ${indent.size}`}</span>
        <span>UTF-8{o?.bom ? ' with BOM' : ''}</span>
        <span>{o?.line_ending ?? 'LF'}</span>
        <span className="flex-1" />
        <span>Saving makes a new version; the one before stays in Versions.</span>
      </div>
    </div>
  );
}
