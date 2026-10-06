import { useEffect, useRef, useState } from 'react';
import type { PdfDiagnosticCheck, PdfFailureReport, PdfLocalPick } from '@shared/pdf';
import { call, errorMessage } from '../../core/bridge';
import { registerCommand } from '../../core/commands';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { sourceFromQuery } from './client';
import { HOME_SECTIONS, PdfHome, type HomeSection } from './Home';
import { toolById, type ToolId } from './tools';
import { openPdf } from './open';
import { Workspace } from './Workspace';

/**
 * PDF Studio (WorkSuite PDF Studio SRS, stage D1: the viewer). Addressed as
 * `/pdf?file=<Drive id>` (what the web's own `/pdf?file=` links open here),
 * `/pdf?local=<handle>` (a file on this computer, by the handle the main
 * process issued), `/pdf?mail=<uid>&ref=…` (a mail attachment), `/pdf` (open
 * one) and `/pdf?view=diagnostics` (Help → PDF Diagnostics).
 *
 * Each PDF is a tab of its own. The keyboard shortcuts (§4.3) go through
 * WorkSuite's shortcut registry while a PDF Studio tab is in front, so
 * Settings lists them, they can be changed, and clashes are caught.
 */
export default function PdfStudio({ active }: ModuleProps) {
  const { query, go } = useTab();
  const source = sourceFromQuery(query);
  const view = query.get('view');

  const openRef = useRef<() => Promise<void>>(async () => undefined);
  const openLocal = async (tool?: ToolId) => {
    try {
      const picked = await call('pdf:pickLocal');
      openPicked(picked, (r) => go(r), tool);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  useEffect(() => {
    openRef.current = openLocal;
  });
  useEffect(() => {
    if (!active) return;
    // Open works from any PDF Studio tab; the document's own commands are registered by its workspace.
    const off = registerCommand({ id: 'pdf-open', label: 'Open a PDF from this computer', group: 'Module', source: 'module', keywords: 'pdf', run: () => void openRef.current() });
    return off;
  }, [active]);

  if (!source) {
    const section = (HOME_SECTIONS as string[]).includes(view ?? '') ? (view as HomeSection) : 'home';
    const tool = toolById(query.get('tool'))?.id ?? null;
    return (
      <PdfHome
        section={section === 'tool' && !tool ? 'tools' : section}
        tool={tool}
        missing={query.has('local')}
        onOpenLocal={(t) => void openLocal(t)}
        onPicked={(p) => openPicked(p, (r) => go(r))}
        diagnostics={<PdfDiagnostics />}
      />
    );
  }
  return <Workspace key={query.toString()} source={source} />;
}

/** The first PDF chosen opens here (with the tool asked for, if any); any others in tabs of their own. */
function openPicked(files: PdfLocalPick[], here: (route: string) => void, tool?: ToolId): void {
  files.forEach((f, i) => (i === 0 ? here(`/pdf?local=${f.handle}${tool ? `&tool=${tool}` : ''}`) : openPdf({ kind: 'local', handle: f.handle }, f.name)));
}

const STATUS: Record<PdfDiagnosticCheck['status'], { icon: string; tone: string; label: string }> = {
  pass: { icon: 'check-circle', tone: 'text-success', label: 'OK' },
  warn: { icon: 'warning', tone: 'text-warning', label: 'Warning' },
  fail: { icon: 'alert', tone: 'text-danger', label: 'Problem' },
  skip: { icon: 'minus', tone: 'text-ink-3', label: 'Not checked' },
};

/** The renderer's own part of the checks: can this screen draw what the engine sends? */
function rendererCheck(): PdfDiagnosticCheck {
  try {
    const c = document.createElement('canvas');
    const ok = !!c.getContext('2d') && typeof createImageBitmap === 'function' && typeof ImageData === 'function';
    return { id: 'renderer', label: 'Page drawing', status: ok ? 'pass' : 'fail', detail: ok ? `This window draws pages at ${window.devicePixelRatio || 1}× (the screen's pixel density).` : 'This window cannot draw pages: the canvas is not available.' };
  } catch {
    return { id: 'renderer', label: 'Page drawing', status: 'fail', detail: 'This window cannot draw pages.' };
  }
}

/** The report to paste into a support request: states only, never a document, its name or a password. */
async function copyReport(checks: PdfDiagnosticCheck[]): Promise<void> {
  const text = ['PDF Diagnostics', ...checks.map((c) => `${STATUS[c.status].label.padEnd(11)} ${c.label} — ${c.detail}`)].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('success', 'The report is on the clipboard.');
  } catch {
    toast('error', 'The report could not be copied.');
  }
}

/** Help → PDF Diagnostics (§24.5, PDF-NFR-032). */
export function PdfDiagnostics() {
  useTabTitle('PDF Diagnostics');
  const { navigate } = useTab();
  const [checks, setChecks] = useState<PdfDiagnosticCheck[] | null>(null);
  const [failures, setFailures] = useState<PdfFailureReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    call('pdf:diagnostics').then(
      (r) => {
        if (!live) return;
        const mine = rendererCheck();
        const all = [...r.checks];
        all.splice(Math.max(0, all.findIndex((c) => c.id === 'fonts')), 0, mine);
        setChecks(all);
        setFailures(r.failures);
        setError(null);
      },
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [n]);
  return (
    <div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-[20px] font-bold text-ink">PDF Diagnostics</h1>
          <Button icon="refresh" onClick={() => (setChecks(null), setN(n + 1))}>Check again</Button>
          <Button icon="copy" disabled={!checks} onClick={() => void copyReport(checks ?? [])}>Copy report</Button>
          <Button icon="stethoscope" onClick={() => navigate('/diagnostics')}>Diagnostic report…</Button>
        </div>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        {!checks && !error ? <Spinner label="Checking PDF Studio…" /> : null}
        {checks ? (
          <ul className="flex flex-col divide-y divide-line rounded-[12px] border border-line bg-surface">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <Icon name={STATUS[c.status].icon} size={17} className={cx('mt-0.5', STATUS[c.status].tone)} />
                <div className="min-w-0 flex-1">
                  <b className="text-[13.5px] text-ink">{c.label}</b>
                  <p className="text-[12.5px] text-ink-2">{c.detail}</p>
                </div>
                <span className={cx('text-[12px] font-semibold', STATUS[c.status].tone)}>{STATUS[c.status].label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <section>
          <h2 className="mb-2 text-[14px] font-bold text-ink">Recent PDF problems</h2>
          {failures.length ? (
            <ul className="flex flex-col gap-1 text-[12.5px] text-ink-2">
              {failures.map((f, i) => (
                <li key={i} className="rounded-[8px] border border-line bg-surface px-3 py-2 tabular">
                  {new Date(f.at).toLocaleString()} · {f.stage} · {f.code} · {f.format}, {Math.round(f.size / 1024)} KB, {f.pages} pages · {f.engine}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">None since WorkSuite started.</p>
          )}
          <p className="mt-2 text-[12px] text-ink-3">Problems are written to WorkSuite's log with the file's format, size and page count and the engine's error — never the document, its name or a password. A diagnostic report carries that log; you see it before it is saved.</p>
        </section>
        <section>
          <h2 className="mb-2 text-[14px] font-bold text-ink">Server checks and file activity</h2>
          <p className="text-[12.5px] text-ink-3">The server half of these checks (API, database, Drive, temporary storage, live updates, server tools) comes from GET api/files/pdf/diagnostics once the desktop asks for it. A PDF’s own activity — edited, printed, lock released, conflict kept both — is in its Review › Activity panel.</p>
        </section>
      </div>
    </div>
  );
}
