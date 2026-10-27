import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { useTabTitle } from '../../../core/tab-context';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Empty, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { Note } from '../../../components/CardKit';
import { ReplyLine } from '../SlashMenu';
import { useCanned } from './api';
import { matchReplies, type SavedReply } from './profile';
import { savedMatches } from './RingCard';
import {
  BODY_MAX,
  SHORTCUT_MAX,
  TITLE_MAX,
  byShortcut,
  cleanShortcut,
  createReply,
  deleteReply,
  draftOfReply,
  monthLine,
  replyProblems,
  saveReply,
  typedFor,
  type ReplyDraft,
} from './savedReplyList';
import { widgetsList, type WidgetRow } from './widget/design';
import { Labelled } from './widget/parts';
import { siteOf } from './widget/Widgets';

/**
 * Website chats › Saved replies (S-09; WS-WCHAT X-UI-21, UX-SET-10; CAN-01, RDC-03), under SETUP as the design has
 * it: the replies down the left — the shortcut, the title and the start of the words — with "Search replies…" and New
 * reply; the chosen reply's editor — Title, Shortcut, Reply, Available on (All widgets, or one) and how often it was
 * used this month — Delete and Save; and IN THE COMPOSER, the "/" list as an agent sees it while typing the shortcut.
 * `reply` in the address is the reply open, `new` a new one.
 */

export function SavedRepliesScreen({ selected, onSelect }: { selected: string | null; onSelect: (reply: string | null) => void }) {
  useTabTitle('Saved replies');
  const qc = useQueryClient();
  const q = useCanned(true);
  const widgets = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), retry: false });
  const [find, setFind] = useState('');
  const all = byShortcut(q.data?.responses ?? []);
  const shown = savedMatches(all, find);
  const can = Boolean(q.data?.can?.manage);
  const creating = selected === 'new';
  const open = creating ? null : (all.find((r) => String(r.id) === selected) ?? all[0] ?? null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['website', 'canned'] });

  return (
    <div className="flex h-full min-w-0 flex-1 text-[13px] text-ink">
      <section aria-label="Saved replies" className="flex w-[420px] shrink-0 flex-col border-x border-line bg-surface">
        <div className="flex flex-col gap-2.5 border-b border-line/70 p-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] font-bold">Saved replies</h1>
              <p className="text-[12px] text-ink-3">Type "/" in a chat to insert one</p>
            </div>
            <Button size="sm" variant="primary" disabled={!can || !q.data} onClick={() => onSelect('new')}>New reply</Button>
          </div>
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
            <input value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search replies" placeholder="Search replies…" className="h-8 w-full rounded-[8px] border border-line bg-surface pr-2.5 pl-8 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-primary" />
          </div>
        </div>
        {q.isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Spinner /></div>
        ) : q.error ? (
          <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>
        ) : !shown.length ? (
          <div className="flex flex-1">
            {all.length ? <Empty icon="search" title={text('Nothing matches “{q}”', { q: find.trim() })} /> : <Empty icon="bookmark" title="No saved replies yet" hint="Write the answers your team gives most often once, then insert them with “/”." />}
          </div>
        ) : (
          <ul aria-label="Replies" className="flex-1 overflow-y-auto scroll-thin">
            {shown.map((r) => {
              const here = !creating && open?.id === r.id;
              return (
                <li key={r.id} className={cx('border-b border-line/70', here && 'bg-selection/60 shadow-[inset_3px_0_0_var(--color-primary)]')}>
                  <button type="button" aria-current={here ? 'true' : undefined} onClick={() => onSelect(String(r.id))} className="flex w-full min-w-0 flex-col px-4 py-[11px] text-left">
                    <span className="flex min-w-0 items-center gap-2">
                      {r.shortcut ? <span className="shrink-0 font-mono text-[12px] font-medium text-primary">/{r.shortcut}</span> : null}
                      <b className="truncate text-[13.5px]">{r.title}</b>
                    </span>
                    <span className="truncate text-[12px] text-ink-2">{r.body}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <main aria-label="Saved reply" className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-[22px] py-4 scroll-thin">
        {q.data ? (
          creating || open ? (
            <ReplyEditor
              key={creating ? 'new' : open!.id}
              reply={creating ? null : open}
              all={all}
              widgets={widgets.data?.widgets ?? []}
              can={can}
              onSaved={(id) => {
                refresh();
                onSelect(String(id));
              }}
              onDeleted={() => {
                refresh();
                onSelect(null);
              }}
            />
          ) : (
            <div className="flex flex-1"><Empty icon="bookmark" title="Nothing chosen" hint="Choose a reply to change it, or make a new one." /></div>
          )
        ) : null}
      </main>
    </div>
  );
}

function ReplyEditor({ reply, all, widgets, can, onSaved, onDeleted }: { reply: SavedReply | null; all: SavedReply[]; widgets: WidgetRow[]; can: boolean; onSaved: (id: number) => void; onDeleted: () => void }) {
  const saved = draftOfReply(reply);
  const [d, setD] = useState<ReplyDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tried, setTried] = useState(false);
  const fid = useId();
  const set = <K extends keyof ReplyDraft>(k: K, v: ReplyDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const issues = replyProblems(d, all, reply?.id ?? null);
  const blocked = Object.keys(issues).length > 0;
  const dirty = !reply || d.title !== saved.title || cleanShortcut(d.shortcut) !== saved.shortcut || d.body !== saved.body || d.widget_id !== saved.widget_id;
  const show = (k: keyof ReplyDraft) => (tried || reply ? issues[k] : undefined);
  const used = monthLine(reply);
  // The composer's "/" list as it looks with this reply among the rest, while the first letters of its shortcut are typed.
  const self: SavedReply = { id: reply?.id ?? -1, shortcut: cleanShortcut(d.shortcut) || null, title: d.title.trim() || 'New reply', body: d.body };
  const typed = typedFor(d.shortcut);
  const preview = matchReplies([self, ...all.filter((r) => r.id !== self.id && (d.widget_id === null || r.widget_id == null || r.widget_id === d.widget_id))], typed, 3);

  const save = async () => {
    setTried(true);
    if (blocked || !dirty) return;
    setBusy(true);
    const body: ReplyDraft = { title: d.title.trim(), shortcut: cleanShortcut(d.shortcut), body: d.body.trim(), widget_id: d.widget_id };
    try {
      if (reply) {
        await saveReply(reply.id, body);
        onSaved(reply.id);
      } else {
        onSaved((await createReply(body)).id);
      }
      toast('success', 'Saved reply saved');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Saved reply"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2.5">
        <h2 className="min-w-0 flex-1 truncate text-[18px] font-bold">{reply ? (d.title.trim() || reply.title) : 'New reply'}</h2>
        {reply ? <Button type="button" className="text-danger" disabled={!can || busy} onClick={() => setDeleting(true)}>Delete</Button> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={!can || busy || !dirty}>Save</Button>
      </div>
      {!can ? <Note>You can look at these replies. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}

      <fieldset disabled={!can || busy} className="flex flex-col gap-3.5 rounded-[12px] border border-line bg-surface p-4">
        <div className="grid grid-cols-[2fr_1fr] gap-3.5">
          <Labelled label="Title" htmlFor={`${fid}-title`}>
            <input id={`${fid}-title`} maxLength={TITLE_MAX} value={d.title} placeholder="Education discount" onChange={(e) => set('title', e.target.value)} aria-invalid={show('title') ? true : undefined} className={cx('h-[34px] rounded-[8px] border bg-surface px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-primary', show('title') ? 'border-danger' : 'border-line')} />
          </Labelled>
          <Labelled label="Shortcut" htmlFor={`${fid}-shortcut`}>
            <span className={cx('flex h-[34px] items-center rounded-[8px] border bg-surface px-2.5 font-mono text-[12.5px] focus-within:border-primary', show('shortcut') ? 'border-danger' : 'border-line')}>
              <span className="text-ink-3" aria-hidden>/</span>
              <input id={`${fid}-shortcut`} maxLength={SHORTCUT_MAX + 1} value={d.shortcut} placeholder="education" onChange={(e) => set('shortcut', e.target.value.replace(/^\/+/, '').toLowerCase())} aria-invalid={show('shortcut') ? true : undefined} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
            </span>
          </Labelled>
        </div>
        {show('shortcut') ? <span role="alert" className="-mt-2 text-[12px] text-danger">{issues.shortcut}</span> : null}
        <Labelled label="Reply" htmlFor={`${fid}-body`}>
          <textarea id={`${fid}-body`} rows={5} maxLength={BODY_MAX} value={d.body} onChange={(e) => set('body', e.target.value)} aria-invalid={show('body') ? true : undefined} className={cx('min-h-[120px] resize-y rounded-[8px] border bg-surface px-3 py-2.5 text-[13.5px] leading-[1.5] outline-none focus:border-primary', show('body') ? 'border-danger' : 'border-line')} />
        </Labelled>
        {show('title') || show('body') ? <span role="alert" className="-mt-2 text-[12px] text-danger">{issues.title ?? issues.body}</span> : null}
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="font-semibold">Available on</span>
          <Select<string>
            aria-label="Available on"
            className="w-[220px]"
            value={d.widget_id === null ? 'all' : String(d.widget_id)}
            onValueChange={(v) => set('widget_id', v === 'all' ? null : Number(v))}
            options={[{ value: 'all', label: 'All widgets' }, ...widgets.map((w) => ({ value: String(w.id), label: siteOf(w) })), ...(d.widget_id !== null && !widgets.some((w) => w.id === d.widget_id) ? [{ value: String(d.widget_id), label: text('Widget {n}', { n: d.widget_id }) }] : [])]}
          />
          {used ? <span className="text-ink-3">{used}</span> : null}
        </div>
      </fieldset>

      <section aria-label="In the composer" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
        <h3 className="text-[10.5px] font-bold tracking-[0.9px] text-ink-3">IN THE COMPOSER</h3>
        <div className="w-[420px] max-w-full overflow-hidden rounded-[10px] border border-line" role="img" aria-label={text('The “/” list while “/{typed}” is typed', { typed })}>
          <div className="border-b border-line/70 px-3 py-[7px] text-[12px] text-ink-3">/{typed}</div>
          {preview.map((r, i) => (
            <div key={r.id} className={cx('px-3 py-2', i === 0 && 'bg-selection/60')}>
              <ReplyLine r={r} />
            </div>
          ))}
        </div>
      </section>

      {deleting && reply ? <DeleteReply reply={reply} onClose={() => setDeleting(false)} onDeleted={onDeleted} /> : null}
    </form>
  );
}

function DeleteReply({ reply, onClose, onDeleted }: { reply: SavedReply; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const tid = useId();
  const remove = async () => {
    setBusy(true);
    try {
      await deleteReply(reply.id);
      toast('success', 'Saved reply removed');
      onClose();
      onDeleted();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Delete “{name}”?', { name: reply.title })}
      labelledBy={tid}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={busy} onClick={() => void remove()}>Delete</Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">It goes from every composer. Messages already sent with it stay as they are.</p>
    </Modal>
  );
}
