import { useEffect, useId, useState } from 'react';
import type { MailAlertState, PauseMode, PreviewLevel } from '@shared/mail-alerts';
import { app, updatePrefs } from '../../../core/app-state';
import { call, errorMessage, on } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { cx } from '../../../components/ui';

/**
 * Settings › Mail › New-mail alerts on this computer (ENH-MAIL-05): what an alert may show (MNA-PRV-01, with the
 * organisation's minimum), Mail sound (MNA-WIN-07) and the pause (MNA-TRY-02). The preview level and the sound are
 * the person's (saved on the server too); the pause is this computer's.
 */

const LEVELS: Array<{ value: PreviewLevel; label: string; example: string }> = [
  { value: 'full', label: 'Sender and preview', example: 'Dinesh Perera · Q4 budget — need your numbers by 3 pm' },
  { value: 'sender', label: 'Sender only', example: 'Dinesh Perera · New email' },
  { value: 'hidden', label: 'Hidden', example: 'New email in {account}' },
];

const RANK: Record<PreviewLevel, number> = { full: 0, sender: 1, hidden: 2 };

export function MailAlertSettings() {
  const prefs = useStore(app, (s) => s.prefs);
  const [state, setState] = useState<MailAlertState | null>(null);
  const name = useId();

  useEffect(() => {
    let live = true;
    void call('mailAlert:state')
      .then((s) => live && setState(s))
      .catch(() => undefined);
    const off = on<MailAlertState>('mail-alert:state', (s) => setState(s));
    return () => {
      live = false;
      off();
    };
  }, []);

  if (!prefs) return null;
  const min = state?.minPreview ?? null;
  const chosen: PreviewLevel = prefs.mailAlertPreview ?? state?.preview ?? 'full';
  const shown: PreviewLevel = min && RANK[min] > RANK[chosen] ? min : chosen;
  const account = state?.accounts[0]?.label ?? text('your account');

  const setLevel = (v: PreviewLevel) => {
    void updatePrefs({ mailAlertPreview: v });
    void call('mailAlert:prefs', { preview: v }).then(setState, () => undefined);
  };
  const setSound = (on: boolean) => {
    void updatePrefs({ mailAlertSound: on });
    void call('mailAlert:prefs', { sound: on }).then(setState, () => undefined);
  };
  const pause = (mode: PauseMode | null) =>
    void call('mailAlert:pause', { mode })
      .then((s) => {
        setState(s);
        toast('info', mode ? text('Mail alerts paused. Mail still syncs; only pop-ups and sounds stop.') : text('Mail alerts are on again.'));
      })
      .catch((e) => toast('error', errorMessage(e)));

  return (
    <div className="flex flex-col gap-3" aria-label={text('New-mail alerts')}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-semibold text-ink">{text('Alerts show')}</legend>
        {LEVELS.map((l) => {
          const locked = !!min && RANK[l.value] < RANK[min];
          return (
            <label key={l.value} className={cx('flex items-start gap-2.5', locked && 'opacity-60')}>
              <input type="radio" name={name} value={l.value} checked={shown === l.value} disabled={locked} onChange={() => setLevel(l.value)} className="mt-[3px] accent-[var(--color-primary)]" />
              <span className="flex flex-col">
                <span>{text(l.label)}</span>
                <span className="text-[12px] text-ink-3">{text(l.example, { account })}</span>
              </span>
            </label>
          );
        })}
        {min ? <p className="text-[12px] text-ink-3">{min === 'hidden' ? text('Your organization hides what new-mail alerts show.') : text('Your organization shows at most the sender in new-mail alerts.')}</p> : null}
        <p className="text-[12px] text-ink-3">{state?.sharing ? text('Your screen is being shared: previews are hidden until sharing stops.') : text('While your screen is shared, previews are hidden. Confidential messages never show a preview.')}</p>
      </fieldset>
      <label className="flex items-center gap-2.5">
        <Checkbox checked={prefs.mailAlertSound !== false} onChange={(e) => setSound(e.target.checked)} />
        {text('Mail sound')}
      </label>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{state?.pause ? text('Mail alerts: {state}', { state: state.pauseLabel ?? text('Paused') }) : text('Pause mail alerts')}</span>
          {state?.pause ? (
            <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => pause(null)}>
              {text('Resume')}
            </button>
          ) : null}
        </div>
        <div role="group" aria-label={text('Pause mail alerts')} className="flex flex-wrap gap-1.5">
          {(state?.pauseChoices ?? []).map((c) => (
            <button key={c.mode} type="button" onClick={() => pause(c.mode)} aria-pressed={state?.pause?.mode === c.mode} className={cx('rounded-[8px] border border-line px-2.5 py-1 text-[12.5px] hover:bg-subtle', state?.pause?.mode === c.mode && 'border-primary text-primary')}>
              {text(c.label)}
              {c.detail ? <span className="ml-1 text-ink-3">{c.detail}</span> : null}
            </button>
          ))}
        </div>
        {state?.hoursNote ? <p className="text-[12px] text-ink-3">{text(state.hoursNote)}</p> : null}
        <p className="text-[12px] text-ink-3">{text('Mail still syncs. Unread counts keep updating; only pop-ups and sounds stop.')}</p>
      </div>
    </div>
  );
}
