import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { call, errorMessage, registerDropped } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { bytes } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { DriveFilePicker } from '../../../components/DriveFilePicker';
import { Icon } from '../../../components/Icon';
import { Button, Chip, cx } from '../../../components/ui';
import { brandById, dataOf, rowsOf, SK, socialApi, useBrands, useInvalidate, useLibrary, useModuleStatus, type LibraryItem, type LibraryKind } from '../api';
import { useSocialAccess } from '../access';
import { NETWORKS, networkInfo, type Network } from '../lib/networks';
import { Field, INPUT, MediaTile, NativeSelect, NetChips, Notice, OptionalView, PageBody, PageHeader, Panel, UnderlineTabs, useBrandScope } from '../parts';
import { EvergreenPool, TextItems } from './measure/LibraryItems';

/**
 * W08 — Content library (WS-SMM-SRS-001 SMM-MED-001, MED-002, MED-005…007, SMM-CMP-007): media kept in WorkSuite
 * Drive with their social metadata (where stored, which networks they fit, licence, alt text), plus post templates,
 * hashtag sets, saved captions and the evergreen pool. A file whose licence expired cannot be reused (MED-007).
 */

const TABS: Array<{ id: LibraryKind; label: string }> = [
  { id: 'media', label: 'Media' },
  { id: 'template', label: 'Post templates' },
  { id: 'hashtag_set', label: 'Hashtag sets' },
  { id: 'caption', label: 'Saved captions' },
  { id: 'evergreen', label: 'Evergreen pool' },
];

/** Each network's usual feed shape, for the "Fits" filter's words; the server decides what fits. */
const FEED_RATIO: Record<Network, string> = { facebook: '4:5', instagram: '4:5', threads: '4:5', linkedin: '1.91:1', x: '16:9', youtube: '16:9', tiktok: '9:16', google_business: '4:3', pinterest: '2:3' };

type Media = NonNullable<LibraryItem['media']>;

const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const dims = (m: Media) => (m.width && m.height ? `${m.width}×${m.height}` : m.kind === 'document' ? 'Document' : m.kind);

export default function Library() {
  const access = useSocialAccess(dataOf(useModuleStatus().data)?.permissions);
  const canEdit = access.library || access.create;
  const [brandId] = useBrandScope();
  const [tab, setTab] = useState<LibraryKind>('media');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [fits, setFits] = useState('');
  const q = useLibrary(tab === 'media' ? { kind: 'media', q: search.trim() || null, type: type || null, fits: fits || null, brand_id: brandId } : { kind: tab, brand_id: brandId });
  const data = dataOf(q.data);
  const counts = data?.counts ?? {};
  const [chosen, setChosen] = useState<number | null>(null);
  const media = tab === 'media' ? mediaOf(data?.items ?? []) : [];
  const selected = media.find((i) => i.id === chosen) ?? media[0] ?? null;

  return (
    <>
      <PageHeader crumb="Plan" title="Content library" actions={canEdit ? <LibraryActions brandId={brandId} /> : null} />
      <PageBody>
        <div className="flex flex-col gap-4">
          <UnderlineTabs label="Library sections" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, count: counts[t.id] ?? null }))} />
          {tab === 'media' ? (
            <>
              <MediaFilters search={search} onSearch={setSearch} type={type} onType={setType} fits={fits} onFits={setFits} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <OptionalView q={q} what="The content library">
                  {() => <MediaGrid media={media} selected={selected?.id ?? null} onSelect={setChosen} />}
                </OptionalView>
                <div className="flex min-w-0 flex-col gap-4">
                  {selected ? <MediaDetail key={selected.id} item={selected} canEdit={canEdit} /> : null}
                  <HashtagCard brandId={brandId} />
                </div>
              </div>
            </>
          ) : (
            <OptionalView q={q} what="The content library">
              {(d) => (tab === 'evergreen' ? <EvergreenPool items={d.items} canEdit={canEdit} /> : <TextItems kind={tab} items={d.items} canEdit={canEdit} brandId={brandId} />)}
            </OptionalView>
          )}
          <Notice tone="info" icon="folder">
            Media live in WorkSuite Drive; the library is a view with social metadata, not a second file store.
          </Notice>
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * Header: Upload, Add from Drive
 * ------------------------------------------------------------------------ */

function LibraryActions({ brandId }: { brandId: number | null }) {
  const status = dataOf(useModuleStatus().data);
  const brands = rowsOf(useBrands().data);
  const brand = brandById(brands, brandId ?? status?.default_brand_id ?? null);
  const folder = brand?.drive_folder ?? null;
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const invalidate = useInvalidate();
  const add = useMutation({
    mutationFn: (ids: number[]) => socialApi.addMediaFromDrive(ids, brand?.id ?? null),
    onSuccess: (r) => {
      invalidate(SK.libraryAll);
      toast('success', `Added ${r.items.length === 1 ? 'one file' : `${r.items.length} files`} to the library.`);
      setPicking(false);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const upload = async (files: File[]) => {
    if (!files.length) return;
    try {
      const picked = await registerDropped(files);
      if (!picked.length) {
        toast('error', 'Uploading needs the WorkSuite Desktop app.');
        return;
      }
      await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'files', folderId: folder ? String(folder.id) : null } });
      toast('info', `Uploading to ${folder?.path ?? 'your Drive'}; it appears here when done`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Files to upload"
        accept="image/*,video/*,application/pdf"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void upload(files);
        }}
      />
      <Button icon="upload" onClick={() => input.current?.click()}>
        Upload
      </Button>
      <Button variant="primary" icon="folder" onClick={() => setPicking(true)}>
        Add from Drive
      </Button>
      {picking ? (
        <DriveFilePicker title="Add from Drive" confirmLabel="Add to library" busy={add.isPending} onClose={() => setPicking(false)} onChoose={(files) => add.mutate(files.map((f) => Number(f.id)).filter((n) => Number.isFinite(n)))} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------------ */

function MediaFilters({ search, onSearch, type, onType, fits, onFits }: { search: string; onSearch: (v: string) => void; type: string; onType: (v: string) => void; fits: string; onFits: (v: string) => void }) {
  const brands = rowsOf(useBrands().data);
  const [brandId, setBrandId] = useBrandScope();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-[220px] flex-1">
        <span className="sr-only">Search media</span>
        <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input type="search" className={cx(INPUT, 'pl-8')} placeholder="Search file names, tags, alt text" value={search} onChange={(e) => onSearch(e.target.value)} />
      </label>
      <NativeSelect label="Type" value={type} onChange={onType} className="w-auto">
        <option value="">Type: all</option>
        <option value="image">Type: image</option>
        <option value="video">Type: video</option>
        <option value="document">Type: document</option>
      </NativeSelect>
      <NativeSelect label="Brand" value={brandId === null ? '' : String(brandId)} onChange={(v) => setBrandId(v ? Number(v) : null)} className="w-auto">
        <option value="">Brand: all</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            Brand: {b.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect label="Fits" value={fits} onChange={onFits} className="w-auto">
        <option value="">Fits: any network</option>
        {NETWORKS.map((n) => (
          <option key={n} value={n}>
            Fits: {networkInfo(n).label} {FEED_RATIO[n]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

type MediaItem = LibraryItem & { media: Media };

function mediaOf(items: LibraryItem[]): MediaItem[] {
  return items.filter((i): i is MediaItem => !!i.media);
}

function MediaGrid({ media, selected, onSelect }: { media: MediaItem[]; selected: number | null; onSelect: (id: number) => void }) {
  if (!media.length) return <p className="rounded-[12px] border border-dashed border-line bg-surface px-4 py-10 text-center text-[12.5px] text-ink-3">No media match. Upload a file or add one from Drive.</p>;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] content-start gap-3" aria-label="Media">
      {media.map((it) => {
        const m = it.media;
        const on = selected === it.id;
        return (
          <li key={it.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(it.id)}
              className={cx('flex w-full flex-col overflow-hidden rounded-[12px] border bg-surface text-left', on ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-ink-3')}
            >
              <MediaTile media={m} label={false} className="aspect-[4/3] w-full rounded-none" />
              <span className="flex min-w-0 flex-col gap-1 px-2.5 py-2">
                <span className="truncate text-[12.5px] font-bold text-ink">{it.name}</span>
                <span className="truncate text-[11.5px] text-ink-3">
                  {m.kind === 'video' && m.duration_seconds ? `${duration(m.duration_seconds)} · ` : ''}
                  {dims(m)} · {it.usage_count ? `used ${it.usage_count}×` : 'unused'}
                </span>
                <span className="flex flex-wrap gap-1">
                  {m.licence_expired ? <Chip tone="danger">Expired licence</Chip> : null}
                  {it.tags[0] ? <Chip tone="indigo">{it.tags[0]}</Chip> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MediaDetail({ item, canEdit }: { item: MediaItem; canEdit: boolean }) {
  const { go } = useTab();
  const m = item.media;
  const invalidate = useInvalidate();
  const [alt, setAlt] = useState(m.alt_text ?? '');
  const save = useMutation({
    mutationFn: () => socialApi.saveLibraryItem({ id: item.id, kind: 'media', name: item.name, media: { ...m, alt_text: alt.trim() || null } }),
    onSuccess: () => {
      invalidate(SK.libraryAll);
      toast('success', 'Alt text saved.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const expired = !!m.licence_expired;
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-[12.5px]">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
  return (
    <Panel title={<span className="break-all">{item.name}</span>}>
      <div className="flex flex-col gap-3">
        <MediaTile media={m} className="aspect-[4/3] w-full" />
        <dl className="flex flex-col gap-1.5">
          {row('Stored in', m.drive_path ?? <span className="text-ink-3">Drive</span>)}
          {row('Size', [m.kind === 'video' && m.duration_seconds ? duration(m.duration_seconds) : null, dims(m), m.bytes ? bytes(m.bytes) : null].filter(Boolean).join(' · '))}
          {row('Fits', m.fits?.length ? <NetChips networks={m.fits} size={20} max={9} /> : <span className="text-ink-3">Not checked</span>)}
          {row(
            'Licence',
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {m.licence ?? <span className="text-ink-3">Not recorded</span>}
              {expired ? <Chip tone="danger">Expired</Chip> : null}
            </span>,
          )}
        </dl>
        <Field label="Alt text" hint="Read aloud by screen readers on every network that supports it.">
          <input className={INPUT} value={alt} disabled={!canEdit} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the picture" />
        </Field>
        {canEdit ? (
          <Button size="sm" className="self-start" disabled={alt.trim() === (m.alt_text ?? '').trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Save alt text
          </Button>
        ) : null}
        {expired ? <p className="text-[12px] text-danger">The licence for this file has expired, so it can’t be used in new posts.</p> : null}
        <Button variant="primary" icon="plus" disabled={expired} title={expired ? 'The licence has expired' : undefined} onClick={() => go(`/social-media/compose?file=${m.file_id}`)}>
          Use in new post
        </Button>
      </div>
    </Panel>
  );
}

function HashtagCard({ brandId }: { brandId: number | null }) {
  const q = useLibrary({ kind: 'hashtag_set', brand_id: brandId });
  return (
    <Panel title="Hashtag sets">
      <OptionalView q={q} what="Hashtag sets" compact>
        {(d) =>
          d.items.length ? (
            <ul className="flex flex-col gap-3">
              {d.items.map((s) => (
                <li key={s.id}>
                  <div className="text-[12.5px] font-bold text-ink">{s.name}</div>
                  <div className="font-mono text-[11.5px] break-words text-ink-2">{s.text}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">No hashtag sets yet.</p>
          )
        }
      </OptionalView>
    </Panel>
  );
}
