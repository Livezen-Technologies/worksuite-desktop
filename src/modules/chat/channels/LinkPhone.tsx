import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { call } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { Button, Spinner } from '../../../components/ui';
import { actionLabel, linkErrorOf, linkView, pairingPhoneOk, qrCountdown, type LinkAnswer, type LinkError } from './linkFlow';
import { formatWaPhone, WA } from './whatsapp';

export interface LinkProgressData {
  loading: { percent: number; message: string } | null;
  sync: { state: 'running' | 'done' | 'failed'; percent: number | null; chats_done: number; chats_total: number | null; messages: number; error: string | null } | null;
  engine: string | null;
}

interface QrAnswer extends LinkAnswer {
  ok: boolean;
  status_note: string | null;
  error: string | null;
  progress?: LinkProgressData;
}

/** How long a baileys link waits for WhatsApp to start handing history over before calling it done. */
const HISTORY_GRACE_MS = 45_000;

type StepState = 'waiting' | 'active' | 'done' | 'failed';

/**
 * Where a link stands after the scan, as three steps and one bar: signed in, WhatsApp loading (its own percentage),
 * the chats coming in (how many of how many, or WhatsApp's percentage on baileys). The bar weighs them 10 / 40 / 50.
 */
export function linkSteps(state: string | null, linked: boolean, p: LinkProgressData | undefined, waited: boolean): { overall: number; done: boolean; steps: Array<{ key: string; label: string; state: StepState }> } {
  const loadingPct = linked ? 100 : (p?.loading?.percent ?? 0);
  const sync = p?.sync ?? null;
  const syncPct = !linked ? 0
    : sync?.state === 'done' || sync?.state === 'failed' || (!sync && waited) ? 100
    : sync?.chats_total ? Math.round((sync.chats_done / Math.max(1, sync.chats_total)) * 100)
    : sync?.percent ?? 0;
  const scanned = linked || state === 'authenticated' || state === 'authenticating' || !!p?.loading;
  const done = linked && syncPct >= 100;
  const syncLabel = !linked ? 'Syncing chats'
    : sync?.state === 'failed' ? 'Chats could not all be brought in'
    : done ? (sync && sync.chats_done ? `${sync.chats_done} chats synced · ${sync.messages} messages` : 'Chats synced')
    : sync?.chats_total ? `Syncing chats · ${sync.chats_done} of ${sync.chats_total}`
    : sync?.percent != null ? `Syncing chats · ${sync.percent}%` : 'Syncing chats…';
  return {
    overall: Math.min(100, Math.round((scanned ? 10 : 0) + loadingPct * 0.4 + syncPct * 0.5)),
    done,
    steps: [
      { key: 'scan', label: 'Scanned and signed in', state: scanned ? 'done' : 'active' },
      { key: 'load', label: linked ? 'WhatsApp loaded' : `Loading WhatsApp · ${loadingPct}%`, state: linked ? 'done' : scanned ? 'active' : 'waiting' },
      { key: 'sync', label: syncLabel, state: done ? (sync?.state === 'failed' ? 'failed' : 'done') : linked ? 'active' : 'waiting' },
    ],
  };
}

/** The bar and its steps, from the scan until the chats are in. */
export function LinkProgress({ steps, overall }: ReturnType<typeof linkSteps>) {
  return (
    <div className="flex w-full max-w-[320px] flex-col gap-3" aria-live="polite">
      <div role="progressbar" aria-label="Linking progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall} className="h-2 w-full overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full bg-success transition-[width] duration-700 ease-out" style={{ width: `${Math.max(4, overall)}%` }} />
      </div>
      <ol className="flex flex-col gap-2 text-left">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-[12px]">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.state === 'done' ? 'bg-success text-white' : s.state === 'failed' ? 'bg-warning text-white' : s.state === 'active' ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3'}`}>
              {s.state === 'done' ? <Icon name="check" size={12} /> : s.state === 'active' ? <span className="h-2 w-2 animate-pulse rounded-full bg-success" /> : s.state === 'failed' ? '!' : <span className="h-1.5 w-1.5 rounded-full bg-line" />}
            </span>
            <span className={s.state === 'waiting' ? 'text-ink-3' : 'font-semibold text-ink'}>{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Linking a phone to a WhatsApp Web number (worksuite-desktop#323): start the number's session, then ask every few
 * seconds for the code (WhatsApp replaces it every twenty or so, and the screen follows) and whether it has been
 * scanned — nothing tells the app when the phone has scanned it, so asking is the only way to know.
 *
 * Scan again, Retry and New code start a fresh link: the server closes the session, deletes the stored login and
 * starts over, so a new code comes up within seconds. "Link with phone number instead" asks WhatsApp for a pairing
 * code to type into the phone. Whatever goes wrong is said once, here, with its cause and the next step — and nothing
 * reads "starting" for more than a minute.
 */
export function LinkPhone({ accountId, onLinked }: { accountId: number; onLinked: () => void }) {
  const qc = useQueryClient();
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState<LinkError | null>(null);
  const done = useRef(false);
  // Each start: a number to re-run the effect, whether it is a fresh link, and when it began (the screen's own clock).
  const [attempt, setAttempt] = useState<{ n: number; fresh: boolean; at: number }>(() => ({ n: 0, fresh: false, at: Date.now() }));
  const [now, setNow] = useState(() => Date.now());
  // Linking by phone number: the number typed, the code WhatsApp gave, and why it did not (said in the form, not over it).
  const [pairing, setPairing] = useState<{ open: boolean; phone: string; busy: boolean; code: string | null; error: LinkError | null }>({ open: false, phone: '', busy: false, code: null, error: null });

  const again = () => {
    setFailed(null);
    setStarted(false);
    setPairing((p) => ({ ...p, busy: false, code: null, error: null }));
    qc.removeQueries({ queryKey: ['whatsapp', 'qr', accountId] });
    setAttempt((a) => ({ n: a.n + 1, fresh: true, at: Date.now() }));
  };

  useEffect(() => {
    let alive = true;
    // Starting is idempotent on the bridge: a second render cannot restart a session somebody is scanning. A fresh
    // link is asked for only by Scan again / Retry / New code.
    const url = `${WA}/accounts/${accountId}/link`;
    (attempt.fresh ? apiPost(url, { fresh: true }) : apiPost(url))
      .then(() => alive && setStarted(true))
      .catch((e: unknown) => alive && setFailed(linkErrorOf(e, 'browser_failed')));
    return () => {
      alive = false;
    };
  }, [accountId, attempt]);

  const importing = useRef(false);
  const [waited, setWaited] = useState(false);
  const [noImport, setNoImport] = useState(false);
  const qr = useQuery({
    queryKey: ['whatsapp', 'qr', accountId],
    queryFn: ({ signal }) => apiGet<QrAnswer>(`${WA}/accounts/${accountId}/qr`, undefined, signal),
    enabled: started && !failed,
    // After the scan it keeps asking, a little faster, until the chats are in: the bar is drawn from the answers.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.link_error) return false;
      if (!d?.linked) return d?.state === 'authenticated' || d?.state === 'authenticating' ? 1_500 : 3_000;
      const s = d.progress?.sync;
      return s?.state === 'done' || s?.state === 'failed' ? false : 2_000;
    },
    retry: false,
  });
  const linked = qr.data?.linked === true;
  const state = qr.data?.state ?? null;
  const progress = linkSteps(state, linked, qr.data?.progress, waited);
  const view = linkView({ startError: failed ?? (qr.error ? linkErrorOf(qr.error) : null), answer: qr.data, started, startedAt: attempt.at, now });
  const scanned = view.at === 'scanned' || (linked && !progress.done);
  const finished = linked && (progress.done || noImport);
  const connectedAs = qr.data?.attempt?.phone ? formatWaPhone(qr.data.attempt.phone) : null;

  // The clock: the code's countdown, and the minute after which a start that showed nothing is called timed out.
  const ticking = !linked && view.at !== 'error';
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [ticking]);

  // When the code on screen was first seen, so the countdown restarts as WhatsApp replaces it.
  const [seen, setSeen] = useState<{ qr: string | null; at: number }>({ qr: null, at: 0 });
  const code = view.at === 'qr' ? view.qr : null;
  if (code !== seen.qr) setSeen({ qr: code, at: Date.now() });

  // Linked: the number works now, and the chats already on the phone come in behind the bar. whatsapp-web.js imports
  // on request; baileys is handed the history by WhatsApp itself.
  useEffect(() => {
    if (!linked || importing.current) return;
    importing.current = true;
    void apiPost(`${WA}/accounts/${accountId}/check`).catch(() => undefined).finally(() => void qc.invalidateQueries({ queryKey: ['whatsapp'] }));
    if (qr.data?.progress?.engine !== 'baileys') void apiPost(`${WA}/accounts/${accountId}/import`, { background: true }).catch(() => setNoImport(true));
  }, [linked, accountId, qc, qr.data?.progress?.engine]);

  // Nothing to follow (an older bridge, or WhatsApp sending no history): the bar finishes rather than waiting forever.
  useEffect(() => {
    if (!linked) return;
    const t = setTimeout(() => setWaited(true), HISTORY_GRACE_MS);
    return () => clearTimeout(t);
  }, [linked]);

  useEffect(() => {
    if (!finished || done.current) return;
    done.current = true;
    void qc.invalidateQueries({ queryKey: ['whatsapp'] });
    // A beat on the finished bar, so the success is seen.
    const t = setTimeout(onLinked, 2_000);
    return () => clearTimeout(t);
  }, [finished, qc, onLinked]);

  const askForCode = async () => {
    if (!pairingPhoneOk(pairing.phone)) {
      setPairing((p) => ({ ...p, busy: false, error: linkErrorOf(null, 'invalid_phone') }));
      return;
    }
    setPairing((p) => ({ ...p, busy: true, error: null }));
    try {
      const r = await apiPost<{ code: string }>(`${WA}/accounts/${accountId}/pair`, { phone: pairing.phone.trim() });
      setPairing((p) => ({ ...p, busy: false, code: r.code }));
      void qr.refetch();
    } catch (e) {
      setPairing((p) => ({ ...p, busy: false, error: linkErrorOf(e, 'pairing_failed') }));
    }
  };
  const pairingCode = view.at === 'pairing' ? view.code : pairing.code;
  const waiting = view.at === 'qr' || view.at === 'starting' || view.at === 'pairing';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
        {view.at === 'error' ? (
          <LinkErrorPanel error={view.error} onAction={again} />
        ) : linked || scanned ? (
          <>
            <Icon name={finished ? 'check-circle' : 'phone'} size={40} className={finished ? 'text-success' : 'animate-pulse text-success'} />
            <b className="text-[14px] text-ink">{finished ? 'Linked and synced' : linked ? (connectedAs ? `Connected as ${connectedAs}` : 'Linked — bringing in your chats') : 'Linking…'}</b>
            <span className="text-[12px] text-ink-3">{linked ? (finished ? (qr.data?.status_note ?? '') : 'Bringing in your conversations.') : (qr.data?.progress?.loading?.message || 'Scanned. Keep the phone online until this finishes.')}</span>
            <LinkProgress {...progress} />
            {linked && !finished ? <button type="button" onClick={onLinked} className="text-[12px] font-semibold text-primary hover:underline">Continue in the background</button> : null}
          </>
        ) : pairingCode ? (
          <>
            <span className="text-[12px] text-ink-3">Enter this code on the phone</span>
            <b aria-label="Pairing code" className="rounded-[10px] bg-subtle px-4 py-2 font-mono text-[26px] tracking-[0.2em] text-ink">{pairingCode}</b>
          </>
        ) : view.at === 'qr' ? (
          <>
            <QrCode text={view.qr} />
            <span className="text-[11.5px] text-ink-3" aria-live="polite">
              {qrCountdown(seen.at, now) > 0 ? `New code in ${qrCountdown(seen.at, now)}s — it refreshes by itself.` : 'Refreshing the code…'}
            </span>
          </>
        ) : (
          <Spinner label={started ? 'Waiting for a code…' : 'Starting WhatsApp for this number…'} />
        )}
      </div>
      {waiting ? (
        pairing.open || pairingCode ? (
          <div className="flex flex-col gap-2 rounded-[8px] bg-subtle p-3 text-[12px] text-ink-2">
            {pairingCode ? (
              <ol className="flex flex-col gap-1">
                <li>1. Open WhatsApp on the phone that owns this number.</li>
                <li>2. Settings → Linked devices → Link a device.</li>
                <li>3. Choose Link with phone number instead, and enter the code above.</li>
              </ol>
            ) : (
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void askForCode(); }}>
                <label className="flex min-w-0 flex-1 flex-col gap-1 font-semibold text-ink">
                  Phone number of this WhatsApp
                  <input autoFocus value={pairing.phone} onChange={(e) => setPairing((p) => ({ ...p, phone: e.target.value }))} placeholder="+94 76 913 6424" inputMode="tel" className="h-[32px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium outline-none focus:border-primary" />
                </label>
                <Button type="submit" size="sm" variant="primary" loading={pairing.busy} disabled={!pairing.phone.trim()}>Get code</Button>
              </form>
            )}
            {pairing.error && !pairingCode ? (
              <p role="alert" className="m-0 text-danger"><b>{pairing.error.title}.</b> {pairing.error.message}</p>
            ) : null}
            <button type="button" className="self-start font-semibold text-primary hover:underline" onClick={() => { setPairing({ open: false, phone: pairing.phone, busy: false, code: null, error: null }); if (pairingCode) again(); }}>Scan a QR code instead</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-[8px] bg-subtle p-3 text-[12px] text-ink-2">
            <ol className="flex flex-col gap-1">
              <li>1. Open WhatsApp on the phone that owns this number.</li>
              <li>2. Settings → Linked devices → Link a device.</li>
              <li>3. Point the camera at the code above.</li>
            </ol>
            <button type="button" className="self-start font-semibold text-primary hover:underline" onClick={() => setPairing((p) => ({ ...p, open: true }))}>Link with phone number instead</button>
          </div>
        )
      ) : null}
      <p className="m-0 text-[11.5px] text-ink-3">
        WhatsApp Web links can be logged out by WhatsApp. For a support or sales number customers rely on, the WhatsApp Business Platform (Cloud API) is more reliable: no QR codes and no phone to keep online.{' '}
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: '/whatsapp' })}>Set it up on the web</button>
      </p>
    </div>
  );
}

/** The one place a link's error is shown: what happened, what to do, and the server's own words for an admin. */
export function LinkErrorPanel({ error, onAction }: { error: LinkError; onAction: () => void }) {
  const label = actionLabel(error.action);
  return (
    <div role="alert" className="flex max-w-sm flex-col items-center gap-2">
      <Icon name="warning" size={36} className="text-danger" />
      <b className="text-[14px] text-ink">{error.title}</b>
      <p className="m-0 text-[12.5px] text-ink-2">{error.message}</p>
      {label ? (
        <Button variant="primary" onClick={onAction}>
          <Icon name="refresh" size={14} /> {label}
        </Button>
      ) : (
        <button type="button" onClick={onAction} className="text-[12px] font-semibold text-primary hover:underline">Start over</button>
      )}
      {error.detail ? (
        <details className="w-full text-left text-[11.5px] text-ink-3">
          <summary className="cursor-pointer">Details for admin</summary>
          <p className="m-0 mt-1 break-words font-mono">{error.detail}</p>
        </details>
      ) : null}
    </div>
  );
}

/** A QR code on a white plate whatever the theme: a camera needs the contrast, and an inverted code often fails. */
export function QrCode({ text, size = 224 }: { text: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="QR code to link WhatsApp" className="shrink-0 rounded-[12px] shadow-[0_0_0_1px_var(--color-line)]" style={{ background: '#ffffff' }}>
      <path d={d} fill="#000000" shapeRendering="crispEdges" />
    </svg>
  );
}
