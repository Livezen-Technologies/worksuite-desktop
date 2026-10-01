import { useEffect, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { abilities, usePictures } from '../../modules/account/api';
import type { AvatarStyle } from '../../modules/account/avatarArt';
import { PictureEditor, sendPicture, typeList, type EditorTab } from '../../modules/account/PictureEditor';

/**
 * Add your profile picture (#46): shown instead of the workspace while the
 * server says this account must have a picture and has none — at the first
 * sign-in, and again whenever it is gone. The only ways on are adding one or
 * signing out.
 *
 * The picture is made in the account's own editor (crop, or an avatar) and
 * handed back unsent; it shows here as it will look, and goes up only on
 * Save and Continue. A picture waiting for review counts — the server stops
 * asking — so nobody is held here by a queue they cannot move.
 */
export function AddPictureScreen({ onDone }: { onDone: () => void }) {
  const pics = usePictures();
  const can = abilities(pics.data);
  const limits = pics.data?.limits;
  const [editor, setEditor] = useState<EditorTab | null>(null);
  const [image, setImage] = useState<{ blob: Blob; made?: AvatarStyle; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Each preview's address is let go when it is replaced, or when the screen goes.
  useEffect(() => (image ? () => URL.revokeObjectURL(image.url) : undefined), [image]);

  const save = async () => {
    if (!image) return;
    setSaving(true);
    setError('');
    try {
      const r = await sendPicture(image.blob, image.made);
      if (r.pending) toast('success', 'Sent for review. It will show once an administrator approves it.');
      await call('session:refresh').catch(() => undefined);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const types = typeList(limits?.types ?? ['jpg', 'png', 'webp']);
  const maxMb = Math.round((limits?.max_bytes ?? 8 * 1048576) / 1048576);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ground p-6">
      <div className="w-[480px] max-w-full rounded-[16px] border border-line bg-surface p-8 shadow-xl">
        <h1 className="text-[22px] font-bold text-ink">Add your profile picture</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">Please upload a profile picture to complete your profile and continue.</p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <span className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-subtle ring-1 ring-line">
            {image ? <img src={image.url} alt="Your new profile picture" className="h-full w-full object-cover" /> : <Icon name="user" size={40} className="text-ink-3" />}
          </span>
          {can.upload ? (
            <span className="text-center text-[12.5px] text-ink-3">
              {types}, up to {maxMb} MB{limits?.min_side ? `, at least ${limits.min_side} × ${limits.min_side} pixels` : ''}.
            </span>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          {can.upload ? (
            <Button size="lg" icon="upload" disabled={saving || pics.isLoading} onClick={() => setEditor('photo')}>
              {image && !image.made ? 'Choose another picture' : 'Upload Picture'}
            </Button>
          ) : null}
          {can.avatar ? (
            <Button size="lg" disabled={saving || pics.isLoading} onClick={() => setEditor('avatar')}>
              Create an avatar instead
            </Button>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          {saving ? (
            <div role="progressbar" aria-label="Uploading" className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          ) : null}
          <Button size="lg" variant="primary" disabled={!image} loading={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : error && image ? 'Try again' : 'Save and Continue'}
          </Button>
          <button type="button" disabled={saving} onClick={() => void call('auth:signOut', { wipe: false })} className="mt-1 text-[13px] font-semibold text-ink-3 hover:text-ink">
            Sign Out
          </button>
        </div>
      </div>
      {editor ? (
        <PictureEditor
          tab={editor}
          onTab={setEditor}
          onClose={() => setEditor(null)}
          onPick={(blob, made) => {
            setImage({ blob, made, url: URL.createObjectURL(blob) });
            setError('');
          }}
        />
      ) : null}
    </div>
  );
}
