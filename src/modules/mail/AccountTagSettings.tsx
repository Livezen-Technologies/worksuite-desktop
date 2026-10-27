import { useState } from 'react';
import { text } from '../../core/i18n';
import { Button, cx } from '../../components/ui';
import { useMailPrefs } from './api';
import { clip, paletteOf, TAG_MAX, TAG_PRESETS, type AccountTagPref, type AccountTagShow } from './accountTags';
import { AccountTag } from './parts';
import { useAccountTags } from './useAccountTags';
import type { Mailbox } from './types';
import { SettingRow, SettingRowFrame, SettingsGroup } from '../../components/SettingsKit';

const SHOW: Array<[AccountTagShow, string]> = [
  ['combined', 'Combined views'],
  ['all', 'All views'],
  ['never', 'Never'],
];

/**
 * One account's tag (#227): its label (the first name by default, at most twelve characters), its colour (eight
 * presets or your own) and where it shows, with the pill as it will look and Reset to default. Kept with the mail
 * settings, so every computer shows the same tags.
 */
export function AccountTagSettings({ box }: { box: Mailbox }) {
  const { prefs, set } = useMailPrefs();
  const { tags, mode } = useAccountTags();
  const tag = tags.get(box.id);
  const all = prefs.accountTags ?? {};
  const own: AccountTagPref = all[box.id] ?? {};
  const [draft, setDraft] = useState(own.label ?? '');
  if (!tag) return null;

  const save = (patch: AccountTagPref | null) => {
    const next = { ...all };
    if (patch === null) delete next[box.id];
    else {
      const merged = { ...own, ...patch };
      for (const k of Object.keys(merged) as Array<keyof AccountTagPref>) if (merged[k] === undefined || merged[k] === '') delete merged[k];
      if (Object.keys(merged).length) next[box.id] = merged;
      else delete next[box.id];
    }
    set({ accountTags: next });
  };
  const commit = () => {
    const v = draft.trim();
    if (v !== (own.label ?? '')) save({ label: v || undefined });
  };
  const colour = own.colour ?? tag.colour;
  const custom = /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#4f46e5';
  const preview = { ...tag, label: draft.trim() ? clip(draft) : tag.label, palette: paletteOf(colour) };
  // Told apart automatically ("Hasarinda 2"), or the same as another account's on purpose: either way, say so.
  const renamed = !own.label && tag.label !== tag.auto;

  return (
    <SettingsGroup
      title={text('Account tag')}
      className="!mb-0"
      actions={
        <span aria-label={text('Preview')} className="inline-flex items-center">
          <AccountTag tag={preview} mode={mode === 'off' ? 'name' : mode} />
        </span>
      }
    >
      <SettingRow label={text('Tag label')}>
        <input
          aria-label={text('Tag label')}
          value={draft}
          maxLength={TAG_MAX}
          placeholder={tag.auto}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className="h-8 w-[200px] min-w-0 rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary"
        />
      </SettingRow>
      {tag.clash || renamed ? (
        <SettingRowFrame>
        <p role="note" className="rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-ink">
          {tag.clash
            ? text('Another account also shows “{label}”. Rename one so you can tell them apart.', { label: tag.label })
            : text('Shown as “{label}”: another account has the same name. Rename one here.', { label: tag.label })}
        </p>
        </SettingRowFrame>
      ) : null}
      <SettingRow label={text('Colour')}>
        <div role="radiogroup" aria-label={text('Colour')} className="flex flex-wrap items-center gap-1.5">
          {TAG_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={colour === p.id}
              aria-label={text(p.label)}
              title={text(p.label)}
              onClick={() => save({ colour: p.id })}
              style={{ background: p.bg, color: p.fg }}
              className={cx('inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold', colour === p.id ? 'border-ink ring-2 ring-primary/40' : 'border-line')}
            >
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: p.fg }} />
            </button>
          ))}
          <label title={text('Your own colour')} className={cx('relative inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] font-semibold text-ink-2', colour.startsWith('#') ? 'border-ink ring-2 ring-primary/40' : 'border-line')}>
            <input type="color" aria-label={text('Your own colour')} value={custom} onChange={(e) => save({ colour: e.target.value })} className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0" />
            {text('Custom')}
          </label>
        </div>
      </SettingRow>
      <SettingRow label={text('Show tag in')}>
        <div role="radiogroup" aria-label={text('Show tag in')} className="flex rounded-[10px] bg-subtle p-0.5">
          {SHOW.map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={tag.show === v} onClick={() => save({ show: v === 'combined' ? undefined : v })} className={cx('h-7 rounded-[8px] px-2.5 text-[12.5px] font-semibold', tag.show === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
              {text(l)}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRowFrame className="flex items-center gap-3">
        <span className="flex-1 text-[12px] text-ink-3">{mode === 'off' ? text('Account tags are off in Appearance & reading.') : text('Also beside the account in the sidebar, in From when you write, and above the message you read.')}</span>
        <Button
          size="sm"
          disabled={!all[box.id]}
          onClick={() => {
            setDraft('');
            save(null);
          }}
        >
          {text('Reset to default')}
        </Button>
      </SettingRowFrame>
    </SettingsGroup>
  );
}
