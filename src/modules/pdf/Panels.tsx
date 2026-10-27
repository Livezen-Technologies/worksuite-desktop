import { useEffect, useState, type ReactNode } from 'react';
import type { PdfAttachmentView, PdfDriveDetails, PdfOutlineNode, PdfSearchHit, PdfSearchOptions, PdfSessionView } from '@shared/pdf';
import { call } from '../../core/bridge';
import { bytes } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Chip, Spinner, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import { ticket } from './client';

export type LeftPanel = 'pages' | 'bookmarks' | 'search' | 'attachments';
export type RightPanel = 'properties' | 'comments' | 'versions' | 'activity' | 'pro';

function Tabs<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: Array<{ id: T; label: string; icon: string }>; onChange: (v: T) => void }) {
  return (
    // A segmented control that fits the panel's width: the chosen tab shows its name, the others their icon
    // (named by their tooltip and accessible name).
    <div className="shrink-0 border-b border-line px-2 py-2">
      <div role="tablist" aria-label={label} className="flex gap-0.5 rounded-[9px] bg-subtle p-0.5">
        {items.map((t) => {
          const on = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={t.label}
              title={t.label}
              onClick={() => onChange(t.id)}
              className={cx(
                'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-[7px] text-[12px] font-semibold transition-colors',
                on ? 'flex-[2.2] bg-surface px-2 text-ink shadow-sm' : 'flex-1 px-1 text-ink-3 hover:bg-surface/60 hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={14} className={on ? 'shrink-0 text-primary' : 'shrink-0'} />
              {on ? <span className="truncate">{t.label}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── thumbnails (PDF-VIEW-003, PDF-VIEW-013) ─────────────────────────────

/** A page's thumbnail, drawn again when the document's `revision` changes (an edit). */
export function Thumb({ session, page, width, height, current, onOpen, revision = 0, size = 120, selected }: { session: string; page: number; width: number; height: number; current: boolean; onOpen: () => void; revision?: number; size?: number; selected?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    const t = ticket();
    call('pdf:thumbnail', { session, page, ticket: t }).then(
      (b) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([b.data as BlobPart], { type: b.format === 'png' ? 'image/png' : 'image/jpeg' }));
        setUrl(made);
      },
      () => undefined,
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      else void call('pdf:cancel', { session, tickets: [t] }).catch(() => undefined);
    };
  }, [session, page, revision]);
  const h = Math.round((size * height) / Math.max(1, width));
  return (
    <button type="button" onClick={onOpen} aria-label={`Page ${page + 1}`} aria-current={current ? 'page' : undefined} className="flex w-full flex-col items-center gap-1 py-2">
      <span className={cx('block overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]', (current || selected) && 'outline-3 outline-offset-2 outline-primary')} style={{ width: size, height: h }}>
        {url ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" /> : null}
      </span>
      <span className={cx('text-[11.5px] tabular', current ? 'font-bold text-primary' : 'text-ink-3')}>{page + 1}</span>
    </button>
  );
}

export function Thumbnails({ view, page, onPage }: { view: PdfSessionView; page: number; onPage: (p: number) => void }) {
  const items = view.pages.map((s, i) => ({ i, s }));
  return (
    <VirtualList
      items={items}
      estimate={190}
      getKey={(x) => x.i}
      render={(x) => <Thumb session={view.id} page={x.i} width={x.s[0]} height={x.s[1]} current={x.i === page} onOpen={() => onPage(x.i)} revision={view.edit.revision} />}
    />
  );
}

// ── bookmarks / outline (PDF-VIEW-003, AC-05) ───────────────────────────

function OutlineNodes({ nodes, depth, onGo }: { nodes: PdfOutlineNode[]; depth: number; onGo: (page: number) => void }) {
  return (
    <ul role={depth ? 'group' : 'tree'} aria-label={depth ? undefined : 'Bookmarks'}>
      {nodes.map((n, i) => (
        <OutlineItem key={`${i}-${n.title}`} node={n} depth={depth} onGo={onGo} />
      ))}
    </ul>
  );
}

function OutlineItem({ node, depth, onGo }: { node: PdfOutlineNode; depth: number; onGo: (page: number) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const blocked = node.action === 'launch' || node.action === 'remote' || node.action === 'other';
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={false}>
      <div className="flex items-center gap-0.5" style={{ paddingInlineStart: 4 + depth * 14 }}>
        {node.children.length ? (
          <button type="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} className="flex h-6 w-5 shrink-0 items-center justify-center text-ink-3 hover:text-ink">
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          disabled={node.page === null}
          title={blocked ? 'This bookmark would start another program or open another file; it is blocked.' : node.page === null ? 'This bookmark goes nowhere in this file.' : `Page ${node.page + 1}`}
          onClick={() => node.page !== null && onGo(node.page)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-start text-[12.5px] text-ink hover:bg-subtle disabled:text-ink-3 disabled:hover:bg-transparent"
        >
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
          {blocked ? <Icon name="shield-alert" size={13} className="text-warning" /> : null}
          {node.page !== null ? <span className="shrink-0 text-[11px] text-ink-3 tabular">{node.page + 1}</span> : null}
        </button>
      </div>
      {open && node.children.length ? <OutlineNodes nodes={node.children} depth={depth + 1} onGo={onGo} /> : null}
    </li>
  );
}

export function Bookmarks({ view, onGo }: { view: PdfSessionView; onGo: (page: number) => void }) {
  const [nodes, setNodes] = useState<PdfOutlineNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    call('pdf:outline', { session: view.id }).then(
      (n) => live && setNodes(n),
      (e) => live && setError(String((e as Error)?.message ?? e)),
    );
    return () => {
      live = false;
    };
  }, [view.id]);
  if (error) return <p className="p-3 text-[12.5px] text-danger">{error}</p>;
  if (!nodes) return <Spinner />;
  if (!nodes.length) return <p className="p-4 text-center text-[12.5px] text-ink-3">This PDF has no bookmarks.</p>;
  return (
    <div className="h-full overflow-y-auto py-1.5 scroll-thin">
      <OutlineNodes nodes={nodes} depth={0} onGo={onGo} />
    </div>
  );
}

// ── search (§6.3) ────────────────────────────────────────────────────────

export interface SearchState {
  query: string;
  options: PdfSearchOptions;
  searchId: string | null;
  hits: PdfSearchHit[];
  pagesDone: number;
  done: boolean;
  truncated: boolean;
  error: string | null;
  active: number;
}

export function SearchPanel({ state, pageCount, advanced, inputRef, onQuery, onOptions, onRun, onPick }: {
  state: SearchState;
  pageCount: number;
  advanced: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (q: string) => void;
  onOptions: (o: PdfSearchOptions) => void;
  onRun: () => void;
  onPick: (i: number) => void;
}) {
  const o = state.options;
  // Options as toggle chips that wrap to the panel's width.
  const toggle = (k: keyof PdfSearchOptions, label: string, title?: string) => (
    <button
      type="button"
      aria-pressed={o[k]}
      title={title ?? label}
      onClick={() => onOptions({ ...o, [k]: !o[k] })}
      className={cx('h-6 rounded-full border px-2.5 text-[11.5px] font-semibold', o[k] ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}
    >
      {label}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        role="search"
        className="flex shrink-0 flex-col gap-2 border-b border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          onRun();
        }}
      >
        <div className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input ref={inputRef} aria-label="Find in this PDF" placeholder="Find in this PDF" value={state.query} onChange={(e) => onQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Search options">
          {toggle('matchCase', 'Match case')}
          {toggle('wholeWord', 'Whole word')}
          {toggle('regex', 'Regex', 'Regular expression')}
          {advanced ? toggle('comments', 'Comments') : null}
          {advanced ? toggle('bookmarks', 'Bookmarks') : null}
        </div>
      </form>
      <div className="shrink-0 px-3 py-1.5 text-[11.5px] text-ink-3" aria-live="polite">
        {state.error
          ? <span className="text-danger">{state.error}</span>
          : state.searchId
            ? state.done
              ? `${state.hits.length}${state.truncated ? '+' : ''} result${state.hits.length === 1 ? '' : 's'}`
              : `Searching… page ${state.pagesDone} of ${pageCount} · ${state.hits.length} so far`
            : 'Press Enter to search.'}
      </div>
      <ul aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 scroll-thin">
        {state.hits.slice(0, 2000).map((h, i) => (
          <li key={i}>
            <button type="button" aria-current={state.active === i ? 'true' : undefined} onClick={() => onPick(i)} className={cx('flex w-full flex-col gap-0.5 rounded-[7px] px-2 py-1.5 text-start', state.active === i ? 'bg-selection' : 'hover:bg-subtle')}>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-ink-3">
                Page {h.page + 1}
                {h.source !== 'text' ? <Chip>{h.source === 'comment' ? 'Comment' : 'Bookmark'}</Chip> : null}
              </span>
              <span className="line-clamp-2 text-[12.5px] text-ink-2">
                {h.before}
                <mark className="rounded-[2px] bg-warning-soft px-0.5 text-ink dark:text-ink-4">{h.match}</mark>
                {h.after}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── attachments (never opened here: PDF-SEC-033, PDF-EDIT-043) ─────────

export function Attachments({ view }: { view: PdfSessionView }) {
  const [list, setList] = useState<PdfAttachmentView[] | null>(null);
  useEffect(() => {
    let live = true;
    call('pdf:attachments', { session: view.id }).then(
      (l) => live && setList(l),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [view.id]);
  if (!list) return <Spinner />;
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2.5 scroll-thin">
      {list.length ? null : <p className="p-2 text-center text-[12.5px] text-ink-3">No files are embedded in this PDF.</p>}
      {list.map((a) => (
        <div key={a.index} className="flex items-center gap-2 rounded-[8px] border border-line px-2.5 py-2">
          <Icon name={a.dangerous ? 'shield-alert' : 'paperclip'} size={15} className={a.dangerous ? 'text-danger' : 'text-ink-3'} />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[12.5px] text-ink">{a.name}</b>
            <span className="text-[11.5px] text-ink-3">{bytes(a.size)}{a.dangerous ? ' · would run as a program' : ''}</span>
          </span>
        </div>
      ))}
      {list.length ? <p className="text-[11.5px] leading-[1.45] text-ink-3">Files inside a PDF are listed, never opened or run here.</p> : null}
    </div>
  );
}

// ── the right panel: Properties, Versions, Activity (§4.2, PDF-INT-001/002) ─

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink selectable">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const ENCRYPTION: Record<string, string> = { none: 'None', 'rc4-40': 'RC4 40-bit (weak)', 'rc4-128': 'RC4 128-bit (weak)', '128-bit': '128-bit', 'aes-256': 'AES-256', unknown: 'Encrypted' };

export function Properties({ view, page }: { view: PdfSessionView; page: number }) {
  const i = view.info;
  const s = view.security;
  const p = view.permissions;
  const size = view.pages[page];
  const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const yes = (b: boolean | undefined) => (b === undefined ? '—' : b ? 'Allowed' : 'Not allowed');
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 scroll-thin">
      <section>
        <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Document</h3>
        <Facts
          rows={[
            ['Title', i?.title],
            ['Author', i?.author],
            ['Subject', i?.subject],
            ['Keywords', i?.keywords],
            ['Created', when(i?.created)],
            ['Modified', when(i?.modified)],
            ['Application', i?.creator],
            ['Producer', i?.producer],
            ['PDF version', i?.version],
            ['Pages', String(view.pageCount)],
            ['Page size', size ? `${Math.round((size[0] / 72) * 25.4)} × ${Math.round((size[1] / 72) * 25.4)} mm` : ''],
            ['File size', view.size ? bytes(view.size) : ''],
            ['Where', view.source.label],
          ]}
        />
      </section>
      <section>
        <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Security</h3>
        <Facts
          rows={[
            ['Encryption', ENCRYPTION[s.encryption] ?? s.encryption],
            ['Printing', yes(p?.print)],
            ['Copying', yes(p?.copy)],
            ['Changes', yes(p?.modify)],
            ['Comments', yes(p?.annotate)],
            ['Scripts', s.javascript ? `${s.javascript} found — blocked` : 'None found'],
            ['Launch actions', s.launchActions ? `${s.launchActions} found — blocked` : 'None found'],
            ['Other actions', s.otherActions ? `${s.otherActions} found — never followed` : 'None found'],
            ['Web links', s.externalLinks ? `${s.externalLinks} — each asks first` : 'None'],
            ['Embedded files', s.embeddedFiles ? `${s.embeddedFiles}${s.dangerousFiles ? ` (${s.dangerousFiles} would run as programs)` : ''} — never opened` : 'None'],
            ['XFA forms', s.xfa ? 'Present — not run' : 'None'],
            ['Signatures', s.signatures ? `${s.signatures} (checked in a later version)` : 'None'],
            ['Checked', s.structureScanned ? `All ${view.pageCount} pages and the file's structure` : `${s.pagesScanned} of ${view.pageCount} pages so far…`],
          ]}
        />
      </section>
      {view.capabilities ? (
        <section>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Engine</h3>
          <Facts rows={[['Engine', view.capabilities.engine], ['Version', view.capabilities.version], ['Scripts', 'Never run']]} />
        </section>
      ) : null}
    </div>
  );
}

export function DriveDetails({ view, tab }: { view: PdfSessionView; tab: 'versions' | 'activity' }) {
  const [d, setD] = useState<PdfDriveDetails | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    call('pdf:details', { session: view.id }).then(
      (x) => live && setD(x),
      () => live && setD(null),
    );
    return () => {
      live = false;
    };
  }, [view.id]);
  if (d === undefined) return <Spinner />;
  if (!d) return <p className="p-4 text-center text-[12.5px] text-ink-3">Versions and activity are kept for files in WorkSuite Drive.</p>;
  if (tab === 'versions') {
    return (
      <ul aria-label="Versions" className="flex h-full flex-col gap-1.5 overflow-y-auto p-2.5 scroll-thin">
        {d.versions.length ? null : <li className="p-2 text-center text-[12.5px] text-ink-3">No earlier versions.</li>}
        {d.versions.map((v) => (
          <li key={v.id} className="rounded-[8px] border border-line px-2.5 py-2">
            <div className="flex items-center gap-2 text-[12.5px]">
              <b className="text-ink">v{v.version}</b>
              {v.version === view.source.version ? <Chip tone="indigo">Open</Chip> : null}
              <span className="flex-1" />
              <span className="text-ink-3">{bytes(v.size)}</span>
            </div>
            <div className="text-[11.5px] text-ink-3">{[v.author, new Date(v.createdAt.replace(' ', 'T')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · ')}</div>
            {v.note ? <p className="mt-1 text-[12px] text-ink-2">{v.note}</p> : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul aria-label="Activity" className="flex h-full flex-col gap-1.5 overflow-y-auto p-2.5 scroll-thin">
      {d.activity.length ? null : <li className="p-2 text-center text-[12.5px] text-ink-3">No activity yet.</li>}
      {d.activity.map((a, n) => (
        <li key={n} className="text-[12.5px]">
          <span className="text-ink">{a.description || a.action}</span>
          <div className="text-[11.5px] text-ink-3">{[a.author, a.at].filter(Boolean).join(' · ')}</div>
        </li>
      ))}
    </ul>
  );
}

export function LeftTabs({ value, onChange }: { value: LeftPanel; onChange: (v: LeftPanel) => void }) {
  return (
    <Tabs
      label="Navigation"
      value={value}
      onChange={onChange}
      items={[
        { id: 'pages', label: 'Pages', icon: 'grid' },
        { id: 'bookmarks', label: 'Bookmarks', icon: 'list' },
        { id: 'search', label: 'Search', icon: 'search' },
        { id: 'attachments', label: 'Files', icon: 'paperclip' },
      ]}
    />
  );
}

export function RightTabs({ value, drive, onChange }: { value: RightPanel; drive: boolean; onChange: (v: RightPanel) => void }) {
  return (
    <Tabs
      label="Details"
      value={value}
      onChange={onChange}
      items={[{ id: 'properties' as const, label: 'Properties', icon: 'info' }, { id: 'comments' as const, label: 'Comments', icon: 'chat' }, ...(drive ? [{ id: 'versions' as const, label: 'Versions', icon: 'history' }, { id: 'activity' as const, label: 'Activity', icon: 'activity' }, { id: 'pro' as const, label: 'Pro', icon: 'sparkles' }] : [])]}
    />
  );
}
