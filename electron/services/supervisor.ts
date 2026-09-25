import { utilityProcess, type UtilityProcess } from 'electron';
import { backoffDelay, WindowLimiter } from '@shared/backoff';
import type { ServiceHealth } from '@shared/types';
import { logger } from '../main/log';

const log = logger('supervisor');

/**
 * DesktopServiceSupervisor (§3.2, NFR-REL-01, AC-27).
 *
 * Helper processes run as Electron utility processes. Each is pinged every
 * 10 s; a crash or two missed pongs restarts it with exponential backoff
 * (1 s → 5 min). More than 5 restarts in 10 minutes marks it FAILED, which
 * Diagnostics and the tray show. A helper failing never takes the UI down.
 */
export interface ServiceSpec {
  name: string;
  entry: string;
  onMessage?: (msg: unknown) => void;
}

interface Running {
  spec: ServiceSpec;
  proc: UtilityProcess | null;
  health: ServiceHealth;
  attempt: number;
  limiter: WindowLimiter;
  pingTimer: NodeJS.Timeout | null;
  restartTimer: NodeJS.Timeout | null;
  lastPong: number;
  pingN: number;
  stopping: boolean;
}

export class ServiceSupervisor {
  private services = new Map<string, Running>();
  onHealth: (name: string, health: ServiceHealth) => void = () => undefined;

  start(spec: ServiceSpec): void {
    if (this.services.has(spec.name)) return;
    const r: Running = {
      spec,
      proc: null,
      health: 'STARTING',
      attempt: 0,
      limiter: new WindowLimiter(5, 10 * 60_000),
      pingTimer: null,
      restartTimer: null,
      lastPong: Date.now(),
      pingN: 0,
      stopping: false,
    };
    this.services.set(spec.name, r);
    this.spawn(r);
  }

  private setHealth(r: Running, h: ServiceHealth): void {
    if (r.health === h) return;
    r.health = h;
    this.onHealth(r.spec.name, h);
  }

  private spawn(r: Running): void {
    this.setHealth(r, r.attempt === 0 ? 'STARTING' : 'RESTARTING');
    let proc: UtilityProcess;
    try {
      proc = utilityProcess.fork(r.spec.entry, [], { serviceName: `WorkSuite ${r.spec.name}`, stdio: 'pipe' });
    } catch (e) {
      log.error('helper failed to start', { name: r.spec.name, error: String(e) });
      this.scheduleRestart(r);
      return;
    }
    r.proc = proc;
    r.lastPong = Date.now();
    proc.on('message', (msg: { type?: string }) => {
      if (msg?.type === 'pong' || msg?.type === 'ready') {
        r.lastPong = Date.now();
        if (r.health !== 'HEALTHY') {
          r.attempt = 0;
          this.setHealth(r, 'HEALTHY');
        }
        return;
      }
      r.spec.onMessage?.(msg);
    });
    proc.on('exit', (code) => {
      if (r.proc !== proc) return;
      r.proc = null;
      if (r.pingTimer) clearInterval(r.pingTimer);
      r.pingTimer = null;
      if (r.stopping) {
        this.setHealth(r, 'STOPPED');
        return;
      }
      log.warn('helper exited', { name: r.spec.name, code });
      this.scheduleRestart(r);
    });
    r.pingTimer = setInterval(() => {
      if (!r.proc) return;
      if (Date.now() - r.lastPong > 25_000) {
        log.warn('helper stopped answering; restarting', { name: r.spec.name });
        this.setHealth(r, 'DEGRADED');
        r.proc.kill();
        return;
      }
      r.proc.postMessage({ type: 'ping', n: ++r.pingN });
    }, 10_000);
    r.pingTimer.unref?.();
  }

  private scheduleRestart(r: Running): void {
    if (!r.limiter.hit()) {
      log.error('helper failed repeatedly; giving up', { name: r.spec.name });
      this.setHealth(r, 'FAILED');
      return;
    }
    this.setHealth(r, 'RESTARTING');
    const delay = backoffDelay(r.attempt++, { baseMs: 1000, maxMs: 5 * 60_000, jitter: 0.2 });
    r.restartTimer = setTimeout(() => this.spawn(r), delay);
    r.restartTimer.unref?.();
  }

  post(name: string, msg: unknown): boolean {
    const r = this.services.get(name);
    if (!r?.proc) return false;
    r.proc.postMessage(msg);
    return true;
  }

  /** Manual restart from Diagnostics, which also clears a FAILED state. */
  restart(name: string): void {
    const r = this.services.get(name);
    if (!r) return;
    r.limiter.reset();
    r.attempt = 0;
    if (r.proc) r.proc.kill();
    else this.spawn(r);
  }

  health(): Record<string, ServiceHealth> {
    const out: Record<string, ServiceHealth> = {};
    for (const [name, r] of this.services) out[name] = r.health;
    return out;
  }

  stopAll(): void {
    for (const r of this.services.values()) {
      r.stopping = true;
      if (r.pingTimer) clearInterval(r.pingTimer);
      if (r.restartTimer) clearTimeout(r.restartTimer);
      r.proc?.kill();
    }
  }
}
