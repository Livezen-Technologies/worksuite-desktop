import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useTabTitle } from '../../core/tab-context';
import { navigate } from '../../core/tabs';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, ErrorNote, FileBadge, Spinner } from '../../components/ui';
import type { MailFileView } from '@shared/mail-files';
import { useMailPrefs, useMailboxes } from './api';
import { readingBody } from './bodyLook';
import { plainText } from './model';
import { plainBodyText } from './readable';
import { mailFrameDoc, sanitizeMailHtml, textToHtml } from './sanitize';
import { useAppColours } from './useAppColours';

/**
 * An .eml or .msg file, opened to read (ENH-MAIL-03 DMO-DAT-04): from the
 * system ("Open with", a double-click) or from Import. Read-only. The body is
 * untrusted exactly like received mail — sanitised, remote images blocked,
 * links checked when clicked, shown in the same sandboxed frame. Reply, Reply
 * all and Forward start a message from the default account.
 */

const who = (a: { name: string; email: string }) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email);

/** The route that starts a reply or forward to a message from a file. */
export function fileReplyRoute(v: MailFileView, mode: 'reply' | 'reply_all' | 'forward', me: string | null, body: string): string {
  const q = new URLSearchParams({ compose: '1', mode });
  const subject = v.subject || '';
  if (mode === 'forward') q.set('subject', /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`);
  else {
    q.set('subject', /^re:/i.test(subject) ? subject : `Re: ${subject}`);
    const all = mode === 'reply_all' ? [v.from, ...v.to, ...v.cc] : [v.from];
    const to = all.flatMap((a) => (a ? [a.email] : [])).filter((e, i, l) => e && l.indexOf(e) === i && e.toLowerCase() !== (me ?? '').toLowerCase());
    q.set('to', to.join(', '));
    if (v.messageId) q.set('irt', v.messageId);
  }
  const when = v.date ? `${dateLabel(v.date)} ${timeLabel(v.date)}` : '';
  q.set('quote', `\n\nOn ${when} ${v.from?.name || v.from?.email || ''} wrote:\n> ${body.split('\n').slice(0, 60).join('\n> ')}`.slice(0, 18_000));
  return `/mail?${q}`;
}

export function MailFileViewer({ handle }: { handle: string }) {
  const boxes = useMailboxes();
  const me = (boxes.data?.mailboxes ?? []).find((b) => b.is_default)?.email ?? null;
  const q = useQuery({ queryKey: ['mail', 'file', handle], queryFn: () => call('mailfile:view', { handle }), retry: false, staleTime: Infinity });
  const v = q.data;
  useTabTitle(v?.subject || text('Email file'));
  useEffect(() => () => void call('mailfile:close', { handle }).catch(() => undefined), [handle]);
  const clean = useMemo(() => (v ? sanitizeMailHtml(v.html || textToHtml(v.text)) : null), [v]);
  // Drawn as a message in Mail is (#287): readable, and dark with the theme as Show emails in dark mode says.
  const colours = useAppColours();
  const { prefs } = useMailPrefs();
  const sender = (v?.from && prefs.bodyThemeSenders?.[v.from.email.toLowerCase()]) || null;
  const reading = useMemo(
    () => (v && clean ? readingBody({ raw: v.html || '', html: clean.html, styles: clean.styles, remoteImages: clean.remoteImages, plain: plainBodyText(clean.html), appDark: colours.appDark, setting: prefs.bodyTheme ?? 'auto', sender, light: colours.light, dark: colours.dark }) : null),
    [v, clean, colours, prefs.bodyTheme, sender],
  );

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} /></div>;
  if (!v || !clean || !reading) return null;
  const body = v.text || plainText(clean.html);
  const save = (index: number) => void call('mailfile:saveAttachment', { handle, index }).then((ok) => (ok ? toast('success', text('Saved.')) : undefined), (e) => toast('error', errorMessage(e)));

  return (
    <article aria-label={v.subject || text('(no subject)')} className="flex h-full min-h-0 flex-col bg-surface">
      <div role="toolbar" aria-label={text('Message from a file')} className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <Button size="sm" variant="primary" icon="reply" onClick={() => navigate(fileReplyRoute(v, 'reply', me, body))}>Reply</Button>
        <Button size="sm" icon="reply-all" onClick={() => navigate(fileReplyRoute(v, 'reply_all', me, body))}>Reply all</Button>
        <Button size="sm" icon="forward" onClick={() => navigate(fileReplyRoute(v, 'forward', me, body))}>Forward</Button>
        <span className="flex-1" />
        <Chip>
          <Icon name="file-text" size={12} />
          {text('Opened from a file · read-only')}
        </Chip>
      </div>
      <header className="shrink-0 border-b border-line px-6 py-4">
        <h2 className="text-[21px] font-bold leading-tight text-ink selectable">{v.subject || text('(no subject)')}</h2>
        <div className="mt-3 flex items-start gap-3">
          <Avatar name={v.from?.name || v.from?.email || '?'} size={42} />
          <div className="min-w-0 flex-1 text-[13.5px]">
            <div className="truncate font-bold text-ink selectable">{v.from ? who(v.from) : text('Unknown sender')}</div>
            {v.to.length ? <div className="truncate text-[12.5px] text-ink-3 selectable">{text('to {list}', { list: v.to.map(who).join(', ') })}</div> : null}
            {v.cc.length ? <div className="truncate text-[12.5px] text-ink-3 selectable">{text('cc {list}', { list: v.cc.map(who).join(', ') })}</div> : null}
          </div>
          {v.date ? <span className="shrink-0 text-[12.5px] text-ink-3">{`${dateLabel(v.date)} · ${timeLabel(v.date)}`}</span> : null}
        </div>
        {clean.blockedImages > 0 ? <p className="mt-2 text-[12px] text-ink-3">{text(clean.blockedImages === 1 ? '1 remote image was blocked to protect your privacy.' : '{n} remote images were blocked to protect your privacy.', { n: clean.blockedImages })}</p> : null}
      </header>
      <iframe title={text('Message')} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mailFrameDoc(reading.html, 100, reading.frame)} style={{ colorScheme: reading.look.scheme === 'light' ? 'light' : 'dark' }} className="mx-5 mt-3 min-h-[120px] flex-1 border-0 bg-surface" />
      {v.attachments.length ? (
        <div className="flex max-h-[30%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-line px-6 py-3 scroll-thin">
          <p className="text-[12px] text-ink-3">Forwarding from a file sends the text only — save an attachment first to send it on.</p>
          {v.attachments.map((a) => (
            <button key={a.index} type="button" onClick={() => save(a.index)} className="flex w-full max-w-[520px] items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle" title={text('Save to this computer')}>
              <FileBadge name={a.name} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink">{a.name}</span>
                <span className="block text-[11.5px] text-ink-3">{`${Math.max(1, Math.round(a.size / 1024))} KB · ${text('save')}`}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
