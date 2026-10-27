import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { navigate } from '../../../core/tabs';
import { useStore } from '../../../core/store';
import { dateLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, ErrorNote, Spinner, Switch, cx } from '../../../components/ui';
import { addMyListEntry, protectionKeys, removeMyListEntry, useMyLists, useProtectionSettings, useQuarantineCount, useSaveProtectionSettings } from './api';
import { QUARANTINE_ROUTE } from './QuarantinePage';
import { STATE_CHIP } from './verdicts';
import type { ListEntry, ProtectedAccount, ProtectionSettings } from './types';

/**
 * Settings › Mail › Spam & security (D19, P-UI-14): how each of the person's accounts is protected, the spam level
 * their organisation set, the quarantine digest, their own safe and blocked senders, and link checking. What the
 * organisation fixes is shown as fixed, never as a switch that does nothing.
 */

const ACCOUNT_STATE: Record<ProtectedAccount['state'], { label: string; tone: keyof typeof STATE_CHIP; how: string }> = {
  protected: { label: 'Protected', tone: 'ok', how: 'Checked on arrival — dangerous mail is refused or held' },
  scanning_on_open: { label: 'Protected', tone: 'ok', how: 'Checked when synced and when opened' },
  waiting: { label: 'Waiting for sync', tone: 'warn', how: 'New mail is checked once the account syncs again' },
  off: { label: 'Not protected', tone: 'muted', how: 'Mail protection is off for this account' },
};

/** A domain or an address, as the person typed it; null when it is neither. */
export function senderValue(v: string): string | null {
  const s = v.trim().toLowerCase().replace(/^@/, '');
  if (/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s)) return s;
  return null;
}

export function SpamSecurity() {
  const settings = useProtectionSettings();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  if (settings.isLoading) return <Spinner />;
  if (settings.error) return <ErrorNote error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <p className="text-[13.5px] text-ink-3">{text('Your WorkSuite server does not check mail for spam and viruses yet. Ask your administrator about mail protection.')}</p>;
  return <SpamSecurityForm s={settings.data} offline={offline} />;
}

function SpamSecurityForm({ s, offline }: { s: ProtectionSettings; offline: boolean }) {
  const save = useSaveProtectionSettings();
  const held = useQuarantineCount(true);
  const set = (patch: Partial<Pick<ProtectionSettings, 'digest' | 'junk_level' | 'link_check'>>) => void save(patch).catch((e) => toast('error', errorMessage(e)));
  const policy = s.accounts[0]?.policy ?? null;
  const card = 'flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-[18px] py-[14px]';
  return (
    <div data-spam-security className="flex flex-col gap-[13px] text-[13px]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[12px] text-ink-3">{text('Settings / Mail')}</span>
          <h2 className="text-[21px] font-bold text-ink">{text('Spam & security')}</h2>
        </div>
        {policy ? (
          <span className="flex items-center gap-2.5 rounded-[10px] bg-selection px-3 py-[7px] text-[12px] text-primary">
            <Icon name="shield-check" size={16} />
            <span>
              <b>{text('Organisation policy: {name}', { name: policy.name })}</b>
              <br />
              <span className="text-ink-2">{policy.source || text('Set by your organisation’s admins')}</span>
            </span>
          </span>
        ) : null}
      </div>

      <section aria-labelledby="prot-accounts" className={card}>
        <div className="flex flex-wrap items-baseline gap-2.5 pb-1">
          <h3 id="prot-accounts" className="flex-1 text-[14.5px] font-bold text-ink">{text('Protection for your accounts')}</h3>
          <span className="text-[12px] text-ink-3">{text('Every message is checked for viruses, phishing and spam before you see it')}</span>
        </div>
        {s.accounts.length === 0 ? <p className="text-ink-3">{text('No mail accounts yet.')}</p> : null}
        {s.accounts.map((a) => {
          const st = ACCOUNT_STATE[a.state] ?? ACCOUNT_STATE.off;
          return (
            <div key={a.id} className="flex min-h-9 items-center gap-3.5 border-t border-line py-1.5">
              <span className="flex w-[250px] shrink-0 flex-col">
                <b className="truncate text-[12.5px] text-ink">{a.email}</b>
                <span className="text-[11.5px] text-ink-3">{a.provider}</span>
              </span>
              <span className="flex-1 text-[12.5px] text-ink-2">{text(st.how)}</span>
              <span className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold whitespace-nowrap', STATE_CHIP[st.tone])}>{text(st.label)}</span>
              <span className="w-[140px] shrink-0 truncate text-right text-[11.5px] text-ink-3" title={a.policy.source}>{a.policy.name}</span>
            </div>
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-[13px] xl:grid-cols-2">
        <section aria-labelledby="prot-junk" className={card}>
          <h3 id="prot-junk" className="text-[14.5px] font-bold text-ink">{text('Junk and quarantine')}</h3>
          <div className="flex flex-col gap-2 rounded-[10px] bg-ground px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-ink">{text('Spam filter level')}</b>
              <span className="flex-1" />
              <Segmented label={text('Spam filter level')} value={s.junk_level} options={[['standard', text('Standard')], ['strict', text('Strict')]]} disabled={offline} onChange={(v) => set({ junk_level: v })} />
            </div>
            <div aria-hidden className="flex h-2 overflow-hidden rounded-[4px]">
              <span className="w-[30%] bg-green" />
              <span className={cx('bg-amber', s.junk_level === 'strict' ? 'w-[25%]' : 'w-[20%]')} />
              <span className="flex-1 bg-red" />
            </div>
            <div className="flex text-[11.5px] text-ink-2">
              <span className="w-[30%]">{text('Inbox')}</span>
              <span className={s.junk_level === 'strict' ? 'w-[25%]' : 'w-[20%]'}>{text('Junk Email')}</span>
              <span className="flex-1">{text('Held in Quarantine')}</span>
            </div>
            <p className="text-[11.5px] text-ink-3">{text('Strict sends more to Junk and Quarantine. Your organisation may not allow a change.')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
            <span className="flex flex-1 flex-col">
              <span className="font-semibold text-ink">{text('Quarantine digest')}</span>
              <span className="text-[11.5px] text-ink-3">{text('An email when something new is held, with Release and Request release')}</span>
            </span>
            <Segmented label={text('Quarantine digest')} value={s.digest} options={[['daily', text('Daily')], ['weekly', text('Weekly')], ['off', text('Off')]]} disabled={offline} onChange={(v) => set({ digest: v })} />
          </div>
          <Button className="self-start" icon="shield" onClick={() => navigate(QUARANTINE_ROUTE)}>
            {held ? text('Open quarantine · {n} held', { n: held }) : text('Open quarantine')}
          </Button>
        </section>
        <SendersCard offline={offline} />
      </div>

      <section aria-labelledby="prot-links" className={card}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h3 id="prot-links" className="flex-1 text-[14.5px] font-bold text-ink">{text('Links, images and attachments')}</h3>
          <span className="text-[12px] text-ink-3">{text('Attachments stay locked until they have been checked')}</span>
        </div>
        <div className="grid grid-cols-1 gap-x-[22px] gap-y-3 lg:grid-cols-3">
          <div className="flex items-start gap-3">
            <Switch checked={s.link_check} onChange={(v) => set({ link_check: v })} disabled={offline} label={text('Check links when I click them')} describedBy="link-check-hint" />
            <span className="flex flex-col">
              <span className="text-[12.5px] font-semibold text-ink">{text('Check links when I click them')}</span>
              <span id="link-check-hint" className="text-[11.5px] leading-[1.4] text-ink-3">{text('Dangerous sites show a warning first')}</span>
            </span>
          </div>
          <Fixed title={text('Block pictures in Junk and suspicious mail')} />
          <Fixed title={text('Lock attachments until they are checked')} />
        </div>
      </section>
    </div>
  );
}

/** A rule the organisation fixes: shown, never offered as a switch. */
function Fixed({ title }: { title: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-ink-3" />
      <span className="flex flex-col">
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="text-[11.5px] text-ink-3">{text('Always on · set by your organisation')}</span>
      </span>
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] bg-subtle p-[3px]">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)} className={cx('flex h-[26px] items-center rounded-[7px] px-[11px] text-[12px] font-semibold disabled:opacity-60', value === v ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(15,27,61,.14)]' : 'text-ink-2')}>
          {l}
        </button>
      ))}
    </span>
  );
}

function entryMeta(e: ListEntry): string {
  if (e.migrated) return text('From your old mail rules');
  if (e.scope !== 'user') return text('{scope} · set by your organisation', { scope: e.scope_label });
  return [e.value_type === 'domain' ? text('Domain') : text('Address'), e.created_at ? dateLabel(e.created_at) : null].filter(Boolean).join(' · ');
}

/** Safe and blocked senders: the person's own, with the organisation's shown and not removable here. */
function SendersCard({ offline }: { offline: boolean }) {
  const qc = useQueryClient();
  const lists = useMyLists();
  const [kind, setKind] = useState<'allow' | 'block'>('allow');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const entries = lists.data ? (kind === 'allow' ? lists.data.allow : lists.data.block) : [];
  const parsed = senderValue(value);
  const add = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      await addMyListEntry(kind, parsed);
      setValue('');
      void qc.invalidateQueries({ queryKey: protectionKeys.lists });
    } catch (e) {
      // A refusal says why in words (a domain that publishes DMARC p=reject cannot be allowed, AC-MPR-08).
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (e: ListEntry) => {
    try {
      await removeMyListEntry(e.id);
      void qc.invalidateQueries({ queryKey: protectionKeys.lists });
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };
  return (
    <section aria-labelledby="prot-senders" className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-[18px] py-[14px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 id="prot-senders" className="flex-1 text-[14.5px] font-bold text-ink">{text('Safe and blocked senders')}</h3>
        <Segmented
          label={text('Which list')}
          value={kind}
          options={[
            ['allow', `${text('Safe senders')}${lists.data ? ` · ${lists.data.allow.length}` : ''}`],
            ['block', `${text('Blocked')}${lists.data ? ` · ${lists.data.block.length}` : ''}`],
          ]}
          onChange={setKind}
        />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input aria-label={kind === 'allow' ? text('Add a safe sender') : text('Add a blocked sender')} placeholder={text('name@company.com or company.com')} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink" />
        <Button type="submit" variant="primary" loading={busy} disabled={!parsed || offline} title={offline ? text('Available when you are back online.') : undefined}>
          {text('Add')}
        </Button>
      </form>
      {lists.isLoading ? <Spinner /> : lists.error ? <ErrorNote error={lists.error} onRetry={() => void lists.refetch()} /> : (
        <ul role="list" aria-label={kind === 'allow' ? text('Safe senders') : text('Blocked senders')} className="flex flex-col">
          {entries.length === 0 ? <li className="py-1.5 text-[12.5px] text-ink-3">{kind === 'allow' ? text('No safe senders yet.') : text('No blocked senders yet.')}</li> : null}
          {entries.map((e) => (
            <li key={e.id} className="flex h-8 items-center gap-2.5 border-b border-line">
              <span aria-hidden className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[10.5px] font-bold', kind === 'allow' ? STATE_CHIP.ok : STATE_CHIP.bad)}>
                {e.value_type === 'domain' ? '@' : e.value.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{e.value}</span>
              <span className="truncate text-[11.5px] text-ink-3">{entryMeta(e)}</span>
              {e.scope === 'user' ? (
                <button type="button" aria-label={text('Remove {value}', { value: e.value })} disabled={offline} onClick={() => void remove(e)} className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-40">
                  <Icon name="x" size={13} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="flex gap-2 rounded-[9px] bg-info-bg px-[11px] py-[9px] text-[12px] leading-[1.45] text-blue-ink dark:bg-blue-bg dark:text-indigo-bright">
        <Icon name="info" size={14} className="mt-px shrink-0" />
        <span>{text('Safe senders skip the spam filter only. Viruses, phishing and spoofed mail are still checked.')}</span>
      </p>
    </section>
  );
}
