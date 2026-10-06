import qrcode from 'qrcode-generator';
import { useEffect, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal } from '../../../components/ui';
import { isNotOffered, phoneApi, type Extension, type Provisioning } from '../api';
import { stamp } from '../lib/format';
import { CopyField } from '../parts';

/**
 * A03 · SIP secret shown once (VOIP-EXT-02/09). The password is in this answer only — stored encrypted, never
 * returned again — so it is shown with a plain warning, each field with Copy, and a provisioning QR a SIP app or
 * desk phone can scan before it expires. The person's own WorkSuite apps sign in by themselves; they need nothing
 * from here.
 */
export function SecretOnce({ ext, secret, domain, wsUri, onClose }: { ext: Extension; secret: string; domain: string | null; wsUri: string | null; onClose: () => void }) {
  const [prov, setProv] = useState<Provisioning | null>(null);
  const [provNote, setProvNote] = useState<string | null>(null);
  const [mailing, setMailing] = useState(false);
  useEffect(() => {
    let gone = false;
    phoneApi.provisioning(ext.id).then(
      (p) => !gone && setProv(p),
      (e: unknown) => !gone && setProvNote(isNotOffered(e) ? 'A provisioning QR needs a newer Voip module on the server. Type the details into the SIP app instead.' : (e as Error).message),
    );
    return () => {
      gone = true;
    };
  }, [ext.id]);
  const holder = ext.user_name ?? ext.name;
  const email = async () => {
    setMailing(true);
    try {
      const r = await phoneApi.setupEmail(ext.id);
      toast('success', r.message || `Setup guide sent to ${holder}.`);
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? 'Sending the setup guide needs a newer Voip module on the server.' : (e as Error).message);
    } finally {
      setMailing(false);
    }
  };
  return (
    <Modal
      width={640}
      onClose={onClose}
      labelledBy="secret-once-title"
      footer={
        <>
          <Button icon="mail" loading={mailing} onClick={() => void email()} disabled={!ext.user_id && !ext.email}>
            Email setup guide{ext.user_name ? ` to ${ext.user_name.split(' ')[0]}` : ''}
          </Button>
          <Button variant="primary" onClick={onClose}>
            I’ve saved it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-bg text-success">
            <Icon name="check" size={18} />
          </span>
          <div>
            <h2 id="secret-once-title" className="text-[16px] font-bold text-ink">
              Extension {ext.extension} is ready
            </h2>
            <p className="text-[12px] text-ink-3">
              {ext.user_name ? `Assigned to ${ext.user_name}` : 'Not assigned to anyone yet'}
              {ext.department ? ` · ${ext.department}` : ''}
              {ext.server ? ` · ${ext.server}` : ''}
            </p>
          </div>
        </div>
        <div className="rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning-ink dark:text-warning">
          <b>Copy the SIP password now.</b> It is stored encrypted and WorkSuite will never show it again. {holder}’s WorkSuite web and Desktop sign in automatically — you only need it for a desk phone or a mobile SIP app.
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
          <div className="flex flex-col gap-2.5">
            <CopyField label="SIP username" value={ext.extension} />
            <CopyField label="SIP password (shown once)" value={secret} secret />
            {domain ? <CopyField label="SIP domain / registrar" value={prov?.port ? `${domain}:${prov.port}${prov.transport ? ` (${prov.transport.toUpperCase()})` : ''}` : domain} /> : null}
            {wsUri ?? prov?.ws_uri ? <CopyField label="WebSocket (WebRTC)" value={(wsUri ?? prov?.ws_uri)!} /> : null}
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            {prov ? (
              <>
                <Qr text={prov.url} />
                <span className="text-[11px] text-ink-3">Scan in a SIP app · expires {stamp(prov.expires_at)}</span>
              </>
            ) : (
              <span className="text-[11.5px] text-ink-3">{provNote ?? 'Preparing a provisioning QR…'}</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Qr({ text, size = 156 }: { text: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push([c, r]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="Provisioning QR code" className="rounded-[8px] bg-white">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#151A2D" />
      ))}
    </svg>
  );
}
