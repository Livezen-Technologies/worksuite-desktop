import { useEffect, useState } from 'react';
import { apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';
import { checkLink, shownHost, type LinkVerdict, type MailLinkClick } from '@shared/mail-files';
import { mailtoRoute, parseMailto } from '@shared/mailto';

/**
 * Safe links (ENH-MAIL-03 DMO-SEC-03, design O-UI-17): a link clicked in a
 * message is checked at that moment — on this computer for the signs of a
 * trick, and, online, against the organisation's own blocked list on the
 * WorkSuite server (nothing goes to any outside service). A link with none of
 * those signs opens; anything else stops on a warning that shows the real
 * address and says what is wrong. A mailto: link starts a message here.
 */

const RANK: Record<LinkVerdict, number> = { ok: 0, caution: 1, danger: 2, blocked: 3 };

export interface LinkJudgement {
  url: string;
  text: string;
  verdict: LinkVerdict;
  reasons: string[];
  host: string | null;
}

/** The local verdict, made worse (never better) by the server's when it answers in time. */
export async function judgeLink(link: MailLinkClick, online: boolean, ask = (u: string, t: string) => apiPost<{ verdict: LinkVerdict; reasons: string[] }>('/api/mail/links/check', { url: u, text: t })): Promise<LinkJudgement> {
  const local = checkLink(link.url, link.text);
  let verdict = local.verdict;
  let reasons = local.reasons;
  if (online && local.host) {
    try {
      const server = await Promise.race([ask(link.url, link.text), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (server && RANK[server.verdict] > RANK[verdict]) verdict = server.verdict;
      if (server) reasons = [...new Set([...reasons, ...server.reasons])];
    } catch {
      // The server could not say: the local check stands.
    }
  }
  return { url: link.url, text: link.text, verdict, reasons, host: local.host };
}

/** What each sign means, in words. */
export function reasonWords(reason: string, j: Pick<LinkJudgement, 'host' | 'text'>): string {
  const host = j.host ?? '';
  switch (reason) {
    case 'text_mismatch':
      return text('The link says {shown}, but it goes to {host}.', { shown: shownHost(j.text) ?? j.text, host });
    case 'credentials':
      return text('The address hides a name before the real site, which is {host}.', { host });
    case 'ip_address':
      return text('It goes to a numbered address, not a named site.');
    case 'lookalike':
      return text('The site’s name uses look-alike letters ({host}).', { host });
    case 'shortener':
      return text('A link shortener hides where it really goes.');
    case 'redirect':
      return text('It passes you on to another address.');
    case 'port':
      return text('It uses an unusual port.');
    case 'not_encrypted':
      return text('The connection to this site is not encrypted.');
    case 'blocked_domain':
      return text('Your organisation has blocked {host}.', { host });
    default:
      return text('This is not a web link.');
  }
}

export function MailLinkGuard() {
  const online = useStore(app, (s) => s.status?.network !== 'OFFLINE');
  const [pending, setPending] = useState<LinkJudgement | null>(null);

  useEffect(
    () =>
      on<MailLinkClick>('mail:link', (link) => {
        if (/^mailto:/i.test(link.url)) {
          const fields = parseMailto(link.url);
          if (fields) navigate(mailtoRoute(fields));
          return;
        }
        if (/^tel:/i.test(link.url)) {
          void call('app:openExternal', { url: link.url }).catch(() => undefined);
          return;
        }
        void judgeLink(link, online).then((j) => {
          if (j.verdict === 'ok') void call('mail:openLink', { url: j.url, confirmed: true }).catch((e) => toast('error', errorMessage(e)));
          else setPending(j);
        });
      }),
    [online],
  );

  if (!pending) return null;
  const blocked = pending.verdict === 'blocked';
  const close = () => setPending(null);
  return (
    <Modal
      title={blocked ? text('This link is blocked') : text('Check this link before you open it')}
      labelledBy="mail-link-title"
      onClose={close}
      footer={
        <>
          <Button onClick={() => void navigator.clipboard.writeText(pending.url).then(() => toast('success', text('Address copied.')))}>Copy address</Button>
          {!blocked ? (
            <Button variant="danger" onClick={() => void call('mail:openLink', { url: pending.url, confirmed: true }).then(close, (e) => toast('error', errorMessage(e)))}>
              Open anyway
            </Button>
          ) : null}
          <Button variant="primary" onClick={close} autoFocus>
            Go back
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[13px] text-ink" role="alert">
        <div className="flex items-start gap-2">
          <Icon name="shield-alert" size={18} className={pending.verdict === 'caution' ? 'shrink-0 text-warning' : 'shrink-0 text-danger'} />
          <ul className="flex flex-col gap-1">
            {pending.reasons.filter((r) => r !== 'not_encrypted' || pending.reasons.length === 1).map((r) => (
              <li key={r}>{reasonWords(r, pending)}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[12px] font-semibold text-ink-3">It really goes to</p>
          <p className="mt-0.5 rounded-[8px] bg-subtle px-2 py-1.5 font-mono text-[12px] break-all selectable">{pending.url}</p>
        </div>
        {!online ? <p className="text-[12px] text-ink-3">Offline: checked on this computer only, not against your organisation’s list.</p> : null}
      </div>
    </Modal>
  );
}
