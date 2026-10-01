import { useState } from 'react';
import { DARK_PROFILES, DEFAULT_DARK_PROFILE, normalizeDarkProfile, type DarkColorProfile } from '@shared/theme-profiles';
import type { Preferences } from '@shared/types';
import { updatePrefs } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';

export function DarkProfilePicker({ prefs }: { prefs: Preferences }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = normalizeDarkProfile(prefs.darkColorProfile);
  const choose = async (id: DarkColorProfile) => {
    setError(''); setSaving(true);
    try { await updatePrefs({ darkColorProfile: id }); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  };
  return <section aria-label="Dark Color Profile" className="flex flex-col gap-2 border-b border-line py-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="m-0 text-[13px] font-semibold text-ink">Dark Color Profile</h3>
      <button type="button" disabled={saving} className="rounded px-2 py-1 text-[12px] font-semibold text-primary hover:bg-subtle disabled:opacity-50" onClick={() => void choose(DEFAULT_DARK_PROFILE)}>Reset to Default</button>
    </div>
    <p className="m-0 text-[12px] text-ink-2">Used in Dark mode and whenever System mode switches to dark appearance.</p>
    <div role="group" aria-label="Dark color profiles" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {DARK_PROFILES.map((p) => <button key={p.id} type="button" aria-pressed={selected === p.id} aria-label={p.name} disabled={saving}
        onClick={() => void choose(p.id)} className="overflow-hidden rounded-[9px] border-2 p-2 text-left outline-offset-2 disabled:opacity-60"
        style={{ background: p.tokens['--ws-ground'], color: p.tokens['--ws-ink'], borderColor: selected === p.id ? p.tokens['--ws-focus'] : p.tokens['--ws-line'] }}>
        <span aria-hidden="true" className="mb-2 flex h-10 items-center gap-1 rounded p-1" style={{ background: p.tokens['--ws-surface'] }}>
          <span className="h-full w-3 rounded" style={{ background: p.tokens['--ws-navy-3'] }} />
          <span className="h-4 flex-1 rounded" style={{ background: p.tokens['--ws-selection'] }} />
          <span className="h-4 w-5 rounded" style={{ background: p.tokens['--ws-indigo'] }} />
        </span>
        <span className="text-[12px] font-semibold">{p.name}{selected === p.id ? ' ✓' : ''}</span>
      </button>)}
    </div>
    {error ? <p role="alert" className="m-0 text-[12px] text-danger">{error}</p> : null}
  </section>;
}
