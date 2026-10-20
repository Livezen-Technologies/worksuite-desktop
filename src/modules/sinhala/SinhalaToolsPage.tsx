import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { SinhalaDirection, SinhalaJob, SinhalaLocalFile } from '@shared/sinhala';
import { call, errorMessage, hasDesktop } from '../../core/bridge';
import { SINHALA_KEY, useSinhalaProfiles, useSinhalaStatus } from '../../core/sinhala';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Button, Chip, Empty, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';

/**
 * Sinhala Tools (WorkSuite Desktop Sinhala Tools blueprint §6.1 Converter app, WF-SI-03, WF-SI-04): paste or drop
 * text and see it in Unicode as you go; drop Word documents to convert them on this computer — online Drive files go
 * to the server's job (§6.3). The engine runs in the main process and its worker; this screen only asks.
 */

type Registered = { files: SinhalaLocalFile[]; rejected: Array<{ name: string; reason: string }> };

async function registerDocs(files: File[]): Promise<Registered> {
  const bridge = window.worksuite?.sinhala as { registerDropped?: (f: File[]) => Promise<unknown> } | undefined;
  if (!bridge?.registerDropped) return { files: [], rejected: [] };
  const res = (await bridge.registerDropped(files)) as Registered | { __wsError: true; message: string };
  if ('__wsError' in res) throw new Error(res.message);
  return res;
}

export default function SinhalaToolsPage(_props: ModuleProps) {
  useTabTitle('Sinhala Tools');
  const { query } = useTab();
  const status = useSinhalaStatus();
  const profiles = useSinhalaProfiles(status.data?.availability === 'ok');
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState('auto');
  const [direction, setDirection] = useState<SinhalaDirection>('toUnicode');
  const [jobs, setJobs] = useState<SinhalaJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const askedFile = useRef<string | null>(null);

  const st = status.data;
  const allowReverse = st?.org.allowReverse ?? true;

  // Converted as it is typed or pasted (the engine takes well under a millisecond a kilobyte).
  const text = useDeferredValue(input);
  const converted = useQuery({
    queryKey: [...SINHALA_KEY, 'convert', text, profile, direction],
    queryFn: () => call('sinhala:convert', { text, profile, direction }),
    enabled: st?.availability === 'ok' && text.trim() !== '',
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  });
  const result = input.trim() ? (converted.data ?? null) : null;
  const problem = input.trim() && converted.error ? errorMessage(converted.error) : null;

  // Jobs still running are asked about once a second.
  useEffect(() => {
    if (!jobs.some((j) => j.state === 'queued' || j.state === 'running' || j.state === 'waiting_upload')) return;
    const t = setInterval(() => {
      void Promise.all(jobs.map((j) => call('sinhala:job', { jobId: j.id }).catch(() => j))).then(setJobs);
    }, 1000);
    return () => clearInterval(t);
  }, [jobs]);

  const start = async (source: { kind: 'drive'; fileId: number; name?: string } | { kind: 'local'; handle: string }) => {
    try {
      const { jobId } = await call('sinhala:convertFile', { source, profile });
      const job = await call('sinhala:job', { jobId });
      setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // `/sinhala-tools?file=<id>&name=…`: a Drive file sent here to be converted.
  useEffect(() => {
    const id = Number(query.get('file'));
    const key = query.toString();
    if (!Number.isSafeInteger(id) || id <= 0 || st?.availability !== 'ok' || askedFile.current === key) return;
    askedFile.current = key;
    void start({ kind: 'drive', fileId: id, name: query.get('name') ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, st?.availability]);

  const profileOptions = useMemo(
    () => [{ value: 'auto', label: 'Detect automatically' }, ...(profiles.data?.profiles ?? []).map((p) => ({ value: p.id, label: `${p.name} ${p.version}` }))],
    [profiles.data],
  );

  if (!hasDesktop()) return <Empty icon="languages" title="Sinhala Tools need WorkSuite Desktop" />;
  if (status.isLoading) return <Spinner />;
  if (!st || st.availability !== 'ok') {
    return <Empty icon="languages" title="Sinhala Tools are not available" hint="Your organization has not turned Sinhala Tools on, or this WorkSuite server does not offer them yet." />;
  }

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const texts = files.filter((f) => /\.txt$/i.test(f.name) || f.type.startsWith('text/'));
    const docs = files.filter((f) => /\.docx$/i.test(f.name));
    if (texts[0]) setInput((await texts[0].text()).slice(0, 500_000));
    if (!docs.length) {
      if (!texts.length && files.length) toast('info', 'Drop text, or Word documents (.docx).');
      return;
    }
    try {
      const reg = await registerDocs(docs);
      for (const r of reg.rejected) toast('error', r.reason);
      for (const f of reg.files) await start({ kind: 'local', handle: f.handle });
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const pick = async () => {
    try {
      const files = await call('sinhala:pickFile');
      for (const f of files) await start({ kind: 'local', handle: f.handle });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    toast('success', 'Copied.');
  };

  const save = async () => {
    if (!result) return;
    if (result.text.length > 64_000) {
      toast('error', 'This text is too long to save as a file here. Copy it instead.');
      return;
    }
    try {
      const at = await call('files:saveText', { name: 'Sinhala Unicode.txt', text: result.text });
      if (at) toast('success', 'Saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const convertClipboard = async () => {
    try {
      await call('sinhala:clipboard', { profile });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div
      className={cx('flex h-full flex-col', dragging && 'ring-2 ring-primary ring-inset')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <h1 className="text-[20px] font-bold text-ink">Sinhala Tools</h1>
        {st.offline ? <Chip tone="warning">Offline: using the profiles kept on this computer</Chip> : null}
        <div className="flex-1" />
        <div className="w-[230px]">
          <Select aria-label="Font profile" value={profile} options={profileOptions} onValueChange={(v) => setProfile(v)} />
        </div>
        {allowReverse ? (
          <div className="w-[190px]">
            <Select aria-label="Direction" value={direction} options={[{ value: 'toUnicode', label: 'Legacy to Unicode' }, { value: 'toLegacy', label: 'Unicode to legacy' }]} onValueChange={(v) => setDirection(v as SinhalaDirection)} />
          </div>
        ) : null}
        <Button size="sm" icon="clipboard-paste" onClick={() => void convertClipboard()} title="Convert what is on the clipboard and put it back">
          Convert clipboard
        </Button>
        <Button size="sm" icon="file-text" onClick={() => void pick()}>
          Convert a document…
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 scroll-thin lg:grid-cols-2">
        <section className="flex min-h-[220px] flex-col">
          <label htmlFor="sinhala-input" className="mb-1.5 text-[12.5px] font-semibold text-ink-2">
            Text to convert
          </label>
          <textarea
            id="sinhala-input"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500_000))}
            placeholder="Paste legacy Sinhala text (FM Abhaya, DL Manel, Kaputa…), or drop a text file or Word documents here"
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-[8px] border border-line bg-ground p-3 text-[14px] text-ink outline-none focus:border-primary"
          />
        </section>
        <section className="flex min-h-[220px] flex-col">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-ink-2">Preview</span>
            {result ? (
              <span className="text-[12px] text-ink-3">
                {result.profile} {result.profileVersion}
              </span>
            ) : null}
            <div className="flex-1" />
            <Button size="sm" icon="copy" disabled={!result} onClick={() => void copy()}>
              Copy
            </Button>
            <Button size="sm" icon="download" disabled={!result} onClick={() => void save()}>
              Save…
            </Button>
          </div>
          <div lang="si" className="min-h-0 flex-1 overflow-y-auto rounded-[8px] border border-line bg-surface p-3 text-[15px] whitespace-pre-wrap text-ink scroll-thin" style={{ fontFamily: '"Noto Sans Sinhala", var(--ws-font)' }} aria-live="polite">
            {problem ? <span className="text-danger">{problem}</span> : (result?.text ?? '')}
          </div>
          {result && result.unmapped.length ? (
            <div className="mt-2 rounded-[8px] border border-warning/40 bg-warning/10 p-2 text-[12.5px] text-ink-2">
              <div className="font-semibold">Left as they were — the profile has no mapping for them:</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {result.unmapped.slice(0, 40).map((u) => (
                  <code key={`${u.offset}-${u.codePoint}`} className="rounded bg-subtle px-1.5 py-0.5 text-[12px]">
                    {u.text} {u.codePoint} @{u.offset}
                  </code>
                ))}
                {result.unmapped.length > 40 ? <span>…</span> : null}
              </div>
            </div>
          ) : null}
        </section>

        {jobs.length ? (
          <section className="lg:col-span-2">
            <h2 className="mb-2 text-[14px] font-bold text-ink">Documents</h2>
            <div className="flex flex-col gap-2">
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} onChange={(next) => setJobs((list) => list.map((x) => (x.id === next.id ? next : x)))} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const STATE_LABEL: Record<SinhalaJob['state'], string> = {
  queued: 'Waiting',
  running: 'Converting…',
  preview: 'Check the preview, then save it as a new version',
  done: 'Converted',
  rejected: 'Not saved — the document is unchanged',
  no_change: 'No legacy Sinhala text was found',
  failed: 'Failed',
  waiting_upload: 'Converted — uploads as a new version when you are online',
  uploaded: 'Converted and uploaded as a new version',
  conflict: 'The file changed meanwhile — the converted copy was uploaded beside it',
};

function JobRow({ job, onChange }: { job: SinhalaJob; onChange: (j: SinhalaJob) => void }) {
  const [busy, setBusy] = useState(false);
  const tone = job.state === 'failed' ? 'danger' : job.state === 'conflict' || job.state === 'preview' ? 'warning' : job.state === 'queued' || job.state === 'running' || job.state === 'rejected' || job.state === 'no_change' ? 'muted' : 'success';
  // Nothing is saved until Accept (WF-SI-02 step 4); the server refuses with 409 when the file changed meanwhile.
  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      onChange(await call(accept ? 'sinhala:jobAccept' : 'sinhala:jobReject', { jobId: job.id }));
      if (accept) toast('success', 'Saved as a new version. The previous version can still be restored.');
    } catch (e) {
      toast('error', errorMessage(e));
      onChange(await call('sinhala:job', { jobId: job.id }).catch(() => job));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-[8px] border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{job.name}</span>
        <Chip tone={tone}>{STATE_LABEL[job.state]}</Chip>
        {job.where === 'local' && job.outputName && (job.state === 'done' || job.state === 'waiting_upload' || job.state === 'uploaded' || job.state === 'conflict') ? (
          <Button size="sm" icon="folder-open" onClick={() => void call('sinhala:reveal', { jobId: job.id })}>
            Show in folder
          </Button>
        ) : null}
      </div>
      <div className="mt-1 text-[12.5px] text-ink-3">
        {job.outputName ? <span className="mr-3">{job.outputName}</span> : null}
        {job.runsTotal ? (
          <span className="mr-3">
            {job.runsConverted} / {job.runsTotal} runs
          </span>
        ) : null}
        {job.unmappedCount ? <span className="mr-3 text-warning">{job.unmappedCount} unmapped</span> : null}
        {job.profileVersion ? (
          <span>
            {job.profile} {job.profileVersion}
          </span>
        ) : null}
      </div>
      {job.error ? <div className="mt-1 text-[12.5px] text-danger">{job.error}</div> : null}
      {job.canAccept && job.state === 'preview' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {job.paragraphsChanged !== null ? <span className="text-[12.5px] text-ink-2">{job.paragraphsChanged} paragraphs change.</span> : null}
          <div className="flex-1" />
          <Button size="sm" disabled={busy} onClick={() => void decide(false)}>
            Discard
          </Button>
          <Button size="sm" variant="primary" loading={busy} onClick={() => void decide(true)}>
            Save as new version
          </Button>
        </div>
      ) : null}
      {job.unmapped.length ? (
        <div className="mt-1 text-[12px] text-ink-3">
          {job.unmapped.slice(0, 12).map((u) => (
            <code key={`${u.sequence}-${u.codePoint}`} className="mr-1.5 rounded bg-subtle px-1 py-0.5">
              {u.sequence} {u.codePoint} ×{u.count}
            </code>
          ))}
        </div>
      ) : null}
      {job.preview.length ? (
        <details className="mt-2 text-[12.5px]" open={job.state === 'preview'}>
          <summary className="cursor-pointer text-ink-2">Preview of the changes</summary>
          <table className="mt-1 w-full">
            <tbody>
              {job.preview.map((p, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="w-1/2 py-1 pr-2 font-mono text-ink-3">{p.before}</td>
                  <td lang="si" className="w-1/2 py-1 text-ink" style={{ fontFamily: '"Noto Sans Sinhala", var(--ws-font)' }}>
                    {p.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}
