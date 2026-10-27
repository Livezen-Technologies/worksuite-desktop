import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { humanise } from '../hr/parts';
import { fetchSettings, saveSettings, type SettingNode } from './api';
import { Kbd, NotYet, useReadOnly } from './parts';
import { SectionHeader, SettingRow, SettingsGroup, SettingsNavItem } from '../../components/SettingsKit';

/**
 * Payroll settings (D22): the server's settings tree (SRS §C3), grouped as it sends them, each with its control; a
 * fixed one is shown but not editable. "This computer" says what the desktop itself does. ⌘S saves.
 */
export default function Settings() {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll', 'settings'], queryFn: ({ signal }) => fetchSettings(signal) });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const tree = useMemo(() => q.data?.tree ?? [], [q.data]);
  const groups = [...new Set(tree.map((n) => n.group))];
  const [at, setAt] = useState<string | null>(null);
  const g = at ?? groups[0] ?? 'computer';
  const dirty = Object.keys(draft).length > 0;
  const save = useMutation({
    mutationFn: () => saveSettings(draft),
    onSuccess: () => (toast('success', 'Settings saved.'), setDraft({}), void qc.invalidateQueries({ queryKey: ['payroll', 'settings'] })),
    onError: (e) => toast('error', refusal(e)),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && dirty && !ro) {
        e.preventDefault();
        save.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, ro, save]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const value = (n: SettingNode) => (n.key in draft ? draft[n.key] : n.value ?? n.default);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        level={1}
        title="Payroll settings"
        actions={<button type="button" disabled={!dirty || ro || save.isPending} onClick={() => save.mutate()} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">Save <Kbd>⌘S</Kbd></button>}
      />
      <div className="flex gap-3">
        <nav aria-label="Settings" className="flex w-[180px] shrink-0 flex-col gap-0.5">
          {[...groups, 'computer'].map((x) => (
            <SettingsNavItem key={x} label={x === 'computer' ? 'This computer' : humanise(x)} current={x === g} onClick={() => setAt(x)} />
          ))}
        </nav>
        <SettingsGroup className="!mb-0 min-w-0 flex-1" title={g === 'computer' ? 'This computer' : humanise(g)}>
          {g === 'computer' ? (
            <>
              <Line title="Runs available offline" sub="The runs and payslip figures you opened, read-only, encrypted on this computer. Cleared when you sign out." value="On" />
              <Line title="Touch ID to approve" sub="Where this computer has it, approving a run asks for it first." value="On" />
              <Line title="Bank and return files" sub="Saved where you choose; every file the server makes is logged." value="Ask each time" />
              <Line title="Tray reminders" sub="Cut-off, approvals waiting and pay dates — even when the Payroll tab is closed." value="On" />
            </>
          ) : q.data === null ? <NotYet what="Payroll settings" /> : (
            <>
              {tree.filter((n) => n.group === g).map((n) => (
                <SettingRow key={n.key} label={n.label} hint={n.fixed ? 'Set by your company' : undefined}>
                  {n.type === 'bool' ? (
                    <Checkbox aria-label={n.label} disabled={ro || n.fixed} checked={!!value(n)} onChange={(e) => set(n.key, e.target.checked)} />
                  ) : n.type === 'enum' && n.options ? (
                    <Select aria-label={n.label} disabled={ro || n.fixed} value={String(value(n) ?? '')} onChange={(e) => set(n.key, e.target.value)} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink">
                      {n.options.map((o) => <option key={o} value={o}>{humanise(o)}</option>)}
                    </Select>
                  ) : (
                    <input aria-label={n.label} disabled={ro || n.fixed} value={String(value(n) ?? '')} onChange={(e) => set(n.key, n.type === 'int' ? Number(e.target.value) : e.target.value)} className="h-8 w-[180px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
                  )}
                </SettingRow>
              ))}
            </>
          )}
        </SettingsGroup>
      </div>
    </div>
  );
}

function Line({ title, sub, value }: { title: string; sub: string; value: string }) {
  return (
    <SettingRow label={title} hint={sub}>
      <span className="text-[12.5px] font-semibold text-ink-2">{value}</span>
    </SettingRow>
  );
}
