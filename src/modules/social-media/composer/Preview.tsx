/**
 * W02 / D02 Create post — Preview (SMM-CMP-009): roughly how each network shows the post — the account, the time,
 * the caption cut where the network folds it ("… more"), the media grid and the link. An approximation; the
 * networks draw their own.
 */
import { useState } from 'react';
import { Avatar, cx } from '../../../components/ui';
import type { Account, Campaign } from '../api';
import { capabilitiesOf, networkInfo, type Network } from '../lib/networks';
import { findLinks } from '../lib/text';
import { fromLocalInput, inZone } from '../lib/time';
import { MediaTile, NetChip, Panel } from '../parts';
import { mediaFor, taggedLink, textFor, variantOf, type ComposerDraft } from './state';

/** Where each network folds a caption behind "more" in its feed (approximate). */
const FOLD: Partial<Record<Network, number>> = { facebook: 480, instagram: 125, linkedin: 210, x: 280, threads: 500, tiktok: 150, youtube: 160, google_business: 300, pinterest: 100 };

function previewWhen(d: ComposerDraft): string {
  if (d.mode === 'now') return 'Just now';
  const at = d.when ? fromLocalInput(d.when) : null;
  if (!at) return 'Not scheduled';
  const p = inZone(at);
  const day = new Date(`${p.ymd}T12:00:00Z`);
  const wd = day.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const mon = day.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${wd} ${String(day.getUTCDate()).padStart(2, '0')} ${mon} at ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
}

function shortUrl(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

export function Preview({ draft, accounts, networks, campaign }: { draft: ComposerDraft; accounts: Account[]; networks: Network[]; campaign: Campaign | null | undefined }) {
  const [pick, setPick] = useState<Network | null>(null);
  const net = pick && networks.includes(pick) ? pick : (networks[0] ?? null);
  const account = net ? accounts.find((a) => draft.account_ids.includes(a.id) && a.network === net) : undefined;
  const text = textFor(draft, net);
  const parts = net ? (variantOf(draft, net).options.thread_parts ?? []).filter((p) => p.trim()) : [];
  const shown = parts.length > 1 ? parts[0]! : text;
  const fold = net ? (FOLD[net] ?? 300) : 300;
  const cut = [...shown].length > fold ? `${[...shown].slice(0, fold).join('').trimEnd()}` : null;
  const media = mediaFor(draft, net);
  const caps = net ? capabilitiesOf(net, account?.capabilities) : null;
  const link = draft.link.url.trim() || findLinks(text)[0]?.url || '';
  const tagged = link && net ? (draft.link.url.trim() ? taggedLink(draft, net, campaign) : link) : '';
  const name = account?.display_name ?? 'Your account';
  return (
    <Panel
      title="Preview"
      action={
        networks.length ? (
          <div role="group" aria-label="Preview network" className="flex gap-1">
            {networks.map((n) => (
              <button key={n} type="button" aria-pressed={n === net} aria-label={`Preview on ${networkInfo(n).label}`} onClick={() => setPick(n)} className={cx('rounded-[8px] p-0.5', n === net ? 'ring-2 ring-primary' : 'opacity-60 hover:opacity-100')}>
                <NetChip network={n} size={22} />
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <div className="rounded-[12px] border border-line bg-ground p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={name} size={34} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
            <div className="text-[11.5px] text-ink-3">
              {previewWhen(draft)} · {net && variantOf(draft, net).options.privacy && variantOf(draft, net).options.privacy !== 'public' ? variantOf(draft, net).options.privacy : 'Public'}
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
          {shown ? (cut ?? shown) : <span className="text-ink-3">The caption appears here.</span>}
          {cut ? <span className="text-ink-3"> … more</span> : null}
        </p>
        {parts.length > 1 ? <p className="mt-1 text-[11.5px] text-ink-3">+ {parts.length - 1} more part{parts.length > 2 ? 's' : ''} in the thread</p> : null}
        {media.length ? (
          <div className={cx('mt-2.5 grid gap-1', media.length === 1 ? 'grid-cols-1' : media.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
            {media.slice(0, 3).map((m, i) => (
              <div key={i} className="relative">
                <MediaTile media={m} label={false} className={media.length === 1 ? 'aspect-[4/5] w-full' : 'aspect-square w-full'} />
                {i === 2 && media.length > 3 ? <span className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/45 text-[15px] font-bold text-white">+{media.length - 3}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {tagged ? (
          caps?.links === 'card' && !media.length ? (
            <div className="mt-2.5 rounded-[10px] border border-line bg-surface px-3 py-2">
              <div className="truncate text-[12px] font-semibold text-ink">{shortUrl(link)}</div>
              <div className="truncate text-[11.5px] text-ink-3">{shortUrl(tagged)}</div>
            </div>
          ) : (
            <p className="mt-2.5 truncate text-[11.5px] text-ink-3" title={tagged}>
              Link: {shortUrl(link)} → {shortUrl(tagged)}
            </p>
          )
        ) : null}
      </div>
    </Panel>
  );
}
