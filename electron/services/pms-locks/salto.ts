import type { KeyPayload, LockOutcome, LockServer } from '@shared/pms-locks';
import { frame } from './frame';
import { exchange } from './link';
import { type Runner, clip, fillEncoder, fromShip, what, writtenCard } from './runner';

/**
 * Salto through SHIP (the SALTO Hotel Interface Protocol) to the hotel's Salto server, over TCP.
 *
 * The command and fields are WorkSuite's (`Locks/Salto.php`); this frames them — STX, command and fields joined by
 * SHIP's field separator (0xB3), ETX, LRC — sends them, waits for the ACK and the answer frame and acknowledges it.
 * The answer echoes the command when the Salto server did it; any other command (SHIP's error answer) is a refusal
 * whose fields are shown. A card read (`LT`) answers the rooms and the expiry.
 *
 * SHIP is licensed by Salto. The framing follows the protocol's published outline; the answer's field positions
 * (the read's rooms at 1–4 and its expiry at 6, hhmmDDMMYY) **must be confirmed against Salto's SHIP specification
 * during certification**, before a live site.
 */
export const SHIP_SEPARATOR = '³';

export const salto: Runner = {
  async run(server: LockServer, _secret: string | null, p: KeyPayload): Promise<LockOutcome> {
    const vf = p.vendor_fields;
    if (vf.protocol !== 'ship') return { ok: false, message: 'This payload is not for Salto SHIP.' };
    if (vf.command === 'ENQ') return this.test(server, null);
    const fields = fillEncoder(vf.fields, server.encoder);
    const answer = await exchange(server, frame(vf.command, fields, SHIP_SEPARATOR), SHIP_SEPARATOR);
    if (answer === 'ack') return { ok: true, message: what(p) };
    if (answer.command !== vf.command) {
      return { ok: false, message: `The Salto server refused it (${clip(answer.command, 8)}${answer.fields.length ? `: ${clip(answer.fields.join(' '))}` : ''}).` };
    }
    if (vf.command === 'LT') {
      const rooms = answer.fields.slice(1, 5).filter((r) => r.trim() !== '');
      return { ok: true, message: rooms.length ? `Card for room ${rooms.join(', ')}.` : 'A card with no guest room.', card: { rooms, valid_until: fromShip(answer.fields[6]) } };
    }
    return { ok: true, message: what(p), card: writtenCard(p) };
  },

  async test(server: LockServer): Promise<LockOutcome> {
    const started = Date.now();
    await exchange(server, 'enq', SHIP_SEPARATOR);
    return { ok: true, message: `The Salto server at ${server.host}:${server.port} answered.`, ms: Date.now() - started };
  },
};
