import { useState } from 'react';
import { Button, Spinner } from '../../components/ui';
import { call } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { errorText, when } from './api';
import { useOfflineCourses } from './offline';
import { Bar, Pill, useEl } from './parts';

/**
 * Courses kept on this computer (the download manager's offline copies):
 * what each holds, until when, and when WorkSuite last said it may stay.
 * Checking again removes what the server says ended.
 */
export default function Downloads() {
  const el = useEl();
  const { list, loading } = useOfflineCourses();
  const [busy, setBusy] = useState<number | 'check' | null>(null);
  const check = async () => {
    setBusy('check');
    try {
      const r = await call('elearning:offlineValidate');
      toast(
        'success',
        !r.asked
          ? 'WorkSuite could not be asked; only copies past their end date were removed.'
          : r.removed.length
            ? `${r.removed.length} course(s) removed: your learning in them ended.`
            : 'Every kept course may stay.',
      );
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (courseId: number) => {
    setBusy(courseId);
    try {
      await call('elearning:offlineRemove', { courseId });
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Kept offline" sub="Courses on this computer, encrypted and played only inside WorkSuite. Keep one from its page.">
        <Button icon="refresh" loading={busy === 'check'} disabled={!el.online || list.length === 0} onClick={() => void check()}>
          Check with WorkSuite
        </Button>
      </PageHead>
      {loading ? <Spinner /> : null}
      {!loading && list.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No course is kept on this computer. Open a course and choose Keep offline.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((c) => {
          const got = c.files.reduce((n, f) => n + (f.state === 'done' ? f.bytes : f.kept), 0);
          const done = c.files.filter((f) => f.state === 'done').length;
          return (
            <li key={c.courseId} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[14px] font-bold text-ink hover:text-primary" onClick={() => el.open.course(c.courseId)}>
                  {c.title}
                </button>
                <Pill tone={c.state === 'ready' ? 'green' : c.state === 'downloading' ? 'blue' : 'amber'}>{c.state === 'ready' ? 'Ready' : c.state === 'downloading' ? 'Downloading' : 'Incomplete'}</Pill>
                <Button size="sm" variant="ghost" icon="trash" loading={busy === c.courseId} onClick={() => void remove(c.courseId)}>
                  Remove
                </Button>
              </div>
              {c.state === 'downloading' ? <Bar value={c.totalBytes ? (got / c.totalBytes) * 100 : 0} label={`${c.title} download`} /> : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <span className="tabular-nums">
                  {done} of {c.files.length} files · {bytes(got)} of {bytes(c.totalBytes)}
                </span>
                <span>Kept {when(c.downloadedAt, true)}</span>
                {c.expiresAt ? <span>Until {when(c.expiresAt)}</span> : null}
                <span>{c.validatedAt ? `Checked ${when(c.validatedAt, true)}` : 'Not checked yet'}</span>
                {c.files.some((f) => f.protected) ? <span>Some lessons may not leave WorkSuite</span> : null}
              </div>
              {c.files.some((f) => f.state === 'failed') ? (
                <p className="m-0 text-[12px] text-warning">{c.files.find((f) => f.state === 'failed')?.error ?? 'Some files did not arrive.'} Open the course and choose Download again.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
