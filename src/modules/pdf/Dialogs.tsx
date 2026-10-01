import { useState } from 'react';
import { PRINT_MAX_PAGES, parsePageRange, type PdfSessionView } from '@shared/pdf';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';

/** PDF-OPEN-008: "Enter PDF password", with "Remember for this session" (memory only; never saved). */
export function PasswordPrompt({ view, onDone }: { view: PdfSessionView; onDone: (v: PdfSessionView) => void }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      const v = await call('pdf:unlock', { session: view.id, password, remember });
      setPassword('');
      onDone(v);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="m-auto flex w-[380px] max-w-full flex-col gap-3 rounded-[14px] border border-line bg-surface p-6 shadow-xl"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-selection text-primary"><Icon name="lock" size={18} /></span>
        <div>
          <h2 className="text-[15px] font-bold text-ink">Enter PDF password</h2>
          <p className="text-[12.5px] text-ink-3">{view.name} is protected.</p>
        </div>
      </div>
      <input
        type="password"
        aria-label="PDF password"
        autoFocus
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13.5px] text-ink outline-none focus:border-primary"
      />
      {view.password?.wrong ? <p role="alert" className="text-[12.5px] text-danger">That password is not right. Try again.</p> : null}
      <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
        <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember for this session
      </label>
      <p className="text-[11.5px] leading-[1.45] text-ink-3">The password stays on this computer, in memory, until you sign out or quit — never saved, never sent to WorkSuite.</p>
      <Button type="submit" variant="primary" loading={busy} disabled={!password}>
        Open
      </Button>
    </form>
  );
}

/** §14.4 print: which pages, how they sit on the paper, with or without comments; the OS dialog does the rest. */
export function PrintDialog({ view, page, onClose }: { view: PdfSessionView; page: number; onClose: () => void }) {
  const [range, setRange] = useState<'all' | 'current' | 'pages'>(view.pageCount > PRINT_MAX_PAGES ? 'current' : 'all');
  const [pages, setPages] = useState('');
  const [fit, setFit] = useState<'fit' | 'actual'>('fit');
  const [annotations, setAnnotations] = useState(true);
  const [quality, setQuality] = useState<'standard' | 'high'>('standard');
  const [busy, setBusy] = useState(false);
  const chosen = range === 'pages' ? parsePageRange(pages, view.pageCount) : null;
  const count = range === 'all' ? view.pageCount : range === 'current' ? 1 : (chosen?.length ?? 0);
  const tooMany = count > PRINT_MAX_PAGES;
  const invalid = range === 'pages' && !chosen;
  const go = async () => {
    setBusy(true);
    try {
      const r = await call('pdf:print', {
        session: view.id,
        range: range === 'all' ? 'all' : range === 'current' ? { current: page } : { pages },
        fit,
        annotations,
        quality,
      });
      if (r.printed) toast('success', `Sent ${r.pages} page${r.pages === 1 ? '' : 's'} to the printer.`);
      else if (r.reason) toast('error', r.reason);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const radio = (value: typeof range, label: string) => (
    <label className="flex items-center gap-2 text-[13px] text-ink">
      <input type="radio" name="pdf-print-range" checked={range === value} onChange={() => setRange(value)} />
      {label}
    </label>
  );
  return (
    <Modal
      title="Print"
      labelledBy="pdf-print-title"
      onClose={busy ? undefined : onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon="printer" loading={busy} disabled={invalid || tooMany || count === 0} onClick={() => void go()}>
            Print…
          </Button>
        </>
      }
    >
      {busy ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner label="Preparing pages" /> Preparing {count} page{count === 1 ? '' : 's'} for printing…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-3">Pages</legend>
            {radio('all', `All ${view.pageCount} pages`)}
            {radio('current', `This page (${page + 1})`)}
            <div className="flex items-center gap-2">
              {radio('pages', 'Pages')}
              <input aria-label="Pages to print" placeholder="e.g. 1-5, 8" value={pages} onFocus={() => setRange('pages')} onChange={(e) => setPages(e.target.value)} className="h-8 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
            </div>
            {invalid && pages ? <p className="text-[12px] text-danger">Those pages are not in this PDF ({view.pageCount} pages).</p> : null}
            {tooMany ? <p className="text-[12px] text-danger">Print up to {PRINT_MAX_PAGES} pages at a time: choose a page range.</p> : null}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-3">On the paper</legend>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="radio" name="pdf-print-fit" checked={fit === 'fit'} onChange={() => setFit('fit')} /> Fit to the paper</label>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="radio" name="pdf-print-fit" checked={fit === 'actual'} onChange={() => setFit('actual')} /> Actual size</label>
            <label className="flex items-center gap-2 text-[13px] text-ink"><Checkbox checked={annotations} onChange={(e) => setAnnotations(e.target.checked)} /> Include comments and form fields</label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <Checkbox checked={quality === 'high'} disabled={view.permissions?.printHighQuality === false} onChange={(e) => setQuality(e.target.checked ? 'high' : 'standard')} /> High quality (slower)
            </label>
          </fieldset>
          <p className="text-[12px] text-ink-3">Printer, copies, orientation and two-sided printing are chosen in the next window.</p>
        </div>
      )}
    </Modal>
  );
}

/** A document that could not be opened, or whose engine stopped (PDF-NFR-010): what happened, Retry, and the report. */
export function Failure({ view, onRetry, onReport }: { view: PdfSessionView; onRetry: () => void; onReport: () => void }) {
  const e = view.error;
  return (
    <div role="alert" className="m-auto flex max-w-[440px] flex-col items-center gap-3 p-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-danger"><Icon name="alert" size={24} /></span>
      <h2 className="text-[16px] font-bold text-ink">{view.name}</h2>
      <p className="text-[13px] text-ink-2">{e?.message ?? 'This PDF could not be opened.'}</p>
      <div className="flex gap-2">
        {e?.retry ? <Button variant="primary" icon="refresh" onClick={onRetry}>Retry</Button> : null}
        <Button icon="stethoscope" onClick={onReport}>Report a problem</Button>
      </div>
      <p className="text-[11.5px] text-ink-3">A report carries the file's format, size and page count and the engine's error — never the document itself.</p>
    </div>
  );
}
