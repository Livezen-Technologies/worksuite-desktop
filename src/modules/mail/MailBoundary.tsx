import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { recordScreenError } from '../../core/screen-errors';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';

/**
 * A boundary for each part of Mail (worksuite-desktop#338): the reading pane, the message list and the folder pane.
 *
 * One message the reader cannot draw — a protection answer with no verdict, a body that is not one — used to take
 * the whole module down to "Mail failed to load". Now it says so in its own place, "This message couldn't be shown",
 * with Try again and Details, and the list and the folders go on working. The error is kept with a reference ID and
 * logged with the account (core/screen-errors.ts), as the module's own boundary does.
 *
 * Try again calls `onRetry` — the part's answers are asked for again — and mounts the part afresh.
 */
export type MailPart = 'message' | 'list' | 'sidebar';

const WORDS: Record<MailPart, { title: string; module: string }> = {
  message: { title: "This message couldn't be shown", module: 'Mail · message' },
  list: { title: "The message list couldn't be shown", module: 'Mail · list' },
  sidebar: { title: "The folders couldn't be shown", module: 'Mail · folders' },
};

interface Props {
  part: MailPart;
  children: ReactNode;
  /** A new message, folder or place: the part is drawn again from scratch. */
  resetKey?: unknown;
  /** The account the part shows, for the log (its ID, never its address). */
  account?: string | null;
  onRetry?: () => void;
  onDiagnostics?: (ref: string) => void;
  className?: string;
}

interface State {
  error: Error | null;
  ref: string | null;
  gen: number;
  details: boolean;
}

export class MailBoundary extends Component<Props, State> {
  override state: State = { error: null, ref: null, gen: 0, details: false };
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    const entry = recordScreenError({ module: WORDS[this.props.part].module, where: 'pane', error, componentStack: info.componentStack ?? null, key: 'mail', ...(this.props.account !== undefined ? { account: this.props.account } : {}) });
    this.setState({ ref: entry.ref });
  }
  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState((s) => ({ error: null, ref: null, details: false, gen: s.gen + 1 }));
  }
  retry = () => {
    this.props.onRetry?.();
    this.setState((s) => ({ error: null, ref: null, details: false, gen: s.gen + 1 }));
  };
  override render() {
    const { error, ref, details } = this.state;
    if (!error) return <Fragment key={this.state.gen}>{this.props.children}</Fragment>;
    const words = WORDS[this.props.part];
    return (
      <div role="alert" data-mail-part={this.props.part} className={cx('flex min-h-0 min-w-0 flex-col gap-2 p-4 text-[13px]', this.props.part === 'sidebar' ? 'w-[240px] shrink-0 border-r border-line bg-surface' : 'flex-1 bg-surface', this.props.className)}>
        <div className="flex flex-wrap items-center gap-2 text-ink">
          <Icon name="alert" size={15} className="text-danger" />
          <b>{text(words.title)}</b>
          <span className="text-ink-3">·</span>
          <Button size="sm" variant="primary" icon="refresh" onClick={this.retry}>
            {text('Try again')}
          </Button>
          <Button size="sm" variant="ghost" aria-expanded={details} onClick={() => this.setState({ details: !details })}>
            {text('Details')}
          </Button>
        </div>
        <p className="m-0 text-[12.5px] text-ink-3">{this.props.part === 'message' ? text('The rest of Mail is still working: pick another message, or try this one again.') : text('The rest of Mail is still working.')}</p>
        {details ? (
          <div className="flex flex-col gap-2">
            <pre className="selectable m-0 max-h-40 overflow-auto rounded-[8px] bg-subtle p-2 font-mono text-[11.5px] whitespace-pre-wrap text-ink-2">{`${ref ? `${text('Reference {ref}', { ref })}\n` : ''}${error.name}: ${error.message || String(error)}`}</pre>
            {ref && this.props.onDiagnostics ? (
              <div>
                <Button size="sm" icon="stethoscope" onClick={() => this.props.onDiagnostics?.(ref)}>
                  {text('Open Diagnostics')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}
