import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { createAndSend, fetchTemplate, fetchTemplates, hostStatus, K, newKey, preview, saveDraft, type LabelModel, type TemplateElement } from './api';
import type { ViewProps } from './LabelShell';
import { btn, btnPrimary, field, Section } from './parts';

/**
 * D02 — Designer (FR-DSK-01, FR-PRV-02): the same designer model as the web (`worksuite.label/1`), edited element by
 * element; the preview is the server's own rendering (`POST preview`, the renderer that prints), and Test print
 * sends one label to a printer on this computer with no dialog (`mode: test`). ⌘S saves the draft with its
 * `lock_version` (If-Match): when someone saved meanwhile the server answers STALE_VERSION and the designer says so.
 * New elements, publishing and approval are the web designer's (W05).
 */
export default function Designer({ to, active, template }: ViewProps & { template: string | null }) {
  const [q, setQ] = useState('');
  const id = template && /^\d+$/.test(template) ? Number(template) : null;
  const list = useQuery({ queryKey: K.templates(q, false), queryFn: ({ signal }) => fetchTemplates(q, false, signal), enabled: !id, staleTime: 30_000 });
  if (!id) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h1 className="m-0 text-[18px] font-extrabold text-ink">Designer</h1>
        <input className={field} placeholder="Find a template" aria-label="Find a template" value={q} onChange={(e) => setQ(e.target.value)} />
        <Section title="Templates">
          {list.isPending ? <Spinner /> : list.error ? <ErrorNote error={list.error} /> : (
            <ul className="m-0 list-none p-0">
              {list.data.map((t) => (
                <li key={t.id}>
                  <button type="button" className="flex w-full items-center gap-2 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] hover:bg-subtle" onClick={() => to('designer', `&template=${t.id}`)}>
                    <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                    <span className="text-[11px] text-ink-3">{t.status.toLowerCase()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    );
  }
  return <Editor id={id} active={active} />;
}

function Editor({ id, active }: { id: number; active: boolean }) {
  const qc = useQueryClient();
  const t = useQuery({ queryKey: K.template(id), queryFn: ({ signal }) => fetchTemplate(id, signal) });
  const host = useQuery({ queryKey: K.host, queryFn: hostStatus });
  // The person's edits; until the first one the model is the server's draft (or the published version).
  const [edit, setModel] = useState<LabelModel | null>(null);
  const base = t.data?.draft ?? t.data?.published ?? null;
  const model = edit ?? base?.model ?? null;
  const [sel, setSel] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [printer, setPrinter] = useState('');
  const dirty = !!edit && !!base && JSON.stringify(edit) !== JSON.stringify(base.model);

  // The server's preview, a moment after the last change.
  useEffect(() => {
    if (!model) return;
    const h = setTimeout(() => void preview(id, model).then(setImg, () => setImg(null)), 400);
    return () => clearTimeout(h);
  }, [id, model]);

  const save = useMutation({
    mutationFn: () => saveDraft(id, t.data?.draft?.lock_version ?? 0, edit!),
    onSuccess: (next) => {
      qc.setQueryData(K.template(id), next);
      setModel(null);
      toast('success', 'Draft saved.');
    },
    onError: (e) => toast('error', e instanceof ApiError && e.status === 409 ? 'Someone else saved this template meanwhile. Reload it to see their change, then make yours again.' : errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => createAndSend({ template_id: id, printer_id: Number(printer), mode: 'test', copies: 1, source_module: 'label' }, newKey()),
    onSuccess: (j) => toast(j.state === 'done' ? 'success' : j.state === 'failed' ? 'error' : 'info', j.state === 'done' ? 'Test label printed.' : (j.error ?? 'The test label is in the printer’s queue.')),
    onError: (e) => toast('error', errorMessage(e)),
  });

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dirty, save]);

  const printers = useMemo(() => (host.data?.printers ?? []).filter((p) => p.serverId && p.approved), [host.data]);
  if (t.isPending) return <Spinner />;
  if (t.error) return <ErrorNote error={t.error} onRetry={() => void t.refetch()} />;
  if (!model) return <p className="m-4 text-[12.5px] text-ink-3">This template has no version to edit.</p>;
  const el = model.elements.find((e) => e.id === sel) ?? null;
  const patch = (p: Partial<TemplateElement>) => setModel({ ...model, elements: model.elements.map((e) => (e.id === sel ? { ...e, ...p } : e)) });
  const num = (label: string, k: 'x_mm' | 'y_mm' | 'w_mm' | 'h_mm') => (
    <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">
      {label}
      <input type="number" step={0.1} className={field} disabled={el?.locked} value={(el?.[k] as number | undefined) ?? ''} onChange={(e) => patch({ [k]: e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 10) / 10 })} />
    </label>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <h1 className="m-0 min-w-0 flex-1 truncate text-[15px] font-extrabold text-ink">{`${t.data.name}${dirty ? ' ·' : ''}`}</h1>
        <select className={`${field} w-[220px]`} aria-label="Test printer" value={printer} onChange={(e) => setPrinter(e.target.value)}>
          <option value="">Test print to…</option>
          {printers.map((p) => <option key={p.key} value={p.serverId!}>{p.name}</option>)}
        </select>
        <button type="button" className={btn} disabled={!printer || test.isPending || dirty} title={dirty ? 'Save the draft first' : undefined} onClick={() => test.mutate()}>Test print</button>
        <button type="button" className={btnPrimary} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save draft ⌘S</button>
      </div>
      {t.data.validation?.length ? (
        <ul className="m-0 list-none border-b border-line bg-[#FFF4DB] px-4 py-1.5 text-[12px] text-[#8A5200]">
          {t.data.validation.slice(0, 3).map((v, i) => <li key={i}>{`${v.severity === 'error' ? 'Error' : 'Warning'}: ${v.message}`}</li>)}
        </ul>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-surface scroll-thin" aria-label="Elements">
          {model.elements.map((e) => (
            <button key={e.id} type="button" aria-pressed={e.id === sel} onClick={() => setSel(e.id)} className={`flex w-full items-center gap-2 border-b border-line/70 px-3 py-2 text-left text-[12px] ${e.id === sel ? 'bg-selection font-bold' : 'hover:bg-subtle'}`}>
              <span className="w-[60px] shrink-0 text-[10.5px] text-ink-3 uppercase">{e.type}</span>
              <span className="min-w-0 flex-1 truncate">{e.name ?? e.binding ?? e.id}</span>
            </button>
          ))}
        </aside>
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-ground p-6">
          {img ? <img src={img} alt="Label preview" className="max-h-full max-w-full border border-line bg-white shadow-sm" /> : <span className="text-[12.5px] text-ink-3">{`${model.size.width_mm} × ${model.size.height_mm} mm — the preview is the server’s rendering.`}</span>}
        </div>
        <aside className="flex w-[260px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin" aria-label="Properties">
          {el ? (
            <>
              <div className="text-[12px] font-bold text-ink">{`${el.type} · ${el.id}${el.locked ? ' · locked' : ''}`}</div>
              {typeof el.binding === 'string' ? (
                <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">
                  Text or binding
                  <input className={field} disabled={el.locked} value={el.binding} onChange={(e) => patch({ binding: e.target.value })} placeholder="{{product.name}}" />
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {num('X (mm)', 'x_mm')}
                {num('Y (mm)', 'y_mm')}
                {num('Width (mm)', 'w_mm')}
                {num('Height (mm)', 'h_mm')}
              </div>
              {el.font ? (
                <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">
                  Size (pt)
                  <input type="number" step={0.5} className={field} disabled={el.locked} value={el.font.size_pt ?? ''} onChange={(e) => patch({ font: { ...el.font, size_pt: Number(e.target.value) || undefined } })} />
                </label>
              ) : null}
              <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">
                Rotation
                <select className={field} disabled={el.locked} value={el.rotation ?? 0} onChange={(e) => patch({ rotation: Number(e.target.value) as 0 })}>
                  {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{`${r}°`}</option>)}
                </select>
              </label>
              <p className="m-0 text-[11px] text-ink-3">Symbologies, check digits and fonts are the server’s; new elements are added in the web designer.</p>
            </>
          ) : (
            <p className="m-0 text-[12px] text-ink-3">Choose an element to change it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
