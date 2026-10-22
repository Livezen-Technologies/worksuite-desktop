import { useCallback, useEffect, useRef, useState } from 'react';
import { on } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import { CheckRow, Field, Input, inputCls, Pick } from './parts';
import { listTokens, pro, proError, signWithToken, type ConvertFormats, type FormLink, type OcrResult, type PresenceRow, type Rect, type TokenCert } from './pro';

/**
 * PDF Studio Pro on the desktop, second release (WS-SRS-PDFPRO-001): signing
 * with a smart card or USB token (PRO-SIG-002), conversion and OCR
 * (PRO-CNV-001..006), print production (PRO-PRT-001..003), forms by link
 * (PRO-FRM-006) and who else is on the PDF (PRO-REV-006) — the same server
 * API as the web editor; the token signs here.
 */

function useRun(): [boolean, <T>(fn: () => Promise<T>, ok?: (r: T) => string | null) => Promise<T | null>] {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: (r: T) => string | null): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      const m = ok?.(r);
      if (m) toast('success', m);
      return r;
    } catch (e) {
      toast('error', proError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

const LANGS: Record<string, string> = { eng: 'English', sin: 'සිංහල', tam: 'தமிழ்' };

/* ─────────────────────────── smart card / USB token ─────────────────────────── */

export function TokenSign({ fileId, level, reason, rect, onChanged }: { fileId: number; level: string; reason: string; rect: Rect | null; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [certs, setCerts] = useState<TokenCert[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [module, setModule] = useState('');
  const [pick, setPick] = useState(0);
  const [pin, setPin] = useState('');

  const look = () => run(() => listTokens(module || null)).then((r) => {
    if (!r) return;
    setWhy(r.reason);
    setCerts(r.tokens.flatMap((t) => t.certs));
    setPick(0);
  });

  const cert = certs?.[pick];

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <Field label={text('Smart card or USB token')} hint={text('The key stays on the token. You type its PIN here; it goes to the token only.')}>
        <div className="flex gap-1.5">
          <Input aria-label={text('Token library (optional)')} placeholder={text('Token library (optional)')} value={module} onChange={(e) => setModule(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => void look()}>{text('Find tokens')}</Button>
        </div>
      </Field>
      {why ? <p className="text-[11.5px] text-ink-3">{why}</p> : null}
      {certs?.length ? (
        <>
          <select aria-label={text('Certificate on the token')} className={inputCls} value={pick} onChange={(e) => setPick(Number(e.target.value))}>
            {certs.map((c, i) => <option key={`${c.token}-${c.id}`} value={i}>{c.label} — {c.token}</option>)}
          </select>
          <div className="flex gap-1.5">
            <Input type="password" autoComplete="off" aria-label={text('Token PIN')} placeholder={text('Token PIN')} value={pin} onChange={(e) => setPin(e.target.value)} />
            <Button size="sm" variant="primary" icon="signature" disabled={busy || !pin || !cert} onClick={() => {
              if (!cert) return;
              const p = pin;
              setPin('');
              void run(() => signWithToken(fileId, cert, p, { level, reason, rect }), (r) => text('Signed ({l}) — version {v}', { l: r.level, v: r.version })).then((r) => r && onChanged(r.version));
            }}>{text('Sign with the token')}</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── conversion and OCR ─────────────────────────── */

export function ConvertOcr({ fileId, version, canConvert, canOcr, onChanged }: { fileId: number; version: number; canConvert: boolean; canOcr: boolean; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [formats, setFormats] = useState<ConvertFormats | null>(null);
  const [format, setFormat] = useState('docx');
  const [mode, setMode] = useState<'searchable' | 'editable'>('searchable');
  const [lang, setLang] = useState('auto');
  const [deskew, setDeskew] = useState(true);
  const [clean, setClean] = useState(true);
  const [force, setForce] = useState(false);
  const [report, setReport] = useState<OcrResult | null>(null);

  useEffect(() => { pro.formats().then(setFormats).catch(() => undefined); }, []);

  return (
    <>
      {canConvert && formats?.from_pdf.length ? (
        <div className="flex items-end gap-1.5">
          <Field label={text('Convert to')}>
            <Pick label={text('Convert to')} value={format} options={formats.from_pdf.map((f) => ({ id: f.format, label: f.format.toUpperCase() }))} onChange={setFormat} />
          </Field>
          <Button size="sm" disabled={busy} onClick={() => void run(() => pro.convert(fileId, format), (r) => text('Saved to Drive: {name}', { name: r.name }))}>{text('Convert')}</Button>
        </div>
      ) : null}
      {canOcr ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          {formats && !formats.ocr.available ? <p className="text-[11.5px] text-warning">{formats.ocr.detail}</p> : null}
          <Field label={text('Recognise text (OCR)')}>
            <Pick label={text('OCR output')} value={mode} options={[{ id: 'searchable', label: text('Searchable (keep the scan, add a text layer)') }, { id: 'editable', label: text('Editable (replace the scan with text)') }]} onChange={setMode} />
          </Field>
          <Field label={text('Language')}>
            <Pick label={text('Language')} value={lang} options={[{ id: 'auto', label: text('Detect automatically') }, ...(formats?.ocr.languages ?? []).map((l) => ({ id: l, label: LANGS[l] ?? l }))]} onChange={setLang} />
          </Field>
          <CheckRow label={text('Straighten')} checked={deskew} onChange={setDeskew} />
          <CheckRow label={text('Clean specks and backgrounds where needed')} checked={clean} onChange={setClean} />
          <CheckRow label={text('Recognise pages that already have text')} checked={force} onChange={setForce} />
          <Button size="sm" variant="primary" disabled={busy || formats?.ocr.available === false} onClick={() => void run(() => pro.ocr(fileId, {
            mode, languages: [lang], deskew, despeckle: clean ? 'auto' : false, background: clean ? 'auto' : false, force, base_version: version,
          }), (r) => (r.mode === 'none' ? r.message ?? null : text('Recognised {n} pages', { n: r.recognised }))).then((r) => {
            if (!r) return;
            setReport(r);
            if (r.mode === 'version') onChanged(r.version);
          })}>{text('Recognise text')}</Button>
          {report ? <ul className="text-[11.5px] text-ink-2">{report.pages.map((p) => <li key={p.page}>p.{p.page}: {p.skipped ? '—' : `${p.language} · ${p.words} · ${p.confidence}%${p.rotated ? ` · ↻${p.rotated}°` : ''}`}</li>)}</ul> : null}
        </div>
      ) : null}
    </>
  );
}

/* ─────────────────────────── print production ─────────────────────────── */

export function PrintProduction({ fileId, version, page, onChanged }: { fileId: number; version: number; page: number; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [profile, setProfile] = useState<'pdfx1a' | 'pdfx4' | 'custom'>('pdfx4');
  const [results, setResults] = useState<Array<{ rule: string; status: string; page: number | null; message: string }> | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [plates, setPlates] = useState<{ channels: string[]; intent: string | null; overprint: boolean } | null>(null);
  const [plate, setPlate] = useState<string | null>(null);
  const [mode, setMode] = useState<'nup' | 'booklet'>('nup');
  const [per, setPer] = useState('2');
  const [marks, setMarks] = useState(true);

  return (
    <>
      <div className="flex items-end gap-1.5">
        <Field label={text('Preflight')}>
          <Pick label={text('Preflight profile')} value={profile} options={[{ id: 'pdfx1a', label: 'PDF/X-1a' }, { id: 'pdfx4', label: 'PDF/X-4' }, { id: 'custom', label: text('Custom') }]} onChange={setProfile} />
        </Field>
        <Button size="sm" disabled={busy} onClick={() => void run(() => pro.preflight(fileId, { profile })).then((r) => { if (r) { setResults(r.results); setPassed(r.passed); } })}>{text('Check')}</Button>
        <Button size="sm" disabled={busy} onClick={() => void run(() => pro.preflight(fileId, { profile, fix: true, base_version: version }), (r) => text('Fixed: {what}', { what: (r.fixed ?? []).join(', ') || '—' })).then((r) => {
          if (!r) return;
          setResults(r.results); setPassed(r.passed);
          if (r.version) onChanged(r.version);
        })}>{text('Fix')}</Button>
      </div>
      {passed !== null ? <p className={passed ? 'text-[12px] font-semibold text-success' : 'text-[12px] font-semibold text-danger'}>{passed ? text('Passed') : text('Problems found')}</p> : null}
      {results?.filter((r) => r.status !== 'pass').map((r, i) => <p key={i} className="text-[11.5px] text-ink-2">{r.status === 'fail' ? '✗' : '!'} {r.page ? `p.${r.page} ` : ''}{r.message}</p>)}
      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <Button size="sm" disabled={busy} onClick={() => void run(() => pro.separations(fileId, page)).then((r) => r && setPlates({ channels: r.pages[0]?.channels ?? [], intent: r.output_intent.condition, overprint: r.pages[0]?.overprint ?? false }))}>{text('Separations on this page')}</Button>
        {plates ? (
          <>
            <p className="text-[11.5px] text-ink-3">{text('Output intent')}: {plates.intent ?? '—'}{plates.overprint ? ` · ${text('Overprint')}` : ''}</p>
            <div className="flex flex-wrap gap-1">{[...plates.channels, 'composite'].map((c) => <Button key={c} size="sm" disabled={busy} onClick={() => void run(() => pro.separations(fileId, page, c)).then((r) => r?.preview && setPlate(r.preview.png_b64))}>{c}</Button>)}</div>
            {plate ? <img alt={text('Separations on this page')} className="max-h-64 border border-line" src={`data:image/png;base64,${plate}`} /> : null}
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <Field label={text('Impose')}>
          <Pick label={text('Impose')} value={mode} options={[{ id: 'nup', label: text('Several pages per sheet') }, { id: 'booklet', label: text('Booklet') }]} onChange={setMode} />
        </Field>
        {mode === 'nup' ? <Pick label={text('Pages per sheet')} value={per} options={['2', '4', '6', '9'].map((n) => ({ id: n, label: n }))} onChange={setPer} /> : null}
        <CheckRow label={text('Crop and bleed marks')} checked={marks} onChange={setMarks} />
        <Button size="sm" disabled={busy} onClick={() => void run(() => pro.impose(fileId, { mode, per_sheet: Number(per), marks, bleed: marks ? 9 : 0 }), (r) => text('Saved to Drive ({n} sheets)', { n: r.sheets }))}>{text('Impose')}</Button>
      </div>
    </>
  );
}

/* ─────────────────────────── forms by link ─────────────────────────── */

export function FormLinks({ fileId }: { fileId: number }) {
  const [busy, run] = useRun();
  const [links, setLinks] = useState<FormLink[]>([]);
  const [email, setEmail] = useState(false);
  const [table, setTable] = useState<{ columns: string[]; rows: Array<{ id: number; cells: string[] }> } | null>(null);
  const load = useCallback(() => pro.formLinks(fileId).then((r) => setLinks(r.links)).catch(() => undefined), [fileId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <p className="text-[11.5px] text-ink-3">{text('Anyone with the link can fill in the form; the answers come back here as a table.')}</p>
      <CheckRow label={text('Ask for an email')} checked={email} onChange={setEmail} />
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => pro.formLinkCreate(fileId, { collect_name: true, collect_email: email })).then(async (r) => {
        if (!r) return;
        try { await navigator.clipboard.writeText(r.path); } catch { /* shown below */ }
        toast('success', text('Link made and copied: {path}', { path: r.path }));
        void load();
      })}>{text('Create link')}</Button>
      {links.map((l) => (
        <div key={l.id} className="rounded-[8px] border border-line p-2 text-[12px]">
          <b>{l.title}</b> · {l.status} · {l.responses}
          <div className="mt-1 flex gap-1">
            <Button size="sm" disabled={busy} onClick={() => void run(() => pro.formResponses(fileId, l.id)).then((r) => r && setTable(r))}>{text('Responses')}</Button>
            <Button size="sm" disabled={busy} onClick={() => void run(() => pro.formLinkUpdate(fileId, l.id, { status: l.status === 'closed' ? 'open' : 'closed' })).then((r) => r && void load())}>{l.status === 'closed' ? text('Reopen') : text('Close')}</Button>
          </div>
        </div>
      ))}
      {table ? (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead><tr>{table.columns.map((c) => <th key={c} className="pr-2">{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r) => <tr key={r.id}>{r.cells.map((c, i) => <td key={i} className="pr-2">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

/* ─────────────────────────── presence ─────────────────────────── */

/** Who else has the PDF open and on which page: a heartbeat, and the file's realtime topic. */
export function PresenceLine({ fileId, page }: { fileId: number; page: number }) {
  const [others, setOthers] = useState<PresenceRow[]>([]);
  const pageRef = useRef(page);
  const beat = useCallback(() => pro.presence(fileId, pageRef.current).then((r) => setOthers(r.others)).catch(() => undefined), [fileId]);

  useEffect(() => {
    void beat();
    const t = setInterval(() => void beat(), 20_000);
    let off: (() => void) | null = null;
    try {
      off = on<{ type?: string; topic?: string; actor?: number; left?: boolean }>('realtime:event', (e) => {
        if (e?.type !== 'pdf.presence' || e.topic !== `pdf.file.${fileId}`) return;
        if (e.left) setOthers((o) => o.filter((x) => x.user_id !== e.actor));
        else void beat();
      });
    } catch {
      // Without the bridge the heartbeat still keeps the list.
    }
    return () => { clearInterval(t); off?.(); void pro.presenceLeave(fileId).catch(() => undefined); };
  }, [fileId, beat]);

  // A page change is told at once.
  useEffect(() => { pageRef.current = page; void beat(); }, [page, beat]);

  if (!others.length) return null;
  return <p className="px-1 pb-1.5 text-[11.5px] text-ink-2" aria-live="polite">{text('Also here')}: {others.map((o) => `${o.name} (${text('page {n}', { n: o.page })})`).join(', ')}</p>;
}
