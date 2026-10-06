import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { useTab } from '../../../../core/tab-context';
import { toast } from '../../../../core/toasts';
import { Button, Chip, cx, Modal } from '../../../../components/ui';
import { SK, socialApi, useInvalidate, type LibraryItem, type LibraryKind } from '../../api';
import { ConfirmButton, Field, INPUT, TEXTAREA } from '../../parts';

/**
 * W08's text tabs (SMM-MED-005, SMM-MED-006, SMM-CMP-007): post templates, hashtag sets, saved captions — each one
 * a card with its text and how often it was used, to start a post from, edit or delete — and the evergreen pool
 * the queue reshares from (SMM-SCH-007).
 */

export const KIND_NOUN: Record<LibraryKind, string> = { media: 'media file', template: 'post template', hashtag_set: 'hashtag set', caption: 'saved caption', evergreen: 'evergreen post' };

const used = (n: number) => (n ? `Used ${n}×` : 'Unused');

export function TextItems({ kind, items, canEdit, brandId }: { kind: Exclude<LibraryKind, 'media' | 'evergreen'>; items: LibraryItem[]; canEdit: boolean; brandId: number | null }) {
  const { go } = useTab();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<LibraryItem | 'new' | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => socialApi.deleteLibraryItem(id),
    onSuccess: () => {
      invalidate(SK.libraryAll);
      toast('success', `Deleted the ${KIND_NOUN[kind]}.`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button icon="plus" onClick={() => setEditing('new')}>
            New {KIND_NOUN[kind]}
          </Button>
        </div>
      ) : null}
      {items.length ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((it) => (
            <li key={it.id} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 truncate text-[13.5px] font-bold text-ink">{it.name}</h3>
                <span className="shrink-0 text-[11.5px] text-ink-3">{used(it.usage_count)}</span>
              </div>
              <p className={cx('text-[12.5px] whitespace-pre-wrap text-ink-2', kind === 'hashtag_set' && 'font-mono text-[12px]')}>{it.text || <span className="text-ink-3">No text</span>}</p>
              {it.tags.length ? (
                <div className="flex flex-wrap gap-1">
                  {it.tags.map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
                </div>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" variant="primary" icon="compose" disabled={!it.text} onClick={() => go(`/social-media/compose?text=${encodeURIComponent(it.text ?? '')}`)}>
                  Use in new post
                </Button>
                {canEdit ? (
                  <>
                    <Button size="sm" icon="pen" onClick={() => setEditing(it)}>
                      Edit
                    </Button>
                    <ConfirmButton size="sm" variant="ghost" icon="trash" label="Delete" confirm={`Delete “${it.name}”`} loading={del.isPending && del.variables === it.id} onConfirm={() => del.mutate(it.id)} />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[12px] border border-dashed border-line bg-surface px-4 py-8 text-center text-[12.5px] text-ink-3">No {KIND_NOUN[kind]}s yet.</p>
      )}
      {editing ? <ItemDialog kind={kind} item={editing === 'new' ? null : editing} brandId={brandId} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ItemDialog({ kind, item, brandId, onClose }: { kind: LibraryKind; item: LibraryItem | null; brandId: number | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(item?.name ?? '');
  const [text, setText] = useState(item?.text ?? '');
  const [tags, setTags] = useState((item?.tags ?? []).join(', '));
  const save = useMutation({
    mutationFn: () =>
      socialApi.saveLibraryItem({
        ...(item ? { id: item.id } : { brand_id: brandId }),
        kind,
        name: name.trim(),
        text,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      invalidate(SK.libraryAll);
      toast('success', item ? 'Saved.' : `Added the ${KIND_NOUN[kind]}.`);
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      title={item ? `Edit ${KIND_NOUN[kind]}` : `New ${KIND_NOUN[kind]}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !text.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={kind === 'hashtag_set' ? 'Hashtags' : 'Text'} hint={kind === 'hashtag_set' ? 'Separate hashtags with spaces.' : 'Variables such as {date} and {first_name} are filled in the composer.'}>
          <textarea className={cx(TEXTAREA, kind === 'hashtag_set' && 'font-mono')} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Tags" hint="Separated by commas.">
          <input className={INPUT} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function EvergreenPool({ items, canEdit }: { items: LibraryItem[]; canEdit: boolean }) {
  const invalidate = useInvalidate();
  const remove = useMutation({
    mutationFn: (id: number) => socialApi.deleteLibraryItem(id),
    onSuccess: () => {
      invalidate(SK.libraryAll, SK.queueAll);
      toast('success', 'Removed from the evergreen pool. The post itself is kept.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (!items.length) return <p className="rounded-[12px] border border-dashed border-line bg-surface px-4 py-8 text-center text-[12.5px] text-ink-3">The evergreen pool is empty. Mark a published post as evergreen to have the queue reshare it.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line rounded-[12px] border border-line bg-surface">
      {items.map((it) => (
        <li key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">{it.name}</div>
            {it.text ? <div className="truncate text-[12px] text-ink-3">{it.text}</div> : null}
          </div>
          <span className="text-[11.5px] text-ink-3">{it.usage_count ? `Reshared ${it.usage_count}×` : 'Not reshared yet'}</span>
          {canEdit ? <ConfirmButton size="sm" variant="secondary" label="Remove from pool" confirm="Remove" loading={remove.isPending && remove.variables === it.id} onConfirm={() => remove.mutate(it.id)} /> : null}
        </li>
      ))}
    </ul>
  );
}
