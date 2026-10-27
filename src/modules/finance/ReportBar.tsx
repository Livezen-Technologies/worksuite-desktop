import { useState } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { btn, btnPrimary, btnSmall, Field, input, Sheet } from '../../components/PageKit';
import { problemsOf, refusal, shortDate, type Company } from './api';
import { createShareLink, printPath, reportGates, shareLink, type FinanceReport } from './insight';
import { ConfirmSheet, LoadFailed, Notice } from '../../components/RecordKit';

/**
 * Getting a report out, and the chrome every reading screen shares: the
 * period fields, the sentence for a report the person may not read, and the
 * one for a read the server refused.
 *
 * FOUR ACTS, FOUR PERMISSIONS. The summary, the transactions behind it, a
 * page to print and a link that leaves the product's sign-in are different
 * things to be trusted with. Each button is drawn only where its route would
 * let it through — `finance.reports.view` AND the act's own slug, and for the
 * two dashboards their own export slug — because a button that only ever
 * produces a refusal is a control that does nothing. The server checks again.
 *
 * The files are fetched by the main process with the session and saved to the
 * download folder, so they show in Transfers; a refusal is reported there, not
 * saved as a spreadsheet of JSON.
 */
export function ReportBar({ report, company, from, to, currency }: { report: FinanceReport; company: Company; from: string; to: string; currency?: string }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const gates = reportGates(perms, report);
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const base = company.base_currency ?? '';

  const download = async (lines: boolean) => {
    setBusy(lines ? 'lines' : 'export');
    try {
      await call('transfers:download', {
        // The transactions are the stored lines, always in the books' currency; only the summary follows the page.
        financeCsv: { report, company: company.id, from, to, ...(lines ? { lines: true } : currency ? { currency } : {}) },
        name: lines ? `${report}-transactions.csv` : `${report}.csv`,
      });
      toast('success', 'Exporting — see Transfers.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const print = () => {
    // The web's print page, in the browser: it lays out the report and nothing else.
    void call('app:openInBrowser', { path: printPath(report, company.id, from, to, currency) }).catch((e: unknown) => toast('error', errorMessage(e)));
  };

  const share = async () => {
    setBusy('share');
    try {
      const r = await createShareLink(report, company.id, from, to);
      const full = shareLink(app.get().auth?.server?.origin, r?.url ?? '');
      setAsking(false);
      if (!full) {
        toast('error', 'The link was made, but this app does not know its server’s address to write it out. Revoke it under Shared reports.');
        return;
      }
      try {
        await navigator.clipboard.writeText(full);
        toast('success', 'Link copied. It expires in 7 days.');
      } catch {
        // Clipboard access can be refused, and losing a one-time secret to a failed copy is unrecoverable.
        setLink(full);
      }
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy('');
    }
  };

  if (!gates.export && !gates.lines && !gates.print && !gates.share) return null;
  const off = busy !== '';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {gates.export ? (
        <button type="button" className={btnSmall} disabled={off} title="This report as it is shown, as a CSV" onClick={() => void download(false)}>
          <Icon name="file-sheet" size={14} className="mr-1" /> {busy === 'export' ? 'Exporting…' : 'Export'}
        </button>
      ) : null}
      {gates.lines ? (
        <button type="button" className={btnSmall} disabled={off} title={`Every journal line behind this report, as a CSV — always in ${base || 'the books’ currency'}`} onClick={() => void download(true)}>
          <Icon name="download" size={14} className="mr-1" /> {busy === 'lines' ? 'Exporting…' : 'Transactions'}
        </button>
      ) : null}
      {gates.print ? (
        <button type="button" className={btnSmall} disabled={off} title="Opens a page laid out for printing, in your browser" onClick={print}>
          <Icon name="printer" size={14} className="mr-1" /> Print
          <Icon name="external" size={11} className="ml-1 text-ink-3" />
        </button>
      ) : null}
      {gates.share ? (
        <button type="button" className={btnSmall} disabled={off} onClick={() => setAsking(true)}>
          <Icon name="link" size={14} className="mr-1" /> Share link
        </button>
      ) : null}
      {asking ? (
        <ConfirmSheet
          title="Create a share link?"
          danger
          busy={busy === 'share'}
          action="Create the link"
          body={
            <>
              Anybody with the link can read this report — the figures for {shortDate(from)} to {shortDate(to)} — without signing in. It expires in 7 days and can be revoked under Shared reports. The link is shown once and is not stored, so copy it when it appears.
              {base ? (
                <span className="mt-2 block">
                  It shows the figures in {base}, the currency the books are kept in{currency && currency !== base ? `, not ${currency} as this page does` : ''}.
                </span>
              ) : null}
            </>
          }
          onYes={() => void share()}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {link ? <CopyByHand link={link} onClose={() => setLink(null)} /> : null}
    </div>
  );
}

/** The link, to copy by hand, when the clipboard would not take it. */
function CopyByHand({ link, onClose }: { link: string; onClose: () => void }) {
  return (
    <Sheet
      title="Copy this link now"
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className={btnPrimary} onClick={onClose}>
          I have copied it
        </button>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">It is not stored and cannot be shown again.</p>
      <input aria-label="Share link" readOnly value={link} className={`${input} font-mono text-[12px]`} onFocus={(e) => e.currentTarget.select()} autoFocus />
    </Sheet>
  );
}

/** A report this person may not read, and the slugs that would let them. */
export function NotGranted({ what, slugs, onAccess }: { what: string; slugs: string[]; onAccess?: () => void }) {
  return (
    <div className="m-6 flex max-w-[620px] flex-col items-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-2">
      <span>
        {what} needs {slugs.length === 1 ? 'a permission' : 'permissions'} you do not hold:{' '}
        {slugs.map((s, i) => (
          <span key={s}>
            {i > 0 ? (i === slugs.length - 1 ? ' and ' : ', ') : null}
            <code className="font-mono text-[12px]">{s}</code>
          </span>
        ))}
        . The figures are the ledger’s, and reading them is a separate grant from opening Finance.
      </span>
      {onAccess ? (
        <button type="button" className={btn} onClick={onAccess}>
          My access
        </button>
      ) : null}
    </div>
  );
}

/**
 * A read that did not come back. A refusal the server explained — a window
 * too long, dates the wrong way round, a permission — is said in its words;
 * anything else is a failed request, which is not a statement about the books.
 */
export function ReadFailed({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return (
      <Notice tone="amber">
        {problemsOf(error).map((p) => (
          <span key={p} className="block">
            {p}
          </span>
        ))}
      </Notice>
    );
  }
  return <LoadFailed what={what} onRetry={onRetry} />;
}

/** From and To, as dates on the reader's calendar. */
export function RangeFields({ range, onChange }: { range: { from: string; to: string }; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <Field label="From" className="w-[150px]">
        <input type="date" className={input} value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })} />
      </Field>
      <Field label="To" className="w-[150px]">
        <input type="date" className={input} value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </Field>
    </>
  );
}
