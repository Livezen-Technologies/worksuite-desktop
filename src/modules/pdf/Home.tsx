import { useState, type DragEvent, type ReactNode } from 'react';
import type { PdfLocalPick } from '@shared/pdf';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { useTab, useTabTitle } from '../../core/tab-context';
import { DriveFilePicker } from '../../components/DriveFilePicker';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';
import { registerDroppedPdfs } from './client';
import { CheckRow, Field, GapList, Input, Pending, Pick, ProBadge, Section, StatusChip } from './parts';
import { forget, toggleStar, useRecent, type RecentPdf } from './recent';
import { ToolPanel } from './ToolPanels';
import { GROUP_LABEL, TOOLS, toolById, type PdfTool, type ToolGroup, type ToolId } from './tools';

/**
 * PDF Studio home in the WorkSuite shell (DK01, PRO-HOME-001): the module
 * rail — Open or create PDF; Home, Recent, Starred, Shared with me,
 * Agreements, Scans, Offline copies; All tools, Jobs, Action wizard; and the
 * Studio's own Recover, Settings, Admin and Diagnostics pages — beside the
 * page it picks. Addressed as `/pdf?view=<section>`.
 */
export type HomeSection = 'home' | 'recent' | 'starred' | 'shared' | 'agreements' | 'scans' | 'offline' | 'tools' | 'jobs' | 'actions' | 'recovery' | 'settings' | 'admin' | 'diagnostics' | 'tool';

const RAIL: Array<{ head?: string; items: Array<{ id: HomeSection; label: string; icon: string }> }> = [
  {
    items: [
      { id: 'home', label: 'Home', icon: 'home' },
      { id: 'recent', label: 'Recent', icon: 'clock' },
      { id: 'starred', label: 'Starred', icon: 'star' },
      { id: 'shared', label: 'Shared with me', icon: 'users' },
      { id: 'agreements', label: 'Agreements', icon: 'signature' },
      { id: 'scans', label: 'Scans', icon: 'scan' },
      { id: 'offline', label: 'Offline copies', icon: 'cloud-off' },
    ],
  },
  {
    head: 'Tools',
    items: [
      { id: 'tools', label: 'All tools', icon: 'grid' },
      { id: 'jobs', label: 'Jobs', icon: 'server' },
      { id: 'actions', label: 'Action wizard', icon: 'zap' },
    ],
  },
  {
    head: 'PDF Studio',
    items: [
      { id: 'recovery', label: 'Recover unsaved work', icon: 'history' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
      { id: 'admin', label: 'Organization policy', icon: 'shield' },
      { id: 'diagnostics', label: 'Diagnostics', icon: 'stethoscope' },
    ],
  },
];

export const HOME_SECTIONS: HomeSection[] = [...RAIL.flatMap((g) => g.items.map((i) => i.id)), 'tool'];

/** Tools that work without an open PDF open as a page of their own; the rest ask for a PDF first. */
const DOCLESS: ToolId[] = ['create', 'combine', 'compare', 'actions', 'bates'];

export function PdfHome({ section, tool, missing, onOpenLocal, onPicked, diagnostics }: {
  section: HomeSection;
  tool: ToolId | null;
  missing: boolean;
  onOpenLocal: (tool?: ToolId) => void;
  onPicked: (p: PdfLocalPick[]) => void;
  diagnostics: ReactNode;
}) {
  useTabTitle('PDF Studio');
  const { navigate, go } = useTab();
  const [drive, setDrive] = useState<ToolId | 'open' | null>(null);
  const at = (s: HomeSection) => navigate(s === 'home' ? '/pdf' : `/pdf?view=${s}`);
  const openTool = (id: ToolId) => {
    if (DOCLESS.includes(id)) navigate(`/pdf?view=tool&tool=${id}`);
    else onOpenLocal(id);
  };
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="PDF Studio" className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-line bg-rail text-[13px] text-ink dark:bg-surface">
        <div className="flex flex-col gap-1.5 p-3">
          <button type="button" onClick={() => onOpenLocal()} className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-primary text-[13px] font-bold text-white hover:bg-primary-hover">
            <Icon name="folder-open" size={16} /> Open or create PDF
          </button>
          <button type="button" onClick={() => setDrive('open')} className="flex h-8 items-center justify-center gap-2 rounded-[9px] border border-line bg-surface text-[12.5px] font-semibold text-ink hover:bg-subtle">
            <Icon name="folder" size={14} /> Open from Drive
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2 scroll-thin">
          {RAIL.map((g, gi) => (
            <div key={gi} className="flex flex-col">
              {g.head ? <div className="mt-2.5 flex h-6 shrink-0 items-center px-2 text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">{g.head}</div> : null}
              {g.items.map((it) => {
                const on = it.id === section || (section === 'tool' && it.id === (tool === 'actions' ? 'actions' : 'tools'));
                return (
                  <button key={it.id} type="button" aria-current={on ? 'page' : undefined} onClick={() => at(it.id)} className={cx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-[9px] pr-2 pl-2.5 text-left', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle')}>
                    <span className={cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
                    <Icon name={it.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] leading-[1.45] text-ink-3">
          <b className="block text-ink-2">Default PDF app</b>
          Making WorkSuite the PDF app for this computer arrives with OS file association (Settings).
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-hidden bg-ground">
        {section === 'tool' && tool ? (
          <div className="mx-auto flex h-full max-w-[560px] flex-col border-x border-line bg-surface">
            <ToolPanel id={tool} ctx={{ view: null, page: 0, goTo: () => undefined, ribbon: () => undefined, showComments: () => undefined }} onBack={() => at('tools')} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto scroll-thin">
            <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-6">
              {section === 'home' ? <HomePage missing={missing} onOpenLocal={() => onOpenLocal()} onDrive={() => setDrive('open')} onPicked={onPicked} onTool={openTool} /> : null}
              {section === 'recent' ? <RecentPage title="Recent" starredOnly={false} /> : null}
              {section === 'starred' ? <RecentPage title="Starred" starredOnly /> : null}
              {section === 'shared' ? <SharedPage /> : null}
              {section === 'agreements' ? <AgreementsPage /> : null}
              {section === 'scans' ? <ScansPage onTool={openTool} /> : null}
              {section === 'offline' ? <OfflinePage /> : null}
              {section === 'tools' ? <ToolsPage onTool={openTool} /> : null}
              {section === 'jobs' ? <JobsPage /> : null}
              {section === 'actions' ? <ToolPageLink id="actions" onTool={openTool} /> : null}
              {section === 'recovery' ? <RecoveryPage /> : null}
              {section === 'settings' ? <SettingsPage /> : null}
              {section === 'admin' ? <AdminPage /> : null}
              {section === 'diagnostics' ? diagnostics : null}
            </div>
          </div>
        )}
      </div>
      {drive ? (
        <DriveFilePicker
          title={drive === 'open' ? 'Open a PDF from Drive' : `Choose a PDF for ${toolById(drive)?.label ?? 'the tool'}`}
          confirmLabel="Open"
          onClose={() => setDrive(null)}
          onChoose={(files) => {
            const pdfs = files.filter((f) => (f.extension ?? f.name.split('.').pop() ?? '').toLowerCase() === 'pdf');
            if (!pdfs.length) return toast('warning', 'Choose a PDF.');
            const t = drive !== 'open' ? `&tool=${drive}` : '';
            setDrive(null);
            go(`/pdf?file=${Number(pdfs[0]!.id)}${t}`);
          }}
        />
      ) : null}
    </div>
  );
}

function H1({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="flex-1 text-[20px] font-bold text-ink">{children}</h1>
      {aside}
    </div>
  );
}

/** The 18 tools of the home grid (DK01), in its order. */
const GRID: ToolId[] = ['create', 'edit', 'export', 'combine', 'organize', 'comment', 'ocr', 'fill-sign', 'esign', 'prepare-form', 'protect', 'redact', 'compare', 'compress', 'accessibility', 'bates', 'ai'];

function ToolCard({ tool, onTool }: { tool: PdfTool; onTool: (id: ToolId) => void }) {
  return (
    <button type="button" onClick={() => onTool(tool.id)} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5 text-left hover:border-primary">
      <span className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-selection text-primary"><Icon name={tool.icon} size={16} /></span>
        <span className="flex-1" />
        {tool.pro ? <ProBadge note={tool.proNote} /> : null}
      </span>
      <b className="text-[13px] text-ink">{tool.label}</b>
      <span className="text-[12px] text-ink-3">{tool.blurb}</span>
    </button>
  );
}

function HomePage({ missing, onOpenLocal, onDrive, onPicked, onTool }: { missing: boolean; onOpenLocal: () => void; onDrive: () => void; onPicked: (p: PdfLocalPick[]) => void; onTool: (id: ToolId) => void }) {
  const [over, setOver] = useState(false);
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    try {
      const { files, rejected } = await registerDroppedPdfs(Array.from(e.dataTransfer.files));
      if (rejected.length) toast('warning', rejected.map((r) => r.reason).join(' '));
      if (files.length) onPicked(files);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };
  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => void onDrop(e)}
        className={cx('flex flex-wrap items-center gap-4 rounded-[16px] border-2 border-dashed bg-surface px-6 py-5', over ? 'border-primary bg-selection' : 'border-line')}
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-danger-bg text-danger"><Icon name="file-text" size={26} /></span>
        <div className="min-w-[240px] flex-1">
          <h1 className="text-[20px] font-bold text-ink">PDF Studio</h1>
          <p className="text-[13px] leading-[1.5] text-ink-2">Every tool you need for PDFs — your files stay in WorkSuite Drive. Open a PDF from this computer or Drive, or drop one here. PDFs you open in Files and Mail open here too, each in a tab of its own.</p>
          <p className="text-[12px] text-ink-3">PDFs from this computer are read where they are and are never uploaded unless you choose to.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button variant="primary" icon="folder-open" onClick={onOpenLocal}>Open a PDF…</Button>
          <Button icon="folder" onClick={onDrive}>From Drive…</Button>
        </div>
        {missing ? <p className="w-full rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] text-warning">That file from this computer needs to be opened again: WorkSuite forgets local files when it restarts or you sign out.</p> : null}
      </div>
      <section>
        <h2 className="mb-2 text-[14px] font-bold text-ink">Tools</h2>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
          {GRID.map((id) => {
            const t = toolById(id)!;
            return <ToolCard key={id} tool={t} onTool={onTool} />;
          })}
        </div>
      </section>
      <RecentTable limit={8} starredOnly={false} title="Recent" sub="Drive · this computer · Mail — sorted by last opened" />
    </>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

function RecentTable({ limit, starredOnly, title, sub }: { limit?: number; starredOnly: boolean; title: string; sub?: string }) {
  const { go, navigate } = useTab();
  const all = useRecent();
  const list = (starredOnly ? all.filter((r) => r.starred) : all).slice(0, limit ?? 50);
  const open = (r: RecentPdf) => (r.kind === 'local' ? go(r.route) : navigate(r.route));
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[14px] font-bold text-ink">{title}</h2>
        {sub ? <span className="text-[12px] text-ink-3">{sub}</span> : null}
      </div>
      {list.length ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="bg-subtle text-left text-[11.5px] text-ink-3">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Name</th>
                <th className="px-3 py-1.5 font-semibold">Location</th>
                <th className="px-3 py-1.5 font-semibold">Opened</th>
                <th className="px-3 py-1.5 font-semibold">Status</th>
                <th className="px-3 py-1.5 font-semibold">Version</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.route} className="border-t border-line hover:bg-subtle/60">
                  <td className="px-3 py-1.5">
                    <button type="button" onClick={() => open(r)} className="flex items-center gap-2 text-left font-semibold text-ink hover:text-primary">
                      <Icon name="file-text" size={14} className="shrink-0 text-danger" />
                      <span className="truncate">{r.name}</span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{r.label}</td>
                  <td className="px-3 py-1.5 text-ink-2">{when(r.at)}</td>
                  <td className="px-3 py-1.5">{r.kind === 'local' ? <Chip>Local file</Chip> : r.kind === 'mail' ? <Chip tone="indigo">Mail attachment</Chip> : <Chip tone="success">In Drive</Chip>}</td>
                  <td className="px-3 py-1.5 text-ink-2 tabular">{r.version ? `v${r.version}` : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" aria-label={r.starred ? `Unstar ${r.name}` : `Star ${r.name}`} onClick={() => toggleStar(r.route)} className={cx('p-1', r.starred ? 'text-warning' : 'text-ink-3 hover:text-ink')}>
                      <Icon name="star" size={14} />
                    </button>
                    <button type="button" aria-label={`Remove ${r.name} from Recent`} onClick={() => forget(r.route)} className="p-1 text-ink-3 hover:text-danger">
                      <Icon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-3">{starredOnly ? 'Star a PDF in Recent to keep it here.' : 'PDFs you open in PDF Studio are listed here.'}</p>
      )}
      <p className="mt-1.5 text-[11.5px] text-ink-3">Kept on this computer. Live status (being edited, out for signature, OCR running) and Recent across your devices arrive with the server’s recent list.</p>
    </section>
  );
}

function RecentPage({ title, starredOnly }: { title: string; starredOnly: boolean }) {
  return (
    <>
      <H1>{title}</H1>
      <RecentTable starredOnly={starredOnly} title={starredOnly ? 'Starred PDFs' : 'Recently opened'} />
    </>
  );
}

function SharedPage() {
  const { navigate } = useTab();
  return (
    <>
      <H1>Shared with me</H1>
      <Pending title="PDFs shared with you live in Files" action={<Button icon="folder" onClick={() => navigate('/files')}>Open Files</Button>}>
        A PDF-only Shared list needs the server’s GET api/files/pdf/recent (base SRS §12.2). Until then, Files › Shared with me lists everything shared with you; PDFs there open in PDF Studio.
      </Pending>
    </>
  );
}

const AGREEMENT_STATES = ['Draft', 'Out for signature', 'Waiting for me', 'Completed', 'Declined', 'Expired', 'Cancelled'];

function AgreementsPage() {
  const [f, setF] = useState('Out for signature');
  return (
    <>
      <H1 aside={<ProBadge />}>Agreements</H1>
      <div className="flex flex-wrap gap-1.5">
        {AGREEMENT_STATES.map((s) => (
          <button key={s} type="button" aria-pressed={f === s} onClick={() => setF(s)} className={cx('rounded-full border px-3 py-1 text-[12px] font-semibold', f === s ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
            {s}
          </button>
        ))}
      </div>
      <Pending icon="signature" title="E-signature agreements need the server">
        Agreements you sent or must sign — with status, next signer, reminders, cancel, replace, audit report and CSV export — come from PDFAgreementService (api/pdf/agreements, ENH-01 T12, phase PRO-4). Nothing is listed until your server has it.
      </Pending>
      <GapList tool={toolById('esign')!} />
    </>
  );
}

function ScansPage({ onTool }: { onTool: (id: ToolId) => void }) {
  return (
    <>
      <H1 aside={<Button icon="scan" onClick={() => onTool('ocr')}>Recognize text in a PDF…</Button>}>Scans</H1>
      <Pending icon="scan" title="Scanning arrives with the scanner bridge">
        Scans made here (TWAIN/WIA on Windows, ICA on macOS, SANE on Linux) and batch OCR of a Drive folder are listed here. Recognizing text in a PDF you already have uses Scan &amp; OCR.
      </Pending>
      <GapList tool={toolById('ocr')!} />
    </>
  );
}

function OfflinePage() {
  return (
    <>
      <H1>Offline copies</H1>
      <Pending icon="cloud-off" title="Offline copies and the outbox">
        Drive PDFs kept for offline use (encrypted on this computer), and saves waiting in the outbox for a connection, are listed here (base WF-08, DK16). Today a save made offline is kept on this computer and sent when WorkSuite answers — shown as “Saved on this computer” on the document — but there is no “Keep an offline copy” list yet.
      </Pending>
      <ul className="list-disc ps-5 text-[12.5px] text-ink-2">
        <li>Keep an offline copy when opening a Drive PDF (encrypted cache with its base version)</li>
        <li>Outbox list: file, base version, size, waiting/sending/conflict</li>
        <li>Manage: size used, remove a copy, wipe on sign-out per policy</li>
      </ul>
    </>
  );
}

const GROUPS: ToolGroup[] = ['create', 'review', 'protect', 'advanced'];

function ToolsPage({ onTool }: { onTool: (id: ToolId) => void }) {
  const ready = TOOLS.filter((t) => t.status !== 'ui').length;
  return (
    <>
      <H1>All tools</H1>
      <p className="text-[12.5px] text-ink-2">
        {TOOLS.length} tools, grouped as in Acrobat Pro. {ready} work on this computer or for Drive PDFs on the WorkSuite server (fully or in part); each says what runs where and what is still to build.
      </p>
      {GROUPS.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-[13px] font-bold tracking-[.3px] text-ink-3 uppercase">{GROUP_LABEL[g]}</h2>
          <div className="flex flex-col gap-2">
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <div key={t.id} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
                <div className="flex items-center gap-2.5">
                  <Icon name={t.icon} size={16} className="text-primary" />
                  <button type="button" onClick={() => onTool(t.id)} className="text-[13.5px] font-bold text-ink hover:text-primary">{t.label}</button>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{t.blurb}</span>
                  {t.pro ? <ProBadge note={t.proNote} /> : null}
                  <StatusChip tool={t} />
                </div>
                <GapList tool={t} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ToolPageLink({ id, onTool }: { id: ToolId; onTool: (id: ToolId) => void }) {
  const t = toolById(id)!;
  return (
    <>
      <H1 aside={<Button variant="primary" icon={t.icon} onClick={() => onTool(id)}>Open {t.label}</Button>}>{t.label}</H1>
      <GapList tool={t} open />
    </>
  );
}

const TOOLS_ON_SERVER: Array<{ name: string; unlocks: string }> = [
  { name: 'Tesseract OCR (eng, sin, tam)', unlocks: 'OCR — make searchable' },
  { name: 'Ghostscript', unlocks: 'Compress & optimize, PDF/A' },
  { name: 'qpdf', unlocks: 'Protect with password, repair' },
  { name: 'poppler', unlocks: 'Convert to images, HTML and text' },
  { name: 'LibreOffice (headless)', unlocks: 'Convert to and from Word, Excel and PowerPoint' },
  { name: 'veraPDF', unlocks: 'Verify PDF/A and PDF/UA' },
];

function JobsPage() {
  return (
    <>
      <H1>Jobs</H1>
      <Pending icon="server" title="Server jobs are not connected in this version">
        Your OCR, compress, convert, protect, repair and PDF/A jobs — queued, running (pages done), done (open, size change) and failed (reason; file unchanged), with cancel for queued jobs — come from GET api/files/pdf/jobs (base SRS §12.2). The web editor’s server tools exist under api/pdf/server/*; they move behind files.pdf.* and the policy first (base F-05).
      </Pending>
      <Section title="Server capability" className="rounded-[12px] border border-line bg-surface">
        <ul className="flex flex-col gap-1">
          {TOOLS_ON_SERVER.map((s) => (
            <li key={s.name} className="flex items-center gap-2 text-[12.5px]">
              <Icon name="server" size={14} className="text-ink-3" />
              <b className="text-ink">{s.name}</b>
              <span className="flex-1 text-ink-3">{s.unlocks}</span>
              <Chip>Not checked</Chip>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] text-ink-3">Read from GET api/files/pdf/capabilities once the desktop asks for it; a missing tool shows what installing it unlocks.</p>
      </Section>
    </>
  );
}

function RecoveryPage() {
  return (
    <>
      <H1>Recover unsaved work</H1>
      <Pending icon="history" title="Unsaved changes are kept on this computer">
        PDF Studio seals every change on this computer as you work. If WorkSuite closes before you save, open the PDF again: your changes come back with a banner to save or discard them, and a draft whose Drive file moved on asks what to do (keep both, upload as the newest version, or use WorkSuite’s version).
      </Pending>
      <Section title="Still to build (DK16, PDF-DSK-004)" className="rounded-[12px] border border-line bg-surface">
        <ul className="list-disc ps-5 text-[12.5px] text-ink-2">
          <li>A start-up recovery dialog listing every draft with its Drive state (unchanged / moved on / local file)</li>
          <li>Recover several at once, discard selected, decide later</li>
          <li>Retention per policy (14 days) with purge, shown here</li>
          <li>The IPC to list drafts without opening each PDF (pdf:recoveryList)</li>
        </ul>
      </Section>
    </>
  );
}

// ── Settings › PDF Studio (DK17, PDF-DSK-006) ────────────────────────────

const PREFS_KEY = 'pdf.prefs';
interface Prefs {
  openIn: 'tab' | 'window';
  reopen: boolean;
  startMode: 'VIEW' | 'ANNOTATE';
  author: string;
  pageCache: '256' | '512' | '1024';
  ocrLangs: { eng: boolean; sin: boolean; tam: boolean };
}
const DEFAULT_PREFS: Prefs = { openIn: 'tab', reopen: false, startMode: 'VIEW', author: '', pageCache: '512', ocrLangs: { eng: true, sin: true, tam: true } };

export function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function Row({ label, hint, children, locked }: { label: string; hint?: ReactNode; children: ReactNode; locked?: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <b className="block text-[13px] text-ink">{label}</b>
        {hint ? <span className="block text-[11.5px] text-ink-3">{hint}</span> : null}
      </div>
      {locked ? (
        <span className="flex items-center gap-1 text-[12px] text-ink-2" title="Set by your organization">
          <Icon name="lock" size={12} /> {locked}
        </span>
      ) : (
        <div className="w-[220px] shrink-0">{children}</div>
      )}
    </div>
  );
}

function SettingsPage() {
  const [p, setP] = useState<Prefs>(readPrefs);
  const set = (next: Prefs) => {
    setP(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* a convenience only */
    }
  };
  return (
    <>
      <H1>Settings › PDF Studio</H1>
      <p className="text-[12px] text-ink-3">Kept on this computer. Preferences that follow you to Web and Mobile arrive with the server’s api/files/pdf/preferences. Values your organization sets are shown with a lock.</p>
      <Section title="Opening" className="rounded-[12px] border border-line bg-surface">
        <Row label="Default PDF app" hint="Double-clicked PDFs open in WorkSuite. Offered, never changed silently.">
          <span className="text-[12px] text-ink-3">In your system’s settings: Default apps</span>
        </Row>
        <Row label="Open PDFs from Mail, Chat and records in">
          <Pick label="Open in" value={p.openIn} onChange={(openIn) => set({ ...p, openIn })} options={[{ id: 'tab', label: 'A new tab' }, { id: 'window', label: 'A new window' }]} />
        </Row>
        <Row label="Reopen PDFs from last session">
          <CheckRow label="Reopen" checked={p.reopen} onChange={(reopen) => set({ ...p, reopen })} />
        </Row>
        <Row label="Start in">
          <Pick label="Start mode" value={p.startMode} onChange={(startMode) => set({ ...p, startMode })} options={[{ id: 'VIEW', label: 'View mode' }, { id: 'ANNOTATE', label: 'Annotate mode' }]} />
        </Row>
      </Section>
      <Section title="Editing & review" className="rounded-[12px] border border-line bg-surface">
        <Row label="Name on comments and stamps" hint="Leave empty to use your WorkSuite name.">
          <Input value={p.author} maxLength={80} onChange={(e) => set({ ...p, author: e.target.value })} />
        </Row>
        <Row label="Saved signatures and initials" hint="Encrypted to your account (api/files/pdf/signatures).">
          <span className="text-[12px] text-ink-3">Needs the WorkSuite server</span>
        </Row>
        <Row label="Digital IDs" hint="A PKCS#12 file or a smart card, chosen when you sign in the Pro panel.">
          <span className="text-[12px] text-ink-3">Chosen when you sign</span>
        </Row>
        <Row label="Autosave draft every" locked="Your organization’s interval">
          {null}
        </Row>
      </Section>
      <Section title="Offline & recovery" className="rounded-[12px] border border-line bg-surface">
        <Row label="Offline copies" hint="Encrypted on this computer.">
          <span className="text-[12px] text-ink-3">Not in this version</span>
        </Row>
        <Row label="Recovery drafts kept" locked="Your organization’s retention">
          {null}
        </Row>
      </Section>
      <Section title="Engine & performance" className="rounded-[12px] border border-line bg-surface">
        <Row label="Rendering" locked="PDFium (WebAssembly) · one process per PDF">
          {null}
        </Row>
        <Row label="Page cache">
          <Pick label="Page cache" value={p.pageCache} onChange={(pageCache) => set({ ...p, pageCache })} options={[{ id: '256', label: '256 MB' }, { id: '512', label: '512 MB' }, { id: '1024', label: '1 GB' }]} />
        </Row>
        <Row label="OCR languages on this computer">
          <div className="flex gap-3">
            {(['eng', 'sin', 'tam'] as const).map((l) => (
              <CheckRow key={l} label={l === 'eng' ? 'English' : l === 'sin' ? 'Sinhala' : 'Tamil'} checked={p.ocrLangs[l]} onChange={(v) => set({ ...p, ocrLangs: { ...p.ocrLangs, [l]: v } })} />
            ))}
          </div>
        </Row>
      </Section>
      <p className="text-[11.5px] text-ink-3">Open-in, reopen, start mode, author name, page cache and OCR languages are remembered here and applied as each feature lands (see docs/PDF_STUDIO_GAP_PLAN.md).</p>
    </>
  );
}

// ── Admin Center › Files › PDF Studio (A01, PDF-ADM-001/002) ─────────────

interface Policy {
  editing: boolean;
  annotation: boolean;
  localFiles: boolean;
  externalApps: boolean;
  offline: boolean;
  print: boolean;
  export: boolean;
  copy: boolean;
  links: 'allow' | 'confirm' | 'block';
  saveMode: 'new_version' | 'copy';
  autosave: string;
  checkpoint: string;
  retention: string;
  maxSize: string;
  lockTimeout: string;
  redactionOutput: 'copy' | 'version';
  jobs: string;
  formsComment: boolean;
}

const POLICY_DEFAULTS: Policy = { editing: true, annotation: true, localFiles: true, externalApps: true, offline: true, print: true, export: true, copy: true, links: 'confirm', saveMode: 'new_version', autosave: '30', checkpoint: '30', retention: '14', maxSize: '2048', lockTimeout: '15', redactionOutput: 'copy', jobs: '3', formsComment: false };

function AdminPage() {
  const [p, setP] = useState<Policy>(POLICY_DEFAULTS);
  const sw = (k: keyof Policy, label: string) => <CheckRow label={label} checked={p[k] as boolean} onChange={(v) => setP({ ...p, [k]: v })} />;
  const num = (k: keyof Policy, label: string, unit: string, range: string) => (
    <Field label={`${label} (${unit})`} hint={range}>
      <Input inputMode="numeric" value={p[k] as string} onChange={(e) => setP({ ...p, [k]: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
    </Field>
  );
  return (
    <>
      <H1
        aside={
          <>
            <Button onClick={() => setP(POLICY_DEFAULTS)}>Reset to defaults</Button>
            <span data-needs="server" className="text-[12px] font-semibold text-ink-3">Saving needs the WorkSuite server (Admin Center › Files › PDF Studio)</span>
          </>
        }
      >
        PDF Studio policy
      </H1>
      <p className="text-[12.5px] text-ink-2">Applies to everyone in your organization on Web, Desktop and Mobile. Drive sharing and roles still decide per file. Saving writes pdf.policy.updated to the audit log; apps pick it up at their next heartbeat.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Editing" className="rounded-[12px] border border-line bg-surface">
          {sw('editing', 'Editing PDFs')}
          {sw('annotation', 'Annotations and comments')}
          {sw('localFiles', 'Open files from this computer')}
          {sw('externalApps', 'Open in another app')}
          {sw('offline', 'Offline editing')}
          {sw('formsComment', 'People with comment rights may fill forms')}
        </Section>
        <Section title="Getting content out" className="rounded-[12px] border border-line bg-surface">
          {sw('print', 'Print')}
          {sw('export', 'Export & convert')}
          {sw('copy', 'Copy text')}
          <Field label="Links inside PDFs">
            <Pick label="Links" value={p.links} onChange={(links) => setP({ ...p, links })} options={[{ id: 'allow', label: 'Allow' }, { id: 'confirm', label: 'Ask first' }, { id: 'block', label: 'Block' }]} />
          </Field>
          <p className="flex items-center gap-1.5 text-[12px] text-ink-2"><Icon name="lock" size={12} /> JavaScript, launch actions, auto-opening attachments: always blocked</p>
        </Section>
        <Section title="Saving" className="rounded-[12px] border border-line bg-surface">
          <Field label="Default save">
            <Pick label="Default save" value={p.saveMode} onChange={(saveMode) => setP({ ...p, saveMode })} options={[{ id: 'new_version', label: 'New version' }, { id: 'copy', label: 'Copy' }]} />
          </Field>
          <Field label="Redaction saves as">
            <Pick label="Redaction saves as" value={p.redactionOutput} onChange={(redactionOutput) => setP({ ...p, redactionOutput })} options={[{ id: 'copy', label: 'Copy' }, { id: 'version', label: 'Version' }]} />
          </Field>
          {num('autosave', 'Autosave draft every', 's', '10–300')}
          {num('checkpoint', 'Checkpoint version every', 'min', '0 (off)–240')}
          {num('retention', 'Recovery drafts kept for', 'days', '1–90')}
        </Section>
        <Section title="Limits & locks" className="rounded-[12px] border border-line bg-surface">
          {num('maxSize', 'Largest PDF that can be edited', 'MB', 'Per organization')}
          {num('lockTimeout', 'Edit lock ends after idle', 'min', '5–240')}
          {num('jobs', 'Concurrent server jobs', 'jobs', '1–20')}
          <p className="text-[12px] text-ink-2">Lock ends without a heartbeat after 120 s. Who can break a lock: the file owner and files.pdf.admin.</p>
        </Section>
      </div>
      <Section title="Open edit locks" className="rounded-[12px] border border-line bg-surface">
        <p className="text-[12.5px] text-ink-3">Locks with holder, device and idle time, each with Release… (reason required), come from GET api/admin/files/pdf/locks (base §12.2, P1) — not on the server yet.</p>
      </Section>
      <Section title="Who holds PDF permissions" className="rounded-[12px] border border-line bg-surface">
        <p className="text-[12.5px] text-ink-3">files.pdf.admin, .edit, .organize, .annotate, .export, .print and the new Pro permissions are managed in Users &amp; roles on the web.</p>
      </Section>
    </>
  );
}
