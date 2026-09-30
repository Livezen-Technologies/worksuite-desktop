import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Modal, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { SignaturePad } from '../garage/parts';
import { day, errorText, K, money, pGet, pPost, pUpload } from './api';
import { device } from './devices';
import { Facts, Refusal, usePms } from './parts';
import { printPage, registrationCardHtml, type RegistrationCard } from './print';

/** The registration card with its signature, drawn as one picture to keep in Drive (PMS-CKI-004). */
export async function cardPicture(c: RegistrationCard, signature: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1000;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This computer could not draw the card.');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#111';
  let y = 70;
  const line = (text: string, size = 26, bold = false) => {
    g.font = `${bold ? '700 ' : ''}${size}px sans-serif`;
    g.fillText(text, 60, y);
    y += size * 1.6;
  };
  line(c.property.name ?? '', 38, true);
  line(`Registration card · ${c.confirmation_no ?? ''}`, 28);
  y += 20;
  line(`Guest: ${c.guest.name ?? ''}`, 28, true);
  if (c.guest.email || c.guest.phone) line([c.guest.email, c.guest.phone].filter(Boolean).join(' · '));
  if (c.guest.address) line(c.guest.address);
  if (c.guest.nationality) line(`Nationality: ${c.guest.nationality}`);
  y += 10;
  line(`Room ${c.room_number ?? '—'} · ${day(c.arrival_date, true)} → ${day(c.departure_date, true)}`, 28, true);
  line(`${c.adults} adult(s)${c.children ? `, ${c.children} child(ren)` : ''} · ${c.rate_plan ?? ''} · ${c.total !== null ? money(c.total, c.currency) : ''}`);
  const img = new Image();
  img.src = signature;
  await img.decode();
  g.drawImage(img, 60, y + 20, 600, 190);
  g.fillRect(60, y + 220, 640, 2);
  y += 260;
  line(`Signed ${new Date().toLocaleString()}`, 22);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The card could not be drawn.'))), 'image/png'));
}

/**
 * A stay's registration card: printed for a pen, or signed here — on the
 * signature pad when the desk has one (the device agent), else on the screen
 * with a mouse, pen or finger — and kept as the guest's document in Drive,
 * named on the stay.
 */
export default function RegistrationCardDialog({ stayId, guestId, reservationId, onClose }: { stayId: number; guestId: number; reservationId: number; onClose: () => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...K.stay(stayId), 'card'], queryFn: ({ signal }) => pGet<{ card: RegistrationCard }>(`/stays/${stayId}/registration-card`, undefined, signal) });
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState<'print' | 'keep' | 'pad' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pad = device('signature_pad');
  const card = q.data?.card;

  const print = async () => {
    if (!card) return;
    setBusy('print');
    try {
      await printPage({ title: `Registration card ${card.confirmation_no ?? ''}`, html: registrationCardHtml(card, sig), kind: 'registration_card' });
    } catch (e) {
      setError(errorText(e, 'The card could not be printed.'));
    } finally {
      setBusy(null);
    }
  };
  const fromPad = async () => {
    setBusy('pad');
    try {
      const s = await pad.capture('Please sign the registration card');
      if (s) setSig(s);
    } catch (e) {
      setError(errorText(e, 'The signature pad did not answer.'));
    } finally {
      setBusy(null);
    }
  };
  const keep = async () => {
    if (!card || !sig) return;
    setBusy('keep');
    setError(null);
    try {
      const picture = await cardPicture(card, sig);
      const doc = await pUpload<{ id: number }>(`/guests/${guestId}/documents`, picture, `registration-card-${card.confirmation_no ?? stayId}.png`, { kind: 'registration_card', property_id: pms.property.id, reservation_id: reservationId });
      const r = await pPost(`/stays/${stayId}/registration-card`, { document_id: doc.data.id });
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: K.stay(stayId) });
      onClose();
    } catch (e) {
      setError(errorText(e, 'The signed card was not kept.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Registration card"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button icon="printer" loading={busy === 'print'} disabled={!card || busy !== null} onClick={() => void print()}>
            Print
          </Button>
          <Button variant="primary" loading={busy === 'keep'} disabled={!sig || busy !== null || !pms.online} onClick={() => void keep()}>
            Keep the signed card
          </Button>
        </>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !card ? (
        <ErrorNote error={q.error ?? new Error('The card could not be read.')} />
      ) : (
        <div className="flex flex-col gap-3">
          <Facts
            rows={[
              ['Guest', card.guest.name],
              ['Room', card.room_number],
              ['Stay', `${day(card.arrival_date, true)} → ${day(card.departure_date, true)}`],
              ['Rate', card.rate_plan],
              ['Room total', card.total !== null ? money(card.total, card.currency) : '—'],
              ['Signed', card.signed ? 'A signed card is kept' : 'Not yet'],
            ]}
          />
          {pad.available() ? (
            <Button icon="pen" loading={busy === 'pad'} className="self-start" onClick={() => void fromPad()}>
              Sign on the signature pad
            </Button>
          ) : null}
          <SignaturePad onChange={setSig} label="The guest signs here with the mouse, a pen or a finger" />
          {error ? <Refusal text={error} /> : null}
        </div>
      )}
    </Modal>
  );
}
