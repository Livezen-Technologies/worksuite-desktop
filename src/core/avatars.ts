import { useEffect, useSyncExternalStore } from 'react';
import { apiGet } from './api';
import { app } from './app-state';
import { on } from './bridge';

/**
 * People's profile pictures (worksuite-desktop#37), as the server hands them out: `/api/users/avatars?ids=` answers
 * each person's current picture address (`/avatars/{token}/{size}.webp`), or nothing when there is none or this viewer
 * may not see it (the owner chose who sees it). The address is random and belongs to one picture, so it is cached as
 * long as it is current; a new picture is a new address, announced as the realtime `profile.updated` event, and the
 * avatars on screen follow without signing out.
 *
 * Lookups are gathered for a moment and asked for together, so a list of fifty conversations is one request.
 */
type Entry = { address: string | null; at: number };

/** The most the server answers in one lookup. */
const BATCH = 200;
/** A picture changed while this computer missed the announcement (asleep, offline) is picked up after this long. */
const STALE_MS = 15 * 60_000;
/** The address a picture shown to only some people carries in `users.avatar`; never an image. */
const HIDDEN = '/avatars/private';
const ADDRESS = /^\/avatars\/([A-Za-z0-9_-]+)\/(\d{2,3})\.webp$/;
const SIZES = [64, 128, 256, 512];

const known = new Map<number, Entry>();
const wanted = new Set<number>();
const listeners = new Set<() => void>();
let owner: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
let listening = false;
let generation = 0;
const revisions = new Map<number, number>();

function scope(): string | null {
  const s = app.get();
  return s.auth?.user?.id ? `${s.auth.server?.origin ?? ''}#${s.auth.user.id}#${s.organizationId ?? ''}` : null;
}

function changed(): void {
  version++;
  for (const l of listeners) l();
}

/** Signed in as somebody else, or to another server: nothing learned before applies. */
function checkOwner(): boolean {
  const who = scope();
  if (who === owner) return false;
  owner = who;
  generation++;
  known.clear();
  wanted.clear();
  revisions.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  return true;
}

async function flush(): Promise<void> {
  timer = null;
  checkOwner();
  if (!owner) return;
  const started = generation;
  const ids = [...wanted];
  wanted.clear();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const before = new Map(chunk.map((id) => [id, revisions.get(id) ?? 0]));
    try {
      const r = await apiGet<{ avatars: Record<string, string | null> }>('/api/users/avatars', { ids: chunk.join(',') });
      const now = Date.now();
      if (started !== generation || scope() !== owner) return;
      for (const id of chunk) if (before.get(id) === (revisions.get(id) ?? 0)) known.set(id, { address: r.avatars?.[String(id)] ?? null, at: now });
    } catch {
      // Offline or refused: the initials stay, and the next use asks again a little later.
      const now = Date.now();
      if (started !== generation || scope() !== owner) return;
      for (const id of chunk) if (before.get(id) === (revisions.get(id) ?? 0) && !known.has(id)) known.set(id, { address: null, at: now - STALE_MS + 60_000 });
    }
  }
  changed();
}

function want(id: number): void {
  wanted.add(id);
  if (!timer) timer = setTimeout(() => void flush(), 25);
}

function listen(): void {
  if (listening) return;
  listening = true;
  app.subscribe(() => {
    if (checkOwner()) changed();
  });
  try {
    on<{ type?: string; user_id?: number; avatar?: string | null }>('realtime:event', (e) => {
      if (e?.type !== 'profile.updated' || typeof e.user_id !== 'number') return;
      checkOwner();
      if (!owner) return;
      const id = e.user_id;
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      // A picture only some may see comes as HIDDEN: ask whether this viewer is one of them.
      if (e.avatar === HIDDEN) {
        known.delete(id);
        want(id);
      } else {
        known.set(id, { address: e.avatar && ADDRESS.test(e.avatar) ? e.avatar : null, at: Date.now() });
      }
      changed();
    });
  } catch {
    // Without the bridge (a test), pictures still load; they just refresh on their own schedule.
  }
  // Back at the computer after a while: pictures that may have changed meanwhile are asked for again.
  window.addEventListener('focus', () => {
    const now = Date.now();
    for (const [id, e] of known) if (now - e.at > STALE_MS) want(id);
  });
}

/** Asks the server for a person's picture when it is not known, or has gone stale. */
function request(id: number | null | undefined): void {
  if (!id || id <= 0) return;
  checkOwner();
  if (!owner) return;
  listen();
  const e = known.get(id);
  if (!e || Date.now() - e.at > STALE_MS) want(id);
}

/** The picture address known for a person now, or null. */
export function avatarAddress(id: number | null | undefined): string | null {
  if (!id || id <= 0) return null;
  checkOwner();
  return known.get(id)?.address ?? null;
}

/**
 * The picture's address at a size to suit `px` on this screen, on the signed-in server. Only an address of the form
 * the server gives out is used; anything else shows the initials.
 */
export function avatarSrc(address: string | null | undefined, px: number): string | null {
  const m = address ? ADDRESS.exec(address) : null;
  const origin = app.get().auth?.server?.origin;
  if (!m || !origin) return null;
  const need = px * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const size = SIZES.find((s) => s >= need) ?? SIZES[SIZES.length - 1]!;
  return `${origin}/avatars/${m[1]}/${size}.webp`;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** A person's picture, sized for `px`, or null for their initials. Re-renders when it changes. */
export function useUserAvatar(id: number | null | undefined, px: number): string | null {
  const account = useSyncExternalStore(app.subscribe, scope);
  useSyncExternalStore(subscribe, () => version);
  // Asked for after the render, batched with the rest of the screen.
  useEffect(() => request(id), [id, account]);
  return avatarSrc(avatarAddress(id), px);
}

/** Tests only: forget everything. */
export function resetAvatars(): void {
  generation++;
  revisions.clear();
  known.clear();
  wanted.clear();
  owner = null;
  if (timer) clearTimeout(timer);
  timer = null;
  changed();
}
