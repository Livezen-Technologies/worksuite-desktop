import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type DragEvent, type KeyboardEvent } from 'react';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { useTabTitle } from '../../../core/tab-context';
import { Button, Empty, ErrorNote, Modal, Spinner, Switch, TextField, cx } from '../../../components/ui';
import { Note } from '../../account/parts';
import { designOf, siteNameOf, widgetsList, withDefaults } from './widget/design';
import { Labelled, WidgetPicker } from './widget/parts';
import { WidgetPreview } from './widget/WidgetPreview';
import {
  ANSWER_MAX,
  LABEL_MAX,
  answerLine,
  createStarter,
  deleteStarter,
  moved,
  previewLabels,
  reorderStarters,
  saveStarter,
  starterProblems,
  startersFor,
  startersOf,
  type Starter,
  type StarterDraft,
  type StartersPayload,
} from './starterList';

/**
 * Website chats › Conversation starters (S-08; WS-WCHAT X-UI-20, UX-SET-09; STR-01…04), under SETUP as the design has
 * it: one widget's starters as a table — the handle to drag one into place, BUTTON, INSTANT ANSWER ("An agent will
 * reply" without one), USED and an ON switch saved as it is flipped — the chosen starter's editor (Title, Order,
 * Instant answer) under it, and beside them a PREVIEW of the widget's new chat with the starters that are on.
 * `widget` in the address is the widget shown, `starter` the starter open (`new` for a new one).
 */

const KEY = ['website', 'starters'];
const COLS = 'grid grid-cols-[30px_minmax(0,2fr)_minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,0.6fr)] items-center';

export function ConversationStarters({ widget, selected, onSelect }: { widget: number | null; selected: string | null; onSelect: (widget: number, starter: string | null) => void }) {
  useTabTitle('Conversation starters');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), retry: false });
  const q = useQuery({ queryKey: KEY, queryFn: ({ signal }) => startersOf(signal), retry: false });
  const widgets = list.data?.widgets ?? [];
  const row = widgets.find((w) => w.id === widget) ?? widgets[0] ?? null;
  const wid = row?.id ?? 0;
  const design = useQuery({ queryKey: ['website', 'widget-design', wid], queryFn: ({ signal }) => designOf(wid, signal), retry: false, enabled: wid > 0 });
  const starters = startersFor(q.data?.starters ?? [], wid);
  const can = Boolean(q.data?.can?.manage);
  const creating = selected === 'new';
  const open = creating ? null : (starters.find((s) => String(s.id) === selected) ?? starters[0] ?? null);
  const [dragging, setDragging] = useState<number | null>(null);
  // The editor's words and place as they are typed, for the preview.
  const [editing, setEditing] = useState<{ id: number | null; label: string; order: number } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    // The widgets list's "{n} starters" chip and the editor's preview.
    void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
    void qc.invalidateQueries({ queryKey: ['website', 'widget-design', wid] });
  };

  const toggle = async (s: Starter, on: boolean) => {
    qc.setQueryData<StartersPayload>(KEY, (d) => (d ? { ...d, starters: d.starters.map((x) => (x.id === s.id ? { ...x, is_active: on } : x)) } : d));
    try {
      await saveStarter(s.id, { is_active: on });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };

  /** Puts the widget's starters in this order: at once on the screen, then on the server. */
  const reorder = async (ids: number[]) => {
    qc.setQueryData<StartersPayload>(KEY, (d) => (d ? { ...d, starters: d.starters.map((x) => (ids.includes(x.id) ? { ...x, sort_order: ids.indexOf(x.id) } : x)) } : d));
    try {
      await reorderStarters(wid, ids);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };
  const ids = starters.map((s) => s.id);
  const drop = (e: DragEvent, to: number) => {
    e.preventDefault();
    const from = dragging === null ? -1 : ids.indexOf(dragging);
    setDragging(null);
    if (from >= 0 && from !== to) void reorder(moved(ids, from, to));
  };
  // The handle moves a starter with the arrow keys too, for anybody not dragging.
  const keyMove = (e: KeyboardEvent, at: number) => {
    const to = e.key === 'ArrowUp' ? at - 1 : e.key === 'ArrowDown' ? at + 1 : -2;
    if (to === -2) return;
    e.preventDefault();
    if (to >= 0 && to < ids.length) void reorder(moved(ids, at, to));
  };

  const d = design.data;
  const look = d ? withDefaults(d.design, d.widget?.name) : null;

  return (
    <main aria-label="Conversation starters" className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto border-l border-line bg-ground px-[22px] py-4 text-[13px] text-ink scroll-thin">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold">Conversation starters</h1>
          <p className="text-[12.5px] text-ink-3">Buttons under the welcome message. A starter with an instant answer replies at once; without one, an agent replies.</p>
        </div>
        <WidgetPicker widgets={widgets} value={row?.id ?? null} onChange={(id) => onSelect(id, null)} />
        <Button variant="primary" disabled={!can || !row} onClick={() => row && onSelect(row.id, 'new')}>New starter</Button>
      </div>
      {q.data && !can ? <Note>You can look at these starters. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
      {list.isLoading || q.isLoading ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : list.error || q.error ? (
        <ErrorNote error={list.error ?? q.error} onRetry={() => void (list.error ? list.refetch() : q.refetch())} />
      ) : !row ? (
        <div className="flex flex-1"><Empty icon="message-circle" title="No widgets yet" hint="Create one under Widgets & embed, then add its starters here." /></div>
      ) : (
        <div className="flex gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {starters.length ? (
              <div role="table" aria-label="Starters" className="overflow-hidden rounded-[12px] border border-line bg-surface">
                <div role="row" className={cx(COLS, 'border-b border-line bg-subtle px-3.5 py-2.5 text-[10.5px] font-bold tracking-[0.9px] text-ink-3')}>
                  <span role="columnheader" aria-label="Order" />
                  <span role="columnheader">BUTTON</span>
                  <span role="columnheader">INSTANT ANSWER</span>
                  <span role="columnheader">USED</span>
                  <span role="columnheader">ON</span>
                </div>
                {starters.map((s, i) => {
                  const here = !creating && open?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      role="row"
                      aria-selected={here}
                      draggable={can}
                      onDragStart={(e) => {
                        setDragging(s.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => dragging !== null && e.preventDefault()}
                      onDrop={(e) => drop(e, i)}
                      onDragEnd={() => setDragging(null)}
                      className={cx(COLS, 'border-b border-line/70 px-3.5 py-[11px] last:border-b-0', here && 'bg-selection/60 shadow-[inset_3px_0_0_var(--color-primary)]', dragging === s.id && 'opacity-50')}
                    >
                      <span role="cell">
                        <button type="button" aria-label={text('Move {name}', { name: s.label })} title="Drag, or use the arrow keys" disabled={!can} onKeyDown={(e) => keyMove(e, i)} className="cursor-grab text-ink-3 disabled:cursor-default">⋮⋮</button>
                      </span>
                      <span role="cell" className="min-w-0">
                        <button type="button" aria-current={here ? 'true' : undefined} onClick={() => onSelect(wid, String(s.id))} className="block max-w-full truncate text-left font-bold">{s.label}</button>
                      </span>
                      <span role="cell" className={cx('truncate pr-3', s.answer?.trim() ? 'text-ink-2' : 'text-ink-3')}>{answerLine(s)}</span>
                      <span role="cell">{s.clicks}</span>
                      <span role="cell"><Switch label={text('{name} on', { name: s.label })} checked={s.is_active} disabled={!can} onChange={(v) => void toggle(s, v)} /></span>
                    </div>
                  );
                })}
              </div>
            ) : !creating ? (
              <div className="rounded-[12px] border border-line bg-surface"><Empty icon="message-circle" title="No starters yet" hint="A starter is a question visitors can ask with one tap, under the welcome message." /></div>
            ) : null}
            {creating || open ? (
              <StarterEditor
                key={`${wid}:${creating ? 'new' : open!.id}`}
                widgetId={wid}
                starter={creating ? null : open}
                ids={ids}
                can={can}
                onEdit={setEditing}
                onSaved={(id) => {
                  refresh();
                  onSelect(wid, String(id));
                }}
                onDeleted={() => {
                  refresh();
                  onSelect(wid, null);
                }}
              />
            ) : null}
          </div>
          <aside aria-label="Preview" className="flex w-[340px] shrink-0 flex-col items-center gap-2.5 self-start rounded-[12px] border border-line bg-well p-4">
            <span className="self-start text-[10.5px] font-bold tracking-[0.9px] text-ink-3">PREVIEW</span>
            {look ? (
              <WidgetPreview design={look} siteName={siteNameOf(look, d?.fallback_name)} people={[]} replyTime={null} hours={null} screen="start" dark={false} launcher={false} starters={previewLabels(starters, editing)} />
            ) : design.error ? (
              <ErrorNote error={design.error} onRetry={() => void design.refetch()} />
            ) : (
              <Spinner />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function StarterEditor({ widgetId, starter, ids, can, onEdit, onSaved, onDeleted }: {
  widgetId: number;
  starter: Starter | null;
  ids: number[];
  can: boolean;
  onEdit: (e: { id: number | null; label: string; order: number } | null) => void;
  onSaved: (id: number) => void;
  onDeleted: () => void;
}) {
  const place = starter ? ids.indexOf(starter.id) + 1 : ids.length + 1;
  const saved: StarterDraft = { label: starter?.label ?? '', answer: starter?.answer ?? '', order: place };
  const [d, setD] = useState<StarterDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tried, setTried] = useState(false);
  const aid = useId();
  // The preview follows this editor while it is open, and the saved starters once it closes.
  useEffect(() => () => onEdit(null), [onEdit]);
  const count = starter ? ids.length : ids.length + 1;
  const issues = starterProblems(d, count);
  const blocked = Object.keys(issues).length > 0;
  const dirty = !starter || d.label !== saved.label || d.answer !== saved.answer || d.order !== saved.order;
  const show = (k: keyof StarterDraft) => (tried || starter ? issues[k] : undefined);
  const set = <K extends keyof StarterDraft>(k: K, v: StarterDraft[K]) => {
    const next = { ...d, [k]: v };
    setD(next);
    onEdit({ id: starter?.id ?? null, label: next.label, order: Number.isInteger(next.order) ? next.order : place });
  };

  const save = async () => {
    setTried(true);
    if (blocked || !dirty) return;
    setBusy(true);
    try {
      let id = starter?.id ?? 0;
      if (starter) {
        const changes: Partial<{ label: string; answer: string }> = {};
        if (d.label !== saved.label) changes.label = d.label.trim();
        if (d.answer !== saved.answer) changes.answer = d.answer.trim();
        if (Object.keys(changes).length) await saveStarter(starter.id, changes);
        if (d.order !== saved.order) await reorderStarters(widgetId, moved(ids, saved.order - 1, d.order - 1));
      } else {
        id = (await createStarter(widgetId, { label: d.label.trim(), answer: d.answer.trim(), is_active: true, sort_order: ids.length })).id;
        if (d.order <= ids.length) await reorderStarters(widgetId, moved([...ids, id], ids.length, d.order - 1));
      }
      onEdit(null);
      toast('success', 'Starter saved');
      onSaved(id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={starter ? 'Edit starter' : 'New starter'}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4"
    >
      <div className="flex items-center gap-2.5">
        <h2 className="flex-1 text-[14px] font-bold">{starter ? 'Edit starter' : 'New starter'}</h2>
        {starter ? <Button type="button" size="sm" className="text-danger" disabled={!can || busy} onClick={() => setDeleting(true)}>Delete</Button> : null}
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!can || busy || !dirty}>Save</Button>
      </div>
      <fieldset disabled={!can || busy} className="grid grid-cols-2 gap-3.5">
        <TextField label="Title" maxLength={LABEL_MAX} value={d.label} placeholder="How much is a licence?" onChange={(e) => set('label', e.target.value)} error={show('label') ?? null} />
        <TextField label="Order" type="number" inputMode="numeric" min={1} max={count} className="w-[90px]" value={Number.isFinite(d.order) ? String(d.order) : ''} onChange={(e) => set('order', e.target.value === '' ? Number.NaN : Number(e.target.value))} error={show('order') ?? null} />
        <Labelled label="Instant answer" htmlFor={`${aid}-answer`} className="col-span-2">
          <textarea
            id={`${aid}-answer`}
            rows={2}
            maxLength={ANSWER_MAX}
            value={d.answer}
            onChange={(e) => set('answer', e.target.value)}
            aria-describedby={`${aid}-hint`}
            className="min-h-[60px] resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
          />
          <span id={`${aid}-hint`} className="text-[11.5px] text-ink-3">{show('answer') ?? 'Leave empty and an agent will reply.'}</span>
        </Labelled>
      </fieldset>
      {deleting && starter ? <DeleteStarter starter={starter} onClose={() => setDeleting(false)} onDeleted={onDeleted} /> : null}
    </form>
  );
}

function DeleteStarter({ starter, onClose, onDeleted }: { starter: Starter; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const tid = useId();
  const remove = async () => {
    setBusy(true);
    try {
      await deleteStarter(starter.id);
      toast('success', 'Starter removed');
      onClose();
      onDeleted();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Delete “{name}”?', { name: starter.label })}
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
      <p className="text-[13px] text-ink-2">The button goes from the widget. Conversations it started stay as they are.</p>
    </Modal>
  );
}
