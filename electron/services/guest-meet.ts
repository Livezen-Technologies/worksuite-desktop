import type { GuestMeetInfo, GuestMeetToken } from '@shared/guest-meet';
import { guestDestination } from '@shared/guest-meet';
import { DesktopError } from '../main/errors';

export interface GuestMeetDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  server: () => string | null;
}
export class GuestMeetService {
  readonly media = new Set<string>();
  private windows = new Map<number, { origin: string; uuid: string; localName?: string }>();
  constructor(private readonly deps: GuestMeetDeps) {}
  isGuest(id: number): boolean { return this.windows.has(id); }
  /** Keeps only the destination (and a Local Profile's name), so later info is always the server's current state. */
  bind(id: number, destination: { origin: string; uuid: string; localName?: string }): void {
    this.windows.set(id, { origin: destination.origin, uuid: destination.uuid, ...(destination.localName ? { localName: destination.localName } : {}) });
  }
  forget(id: number): void { this.windows.delete(id); }
  private scope(id: number) {
    const scope = this.windows.get(id);
    if (!scope) throw new DesktopError('PERMISSION_DENIED', 'This request belongs to a guest meeting window.');
    return scope;
  }
  private async request<T>(origin: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.deps.fetch(`${origin}/api/meet/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new DesktopError('NETWORK_UNREACHABLE', 'Could not reach the meeting server. Check your connection and try again.'); }
    const envelope = await response.json().catch(() => null) as { status?: string; message?: string; data?: T } | null;
    if (!response.ok || envelope?.status === 'error' || !envelope?.data) {
      const message = response.status === 404 ? 'No meeting has this link or code.' : response.status === 410 ? 'This meeting has ended.' : response.status === 423 ? 'The host has locked this meeting.' : envelope?.message ?? 'The meeting server could not complete the request.';
      throw new DesktopError('PERMISSION_DENIED', message);
    }
    return envelope.data;
  }
  async prepare(input: string, server?: string): Promise<GuestMeetInfo> {
    let destination: ReturnType<typeof guestDestination>;
    try { destination = guestDestination(input, server || this.deps.server()); }
    catch (e) { throw new DesktopError('IPC_VALIDATION_FAILED', (e as Error).message); }
    const uuid = destination.uuid ?? (await this.request<{ uuid: string }>(destination.origin, `guest-resolve?code=${encodeURIComponent(destination.code!)}`)).uuid;
    // Validate a resolved ID before constructing another request or route.
    const scope = guestDestination(uuid, destination.origin);
    if (!scope.uuid) throw new DesktopError('IPC_VALIDATION_FAILED', 'The server returned an invalid meeting identifier.');
    const info = await this.request<GuestMeetInfo>(scope.origin, `${scope.uuid}/public`);
    if (!info.guests) throw new DesktopError('PERMISSION_DENIED', 'Guest access is disabled. Sign in to join this meeting.');
    if (info.ended) throw new DesktopError('PERMISSION_DENIED', 'This meeting has ended.');
    if (info.locked) throw new DesktopError('PERMISSION_DENIED', 'The host has locked this meeting.');
    let media: URL;
    try { media = new URL(info.sfu_url); } catch { throw new DesktopError('UNSUPPORTED', 'This server needs an update to support desktop guest meetings.'); }
    if (media.protocol !== 'wss:' || media.username || media.password) throw new DesktopError('UNSUPPORTED', 'The meeting requires a secure media server.');
    this.media.add(media.origin);
    return { ...info, uuid: scope.uuid!, origin: scope.origin };
  }
  async info(id: number): Promise<GuestMeetInfo> {
    const scope = this.scope(id);
    return { ...await this.request<GuestMeetInfo>(scope.origin, `${scope.uuid}/public`), ...scope };
  }
  async join(id: number, name: string, pass?: string): Promise<GuestMeetToken> {
    const scope = this.scope(id);
    const result = await this.request<GuestMeetToken>(scope.origin, `${scope.uuid}/guest`, { name, pass });
    const media = new URL(result.url);
    if (media.protocol !== 'wss:' || media.username || media.password || !this.media.has(media.origin)) throw new DesktopError('PERMISSION_DENIED', 'The meeting media server changed. Open the meeting link again.');
    return result;
  }
}
