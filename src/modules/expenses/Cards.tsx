import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { Caps, LoadFailed, Notice } from '../finance/parts';
import { btn, btnPrimary, btnSmall, Field, input, Kpi, PageHead, Seg, Sheet, SidePanel } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, K, money } from './api';
import {
  atLeast,
  BRANDS,
  brandLabel,
  CARD_STATES,
  cardName,
  fetchCards,
  fetchSuggestions,
  fetchTxns,
  importStatement,
  isRefund,
  matchTxn,
  MK,
  plural,
  refusedSentence,
  saveCard,
  TXN_PER_PAGE,
  TXN_SORTS,
  TXN_TONE,
  TXN_WORD,
  type Card,
  type CardDraft,
  type CardTxn,
  type ImportResult,
  type MatchAct,
  type TxnFilter,
} from './money';
import { Note, words } from './parts';
import type { ScreenProps } from './Rail';

/**
 * Corporate cards and their statements.
 *
 * THE IMPORT RESULT IS SHOWN IN FULL, INCLUDING WHAT WAS SKIPPED. People
 * re-download a statement to pick up the last three days, and the number that
 * matters is "3 imported, 47 already on file" — a silent skip and a silent
 * double are equally untrustworthy.
 *
 * MATCHING IS SUGGESTED, NEVER SILENT. The automatic pass links only on an
 * exact amount within three days and only when exactly one claim fits.
 * Everything else is a ranked suggestion with the reason written out, and a
 * person clicks.
 *
 * THE LIST PAGES; THE SUMMARY DOES NOT. An unmatched line older than the first
 * page is still counted in "Unmatched" above it — the figure counts the whole
 * company, which is what it has to mean on the one screen whose job is
 * reconciling a statement against claims.
 *
 * NO BULK. The two acts here are matching a line to a claim, which names one
 * claim per line, and setting one aside, which the server takes one line at a
 * time. A bulk "set aside" would be the fastest way to make a statement
 * reconcile by hiding the lines that did not.
 */
export default function Cards(props: ScreenProps) {
  if (props.orgId === null) return <Note>Corporate cards shows one company at a time. Choose one in the switcher.</Note>;
  return <CardsScreen {...props} orgId={props.orgId} />;
}

const TXN_COLS = { date: 104, card: 150, amount: 150, status: 130, act: 96 };

function CardsScreen({ orgId, orgs, onGo }: ScreenProps & { orgId: number }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const org = orgs.find((o) => o.id === orgId) ?? null;
  // The route asks for expense.manage; every act on this screen is the company's finance role on top.
  const may = can(perms, 'expense.manage') && atLeast(org, 'finance');
  const [tab, setTab] = useState<'transactions' | 'cards'>('transactions');
  const [status, setStatus] = useState<TxnFilter['status']>('unmatched');
  const [card, setCard] = useState('');
  const [sort, setSort] = useState<TxnFilter['sort']>('date');
  const [dir, setDir] = useState<TxnFilter['dir']>('desc');
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState('');
  const [importing, setImporting] = useState<Card | null>(null);
  const [editing, setEditing] = useState<Card | 'new' | null>(null);
  const [matching, setMatching] = useState<CardTxn | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setAsked(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const cards = useQuery({ queryKey: MK.cards(orgId), queryFn: ({ signal }) => fetchCards(orgId, signal), retry: false });
  const filter: TxnFilter = { status, card, q: asked, sort, dir };
  const txns = useInfiniteQuery({
    queryKey: MK.txns(orgId, filter),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchTxns(orgId, filter, pageParam, signal),
    getNextPageParam: (last, pages) => (pages.length * TXN_PER_PAGE < last.total ? pages.length + 1 : undefined),
    enabled: tab === 'transactions',
    retry: false,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (txns.data?.pages ?? []).flatMap((p) => p.items), [txns.data]);

  // The rail's badge and the quick bar count unmatched lines too.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: MK.cards(orgId) });
    void qc.invalidateQueries({ queryKey: [...K.all, 's'] });
  };
  const act = async (t: CardTxn, what: MatchAct, done: string) => {
    setBusy(t.id);
    try {
      const r = await matchTxn(orgId, t.id, what);
      toast('success', r.message ?? done);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  const cur = cards.data?.currency || org?.currency || '';
  const first = txns.data?.pages[0];
  const summary = first?.summary;
  const total = first?.total ?? 0;
  const refused = refusedSentence(cards.error);

  if (cards.isLoading) return <Spinner />;
  if (cards.error) return refused ? <Refused text={refused} /> : <LoadFailed what="The corporate cards" onRetry={() => void cards.refetch()} />;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Corporate cards" sub="Statements imported from a CSV, matched against claims.">
        <Seg
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'transactions', label: 'Transactions' },
            { id: 'cards', label: 'Cards' },
          ]}
        />
        {may ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> Add a card
          </button>
        ) : null}
      </PageHead>

      {tab === 'transactions' ? (
        <>
          <div className="grid max-w-[620px] grid-cols-2 gap-3">
            <Kpi label="On file" value={summary ? summary.total.toLocaleString() : '—'} />
            <Kpi
              label="Unmatched"
              value={summary ? summary.unmatched.toLocaleString() : '—'}
              sub={summary ? `${money(summary.unmatched_value, cur)} nobody has explained` : undefined}
              tone={summary && summary.unmatched > 0 ? 'amber' : undefined}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-[240px]">
              <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search merchant" aria-label="Search merchant" className={cx(input, 'h-8 pl-8')} />
            </label>
            <Select<TxnFilter['status']>
              aria-label="Filter by status"
              className="h-8 w-[140px]"
              value={status}
              onValueChange={setStatus}
              options={[
                { value: 'unmatched', label: 'Unmatched' },
                { value: 'matched', label: 'Matched' },
                { value: 'ignored', label: 'Set aside' },
                { value: '', label: 'All' },
              ]}
            />
            <Select
              aria-label="Filter by card"
              className="h-8 w-[200px]"
              value={card}
              onValueChange={setCard}
              options={[{ value: '', label: 'Any card' }, ...(cards.data?.items ?? []).map((c) => ({ value: String(c.id), label: cardName(c.label, c.last4) }))]}
            />
            <Select<TxnFilter['sort']> aria-label="Sort by" className="h-8 w-[150px]" value={sort} onValueChange={setSort} options={TXN_SORTS.map(([v, l]) => ({ value: v, label: `Sort: ${l}` }))} />
            <button type="button" className={cx(btnSmall, 'h-8 w-8 justify-center px-0')} aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'} title={dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
              <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />
            </button>
          </div>

          {txns.error && !rows.length ? (
            refusedSentence(txns.error) ? (
              <Notice tone="amber">{refusedSentence(txns.error)}</Notice>
            ) : (
              <LoadFailed what="The statement lines" onRetry={() => void txns.refetch()} />
            )
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
              <div className="min-w-[820px]">
                <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <span className="shrink-0" style={{ width: TXN_COLS.date }}>
                    Date
                  </span>
                  <span className="min-w-0 flex-1">Merchant</span>
                  <span className="shrink-0" style={{ width: TXN_COLS.card }}>
                    Card
                  </span>
                  <span className="shrink-0 text-right" style={{ width: TXN_COLS.amount }}>
                    Amount
                  </span>
                  <span className="shrink-0" style={{ width: TXN_COLS.status }}>
                    Status
                  </span>
                  <span className="shrink-0" style={{ width: TXN_COLS.act }} />
                </div>
                {txns.isLoading ? <Spinner /> : null}
                {rows.map((t) => (
                  <TxnRow key={t.id} t={t} may={may} busy={busy === t.id} onMatch={() => setMatching(t)} onAct={(what, done) => void act(t, what, done)} onClaim={(id) => onGo('organization', `&claim=${id}`)} />
                ))}
                {!txns.isLoading && !rows.length ? (
                  <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">
                    <b className="block text-ink-2">Nothing here.</b>
                    Import a statement from the Cards tab.
                  </div>
                ) : null}
                {rows.length ? (
                  <div className="flex items-center gap-2 border-t border-line bg-ground px-3.5 py-2 text-[12px] text-ink-3">
                    <span className="flex-1">
                      {rows.length.toLocaleString()} of {plural(total, 'line', 'lines')}
                    </span>
                    {txns.hasNextPage ? (
                      <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-50" disabled={txns.isFetchingNextPage} onClick={() => void txns.fetchNextPage()}>
                        {txns.isFetchingNextPage ? 'Loading…' : 'Load more'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <CardList cards={cards.data?.items ?? []} may={may} onImport={setImporting} onEdit={setEditing} />
      )}

      {tab === 'cards' && cards.data?.note ? <Notice tone="grey">{cards.data.note}</Notice> : null}

      {importing ? <ImportSheet orgId={orgId} card={importing} onClose={() => setImporting(null)} onDone={refresh} /> : null}
      {editing ? <CardSheet orgId={orgId} card={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {matching ? <MatchPanel key={matching.id} orgId={orgId} txn={matching} may={may} onClose={() => setMatching(null)} onDone={refresh} onClaim={(id) => onGo('organization', `&claim=${id}`)} /> : null}
    </div>
  );
}

/** A read refused on purpose: the server's sentence about this company, as said. */
function Refused({ text }: { text: string }) {
  return (
    <div className="px-6 py-5">
      <Notice tone="amber">{text}</Notice>
    </div>
  );
}

function TxnRow({ t, may, busy, onMatch, onAct, onClaim }: { t: CardTxn; may: boolean; busy: boolean; onMatch: () => void; onAct: (what: MatchAct, done: string) => void; onClaim: (id: number) => void }) {
  const refund = isRefund(t);
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0">
      <span className="shrink-0 text-ink-2 tabular-nums" style={{ width: TXN_COLS.date }}>
        {shortDate(t.txn_date)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ink">{t.merchant}</span>
        {t.reference ? <span className="truncate font-mono text-[11px] text-ink-3">{t.reference}</span> : null}
        {t.status === 'ignored' && t.note ? <span className="truncate text-[11.5px] text-ink-3">Set aside: {t.note}</span> : null}
      </span>
      <span className="shrink-0 truncate text-ink-2" style={{ width: TXN_COLS.card }}>
        {cardName(t.card, t.last4)}
      </span>
      <span className={cx('flex shrink-0 flex-col items-end font-semibold tabular-nums', refund ? 'text-[#166534] dark:text-success' : 'text-ink')} style={{ width: TXN_COLS.amount }}>
        {money(t.amount, t.currency)}
        {refund ? <span className="text-[11px] font-normal text-ink-3">refund</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-start gap-0.5" style={{ width: TXN_COLS.status }}>
        <Pill tone={TXN_TONE[t.status] ?? 'grey'}>{TXN_WORD[t.status] ?? words(t.status)}</Pill>
        {t.claim_no && t.claim_id ? (
          <button type="button" className="font-mono text-[11px] text-primary hover:underline" title="Open the claim" onClick={() => onClaim(t.claim_id!)}>
            {t.claim_no}
          </button>
        ) : null}
        {t.match_kind === 'auto' ? <span className="text-[10px] font-semibold tracking-[.3px] text-ink-3 uppercase">matched by rule</span> : null}
      </span>
      <span className="flex shrink-0 justify-end" style={{ width: TXN_COLS.act }}>
        {!may ? null : t.status === 'unmatched' ? (
          <button type="button" className={btnSmall} disabled={busy} onClick={onMatch}>
            Match
          </button>
        ) : t.status === 'matched' ? (
          <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-danger disabled:opacity-50" disabled={busy} onClick={() => onAct({ unlink: true }, 'Unmatched.')}>
            Unmatch
          </button>
        ) : (
          <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink disabled:opacity-50" disabled={busy} title="Put it back among the lines waiting for a claim" onClick={() => onAct({ unlink: true }, 'Unmatched.')}>
            Put back
          </button>
        )}
      </span>
    </div>
  );
}

const CARD_COLS = { holder: 170, lines: 70, unmatched: 190, act: 210 };

/** The cards: a handful of rows the server returns whole, so the search runs here. A company has cards, not a card ledger. */
function CardList({ cards, may, onImport, onEdit }: { cards: Card[]; may: boolean; onImport: (c: Card) => void; onEdit: (c: Card) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? cards.filter((c) => `${c.label} ${c.brand} ${c.last4 ?? ''} ${c.holder ?? ''}`.toLowerCase().includes(needle)) : cards;
  return (
    <>
      <label className="relative w-[260px]">
        <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search label, brand, holder" aria-label="Search cards" className={cx(input, 'h-8 pl-8')} />
      </label>
      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
        <div className="min-w-[780px]">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Card</span>
            <span className="shrink-0" style={{ width: CARD_COLS.holder }}>
              Held by
            </span>
            <span className="shrink-0 text-right" style={{ width: CARD_COLS.lines }}>
              Lines
            </span>
            <span className="shrink-0 text-right" style={{ width: CARD_COLS.unmatched }}>
              Unmatched
            </span>
            <span className="shrink-0" style={{ width: CARD_COLS.act }} />
          </div>
          {shown.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0">
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <Icon name="wallet" size={18} className="shrink-0 text-ink-3" />
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5">
                    <b className="truncate text-ink">{c.label}</b>
                    {c.status !== 'active' ? <Pill tone={c.status === 'blocked' ? 'red' : 'grey'}>{words(c.status)}</Pill> : null}
                  </span>
                  <span className="truncate text-[11px] tracking-[.4px] text-ink-3 uppercase">
                    {brandLabel(c.brand)}
                    {c.last4 ? ` ···· ${c.last4}` : ''}
                  </span>
                </span>
              </span>
              <span className={cx('shrink-0 truncate', c.holder ? 'text-ink-2' : 'text-ink-3')} style={{ width: CARD_COLS.holder }}>
                {c.holder ?? 'Not assigned to anybody'}
              </span>
              <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: CARD_COLS.lines }}>
                {c.transactions.toLocaleString()}
              </span>
              <span className="shrink-0 text-right tabular-nums" style={{ width: CARD_COLS.unmatched }}>
                {c.unmatched > 0 ? (
                  <span className="font-semibold text-[#9A4A06] dark:text-warning">
                    {c.unmatched.toLocaleString()} · {money(c.unmatched_value, c.currency)}
                  </span>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </span>
              <span className="flex shrink-0 items-center justify-end gap-2" style={{ width: CARD_COLS.act }}>
                {may ? (
                  <>
                    <button type="button" className={btnSmall} onClick={() => onImport(c)}>
                      <Icon name="upload" size={13} className="mr-1" /> Import a statement
                    </button>
                    <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => onEdit(c)}>
                      Edit
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
          {!shown.length ? (
            <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">
              {cards.length ? (
                'Nothing matches.'
              ) : (
                <>
                  <b className="block text-ink-2">No cards yet.</b>
                  Add a card, then import the statement your bank gives you.
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * The bank's CSV, chosen or pasted, and then everything the import did —
 * new, already on file, unreadable, and which rows and why.
 */
function ImportSheet({ orgId, card, onClose, onDone }: { orgId: number; card: Card; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const send = async (from: File | string) => {
    setBusy(true);
    try {
      setResult(await importStatement(orgId, card.id, from));
      void qc.invalidateQueries({ queryKey: [...MK.cards(orgId), 'txns'] });
      onDone();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Import a statement"
      width={560}
      onClose={onClose}
      footer={
        result ? (
          <button type="button" className={btnPrimary} onClick={onClose}>
            Done
          </button>
        ) : (
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
        )
      }
    >
      <span className="text-[12.5px] text-ink-3">{cardName(card.label, card.last4)}</span>
      {result ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Figure n={result.imported} label="new" tone="green" />
            <Figure n={result.duplicates} label="already on file" tone="grey" />
            <Figure n={result.rejected} label="not readable" tone="amber" />
          </div>
          <p className="m-0 text-[13px] text-ink-2">{result.message}</p>
          {result.problems.length ? (
            <Notice tone="amber">
              <b className="block">Rows that could not be read:</b>
              <ul className="m-0 mt-1 pl-4">
                {result.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </>
      ) : (
        <>
          <Notice tone="grey">Your bank&rsquo;s CSV. Columns are found by their header name, so the order does not matter — it needs a date, a description and an amount. The same statement imported twice adds nothing.</Notice>
          <input
            ref={file}
            type="file"
            hidden
            accept=".csv,text/csv"
            aria-label="Statement file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void send(f);
            }}
          />
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className="flex items-center justify-center gap-2 rounded-[12px] border border-dashed border-line px-4 py-6 text-[13px] font-semibold text-ink-2 hover:border-primary hover:text-primary disabled:opacity-50">
            <Icon name="upload" size={16} />
            {busy ? 'Reading…' : 'Choose a CSV file'}
          </button>
          <button type="button" className="self-start text-[12px] font-semibold text-ink-3 hover:text-ink" aria-expanded={pasting} onClick={() => setPasting((v) => !v)}>
            {pasting ? 'Hide the paste box' : 'Or paste it instead'}
          </button>
          {pasting ? (
            <>
              <textarea
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Statement contents"
                placeholder={'Date,Description,Amount\n01/07/2026,COFFEE SHOP,1250.00'}
                className="resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 font-mono text-[12px] text-ink outline-none focus:border-primary"
              />
              <button type="button" className={cx(btnPrimary, 'self-start')} disabled={busy || text.trim() === ''} onClick={() => void send(text)}>
                {busy ? 'Reading…' : 'Import what I pasted'}
              </button>
            </>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

function Figure({ n, label, tone }: { n: number; label: string; tone: 'green' | 'grey' | 'amber' }) {
  const c =
    tone === 'green'
      ? 'bg-[#EFF8F2] text-[#145C39] dark:bg-success-bg dark:text-success'
      : tone === 'amber'
        ? 'bg-[#FFF8E6] text-[#7A3B05] dark:bg-warning-bg dark:text-warning'
        : 'bg-subtle text-ink-2';
  return (
    <div className={cx('rounded-[10px] px-2 py-3', c)}>
      <b className="block text-[22px] leading-tight tabular-nums">{n.toLocaleString()}</b>
      <span className="text-[11.5px]">{label}</span>
    </div>
  );
}

/** Add or edit a card. Only the last four digits: a full number is refused, not truncated. */
function CardSheet({ orgId, card, onClose, onSaved }: { orgId: number; card: Card | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CardDraft>({ label: card?.label ?? '', brand: card?.brand ?? 'visa', last4: card?.last4 ?? '', status: card?.status ?? 'active' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveCard(orgId, f, card);
      toast('success', r.message ?? r.data?.message ?? 'Saved');
      onSaved();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={card ? 'Edit the card' : 'Add a card'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !f.label.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Field label="Name" hint="What people will recognise it as on a statement.">
        <input autoFocus value={f.label} maxLength={120} onChange={(e) => setF({ ...f, label: e.target.value })} className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand">
          <Select aria-label="Brand" className="w-full" value={f.brand} onValueChange={(v) => setF({ ...f, brand: v })} options={BRANDS.map((b) => ({ value: b as string, label: brandLabel(b) }))} />
        </Field>
        <Field label="Last four digits" hint="Only the last four. Full numbers are refused.">
          <input value={f.last4} maxLength={4} inputMode="numeric" onChange={(e) => setF({ ...f, last4: e.target.value })} className={input} />
        </Field>
      </div>
      <Field label="Status">
        <Select aria-label="Status" className="w-full" value={f.status} onValueChange={(v) => setF({ ...f, status: v })} options={CARD_STATES.map((s) => ({ value: s as string, label: words(s) }))} />
      </Field>
    </Sheet>
  );
}

/**
 * One statement line and the claims that could be it, ranked, each with its
 * reason in words — nothing here links anything until somebody clicks.
 */
function MatchPanel({ orgId, txn, may, onClose, onDone, onClaim }: { orgId: number; txn: CardTxn; may: boolean; onClose: () => void; onDone: () => void; onClaim: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MK.suggest(orgId, txn.id), queryFn: ({ signal }) => fetchSuggestions(orgId, txn.id, signal), retry: false });
  const [busy, setBusy] = useState(false);
  const pick = async (what: MatchAct, done: string) => {
    setBusy(true);
    try {
      const r = await matchTxn(orgId, txn.id, what);
      toast('success', r.message ?? done);
      void qc.invalidateQueries({ queryKey: [...MK.cards(orgId), 'txns'] });
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const items = q.data ?? [];

  return (
    <SidePanel
      label="Match a card line"
      width={580}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px] text-ink">{txn.merchant}</b>
          <span className="truncate text-[12px] text-ink-3">
            {shortDate(txn.txn_date)} · {money(txn.amount, txn.currency)}
            {txn.card ? ` · ${cardName(txn.card, txn.last4)}` : ''}
          </span>
        </span>
      }
    >
      <Caps>Claims that could be this</Caps>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? refusedSentence(q.error) ? <Notice tone="amber">{refusedSentence(q.error)}</Notice> : <LoadFailed what="The suggestions" onRetry={() => void q.refetch()} /> : null}
      {q.data && !items.length ? (
        <div className="rounded-[10px] border border-line px-3.5 py-3 text-[12.5px] text-ink-2">
          <b className="block text-ink">No claim looks like this transaction.</b>
          Either nobody has filed it yet, or it is not an expense at all — a bank fee, a refund, a personal charge already repaid.
        </div>
      ) : null}
      {items.length ? (
        <div className="overflow-hidden rounded-[10px] border border-line">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] text-ink">{c.description || 'No description'}</span>
                <span className="truncate text-[11.5px] text-ink-3">
                  <button type="button" className="font-mono text-primary hover:underline" title="Open the claim" onClick={() => onClaim(c.id)}>
                    {c.claim_no}
                  </button>
                  {c.claimant ? ` · ${c.claimant}` : ''} · {shortDate(c.spent_on)} · {money(c.amount, c.currency)}
                </span>
                {c.why ? <span className="text-[11.5px] font-semibold text-primary">{words(c.why)}</span> : null}
              </span>
              {may ? (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void pick({ claim_id: c.id }, 'Matched.')}>
                  Match
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {may ? (
        <div className="border-t border-line pt-3">
          <button type="button" className={btn} disabled={busy} onClick={() => void pick({ ignore: true, why: 'Not an expense claim' }, 'Set aside.')}>
            This does not need a claim — set it aside
          </button>
          <p className="m-0 mt-1.5 text-[11.5px] text-ink-3">It stays on the statement, recorded as not an expense claim, and stops waiting for one. Put it back from the list if that was wrong.</p>
        </div>
      ) : null}
    </SidePanel>
  );
}
