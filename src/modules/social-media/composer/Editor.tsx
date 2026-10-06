/**
 * W02 / D02 Create post — the caption editor (SMM-CMP-002/003/004/005/006/007, SMM-MED-002): Original and one tab per
 * network; a network tab is that network's variant, marked Customised once edited and reset to the Original in one
 * click; its options are what the account's capability set offers (first comment, thread, title, privacy, board,
 * call to action, offer dates, where it is posted).
 */
import { useState, type ReactNode, type RefObject } from 'react';
import { Button, cx, Modal, Spinner } from '../../../components/ui';
import { rowsOf, useLibrary, type Account, type LibraryKind, type TargetOptions } from '../api';
import { networkInfo, POST_KIND_LABEL, type CapabilitySet, type Network, type PostKind } from '../lib/networks';
import { countText } from '../lib/text';
import { INPUT, NativeSelect, NotOffered, TEXTAREA, UnderlineTabs } from '../parts';
import { capsFor, textFor, variantOf, type ComposerDraft, type DraftChecks } from './state';

export type Tab = 'original' | Network;

export function Editor({
  draft,
  accounts,
  networks,
  checks,
  tab,
  onTab,
  captionRef,
  readOnly,
  onText,
  onReset,
  onOptions,
  onInsert,
  onMention,
  onLink,
  onLabels,
  onDrive,
  onFiles,
  brandId,
  children,
}: {
  draft: ComposerDraft;
  accounts: Account[];
  networks: Network[];
  checks: DraftChecks;
  tab: Tab;
  onTab: (t: Tab) => void;
  captionRef: RefObject<HTMLTextAreaElement | null>;
  readOnly?: boolean;
  onText: (text: string) => void;
  onReset: (n: Network) => void;
  onOptions: (n: Network, o: TargetOptions, customise?: boolean) => void;
  onInsert: (text: string) => void;
  onMention: () => void;
  onLink: () => void;
  onLabels: () => void;
  onDrive: () => void;
  onFiles: () => void;
  brandId: number | null;
  children?: ReactNode;
}) {
  const [lib, setLib] = useState<LibraryKind | null>(null);
  const net = tab === 'original' ? null : tab;
  const text = textFor(draft, net);
  const variant = net ? variantOf(draft, net) : null;
  const tabs = [
    { id: 'original' as Tab, label: 'Original' },
    ...networks.map((n) => {
      const c = checks.byNetwork[n];
      return {
        id: n as Tab,
        label: (
          <span className="inline-flex items-center gap-1">
            {networkInfo(n).label}
            {draft.variants[n]?.customised ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="customised" /> : null}
            {c?.blocking ? (
              <span className="text-danger">
                · {c.count} issue{c.count === 1 ? '' : 's'}
              </span>
            ) : null}
          </span>
        ),
      };
    }),
  ];
  return (
    <div className="flex flex-col gap-3">
      <UnderlineTabs value={tab} onChange={onTab} tabs={tabs} label="Variants" />
      {variant?.customised && net ? (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="rounded-full bg-selection px-2 py-0.5 font-semibold text-primary">Customised</span>
          <span className="text-ink-3">{networkInfo(net).label} gets its own caption{variant.media ? ' and media' : ''}.</span>
          {!readOnly ? (
            <Button size="sm" variant="ghost" icon="undo" onClick={() => onReset(net)}>
              Reset to Original
            </Button>
          ) : null}
        </div>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2 text-[12px] font-semibold text-ink-2">
          <span>Caption{net ? ` — ${networkInfo(net).label}` : ''}</span>
          <Counters draft={draft} accounts={accounts} networks={net ? [net] : networks} text={text} />
        </span>
        <textarea ref={captionRef} className={cx(TEXTAREA, 'min-h-[150px] text-[13.5px] leading-relaxed')} value={text} readOnly={readOnly} onChange={(e) => onText(e.target.value)} placeholder="Write the post. Each network tab can change it for that network." />
      </label>
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Caption tools">
          <Button size="sm" variant="ghost" icon="folder" onClick={onDrive}>
            Drive media
          </Button>
          <Button size="sm" variant="ghost" icon="upload" onClick={onFiles}>
            Upload
          </Button>
          <Button size="sm" variant="ghost" icon="hash" onClick={() => setLib('hashtag_set')}>
            Hashtag sets
          </Button>
          <Button size="sm" variant="ghost" icon="bookmark" onClick={() => setLib('caption')}>
            Saved captions
          </Button>
          <Button size="sm" variant="ghost" icon="link" onClick={onLink}>
            Link
          </Button>
          <Button size="sm" variant="ghost" icon="at" onClick={onMention}>
            Mention
          </Button>
          <Button size="sm" variant="ghost" icon="tag" onClick={onLabels}>
            Labels
          </Button>
        </div>
      ) : null}
      {children}
      {net && variant ? <NetworkOptions network={net} caps={capsFor(net, accounts, draft)} options={variant.options} readOnly={readOnly} onChange={(o, c) => onOptions(net, o, c)} /> : null}
      {lib ? (
        <LibraryInsert
          kind={lib}
          brandId={brandId}
          onClose={() => setLib(null)}
          onPick={(t) => {
            setLib(null);
            onInsert(t);
          }}
        />
      ) : null}
    </div>
  );
}

function Counters({ draft, accounts, networks, text }: { draft: ComposerDraft; accounts: Account[]; networks: Network[]; text: string }) {
  if (!networks.length) return <span className="font-normal text-ink-3 tabular-nums">{countText(text, 'code_points')} characters</span>;
  return (
    <span className="flex flex-wrap justify-end gap-x-3 font-normal tabular-nums">
      {networks.map((n) => {
        const caps = capsFor(n, accounts, draft);
        if (!caps.text_limit) return null;
        const used = countText(textFor(draft, n), caps.counting);
        const over = used > caps.text_limit;
        return (
          <span key={n} data-testid={`count-${n}`} className={over ? 'font-bold text-danger' : 'text-ink-3'}>
            {networks.length > 1 ? `${networkInfo(n).short} ` : ''}
            {used} / {caps.text_limit}
          </span>
        );
      })}
    </span>
  );
}

const CTA_TYPES = ['LEARN_MORE', 'BOOK', 'ORDER', 'SHOP', 'SIGN_UP', 'CALL'];

function NetworkOptions({ network, caps, options, readOnly, onChange }: { network: Network; caps: CapabilitySet; options: TargetOptions; readOnly?: boolean; onChange: (o: TargetOptions, customise?: boolean) => void }) {
  const o = caps.options;
  const label = networkInfo(network).label;
  const parts = options.thread_parts ?? [];
  const any = o.first_comment || o.thread || o.title || o.privacy || o.board || o.cta || o.offer || caps.post_kinds.length > 1;
  if (!any) return null;
  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-3 rounded-[10px] border border-line px-3 py-3">
      <legend className="px-1 text-[12px] font-semibold text-ink-2">{label} options</legend>
      {caps.post_kinds.length > 1 ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">Post as</span>
          <NativeSelect label={`${label}: post as`} value={options.post_kind ?? caps.post_kinds[0]!} onChange={(v) => onChange({ post_kind: v as PostKind })}>
            {caps.post_kinds.map((k) => (
              <option key={k} value={k}>
                {POST_KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
      {o.first_comment ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">First comment ({label})</span>
          <textarea className={cx(TEXTAREA, 'min-h-[54px]')} value={options.first_comment ?? ''} onChange={(e) => onChange({ first_comment: e.target.value || null })} placeholder="Posted right after the post — hashtags or the link often go here" />
        </label>
      ) : null}
      {o.thread ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">Thread</span>
          {parts.length ? (
            parts.map((p, i) => {
              const n = countText(p, caps.counting);
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <textarea aria-label={`Part ${i + 1}`} className={cx(TEXTAREA, 'min-h-[54px]')} value={p} onChange={(e) => onChange({ thread_parts: parts.map((x, j) => (j === i ? e.target.value : x)) }, true)} />
                  <span className="flex justify-between text-[11.5px]">
                    <span className={n > caps.text_limit ? 'font-bold text-danger' : 'text-ink-3'}>
                      Part {i + 1}: {n} / {caps.text_limit}
                    </span>
                    <button type="button" className="text-ink-3 hover:text-danger" onClick={() => onChange({ thread_parts: parts.filter((_, j) => j !== i) }, true)}>
                      Remove part
                    </button>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-[12px] text-ink-3">One post. Add parts to make it a thread; a caption over {caps.text_limit} can be split for you in Checks.</p>
          )}
          <Button size="sm" variant="ghost" icon="plus" className="self-start" onClick={() => onChange({ thread_parts: [...parts, ''] }, true)}>
            Add part
          </Button>
        </div>
      ) : null}
      {o.title ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">Title</span>
          <input className={INPUT} value={options.title ?? ''} onChange={(e) => onChange({ title: e.target.value || null })} />
        </label>
      ) : null}
      {o.privacy ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">Privacy</span>
          <NativeSelect label={`${label}: privacy`} value={options.privacy ?? 'public'} onChange={(v) => onChange({ privacy: v as TargetOptions['privacy'] })}>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </NativeSelect>
        </label>
      ) : null}
      {o.board ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">Board</span>
          <input className={INPUT} value={options.board ?? ''} onChange={(e) => onChange({ board: e.target.value || null })} placeholder="The board the Pin goes on" />
        </label>
      ) : null}
      {o.cta ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Call to action</span>
            <NativeSelect label="Call to action" value={options.cta?.type ?? ''} onChange={(v) => onChange({ cta: v ? { type: v, url: options.cta?.url ?? null } : null })}>
              <option value="">None</option>
              {CTA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Button link</span>
            <input className={INPUT} value={options.cta?.url ?? ''} disabled={!options.cta} onChange={(e) => onChange({ cta: { type: options.cta?.type ?? 'LEARN_MORE', url: e.target.value || null } })} />
          </label>
        </div>
      ) : null}
      {o.offer && (options.post_kind === 'offer' || !caps.post_kinds.includes('offer')) ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Offer starts</span>
            <input type="date" className={INPUT} value={options.offer?.starts_on ?? ''} onChange={(e) => onChange({ offer: { ...options.offer, starts_on: e.target.value || null } })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Offer ends</span>
            <input type="date" className={INPUT} value={options.offer?.ends_on ?? ''} onChange={(e) => onChange({ offer: { ...options.offer, ends_on: e.target.value || null } })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Coupon</span>
            <input className={INPUT} value={options.offer?.coupon ?? ''} onChange={(e) => onChange({ offer: { ...options.offer, coupon: e.target.value || null } })} />
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Hashtag sets and saved captions from the library (SMM-LIB-002), put in at the cursor. */
function LibraryInsert({ kind, brandId, onPick, onClose }: { kind: LibraryKind; brandId: number | null; onPick: (text: string) => void; onClose: () => void }) {
  const q = useLibrary({ kind, brand_id: brandId });
  const what = kind === 'hashtag_set' ? 'Hashtag sets' : 'Saved captions';
  const items = rowsOf(q.data ? (q.data.offered ? { offered: true, data: q.data.data.items } : q.data) : undefined).filter((i) => i.text);
  return (
    <Modal title={what} onClose={onClose} width={480}>
      {q.isLoading ? (
        <Spinner />
      ) : q.data && !q.data.offered ? (
        <NotOffered what={what} compact />
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-3">None saved yet. Add them in Content library.</p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto scroll-thin">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onPick(i.text ?? '')} className="flex w-full flex-col items-start rounded-[8px] px-2.5 py-2 text-left hover:bg-subtle">
                <span className="text-[13px] font-semibold text-ink">{i.name}</span>
                <span className="line-clamp-2 text-[12px] text-ink-3">{i.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
