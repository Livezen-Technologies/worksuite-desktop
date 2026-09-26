import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { K, useRefreshMe, type Pictures, type VisibilityMode } from './api';

/**
 * Who sees your picture: everyone in your companies, your teams, or the
 * companies you tick. Anybody left out sees your initials. Saved as soon as
 * it is chosen (`PUT /users/me/pictures/visibility`), as on the web.
 */
type Visibility = NonNullable<Pictures['visibility']>;

const MODES: Array<{ id: VisibilityMode; label: string; hint: string }> = [
  { id: 'organization', label: 'Everyone in your companies', hint: 'The people who can see you in WorkSuite.' },
  { id: 'teams', label: 'Your teams', hint: 'Only people in teams you belong to.' },
  { id: 'organizations', label: 'Companies you choose', hint: 'People in the companies you tick below.' },
];

function useSave(value: Visibility) {
  const qc = useQueryClient();
  const refresh = useRefreshMe();
  const [state, setState] = useState<{ mode: VisibilityMode; orgs: number[] }>({ mode: value.mode, orgs: value.orgs });
  const [saving, setSaving] = useState(false);
  const save = async (mode: VisibilityMode, orgs: number[]) => {
    const before = state;
    setState({ mode, orgs });
    // Chosen companies with none ticked is not a choice yet; the last saved one still applies.
    if (mode === 'organizations' && orgs.length === 0) return;
    setSaving(true);
    try {
      await apiPut('/api/users/me/pictures/visibility', { mode, orgs });
      qc.setQueryData<Pictures>(K.pictures, (p) => (p?.visibility ? { ...p, visibility: { ...p.visibility, mode, orgs } } : p));
      await refresh();
      toast('success', 'Saved: who sees your picture.');
    } catch (e) {
      setState(before);
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return { ...state, saving, save };
}

function teamHint(v: Visibility): string {
  const names = v.teams.map((t) => t.name);
  return names.length ? `People in ${names.length === 1 ? 'your team' : 'your teams'}: ${names.join(', ')}.` : 'You are not in any team, so only you and the administrators who review pictures would see it.';
}

/** The Profile pictures page's version: a card per choice, and the companies to tick. */
export function VisibilityCards({ value, canEdit }: { value: Visibility; canEdit: boolean }) {
  const { mode, orgs, saving, save } = useSave(value);
  const modes = MODES.filter((m) => m.id !== 'organizations' || value.companies.length > 0);
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!canEdit || saving}>
      <legend className="sr-only">Visibility</legend>
      {modes.map((m) => {
        const on = mode === m.id;
        return (
          <label key={m.id} className={cx('flex cursor-pointer items-start gap-3 rounded-[12px] px-3 py-[11px]', on ? 'bg-[#F3F5FE] shadow-[0_0_0_1.5px_var(--color-primary)] dark:bg-selection' : 'shadow-[0_0_0_1px_var(--color-line)]', !canEdit && 'cursor-not-allowed opacity-60')}>
            <input type="radio" name="picture-visibility" checked={on} onChange={() => void save(m.id, m.id === 'organizations' ? orgs : [])} className="mt-[3px] accent-primary" />
            <span className="flex min-w-0 flex-col">
              <b className="text-[13px] text-ink">{m.label}</b>
              <span className="text-[12px] text-ink-3">{m.id === 'teams' ? teamHint(value) : m.hint}</span>
            </span>
          </label>
        );
      })}
      {value.companies.length > 0 ? (
        <div role="group" aria-label="Companies that see your picture" className="mt-1 flex flex-col gap-1.5 pl-1">
          {value.companies.map((c) => {
            const off = mode !== 'organizations';
            return (
              <label key={c.id} className={cx('flex items-center gap-2 text-[13px]', off ? 'text-ink-3' : 'text-ink')}>
                <input type="checkbox" disabled={off} checked={!off && orgs.includes(c.id)} onChange={(e) => void save('organizations', e.target.checked ? [...orgs, c.id] : orgs.filter((o) => o !== c.id))} className="accent-primary" />
                {c.name}
              </label>
            );
          })}
          {mode === 'organizations' && orgs.length === 0 ? <p className="m-0 text-[12px] text-warning">Tick at least one company. Until you do, the last saved choice still applies.</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

/** The compact version, for Profile settings and the picture editor. Choosing companies ticks all of them; Profile pictures narrows it. */
export function VisibilitySelect({ value, canEdit, className }: { value: Visibility; canEdit: boolean; className?: string }) {
  const { mode, orgs, saving, save } = useSave(value);
  const modes = MODES.filter((m) => m.id !== 'organizations' || value.companies.length > 0);
  return (
    <Select
      label="Who sees your picture"
      className={className}
      value={mode}
      disabled={!canEdit || saving}
      options={modes.map((m) => ({ value: m.id, label: m.label }))}
      onValueChange={(v) => void save(v, v === 'organizations' ? (orgs.length ? orgs : value.companies.map((c) => c.id)) : [])}
    />
  );
}
