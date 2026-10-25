import type { HostJob, HostJobState, LabelConnection, LabelLanguage, PrinterState } from '@shared/label';
import { checkCommand, checkEnvelope, type CommandCheck, type EnvelopeCheck, type PrinterCommand } from './envelope';
import { sendSpooler, sendTcp, zebraStatus, type SendOutcome } from './raw-out';

/**
 * CorePrintService — the one print host behind both the desktop module and the Print Gateway (WS-LABEL-SRS-001
 * FR-DSK-02/05/06, FR-GWY-04/05, FR-QUE-05, WF-07, C-08), over the server's claim / chunk / progress contract
 * (server docs/label-api.md, "Desktop print host" and "Print Gateway device API").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER KEEPS THE QUEUE; THIS COMPUTER KEEPS A JOURNAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * As the Restaurant print agent does (restaurant/print-agent.ts), the host claims the jobs waiting for its approved
 * printers (`claim`, a 60-second lease renewed by every progress call). A job comes as `chunks` of `chunk_size`
 * labels starting at `first_chunk`; a chunk holds only the labels still to print (`empty` when none), so a job the
 * server re-offers never brings back what was confirmed. The host fetches each chunk itself, checks its signed
 * envelope (envelope.ts), sends the bytes raw and reports `labels_confirmed` — the claim's count plus what this
 * attempt printed — after every chunk. The server's `instruction` (paused, cancelled) or a 409 `LEASE_LOST` stops it.
 *
 * The journal (FR-DSK-06's small local queue) is written before and after every send:
 *
 *  - before a chunk goes out its range is written as `inflight`; when the printer took it, `confirmed` moves on and
 *    `inflight` is cleared. A count the server did not hear (a lost progress call) is sent again: the confirmed
 *    count is the larger of the server's and the journal's, so no confirmed label is ever sent twice;
 *  - a job found `inflight` — this computer stopped mid-send — has those labels `uncertain`. Where a person is at
 *    the computer (the desktop host, D05) nothing more prints until they say what came out, the lease kept alive
 *    meanwhile; a gateway reports `stopped` and the server decides: a sequence job goes PARTIAL with those values
 *    uncertain for reconciliation (W14), never resumed by itself (C-08);
 *  - a printer that is not ready before a chunk (paper out, head open, ribbon out, paused — a Zebra on TCP is asked
 *    `~HS`) holds the job here for up to two minutes with the lease renewed, then reports `paused` with nothing sent:
 *    no label is uncertain. A send the spooler refused (nothing printed) is `paused` the same way; a TCP send cut
 *    off after bytes left is `stopped` with its labels uncertain.
 *
 * A printer is reachable only through `target()`: the host's allow-list of printers it has itself (OS queues it
 * listed, LAN printers added here). A job for any other printer or address is refused, as is a bad signature, a
 * foreign company or an expired envelope.
 */

/** A job as the server's claim hands it over (`Queue::claim`). */
export interface ClaimedJob {
  job_id: number;
  code: string;
  attempt_id: number;
  lease_until?: string | null;
  printer_id: number;
  printer: {
    connection?: { kind?: string | null; address?: string | null; port?: number | null; os_name?: string | null } | null;
    language?: string | null;
    provider?: string | null;
    dpi?: number | null;
    name?: string | null;
  };
  labels_total: number;
  labels_confirmed: number;
  chunk_size: number;
  chunks: number;
  first_chunk: number;
  content_type?: string | null;
}

export interface ChunkData {
  envelope: unknown;
  payload_base64: string;
  labels?: Array<{ seq_no: number; item_id: number }>;
  empty?: boolean;
}

export type ProgressState = 'printing' | 'completed' | 'failed' | 'paused' | 'stopped';

export interface ProgressReport {
  attempt_id: number;
  labels_confirmed: number;
  state: ProgressState;
  printer_status?: string;
  error_code?: string;
  message?: string;
}

export interface ProgressAnswer {
  status?: string;
  instruction?: 'paused' | 'cancelled' | null;
}

/** How a host reaches the server: the signed-in person's session (desktop) or the gateway's device token. */
export interface HostTransport {
  org(): number | null;
  keys(): Promise<Readonly<Record<string, string>>>;
  claim(max: number): Promise<ClaimedJob[]>;
  chunk(jobId: number, n: number): Promise<ChunkData>;
  /** Throws an error whose `code` is LEASE_LOST when the host no longer holds the job. */
  progress(jobId: number, report: ProgressReport): Promise<ProgressAnswer | null>;
  /** Desktop only (the person's session): resume a job this host paused, once the printer is ready again. */
  resume?(jobId: number): Promise<void>;
  cancel?(jobId: number): Promise<void>;
}

export interface PrintTarget {
  key: string;
  connection: LabelConnection;
  address: string;
  port: number | null;
  language: LabelLanguage;
}

interface Entry extends HostJob {
  claim: ClaimedJob | null;
  inflight: { from: number; to: number; chunk: number } | null;
  holdingSince: number | null;
  /** Paused on the server by this host (nothing uncertain): resumed when the printer is ready again (desktop). */
  pausedByHost: boolean;
  cancelAsked: boolean;
}

export interface JournalStore {
  read(): Record<string, Entry> | undefined;
  write(v: Record<string, Entry>): void;
}

export interface CorePrintDeps {
  transport: HostTransport;
  journal: JournalStore;
  /** The printer a claim names, if it is one of this host's own; null refuses the job. */
  target: (printer: ClaimedJob['printer'], printerId: number) => PrintTarget | null;
  /** A person is at this host (desktop): uncertain labels wait for them instead of going back to the server. */
  person: boolean;
  changed: () => void;
  onCheck?: (job: string, r: EnvelopeCheck) => void;
  onPrinterState?: (printerId: number, key: string, state: PrinterState, message: string | null) => void;
  send?: (t: PrintTarget, bytes: Buffer) => Promise<SendOutcome>;
  status?: (t: PrintTarget) => Promise<PrinterState>;
  now?: () => number;
}

const KEEP_DONE = 30;
export const HOLD_MS = 2 * 60_000;
const ACTIVE: HostJobState[] = ['queued', 'printing', 'waiting_printer', 'paused', 'interrupted'];

export async function defaultSend(t: PrintTarget, bytes: Buffer): Promise<SendOutcome> {
  return t.connection === 'tcp' ? sendTcp(t.address, t.port ?? 9100, bytes) : sendSpooler(t.address, bytes);
}

/** Only a raw-TCP Zebra can be asked how it is; any other printer is taken as ready and answers by failing. */
export async function defaultStatus(t: PrintTarget): Promise<PrinterState> {
  return t.connection === 'tcp' && t.language === 'zpl' ? zebraStatus(t.address, t.port ?? 9100) : 'ready';
}

/** The server's printer status words (READY, PAPER_OUT …). */
export const serverStatus = (s: PrinterState): string => s.toUpperCase();

const leaseLost = (e: unknown): boolean => !!e && typeof e === 'object' && ((e as { code?: string }).code === 'LEASE_LOST' || (e as { status?: number }).status === 409);

export class CorePrintService {
  private chain: Promise<unknown> = Promise.resolve();
  private running: string | null = null;
  private lastClaim: string | null = null;
  private problem: string | null = null;

  constructor(private readonly d: CorePrintDeps) {}

  private nowMs(): number {
    return this.d.now?.() ?? Date.now();
  }

  private stamp(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private all(): Record<string, Entry> {
    const v = this.d.journal.read();
    return v && typeof v === 'object' ? v : {};
  }

  private save(e: Entry): Entry {
    const next = { ...e, updatedAt: this.stamp() };
    const all = { ...this.all(), [e.id]: next };
    const done = Object.values(all)
      .filter((x) => !ACTIVE.includes(x.state))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    for (const old of done.slice(KEEP_DONE)) delete all[old.id];
    this.d.journal.write(all);
    this.d.changed();
    return next;
  }

  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private readonly nonces = new Set<string>();

  /**
   * A heartbeat command's printer bytes (status, calibrate, cancel; Label 1.1): sent to the printer only once its
   * envelope verified (envelope.ts `checkCommand`), and in turn with the jobs, never in the middle of a chunk.
   */
  async command(cmd: PrinterCommand, target: PrintTarget | null): Promise<CommandCheck & { sent?: boolean }> {
    const r = checkCommand(cmd, await this.d.transport.keys(), this.nonces, this.nowMs());
    this.d.onCheck?.(`command ${String(cmd.type)} · printer ${String(cmd.printer_id)}`, r.ok ? { ok: true } : r);
    if (!r.ok || !r.bytes || !target) return r;
    const bytes = r.bytes;
    const out = await this.serialise(() => (this.d.send ?? defaultSend)(target, bytes));
    return { ...r, sent: out.ok };
  }

  /* ── What the screens read ──────────────────────────────────────── */

  jobs(): HostJob[] {
    return Object.values(this.all())
      .map(({ claim: _c, inflight: _i, holdingSince: _h, pausedByHost: _p, cancelAsked: _a, ...j }) => j)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  job(id: string): HostJob | null {
    return this.jobs().find((j) => j.id === id) ?? null;
  }

  current(): HostJob | null {
    return this.running ? this.job(this.running) : null;
  }

  health(): { lastClaimAt: string | null; problem: string | null } {
    return { lastClaimAt: this.lastClaim, problem: this.problem };
  }

  forgetAll(): void {
    this.d.journal.write({});
  }

  /* ── The loop ───────────────────────────────────────────────────── */

  /** Carry on with the journal's held jobs, then claim what waits for this host's printers. */
  tick(): Promise<number> {
    return this.serialise(async () => {
      let n = 0;
      for (const e of Object.values(this.all())) {
        if (!e.claim) continue;
        if (e.state === 'waiting_printer') {
          await this.run(e.claim);
          n++;
        } else if (e.state === 'paused' && e.pausedByHost) {
          await this.resumeWhenReady(e);
        } else if (e.state === 'interrupted' && e.uncertain && this.d.person) {
          await this.keepLease(e);
        }
      }
      let claimed: ClaimedJob[];
      try {
        claimed = await this.d.transport.claim(5);
        this.lastClaim = this.stamp();
        this.problem = null;
      } catch (e) {
        this.problem = e instanceof Error ? e.message : String(e);
        this.d.changed();
        return n;
      }
      for (const job of claimed.slice(0, 20)) {
        await this.run(job);
        n++;
      }
      return n;
    });
  }

  /** `label.send`: the renderer made a job for one of this host's printers; claim and print now. */
  async send(jobId: string): Promise<HostJob> {
    await this.tick();
    return this.job(jobId) ?? { id: jobId, ref: null, template: null, printerId: '', printerKey: null, total: 0, confirmed: 0, sequence: false, state: 'queued', uncertain: null, error: 'Waiting for the printer’s earlier jobs.', printerState: null, updatedAt: this.stamp() };
  }

  /** `label.cancel`: stop after the chunk going out now, and cancel on the server. */
  async cancel(jobId: string): Promise<HostJob | null> {
    const e = this.all()[jobId];
    if (e && ACTIVE.includes(e.state)) this.save(this.running === jobId ? { ...e, cancelAsked: true } : { ...e, state: 'cancelled', cancelAsked: true, uncertain: null });
    await this.d.transport.cancel?.(Number(jobId));
    return this.job(jobId);
  }

  /**
   * D05 on the desktop: what a person saw of the uncertain labels after this computer stopped mid-send. `printed`
   * (or `void`: not to be printed again) counts them; `reprint` sends them again; `stop` cancels the job.
   */
  resolve(jobId: string, decision: 'printed' | 'reprint' | 'void' | 'stop', lastPrinted?: number): Promise<HostJob> {
    return this.serialise(async () => {
      const e = this.all()[jobId];
      if (!e?.uncertain || e.state !== 'interrupted') throw Object.assign(new Error('The job is not waiting for a decision on this computer.'), { code: 'CONFLICT' });
      const u = e.uncertain;
      if (decision === 'stop') {
        this.save({ ...e, state: 'cancelled', uncertain: null });
        await this.d.transport.cancel?.(Number(jobId));
        return this.job(jobId)!;
      }
      const confirmed = decision === 'reprint' ? u.from : decision === 'printed' && lastPrinted !== undefined ? Math.max(u.from, Math.min(u.to, lastPrinted)) : u.to;
      const next = this.save({ ...e, confirmed, uncertain: null, error: null, state: 'queued' });
      if (next.claim) {
        try {
          if (confirmed > (next.claim.labels_confirmed ?? 0)) await this.d.transport.progress(next.claim.job_id, { attempt_id: next.claim.attempt_id, labels_confirmed: confirmed, state: 'printing' });
          await this.run(next.claim);
        } catch (err) {
          if (leaseLost(err)) this.save({ ...next, state: 'failed', error: 'WorkSuite took the job back meanwhile; it will be offered again.' });
          else throw err;
        }
      }
      return this.job(jobId)!;
    });
  }

  /* ── One job ────────────────────────────────────────────────────── */

  private entryFor(job: ClaimedJob): Entry {
    const id = String(job.job_id);
    const prev = this.all()[id];
    return {
      id,
      ref: job.code ?? prev?.ref ?? null,
      template: prev?.template ?? null,
      printerId: String(job.printer_id),
      printerKey: prev?.printerKey ?? null,
      total: job.labels_total,
      confirmed: Math.max(prev?.confirmed ?? 0, job.labels_confirmed ?? 0),
      sequence: prev?.sequence ?? false,
      state: prev && prev.claim?.attempt_id === job.attempt_id ? prev.state : 'queued',
      uncertain: prev?.uncertain ?? null,
      error: prev?.error ?? null,
      printerState: prev?.printerState ?? null,
      updatedAt: prev?.updatedAt ?? this.stamp(),
      claim: job,
      inflight: prev?.inflight ?? null,
      holdingSince: prev && prev.claim?.attempt_id === job.attempt_id ? prev.holdingSince : null,
      pausedByHost: false,
      cancelAsked: prev?.cancelAsked ?? false,
    };
  }

  private async report(e: Entry, state: ProgressState, extra: Partial<ProgressReport> = {}): Promise<ProgressAnswer | null> {
    if (!e.claim) return null;
    try {
      return await this.d.transport.progress(e.claim.job_id, { attempt_id: e.claim.attempt_id, labels_confirmed: e.confirmed, state, ...extra });
    } catch (err) {
      if (leaseLost(err)) throw err;
      return null; // sent again with the next report: the journal keeps the count
    }
  }

  /** Waiting for a person (D05): the lease is renewed so the job is not given to another host meanwhile. */
  private async keepLease(e: Entry): Promise<void> {
    try {
      await this.report(e, 'printing');
    } catch {
      this.save({ ...e, state: 'failed', error: 'WorkSuite took the job back while it waited; it will be offered again.', claim: null });
    }
  }

  /** A job this host paused with nothing uncertain goes on when its printer is ready (FR-DSK-06; the desktop's session). */
  private async resumeWhenReady(e: Entry): Promise<void> {
    if (!this.d.transport.resume || !e.claim) return;
    const t = this.d.target(e.claim.printer, e.claim.printer_id);
    if (!t) return;
    const ps = await (this.d.status ?? defaultStatus)(t);
    if (ps !== 'ready') return;
    try {
      await this.d.transport.resume(e.claim.job_id);
      this.save({ ...e, state: 'queued', pausedByHost: false, error: null, claim: null });
    } catch {
      /* someone resumed or cancelled it on the web: the queue says */
    }
  }

  private async run(job: ClaimedJob): Promise<void> {
    let e = this.entryFor(job);
    // A finished or paused job comes back only as a new attempt (entryFor makes that one `queued`).
    if (e.state === 'done' || e.state === 'cancelled' || e.state === 'failed' || e.state === 'paused') return;
    this.running = e.id;
    try {
      if (e.cancelAsked) {
        this.save({ ...e, state: 'cancelled' });
        return;
      }
      if (e.inflight) {
        // This computer stopped while a chunk was going out: whether it printed is not known.
        e = this.save({ ...e, uncertain: { from: e.inflight.from, to: e.inflight.to }, inflight: null, state: 'interrupted', error: 'This computer stopped while these labels were being sent.' });
        if (this.d.person) await this.report(e, 'printing');
        else {
          await this.report(e, 'stopped', { error_code: 'HOST_RESTARTED', message: e.error ?? undefined });
          this.save({ ...e, state: 'failed', claim: null });
        }
        return;
      }
      if (e.state === 'interrupted' && e.uncertain) {
        if (this.d.person) await this.report(e, 'printing');
        return;
      }
      if (e.confirmed > (job.labels_confirmed ?? 0)) await this.report(e, 'printing'); // a count the server did not hear
      const target = this.d.target(job.printer, job.printer_id);
      if (!target) {
        e = this.save({ ...e, state: 'failed', error: 'The job is for a printer this computer does not have.' });
        await this.report(e, 'failed', { error_code: 'PRINTER_NOT_HERE', message: e.error ?? undefined });
        return;
      }
      e = { ...e, printerKey: target.key };
      const keys = await this.d.transport.keys();
      const send = this.d.send ?? defaultSend;
      const status = this.d.status ?? defaultStatus;
      for (let n = Math.max(0, job.first_chunk); n < job.chunks; n++) {
        if (this.all()[e.id]?.cancelAsked) {
          this.save({ ...e, state: 'cancelled' });
          return;
        }
        // A chunk every label of which is confirmed is not asked for (the server would answer it empty).
        if ((n + 1) * Math.max(1, job.chunk_size) <= e.confirmed) continue;
        const ps = await status(target);
        this.d.onPrinterState?.(job.printer_id, target.key, ps, null);
        if (ps !== 'ready' && ps !== 'printing' && ps !== 'unknown') {
          const since = e.holdingSince ?? this.nowMs();
          if (this.nowMs() - since < HOLD_MS) {
            e = this.save({ ...e, state: 'waiting_printer', printerState: ps, holdingSince: since, error: printerMessage(ps) });
            await this.report(e, 'printing', { printer_status: serverStatus(ps) });
            return;
          }
          e = this.save({ ...e, state: 'paused', printerState: ps, holdingSince: null, pausedByHost: true, error: printerMessage(ps) });
          await this.report(e, 'paused', { printer_status: serverStatus(ps), error_code: serverStatus(ps), message: e.error ?? undefined });
          return;
        }
        e = this.save({ ...e, state: 'printing', printerState: ps, holdingSince: null, error: null });
        const data = await this.d.transport.chunk(job.job_id, n);
        if (data.empty || !data.payload_base64) continue;
        const payload = Buffer.from(data.payload_base64, 'base64');
        const check = checkEnvelope(data.envelope, payload, { job: job.code, chunk: n, printer: job.printer_id, org: this.d.transport.org() }, keys, this.nowMs());
        this.d.onCheck?.(job.code, check);
        if (!check.ok) {
          e = this.save({ ...e, state: 'failed', error: check.reason });
          await this.report(e, 'failed', { error_code: 'SIGNATURE_REFUSED', message: check.reason });
          return;
        }
        const count = Math.max(1, data.labels?.length ?? 1);
        e = this.save({ ...e, inflight: { from: e.confirmed, to: e.confirmed + count, chunk: n } });
        const out = await send(target, payload);
        if (out.ok) {
          e = this.save({ ...e, confirmed: Math.min(e.total, e.confirmed + count), inflight: null, printerState: 'printing' });
          const r = await this.report(e, 'printing', { printer_status: 'PRINTING' });
          if (r?.instruction) {
            this.save({ ...e, state: r.instruction === 'cancelled' ? 'cancelled' : 'paused', error: r.instruction === 'paused' ? 'Paused in WorkSuite; it goes on when someone resumes it there.' : null, claim: null });
            return;
          }
          continue;
        }
        this.d.onPrinterState?.(job.printer_id, target.key, out.state, out.reason);
        if (out.uncertain) {
          e = this.save({ ...e, inflight: null, state: 'interrupted', uncertain: { from: e.inflight!.from, to: e.inflight!.to }, printerState: out.state, error: out.reason });
          await this.report(e, 'stopped', { printer_status: serverStatus(out.state), error_code: serverStatus(out.state), message: out.reason });
          if (!this.d.person) this.save({ ...e, state: 'failed', claim: null });
          return;
        }
        // The spooler took none of it: nothing printed, nothing uncertain.
        e = this.save({ ...e, inflight: null, state: 'paused', pausedByHost: true, printerState: out.state, error: out.reason });
        await this.report(e, 'paused', { printer_status: serverStatus(out.state), error_code: 'PRINTER_OFFLINE', message: out.reason });
        return;
      }
      e = this.save({ ...e, state: 'done', printerState: 'ready', error: null });
      await this.report(e, 'completed', { printer_status: 'READY' });
      this.save({ ...e, claim: null });
    } catch (err) {
      const cur = this.all()[e.id] ?? e;
      if (leaseLost(err)) {
        this.save({ ...cur, state: cur.inflight ? 'interrupted' : 'failed', uncertain: cur.inflight ? { from: cur.inflight.from, to: cur.inflight.to } : cur.uncertain, inflight: null, claim: null, error: 'WorkSuite no longer gives this computer the job (paused, cancelled or moved on the web).' });
        return;
      }
      // The server could not be reached mid-job: the journal holds the count and the range in flight.
      this.save({ ...cur, state: cur.inflight ? 'interrupted' : 'waiting_printer', holdingSince: cur.holdingSince ?? this.nowMs(), uncertain: cur.inflight ? { from: cur.inflight.from, to: cur.inflight.to } : cur.uncertain, inflight: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = null;
    }
  }
}

export function printerMessage(s: PrinterState): string {
  switch (s) {
    case 'paper_out':
      return 'The printer is out of labels.';
    case 'ribbon_out':
      return 'The printer is out of ribbon.';
    case 'head_open':
      return 'The print head is open.';
    case 'paused':
      return 'The printer is paused.';
    case 'offline':
      return 'The printer cannot be reached.';
    default:
      return 'The printer is not ready.';
  }
}
