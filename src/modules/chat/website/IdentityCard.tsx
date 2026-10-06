import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { useTab } from '../../../core/tab-context';
import { dateLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Chip, Modal, TextField, cx } from '../../../components/ui';
import { useWebsiteSearch } from './api';
import { IDENTITY_HINT, IDENTITY_LABEL, identity, knownName, refreshAfterIdentity, useVisitorProfile, type IdentityLevel, type MergePreview, type VisitorProfile } from './identity';
import { PANEL_CARD as CARD, PANEL_HEADING as HEADING } from './rowParts';

const TONE: Record<IdentityLevel, 'success' | 'indigo' | 'teal' | 'muted'> = { signed: 'success', verified: 'indigo', returning: 'teal', new: 'muted' };
const small = 'h-[26px] rounded-[7px] border border-line bg-surface px-2 text-[11.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-60';

/** Open a website chat in the inbox. */
function useOpenChat(): (id: number) => void {
  const { go } = useTab();
  return (id) => go(`/chat?view=website&section=inbox&website=${id}`);
}

/**
 * The visitor's profile in the details panel (worksuite-desktop#222): how we know them (Signed in, Verified email,
 * Returning browser, New), their visits and devices, Previous chats with links, "Possible same person" with Merge and
 * Dismiss, the merges that made them with Unmerge, their contact with its company and deals, and Delete visitor data.
 *
 * A server without returning visitors has no profile: `legacy` (the older Previous chats list) is shown instead.
 */
export function ProfileCards({ visitorId, conversationId, legacy }: { visitorId: number | null | undefined; conversationId: number; legacy: ReactNode }) {
  const q = useVisitorProfile(visitorId);
  const qc = useQueryClient();
  const open = useOpenChat();
  const [merging, setMerging] = useState<number | null | 'pick'>(null);
  const [erasing, setErasing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!visitorId || !q.data) return <>{legacy}</>;
  const p = q.data;
  const level = p.profile.identity;
  const earlier = p.chats.filter((c) => c.id !== conversationId);

  const run = async (fn: () => Promise<unknown>, done: string, undo?: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast('success', text(done), undo ? { label: text('Undo'), run: () => void undo().then(() => (toast('info', text('Undone.')), refreshAfterIdentity(qc)), (e) => toast('error', errorMessage(e))) } : undefined);
      refreshAfterIdentity(qc);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={CARD} aria-label={text('Who this is')}>
        <div className="flex items-center gap-2">
          <h3 className={cx(HEADING, 'flex-1')}>{text('Profile')}</h3>
          <Chip tone={TONE[level]}>{text(IDENTITY_LABEL[level])}</Chip>
        </div>
        <span className="text-[11.5px] text-ink-3">{text(IDENTITY_HINT[level])}</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-ink-3">{text('Visits')}</dt>
          <dd className="text-right font-semibold text-ink-2">{p.profile.visits > 1 ? text('{n} · this is the {nth}', { n: p.profile.visits, nth: p.profile.visit }) : '1'}</dd>
          {p.profile.first_seen ? (
            <>
              <dt className="text-ink-3">{text('First seen')}</dt>
              <dd className="text-right font-semibold text-ink-2">{dateLabel(p.profile.first_seen)}</dd>
            </>
          ) : null}
          {p.profile.last_seen ? (
            <>
              <dt className="text-ink-3">{text('Last seen')}</dt>
              <dd className="text-right font-semibold text-ink-2">{dateLabel(p.profile.last_seen)}</dd>
            </>
          ) : null}
        </dl>
        {p.devices.length ? (
          <div className="flex flex-col gap-0.5" aria-label={text('Devices')}>
            <span className="text-ink-3">{p.devices.length === 1 ? text('1 device') : text('{n} devices', { n: p.devices.length })}</span>
            {p.devices.slice(0, 4).map((d) => (
              <span key={d.id} className="flex items-center gap-1.5 text-ink-2">
                <Icon name={d.device === 'mobile' ? 'mobile' : 'monitor'} size={12} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{[d.browser, d.os].filter(Boolean).join(' · ') || d.label}</span>
                {d.last_seen ? <span className="shrink-0 text-[11px] text-ink-3">{dateLabel(d.last_seen)}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {p.suggestions.map((s) => (
        <div key={s.visitor_id} role="group" aria-label={text('Possible same person')} className={cx(CARD, 'border-warning/40 bg-warning-bg/40')}>
          <span className="text-ink-2">
            {text('Possible same person as {who} ({why})', { who: s.name || s.label, why: text(s.reason) })}
            {s.chats ? <span className="text-ink-3"> · {s.chats === 1 ? text('1 chat') : text('{n} chats', { n: s.chats })}</span> : null}
          </span>
          {p.can.merge ? (
            <span className="flex gap-1.5">
              <button type="button" disabled={busy} onClick={() => setMerging(s.visitor_id)} className={small}>{text('Merge')}</button>
              <button type="button" disabled={busy} onClick={() => void run(() => identity.dismiss(p.profile.id, s.visitor_id), 'Suggestion dismissed.')} className={small}>{text('Dismiss')}</button>
            </span>
          ) : null}
        </div>
      ))}

      <ContactLink p={p} busy={busy} onRun={run} />

      <div className={CARD}>
        <h3 className={HEADING}>{text('Previous chats · {n}', { n: earlier.length })}</h3>
        {earlier.slice(0, 6).map((c) => (
          <button key={c.id} type="button" onClick={() => open(c.id)} className="flex items-center gap-1.5 rounded-[6px] text-left text-ink-2 hover:text-primary hover:underline">
            <span className="min-w-0 flex-1 truncate">{c.started_at ? dateLabel(c.started_at) : text('Earlier')} · {text(c.status)}{c.rating ? ` · ${text('rated {n}/5', { n: c.rating })}` : ''}</span>
            <Icon name="chevron-right" size={12} className="shrink-0 text-ink-3" />
          </button>
        ))}
        {p.can.merge ? (
          <button type="button" onClick={() => setMerging('pick')} className="self-start text-[11.5px] font-semibold text-primary hover:underline">{text('Merge with another visitor…')}</button>
        ) : null}
      </div>

      {p.merges.length ? (
        <div className={CARD}>
          <h3 className={HEADING}>{text('Merged')}</h3>
          {p.merges.map((m) => (
            <span key={m.id} className="flex items-center gap-1.5 text-ink-2">
              <span className="min-w-0 flex-1">
                {m.merged.name || m.merged.label || text('A visitor')}
                <span className="text-ink-3"> · {m.kind === 'signed' ? text('signed in') : m.kind === 'verified' ? text('verified email') : m.by ?? text('an agent')} · {dateLabel(m.at)}</span>
                {m.undone_at ? <span className="text-ink-3"> · {text('unmerged')}</span> : null}
              </span>
              {m.can_undo && p.can.merge ? (
                <button type="button" disabled={busy} onClick={() => void run(() => identity.undo(m.id), 'Visitors unmerged.')} className={small}>{text('Unmerge')}</button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {p.can.erase ? (
        <button type="button" disabled={busy} onClick={() => setErasing(true)} className="h-8 rounded-[8px] border border-line bg-surface font-semibold text-danger hover:bg-danger-bg disabled:opacity-60">
          {text('Delete visitor data')}
        </button>
      ) : null}

      {merging !== null ? (
        <MergeDialog keepId={p.profile.id} keepName={knownName(p.profile)} otherId={merging === 'pick' ? null : merging} onClose={() => setMerging(null)} />
      ) : null}
      {erasing ? <EraseDialog p={p} onClose={() => setErasing(false)} /> : null}
    </>
  );
}

/** The contact they are linked to — name, company and deals — or the contacts their email or phone matches, to link. */
function ContactLink({ p, busy, onRun }: { p: VisitorProfile; busy: boolean; onRun: (fn: () => Promise<unknown>, done: string, undo?: () => Promise<unknown>) => Promise<void> }) {
  const c = p.contact;
  if (!c && !p.contact_matches.length) return null;
  return (
    <div className={CARD}>
      <h3 className={HEADING}>{text('Contact')}</h3>
      {c ? (
        <>
          <span className="flex items-center gap-1.5">
            <Icon name="user" size={13} className="shrink-0 text-ink-3" />
            <b className="min-w-0 flex-1 truncate text-ink">{c.name}</b>
          </span>
          {c.company || c.job_title ? <span className="text-ink-2">{[c.job_title, c.company].filter(Boolean).join(' · ')}</span> : null}
          {c.deals.length ? (
            <ul aria-label={text('Deals')} className="flex flex-col gap-0.5">
              {c.deals.map((d) => (
                <li key={d.id} className="flex gap-1.5 text-ink-2">
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="shrink-0 text-ink-3 tabular-nums">{d.currency} {d.amount.toLocaleString()}{d.state !== 'open' ? ` · ${text(d.state)}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {p.can.link ? (
            <button type="button" disabled={busy} onClick={() => void onRun(() => identity.link(p.profile.id, null), 'Contact unlinked.', () => identity.link(p.profile.id, c.id))} className="self-start text-[11.5px] font-semibold text-ink-3 hover:text-ink hover:underline">
              {text('Unlink')}
            </button>
          ) : null}
        </>
      ) : (
        p.contact_matches.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5 text-ink-2">
            <span className="min-w-0 flex-1 truncate">{m.name}{m.company ? ` · ${m.company}` : ''}</span>
            {p.can.link ? <button type="button" disabled={busy} onClick={() => void onRun(() => identity.link(p.profile.id, m.id), 'Linked to the contact.')} className={small}>{text('Link')}</button> : null}
          </span>
        ))
      )}
    </div>
  );
}

/**
 * Merge two visitors (#222): pick the other one — a suggestion, or anybody found by name or email — see what will
 * happen, then merge. Undo is on the toast, and Unmerge stays on the profile.
 */
export function MergeDialog({ keepId, keepName, otherId: initial = null, onClose }: { keepId: number; keepName: string; otherId?: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const profile = useVisitorProfile(keepId);
  const [needle, setNeedle] = useState('');
  const search = useWebsiteSearch(needle.trim(), false);
  const [other, setOther] = useState<number | null>(initial);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What merging would do, asked of the server for the visitor picked; nothing changes until Merge.
  const ask = useQuery({
    queryKey: ['website', 'merge-preview', keepId, other],
    queryFn: () => identity.preview(keepId, other!),
    enabled: other !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const preview: MergePreview | null = other !== null ? (ask.data ?? null) : null;
  const error = failed ?? (other !== null && ask.error ? (ask.error instanceof ApiError ? ask.error.message : errorMessage(ask.error)) : null);

  // Everybody else the search found, once each.
  const found = useMemo(() => {
    const seen = new Set<number>();
    return (search.data?.conversations ?? []).filter((r) => {
      const id = r.visitor_id;
      if (!id || id === keepId || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [search.data, keepId]);

  const merge = async () => {
    if (other === null) return;
    setBusy(true);
    try {
      const r = await identity.merge(keepId, other);
      onClose();
      toast('success', text('Visitors merged.'), {
        label: text('Undo'),
        run: () => void identity.undo(r.merge_id).then(() => (toast('info', text('Visitors unmerged.')), refreshAfterIdentity(qc)), (e) => toast('error', errorMessage(e))),
      });
      refreshAfterIdentity(qc);
    } catch (e) {
      setFailed(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = profile.data?.suggestions ?? [];
  return (
    <Modal
      title={text('Merge visitors')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={!preview || busy} loading={busy} onClick={() => void merge()}>{text('Merge')}</Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">{text('Merge another visitor into {name}: one person, with every conversation of both.', { name: keepName })}</p>
      {other === null ? (
        <div className="mt-3 flex flex-col gap-2">
          {suggestions.length ? (
            <div role="group" aria-label={text('Possible same person')} className="flex flex-col gap-1">
              {suggestions.map((s) => (
                <button key={s.visitor_id} type="button" onClick={() => (setFailed(null), setOther(s.visitor_id))} className="flex items-center gap-2 rounded-[8px] border border-line px-2.5 py-1.5 text-left text-[12.5px] hover:bg-subtle">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.name || s.label}</span>
                  <span className="shrink-0 text-ink-3">{text(s.reason)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <TextField label={text('Find a visitor')} placeholder={text('Name or email')} value={needle} onChange={(e) => setNeedle(e.target.value)} autoFocus />
          <div role="listbox" aria-label={text('Visitors found')} className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {found.map((r) => (
              <button key={r.visitor_id} type="button" role="option" aria-selected={false} onClick={() => (setFailed(null), setOther(r.visitor_id!))} className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-subtle">
                <span className="min-w-0 flex-1 truncate text-ink">{r.visitor_name || r.label}</span>
                <span className="shrink-0 truncate text-ink-3">{r.email ?? r.site ?? ''}</span>
              </button>
            ))}
            {needle.trim().length >= 2 && search.isSuccess && !found.length ? <span className="text-[12px] text-ink-3">{text('Nobody else matches.')}</span> : null}
          </div>
        </div>
      ) : preview ? (
        <div role="region" aria-label={text('What merging does')} className="mt-3 flex flex-col gap-1.5 rounded-[8px] bg-subtle px-3 py-2.5 text-[12.5px] text-ink-2">
          <span>
            <b className="text-ink">{preview.merge.name || preview.merge.label}</b> {text('joins')} <b className="text-ink">{preview.keep.name || preview.keep.label}</b>
          </span>
          <span>{text('Shown as {name}, with {n} chats.', { name: preview.name, n: preview.chats_total })}</span>
          {preview.closes ? <span>{text('Both have a chat going: the one started {when} closes, the latest continues.', { when: preview.closes.started_at ? dateLabel(preview.closes.started_at) : text('earlier') })}</span> : null}
          <span className="text-ink-3">{text('You can undo this, now or later, from the profile.')}</span>
          {initial === null ? <button type="button" onClick={() => setOther(null)} className="self-start text-[12px] font-semibold text-primary hover:underline">{text('Choose someone else')}</button> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p> : null}
    </Modal>
  );
}

/** Delete visitor data (GDPR, PDPA): everything about this person, after saying exactly that. */
function EraseDialog({ p, onClose }: { p: VisitorProfile; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const erase = async () => {
    setBusy(true);
    try {
      await identity.erase(p.profile.id);
      onClose();
      toast('success', text('Visitor data deleted.'));
      refreshAfterIdentity(qc);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Delete this visitor\'s data?')}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={busy} onClick={() => void erase()}>{text('Delete everything')}</Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">
        {text('{name}, their {devices} and their {chats} — every message and file — are deleted for good. This cannot be undone.', {
          name: knownName(p.profile),
          devices: p.devices.length === 1 ? text('device') : text('{n} devices', { n: p.devices.length }),
          chats: p.chats.length === 1 ? text('1 chat') : text('{n} chats', { n: p.chats.length }),
        })}
      </p>
    </Modal>
  );
}
