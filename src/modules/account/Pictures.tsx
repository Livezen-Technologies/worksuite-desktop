import { useState } from 'react';
import { apiDelete, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { pictureUrl, useMe, UserPicture } from '../../components/UserPicture';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { btn, btnPrimary } from '../../components/PageKit';
import type { OpenEditor } from './AccountPage';
import { abilities, K, usePictures, useRefreshMe, type Picture } from './api';
import { BACKGROUNDS, LOOKS } from './avatarArt';
import { Card, Head, Note, Pill } from '../../components/CardKit';
import { VisibilityCards } from './visibility';

/**
 * Profile pictures (AcctPictures): the picture showing now and one waiting
 * for approval, every photo used before (the server keeps twelve), the
 * avatars made, and who sees the picture. Any of them can be used again,
 * saved as a copy, or deleted; an avatar can be opened again and changed.
 */
export default function Pictures({ onEdit }: { onEdit: OpenEditor }) {
  const q = usePictures();
  const me = useMe();
  const refresh = useRefreshMe();
  const origin = useStore(app, (s) => s.auth?.server?.origin);
  const [busy, setBusy] = useState<number | 'current' | null>(null);
  const [asking, setAsking] = useState<number | 'current' | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const can = abilities(data);
  const current = data.items.find((i) => i.current) ?? null;
  const pending = data.items.find((i) => i.pending) ?? null;
  const photos = data.items.filter((i) => i.type === 'upload' && !i.current && !i.pending);
  const avatars = data.items.filter((i) => i.type === 'generated_avatar' && !i.current && !i.pending);

  const act = async (id: number | 'current', run: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await run();
      await refresh([K.pictures, K.profile]);
      toast('success', done);
      setAsking(null);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const use = (p: Picture) => act(p.id, () => apiPost(`/api/users/me/pictures/${p.id}/current`), 'Profile picture changed.');
  const remove = (p: Picture) => act(p.id, () => apiDelete(`/api/users/me/pictures/${p.id}`), p.pending ? 'Withdrawn.' : 'Deleted.');
  const save = (p: Picture) => void call('transfers:download', { picture: p.id, name: `profile-picture-${p.id}.webp` }).catch((e) => toast('error', errorMessage(e)));
  const src = (path: string) => pictureUrl(path, origin);

  return (
    <div className="flex max-w-[1180px] flex-col gap-4">
      <Head title="Profile pictures" sub="Every picture you have used, and avatars you made. Use one again, keep a copy, or delete it.">
        {can.avatar ? (
          <button type="button" className={btn} onClick={() => onEdit('avatar')}>
            <Icon name="sparkles" size={15} /> Create avatar
          </button>
        ) : null}
        {can.upload ? (
          <button type="button" className={btnPrimary} onClick={() => onEdit('photo')}>
            <Icon name="upload" size={15} /> Upload photo
          </button>
        ) : null}
      </Head>
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 350px' }}>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="flex items-start gap-5">
              <div className="flex shrink-0 items-end gap-4">
                <figure className="m-0 flex flex-col items-center gap-1.5">
                  <UserPicture name={me?.name} src={current?.large ?? me?.avatar} size={96} className="!bg-primary text-[30px] !text-white" />
                  <figcaption className="text-[11.5px] font-semibold text-ink-3">Showing now</figcaption>
                </figure>
                {pending ? (
                  <figure className="m-0 flex flex-col items-center gap-1.5">
                    {src(pending.large) ? <img src={src(pending.large)!} alt="" className="h-24 w-24 rounded-full object-cover opacity-80 ring-2 ring-warning ring-offset-2 ring-offset-surface" /> : null}
                    <figcaption className="text-[11.5px] font-semibold text-warning">New {pending.type === 'upload' ? 'photo' : 'avatar'}</figcaption>
                  </figure>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 text-[14.5px] font-bold text-ink">Current picture</h2>
                  {pending ? <Pill tone="amber">Waiting for approval</Pill> : null}
                </div>
                {pending ? (
                  <Note tone="amber" className="mt-2">
                    Sent for review. It will show once an administrator approves it. Until then people see {current ? 'the picture showing now' : 'your initials'}.
                  </Note>
                ) : (
                  <p className="m-0 mt-1 text-[12.5px] text-ink-3">{current || me?.avatar ? 'Shown wherever you appear in WorkSuite.' : 'You have no picture, so people see your initials.'}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {pending ? (
                    <button type="button" className={btn} disabled={busy !== null} onClick={() => void remove(pending)}>
                      Withdraw
                    </button>
                  ) : null}
                  {(current || me?.avatar) && can.delete ? (
                    asking === 'current' ? (
                      <span className="flex items-center gap-2 rounded-[8px] bg-subtle px-2.5 text-[12.5px] text-ink-2">
                        Your initials will show instead; it stays below.
                        <button type="button" disabled={busy !== null} onClick={() => void act('current', () => apiDelete('/api/users/me/pictures/current'), 'Profile picture removed.')} className="font-bold text-danger hover:underline">
                          Remove
                        </button>
                        <button type="button" onClick={() => setAsking(null)} className="font-semibold hover:underline">
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={btn} onClick={() => setAsking('current')}>
                        Remove picture
                      </button>
                    )
                  ) : null}
                  {current?.type === 'generated_avatar' && can.avatar ? (
                    <button type="button" className={btn} onClick={() => onEdit('avatar', current.style)}>
                      <Icon name="compose" size={15} /> Change this avatar
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Previous photos">
            <p className="m-0 -mt-2 mb-3 text-[12.5px] text-ink-3">Your last twelve pictures are kept, so you can go back to one.</p>
            {photos.length === 0 ? (
              <p className="m-0 py-3 text-[12.5px] text-ink-3">No earlier photos.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {photos.map((p) => (
                  <Tile key={p.id} p={p} src={src(p.thumb) ?? src(p.url)} caption={month(p.created_at)} busy={busy === p.id} asking={asking === p.id} can={can} onUse={() => void use(p)} onSave={() => save(p)} onAsk={() => setAsking(asking === p.id ? null : p.id)} onDelete={() => void remove(p)} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Avatars">
            <div className="flex flex-wrap gap-3">
              {avatars.map((p) => (
                <Tile
                  key={p.id}
                  p={p}
                  src={src(p.thumb) ?? src(p.url)}
                  caption={styleName(p)}
                  busy={busy === p.id}
                  asking={asking === p.id}
                  can={can}
                  onUse={() => void use(p)}
                  onSave={() => save(p)}
                  onAsk={() => setAsking(asking === p.id ? null : p.id)}
                  onDelete={() => void remove(p)}
                  onEdit={can.avatar && p.style ? () => onEdit('avatar', p.style) : undefined}
                />
              ))}
              {can.avatar ? (
                <button type="button" onClick={() => onEdit('avatar')} className="flex w-24 flex-col items-center gap-1.5 text-[12px] font-semibold text-primary">
                  <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-primary/40 hover:bg-selection">
                    <Icon name="plus" size={22} />
                  </span>
                  Create avatar
                </button>
              ) : null}
              {avatars.length === 0 && !can.avatar ? <p className="m-0 py-3 text-[12.5px] text-ink-3">No avatars.</p> : null}
            </div>
          </Card>
        </div>

        {data.visibility ? (
          <Card title="Who sees your picture">
            <p className="m-0 -mt-2 mb-3 text-[12.5px] leading-[1.5] text-ink-3">Anyone left out sees your initials. You and the administrators who review pictures always see it.</p>
            <VisibilityCards value={data.visibility} canEdit={can.edit} />
            <p className="m-0 mt-3 text-[12px] text-ink-3">Saved as soon as you choose.</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ p, src, caption, busy, asking, can, onUse, onSave, onAsk, onDelete, onEdit }: { p: Picture; src: string | null; caption: string; busy: boolean; asking: boolean; can: { delete: boolean }; onUse: () => void; onSave: () => void; onAsk: () => void; onDelete: () => void; onEdit?: () => void }) {
  return (
    <div data-picture={p.id} className={cx('group flex w-24 flex-col items-center gap-1.5 rounded-[12px] p-0 text-center', asking && 'bg-danger-bg')}>
      <div className="relative h-24 w-24">
        {src ? <img src={src} alt="" className="h-24 w-24 rounded-full object-cover ring-1 ring-line" /> : <span className="block h-24 w-24 rounded-full bg-subtle" />}
        <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-[rgba(15,24,48,.55)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" disabled={busy} onClick={onUse} className="h-7 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-primary">
            Use
          </button>
        </div>
      </div>
      <span className="w-full truncate text-[11.5px] font-semibold text-ink-3">{caption}</span>
      {asking ? (
        <span className="flex gap-2 text-[11.5px]">
          <button type="button" disabled={busy} onClick={onDelete} className="font-bold text-danger hover:underline">
            Delete
          </button>
          <button type="button" onClick={onAsk} className="font-semibold text-ink-2 hover:underline">
            Keep
          </button>
        </span>
      ) : (
        <span className="flex gap-0.5">
          {onEdit ? (
            <button type="button" aria-label="Change" title="Change" onClick={onEdit} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
              <Icon name="compose" size={13} />
            </button>
          ) : null}
          <button type="button" aria-label="Download" title="Save a copy" onClick={onSave} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="download" size={13} />
          </button>
          {can.delete ? (
            <button type="button" aria-label="Delete" title="Delete" onClick={onAsk} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
              <Icon name="trash" size={13} />
            </button>
          ) : null}
        </span>
      )}
    </div>
  );
}

function month(stamp: string | null): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "Violet · initials". */
function styleName(p: Picture): string {
  const bg = p.style?.background ? BACKGROUNDS[p.style.background]?.label : null;
  const look = p.style?.look ? LOOKS.find((l) => l.id === p.style?.look)?.label.toLowerCase() : null;
  return [bg, look].filter(Boolean).join(' · ') || month(p.created_at);
}
