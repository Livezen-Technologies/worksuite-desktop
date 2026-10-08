import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { Spinner } from '../../../components/ui';
import { WA } from './whatsapp';

interface QrAnswer {
  ok: boolean;
  qr: string | null;
  state: string | null;
  linked: boolean;
  status_note: string | null;
  error: string | null;
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

  const qr = useQuery({
    queryKey: ['whatsapp', 'qr', accountId],
    queryFn: ({ signal }) => apiGet<QrAnswer>(`${WA}/accounts/${accountId}/qr`, undefined, signal),
    enabled: started && !failed,
    refetchInterval: (q) => (q.state.data?.linked ? false : 3_000),
    retry: false,
  });
  const linked = qr.data?.linked === true;

  useEffect(() => {
    if (!linked || done.current) return;
    done.current = true;
    // The number's own record says connected once it has been checked; the list and the toolbar read that.
    void apiPost(`${WA}/accounts/${accountId}/check`)
      .catch(() => undefined)
      .finally(() => {
        void qc.invalidateQueries({ queryKey: ['whatsapp'] });
        onLinked();
      });
  }, [linked, accountId, qc, onLinked]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
        {failed ? (
          <p role="alert" className="max-w-sm rounded-[8px] bg-danger-bg p-3 text-[12.5px] text-danger">
            The number could not start linking. {failed}
          </p>
        ) : !started ? (
          <Spinner label="Starting WhatsApp for this number…" />
        ) : linked ? (
          <>
            <Icon name="check-circle" size={44} className="text-success" />
            <b className="text-[14px] text-ink">Linked</b>
            <span className="text-[12px] text-ink-3">{qr.data?.status_note ?? 'Loading your conversations…'}</span>
          </>
        ) : qr.data?.state === 'authenticated' || qr.data?.state === 'authenticating' ? (
          // The bridge's own progress ("Loading your conversations — 63%"), so a long first load does not look stuck.
          <Spinner label={qr.data.status_note?.trim() || 'Scanned. Loading your conversations…'} />
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
      {!linked && !failed ? (
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
