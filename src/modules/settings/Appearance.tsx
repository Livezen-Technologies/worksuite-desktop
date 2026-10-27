import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { hasPermission } from '@shared/apps';
import { normalizeHex } from '@shared/color';
import {
  appearanceOf,
  builtinProfiles,
  cardTokens,
  exportProfileCode,
  exportProfileJson,
  generatePalette,
  importProfile,
  MAX_CUSTOM_PROFILES,
  newProfileId,
  ORG_PROFILE,
  type AppearancePrefs,
  type ColourSpec,
  type CustomProfile,
  type Mode,
  type Palette,
  type Tint,
  type Tokens,
} from '@shared/theme-profiles';
import type { Preferences } from '@shared/types';
import { app, isLocked, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal, TextField, cx } from '../../components/ui';
import { LockBadge } from '../../components/SettingsKit';
import { Checkbox } from '../../components/Checkbox';

/**
 * Settings › Preferences › Appearance: the colour profiles (#73, worksuite-desktop#234).
 *
 * A Light and a Dark list of compact cards drawn in each profile's own colours, the selection a ring and a check
 * badge (`role="radio"`, `aria-checked`); a Custom card that opens the editor (accent, background tint, a live
 * preview in light and dark); up to five named custom profiles, edited, duplicated, deleted, exported and imported;
 * and, for an administrator of the organisation's desktop policy, its default profile and the lock.
 */

type ProfilePatch = Partial<Pick<AppearancePrefs, 'lightProfile' | 'darkProfile' | 'custom' | 'chosen'>>;

const listKey = (mode: Mode) => (mode === 'dark' ? 'darkProfile' : 'lightProfile');

/** Brand colours to start from. */
export const BRAND_PRESETS: Array<{ name: string; hex: string }> = [
  { name: 'WorkSuite Blue', hex: '#3b5bdb' },
  { name: 'Indigo', hex: '#23349e' },
  { name: 'Violet', hex: '#6d28d9' },
  { name: 'Rose', hex: '#be123c' },
  { name: 'Emerald', hex: '#15803d' },
  { name: 'Amber', hex: '#b45309' },
  { name: 'Teal', hex: '#0e7c86' },
  { name: 'Slate', hex: '#475569' },
];

const TINT_LABEL: Record<Tint, string> = { neutral: 'Neutral', accent: 'Match accent (subtle)', custom: 'Pick a colour' };

export function ColorProfiles({ prefs }: { prefs: Preferences }) {
  const a = appearanceOf(prefs);
  const resolved = useStore(app, (s) => s.resolvedTheme);
  const lock = isLocked('appearance');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ mode: Mode; profile: CustomProfile | null } | null>(null);
  const [sharing, setSharing] = useState<CustomProfile | null>(null);
  const [importing, setImporting] = useState(false);

  const save = async (patch: ProfilePatch, theme?: Preferences['theme']) => {
    setError('');
    setSaving(true);
    try {
      await updatePrefs({ appearance: patch, ...(theme ? { theme } : {}) } as Partial<Preferences>);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * A profile picked from a list. Picking a Dark profile while the app is set to Light (or a Light one while it is
   * set to Dark) switches the mode too, so the choice shows at once; under System it shows whenever the computer's
   * appearance is that one.
   */
  const choose = (mode: Mode, id: string) => {
    const switchTo = a.mode !== 'system' && a.mode !== mode ? mode : undefined;
    void save({ [listKey(mode)]: id, chosen: true }, switchTo);
  };

  const saveCustom = async (mode: Mode, profile: CustomProfile) => {
    const exists = a.custom.some((p) => p.id === profile.id);
    const custom = exists ? a.custom.map((p) => (p.id === profile.id ? profile : p)) : [...a.custom, profile];
    const patch: ProfilePatch = { custom };
    // A new profile is put to use in the list it was made from.
    if (!exists) Object.assign(patch, { [listKey(mode)]: profile.id, chosen: true });
    const switchTo = !exists && a.mode !== 'system' && a.mode !== mode ? mode : undefined;
    if (await save(patch, switchTo)) setEditing(null);
  };

  const duplicate = (p: CustomProfile) => {
    if (a.custom.length >= MAX_CUSTOM_PROFILES) return;
    void save({ custom: [...a.custom, { ...p, id: newProfileId(a.custom), name: `${p.name} copy`.slice(0, 40) }] });
  };

  const remove = (p: CustomProfile) => {
    // A profile in use gives way to the default in its list.
    const patch: ProfilePatch = { custom: a.custom.filter((c) => c.id !== p.id) };
    if (a.lightProfile === p.id) patch.lightProfile = 'blue';
    if (a.darkProfile === p.id) patch.darkProfile = 'blue';
    void save(patch);
  };

  const full = a.custom.length >= MAX_CUSTOM_PROFILES;
  const busy = saving || !!lock;

  return (
    <section aria-label="Colour profiles" data-setting-row data-loose="" className="flex flex-col gap-3 px-[18px] py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-2 text-[14px] font-semibold text-ink">
            Colour profile
            {lock ? <LockBadge reason={lock.reason} /> : null}
          </h3>
          <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">
            {lock ? lock.reason : 'Light mode uses the Light profile and Dark mode the Dark one; System follows your computer.'}
          </p>
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ lightProfile: 'blue', darkProfile: 'blue', chosen: false })}>
          Reset to Default
        </Button>
      </div>

      {(['light', 'dark'] as const).map((mode) => (
        <ProfileGrid
          key={mode}
          mode={mode}
          a={a}
          disabled={busy}
          locked={!!lock}
          full={full}
          note={a.mode === 'system' && resolved !== mode ? `Shows while your computer is in ${mode} appearance.` : null}
          onChoose={(id) => choose(mode, id)}
          onCustom={() => setEditing({ mode, profile: null })}
        />
      ))}

      <CustomList
        a={a}
        disabled={busy}
        full={full}
        onEdit={(p) => setEditing({ mode: resolved, profile: p })}
        onDuplicate={duplicate}
        onDelete={remove}
        onShare={setSharing}
        onImport={() => setImporting(true)}
      />

      <OrganisationDefault a={a} />

      {error ? (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      {editing ? (
        <ProfileEditor
          mode={editing.mode}
          initial={editing.profile}
          org={a.org ?? null}
          taken={a.custom}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={(p) => void saveCustom(editing.mode, p)}
        />
      ) : null}
      {sharing ? <ShareDialog profile={sharing} onClose={() => setSharing(null)} /> : null}
      {importing ? (
        <ImportDialog
          full={full}
          onClose={() => setImporting(false)}
          onImport={async (p) => {
            if (await save({ custom: [...a.custom, { ...p, id: newProfileId(a.custom) }] })) {
              setImporting(false);
              toast('success', `Imported “${p.name}”.`);
            }
          }}
        />
      ) : null}
    </section>
  );
}

/** The old name, for screens and tests that still use it. */
export const DarkProfilePicker = ColorProfiles;

function ProfileGrid({
  mode,
  a,
  disabled,
  locked,
  full,
  note,
  onChoose,
  onCustom,
}: {
  mode: Mode;
  a: AppearancePrefs;
  disabled: boolean;
  locked: boolean;
  full: boolean;
  note: string | null;
  onChoose: (id: string) => void;
  onCustom: () => void;
}) {
  const label = mode === 'dark' ? 'Dark profiles' : 'Light profiles';
  const headingId = useId();
  const selected = a[listKey(mode)];
  const items = useMemo(() => {
    const list: Array<{ id: string; name: string; tokens: Tokens }> = [];
    if (a.org) list.push({ id: ORG_PROFILE, name: `${a.org.name} default`, tokens: cardTokens(ORG_PROFILE, mode, a) });
    for (const p of builtinProfiles(mode)) list.push({ id: p.id, name: p.id === 'blue' ? `${p.name} (default)` : p.name, tokens: cardTokens(p.id, mode, a) });
    for (const p of a.custom) list.push({ id: p.id, name: p.name, tokens: cardTokens(p.id, mode, a) });
    return list;
  }, [a, mode]);
  const known = items.some((i) => i.id === selected) ? selected : 'blue';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Radio-group keys: the arrows move the selection (and the focus) through the cards.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
    refs.current[next]?.focus();
    if (!disabled) onChoose(items[next]!.id);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 id={headingId} className="m-0 text-[12.5px] font-semibold text-ink-2">
          {mode === 'dark' ? 'Dark' : 'Light'}
        </h4>
        {note ? <span className="text-[12px] text-ink-3">{note}</span> : null}
      </div>
      <div role="radiogroup" aria-label={label} aria-describedby={headingId} className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-2.5">
        {items.map((p, i) => (
          <ProfileCard
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            name={p.name}
            tokens={p.tokens}
            checked={known === p.id}
            disabled={disabled}
            onSelect={() => onChoose(p.id)}
            onKeyDown={(e) => onKey(e, i)}
          />
        ))}
        {locked ? null : (
          <button
            type="button"
            disabled={disabled || full}
            onClick={onCustom}
            title={full ? `Up to ${MAX_CUSTOM_PROFILES} custom profiles. Delete one to add another.` : undefined}
            className="flex h-24 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line bg-surface text-[12.5px] font-semibold text-ink-2 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="plus" size={18} />
            Custom
          </button>
        )}
      </div>
    </div>
  );
}

/** One profile, drawn in its own colours: top bar, sidebar, a row, the selected row and an accent button. */
function ProfileCard({
  name,
  tokens: t,
  checked,
  disabled,
  onSelect,
  onKeyDown,
  ref,
}: {
  name: string;
  tokens: Tokens;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  ref: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={name}
      aria-disabled={disabled || undefined}
      tabIndex={checked ? 0 : -1}
      data-profile-card=""
      onClick={() => !disabled && !checked && onSelect()}
      onKeyDown={onKeyDown}
      className={cx(
        'relative h-24 overflow-hidden rounded-[10px] border text-left outline-offset-2 transition-shadow',
        checked ? 'border-transparent ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'border-line hover:ring-1 hover:ring-line',
        disabled && 'cursor-not-allowed opacity-70',
      )}
      style={{ background: t['--ws-ground'] }}
    >
      <span aria-hidden="true" className="absolute inset-0 flex flex-col">
        <span className="flex h-3.5 shrink-0 items-center gap-1 px-1.5" style={{ background: t['--ws-navy'] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t['--ws-brand'] }} />
          <span className="h-1 w-8 rounded-full opacity-60" style={{ background: t['--ws-navy-ink'] }} />
        </span>
        <span className="flex min-h-0 flex-1">
          <span className="flex w-6 shrink-0 flex-col items-center gap-1 pt-1.5" style={{ background: t['--ws-navy-2'] }}>
            <span className="h-1 w-3 rounded-full" style={{ background: t['--ws-navy-ink'] }} />
            <span className="h-1 w-3 rounded-full opacity-60" style={{ background: t['--ws-navy-ink'] }} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
            <span className="h-2 rounded-[3px] border" style={{ background: t['--ws-surface'], borderColor: t['--ws-line'] }} />
            <span className="h-2 rounded-[3px]" style={{ background: t['--ws-selection'] }} />
            <span className="h-2 w-7 rounded-[3px]" style={{ background: t['--ws-indigo'] }} />
          </span>
        </span>
        <span className="truncate px-2 py-1 text-[11.5px] font-semibold" style={{ background: t['--ws-surface'], color: t['--ws-ink'], borderTop: `1px solid ${t['--ws-line']}` }}>
          {name}
        </span>
      </span>
      {checked ? (
        <span data-check-badge="" aria-hidden="true" className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow">
          <Icon name="check" size={13} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

function CustomList({
  a,
  disabled,
  full,
  onEdit,
  onDuplicate,
  onDelete,
  onShare,
  onImport,
}: {
  a: AppearancePrefs;
  disabled: boolean;
  full: boolean;
  onEdit: (p: CustomProfile) => void;
  onDuplicate: (p: CustomProfile) => void;
  onDelete: (p: CustomProfile) => void;
  onShare: (p: CustomProfile) => void;
  onImport: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="m-0 text-[12.5px] font-semibold text-ink-2">
          Custom profiles{' '}
          <span className="font-normal text-ink-3">
            {a.custom.length} of {MAX_CUSTOM_PROFILES}
          </span>
        </h4>
        <Button size="sm" variant="ghost" icon="upload" disabled={disabled || full} onClick={onImport} title={full ? 'Delete a custom profile to import another.' : undefined}>
          Import…
        </Button>
      </div>
      {a.custom.length ? (
        <ul aria-label="Custom profiles" className="m-0 flex list-none flex-col p-0">
          {a.custom.map((p) => (
            <li key={p.id} className="flex items-center gap-2 border-t border-line py-1.5 first:border-t-0">
              <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-line" style={{ background: p.accent }} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.name}</span>
              {confirming === p.id ? (
                <>
                  <span className="text-[12px] text-ink-3">Delete this profile?</span>
                  <Button size="sm" variant="danger" disabled={disabled} onClick={() => (setConfirming(null), onDelete(p))}>
                    Delete
                  </Button>
                  <Button size="sm" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" icon="pen" disabled={disabled} aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon="copy" disabled={disabled || full} aria-label={`Duplicate ${p.name}`} onClick={() => onDuplicate(p)}>
                    Duplicate
                  </Button>
                  <Button size="sm" variant="ghost" icon="download" aria-label={`Export ${p.name}`} onClick={() => onShare(p)}>
                    Export
                  </Button>
                  <Button size="sm" variant="ghost" icon="trash" disabled={disabled} aria-label={`Delete ${p.name}`} onClick={() => setConfirming(p.id)}>
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[12.5px] text-ink-3">Make one from your own colour with the Custom card, or import one a colleague shared.</p>
      )}
    </div>
  );
}

/** A mini app in a palette: top bar, sidebar, a list with its selected row, a badge and a button. */
export function MiniPreview({ tokens: t, label }: { tokens: Tokens; label: string }) {
  return (
    <figure aria-label={label} className="m-0 flex flex-col gap-1">
      <figcaption className="text-[11.5px] font-semibold text-ink-3">{label}</figcaption>
      <div data-mini-preview="" className="flex h-[132px] flex-col overflow-hidden rounded-[10px] border border-line" style={{ background: t['--ws-ground'] }}>
        <div className="flex h-6 shrink-0 items-center gap-1.5 px-2" style={{ background: t['--ws-navy'] }}>
          <span className="h-3 w-3 rounded-[3px]" style={{ background: t['--ws-brand'] }} />
          <span className="h-3 flex-1 rounded-[4px]" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-14 shrink-0 flex-col gap-1.5 p-1.5" style={{ background: t['--ws-navy-2'] }}>
            {['Home', 'Mail', 'Chat'].map((n, i) => (
              <span key={n} className="flex items-center justify-between rounded-[4px] px-1 text-[9px] font-semibold" style={{ color: t['--ws-navy-ink'], background: i === 1 ? t['--ws-navy-3'] : 'transparent' }}>
                {n}
                {i === 1 ? (
                  <span className="rounded-full px-1 text-[8px] leading-[12px] text-white" style={{ background: 'var(--ws-badge)' }}>
                    3
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
            <div className="rounded-[5px] border px-1.5 py-1 text-[9.5px]" style={{ background: t['--ws-surface'], borderColor: t['--ws-line'], color: t['--ws-ink'] }}>
              Weekly report
            </div>
            <div className="rounded-[5px] px-1.5 py-1 text-[9.5px] font-semibold" style={{ background: t['--ws-selection'], color: t['--ws-ink'] }}>
              Selected row
            </div>
            <div className="rounded-[5px] border px-1.5 py-1 text-[9.5px]" style={{ background: t['--ws-surface'], borderColor: t['--ws-line'], color: t['--ws-ink-3'] }}>
              Muted text
            </div>
            <span className="mt-auto self-end rounded-[5px] px-2 py-0.5 text-[9.5px] font-semibold" style={{ background: t['--ws-indigo'], color: t['--ws-on-primary'] }}>
              Button
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** The palette shown in the preview: the generated one, or with the accent as it was chosen ("see the original"). */
function shown(p: Palette, original: boolean): Tokens {
  if (!original || !p.adjusted) return p.tokens;
  return { ...p.tokens, '--ws-indigo': p.original, '--ws-brand': p.original };
}

function ProfileEditor({
  mode,
  initial,
  org,
  taken,
  saving,
  onCancel,
  onSave,
}: {
  mode: Mode;
  initial: CustomProfile | null;
  org: AppearancePrefs['org'];
  taken: CustomProfile[];
  saving: boolean;
  onCancel: () => void;
  onSave: (p: CustomProfile) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState(initial?.name ?? 'My colours');
  const [accent, setAccent] = useState(initial?.accent ?? org?.accent ?? '#3b5bdb');
  const [tint, setTint] = useState<Tint>(initial?.tint ?? 'accent');
  const [tintColor, setTintColor] = useState(initial?.tintColor ?? '#64748b');
  const [original, setOriginal] = useState(false);
  const hex = normalizeHex(accent);
  const tintHex = normalizeHex(tintColor);
  const spec: ColourSpec = { accent: hex ?? '#3b5bdb', tint, ...(tint === 'custom' ? { tintColor: tintHex ?? '#64748b' } : {}) };
  const light = generatePalette(spec, 'light');
  const dark = generatePalette(spec, 'dark');
  const adjusted = light.adjusted || dark.adjusted;
  const near = [...new Set([...light.near, ...dark.near])];
  const presets = org ? [{ name: `${org.name} brand`, hex: org.accent }, ...BRAND_PRESETS] : BRAND_PRESETS;
  const valid = !!hex && (tint !== 'custom' || !!tintHex) && name.trim().length > 0;
  const order: Mode[] = mode === 'dark' ? ['dark', 'light'] : ['light', 'dark'];

  return (
    <Modal
      title={initial ? 'Edit colour profile' : 'New colour profile'}
      labelledBy={titleId}
      width={620}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={saving}
            onClick={() => onSave({ id: initial?.id ?? newProfileId(taken), name: name.trim().slice(0, 40), ...spec })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} error={name.trim() ? null : 'Give it a name.'} />

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[12.5px] font-semibold text-ink-2">Accent colour</legend>
          <div className="flex items-end gap-2">
            <input
              type="color"
              aria-label="Accent colour picker"
              value={hex ?? '#3b5bdb'}
              onChange={(e) => setAccent(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-[8px] border border-line bg-surface p-0.5"
            />
            <TextField
              aria-label="Accent hex"
              value={accent}
              maxLength={7}
              onChange={(e) => setAccent(e.target.value)}
              error={hex ? null : 'A colour as #RRGGBB.'}
              className="w-32"
            />
          </div>
          <div role="group" aria-label="Brand presets" className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={`${p.name}${p.hex}`}
                type="button"
                title={p.name}
                aria-label={p.name}
                aria-pressed={hex === p.hex}
                onClick={() => setAccent(p.hex)}
                className={cx('h-6 w-6 rounded-full border border-line', hex === p.hex && 'ring-2 ring-primary ring-offset-1 ring-offset-surface')}
                style={{ background: p.hex }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-[12.5px] font-semibold text-ink-2">Background tint</legend>
          <div role="radiogroup" aria-label="Background tint" className="flex flex-wrap gap-1.5">
            {(['neutral', 'accent', 'custom'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tint === t}
                onClick={() => setTint(t)}
                className={cx('h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold', tint === t ? 'border-primary bg-selection text-ink' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
              >
                {TINT_LABEL[t]}
              </button>
            ))}
            {tint === 'custom' ? (
              <input
                type="color"
                aria-label="Background colour"
                value={tintHex ?? '#64748b'}
                onChange={(e) => setTintColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded-[8px] border border-line bg-surface p-0.5"
              />
            ) : null}
          </div>
          <p className="m-0 text-[12px] text-ink-3">How tinted the background and the sidebar are.</p>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          {order.map((m) => (
            <MiniPreview key={m} label={m === 'dark' ? 'Dark' : 'Light'} tokens={shown(m === 'dark' ? dark : light, original)} />
          ))}
        </div>

        {adjusted ? (
          <Note icon="info">
            <span>
              <b className="font-semibold">Adjusted for readability.</b> The accent is {light.adjusted ? 'darker in Light' : ''}
              {light.adjusted && dark.adjusted ? ' and ' : ''}
              {dark.adjusted ? 'lighter in Dark' : ''} so text and buttons keep a 4.5:1 contrast.
            </span>
            <button type="button" className="shrink-0 font-semibold text-primary hover:underline" aria-pressed={original} onClick={() => setOriginal((v) => !v)}>
              {original ? 'See adjusted' : 'See original'}
            </button>
          </Note>
        ) : null}
        {near.map((s) => (
          <Note key={s} icon="warning" tone="warning">
            {s === 'danger'
              ? 'This accent is close to the red used for errors, so it may be mistaken for one.'
              : 'This accent is close to the green used for success, so it may be mistaken for it.'}
          </Note>
        ))}
      </div>
    </Modal>
  );
}

function Note({ icon, tone = 'info', children }: { icon: string; tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div role="status" className={cx('flex items-start gap-2 rounded-[8px] px-3 py-2 text-[12.5px]', tone === 'warning' ? 'bg-warning-bg text-warning-ink' : 'bg-subtle text-ink-2')}>
      <Icon name={icon} size={15} className="mt-px shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">{children}</div>
    </div>
  );
}

function ShareDialog({ profile, onClose }: { profile: CustomProfile; onClose: () => void }) {
  const code = exportProfileCode(profile);
  const json = exportProfileJson(profile);
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast('success', `${what} copied.`),
      () => toast('error', 'Could not copy.'),
    );
  return (
    <Modal title={`Export “${profile.name}”`} onClose={onClose} width={520} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-3">Share the code or the JSON; a colleague imports either in Settings › Preferences › Appearance.</p>
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Short code</span>
          <div className="flex items-center gap-2">
            <code className="selectable min-w-0 flex-1 truncate rounded-[8px] border border-line bg-subtle px-2 py-1.5 font-mono text-[12px] text-ink" aria-label="Short code">
              {code}
            </code>
            <Button size="sm" icon="copy" onClick={() => copy(code, 'Code')}>
              Copy
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">JSON</span>
          <pre className="selectable m-0 max-h-40 overflow-auto rounded-[8px] border border-line bg-subtle px-2 py-1.5 font-mono text-[11.5px] text-ink" aria-label="JSON">
            {json}
          </pre>
          <div>
            <Button size="sm" icon="copy" onClick={() => copy(json, 'JSON')}>
              Copy JSON
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ImportDialog({ full, onClose, onImport }: { full: boolean; onClose: () => void; onImport: (p: { name: string } & ColourSpec) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const go = () => {
    const p = importProfile(text);
    if (!p) return setError('That is not a colour profile code or JSON.');
    if (full) return setError(`You have ${MAX_CUSTOM_PROFILES} custom profiles. Delete one to import another.`);
    onImport(p);
  };
  return (
    <Modal
      title="Import a colour profile"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={go}>
            Import
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Code or JSON</span>
        <textarea
          value={text}
          onChange={(e) => (setText(e.target.value), setError(''))}
          rows={5}
          className="rounded-[8px] border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-primary"
          placeholder="WS1.…"
        />
      </label>
      {error ? (
        <p role="alert" className="m-0 mt-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/** The organisation's profile for everyone, and the lock, for an administrator of its desktop policy (#234). */
function OrganisationDefault({ a }: { a: AppearancePrefs }) {
  const bootstrap = useStore(app, (s) => s.bootstrap);
  const server = useStore(app, (s) => s.auth?.server);
  const current = useStore(app, (s) => s.organizationId);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<string>('');
  const [locked, setLocked] = useState(a.locked === true);
  const orgId = current ?? bootstrap?.defaultOrganizationId ?? bootstrap?.user.organizationId ?? null;
  const allowed = !!bootstrap && hasPermission({ apps: bootstrap.apps, permissions: bootstrap.permissions }, 'desktop.policies.manage');
  if (!allowed || server?.api !== 'desktop-v1' || !orgId) return null;
  const org = bootstrap.organizations.find((o) => o.id === orgId)?.name ?? 'your organization';
  const pick = a.custom.find((p) => p.id === source) ?? a.custom[0] ?? null;
  const send = async (spec: ColourSpec | null, lock: boolean, done: string) => {
    setBusy(true);
    try {
      await call('settings:appearanceDefaults', { organizationId: orgId, accent: spec?.accent ?? null, tint: spec?.tint ?? 'neutral', tintColor: spec?.tintColor ?? null, locked: lock });
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3" aria-label="Organisation default">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        Organisation default <Chip tone="indigo">Admin</Chip>
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">
        {a.org ? (
          <>
            <span aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded-full align-[-1px]" style={{ background: a.org.accent }} />
            {org} uses {a.org.accent}
            {a.locked ? ', locked for everyone.' : ' for everyone who has not picked their own.'}
          </>
        ) : (
          `Everyone in ${org} starts with Blue until they pick their own. Make one of your custom profiles the default instead.`
        )}
      </p>
      {a.custom.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Profile for the organisation"
            value={pick?.id ?? ''}
            onChange={(e) => setSource(e.target.value)}
            className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
          >
            {a.custom.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <Checkbox checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Lock it, so people cannot pick their own
          </label>
          <Button size="sm" variant="primary" loading={busy} disabled={!pick} onClick={() => pick && void send(pick, locked, `${pick.name} is now ${org}'s colour profile.`)}>
            Make default
          </Button>
        </div>
      ) : null}
      {a.org ? (
        <div>
          <Button size="sm" disabled={busy} onClick={() => void send(null, false, `${org} has no colour profile default now.`)}>
            Clear the default
          </Button>
        </div>
      ) : null}
    </div>
  );
}
