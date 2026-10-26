import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, input } from '../hr/parts';
import { costingLabel, kindLabel, num, pictureSrc, PICTURE_MAX, PICTURE_TYPES, qty, shrinkPicture, trackingLabel, whole } from './api';
import { Pill } from './parts';
import {
  altMissing,
  bulkVariants,
  CHANNEL_STATE,
  channelAct,
  channelActions,
  DOC_TYPE,
  draftSeo,
  fetch360,
  fetchChannels,
  fetchDocuments,
  fetchMatrix,
  fetchMedia,
  fetchSeo,
  fetchSpecs,
  fetchVariants,
  fixTab,
  gaps,
  generateVariants,
  isHeic,
  K2,
  moved,
  notOnServer,
  orderMedia,
  patchMedia,
  removeMedia,
  ROLES,
  saveSeo,
  saveSpecs,
  scoreTone,
  SECTION_LABEL,
  seoLength,
  setChannel,
  slugify,
  specChanges,
  specErrors,
  specText,
  TABS360,
  uploadMedia,
  VISIBILITY,
  type Media,
  type P360,
  type Section,
  type Seo,
  type Specs,
  type Tab360,
} from './v2';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * Product 360 on the desktop (the "Desktop Product 360" design; the V2 product master): one product in full — what
 * it is, its pictures, variants, specifications, documents, where it is sold and how it reads to a search engine.
 * Read-heavy; the edits are the ones a desk does well: pictures dropped from Finder or Explorer (HEIC turned into
 * JPEG, large photos reduced, the files kept in WorkSuite Files), alt text, roles and order; specification values and
 * SEO fields (Save, ⌘/Ctrl+S); publishing to a channel; generating the variants that are missing.
 */
const TONE_BAR = { green: 'bg-[#16a34a]', amber: 'bg-[#d97706]', red: 'bg-danger' } as const;

export default function Product360({
  id,
  tab,
  currency,
  canCatalogue,
  onTab,
  onBack,
  onEdit,
}: {
  id: number;
  tab: Tab360;
  currency: string | null;
  canCatalogue: boolean;
  onTab: (t: Tab360) => void;
  onBack: () => void;
  onEdit: (() => void) | null;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.p360(id), queryFn: ({ signal }) => fetch360(id, signal) });
  const [specTyped, setSpecTyped] = useState<Record<string, string>>({});
  const [seoTyped, setSeoTyped] = useState<Partial<Record<'slug' | 'meta_title' | 'meta_description' | 'canonical' | 'robots', string>>>({});
  const [lang, setLang] = useState('en');
  const [specErr, setSpecErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const specs = useQuery({ queryKey: K2.specs(id), queryFn: ({ signal }) => fetchSpecs(id, signal), enabled: tab === 'specs' || Object.keys(specTyped).length > 0 });
  const d = q.data;
  const p = d?.product;
  const specDirty = Object.keys(specChanges(specs.data, specTyped)).length > 0;
  const seoDirty = Object.keys(seoTyped).length > 0;
  const dirty = specDirty || seoDirty;

  const save = async () => {
    if (!dirty || saving || !canCatalogue) return;
    setSaving(true);
    try {
      if (specDirty) {
        setSpecErr({});
        try {
          await saveSpecs(id, specChanges(specs.data, specTyped));
          setSpecTyped({});
        } catch (e) {
          const f = specErrors(e);
          if (Object.keys(f).length) {
            setSpecErr(f);
            onTab('specs');
            throw new Error('Some specifications need correcting.');
          }
          throw e;
        }
      }
      if (seoDirty) {
        await saveSeo(id, { lang, ...seoTyped });
        setSeoTyped({});
      }
      toast('success', 'Saved');
      void qc.invalidateQueries({ queryKey: K2.p360(id) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error)
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        <button type="button" className={btnSmall + ' self-start'} onClick={onBack}>
          ← Back
        </button>
        {notOnServer(q.error) ? (
          <Empty text="Product 360 needs the V2 product master on your WorkSuite server, and a product in one of your companies." />
        ) : (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        )}
      </div>
    );
  if (!d || !p) return null;
  const variants = d.counts.variants;
  const thumb = p.image_url ?? p.images?.[0]?.url ?? null;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface px-6 pt-4">
        <div className="flex items-center gap-3">
          <button type="button" className={btnSmall} onClick={onBack} aria-label="Back to products">
            ←
          </button>
          <span className="grid size-[44px] shrink-0 place-items-center overflow-hidden rounded-[10px] border border-line bg-subtle">{thumb ? <img src={pictureSrc(thumb)} alt="" className="size-full object-cover" /> : null}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[17px] text-ink">{p.name}</b>
            <span className="truncate text-[12.5px] text-ink-3">{[p.code, kindLabel(p.kind), variants ? `${variants} ${variants === 1 ? 'variant' : 'variants'}` : null, `completeness ${Math.round(d.completeness.total)}%`].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className={btn} onClick={() => void call('app:openInBrowser', { path: `/inventory?view=product360&id=${id}` })}>
            Open in browser
          </button>
          {canCatalogue ? (
            <button type="button" className={btnPrimary} disabled={!dirty || saving} title="Save (⌘/Ctrl+S)" onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </div>
        <div role="tablist" aria-label="Product 360" className="flex gap-1 overflow-x-auto">
          {TABS360.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={cx('-mb-px shrink-0 border-b-2 px-3 py-2 text-[13.5px] font-semibold', tab === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}
            >
              {t.label}
              {(t.id === 'specs' && specDirty) || (t.id === 'seo' && seoDirty) ? <span className="ml-1 text-primary">•</span> : null}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ground px-6 py-5 scroll-thin">
        {tab === 'overview' ? <Overview d={d} currency={currency} onTab={onTab} /> : null}
        {tab === 'general' ? <General d={d} currency={currency} onEdit={onEdit} /> : null}
        {tab === 'media' ? <MediaTab id={id} canEdit={canCatalogue} /> : null}
        {tab === 'variants' ? <Variants id={id} canEdit={canCatalogue} currency={currency} /> : null}
        {tab === 'specs' ? <SpecsTab specs={specs} typed={specTyped} errors={specErr} canEdit={canCatalogue} onType={(k, v) => setSpecTyped({ ...specTyped, [k]: v })} /> : null}
        {tab === 'documents' ? <Documents id={id} /> : null}
        {tab === 'channels' ? <Channels id={id} canEdit={canCatalogue} onTab={onTab} /> : null}
        {tab === 'seo' ? <SeoTab id={id} lang={lang} onLang={(l) => (seoDirty ? toast('warning', 'Save or undo the changes in this language first.') : setLang(l))} typed={seoTyped} canEdit={canCatalogue} onType={(patch) => setSeoTyped({ ...seoTyped, ...patch })} onUndo={() => setSeoTyped({})} /> : null}
      </div>
    </div>
  );
}

function Card({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4', className)}>
      <div className="flex items-center gap-2">
        <b className="flex-1 text-[14px] text-ink">{title}</b>
        {action}
      </div>
      {children}
    </section>
  );
}

function Bar({ value, tone }: { value: number; tone: 'green' | 'amber' | 'red' }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-subtle">
      <span className={cx('block h-full', TONE_BAR[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function Overview({ d, currency, onTab }: { d: P360; currency: string | null; onTab: (t: Tab360) => void }) {
  const c = d.completeness;
  const todo = gaps(c);
  const sectionTab: Record<Section, Tab360> = { general: 'general', images: 'media', description: 'general', specifications: 'specs', documents: 'documents', seo: 'seo' };
  const cur = d.pricing.currency ?? currency;
  return (
    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
      <Card title="Completeness" action={<b className="text-[20px] text-ink tabular-nums">{Math.round(c.total)}%</b>}>
        <Bar value={c.total} tone={scoreTone(c.total)} />
        {(Object.keys(SECTION_LABEL) as Section[]).map((k) =>
          c.sections[k] === undefined ? null : (
            <button key={k} type="button" onClick={() => onTab(sectionTab[k])} className="flex items-center gap-2 text-left text-[12.5px] hover:underline">
              <span className="w-[110px] text-ink-2">{SECTION_LABEL[k]}</span>
              <Bar value={c.sections[k]!} tone={scoreTone(c.sections[k]!)} />
              <span className="w-[40px] text-right text-ink tabular-nums">{Math.round(c.sections[k]!)}%</span>
            </button>
          ),
        )}
        {todo.length ? <span className="text-[12px] text-ink-3">Next: {todo.slice(0, 2).map((g) => g.label.toLowerCase()).join(', then ')}.</span> : <span className="text-[12px] text-ink-3">Everything is filled in.</span>}
      </Card>
      <Card title="Stock and reach">
        <StatGrid min={120}>
          {(
            [
              ['On hand', qty(d.counts.on_hand), 'boxes', 'blue'],
              ['Incoming', qty(d.counts.incoming), 'truck', 'cyan'],
              ['Variants', String(d.counts.variants), 'layers', 'violet'],
              ['Suppliers', String(d.counts.suppliers), 'factory', 'amber'],
              ['Channels', String(d.counts.channels), 'store', 'green'],
            ] as Array<[string, string, string, StatTone]>
          ).map(([l, v, icon, tone]) => (
            <StatCard key={l} size="sm" label={l} value={v} icon={icon} tone={tone} />
          ))}
        </StatGrid>
      </Card>
      <Card title="Pricing">
        <span className="flex items-baseline justify-between text-[13px]">
          <span className="text-ink-2">Standard price</span>
          <b className="text-[18px] text-ink tabular-nums">{whole(d.pricing.standard, cur)}</b>
        </span>
        {d.pricing.lists.map((l) => (
          <span key={l.name} className="flex justify-between text-[12.5px]">
            <span className="text-ink-2">
              {l.name}
              {num(l.min_qty) ? ` · from ${qty(l.min_qty)}` : ''}
            </span>
            <span className="text-ink tabular-nums">{whole(l.price, cur)}</span>
          </span>
        ))}
        <span className="flex justify-between text-[12.5px]">
          <span className="text-ink-2">Average cost</span>
          <span className="text-ink tabular-nums">{d.pricing.average_cost === null ? '—' : whole(d.pricing.average_cost, cur)}</span>
        </span>
        {d.pricing.last_change ? (
          <span className="text-[12px] text-ink-3">
            Last changed {relative(d.pricing.last_change.at)}
            {d.pricing.last_change.by ? ` by ${d.pricing.last_change.by}` : ''}
            {d.pricing.last_change.from && d.pricing.last_change.to ? ` · ${whole(d.pricing.last_change.from)} → ${whole(d.pricing.last_change.to)}` : ''}
          </span>
        ) : null}
      </Card>
      <Card title="Channels" action={<HeadButton onClick={() => onTab('channels')}>Manage</HeadButton>}>
        {d.channels.length ? (
          d.channels.map((ch) => (
            <span key={ch.key} className="flex items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-ink">{ch.name}</span>
              {ch.detail ? <span className="truncate text-ink-3">{ch.detail}</span> : null}
              <Pill tone={CHANNEL_STATE[ch.state]?.tone ?? 'grey'}>{CHANNEL_STATE[ch.state]?.label ?? ch.state}</Pill>
            </span>
          ))
        ) : (
          <span className="text-[12.5px] text-ink-3">No sales channels are set up.</span>
        )}
      </Card>
      <Card title="Search engines" action={<HeadButton onClick={() => onTab('seo')}>Edit SEO</HeadButton>}>
        <span className="text-[12.5px] text-ink-2">
          Meta title {d.seo_health.meta_title_len ? `${d.seo_health.meta_title_len} characters` : 'missing'} · description {d.seo_health.meta_description_state} · {d.seo_health.og_image ? 'has a sharing picture' : 'no sharing picture'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {d.seo_health.translations.map((t) => (
            <Pill key={t.lang} tone={t.state === 'complete' ? 'green' : t.state === 'partial' ? 'amber' : 'grey'}>
              {t.lang.toUpperCase()} · {t.state.replace('_', ' ')}
            </Pill>
          ))}
        </div>
      </Card>
      <Card title="Documents" action={<HeadButton onClick={() => onTab('documents')}>All documents</HeadButton>}>
        {d.documents.length ? d.documents.slice(0, 3).map((doc) => <DocLine key={doc.id} doc={doc} />) : <span className="text-[12.5px] text-ink-3">No documents yet.</span>}
      </Card>
      <Card title="Activity" className="xl:col-span-3">
        {d.activity.length ? (
          d.activity.slice(0, 10).map((a) => (
            <span key={a.id} className="flex gap-3 text-[12.5px]">
              <span className="w-[110px] shrink-0 text-ink-3">{relative(a.created_at)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{a.summary ?? a.action}</span>
              <span className="shrink-0 text-ink-3">{a.user ?? ''}</span>
            </span>
          ))
        ) : (
          <span className="text-[12.5px] text-ink-3">Nothing has happened to it yet.</span>
        )}
      </Card>
    </div>
  );
}

function HeadButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={onClick}>
      {children}
    </button>
  );
}

function General({ d, currency, onEdit }: { d: P360; currency: string | null; onEdit: (() => void) | null }) {
  const p = d.product;
  const rows: Array<[string, ReactNode]> = [
    ['Code', p.code ?? '—'],
    ['Barcode', p.barcode ?? '—'],
    ['Kind', kindLabel(p.kind)],
    ['Category', p.category ?? '—'],
    ['Brand', p.brand ?? '—'],
    ['Unit', p.unit ?? '—'],
    ['Tracking', trackingLabel(p.tracking)],
    ['Costing', costingLabel(p.costing_method)],
    ['Price', whole(p.unit_price, p.currency ?? currency)],
    ['Tax', `${num(p.tax_rate) ?? 0}%`],
    ['Reorder at', p.reorder_point === null || p.reorder_point === undefined ? '—' : qty(p.reorder_point)],
    ['Weight', p.weight ? `${p.weight} ${p.weight_unit ?? ''}` : '—'],
  ];
  return (
    <Card title="General" action={onEdit ? <button type="button" className={btnSmall} onClick={onEdit}>Edit</button> : null}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] xl:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-[11.5px] font-semibold text-ink-3">{k}</dt>
            <dd className="m-0 text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {p.description ? <p className="m-0 text-[13px] whitespace-pre-line text-ink-2">{p.description.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim()}</p> : <span className="text-[12.5px] text-ink-3">No description yet.</span>}
    </Card>
  );
}

// ── media ───────────────────────────────────────────────────────────────

interface Incoming {
  name: string;
  state: string;
  bad?: boolean;
}

function MediaTab({ id, canEdit }: { id: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.media(id), queryFn: ({ signal }) => fetchMedia(id, signal) });
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const media = q.data?.media ?? [];
  const requireAlt = !!q.data?.require_alt;
  const put = (list: Media[]) => {
    qc.setQueryData(K2.media(id), { ...(q.data ?? { require_alt: false, limit: 12 }), media: list });
    void qc.invalidateQueries({ queryKey: K2.p360(id) });
  };
  const act = async (fn: () => Promise<{ media: Media[] }>) => {
    setBusy(true);
    try {
      put((await fn()).media ?? []);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const add = async (files: File[]) => {
    if (!files.length || !canEdit) return;
    const say = (name: string, state: string, bad = false) => setIncoming((list) => [...list.filter((x) => x.name !== name), { name, state, bad }]);
    const ready: Array<{ blob: Blob; name: string }> = [];
    for (const f of files) {
      try {
        if (isHeic(f)) {
          say(f.name, 'converting to JPEG…');
          const { heicTo } = await import('heic-to/csp');
          const jpeg = await heicTo({ blob: f, type: 'image/jpeg', quality: 0.85 });
          ready.push({ blob: await shrinkPicture(jpeg), name: f.name.replace(/\.(heic|heif)$/i, '.jpg') });
          say(f.name, 'converted to JPEG');
          continue;
        }
        if (!PICTURE_TYPES.includes(f.type)) {
          say(f.name, 'not a picture this gallery takes', true);
          continue;
        }
        const blob = await shrinkPicture(f);
        if (blob.size > (q.data?.max_bytes ?? PICTURE_MAX)) {
          say(f.name, 'too large', true);
          continue;
        }
        ready.push({ blob, name: f.name });
        say(f.name, `${(blob.size / 1024 / 1024).toFixed(1)} MB${blob !== f ? ' · reduced' : ''}`);
      } catch {
        say(f.name, 'could not be read', true);
      }
    }
    if (!ready.length) return;
    setBusy(true);
    try {
      put(await uploadMedia(id, ready));
      for (const r of ready) setIncoming((list) => list.map((x) => (x.name === r.name || x.name.replace(/\.(heic|heif)$/i, '.jpg') === r.name ? { ...x, state: `${x.state} · added` } : x)));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-3.5">
      <section
        aria-label="Gallery"
        className={cx('relative flex min-w-0 flex-1 flex-col rounded-[12px] border bg-surface', over ? 'border-primary' : 'border-line')}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="flex items-center gap-2 border-b border-line/60 px-4 py-3">
          <b className="flex-1 text-[14px] text-ink">Gallery</b>
          <span className="text-[12px] text-ink-3">
            {media.length} of {q.data?.limit ?? 12}
          </span>
          {canEdit ? (
            <>
              <button type="button" className={btnSmall} disabled={busy} onClick={() => pickRef.current?.click()}>
                Add pictures
              </button>
              <input
                ref={pickRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                hidden
                onChange={(e) => {
                  void add(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </>
          ) : null}
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3 2xl:grid-cols-4">
          {media.map((m, i) => (
            <MediaTile
              key={m.id}
              m={m}
              first={i === 0}
              last={i === media.length - 1}
              requireAlt={requireAlt}
              canEdit={canEdit && !busy}
              onPatch={(patch) => void act(() => patchMedia(id, m.id, patch))}
              onMove={(step) => void act(() => orderMedia(id, moved(media.map((x) => x.id), m.id, step)))}
              onRemove={() => void act(() => removeMedia(id, m.id))}
            />
          ))}
        </div>
        {!q.isLoading && !media.length ? <Empty text="No pictures yet." /> : null}
        {canEdit ? <div className="mx-4 mb-4 rounded-[10px] border-2 border-dashed border-line px-4 py-5 text-center text-[13px] text-ink-3">{over ? 'Drop to add them' : 'Drop photos from Finder or Explorer to add them'}</div> : null}
      </section>
      <aside aria-label="From this computer" className="flex w-[320px] shrink-0 flex-col gap-1.5 self-start rounded-[12px] border border-line bg-surface p-4">
        <b className="text-[14px] text-ink">From this computer</b>
        {incoming.length ? (
          incoming.map((f) => (
            <span key={f.name} className="flex justify-between gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
              <span className="min-w-0 truncate text-ink">{f.name}</span>
              <span className={cx('shrink-0', f.bad ? 'text-danger' : 'text-ink-3')}>{f.state}</span>
            </span>
          ))
        ) : (
          <span className="text-[12.5px] text-ink-3">Nothing added from this computer yet.</span>
        )}
        <p className="m-0 mt-1.5 text-[12px] text-ink-3">Large photos are reduced before upload. Files go to WorkSuite Files; the gallery keeps only references.</p>
      </aside>
    </div>
  );
}

function MediaTile({ m, first, last, requireAlt, canEdit, onPatch, onMove, onRemove }: { m: Media; first: boolean; last: boolean; requireAlt: boolean; canEdit: boolean; onPatch: (p: Partial<Media>) => void; onMove: (step: -1 | 1) => void; onRemove: () => void }) {
  const [alt, setAlt] = useState(m.alt ?? '');
  const src = m.thumb_url ?? m.url;
  const noAlt = altMissing({ ...m, alt }, requireAlt);
  return (
    <div data-media={m.id} className={cx('flex flex-col gap-1.5 rounded-[10px] border p-2', m.primary ? 'border-primary' : 'border-line')}>
      <span className="grid aspect-square place-items-center overflow-hidden rounded-[8px] bg-subtle">{src ? <img src={pictureSrc(src)} alt={m.alt ?? ''} loading="lazy" className="size-full object-cover" /> : m.external_url ? <span className="px-2 text-center text-[11px] text-ink-3">{m.external_url}</span> : null}</span>
      <span className="flex items-center gap-1">
        {m.primary ? <Pill tone="blue">Primary</Pill> : null}
        {m.variant_label ? <Pill>{m.variant_label}</Pill> : null}
        {m.public ? <Pill tone="green">Public</Pill> : null}
      </span>
      {canEdit ? (
        <>
          {m.primary ? (
            <span className="text-[12px] text-ink-3" title="To change the primary picture, make another one primary.">
              Primary picture
            </span>
          ) : (
            <Select aria-label="Role" value={m.role} onValueChange={(v) => onPatch({ role: v as Media['role'] })} options={m.source === 'url' ? ROLES.filter((r) => r.value !== 'primary') : ROLES} className="h-[28px] rounded-[7px] border border-line bg-surface px-2 text-[12px] text-ink" />
          )}
          <input
            className={cx(input, '!h-[28px] !text-[12px]', noAlt && m.public && '!border-danger')}
            value={alt}
            placeholder="Alt text — what the picture shows"
            aria-label="Alt text"
            onChange={(e) => setAlt(e.target.value)}
            onBlur={() => alt !== (m.alt ?? '') && onPatch({ alt: alt.trim() })}
          />
          <span className="flex items-center gap-1">
            <label className="flex flex-1 items-center gap-1.5 text-[12px] text-ink-2" title={noAlt ? 'Add the alt text first' : undefined}>
              <Checkbox checked={m.public} disabled={noAlt && !m.public} onChange={(e) => onPatch({ public: e.target.checked })} />
              Public
            </label>
            <button type="button" className="rounded-[6px] px-1.5 text-ink-3 hover:bg-subtle disabled:opacity-40" disabled={first} aria-label="Move earlier" onClick={() => onMove(-1)}>
              ←
            </button>
            <button type="button" className="rounded-[6px] px-1.5 text-ink-3 hover:bg-subtle disabled:opacity-40" disabled={last} aria-label="Move later" onClick={() => onMove(1)}>
              →
            </button>
            <button type="button" className="rounded-[6px] px-1.5 text-[12px] text-danger hover:bg-danger-bg" aria-label="Remove picture" onClick={onRemove}>
              Remove
            </button>
          </span>
        </>
      ) : (
        <span className="truncate text-[12px] text-ink-2">{m.alt || 'No alt text'}</span>
      )}
    </div>
  );
}

// ── variants ────────────────────────────────────────────────────────────

function Variants({ id, canEdit, currency }: { id: number; canEdit: boolean; currency: string | null }) {
  const qc = useQueryClient();
  const matrix = useQuery({ queryKey: K2.matrix(id), queryFn: ({ signal }) => fetchMatrix(id, signal) });
  const list = useQuery({ queryKey: K2.variants(id), queryFn: ({ signal }) => fetchVariants(id, signal) });
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const m = matrix.data;
  const rows = list.data?.variants ?? [];
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast('success', label);
      setPicked([]);
      void qc.invalidateQueries({ queryKey: K2.p360(id) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3.5">
      <Card
        title="Variant matrix"
        action={
          canEdit && m && m.missing.length ? (
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(`${m.missing.length} variants added`, () => generateVariants(id, m))}>
              Generate {m.missing.length} missing
            </button>
          ) : null
        }
      >
        {matrix.isLoading ? <Spinner /> : matrix.error ? <ErrorNote error={matrix.error} onRetry={() => void matrix.refetch()} /> : null}
        {m ? (
          <>
            <div className="flex flex-wrap gap-4 text-[12.5px]">
              {m.axes.map((a) => (
                <span key={a.attribute_id} className="flex flex-wrap items-center gap-1">
                  <b className="mr-1 text-ink">{a.name}</b>
                  {a.values.map((v) => (
                    <Pill key={v.id}>{v.value}</Pill>
                  ))}
                </span>
              ))}
              {!m.axes.length ? <span className="text-ink-3">No variant axes yet — this product has no variants.</span> : null}
            </div>
            <span className="text-[12.5px] text-ink-2">
              {m.combinations} combinations · {m.existing} exist{m.excluded ? ` · ${m.excluded} excluded by rules` : ''} · {m.missing.length} missing
            </span>
            {m.missing.length ? <span className="text-[12px] text-ink-3">Missing: {m.missing.slice(0, 12).map((x) => x.label).join(', ')}{m.missing.length > 12 ? '…' : ''}</span> : null}
            {m.rules.length ? <span className="text-[12px] text-ink-3">Never made: {m.rules.map((r) => (r.labels ?? r.values.map(String)).join(' / ')).join('; ')}</span> : null}
          </>
        ) : null}
      </Card>
      <Card
        title="Variants"
        action={
          canEdit && picked.length ? (
            <span className="flex gap-1.5">
              <button type="button" className={btnSmall} disabled={busy} onClick={() => void run('Barcodes generated', () => bulkVariants(id, picked, {}, true))}>
                Generate barcodes
              </button>
              <button type="button" className={btnSmall} disabled={busy} onClick={() => void run('Variants turned off', () => bulkVariants(id, picked, { active: false }))}>
                Turn off
              </button>
              <button type="button" className={btnSmall} disabled={busy} onClick={() => void run('Variants turned on', () => bulkVariants(id, picked, { active: true }))}>
                Turn on
              </button>
            </span>
          ) : null
        }
      >
        {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
        {rows.length ? (
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-ground text-left text-[12px] font-semibold text-ink-3">
                {canEdit ? (
                  <th className="w-[32px] border-b border-line px-2 py-2">
                    <Checkbox aria-label="Choose every variant" checked={picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} />
                  </th>
                ) : null}
                <th className="border-b border-line px-3 py-2">Variant</th>
                <th className="border-b border-line px-3 py-2">Code</th>
                <th className="border-b border-line px-3 py-2">Barcode</th>
                <th className="border-b border-line px-3 py-2 text-right">Price</th>
                <th className="border-b border-line px-3 py-2 text-right">On hand</th>
                <th className="border-b border-line px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className={cx('border-b border-line/60 last:border-b-0', !v.active && 'opacity-60')}>
                  {canEdit ? (
                    <td className="px-2 py-2">
                      <Checkbox aria-label={`Choose ${v.variant_label ?? v.code ?? v.id}`} checked={picked.includes(v.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, v.id] : picked.filter((x) => x !== v.id))} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-ink">{v.variant_label ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px] text-ink-2">{v.code ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px] text-ink-2">{v.barcode ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-ink tabular-nums">
                    {whole(v.price, currency)}
                    {v.inherited.price ? <span className="block text-[11px] text-ink-3">from the parent</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{qty(v.on_hand)}</td>
                  <td className="px-3 py-2">{v.active ? <Pill tone="green">On</Pill> : <Pill>Off</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !list.isLoading ? (
          <span className="text-[12.5px] text-ink-3">No variants.</span>
        ) : null}
      </Card>
    </div>
  );
}

// ── specifications ──────────────────────────────────────────────────────

function SpecsTab({ specs, typed, errors, canEdit, onType }: { specs: { data?: Specs; isLoading: boolean; error: unknown; refetch: () => unknown }; typed: Record<string, string>; errors: Record<string, string>; canEdit: boolean; onType: (k: string, v: string) => void }) {
  if (specs.isLoading) return <Spinner />;
  if (specs.error) return <ErrorNote error={specs.error} onRetry={() => void specs.refetch()} />;
  const s = specs.data;
  if (!s) return null;
  return (
    <div className="flex flex-col gap-3.5">
      <span className="text-[12.5px] text-ink-2">{s.set ? `Attribute set: ${s.set.name}${s.set.source === 'category' ? ', from its category' : ''}.` : 'No attribute set applies to this product yet.'}</span>
      {s.groups.map((g) => (
        <Card key={g.name} title={g.name || 'Specifications'}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 lg:grid-cols-2">
            {g.fields.map((f) => {
              const k = String(f.attribute_id);
              const v = typed[k] ?? specText(f);
              const err = errors[k] ?? f.error ?? null;
              return (
                <label key={k} className="flex flex-col gap-1 text-[12.5px]">
                  <span className="font-semibold text-ink-2">
                    {f.name}
                    {f.required ? <span className="text-danger"> *</span> : null}
                    {f.unit ? <span className="font-normal text-ink-3"> ({f.unit})</span> : null}
                  </span>
                  {!canEdit || ((f.kind === 'list' || f.kind === 'colour') && !f.options?.length) ? (
                    <span className="text-[13px] text-ink" title={canEdit ? 'Choose list values in the browser' : undefined}>
                      {f.kind === 'boolean' ? (f.value ? 'Yes' : 'No') : (f.value_label ?? (v || '—'))}
                    </span>
                  ) : f.kind === 'boolean' ? (
                    <Checkbox checked={v === '1'} onChange={(e) => onType(k, e.target.checked ? '1' : '0')} aria-label={f.name} />
                  ) : (f.kind === 'list' || f.kind === 'colour') && f.options?.length ? (
                    <Select aria-label={f.name} value={v} onValueChange={(x) => onType(k, x)} options={[{ value: '', label: '—' }, ...f.options.map((o) => ({ value: String(o.id), label: o.value }))]} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink" />
                  ) : (
                    <input className={cx(input, err && '!border-danger', f.kind === 'number' && 'text-right tabular-nums')} value={v} inputMode={f.kind === 'number' ? 'decimal' : undefined} aria-label={f.name} onChange={(e) => onType(k, e.target.value)} />
                  )}
                  {err ? <span className="text-[12px] text-danger">{err}</span> : null}
                </label>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── documents ───────────────────────────────────────────────────────────

function DocLine({ doc }: { doc: P360['documents'][number] }) {
  return (
    <span className="flex items-center gap-2 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate text-ink">
        {doc.title}
        <span className="text-ink-3"> · {DOC_TYPE[doc.type] ?? doc.type} · rev {doc.rev}</span>
      </span>
      {doc.expiry_state === 'expired' ? <Pill tone="red">expired</Pill> : doc.expiry_state === 'expiring' ? <Pill tone="amber">expires {dateLabel(doc.expires_on)}</Pill> : null}
    </span>
  );
}

function Documents({ id }: { id: number }) {
  const q = useQuery({ queryKey: K2.documents(id), queryFn: ({ signal }) => fetchDocuments(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const docs = q.data?.documents ?? [];
  return (
    <Card title="Documents" action={q.data?.expiring ? <Pill tone="amber">{q.data.expiring} expiring soon</Pill> : null}>
      {docs.length ? (
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-ground text-left text-[12px] font-semibold text-ink-3">
              <th className="border-b border-line px-3 py-2">Title</th>
              <th className="border-b border-line px-3 py-2">Type</th>
              <th className="border-b border-line px-3 py-2">Languages</th>
              <th className="border-b border-line px-3 py-2">Who sees it</th>
              <th className="border-b border-line px-3 py-2 text-right">Revision</th>
              <th className="border-b border-line px-3 py-2">Expires</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id} className="border-b border-line/60 last:border-b-0">
                <td className="px-3 py-2">
                  <b className="text-ink">{doc.title}</b>
                  {doc.primary ? <span className="ml-1.5 text-[11.5px] text-ink-3">primary</span> : null}
                  {doc.file_name ? <span className="block text-[11.5px] text-ink-3">{doc.file_name}</span> : null}
                </td>
                <td className="px-3 py-2 text-ink-2">{DOC_TYPE[doc.type] ?? doc.type}</td>
                <td className="px-3 py-2 text-ink-2">{doc.languages.map((l) => l.toUpperCase()).join(', ') || '—'}</td>
                <td className="px-3 py-2 text-ink-2">{VISIBILITY[doc.visibility] ?? doc.visibility}</td>
                <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{doc.rev}</td>
                <td className="px-3 py-2">{doc.expires_on ? <Pill tone={doc.expiry_state === 'expired' ? 'red' : doc.expiry_state === 'expiring' ? 'amber' : 'grey'}>{dateLabel(doc.expires_on)}</Pill> : <span className="text-ink-3">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <span className="text-[12.5px] text-ink-3">No documents yet. Data sheets, manuals and certificates are added from the browser.</span>
      )}
    </Card>
  );
}

// ── channels ────────────────────────────────────────────────────────────

function Channels({ id, canEdit, onTab }: { id: number; canEdit: boolean; onTab: (t: Tab360) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.channels(id), queryFn: ({ signal }) => fetchChannels(id, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      toast('success', label);
      void qc.invalidateQueries({ queryKey: K2.channels(id) });
      void qc.invalidateQueries({ queryKey: K2.p360(id) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (!list.length) return <Empty text="No sales channels are set up for your companies." />;
  return (
    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
      {list.map((ch) => {
        const a = channelActions(ch);
        const st = CHANNEL_STATE[ch.state] ?? { label: ch.state, tone: 'grey' as const };
        return (
          <Card key={ch.key} title={ch.name} action={<Pill tone={st.tone}>{st.label}</Pill>}>
            {ch.detail ? <span className="text-[12.5px] text-ink-2">{ch.detail}</span> : null}
            {[ch.price_list ? `Price list ${ch.price_list}` : null, ch.visible_from ? `visible from ${dateLabel(ch.visible_from)}` : null, ch.visible_to ? `until ${dateLabel(ch.visible_to)}` : null].filter(Boolean).length ? (
              <span className="text-[12px] text-ink-3">{[ch.price_list ? `Price list ${ch.price_list}` : null, ch.visible_from ? `visible from ${dateLabel(ch.visible_from)}` : null, ch.visible_to ? `until ${dateLabel(ch.visible_to)}` : null].filter(Boolean).join(' · ')}</span>
            ) : null}
            {ch.validation.missing.length ? (
              <div className="flex flex-col gap-1 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink">
                <b>Before it can go live</b>
                {ch.validation.missing.map((x) => (
                  <span key={x.field} className="flex gap-2">
                    <span className="flex-1">{x.message}</span>
                    <button type="button" className="font-semibold underline" onClick={() => onTab(fixTab(x.fix_tab))}>
                      Fix
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {canEdit ? (
              <div className="flex gap-1.5">
                {a.turnOn ? (
                  <button type="button" className={btnSmall} disabled={busy === ch.key} onClick={() => void run(ch.key, `${ch.name}: on, as a draft`, () => setChannel(id, ch.key, { state: 'draft' }))}>
                    Turn on
                  </button>
                ) : null}
                {a.publish ? (
                  <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy === ch.key} onClick={() => void run(ch.key, `Published on ${ch.name}`, () => channelAct(id, ch.key, 'publish'))}>
                    Publish
                  </button>
                ) : null}
                {a.unpublish ? (
                  <button type="button" className={btnSmall} disabled={busy === ch.key} onClick={() => void run(ch.key, `Taken off ${ch.name}`, () => channelAct(id, ch.key, 'unpublish'))}>
                    Unpublish
                  </button>
                ) : null}
                {!a.turnOn && ch.state !== 'published' ? (
                  <button type="button" className={btnSmall} disabled={busy === ch.key} onClick={() => void run(ch.key, `${ch.name}: off`, () => setChannel(id, ch.key, { state: 'off' }))}>
                    Turn off
                  </button>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

// ── SEO ─────────────────────────────────────────────────────────────────

type SeoField = 'slug' | 'meta_title' | 'meta_description' | 'canonical' | 'robots';

function SeoTab({ id, lang, onLang, typed, canEdit, onType, onUndo }: { id: number; lang: string; onLang: (l: string) => void; typed: Partial<Record<SeoField, string>>; canEdit: boolean; onType: (p: Partial<Record<SeoField, string>>) => void; onUndo: () => void }) {
  const q = useQuery({ queryKey: K2.seo(id, lang), queryFn: ({ signal }) => fetchSeo(id, lang, signal) });
  const [drafting, setDrafting] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d: Seo | undefined = q.data;
  if (!d) return null;
  const val = (k: SeoField) => typed[k] ?? d.seo[k] ?? '';
  const title = seoLength('title', val('meta_title') || d.defaults.meta_title);
  const desc = seoLength('description', val('meta_description') || d.defaults.meta_description);
  const ai = async () => {
    setDrafting(true);
    try {
      const r = await draftSeo(id, lang);
      onType({ meta_title: r.meta_title, meta_description: r.meta_description, slug: r.slug });
      toast('info', 'A draft is in the boxes — read it, then Save.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setDrafting(false);
    }
  };
  const box = (k: SeoField, label: string, opts: { area?: boolean; hint?: ReactNode; placeholder?: string | null } = {}) => (
    <label className="flex flex-col gap-1 text-[12.5px]">
      <span className="flex items-baseline gap-2 font-semibold text-ink-2">
        <span className="flex-1">{label}</span>
        {opts.hint}
      </span>
      {canEdit ? (
        opts.area ? (
          <textarea className={cx(input, '!h-[76px] py-2')} value={val(k)} placeholder={opts.placeholder ?? undefined} onChange={(e) => onType({ [k]: e.target.value })} aria-label={label} />
        ) : (
          <input className={input} value={val(k)} placeholder={opts.placeholder ?? undefined} onChange={(e) => onType({ [k]: k === 'slug' ? slugify(e.target.value) : e.target.value })} aria-label={label} />
        )
      ) : (
        <span className="text-[13px] text-ink">{val(k) || opts.placeholder || '—'}</span>
      )}
    </label>
  );
  const counter = (r: { n: number; tone: 'green' | 'amber' | 'red'; words: string }) => <span className={cx('font-normal tabular-nums', r.tone === 'green' ? 'text-[#166534] dark:text-success' : r.tone === 'amber' ? 'text-warning-ink' : 'text-danger')}>{`${r.n} · ${r.words}`}</span>;
  return (
    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card
        title="Search listing"
        action={
          <span className="flex items-center gap-1.5">
            {d.languages.length > 1 ? <Select aria-label="Language" value={lang} onValueChange={onLang} options={d.languages.map((l) => ({ value: l, label: l.toUpperCase() }))} className="h-[30px] w-[80px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink" /> : null}
            {canEdit && d.ai ? (
              <button type="button" className={btnSmall} disabled={drafting} onClick={() => void ai()}>
                {drafting ? 'Drafting…' : 'Draft with AI'}
              </button>
            ) : null}
            {Object.keys(typed).length ? (
              <button type="button" className={btnSmall} onClick={onUndo}>
                Undo changes
              </button>
            ) : null}
          </span>
        }
      >
        {box('slug', 'Address (slug)', { placeholder: d.defaults.slug })}
        {box('meta_title', 'Meta title', { hint: counter(title), placeholder: d.defaults.meta_title })}
        {box('meta_description', 'Meta description', { area: true, hint: counter(desc), placeholder: d.defaults.meta_description })}
        <div className="grid grid-cols-2 gap-3">
          {box('canonical', 'Canonical address')}
          {box('robots', 'Robots', { placeholder: 'index, follow' })}
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-line px-3 py-2.5">
          <span className="text-[12px] text-[#166534] dark:text-success">…/{val('slug') || d.defaults.slug || ''}</span>
          <span className="truncate text-[15px] text-[#1a0dab] dark:text-primary">{val('meta_title') || d.defaults.meta_title || 'No title'}</span>
          <span className="line-clamp-2 text-[12.5px] text-ink-2">{val('meta_description') || d.defaults.meta_description || 'No description'}</span>
        </div>
      </Card>
      <div className="flex flex-col gap-3.5">
        <Card title="Translations">
          {d.translations.length ? (
            d.translations.map((t) => (
              <button key={t.lang} type="button" onClick={() => onLang(t.lang)} className="flex items-center justify-between text-left text-[12.5px] hover:underline">
                <span className="text-ink">{t.lang.toUpperCase()}</span>
                <Pill tone={t.state === 'complete' ? 'green' : t.state === 'partial' ? 'amber' : 'grey'}>{t.state.replace('_', ' ')}</Pill>
              </button>
            ))
          ) : (
            <span className="text-[12.5px] text-ink-3">One language only.</span>
          )}
        </Card>
        <Card title="Redirects">
          {d.redirects.length ? (
            d.redirects.map((r) => (
              <span key={`${r.from}-${r.at}`} className="truncate text-[12px] text-ink-2">
                {r.from} → {r.to} <span className="text-ink-3">· {r.code}</span>
              </span>
            ))
          ) : (
            <span className="text-[12.5px] text-ink-3">Changing the address keeps the old one working with a redirect.</span>
          )}
        </Card>
      </div>
    </div>
  );
}
