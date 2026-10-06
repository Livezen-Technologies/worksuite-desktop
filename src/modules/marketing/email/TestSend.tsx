import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Button, cx, Modal } from '../../../components/ui';
import { fetchContacts, MK, sendTests, useSettings, type Campaign, type Contact, type ContactFilters } from '../api';
import { useMarketingOrg } from '../org';
import { Field, Input, Mono, Notice, TextArea } from '../parts';
import { count, plural } from '../lib/format';

/**
 * Test sends (MKT-CHK-03, WF-07 step 6): up to five addresses per campaign, each getting the email with one chosen
 * contact's merge values — or the fallbacks when none is chosen. Opened from the editor (DK07) and from Review &
 * send (DK08); both save the content first. Also the small form helpers the email screens share.
 */

/** An address as far as a form can tell: something@domain.tld. */
export function isEmail(s: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]{2,}$/.test(s.trim());
}

/** The value once it has stopped changing for `ms` (a search as it is typed). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "a@x.lk, b@x.lk" or one per line → the addresses, each once. */
export function splitEmails(s: string): string[] {
  const out: string[] = [];
  for (const e of s.split(/[\s,;]+/)) if (e && !out.includes(e.toLowerCase())) out.push(e.toLowerCase());
  return out;
}

export function TestSendModal({ campaign, onClose, beforeSend }: { campaign: Campaign; onClose: () => void; beforeSend?: () => Promise<boolean> }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const settings = useSettings();
  const titleId = useId();
  const max = settings.data?.sending.max_test_recipients ?? 5;
  const left = Math.max(0, max - campaign.tests_sent);
  const [emails, setEmails] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [contact, setContact] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const filters: ContactFilters = { q: term, per_page: 6 };
  const found = useQuery({ queryKey: MK.contacts(org, filters), queryFn: ({ signal }) => fetchContacts(org, filters, signal), enabled: term.length >= 2 && !contact, placeholderData: keepPreviousData });
  const list = splitEmails(emails);
  const bad = list.filter((e) => !isEmail(e));
  const error = bad.length ? `Not an email address: ${bad.join(', ')}` : list.length > left ? `Only ${left} more ${left === 1 ? 'test is' : 'tests are'} allowed for this campaign.` : null;

  const send = async () => {
    setBusy(true);
    try {
      if (beforeSend && !(await beforeSend())) return;
      const r = await sendTests(campaign.id, { emails: list, contact_id: contact?.id ?? null });
      toast('success', `${plural(r.sent, 'test')} sent. ${r.remaining} of ${max} left.`);
      void qc.invalidateQueries({ queryKey: MK.campaign(org, campaign.id) });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Send a test"
      labelledBy={titleId}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" loading={busy} disabled={!list.length || !!error || left === 0} onClick={() => void send()}>
            {list.length > 1 ? `Send ${list.length} tests` : 'Send test'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-ink-2">
          Tests go to real inboxes so you can check how the email renders. Up to <Mono>{count(max)}</Mono> per campaign: <b className="text-ink">{count(left)} left</b>.
        </p>
        {left === 0 ? <Notice tone="warning">Every test this campaign allows has been sent.</Notice> : null}
        <Field label="Send to" error={error} hint="Separate addresses with commas or new lines.">
          <TextArea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="you@company.lk" className="font-mono" disabled={left === 0} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id={`${titleId}-merge`} className="text-[12px] font-semibold text-ink-2">
            Merge values from
          </span>
          {contact ? (
            <div className="flex items-center gap-2 rounded-[8px] border border-line bg-subtle px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{contact.name}</span>
                <span className="block truncate font-mono text-[11.5px] text-ink-3">{[contact.email, contact.organisation].filter(Boolean).join(' · ')}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setContact(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name or email" aria-labelledby={`${titleId}-merge`} />
              {term.length >= 2 ? (
                found.isLoading ? (
                  <span className="text-[12px] text-ink-3">Searching…</span>
                ) : found.error ? (
                  <span className="text-[12px] text-danger">{errorMessage(found.error)}</span>
                ) : (found.data?.rows.length ?? 0) === 0 ? (
                  <span className="text-[12px] text-ink-3">No contact matches.</span>
                ) : (
                  <ul aria-label="Contacts" className="flex max-h-[200px] flex-col overflow-y-auto rounded-[8px] border border-line scroll-thin">
                    {found.data?.rows.map((c) => (
                      <li key={c.id} className="border-b border-line last:border-b-0">
                        <button type="button" onClick={() => setContact(c)} className={cx('flex w-full flex-col px-3 py-1.5 text-left hover:bg-subtle')}>
                          <span className="truncate text-[12.5px] font-semibold text-ink">{c.name}</span>
                          <span className="truncate font-mono text-[11px] text-ink-3">{[c.email, c.organisation].filter(Boolean).join(' · ') || '—'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <span className="text-[11.5px] text-ink-3">No contact chosen: each tag shows its fallback, as for a recipient without that value.</span>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
