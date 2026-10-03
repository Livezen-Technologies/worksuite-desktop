import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { emailDomain, isPublicDomain, noticeText, trackerText, type ImageVerdict } from './images';

/**
 * The bar above a message's body when its pictures from the web were held
 * back (worksuite-desktop#163): "Images are hidden to protect your privacy.
 * Show images · Always show from <sender> · Always show from <domain>", and
 * how many tracking pixels were removed. Nothing when every picture shows and
 * no tracker was found.
 */
export interface ImageNoticeProps {
  verdict: ImageVerdict;
  sender: string;
  trackers: number;
  /** The organisation turned WorkSuite's image proxy off: pictures cannot be shown at all. */
  proxyOff: boolean;
  offline: boolean;
  /** Loaded and kept here before: shown even offline. */
  onShow: () => void;
  onTrustSender: () => void;
  onTrustDomain: () => void;
  onSettings?: () => void;
}

export function ImageNotice(p: ImageNoticeProps) {
  const words = noticeText(p.verdict, p.trackers, p.proxyOff);
  if (words === null) return null;
  const domain = emailDomain(p.sender);
  const buttons = !p.offline && !p.proxyOff;
  const link = 'font-semibold text-primary hover:underline';
  return (
    <div role="status" aria-label={text('Images in this message')} className="mx-5 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
      <Icon name={words ? 'image-off' : 'shield-check'} size={14} className="shrink-0 text-ink-3" />
      {words ? <span>{text(words)}</span> : null}
      {buttons && p.verdict.canShow ? (
        <button type="button" className={link} onClick={p.onShow}>
          {text('Show images')}
        </button>
      ) : null}
      {buttons && p.verdict.canTrust && p.sender ? (
        <>
          {p.verdict.canShow ? <span aria-hidden>·</span> : null}
          <button type="button" className={link} onClick={p.onTrustSender}>
            {text('Always show from {email}', { email: p.sender })}
          </button>
          {domain && !isPublicDomain(domain) ? (
            <>
              <span aria-hidden>·</span>
              <button type="button" className={link} onClick={p.onTrustDomain}>
                {text('Always show from {domain}', { domain })}
              </button>
            </>
          ) : null}
        </>
      ) : null}
      {p.verdict.reason === 'never' && p.onSettings ? (
        <button type="button" className={link} onClick={p.onSettings}>
          {text('Change in Settings')}
        </button>
      ) : null}
      {p.offline && words && p.verdict.canShow ? <span className="text-ink-3">{text('Images load when you are back online.')}</span> : null}
      {p.trackers > 0 ? (
        <span className="ml-auto flex items-center gap-1 text-ink-3" title={text('Tracking pixels tell a sender when and where a message was opened. WorkSuite removes them, even when images are shown.')}>
          <Icon name="shield-check" size={12} />
          {text(trackerText(p.trackers))}
        </span>
      ) : null}
    </div>
  );
}
