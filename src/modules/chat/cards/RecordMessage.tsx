import type { ReactNode } from 'react';
import { LinkedText } from '../../../components/LinkedText';
import { cx } from '../../../components/ui';

/** The shared, bubble-free message layout for every record-card kind. */
export function RecordMessage({ children, text, own, footer, actions }: { children: ReactNode; text?: string | null; own: boolean; footer?: ReactNode; actions?: ReactNode }) {
  const caption = !!text && text.length <= 120 && !text.includes('\n');
  return (
    <div data-record-message className={cx('flex w-full min-w-0 max-w-[400px] flex-col gap-1.5', own ? 'items-end' : 'items-start')}>
      {text && !caption ? (
        <div
          data-record-text
          className={cx(
            'max-w-full whitespace-pre-wrap break-words rounded-[12px] px-3 py-2 text-[13px] leading-[1.45] selectable',
            own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink',
          )}
        >
          <LinkedText text={text} className={own ? 'text-white' : 'text-primary'} />
        </div>
      ) : null}
      <div data-record-content className="relative flex w-full min-w-0 flex-col gap-1.5">
        {actions}
        {children}
      </div>
      {caption ? (
        <div data-record-caption className="w-full whitespace-pre-wrap break-words text-[12px] text-ink-3 selectable">
          <LinkedText text={text!} className="text-ink-3" />
        </div>
      ) : null}
      {footer ? (
        <div data-record-footer className="flex w-full justify-end text-ink-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
