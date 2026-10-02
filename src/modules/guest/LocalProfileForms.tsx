import { useState } from 'react';
import { LOCAL_PICTURE_MAX, type LocalProfile, type LocalProfileInput } from '@shared/local-workspace';
import { Avatar, Button, TextField } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';

/** A picture as a small data URL: scaled to 256 px where the window can draw, refused when still too large. */
export async function pictureData(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(text('Choose a PNG, JPEG or WebP picture.'));
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(text('That picture could not be read.')));
    reader.readAsDataURL(file);
  });
  const scaled = await new Promise<string | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const side = Math.min(256, image.naturalWidth, image.naturalHeight) || 256;
      const canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      const context = canvas.getContext('2d');
      if (!context) { resolve(null); return; }
      const crop = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 0, 0, side, side);
      try { resolve(canvas.toDataURL('image/jpeg', 0.85)); } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = raw;
  });
  const result = scaled && scaled.startsWith('data:image/jpeg;base64,') ? scaled : raw;
  if (result.length > LOCAL_PICTURE_MAX) throw new Error(text('Choose a picture under 300 KB.'));
  return result;
}

/**
 * First use (and later edits) of the Local Profile: a display name, and optionally a picture and a PIN.
 * No email, verification, server or AI model is involved.
 */
export function LocalProfileForm({ profile, onSaved, onCancel }: { profile: LocalProfile | null; onSaved: (profile: LocalProfile) => void; onCancel?: () => void }) {
  const [name, setName] = useState(profile?.name ?? '');
  const [picture, setPicture] = useState<string | null>(profile?.picture ?? null);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [removePin, setRemovePin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = pin !== again;
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const input: LocalProfileInput = { name, picture, ...(pin ? { pin } : removePin ? { pin: null } : profile ? {} : { pin: null }) };
      onSaved(await call('local:profile', input));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <div>
      <h1 className="text-[20px] font-bold text-ink">{profile ? 'Edit Local Profile' : 'Set up your Local Profile'}</h1>
      {profile ? null : <p className="mt-1 text-[13px] text-ink-2">Your notes, tasks, contacts and calendar are saved on this device. No email, verification or account is needed, and nothing is sent to a server.</p>}
    </div>
    <TextField label="Display name" value={name} maxLength={60} required autoFocus onChange={(e) => setName(e.target.value)} hint={text('Shown on this device and used when you join a meeting.')} />
    <div className="flex items-center gap-3">
      <Avatar name={name || '?'} src={picture} size={48} />
      <label className="flex flex-col gap-1 text-[13px]">Profile picture (optional)
        <input aria-label="Profile picture (optional)" type="file" accept="image/png,image/jpeg,image/webp" className="text-[12px]" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pictureData(file).then(setPicture, (problem: Error) => setError(problem.message));
        }} />
      </label>
      {picture ? <Button type="button" size="sm" variant="ghost" onClick={() => setPicture(null)}>Remove picture</Button> : null}
    </div>
    <fieldset className="flex flex-col gap-2 rounded border border-line p-3">
      <legend className="px-1 text-[13px] font-semibold">PIN (optional)</legend>
      <p className="text-[12px] text-ink-3">A PIN keeps others using this device out of your Local Profile. It is stored only as a protected hash and cannot be recovered: if you forget it, delete the local data and start again.</p>
      {profile?.hasPin && !removePin ? <p className="text-[12px] text-ink-2">A PIN is set. Enter a new one to change it.</p> : null}
      <TextField label={profile?.hasPin ? 'New PIN' : 'PIN'} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} hint={text('4 to 8 digits.')} />
      {pin ? <TextField label="Confirm PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} error={again && mismatch ? text('The PINs do not match.') : null} /> : null}
      {profile?.hasPin ? <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={removePin} onChange={(e) => { setRemovePin(e.target.checked); setPin(''); setAgain(''); }} />Remove the PIN</label> : null}
    </fieldset>
    {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
    <div className="flex gap-2">
      <Button type="submit" variant="primary" loading={busy} disabled={busy || !name.trim() || (!!pin && (pin.length < 4 || mismatch))}>{profile ? 'Save profile' : 'Create Local Profile'}</Button>
      {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
    </div>
  </form>;
}

/** The Local Profile's PIN, asked each time guest mode opens. Wrong PINs wait a minute after five. */
export function LocalUnlock({ profile, onUnlocked }: { profile: LocalProfile; onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const result = await call('local:unlock', { pin });
      if (result.unlocked) onUnlocked();
      else { setPin(''); setError(result.retryAfter ? text('Too many wrong PINs. Try again in {seconds} seconds.', { seconds: result.retryAfter }) : text('That PIN is not right.')); }
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <form className="flex max-w-sm flex-col items-center gap-4 text-center" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <Avatar name={profile.name} src={profile.picture} size={64} />
    <h1 className="text-[18px] font-bold text-ink">{profile.name}</h1>
    <p className="text-[13px] text-ink-2">Enter the PIN for this Local Profile.</p>
    <TextField label="PIN" type="password" inputMode="numeric" autoComplete="current-password" maxLength={8} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
    {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
    <Button type="submit" variant="primary" loading={busy} disabled={busy || pin.length < 4}>Unlock</Button>
  </form>;
}
