import { useEffect, useRef, useState, type ReactNode } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Avatar, cx } from '../../components/ui';
import { PersonButton, type PersonActions } from './PeopleCard';
import { AccountAvatar, AccountTag } from './parts';
import { tagShows } from './accountTags';
import { useAccountTags } from './useAccountTags';
import { headerDate, mailboxLetter, recipientSummary, shieldTitle, splitAddress, type HeaderDensity, type SecurityVerdict } from './model';
import type { Mailbox, MessageContext, MessageDetail } from './types';

/**
 * The reading pane's header (worksuite-desktop#212): the subject with the folder and External badges on
 * its right; the sender on one line — name, address (a click copies it) and the verification shield —
 * with "to me ▾" under it, which opens the whole set of headers; the short date, Star and More on the
 * right, and in the dark theme ☀ / 🌙 to see this sender's email light or dark (#287). Three layouts
 * follow the Mail density setting: Super compact (one line), Compact (the default) and Classic
 * (roomier). A narrow pane puts the badges under the subject and the date under the sender.
 * Scrolled away, MessageView shows `CollapsedHeader` in its place.
 */

export interface HeaderTool {
  id: string;
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface MessageHeaderProps {
  m: MessageDetail;
  context: MessageContext | null;
  density: HeaderDensity;
  narrow: boolean;
  security: SecurityVerdict | null;
  /** The sender is outside the organisation. */
  external: boolean;
  /** The folder the message is in, by name; its badge opens it. */
  folderLabel: string;
  onOpenFolder?: () => void;
  account: Mailbox | null;
  /** All Accounts or another combined view: the account the message came to is shown by the date. */
  combined: boolean;
  /** The reader's own addresses, for "to me". */
  mine: Array<string | null | undefined>;
  fromCache: boolean;
  /** Markers, S/MIME, pinned, flag, categories, labels and linked records: small badges after the folder's. */
  chips?: ReactNode;
  person: PersonActions;
  onCopyAddress: () => void;
  onStar: () => void;
  /** ☀ View in light / 🌙 View in dark for this email, remembered for its sender (#287); absent in the light theme unless the email is dark. */
  bodyTheme?: { dark: boolean; onToggle: () => void };
  /** More of the actions as buttons, when the person asked for them (Settings › Mail › Reading). */
  extraTools?: HeaderTool[];
  moreSections: MenuSection[];
}

/** "hasarinda@livezentech.com · Custom IMAP": the account a message came to, as its dot's tooltip says. */
export function accountTitle(a: Pick<Mailbox, 'email' | 'provider_label' | 'account_type' | 'shared'>): string {
  const kind = a.account_type === 'local_mailbox' ? text('WorkSuite Local') : a.shared ? text('Shared mailbox') : (a.provider_label ?? '');
  return kind ? `${a.email} · ${kind}` : a.email;
}

const BADGE = 'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-semibold';

export function MessageHeader(p: MessageHeaderProps) {
  const accountTags = useAccountTags();
  const { m, density, narrow } = p;
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const subject = m.subject || text('(no subject)');
  const sender = m.from_name || m.from_email;
  const when = headerDate(m.created_at);
  const summary = density === 'classic' ? [text('to {list}', { list: m.to.join(', ') || text('undisclosed recipients') }), m.cc.length ? text('cc {list}', { list: m.cc.join(', ') }) : ''].filter(Boolean).join(' · ') : recipientSummary(m.to, m.cc, p.mine);
  const superCompact = density === 'super';
  const classic = density === 'classic';

  const badges = (
    <div role="group" aria-label={text('About this message')} className={cx('flex min-w-0 flex-wrap items-center gap-1 [&>span]:min-h-[22px] [&>span]:text-[12px]', narrow ? 'justify-start' : 'justify-end')}>
      {p.onOpenFolder ? (
        <button type="button" onClick={p.onOpenFolder} aria-label={text('Open {folder}', { folder: p.folderLabel })} title={text('Open {folder}', { folder: p.folderLabel })} data-badge="folder" className={cx(BADGE, 'border border-line bg-surface text-ink-2 hover:bg-subtle hover:text-ink')}>
          <Icon name="folder" size={12} />
          {p.folderLabel}
        </button>
      ) : (
        <span data-badge="folder" className={cx(BADGE, 'border border-line bg-surface text-ink-2')}>
          <Icon name="folder" size={12} />
          {p.folderLabel}
        </span>
      )}
      {p.external ? (
        <span data-badge="external" title={text('This message came from outside your organisation. Take care with links and attachments.')} className={cx(BADGE, 'bg-warning-bg text-warning')}>
          {text('External')}
        </span>
      ) : null}
      {p.chips}
    </div>
  );

  const shield = p.security ? <Shield verdict={p.security} /> : null;
  // Which account it came to: the account's tag where it shows, as on the list's rows (#227), else its letter.
  const tag = p.account ? accountTags.tags.get(p.account.id) : undefined;
  const accountDot =
    p.account && tag && tagShows(tag, accountTags.mode, p.combined) ? (
      <span data-account-dot className="inline-flex shrink-0">
        <AccountTag tag={tag} mode={accountTags.mode} />
      </span>
    ) : p.combined && p.account && !tag ? (
      <span role="img" data-account-dot aria-label={accountTitle(p.account)} title={accountTitle(p.account)} className="inline-flex shrink-0">
        <AccountAvatar letter={mailboxLetter(p.account)} colour={p.account.colour} size={16} />
      </span>
    ) : null;
  const date = (
    <time dateTime={m.created_at} title={when.full} className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-3">
      {when.short}
    </time>
  );
  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {(p.extraTools ?? []).map((t) => (
        <HeaderButton key={t.id} icon={t.icon} label={t.label} onClick={t.onClick} disabled={t.disabled} />
      ))}
      {p.bodyTheme ? <HeaderButton icon={p.bodyTheme.dark ? 'sun' : 'moon'} label={p.bodyTheme.dark ? text('View in light') : text('View in dark')} onClick={p.bodyTheme.onToggle} /> : null}
      <HeaderButton icon="star" label={m.is_starred ? text('Unstar (S)') : text('Star (S)')} onClick={p.onStar} active={m.is_starred} />
      <HeaderButton ref={moreBtn} icon="more" label={text('More actions for this email')} onClick={() => setMenu((x) => !x)} expanded={menu} />
    </div>
  );
  const name = (
    <PersonButton
      name={sender}
      email={m.from_email}
      context={p.context}
      actions={p.person}
      title={text('About {name}', { name: sender })}
      className={cx('min-w-0 shrink truncate text-left font-semibold text-ink hover:underline', superCompact ? 'text-[13px]' : 'text-[14px]')}
    />
  );
  const address = m.from_name ? (
    <button type="button" onClick={p.onCopyAddress} aria-label={text('Copy address {email}', { email: m.from_email })} title={text('Copy address')} className="min-w-0 shrink truncate text-left text-[13px] text-ink-3 hover:text-ink-2">
      &lt;{m.from_email}&gt;
    </button>
  ) : (
    <button type="button" onClick={p.onCopyAddress} aria-label={text('Copy address {email}', { email: m.from_email })} title={text('Copy address')} className="inline-flex shrink-0 text-ink-3 hover:text-ink-2">
      <Icon name="copy" size={12} />
    </button>
  );
  const toLine = (
    <button type="button" aria-expanded={details} aria-controls="message-header-details" onClick={() => setDetails(!details)} title={details ? text('Hide details') : text('Show details')} className="inline-flex min-w-0 items-center gap-0.5 truncate text-left text-[12.5px] text-ink-3 hover:text-ink-2">
      <span className="truncate">{summary}</span>
      <Icon name="chevron-down" size={12} className={cx('shrink-0 transition-transform motion-reduce:transition-none', details && 'rotate-180')} />
    </button>
  );
  const saved = p.fromCache ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-success">
      <Icon name="check" size={12} />
      {text('Saved on this computer')}
    </span>
  ) : null;

  return (
    <header data-message-header data-density={density} data-narrow={narrow ? 'true' : 'false'} className={cx('flex flex-col border-b border-line bg-surface', superCompact ? 'gap-1 px-4 py-2.5' : classic ? 'gap-3 px-6 py-5' : 'gap-2 px-5 py-4')}>
      {superCompact ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={sender} size={28} src={p.context?.sender?.photo_url ?? null} />
            <h2 title={subject} className="min-w-0 shrink truncate text-[15px] font-semibold text-ink selectable">
              {subject}
            </h2>
            <span aria-hidden className="shrink-0 text-ink-3">·</span>
            <span className="flex min-w-0 shrink items-center gap-1">
              {name}
              {shield}
            </span>
            {toLine}
            <span className="flex-1" />
            {!narrow ? <div className="shrink-0">{badges}</div> : null}
            {accountDot}
            {date}
            {actions}
          </div>
          {narrow ? badges : null}
          {saved}
        </>
      ) : (
        <>
          <div className={cx('flex min-w-0 gap-3', narrow ? 'flex-col items-stretch gap-1.5' : 'items-start')}>
            <h2 title={subject} className={cx('line-clamp-2 min-w-0 flex-1 font-semibold leading-snug break-words text-ink selectable', classic ? 'text-[22px]' : 'text-[20px]')}>
              {subject}
            </h2>
            <div className={cx(narrow ? '' : 'max-w-[50%] shrink-0 pt-0.5')}>{badges}</div>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={sender} size={classic ? 44 : 36} src={p.context?.sender?.photo_url ?? null} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                {name}
                {address}
                {shield}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {toLine}
                {narrow ? date : null}
                {saved}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {accountDot}
              {!narrow ? date : null}
              {actions}
            </div>
          </div>
        </>
      )}
      {details ? <Details id="message-header-details" {...p} full={when.full} /> : null}
      {menu ? <Menu sections={p.moreSections} label={text('More actions for this email')} anchor={moreBtn} prefer="bottom" align="end" onClose={() => setMenu(false)} /> : null}
    </header>
  );
}

/** The verification shield after the sender's name: quiet when passed, amber and red with words when not. */
function Shield({ verdict }: { verdict: SecurityVerdict }) {
  const title = shieldTitle(verdict);
  const tone = verdict.state === 'pass' ? 'text-success' : verdict.state === 'partial' ? 'text-warning' : 'text-danger';
  return (
    <span role="img" data-shield={verdict.state} aria-label={title} title={title} className={cx('inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold', tone)}>
      <Icon name={verdict.state === 'pass' ? 'shield-check' : 'shield-alert'} size={14} />
      {verdict.state === 'pass' ? null : <span aria-hidden>{verdict.state === 'fail' ? text('Not verified') : text('Partly verified')}</span>}
    </span>
  );
}

/** Everything the summary leaves out: From, To, Cc, Bcc, Reply-To, the date, mailed-by, signed-by, account, folder. */
function Details({ id, m, security, account, folderLabel, context, full }: MessageHeaderProps & { id: string; full: string }) {
  const domain = m.from_email.split('@')[1] ?? '';
  const sec = context?.security;
  const passed = (v: string | undefined) => v === 'pass' || v === 'bestguesspass';
  const rows: Array<[string, string]> = [
    [text('From'), m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email],
    [text('To'), m.to.join(', ') || text('undisclosed recipients')],
    ...(m.cc.length ? [[text('Cc'), m.cc.join(', ')] as [string, string]] : []),
    ...(m.bcc?.length ? [[text('Bcc'), m.bcc.join(', ')] as [string, string]] : []),
    ...(m.reply_to ? [[text('Reply-To'), m.reply_to] as [string, string]] : []),
    [text('Date'), full],
    ...(domain && sec?.spf && sec.spf !== 'unknown' ? [[text('Mailed-by'), passed(sec.spf) ? domain : text('{domain} (SPF {result})', { domain, result: sec.spf })] as [string, string]] : []),
    ...(domain && sec?.dkim && sec.dkim !== 'unknown' && sec.dkim !== 'none' ? [[text('Signed-by'), passed(sec.dkim) ? domain : text('{domain} (DKIM {result})', { domain, result: sec.dkim })] as [string, string]] : []),
    ...(context?.markers?.smime === 'signed' ? [[text('S/MIME'), text('Signed')] as [string, string]] : []),
    ...(security ? [[text('Security'), security.title] as [string, string]] : []),
    ...(account ? [[text('Account'), accountTitle(account)] as [string, string]] : []),
    [text('Folder'), folderLabel],
  ];
  return (
    <dl id={id} aria-label={text('Message details')} className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-[8px] bg-subtle px-3 py-2 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-right text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink selectable">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Scrolled away (#212): a 48px bar with the subject and the sender; a click goes back to the top. */
export function CollapsedHeader({ m, onTop, context }: { m: MessageDetail; onTop: () => void; context: MessageContext | null }) {
  const sender = m.from_name || m.from_email;
  return (
    <button type="button" data-collapsed-header onClick={onTop} title={text('Back to the top')} className="flex h-12 w-full items-center gap-2 border-b border-line bg-surface px-5 text-left shadow-[0_2px_8px_rgb(var(--ws-shadow-rgb)/0.08)]">
      <Avatar name={sender} size={24} src={context?.sender?.photo_url ?? null} />
      <span className="min-w-0 shrink truncate text-[14px] font-semibold text-ink">{m.subject || text('(no subject)')}</span>
      <span aria-hidden className="shrink-0 text-ink-3">·</span>
      <span className="min-w-0 shrink-[2] truncate text-[13px] text-ink-2">{sender}</span>
    </button>
  );
}

/** A 32px icon button with its name as the tooltip. */
function HeaderButton({ ref, icon, label, onClick, disabled, active, expanded }: { ref?: React.Ref<HTMLButtonElement>; icon: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean; expanded?: boolean }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...(expanded !== undefined ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': expanded } : {})}
      className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] hover:bg-subtle disabled:opacity-40 disabled:hover:bg-transparent', active ? 'text-warning' : 'text-ink-2')}
    >
      <Icon name={icon} size={17} className={active ? 'fill-current' : undefined} />
    </button>
  );
}

/** Narrower than `below` px (the reading pane, not the window): the header's narrow layout. */
export function useNarrow(below = 560): [boolean, (node: HTMLElement | null) => void] {
  const [narrow, setNarrow] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // Not laid out yet (0): nothing is known, so nothing changes.
      if (w > 0) setNarrow(w < below);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, below]);
  return [narrow, setNode];
}

/** The reader's own addresses: "to me" is any of them. */
export function ownAddresses(boxes: Array<Pick<Mailbox, 'email'>>, account: Pick<Mailbox, 'email'> | null, user: string | null | undefined): string[] {
  return [...boxes.map((b) => b.email), account?.email, user].filter((x): x is string => !!x).map((x) => splitAddress(x).email);
}
