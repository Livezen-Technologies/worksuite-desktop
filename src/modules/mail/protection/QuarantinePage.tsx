import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { addMyListEntry, protectionKeys, releaseQuarantined, useMyLists, useQuarantine } from './api';
import { RequestReleaseDialog } from './VerdictBanner';
import { STATE_CHIP, VERDICT_CHIP, releaseFor, sizeWords, verdictLabel } from './verdicts';
import type { QuarantineItem, Verdict } from './types';

/**
 * Mail › Quarantine (D20, P-UI-13, MPR-UX-05): what was held for the person, across all their accounts — the reason
 * in words, the sender's checks, and what may be done: Release for spam (and Release and trust sender), Request release
 * for phishing, spoofing and blocked files (an administrator decides), and nothing for malware, which can never be
 * released by anyone (AC-MPR-14). Held mail is deleted after the policy's days; each item says when.
 */

export const QUARANTINE_ROUTE = '/mail/quarantine';

type StateFilter = 'held' | 'requested' | 'released' | 'all';
type VerdictFilter = 'all' | 'spam' | 'phish' | 'policy' | 'malware';

const VERDICT_GROUPS: Record<Exclude<VerdictFilter, 'all'>, Verdict[]> = {
  spam: ['SPAM', 'HIGH_SPAM', 'BULK'],
  phish: ['PHISH', 'SPOOF'],
  policy: ['POLICY'],
  malware: ['MALWARE'],
};

/** What may be done with an item, by its verdict and state — never a Release for malware. */
export function quarantineChoice(item: Pick<QuarantineItem, 'verdict' | 'release' | 'state' | 'request'>): 'release' | 'request' | 'requested' | 'never' | 'done' {
  if (item.state === 'released' || item.state === 'deleted' || item.state === 'expired') return 'done';
  const rule = releaseFor(item.verdict, item.release);
  if (rule === 'never' || item.verdict === 'MALWARE') return 'never';
  if (rule === 'self') return 'release';
  return item.state === 'requested' || item.request?.state === 'pending' ? 'requested' : 'request';
}

function when(stamp: string): string {
  return stamp ? `${dateLabel(stamp)} ${timeLabel(stamp)}` : '';
}

export function QuarantinePage() {
  useTabTitle(text('Quarantine'));
  const { navigate } = useTab();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const [state, setState] = useState<StateFilter>('held');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const [search, setSearch] = useState('');
  const q = useQuarantine(state, search);
  const lists = useMyLists();
  const [picked, setPicked] = useState<number | null>(null);
  const items = q.data?.items ?? [];
  const shown = verdict === 'all' ? items : items.filter((i) => VERDICT_GROUPS[verdict].includes(i.verdict));
  const current = shown.find((i) => i.id === picked) ?? shown[0] ?? null;
  const count = (f: VerdictFilter) => (f === 'all' ? items.length : items.filter((i) => VERDICT_GROUPS[f].includes(i.verdict)).length);
  const counts = q.data?.counts;
  const nav = (label: string, n: number | null, on: boolean, run: () => void, attention = false) => (
    <button type="button" aria-current={on ? 'page' : undefined} onClick={run} className={cx('flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', on ? 'bg-selection font-bold text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink')}>
      <span className="flex-1 truncate">{label}</span>
      {n !== null ? <span className={cx('text-[11.5px] font-bold', attention ? 'text-warning' : 'text-ink-3')}>{n}</span> : null}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 bg-ground">
      <nav aria-label={text('Protection')} className="flex w-[230px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface px-2.5 py-4">
        <button type="button" onClick={() => navigate('/mail')} className="mb-2 flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="chevron-left" size={14} />
          {text('Back to Mail')}
        </button>
        <h2 className="px-2.5 pb-1.5 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">{text('Protection')}</h2>
        {nav(text('Quarantine'), counts ? counts.held : null, true, () => setState('held'), !!counts?.held)}
        {nav(text('Junk Email · all accounts'), null, false, () => navigate('/mail?box=unified&folder=spam'))}
        {nav(text('Safe senders'), lists.data ? lists.data.allow.length : null, false, () => navigate('/settings/mail?tab=security'))}
        {nav(text('Blocked senders'), lists.data ? lists.data.block.length : null, false, () => navigate('/settings/mail?tab=security'))}
        <button type="button" onClick={() => navigate('/settings/mail?tab=security')} className="flex h-8 items-center px-2.5 text-left text-[12.5px] font-semibold text-primary hover:underline">
          {text('Spam & security settings')}
        </button>
        <span className="flex-1" />
        <div className="rounded-[10px] border border-line bg-ground p-3 text-[12px] leading-[1.5] text-ink-2">
          <b className="text-ink">{text('What is quarantine?')}</b>
          <br />
          {text('Mail held because it looked dangerous or was almost certainly spam. It never reached your Inbox and is deleted after the days your organisation keeps it.')}
        </div>
      </nav>
      <section aria-label={text('Quarantined messages')} className="flex w-[440px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-4 pb-2.5">
          <div className="flex items-baseline gap-2">
            <h1 className="flex-1 text-[17px] font-bold text-ink">{text('Quarantine')}</h1>
            <span className="text-[12px] text-ink-3">{text('{n} items · all accounts', { n: q.data?.total ?? items.length })}</span>
          </div>
          <div role="tablist" aria-label={text('State')} className="flex gap-1 rounded-[9px] bg-subtle p-[3px]">
            {(['held', 'requested', 'released', 'all'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={state === s} onClick={() => setState(s)} className={cx('h-[26px] flex-1 rounded-[7px] text-[12px] font-semibold', state === s ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(15,27,61,.14)]' : 'text-ink-2')}>
                {s === 'held' ? text('Held') : s === 'requested' ? text('Requested') : s === 'released' ? text('Released') : text('All')}
                {counts && s !== 'all' ? ` · ${counts[s]}` : ''}
              </button>
            ))}
          </div>
          <input type="search" aria-label={text('Search quarantine')} placeholder={text('Search sender or subject')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink" />
          <div role="group" aria-label={text('Verdict')} className="flex flex-wrap gap-1.5">
            {(['all', 'spam', 'phish', 'policy', 'malware'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={verdict === f} onClick={() => setVerdict(f)} className={cx('h-[26px] rounded-full border px-2.5 text-[12px] font-semibold', verdict === f ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
                {(f === 'all' ? text('All') : f === 'spam' ? text('Spam') : f === 'phish' ? text('Phishing') : f === 'policy' ? text('Blocked file') : text('Malware')) + ` · ${count(f)}`}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : q.data === null ? (
            <p className="p-4 text-[13px] text-ink-3">{text('Your WorkSuite server does not hold mail in quarantine yet.')}</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-3">{text('Nothing is held. Mail that looks dangerous or is almost certainly spam is kept here instead of your Inbox.')}</p>
          ) : (
            <ul role="listbox" aria-label={text('Quarantined messages')}>
              {shown.map((i) => {
                const on = current?.id === i.id;
                const choice = quarantineChoice(i);
                return (
                  <li key={i.id} role="option" aria-selected={on}>
                    <button type="button" onClick={() => setPicked(i.id)} className={cx('flex w-full flex-col gap-1 border-b border-l-[3px] border-b-line py-[11px] pr-4 pl-[13px] text-left', on ? 'border-l-primary bg-selection' : 'border-l-transparent hover:bg-subtle')}>
                      <span className="flex items-baseline gap-2">
                        <b className="flex-1 truncate text-[13px] text-ink">{i.sender_name || i.sender}</b>
                        <span className="text-[11.5px] text-ink-3">{when(i.received_at)}</span>
                      </span>
                      <span className="truncate text-[12.5px] text-ink-2">{i.subject || text('(no subject)')}</span>
                      <span className="flex items-center gap-2">
                        <VerdictChip verdict={i.verdict} />
                        <span className="flex-1 truncate text-[11.5px] text-ink-3">{i.account?.email ?? i.recipient}</span>
                        <span className={cx('text-[11.5px] font-semibold', choice === 'never' || choice === 'done' ? 'text-ink-3' : 'text-primary')}>
                          {choice === 'release' ? text('Release') : choice === 'request' ? text('Request release') : choice === 'requested' ? text('Requested') : choice === 'never' ? text('Can’t be released') : stateWords(i.state)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
      <main className="min-w-0 flex-1 overflow-y-auto bg-surface scroll-thin">
        {current ? <QuarantineDetail key={current.id} item={current} offline={offline} /> : <p className="p-6 text-[13px] text-ink-3">{text('Choose a held message to see why it was held.')}</p>}
      </main>
    </div>
  );
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span className={cx('inline-flex h-[22px] shrink-0 items-center rounded-full px-[9px] text-[11.5px] font-bold whitespace-nowrap', VERDICT_CHIP[verdict]?.className ?? STATE_CHIP.muted)}>{verdictLabel(verdict)}</span>;
}

function stateWords(s: QuarantineItem['state']): string {
  return s === 'released' ? text('Released') : s === 'deleted' ? text('Deleted') : s === 'expired' ? text('Expired') : s === 'requested' ? text('Release requested') : text('Held');
}

/** One held message: why, the sender's checks, its files, and Release / Request release (never for malware). */
export function QuarantineDetail({ item, offline }: { item: QuarantineItem; offline: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const choice = quarantineChoice(item);
  const refresh = () => void qc.invalidateQueries({ queryKey: protectionKeys.quarantineAll });
  const act = async (what: 'release' | 'release-trust' | 'block') => {
    setBusy(what);
    try {
      if (what === 'block') {
        await addMyListEntry('block', item.sender);
        void qc.invalidateQueries({ queryKey: protectionKeys.lists });
        toast('success', text('{email} is blocked: new mail from them goes to Junk.', { email: item.sender }));
      } else {
        await releaseQuarantined(item.id, what === 'release-trust');
        toast('success', what === 'release-trust' ? text('Released to your Inbox, and {email} is on your safe senders.', { email: item.sender }) : text('Released to your Inbox. The filter learns this kind of mail is fine for you.'));
        refresh();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const offlineTitle = offline ? text('Available when you are back online.') : undefined;
  const held = item.verdict === 'MALWARE' ? text('Held as malware.') : item.verdict === 'PHISH' ? text('Held as phishing.') : item.verdict === 'SPOOF' ? text('Held as spoofing.') : item.verdict === 'POLICY' ? text('Held for a blocked file.') : text('Held as spam.');
  const auth = item.reasons.filter((r) => /^(spf|dkim|dmarc|arc)/i.test(r.code));
  const why = item.reasons.filter((r) => !/^(spf|dkim|dmarc|arc)/i.test(r.code));
  return (
    <article aria-label={item.subject || text('(no subject)')} className="flex flex-col">
      <div role="toolbar" aria-label={text('Held message')} className="flex h-[54px] items-center gap-2 border-b border-line px-[22px]">
        {choice === 'release' ? (
          <>
            <Button variant="primary" loading={busy === 'release'} disabled={offline || !!busy} title={offlineTitle} onClick={() => void act('release')}>
              {text('Release to Inbox')}
            </Button>
            <Button loading={busy === 'release-trust'} disabled={offline || !!busy} title={offlineTitle} onClick={() => void act('release-trust')}>
              {text('Release and trust sender')}
            </Button>
          </>
        ) : choice === 'request' ? (
          <Button variant="primary" disabled={offline || !!busy} title={offlineTitle} onClick={() => setAsking(true)}>
            {text('Request release')}
          </Button>
        ) : choice === 'requested' ? (
          <span className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold', STATE_CHIP.warn)}>{text('Release requested')}</span>
        ) : choice === 'never' ? (
          <span data-no-release className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-danger">
            <Icon name="lock" size={14} />
            {text('Malware can’t be released by anyone')}
          </span>
        ) : (
          <span className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold', STATE_CHIP.muted)}>{stateWords(item.state)}</span>
        )}
        {choice !== 'done' ? (
          <Button loading={busy === 'block'} disabled={offline || !!busy} title={offlineTitle} onClick={() => void act('block')}>
            {text('Block sender')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3.5 px-[26px] py-[18px] text-[13px]">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[19px] font-bold text-ink selectable">{item.subject || text('(no subject)')}</h2>
          <p className="text-[12.5px] text-ink-2">
            <b className="text-ink">{item.sender_name || item.sender}</b> &lt;{item.sender}&gt; · {text('to {address}', { address: item.recipient })}
            {item.account ? ` · ${item.account.email}` : ''} · {when(item.received_at)}
          </p>
        </div>
        <div role="note" className={cx('flex gap-3 rounded-[10px] px-3.5 py-3 leading-[1.45]', item.verdict === 'MALWARE' || item.verdict === 'PHISH' || item.verdict === 'SPOOF' ? 'bg-[#FCE9E4] text-[#8A1C12] dark:bg-[#3D1A16] dark:text-[#FFB4A8]' : 'bg-[#FDF0E1] text-[#7A3B05] dark:bg-[#3A2610] dark:text-[#F5C08A]')}>
          <Icon name="shield-alert" size={20} className="shrink-0" />
          <span>
            <b>{held}</b> {item.score !== null ? text('Score {score}.', { score: item.score.toFixed(1) }) : ''} {text('It was never delivered to your Inbox.')}
            {item.request?.decision_note ? <span className="mt-1 block">{text('Administrator: {note}', { note: item.request.decision_note })}</span> : null}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
          <section aria-labelledby={`why-${item.id}`} className="flex flex-col gap-2 rounded-[12px] border border-line p-[13px_15px]">
            <h3 id={`why-${item.id}`} className="font-bold text-ink">{text('Why it was held')}</h3>
            {why.length ? why.map((r) => (
              <p key={r.code} className="flex gap-2 text-[12.5px] leading-[1.4] text-ink">
                <span aria-hidden className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-[#D25B4B]" />
                {r.text}
              </p>
            )) : <p className="text-[12.5px] text-ink-3">{text('No details were recorded.')}</p>}
          </section>
          <section aria-labelledby={`checks-${item.id}`} className="flex flex-col gap-2 rounded-[12px] border border-line p-[13px_15px]">
            <h3 id={`checks-${item.id}`} className="font-bold text-ink">{text('Sender checks')}</h3>
            {auth.length ? auth.map((r) => (
              <p key={r.code} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="w-[60px] font-semibold uppercase">{r.code.split(/[_:]/)[0]}</span>
                <span className="text-ink-2">{r.text}</span>
              </p>
            )) : <p className="text-[12.5px] text-ink-3">{text('No sender checks were recorded.')}</p>}
            {item.attachments.length ? (
              <div className="mt-1 flex flex-col gap-1 border-t border-line pt-2">
                {item.attachments.map((a) => (
                  <p key={a.name} className="flex items-center gap-2 text-[12.5px]">
                    <Icon name={a.blocked ? 'lock' : 'paperclip'} size={13} className={a.blocked ? 'text-danger' : 'text-ink-3'} />
                    <span className="truncate">{a.name}</span>
                    <span className="text-ink-3">{sizeWords(a.size)}</span>
                    {a.blocked ? <span className={cx('rounded-full px-2 text-[11px] font-bold', STATE_CHIP.bad)}>{text('Blocked')}</span> : null}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        </div>
        <p className="text-[12px] text-ink-3">
          {choice === 'release' ? text('Releasing moves it to your Inbox and teaches the filter this kind of mail is fine for you.') : choice === 'request' ? text('An administrator checks it before it can be released. You are told either way.') : ''}{' '}
          {item.expires_at ? text('Deleted automatically on {date}.', { date: dateLabel(item.expires_at) }) : ''}
        </p>
      </div>
      {asking ? <RequestReleaseDialog id={item.id} subject={item.subject} onDone={refresh} onClose={() => setAsking(false)} /> : null}
    </article>
  );
}
