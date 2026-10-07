import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ticketRoute, type SupportStatus, type Ticket } from '@shared/support';
import { isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, Kbd, Modal, Spinner, cx } from '../../components/ui';
import { K, alreadyConverted, convertEmail, errorText, listTickets, meta } from './api';
import { Reference, StatusChip } from './parts';

/** The email the sheet converts, as Mail names it: its uid in its folder and mailbox, and what the sheet shows of it. */
export interface EmailToConvert {
  uid: number;
  folder: string;
  mailbox: string | null;
  subject: string;
  from_name: string | null;
  from_email: string;
  /** The sender's company as Mail knows it (their contact's), to suggest the organization. */
  company?: string | null;
}

/** A ticket as the sheet answers it: what the message now links to. */
export interface ConvertedTicket {
  id: number;
  reference: string;
  status: string | null;
}

/**
 * The organization a new ticket is suggested in: mine when I work in one only, else the one named as the sender's
 * company. None otherwise: the server files it in Needs organization.
 */
export function suggestedOrganization(orgs: Array<{ id: number; name: string }>, company: string | null | undefined): number | null {
  if (orgs.length === 1) return orgs[0]!.id;
  const want = company?.trim().toLowerCase();
  return want ? (orgs.find((o) => o.name.trim().toLowerCase() === want)?.id ?? null) : null;
}

const LABEL = 'text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase';

/**
 * Email → ticket from the Mail module (worksuite-desktop#298, FR-EML-07): the sheet Convert to ticket opens.
 *
 *  - A new ticket: the subject as the email has it (editable), the organization suggested from the sender's company
 *    (none: the server files it in Needs organization). The sender is the requester, the email with its attachments
 *    the first message — `POST conversions/email` takes the message by Mail's own id, so nothing is copied here.
 *  - Or added to an existing ticket, found by reference or subject: the requester's message when the email is from
 *    them or somebody copied on it, an internal note otherwise (the server decides). A closed ticket is not offered.
 *  - Converted, a toast with the reference opens the ticket, and the message shows its reference (`onDone`). The
 *    same email twice is one ticket: "Already ticket CFX-…" with View ticket instead.
 *  - ⌘↵ / Ctrl+Enter converts.
 */
export function ConvertEmailSheet({ email, onClose, onDone }: { email: EmailToConvert; onClose: () => void; onDone?: (ticket: ConvertedTicket) => void }) {
  const qc = useQueryClient();
  const desk = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => meta(signal), staleTime: 5 * 60_000, retry: false });
  const orgs = desk.data?.organizations ?? [];
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [subject, setSubject] = useState(email.subject);
  // Undefined until somebody chooses: the suggestion follows the desk's organizations as they arrive.
  const [chosenOrg, setChosenOrg] = useState<number | null | undefined>(undefined);
  const organization = chosenOrg === undefined ? suggestedOrganization(orgs, email.company) : chosenOrg;
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const found = useQuery({
    queryKey: ['support', 'email-target', q],
    queryFn: ({ signal }) => listTickets({ view: 'all', sort: 'updated', q: q || undefined, limit: 8 }, signal),
    enabled: mode === 'existing',
    staleTime: 30_000,
    retry: false,
  });
  const [picked, setPicked] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState<ConvertedTicket | null>(null);
  const ready = mode === 'new' ? !!subject.trim() : !!picked;

  const open = (id: number) => {
    navigate(ticketRoute(id));
    onClose();
  };
  const linked = (t: ConvertedTicket) => {
    onDone?.(t);
    void qc.invalidateQueries({ queryKey: K.lists });
    void qc.invalidateQueries({ queryKey: ['support', 'views'] });
    void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
  };

  const convert = async () => {
    if (!ready || busy || already) return;
    setBusy(true);
    try {
      const r = await convertEmail({
        mail_message_id: email.uid,
        folder: email.folder,
        ...(email.mailbox ? { mailbox: email.mailbox } : {}),
        target: mode === 'new' ? 'new' : picked!.id,
        ...(mode === 'new' ? { subject: subject.trim(), organization_id: organization } : {}),
      });
      const t = { id: r.id, reference: r.reference, status: r.status };
      linked(t);
      // Made a ticket before (by me, or a colleague): that one, never a second.
      if (r.existing) return setAlready(t);
      toast('success', r.appended ? text('Added to {ref}.', { ref: r.reference }) : text('Converted to {ref}.', { ref: r.reference }), { label: text('Open'), run: () => navigate(ticketRoute(r.id)) });
      onClose();
    } catch (e) {
      const done = alreadyConverted(e);
      if (done) {
        linked(done);
        setAlready(done);
      } else toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const keys = isMac ? '⌘↵' : 'Ctrl+↵';
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      void convert();
    }
  };
  const sender = email.from_name ? `${email.from_name} · ${email.from_email}` : email.from_email;
  const tickets = (found.data?.items ?? []).filter((t) => t.status !== 'closed');

  return (
    <div onKeyDown={onKey}>
      <Modal
        title={text('Convert to ticket')}
        labelledBy="support-email-convert-title"
        onClose={onClose}
        width={560}
        footer={
          already ? (
            <Button onClick={onClose}>{text('Close')}</Button>
          ) : (
            <>
              <Button onClick={onClose}>{text('Cancel')}</Button>
              <Button variant="primary" icon="life-buoy" loading={busy} disabled={!ready} onClick={() => void convert()} aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}>
                {mode === 'new' ? text('Convert to ticket') : text('Add to ticket')}
                <Kbd tone="accent" aria-hidden>
                  {keys}
                </Kbd>
              </Button>
            </>
          )
        }
      >
        <div className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pr-1 scroll-thin">
          {already ? (
            <div role="status" className="flex items-center gap-2 rounded-[10px] border border-line bg-subtle px-3 py-3 text-[13px] text-ink-2">
              {text('Already ticket')} <Reference className="font-semibold text-ink">{already.reference}</Reference>
              {already.status ? <StatusChip status={already.status as SupportStatus} /> : null}
              <Button size="sm" variant="primary" icon="life-buoy" className="ml-auto" onClick={() => open(already.id)}>
                {text('View ticket')}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[12.5px] text-ink-2">
                <span className={LABEL}>{text('Requester')}</span> <b className="text-ink">{sender}</b>
                <span className="block text-[11.5px] text-ink-3">{text('The sender, matched to a contact by email or added as a new one. The email and its attachments are the first message.')}</span>
              </p>
              <fieldset className="flex flex-col gap-1.5">
                <legend className={cx(LABEL, 'mb-1')}>{text('Ticket')}</legend>
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input type="radio" name="email-convert-target" checked={mode === 'new'} onChange={() => setMode('new')} />
                  {text('New ticket')}
                </label>
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input type="radio" name="email-convert-target" checked={mode === 'existing'} onChange={() => setMode('existing')} />
                  {text('Add to an existing ticket')}
                </label>
              </fieldset>
              {mode === 'new' ? (
                <div className="flex flex-col gap-2.5">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>{text('Subject')}</span>
                    <input autoFocus required maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
                  </label>
                  {orgs.length > 1 ? (
                    <div className="flex flex-col gap-1">
                      <Select
                        label={text('Organization')}
                        value={organization === null ? '' : String(organization)}
                        options={[{ value: '', label: text('None yet') }, ...orgs.map((o) => ({ value: String(o.id), label: o.name }))]}
                        onValueChange={(v) => setChosenOrg(v ? Number(v) : null)}
                      />
                      {organization === null ? <span className="text-[11.5px] text-ink-3">{text('Without an organization the ticket waits in Needs organization.')}</span> : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>{text('Find a ticket')}</span>
                    <input
                      autoFocus
                      type="search"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPicked(null);
                      }}
                      placeholder={text('Reference or subject')}
                      className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary"
                    />
                  </label>
                  <div role="radiogroup" aria-label={text('Tickets')} className="flex flex-col gap-1 rounded-[10px] border border-line bg-subtle p-1.5">
                    {found.isLoading ? (
                      <Spinner className="p-2" />
                    ) : found.error ? (
                      <span className="px-1.5 py-1 text-[12.5px] text-danger">{errorText(found.error)}</span>
                    ) : tickets.length ? (
                      tickets.map((t) => (
                        <label key={t.id} className={cx('flex items-center gap-2 rounded-[7px] px-1.5 py-1 text-[13px] text-ink', picked?.id === t.id && 'bg-selection')}>
                          <input type="radio" name="email-convert-ticket" checked={picked?.id === t.id} onChange={() => setPicked(t)} />
                          <Reference>{t.reference}</Reference>
                          <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                          <StatusChip status={t.status} />
                        </label>
                      ))
                    ) : (
                      <span className="flex items-center gap-1.5 px-1.5 py-1 text-[12.5px] text-ink-3">
                        <Icon name="search" size={13} />
                        {q ? text('No open ticket matches “{q}”.', { q }) : text('No open tickets.')}
                      </span>
                    )}
                  </div>
                  <span className="text-[11.5px] text-ink-3">{text('From the requester or somebody copied, the email is a reply on the ticket; from anybody else, an internal note.')}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
