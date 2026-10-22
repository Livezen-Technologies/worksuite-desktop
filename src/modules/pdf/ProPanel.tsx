import { useEffect, useState, type ReactNode } from 'react';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';
import { CheckRow, Field, Input, inputCls } from './parts';
import { openPkcs12, pro, proError, signWithLocalId, type LocalId, type ProMe, type SignatureCheck, type Thread } from './pro';

/**
 * PDF Studio Pro for a Drive PDF on the desktop (PRO-NFR-041: in PDF Studio's
 * own panel). Everything runs on the server through the same API as the web
 * editor, except signing with a PKCS#12 file, which signs here. A result is a
 * new Drive version (or a copy): `onChanged` offers to reopen it.
 */
export default function ProPanel({ fileId, version, page, onChanged }: { fileId: number; version: number; page: number; onChanged: (version: number | null) => void }) {
  const [me, setMe] = useState<ProMe | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    pro.me().then(setMe).catch((e) => setErr(proError(e)));
  }, []);

  if (err) return <p className="p-3 text-[12px] text-danger">{err}</p>;
  if (!me) return <p className="p-3 text-[12px] text-ink-3">{text('Loading…')}</p>;
  if (!me.entitled) {
    return (
      <div role="note" className="m-3 rounded-[8px] bg-warning-bg p-3 text-[12px] text-warning">
        <b>{text('PDF Studio Pro')}</b>
        <p className="mt-1">{text('This is a PDF Studio Pro feature. Ask your PDF administrator for a Pro seat.')}</p>
      </div>
    );
  }

  const can = (k: string) => me.features[k] === true;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin p-2 text-[12.5px] text-ink">
      {can('redact') ? <Block title={text('Redact and sanitise')}><Redact fileId={fileId} version={version} me={me} onChanged={onChanged} /></Block> : null}
      <Block title={text('Signatures')}><Signatures fileId={fileId} version={version} me={me} canSign={can('sign')} onChanged={onChanged} /></Block>
      {can('envelopes') ? <Block title={text('Send for signature')}><Envelope fileId={fileId} /></Block> : null}
      {can('content_edit') ? <Block title={text('Edit text')}><Edit fileId={fileId} version={version} onChanged={onChanged} /></Block> : null}
      {can('compare') && version > 1 ? <Block title={text('Compare versions')}><Compare fileId={fileId} version={version} /></Block> : null}
      {can('review') ? <Block title={text('Shared review')}><Review fileId={fileId} onChanged={onChanged} /></Block> : null}
      {can('forms') ? <Block title={text('Form fields')}><Forms fileId={fileId} onChanged={onChanged} /></Block> : null}
      <Block title={text('Accessibility')}><Access fileId={fileId} canFix={can('accessibility')} onChanged={onChanged} /></Block>
      {can('ai') && me.settings.ai_enabled ? <Block title={text('AI Assistant')}><Ai fileId={fileId} page={page} /></Block> : null}
      {can('batch') ? <Block title={text('Run an Action')}><Batch fileId={fileId} /></Block> : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mb-1.5 rounded-[8px] border border-line bg-surface">
      <summary className="cursor-pointer select-none px-2.5 py-2 text-[12.5px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-primary">{title}</summary>
      <div className="flex flex-col gap-2 border-t border-line p-2.5">{children}</div>
    </details>
  );
}

/** A call with a busy flag and the server's sentence on failure. */
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

function Redact({ fileId, version, me, onChanged }: { fileId: number; version: number; me: ProMe; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [on, setOn] = useState<Record<string, boolean>>({ nic: true, email: true, phone: true });
  const [words, setWords] = useState('');
  const [code, setCode] = useState('');
  const [found, setFound] = useState<number | null>(null);
  const query = () => ({ patterns: Object.keys(on).filter((k) => on[k]), terms: words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean) });

  return (
    <>
      <p className="text-[11.5px] text-ink-3">{text('Removes the text and images under each match for good, checks nothing is left, and saves a new version.')}</p>
      {Object.entries(me.patterns).map(([k, label]) => <CheckRow key={k} label={label} checked={!!on[k]} onChange={(x) => setOn({ ...on, [k]: x })} />)}
      <Field label={text('Words and phrases')}><Input value={words} onChange={(e) => setWords(e.target.value)} /></Field>
      {me.redaction_codes.length ? (
        <Field label={text('Reason code')}>
          <select className={inputCls} value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">{text('None')}</option>
            {me.redaction_codes.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.label}</option>)}
          </select>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" icon="search" loading={busy} onClick={() => void run(() => pro.redactSearch(fileId, query())).then((r) => r && setFound(r.count))}>{text('Find')}</Button>
        {found !== null ? <Chip tone={found ? 'warning' : 'muted'}>{found}</Chip> : null}
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => pro.redact(fileId, { base_version: version, search: { ...query(), code: code || undefined } }), (r) => text('Saved as version {v}', { v: r.version })).then((r) => r && onChanged(r.version))}>{text('Redact')}</Button>
        <Button size="sm" disabled={busy} onClick={() => void run(() => pro.sanitise(fileId, { mode: 'copy' }), () => text('A sanitised copy is in Drive beside the original.'))}>{text('Sanitise a copy')}</Button>
      </div>
    </>
  );
}

const STATUS_TONE: Record<SignatureCheck['status'], 'success' | 'warning' | 'danger' | 'muted'> = { valid: 'success', valid_with_warnings: 'warning', invalid: 'danger', unknown: 'muted' };
const STATUS_WORD: Record<SignatureCheck['status'], string> = { valid: 'Valid', valid_with_warnings: 'Valid, with warnings', invalid: 'Invalid', unknown: 'Unknown' };

function Signatures({ fileId, version, me, canSign, onChanged }: { fileId: number; version: number; me: ProMe; canSign: boolean; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [sigs, setSigs] = useState<SignatureCheck[] | null>(null);
  const [level, setLevel] = useState(me.settings.min_signature_level);
  const [reason, setReason] = useState('');
  const [cert, setCert] = useState<number>(me.certificates[0]?.id ?? 0);
  const [local, setLocal] = useState<LocalId | null>(null);
  const [p12, setP12] = useState<ArrayBuffer | null>(null);
  const [pw, setPw] = useState('');
  const [visible, setVisible] = useState(true);

  useEffect(() => { void run(() => pro.signatures(fileId)).then((r) => r && setSigs(r.signatures)); }, [fileId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const rect = visible ? ([360, 40, 560, 100] as [number, number, number, number]) : null;

  return (
    <>
      {sigs?.length === 0 ? <p className="text-ink-3">{text('This PDF has no digital signatures.')}</p> : null}
      {sigs?.map((s) => (
        <div key={s.field} className="rounded-[8px] border border-line p-2">
          <div className="flex items-center gap-1.5"><Icon name="badge-check" size={14} /><b className="min-w-0 flex-1 truncate">{s.signer ?? s.field}</b><Chip tone={STATUS_TONE[s.status]}>{text(STATUS_WORD[s.status])}</Chip></div>
          <p className="text-[11.5px] text-ink-3">{s.level} · {s.signed_at ?? ''}{s.tsa_time ? ' · TSA' : ''}</p>
          {s.problems.map((p) => <p key={p} className="text-[11.5px] text-ink-2">• {p}</p>)}
        </div>
      ))}
      {canSign ? (
        <>
          <Field label={text('Level')}>
            <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>{['B-B', 'B-T', 'B-LT', 'B-LTA'].map((l) => <option key={l}>{l}</option>)}</select>
          </Field>
          <Field label={text('Reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <CheckRow label={text('Show the signature on page 1')} checked={visible} onChange={setVisible} />
          <Field label={text('Digital ID on this computer (PKCS#12)')} hint={text('The private key stays on this computer; only the signature is sent.')}>
            <input type="file" accept=".p12,.pfx" aria-label={text('PKCS#12 file')} className="text-[12px]" onChange={async (e) => { const f = e.target.files?.[0]; setLocal(null); setP12(f ? await f.arrayBuffer() : null); }} />
          </Field>
          {p12 && !local ? (
            <div className="flex gap-1.5">
              <Input type="password" aria-label={text('Password')} placeholder={text('Password')} value={pw} onChange={(e) => setPw(e.target.value)} />
              <Button size="sm" disabled={busy} onClick={() => void run(() => openPkcs12(p12, pw)).then((id) => id && setLocal(id))}>{text('Open')}</Button>
            </div>
          ) : null}
          {local ? (
            <Button size="sm" variant="primary" icon="signature" disabled={busy} onClick={() => void run(() => signWithLocalId(fileId, local, { level, reason, rect }), (r) => text('Signed ({l}) — version {v}', { l: r.level, v: r.version })).then((r) => r && onChanged(r.version))}>
              {text('Sign as {name}', { name: local.subject || text('me') })}
            </Button>
          ) : null}
          {me.certificates.length ? (
            <div className="flex flex-col gap-1.5 border-t border-line pt-2">
              <Field label={text('Or a certificate WorkSuite holds')}>
                <select className={inputCls} value={cert} onChange={(e) => setCert(Number(e.target.value))}>{me.certificates.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.purpose})</option>)}</select>
              </Field>
              <Button size="sm" disabled={busy || !cert} onClick={() => void run(() => pro.sign(fileId, { certificate_id: cert, level, reason, base_version: version, ...(rect ? { page: 1, rect } : {}) }), (r) => text('Signed ({l}) — version {v}', { l: r.level, v: r.version })).then((r) => r && onChanged(r.version))}>{text('Sign')}</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Envelope({ fileId }: { fileId: number }) {
  const [busy, run] = useRun();
  const [rows, setRows] = useState([{ name: '', email: '' }]);
  const [title, setTitle] = useState('');

  const send = () => run(async () => {
    const people = rows.filter((r) => r.name.trim() && r.email.trim());
    const e = await pro.envelopeCreate({
      title, file_ids: [fileId], order_mode: 'sequential',
      recipients: people.map((r) => ({ ...r, role: 'signer' })),
      // A signature line per signer at the foot of page 1, side by side; the web builder places fields freely.
      fields: people.map((_, i) => ({ recipient_index: i, type: 'signature', page: 1, rect: [40 + (i % 3) * 180, 120 - Math.floor(i / 3) * 50, 200 + (i % 3) * 180, 160 - Math.floor(i / 3) * 50] })),
    });
    return pro.envelopeSend(e.id);
  }, () => text('Sent. The PDF is locked for editing until everyone has signed.'));

  return (
    <>
      <Field label={text('Title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-1.5">
          <Input aria-label={text('Name')} placeholder={text('Name')} value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
          <Input aria-label={text('Email')} placeholder={text('Email')} value={r.email} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))} />
        </div>
      ))}
      <div className="flex gap-1.5">
        <Button size="sm" icon="plus" onClick={() => setRows([...rows, { name: '', email: '' }])}>{text('Signer')}</Button>
        <Button size="sm" variant="primary" icon="send" disabled={busy || !rows.some((r) => r.name && r.email)} onClick={() => void send()}>{text('Send')}</Button>
      </div>
    </>
  );
}

function Edit({ fileId, version, onChanged }: { fileId: number; version: number; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [preview, setPreview] = useState<Array<{ page: number; before: string; after: string; mode: string }> | null>(null);
  const op = { op: 'replace_text', find, replace: repl };

  return (
    <>
      <Field label={text('Find')}><Input value={find} onChange={(e) => setFind(e.target.value)} /></Field>
      <Field label={text('Replace with')}><Input value={repl} onChange={(e) => setRepl(e.target.value)} /></Field>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={busy || !find} onClick={() => void run(() => pro.edit(fileId, { dry_run: true, ops: [op] })).then((r) => r && setPreview(r.changes))}>{text('Preview')}</Button>
        <Button size="sm" variant="primary" disabled={busy || !find} onClick={() => void run(() => pro.edit(fileId, { base_version: version, ops: [op], accept_substitution: true }), (r) => text('Saved as version {v}', { v: r.version ?? '' })).then((r) => r && onChanged(r.version ?? null))}>{text('Replace all')}</Button>
      </div>
      {preview ? <ul className="max-h-32 overflow-y-auto scroll-thin text-[11.5px]">{preview.length ? preview.map((c, i) => <li key={i}>p.{c.page}: <s>{c.before}</s> → <b>{c.after}</b>{c.mode === 'substituted' ? ' *' : ''}</li>) : <li className="text-ink-3">{text('No matches.')}</li>}</ul> : null}
    </>
  );
}

function Compare({ fileId, version }: { fileId: number; version: number }) {
  const [busy, run] = useRun();
  const [left, setLeft] = useState(version - 1);
  const [res, setRes] = useState<Awaited<ReturnType<typeof pro.compare>> | null>(null);

  return (
    <>
      <Field label={text('Compare version')}><Input type="number" min={1} max={version - 1} value={left} onChange={(e) => setLeft(Number(e.target.value))} /></Field>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => pro.compare({ left: { file_id: fileId, version: left }, right: { file_id: fileId, version } })).then((r) => r && setRes(r))}>{text('Compare with this version')}</Button>
      {res ? (
        <>
          <p className="text-[11.5px] text-ink-2">{Object.entries(res.stats).filter(([k]) => k !== 'total').map(([k, v]) => `${text(k)} ${v}`).join(' · ')}</p>
          <ul className="max-h-48 overflow-y-auto scroll-thin text-[11.5px]">
            {res.differences.map((d, i) => (
              <li key={i} className="border-b border-line py-1"><b>{text(d.type)}</b>{d.left ? <div className="text-danger line-through">p.{d.left.page} {d.left.text}</div> : null}{d.right ? <div className="text-success">p.{d.right.page} {d.right.text}</div> : null}</li>
            ))}
          </ul>
          <Button size="sm" disabled={busy} onClick={() => void run(() => pro.compareExport(res.id, 'report'), () => text('The compare report is in your Drive.'))}>{text('Report PDF')}</Button>
        </>
      ) : null}
    </>
  );
}

function Review({ fileId, onChanged }: { fileId: number; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const load = () => run(() => pro.annotations(fileId)).then((r) => r && setThreads(r.threads));
  useEffect(() => { void load(); }, [fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (uid: string, body: Record<string, unknown>) => run(() => pro.reply(fileId, uid, body), (r) => text('Saved as version {v}', { v: r.version })).then((r) => { if (r) { onChanged(r.version); void load(); } });

  return (
    <>
      {threads?.length === 0 ? <p className="text-ink-3">{text('No comments yet.')}</p> : null}
      {threads?.map((t) => (
        <div key={t.uid} className="rounded-[8px] border border-line p-2 text-[12px]">
          <p><b>{t.author ?? '—'}</b> · p.{t.page}{t.status ? ` · ${t.status}` : ''}</p>
          {t.text ? <p className="whitespace-pre-wrap">{t.text}</p> : null}
          {t.replies.map((r) => <p key={r.uid} className="ms-3 border-s-2 border-line ps-1.5"><b>{r.author}</b>: {r.text}</p>)}
          <div className="mt-1 flex gap-1">
            <Input aria-label={text('Reply')} placeholder={text('Reply')} value={reply[t.uid] ?? ''} onChange={(e) => setReply({ ...reply, [t.uid]: e.target.value })} />
            <Button size="sm" disabled={busy || !(reply[t.uid] ?? '').trim()} onClick={() => void answer(t.uid, { text: reply[t.uid] })}>{text('Reply')}</Button>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(['accepted', 'rejected', 'completed'] as const).map((s) => <Button key={s} size="sm" disabled={busy} onClick={() => void answer(t.uid, { status: s })}>{text(s)}</Button>)}
          </div>
        </div>
      ))}
    </>
  );
}

function Forms({ fileId, onChanged }: { fileId: number; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [proposals, setProposals] = useState<Array<{ name: string; type: string; page: number; label: string; rect: [number, number, number, number] }> | null>(null);

  return (
    <>
      <Button size="sm" disabled={busy} onClick={() => void run(() => pro.formsDetect(fileId)).then((r) => r && setProposals(r.proposals))}>{text('Detect fields')}</Button>
      {proposals ? (
        <>
          <ul className="max-h-32 overflow-y-auto scroll-thin text-[11.5px]">{proposals.map((p) => <li key={p.name}>p.{p.page} {p.type}: {p.label || p.name}</li>)}</ul>
          {proposals.length ? <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => pro.formsAuthor(fileId, { add: proposals }), (r) => text('Saved as version {v}', { v: r.version })).then((r) => r && onChanged(r.version))}>{text('Add these fields')}</Button> : null}
        </>
      ) : null}
    </>
  );
}

function Access({ fileId, canFix, onChanged }: { fileId: number; canFix: boolean; onChanged: (v: number | null) => void }) {
  const [busy, run] = useRun();
  const [res, setRes] = useState<Awaited<ReturnType<typeof pro.a11yCheck>> | null>(null);
  const check = () => run(() => pro.a11yCheck(fileId)).then((r) => r && setRes(r));
  const fix = (body: Record<string, unknown>) => run(() => pro.a11yFix(fileId, body), (r) => text('Saved as version {v}', { v: r.version })).then((r) => { if (r) { onChanged(r.version); void check(); } });

  return (
    <>
      <Button size="sm" disabled={busy} onClick={() => void check()}>{text('Check')}</Button>
      {res ? (
        <>
          <Chip tone={res.passed ? 'success' : 'danger'}>{res.passed ? text('Passed') : text('{n} to fix', { n: res.failures })}</Chip>
          <ul className="max-h-40 overflow-y-auto scroll-thin text-[11.5px]">{res.issues.filter((i) => i.status !== 'pass').map((i, k) => <li key={k} className={cx(i.status === 'fail' ? 'text-danger' : 'text-warning')}>{i.page ? `p.${i.page} ` : ''}{i.message} — <span className="text-ink-3">{i.fix}</span></li>)}</ul>
        </>
      ) : null}
      {canFix ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => void fix({ autotag: true })}>{text('Auto-tag')}</Button>
          <Button size="sm" disabled={busy} onClick={() => void fix({ autofix: { lang: document.documentElement.lang || 'en' } })}>{text('Fix language, title and tab order')}</Button>
        </div>
      ) : null}
    </>
  );
}

function Ai({ fileId, page }: { fileId: number; page: number }) {
  const [busy, run] = useRun();
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('en');
  const [out, setOut] = useState<string | null>(null);
  const go = (op: string, body: Record<string, unknown> = {}) => run(() => pro.ai(fileId, op, { language: lang, ...body })).then((r) => r && setOut(r.answer ?? (r.suggestions ? r.suggestions.map((s) => `p.${s.page}: ${s.text}`).join('\n') : JSON.stringify(r.result ?? r, null, 2))));

  return (
    <>
      <select aria-label={text('Language')} className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option></select>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => void go('summarise')}>{text('Summarise')}</Button>
        <Button size="sm" disabled={busy} onClick={() => void go('summarise', { pages: [page + 1] })}>{text('This page')}</Button>
        <Button size="sm" disabled={busy} onClick={() => void go('extract', { kind: 'entities' })}>{text('Extract data')}</Button>
        <Button size="sm" disabled={busy} onClick={() => void go('redactions')}>{text('Suggest redactions')}</Button>
      </div>
      <div className="flex gap-1.5">
        <Input aria-label={text('Ask about this PDF')} placeholder={text('Ask about this PDF')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="primary" disabled={busy || !q.trim()} onClick={() => void go('ask', { question: q })}>{text('Ask')}</Button>
      </div>
      {out ? <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[8px] bg-subtle p-2 font-sans text-[12px] scroll-thin">{out}</pre> : null}
    </>
  );
}

function Batch({ fileId }: { fileId: number }) {
  const [busy, run] = useRun();
  const [actions, setActions] = useState<Array<{ id: number; name: string; version: number }>>([]);
  const [pick, setPick] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => { void run(() => pro.actions()).then((r) => { if (r) { setActions(r.actions); setPick(r.actions[0]?.id ?? 0); } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return actions.length ? (
    <>
      <select aria-label={text('Action')} className={inputCls} value={pick} onChange={(e) => setPick(Number(e.target.value))}>{actions.map((a) => <option key={a.id} value={a.id}>{a.name} (v{a.version})</option>)}</select>
      <Button size="sm" variant="primary" disabled={busy || !pick} onClick={() => void run(() => pro.runStart({ action_id: pick, file_ids: [fileId] })).then((r) => r && setStatus(text('Run #{id} queued', { id: r.id })))}>{text('Run on this PDF')}</Button>
      {status ? <p className="text-[11.5px] text-ink-2">{status}</p> : null}
    </>
  ) : <p className="text-ink-3">{text('No Actions yet. Build them in WorkSuite on the web (PDF Studio Pro › Batch).')}</p>;
}
