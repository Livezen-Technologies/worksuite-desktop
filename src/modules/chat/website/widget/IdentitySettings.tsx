import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { ApiError } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Button, TextField, cx } from '../../../../components/ui';
import { IDENTIFY_SNIPPET, SIGNING_SNIPPETS, saveIdentitySettings, useIdentitySettings, type IdentitySettings as Settings } from '../identity';
import { Choice, Toggle } from './parts';
import { SettingsGroup } from '../../../../components/SettingsKit';

type Form = Omit<Settings, 'has_secret'>;

const pick = (s: Settings): Form => ({
  reopen_window_days: s.reopen_window_days,
  device_continuation: s.device_continuation,
  auto_link_contacts: s.auto_link_contacts,
  cookie_days: s.cookie_days,
  retention_days: s.retention_days,
});

/** What a form value would be refused for, in the server's own words; null when it is fine. */
export function identityProblem(f: Form): string | null {
  if (!Number.isInteger(f.reopen_window_days) || f.reopen_window_days < 0 || f.reopen_window_days > 90) return 'Enter a reopen window of 0 to 90 days.';
  if (!Number.isInteger(f.cookie_days) || f.cookie_days < 1 || f.cookie_days > 730) return 'Remember visitors for 1 to 730 days.';
  if (!Number.isInteger(f.retention_days) || f.retention_days < 0 || f.retention_days > 3650 || (f.retention_days > 0 && f.retention_days < 7)) return 'Delete anonymous visitors after 7 to 3650 days, or 0 to keep them.';
  return null;
}

const code = 'block rounded-[8px] bg-stage px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] break-all whitespace-pre-wrap text-stage-ink';

/**
 * Returning visitors (worksuite-desktop#222), beside the embed code: the settings — the reopen window, "Continue on
 * another device", linking to contacts, how long the browser remembers somebody, and retention — and, for the site's
 * developers, the identify secret and how to use WorkSuiteChat.identify() and logout(). A server without returning
 * visitors shows nothing here.
 */
export function IdentitySection({ widgetId }: { widgetId: number }) {
  const q = useIdentitySettings(widgetId);
  const qc = useQueryClient();
  // What is being changed; null is what is saved.
  const [edit, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState('php');

  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.forbidden)) return null;
  // No settings in the answer (a server before returning visitors, or another shape): nothing to show.
  if (!q.data?.settings) return null;
  const p = q.data;
  const form = edit ?? pick(p.settings);
  const can = p.can_manage;
  const saved = pick(p.settings);
  const dirty = JSON.stringify(saved) !== JSON.stringify(form);
  const problem = identityProblem(form);

  const save = async (patch: Partial<Form> & { regenerate_secret?: boolean }, done: string) => {
    setBusy(true);
    try {
      const next = await saveIdentitySettings(widgetId, patch);
      qc.setQueryData(['website', 'widget', widgetId, 'identity'], next);
      setForm(null);
      toast('success', text(done));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const num = (k: keyof Pick<Form, 'reopen_window_days' | 'cookie_days' | 'retention_days'>) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value === '' ? Number.NaN : Number(e.target.value) });

  return (
    <SettingsGroup
      title={text('Returning visitors')}
      className="!mb-0 text-[12.5px]"
      description={text('One person, one conversation: reloads, new tabs and later visits continue it. Signed-in users and verified emails are recognised on any device; an email somebody only typed suggests a merge to your team.')}
    >
      <form
        className="flex flex-col gap-3 px-[18px] py-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem || !dirty) return;
          void save(form, 'Widget saved');
        }}
      >
        <fieldset disabled={!can || busy} className="flex flex-col gap-3">
          <TextField label={text('Reopen a closed chat for (days)')} type="number" min={0} max={90} value={Number.isNaN(form.reopen_window_days) ? '' : form.reopen_window_days} onChange={num('reopen_window_days')}
            hint={text('Their next message reopens a chat closed this recently. 0: only a chat that closed itself, as before.')} />
          <Choice
            label={text('Continue on another device')}
            value={form.device_continuation}
            options={[{ value: 'off', label: text('Off') }, { value: 'email_code', label: text('With a code by email') }]}
            onChange={(v) => setForm({ ...form, device_continuation: v })}
          />
          {form.device_continuation === 'email_code' && !p.mail ? <p role="note" className="rounded-[8px] bg-warning-bg px-3 py-2 text-ink-2">{text('This server cannot send email yet, so visitors would not get their code.')}</p> : null}
          <Toggle label={text('Link visitors to contacts')} hint={text('By their email or phone, when exactly one contact has it. Their chats go on the contact’s timeline.')} checked={form.auto_link_contacts} onChange={(v) => setForm({ ...form, auto_link_contacts: v })} />
          <TextField label={text('Remember a visitor’s browser for (days)')} type="number" min={1} max={730} value={Number.isNaN(form.cookie_days) ? '' : form.cookie_days} onChange={num('cookie_days')}
            hint={text('In a cookie and local storage on your site, renewed on each visit.')} />
          <TextField label={text('Delete anonymous visitors who never chatted after (days)')} type="number" min={0} max={3650} value={Number.isNaN(form.retention_days) ? '' : form.retention_days} onChange={num('retention_days')}
            hint={text('0 keeps them. Visitors who chatted or left details are kept; use Delete visitor data on a profile for those.')} />
        </fieldset>
        {problem ? <p role="alert" className="text-danger">{text(problem)}</p> : null}
        {can ? (
          <span className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={busy || !dirty || Boolean(problem)}>{text('Save')}</Button>
            <Button type="button" disabled={busy || !dirty} onClick={() => setForm(null)}>{text('Undo changes')}</Button>
          </span>
        ) : (
          <p role="note" className="text-ink-3">{text('Changing these needs the “Create and configure chat widgets” permission.')}</p>
        )}
      </form>

      <div className="flex flex-col gap-2 px-[18px] py-3.5">
        <h3 className="text-[13px] font-bold text-ink">{text('For your developers: recognise signed-in users')}</h3>
        <ol className="ml-4 list-decimal text-ink-2">
          <li>{text('Keep the secret below in your server’s settings, never in a page.')}</li>
          <li>{text('On your server, sign the user’s id with it (HMAC-SHA256, hex).')}</li>
          <li>{text('On the page, call WorkSuiteChat.identify() with the id and the signature; call WorkSuiteChat.logout() when they sign out.')}</li>
        </ol>
        {p.secret ? (
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-ink">{text('Identify secret')}</span>
            <span className="flex items-center gap-1.5">
              <code aria-label={text('Identify secret')} className="min-w-0 flex-1 truncate rounded-[6px] bg-subtle px-2 py-1 font-mono text-[11.5px] text-ink selectable">{p.secret}</code>
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(p.secret ?? '').then(() => toast('success', text('Secret copied.')))}>{text('Copy')}</Button>
              {can ? <Button size="sm" disabled={busy} onClick={() => void save({ regenerate_secret: true }, 'New secret made — update your website')}>{text('Make a new one')}</Button> : null}
            </span>
            <span className="text-ink-3">{text('A new secret stops every old signature working: signed-in visitors are treated as unverified until your site uses it.')}</span>
          </div>
        ) : null}
        <div role="tablist" aria-label={text('Language')} className="flex gap-1">
          {SIGNING_SNIPPETS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={lang === s.id} onClick={() => setLang(s.id)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', lang === s.id ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
              {s.label}
            </button>
          ))}
        </div>
        <pre aria-label={text('Sign the user id')} className={code}>{SIGNING_SNIPPETS.find((s) => s.id === lang)?.code}</pre>
        <pre aria-label={text('Identify on the page')} className={code}>{IDENTIFY_SNIPPET}</pre>
        <p className="text-ink-3">
          {text('Without a valid signature the id is kept as an unverified detail and recognises nobody. If your site asks for cookie consent, add data-cookie-consent="required" to the embed code and call WorkSuiteChat.consent(true) once it is given: until then the chat lasts the visit only.')}
        </p>
      </div>
    </SettingsGroup>
  );
}
