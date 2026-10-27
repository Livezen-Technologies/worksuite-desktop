import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Button, cx } from '../components/ui';
import { call, errorMessage } from '../core/bridge';

/**
 * What stands between one screen's mistake and an empty window.
 *
 * A throw while React draws unmounts everything above it that has no error
 * boundary — and the window's page is left showing only its own background,
 * with nothing to click. It happened on opening the AI dock, the Chat drawer
 * and the lock screen. So: the whole window has a boundary that says what
 * went wrong and can reload; each panel over the workspace (the docks, the
 * overlays) has its own, so the rest keeps working; and the lock screen's
 * falls back to a plain lock, never to what it was covering.
 *
 * React reports each caught error on the console, and the main process
 * writes the window's console errors to its log (windows/manager.ts), so
 * what happened can be read afterwards.
 */

interface Caught {
  error: Error | null;
  stack: string | null;
}

function details(e: Error | null, stack: string | null): string {
  return [e ? `${e.name}: ${e.message}` : 'Unknown error', e?.stack ?? '', stack ? `Component stack:${stack}` : ''].filter(Boolean).join('\n\n');
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

abstract class Boundary<P extends { children: ReactNode; resetKey?: unknown }> extends Component<P, Caught> {
  override state: Caught = { error: null, stack: null };
  protected abstract label: string;
  static getDerivedStateFromError(error: Error): Partial<Caught> {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null });
    console.error(`[${this.label}]`, error, info.componentStack);
  }
  override componentDidUpdate(prev: P) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, stack: null });
  }
  protected reset = () => this.setState({ error: null, stack: null });
}

/** The whole window: what went wrong, try again, reload, and the details to send. */
export class AppBoundary extends Boundary<{ children: ReactNode }> {
  protected label = 'window';
  override render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex h-full items-center justify-center bg-ground p-8">
        <div className="drag w-full max-w-[520px] rounded-[14px] border border-line bg-surface p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger-bg text-danger">
              <Icon name="alert" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-[16px] font-bold text-ink">This screen stopped working</h1>
              <p className="mt-1 mb-0 text-[13px] text-ink-2">WorkSuite is still running. Try again, or reload the window. If it happens again, copy the details and send them to support.</p>
            </div>
          </div>
          <pre className="selectable mt-4 max-h-40 overflow-auto rounded-[8px] bg-subtle p-3 font-mono text-[11.5px] whitespace-pre-wrap text-ink-2">{error.message || String(error)}</pre>
          <div className="no-drag mt-4 flex flex-wrap justify-end gap-2">
            <Button icon="copy" onClick={() => copy(details(error, stack))}>
              Copy details
            </Button>
            <Button icon="refresh" onClick={() => window.location.reload()}>
              Reload window
            </Button>
            <Button variant="primary" onClick={this.reset}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** A panel over the workspace — a dock, an overlay: its failure stays in it, and it can be closed. */
export class PanelBoundary extends Boundary<{ children: ReactNode; name: string; onClose?: () => void; floating?: boolean; resetKey?: unknown }> {
  protected get label() {
    return `panel:${this.props.name}`;
  }
  override render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className={cx(
          'flex flex-col gap-2 border-line bg-surface p-4 text-[13px]',
          this.props.floating ? 'fixed top-14 right-4 z-[70] w-[360px] rounded-[12px] border shadow-xl' : 'w-[360px] shrink-0 border-l',
        )}
      >
        <b className="flex items-center gap-2 text-ink">
          <Icon name="alert" size={15} className="text-danger" /> {this.props.name} stopped working
        </b>
        <p className="m-0 text-ink-2">The rest of WorkSuite is still running.</p>
        <pre className="selectable max-h-32 overflow-auto rounded-[8px] bg-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2">{error.message || String(error)}</pre>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" icon="copy" onClick={() => copy(details(error, stack))}>
            Copy details
          </Button>
          {this.props.onClose ? (
            <Button size="sm" onClick={this.props.onClose}>
              Close
            </Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={this.reset}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}

/**
 * The lock screen's: should it fail, the window stays locked — a plain
 * password form in its place, never the workspace it was covering.
 */
export class LockBoundary extends Boundary<{ children: ReactNode }> {
  protected label = 'lock';
  override render() {
    if (!this.state.error) return this.props.children;
    return <PlainLock />;
  }
}

export function PlainLock() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('security:unlockPassword', { password });
      if (!r.ok) setError(r.message);
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="drag fixed inset-0 z-[80] flex items-center justify-center bg-navy text-white">
      <form
        className="no-drag flex w-[360px] flex-col gap-3 rounded-[16px] border border-white/10 bg-navy-2 p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <h1 className="m-0 text-[20px] font-bold">WorkSuite is locked</h1>
        <input
          type="password"
          autoFocus
          aria-label="WorkSuite password"
          placeholder="WorkSuite password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 rounded-[9px] border border-white/15 bg-white/5 px-3 text-[14px] text-white outline-none placeholder:text-white/40 focus:border-white/40"
        />
        {error ? (
          <p role="alert" className="m-0 text-[12.5px] text-stage-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!password}>
          Unlock
        </Button>
      </form>
    </div>
  );
}
