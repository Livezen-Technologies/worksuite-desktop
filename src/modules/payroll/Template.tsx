import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { fetchTemplate, saveTemplate, type Template as T } from './api';
import { Card, Kbd, NotYet, Pills, useReadOnly } from './parts';

/**
 * The payslip template (D09): language, what the payslip shows and its footer. The PDF is the server's
 * (`PayslipDocument`); this only sets its options. ⌘S saves.
 */
const LANGS: Array<{ id: T['language']; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'si', label: 'සිංහල' },
  { id: 'ta', label: 'தமிழ்' },
  { id: 'ar', label: 'العربية' },
];

export default function Template({ onBack }: { onBack: () => void }) {
  const ro = useReadOnly();
  const q = useQuery({ queryKey: ['payroll', 'template'], queryFn: ({ signal }) => fetchTemplate(signal) });
  const [edit, setT] = useState<T | null>(null);
  const t = edit ?? q.data ?? null;
  const save = useMutation({ mutationFn: () => saveTemplate(t!), onSuccess: () => toast('success', 'Template saved.'), onError: (e) => toast('error', refusal(e)) });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && t && !ro) {
        e.preventDefault();
        save.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t, ro, save]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const set = <K extends keyof T>(k: K, v: T[K]) => setT(t ? { ...t, [k]: v } : null);
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="self-start text-[12px] font-semibold text-primary hover:underline">← Payslips</button>
      <div className="flex items-end gap-2">
        <h1 className="m-0 flex-1 text-[21px] font-extrabold text-ink">Payslip template</h1>
        <button type="button" disabled={!t || ro || save.isPending} onClick={() => save.mutate()} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">Save <Kbd>⌘S</Kbd></button>
      </div>
      {q.data === null || !t ? <Card><NotYet what="The payslip template" /></Card> : (
        <Card>
          <div className="flex flex-col gap-3 px-3.5 py-3 text-[12.5px]">
            <div className="flex items-center gap-3"><span className="w-[160px] font-semibold text-ink-2">Language</span><Pills label="Language" value={t.language} onChange={(v) => set('language', v)} options={LANGS} /></div>
            <label className="flex items-center gap-2 text-ink"><Checkbox checked={t.logo} disabled={ro} onChange={(e) => set('logo', e.target.checked)} />Company logo</label>
            <label className="flex items-center gap-2 text-ink"><Checkbox checked={t.show_employer_contributions} disabled={ro} onChange={(e) => set('show_employer_contributions', e.target.checked)} />Employer contributions</label>
            <label className="flex items-center gap-2 text-ink"><Checkbox checked={t.show_ytd} disabled={ro} onChange={(e) => set('show_ytd', e.target.checked)} />Year-to-date totals</label>
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              Footer
              <textarea rows={2} value={t.footer} disabled={ro} onChange={(e) => set('footer', e.target.value)} className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
            </label>
          </div>
        </Card>
      )}
    </div>
  );
}
