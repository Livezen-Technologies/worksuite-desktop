import { useMemo, useState } from 'react';
import { Select } from '../../components/Select';
import { Empty, Seg, Sheet, btnSmall, input } from './parts';
import type { Starter } from './types';

type Kind = 'all' | 'newsletter' | 'promotion' | 'starter';

function kindOf(s: Starter): Kind {
  if ((s.source ?? 'starter') === 'starter') return 'starter';

  return s.category === 'promotion' ? 'promotion' : 'newsletter';
}

/** Every word somewhere in the name, subject, preview text or subcategory. */
export function matchesTemplate(s: Starter, words: string): boolean {
  const hay = `${s.name} ${s.subject} ${s.preheader} ${s.subcategory_label ?? ''} ${s.category}`.toLowerCase();

  return words.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/**
 * The gallery templates start from: the three basic starters and the 100
 * system templates the server ships (50 newsletters, 50 promotional), with a
 * kind switch, a subcategory filter, a search and a preview. What is in it is
 * the server's; this only filters.
 */
export function TemplateGallery({ starters, onUse }: { starters: Starter[]; onUse?: (s: Starter) => void }) {
  const [kind, setKind] = useState<Kind>('all');
  const [sub, setSub] = useState('');
  const [words, setWords] = useState('');
  const [preview, setPreview] = useState<Starter | null>(null);
  const count = (k: Kind) => starters.filter((s) => k === 'all' || kindOf(s) === k).length;

  const subs = useMemo(() => {
    const seen = new Map<string, string>();
    starters.filter((s) => kind === 'all' || kindOf(s) === kind).forEach((s) => { if (s.subcategory) seen.set(s.subcategory, s.subcategory_label ?? s.subcategory); });

    return [{ value: '', label: 'Every subcategory' }, ...Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))];
  }, [starters, kind]);

  const shown = starters.filter((s) => (kind === 'all' || kindOf(s) === kind) && (sub === '' || s.subcategory === sub) && matchesTemplate(s, words));

  return (
    <section aria-labelledby="tpl-gallery">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="tpl-gallery" className="m-0 me-auto text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">Gallery</h2>
        <Seg label="Kind" value={kind} onChange={(v) => { setKind(v); setSub(''); }}
          options={[
            { id: 'all', label: `All ${count('all')}` }, { id: 'newsletter', label: `Newsletters ${count('newsletter')}` },
            { id: 'promotion', label: `Promotional ${count('promotion')}` }, { id: 'starter', label: `Basic ${count('starter')}` },
          ]} />
        <div className="w-[190px]"><Select aria-label="Subcategory" value={sub} onValueChange={setSub} options={subs} /></div>
        <input type="search" className={`${input} w-[220px]`} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
      </div>

      {shown.length === 0 ? <Empty text="No template matches. Try another word, or clear the filters." /> : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => (
            <li key={s.key} className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
              <div className="h-[5px]" style={{ background: s.accent ?? '#2563eb' }} aria-hidden="true" />
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <div className="flex items-start gap-2">
                  <p className="m-0 min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{s.name}</p>
                  <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-2">{s.subcategory_label ?? 'Starter'}</span>
                </div>
                <p className="m-0 truncate text-[12px] text-ink-3">{s.subject}</p>
                <div className="mt-auto flex gap-2 pt-1.5">
                  <button type="button" className={btnSmall} onClick={() => setPreview(s)}>Preview</button>
                  {onUse ? <button type="button" className={btnSmall} onClick={() => onUse(s)}>Make a template from it</button> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview ? (
        <Sheet title={preview.name} width={680} onClose={() => setPreview(null)}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSmall} onClick={() => setPreview(null)}>Close</button>
              {onUse ? <button type="button" className={btnSmall} onClick={() => { onUse(preview); setPreview(null); }}>Make a template from it</button> : null}
            </div>
          )}>
          {/* The email in a sandbox: nothing in it runs or reaches the app. Always on the email's own white page. */}
          <iframe title={`Preview of ${preview.name}`} sandbox="" className="h-[60vh] w-full rounded-[8px] border border-line bg-white"
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f4f6"><div style="max-width:600px;margin:16px auto;background:#fff;border-radius:8px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2937">${preview.body_html}</div></body></html>`} />
        </Sheet>
      ) : null}
    </section>
  );
}
