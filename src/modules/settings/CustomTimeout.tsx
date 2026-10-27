import { useEffect, useId, useRef, useState } from 'react';
import { updatePrefs } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, NumberField, cx } from '../../components/ui';
import { SettingRowFrame } from '../../components/SettingsKit';

/** The longest custom lock timeout without an organization limit: a day. */
export const MAX_LOCK_MINUTES = 1440;

/** Minutes as people read them: "45 minutes", "1 hour", "1 h 30 min", "10 hours". */
export function minutesInWords(m: number): string {
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} hour${h === 1 ? '' : 's'}`;
}

/** A typed timeout as a whole number of minutes within 1–`max`, or null. */
export function timeoutMinutes(text: string, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}

/**
 * Settings › Security › Custom timeout (#232): one row — the title and help on the left, the minutes and Save on the
 * right, on one line; under the help text when the pane is narrow. The neighbouring controls save as they change, so
 * a valid new number also saves when the field is left; Save and Enter save it at once.
 */
export function CustomTimeoutRow({ minutes, max = MAX_LOCK_MINUTES }: { minutes: number; max?: number }) {
  const id = useId();
  const [text, setText] = useState(String(minutes || 15));
  // A timeout saved elsewhere (the list above, another window) shows here too.
  const [shown, setShown] = useState(minutes);
  // What was last saved from here, so Save and leaving the field do not send it twice while it is on its way.
  const [last, setLast] = useState(minutes);
  if (shown !== minutes) {
    setShown(minutes);
    setLast(minutes);
    if (minutes) setText(String(minutes));
  }
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const value = timeoutMinutes(text, max);
  const invalid = value === null;
  const changed = value !== null && value !== last;
  const error = `Enter a whole number from 1 to ${max}`;

  const save = () => {
    if (!changed) return;
    const before = last;
    setLast(value);
    setText(String(value));
    updatePrefs({ appLockMinutes: value }).then(
      () => {
        setSaved(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setSaved(false), 2000);
      },
      (e: unknown) => {
        setLast(before);
        toast('error', errorMessage(e));
      },
    );
  };

  return (
    <SettingRowFrame className="@container">
      <div className="flex flex-col items-start gap-2.5 @[480px]:flex-row @[480px]:items-center @[480px]:gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">Custom timeout</div>
          <div id={`${id}-help`} className="mt-0.5 text-[12.5px] text-ink-3">
            Whole minutes from 1 to {max}
            {value !== null ? ` · ${minutesInWords(value)}` : null}
          </div>
          {invalid ? (
            <div id={`${id}-error`} className="mt-0.5 text-[12px] text-danger">
              {error}
            </div>
          ) : null}
        </div>
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <NumberField
            aria-label="Timeout in minutes"
            aria-describedby={cx(`${id}-help`, invalid && `${id}-error`)}
            value={text}
            onValueChange={(v) => {
              setText(v);
              setSaved(false);
            }}
            onBlur={save}
            min={1}
            max={max}
            step={1}
            unit="min"
            invalid={invalid}
          />
          <Button type="submit" className={cx('!h-10 min-w-[72px]', saved && '!text-success')} disabled={!changed}>
            {saved && !changed ? 'Saved ✓' : 'Save'}
          </Button>
          <span role="status" className="sr-only">
            {saved && !changed ? 'Saved' : ''}
          </span>
        </form>
      </div>
    </SettingRowFrame>
  );
}
