import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Spinner, cx } from '../../components/ui';
import { fetchAsset, fetchAssets, type Asset } from './api';
import { code128Svg, labelPrefs, printLabels, qrSvg, saveLabelPrefs, saveLabelsPdf, type LabelCode, type LabelPrefs, type LabelStock } from './labels';
import { Btn, Card, Field, PageHead, Pills, input } from './parts';

/**
 * Label printing (D22, T-11): the labels for the assets named (`?ids=` — after an import, or a selection), or picked
 * here; the printer, roll or sheet and the code (QR, Code 128 or both), kept for this computer; Print and Save PDF.
 */
export default function Labels({ ids }: { ids: number[] }) {
  const [prefs, setPrefs] = useState<LabelPrefs>(labelPrefs);
  const [extra, setExtra] = useState<Asset[]>([]);
  const [q, setQ] = useState('');
  const named = useQueries({ queries: ids.slice(0, 200).map((id) => ({ queryKey: ['assets', 'one', id], queryFn: ({ signal }: { signal: AbortSignal }) => fetchAsset(id, signal), staleTime: 60_000 })) });
  const printers = useQuery({ queryKey: ['assets', 'printers'], queryFn: () => call('print:printers'), staleTime: 60_000 });
  const search = useQuery({ queryKey: ['assets', 'list', 'labels', q], queryFn: ({ signal }) => fetchAssets({ q, per_page: 10 }, signal), enabled: q.trim().length > 1 });
  const items = [...named.flatMap((r) => (r.data ? [{ code: r.data.asset.asset_code, name: r.data.asset.name, company: r.data.asset.company }] : [])), ...extra.map((a) => ({ code: a.asset_code, name: a.name, company: a.company }))];
  const set = (p: Partial<LabelPrefs>) => {
    const n = { ...prefs, ...p };
    setPrefs(n);
    saveLabelPrefs(n);
  };
  const print = async () => {
    if (await printLabels(items, prefs)) toast('success', `${items.length} ${items.length === 1 ? 'label' : 'labels'} sent to the printer.`);
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
        <PageHead title="Print labels" sub={`${items.length} ${items.length === 1 ? 'label' : 'labels'}`}>
          <Btn disabled={!items.length} onClick={() => void saveLabelsPdf(items, prefs)}>Save PDF</Btn>
          <Btn primary disabled={!items.length} onClick={() => void print()}>{`Print ${items.length}`}</Btn>
        </PageHead>
        <Field label="Add an asset">
          <input className={input} value={q} placeholder="Code or name" onChange={(e) => setQ(e.target.value)} />
        </Field>
        {search.data?.assets.length ? (
          <div className="flex flex-wrap gap-1.5">
            {search.data.assets.map((a) => (
              <Btn key={a.id} onClick={() => (setExtra((x) => (x.some((y) => y.id === a.id) ? x : [...x, a])), setQ(''))}>{`+ ${a.asset_code} ${a.name}`}</Btn>
            ))}
          </div>
        ) : null}
        {named.some((r) => r.isPending) ? <Spinner /> : null}
        <div className="flex flex-wrap gap-3">
          {items.slice(0, 30).map((i, n) => (
            <div key={n} className="flex h-[96px] w-[220px] items-center gap-2 rounded-[6px] border border-line bg-white p-2 text-black">
              {prefs.code !== 'code128' ? <span className="shrink-0" dangerouslySetInnerHTML={{ __html: qrSvg(i.code, 18) }} /> : null}
              <div className="flex min-w-0 flex-col text-[10px] leading-tight">
                {i.company ? <span className="text-[8px]">{`Property of ${i.company}`}</span> : null}
                <b className="font-mono text-[12px]">{i.code}</b>
                <span className="truncate">{i.name}</span>
                {prefs.code !== 'qr' ? <span dangerouslySetInnerHTML={{ __html: code128Svg(i.code, 30, 5) }} /> : null}
              </div>
            </div>
          ))}
          {items.length > 30 ? <div className="self-center text-[12px] text-ink-3">{`+ ${items.length - 30} more`}</div> : null}
        </div>
      </div>
      <aside aria-label="Printer" className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <Card title="Printer" className="border-0">
          <div className="flex flex-col gap-1.5 px-0.5">
            {[{ name: '', displayName: 'The default printer' }, ...(printers.data ?? [])].map((p) => (
              <label key={p.name} className={cx('flex cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-2 text-[12.5px]', (prefs.printer ?? '') === p.name ? 'border-primary' : 'border-line')}>
                <input type="radio" name="printer" checked={(prefs.printer ?? '') === p.name} onChange={() => set({ printer: p.name || null })} />
                {p.displayName}
              </label>
            ))}
          </div>
        </Card>
        <Field label="Labels">
          <select className={input} value={prefs.stock} onChange={(e) => set({ stock: e.target.value as LabelStock })}>
            <option value="roll62">62 mm roll</option>
            <option value="thermal1in">1 in thermal label</option>
            <option value="a4">A4 sheet, 3 × 8</option>
          </select>
        </Field>
        <Pills<LabelCode> label="Code" value={prefs.code} onChange={(code) => set({ code })} options={[{ id: 'qr', label: 'QR' }, { id: 'code128', label: 'Code 128' }, { id: 'both', label: 'Both' }]} />
      </aside>
    </div>
  );
}
