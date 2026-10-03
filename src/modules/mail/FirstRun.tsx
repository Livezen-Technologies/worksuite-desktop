import { useLayoutEffect, useRef, useState } from 'react';
import { updatePrefs } from '../../core/app-state';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button } from '../../components/ui';
import type { MailPrefs } from './types';

/**
 * First run (WF-DO12): "Coming from Outlook?" Yes sets the Outlook keyboard
 * scheme, the Classic command bar, conversations off, the reading pane on the
 * right and Focused Inbox on — then offers importing a .pst, bringing the
 * signature over, and making WorkSuite the computer's mail app. Asked once.
 */
export function FirstRun({ onPrefs }: { onPrefs: (p: Partial<MailPrefs>) => void }) {
  const outlook = () => {
    onPrefs({ firstRun: 'outlook', keyScheme: 'outlook', commandBar: 'classic', pane: 'right', focused: true, conversations: {} });
  };
  return (
    <section aria-label={text('Welcome to WorkSuite Mail')} className="m-3 mb-0 flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-selection px-4 py-3 text-[13px] text-ink">
      <Icon name="mail" size={18} className="text-primary" />
      <span className="min-w-0 flex-1">
        <b>{text('Coming from Outlook?')}</b> {text('WorkSuite can use Outlook’s shortcuts and layout, so nothing needs relearning.')}
      </span>
      <Button variant="primary" onClick={outlook}>
        {text('Yes, set it up like Outlook')}
      </Button>
      <Button onClick={() => onPrefs({ firstRun: 'skipped' })}>{text('No, thanks')}</Button>
    </section>
  );
}

/** Below this width the secondary actions go into More (worksuite-desktop#187). */
const NARROW = 620;

/**
 * After "Yes" (WF-DO12 step 2, worksuite-desktop#187): what was done, then what is worth doing next — Import
 * email first, Add signature and Set as default mail app second (in More when the window is narrow), and a
 * dismiss icon. Dismissing is saved in Mail's preferences, so it does not come back after navigation or restart.
 */
export function FirstRunOffers({ onImport, onSignatures, onDone }: { onImport: () => void; onSignatures: () => void; onDone: () => void }) {
  const root = useRef<HTMLElement>(null);
  const more = useRef<HTMLSpanElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [menu, setMenu] = useState(false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    // Not laid out yet (width 0) counts as wide: the actions show until the real width is known.
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setNarrow(w > 0 && w < NARROW);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const setDefault = () => void updatePrefs({ mailtoHandler: true });
  const secondary: MenuSection[] = [
    {
      id: 'more',
      items: [
        { id: 'signature', label: text('Add signature'), icon: 'pen', onSelect: onSignatures },
        { id: 'default', label: text('Set as default mail app'), icon: 'mail', onSelect: setDefault },
      ],
    },
  ];
  return (
    <section ref={root} aria-labelledby="mail-first-run-title" className="relative m-3 mb-0 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[12px] border border-line bg-surface py-3 pr-11 pl-4 text-[13px] text-ink">
      <span className="flex min-w-0 flex-[1_1_240px] items-start gap-2.5">
        <span aria-hidden className="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
          <Icon name="check" size={14} />
        </span>
        <span className="min-w-0">
          <span id="mail-first-run-title" className="block font-semibold">
            {text('Outlook shortcuts enabled.')}
          </span>
          <span className="block text-[12.5px] text-ink-3">{text('Bring your email and preferences into WorkSuite.')}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="primary" icon="upload" onClick={onImport} title={text('Import Outlook .pst or .mbox files, or .eml/.msg messages')}>
          {text('Import email')}
        </Button>
        {narrow ? (
          <>
            <span ref={more} className="inline-flex">
            <Button icon="more" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              {text('More')}
            </Button>
            </span>
            {menu ? <Menu sections={secondary} label={text('More setup actions')} anchor={more} prefer="bottom" align="end" width={240} onClose={() => setMenu(false)} /> : null}
          </>
        ) : (
          <>
            <Button icon="pen" onClick={onSignatures}>
              {text('Add signature')}
            </Button>
            <Button icon="mail" onClick={setDefault}>
              {text('Set as default mail app')}
            </Button>
          </>
        )}
      </span>
      <button type="button" onClick={onDone} aria-label={text('Dismiss')} title={text('Dismiss')} className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ws-focus)]">
        <Icon name="x" size={15} />
      </button>
    </section>
  );
}
