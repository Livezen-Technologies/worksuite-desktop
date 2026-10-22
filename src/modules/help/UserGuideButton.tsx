import { navigate } from '../../core/tabs';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { followGuideLink, guideLinkFor, useGuideIndex } from './api';

/**
 * "User guide" in a module's shell (the title bar, for the tab in front; a docked tab's own bar): opens the module's
 * guide in the guide viewer, the company's own page in the system browser when the Admin Center set one, and nothing
 * at all when the company turned the link or the module's guide off.
 */
export function UserGuideButton({ app, tone = 'chrome', workflow }: { app: string; tone?: 'chrome' | 'plain'; workflow?: string | null }) {
  const index = useGuideIndex();
  const link = guideLinkFor(app, index.data);
  if (link.kind === 'hidden') return null;
  const external = link.kind === 'guide' && (!!link.external || link.browser);
  return (
    <button
      type="button"
      data-guide-link={link.kind === 'guide' ? link.key : 'index'}
      title={external ? 'User guide (opens in your browser)' : 'User guide'}
      aria-label="User guide"
      onClick={() => followGuideLink(link, navigate, workflow)}
      className={cx(
        'no-drag flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-semibold',
        tone === 'chrome' ? 'text-navy-ink hover:bg-white/10 hover:text-white' : 'h-6 px-1.5 text-ink-2 hover:bg-subtle hover:text-ink',
      )}
    >
      <Icon name="book-open" size={tone === 'chrome' ? 16 : 14} />
      User guide
      {external ? <Icon name="external" size={12} /> : null}
    </button>
  );
}
