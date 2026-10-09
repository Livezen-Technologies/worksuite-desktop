import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { Spinner } from '../../../components/ui';
import { WA } from './whatsapp';

export interface LinkProgressData {
  loading: { percent: number; message: string } | null;
  sync: { state: 'running' | 'done' | 'failed'; percent: number | null; chats_done: number; chats_total: number | null; messages: number; error: string | null } | null;
  engine: string | null;
}

interface QrAnswer {
  ok: boolean;
  qr: string | null;
  state: string | null;
  linked: boolean;
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
 * Linking a phone to a WhatsApp Web number, as the web's LinkPhone does: start the number's session once, then ask
 * every three seconds for the code (it changes every twenty or so) and whether it has been scanned. Nothing tells the
 * app when the phone has scanned it, so asking is the only way to know.
 */
export function LinkPhone({ accountId, onLinked }: { accountId: number; onLinked: () => void }) {
  const qc = useQueryClient();
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    // Starting is idempotent on the bridge: a second render cannot restart a session somebody is scanning.
    apiPost(`${WA}/accounts/${accountId}/link`)
      .then(() => alive && setStarted(true))
      .catch((e: unknown) => alive && setFailed(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [accountId]);

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
      if (!d?.linked) return d?.state === 'authenticated' || d?.state === 'authenticating' ? 1_500 : 3_000;
      const s = d.progress?.sync;
      return s?.state === 'done' || s?.state === 'failed' ? false : 2_000;
    },
    retry: false,
  });
  const linked = qr.data?.linked === true;
  const state = qr.data?.state ?? null;
  const progress = linkSteps(state, linked, qr.data?.progress, waited);
  const scanned = !linked && (state === 'authenticated' || state === 'authenticating' || !!qr.data?.progress?.loading);
  const finished = linked && (progress.done || noImport);

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
        {failed ? (
          <p role="alert" className="max-w-sm rounded-[8px] bg-danger-bg p-3 text-[12.5px] text-danger">
            The number could not start linking. {failed}
          </p>
        ) : !started ? (
          <Spinner label="Starting WhatsApp for this number…" />
        ) : linked || scanned ? (
          <>
            <Icon name={finished ? 'check-circle' : 'phone'} size={40} className={finished ? 'text-success' : 'animate-pulse text-success'} />
            <b className="text-[14px] text-ink">{finished ? 'Linked and synced' : linked ? 'Linked — bringing in your chats' : 'Scanned — loading WhatsApp'}</b>
            <span className="text-[12px] text-ink-3">{linked ? (qr.data?.status_note ?? '') : (qr.data?.progress?.loading?.message || 'Keep the phone online until this finishes.')}</span>
            <LinkProgress {...progress} />
            {linked && !finished ? <button type="button" onClick={onLinked} className="text-[12px] font-semibold text-primary hover:underline">Continue in the background</button> : null}
          </>
        ) : qr.data?.qr ? (
          <>
            <QrCode text={qr.data.qr} />
            <span className="text-[11.5px] text-ink-3">The code changes every few seconds. That is normal.</span>
          </>
        ) : qr.data?.state === 'auth_failure' ? (
          <p className="max-w-sm text-[12.5px] text-ink-2">The phone unlinked this device. Scan the next code to link it again.</p>
        ) : qr.data?.status_note && !qr.data.qr ? (
          <Spinner label={qr.data.status_note} />
        ) : qr.error ? (
          <p role="alert" className="max-w-sm rounded-[8px] bg-danger-bg p-3 text-[12.5px] text-danger">{errorMessage(qr.error)}</p>
        ) : (
          <Spinner label="Waiting for a code…" />
        )}
      </div>
      {!linked && !scanned && !failed ? (
        <ol className="flex flex-col gap-1 rounded-[8px] bg-subtle p-3 text-[12px] text-ink-2">
          <li>1. Open WhatsApp on the phone that owns this number.</li>
          <li>2. Settings → Linked devices → Link a device.</li>
          <li>3. Point the camera at the code above.</li>
        </ol>
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
