import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, TextField } from '../../components/ui';

/**
 * The addresses Mail suggests while you write (ENH-MAIL-03 DMO-PPL-03): kept
 * by WorkSuite, so every computer suggests the same; an entry can be removed,
 * and an Outlook autocomplete list saved as CSV can be brought in.
 */
export function AutocompleteSettings() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['mail', 'autocomplete', q],
    queryFn: async () => {
      try {
        return (await apiGet<{ suggestions: Array<{ email: string; name: string | null; uses: number; last_used_at: string | null }> }>('/api/mail/autocomplete', { q, limit: 50 })).suggestions;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
  const forget = async (email: string) => {
    try {
      await apiDelete('/api/mail/autocomplete', { email });
      void qc.invalidateQueries({ queryKey: ['mail', 'autocomplete'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const importCsv = async (file: File) => {
    try {
      const r = await apiPost<{ imported: number; skipped: number; message?: string }>('/api/mail/autocomplete/import', { csv: await file.text() });
      toast('success', text('{n} addresses imported, {skipped} skipped.', { n: r.imported, skipped: r.skipped }));
      void qc.invalidateQueries({ queryKey: ['mail', 'autocomplete'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (list.data === null) return null;
  return (
    <section aria-label={text('Suggested addresses')} className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-bold text-ink">{text('Suggested addresses')}</h2>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle">
          <Icon name="upload" size={14} />
          {text('Import from CSV')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importCsv(f);
            }}
          />
        </label>
      </div>
      <p className="mb-3 text-[13px] text-ink-3">{text('The people you write to are suggested as you type, on every computer. To bring your Outlook list, export it as CSV with a header row (Name, E-mail Address).')}</p>
      <div className="mb-2 w-[320px] max-w-full">
        <TextField label={text('Find')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={text('Name or address')} />
      </div>
      {list.isLoading ? <Spinner /> : null}
      {list.data && list.data.length === 0 ? <p className="text-[13px] text-ink-3">{text('No suggestions yet. They are added as you send mail.')}</p> : null}
      {list.data?.length ? (
        <ul role="list" className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {list.data.map((s) => (
            <li key={s.email} className="flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{s.name || s.email}</span>
                <span className="block truncate text-[12px] text-ink-3">{[s.name ? s.email : null, s.uses ? text('{n} sent', { n: s.uses }) : text('Imported'), s.last_used_at ? dateLabel(s.last_used_at) : null].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" aria-label={text('Remove {email} from suggestions', { email: s.email })} onClick={() => void forget(s.email)} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
