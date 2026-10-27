import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel, dayWords, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner } from '../../components/ui';
import { btnPrimary, btnSmall, Empty, Facts, Field, input, Panel } from '../../components/PageKit';
import { money } from './api';
import { saveTenderFile } from './files';
import { fetchLetters, fetchNotice, generateLetter, INSTRUMENTS, K2, labelOf, NOTICE_FIELDS, noticeBody, noticeDraft, saveNotice } from './work';

/**
 * The buyer's notice, transcribed: who the letters go to, the committee, how
 * the documents are issued and at what fee, how the envelopes are sealed.
 * What is kept elsewhere — the closing time, the pre-bid meeting, the bid
 * security — is shown beside it with where to change it, rather than typed
 * twice. From it, the request for the bid documents is written as a letter,
 * checked, and saved as a PDF.
 */
export default function Notice({ id, canManage }: { id: number; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.notice(id), queryFn: ({ signal }) => fetchNotice(id, signal) });
  const letters = useQuery({ queryKey: K2.letters(id), queryFn: ({ signal }) => fetchLetters(id, signal) });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<'save' | 'letter' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const n = q.data;
  const d = draft ?? noticeDraft(n.notice);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(noticeDraft(n.notice));
  const set = (k: string, v: string) => setDraft({ ...d, [k]: v });
  const save = async () => {
    const out = noticeBody(d);
    if (!out.body) return setError(out.error);
    setBusy('save');
    setError(null);
    try {
      await saveNotice(id, out.body);
      toast('success', 'The notice is recorded.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: K2.notice(id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const write = async () => {
    setBusy('letter');
    try {
      const r = await generateLetter(id);
      toast('success', `Letter ${r.number ?? ''} is ready. Check it over before it goes out.`.replace('  ', ' '));
      void qc.invalidateQueries({ queryKey: K2.letters(id) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const e = n.elsewhere;

  return (
    <div className="grid grid-cols-[3fr_2fr] gap-3.5">
      <Panel
        title="The buyer’s notice"
        sub={n.notice ? 'As transcribed from the published notice' : 'Not transcribed yet — the letters are written from it'}
        action={
          canManage ? (
            <button type="button" className={btnPrimary} disabled={busy !== null || !dirty} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          ) : undefined
        }
        bodyClassName="flex flex-col gap-2.5 px-3.5 py-3"
      >
        <div className="grid grid-cols-2 gap-2.5">
          {NOTICE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} className={f.long ? 'col-span-2' : undefined}>
              {f.long ? (
                <textarea
                  aria-label={f.label}
                  readOnly={!canManage}
                  value={d[f.key] ?? ''}
                  onChange={(ev) => set(f.key, ev.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
                />
              ) : (
                <input aria-label={f.label} readOnly={!canManage} value={d[f.key] ?? ''} onChange={(ev) => set(f.key, ev.target.value)} className={input} />
              )}
            </Field>
          ))}
          <Field label="Documents issued from">
            <input type="date" aria-label="Documents issued from" readOnly={!canManage} value={d.issuing_from ?? ''} onChange={(ev) => set('issuing_from', ev.target.value)} className={input} />
          </Field>
          <Field label="Until">
            <input type="date" aria-label="Documents issued until" readOnly={!canManage} value={d.issuing_to ?? ''} onChange={(ev) => set('issuing_to', ev.target.value)} className={input} />
          </Field>
          <Field label="Document fee">
            <span className="flex gap-1.5">
              <input aria-label="Document fee" inputMode="decimal" readOnly={!canManage} value={d.doc_fee_amount ?? ''} onChange={(ev) => set('doc_fee_amount', ev.target.value)} className={input} />
              <input aria-label="Fee currency" readOnly={!canManage} value={d.doc_fee_currency ?? ''} onChange={(ev) => set('doc_fee_currency', ev.target.value.toUpperCase().slice(0, 3))} placeholder="LKR" className={input + ' !w-[70px]'} />
            </span>
          </Field>
          <Field label="Fee terms" hint="“+ VAT”, “non-refundable” — kept apart from the figure.">
            <input aria-label="Fee terms" readOnly={!canManage} value={d.doc_fee_terms ?? ''} onChange={(ev) => set('doc_fee_terms', ev.target.value)} className={input} />
          </Field>
        </div>
        {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
      </Panel>
      <div className="flex min-w-0 flex-col gap-3.5">
        <Panel title="Kept elsewhere" sub="Changed where it lives, not here" bodyClassName="px-3.5 py-2.5 text-[12.5px]">
          <Facts
            rows={[
              ['Published', e.published_at ? dayWords(e.published_at.slice(0, 10), { year: true }) : null],
              ['Closing', e.closing_at ? `${dateLabel(e.closing_at)}, ${timeLabel(e.closing_at)}` : null],
              ['Pre-bid meeting', e.pre_bid?.scheduled_at ? `${dateLabel(e.pre_bid.scheduled_at)}, ${timeLabel(e.pre_bid.scheduled_at)}${e.pre_bid.venue ? ` · ${e.pre_bid.venue}` : ''}${e.pre_bid.mandatory ? ' · mandatory' : ''}` : 'Meetings tab'],
              [
                'Bid security',
                e.bid_security
                  ? `${money(e.bid_security.amount, e.bid_security.currency)} · ${labelOf(INSTRUMENTS, e.bid_security.instrument)}${e.bid_security.valid_until ? ` · until ${dayWords(e.bid_security.valid_until, { year: true })}` : ''}`
                  : 'Bonds tab',
              ],
            ]}
          />
        </Panel>
        <Panel
          title="Letters"
          sub="The request for the bid documents, written from the notice"
          action={
            canManage ? (
              <button type="button" className={btnSmall} disabled={busy !== null} onClick={() => void write()}>
                {busy === 'letter' ? 'Writing…' : 'Write the letter'}
              </button>
            ) : undefined
          }
          bodyClassName="flex flex-col"
        >
          {letters.data?.length ? (
            letters.data.map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                <Icon name="file" size={15} className="shrink-0 text-ink-3" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{[l.number, l.title].filter(Boolean).join(' · ')}</b>
                  <span className="text-[11.5px] text-ink-3">{[l.created_by, relative(l.created_at), l.pages ? `${l.pages} ${l.pages === 1 ? 'page' : 'pages'}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className={btnSmall + ' !h-7'} onClick={() => void saveTenderFile({ tenderLetter: { tender: id, letter: l.id } }, `${[l.number, l.title].filter(Boolean).join(' ')}.pdf`, true)}>
                  Open
                </button>
              </div>
            ))
          ) : (
            <Empty text={n.notice ? 'No letters yet.' : 'Transcribe the notice first; the letter is written from it.'} />
          )}
        </Panel>
      </div>
    </div>
  );
}
