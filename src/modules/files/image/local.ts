import { useEffect, useState } from 'react';
import type { LocalImageEvent, LocalImageInfo } from '@shared/types';
import { app } from '../../../core/app-state';
import { call, hasDesktop, on } from '../../../core/bridge';
import { useStore } from '../../../core/store';

/**
 * The editor's side of this computer (Drive ENH-03 DSK-02…06): whether a picture is kept here by Drive sync, its
 * synced copy for editing offline, saving an edit there with its recipe, and handing the canvas to the system's drag.
 */

/** The app is offline: no network, or the server out of reach. */
export function useOffline(): boolean {
  const network = useStore(app, (s) => s.status?.network ?? 'ONLINE');
  return network === 'OFFLINE' || network === 'RECONNECTING';
}

export async function localInfo(fileId: number | null): Promise<LocalImageInfo | null> {
  if (!fileId || !hasDesktop()) return null;
  try {
    return await call('image:localInfo', { fileId });
  } catch {
    return null;
  }
}

/** The synced copy here, with what is waiting to go up; again whenever an offline edit moves on. */
export function useLocalImage(fileId: number | null): { info: LocalImageInfo | null; ready: boolean; refresh: () => void } {
  const [info, setInfo] = useState<LocalImageInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [n, setN] = useState(0);
  const revision = useStore(app, (s) => s.sync?.revision ?? 0);
  useEffect(() => {
    let gone = false;
    void localInfo(fileId).then((i) => {
      if (gone) return;
      setInfo(i);
      setReady(true);
    });
    return () => {
      gone = true;
    };
  }, [fileId, n, revision]);
  useEffect(() => on<LocalImageEvent>('image:localChanged', (e) => e.fileId === fileId && setN((x) => x + 1)), [fileId]);
  return { info, ready, refresh: () => setN((x) => x + 1) };
}

export async function localBytes(fileId: number): Promise<Blob> {
  const bytes = await call('image:localRead', { fileId });
  return new Blob([bytes.slice().buffer]);
}

export function localSave(input: { fileId: number; bytes: Uint8Array<ArrayBuffer>; recipe: string; summary: string; note: string; width: number | null; height: number | null; copyName?: string | null }) {
  return call('image:localSave', input);
}

export const openInSystemEditor = (fileId: number) => call('image:openSystem', { fileId });

/** Download only / Export: the rendered picture, where the person chooses. */
export const saveToComputer = (name: string, bytes: Uint8Array<ArrayBuffer>) => call('image:saveAs', { name, bytes });

export async function prepareDrag(png: Blob, name: string): Promise<string | null> {
  if (!hasDesktop()) return null;
  try {
    return (await call('image:prepareDrag', { bytes: new Uint8Array(await png.arrayBuffer()), name })).token;
  } catch {
    return null;
  }
}

export const startDrag = (token: string) => call('image:startDrag', { token });

/** "Offline · will upload as v4", "Saved here · will upload as v4", or null. */
export function offlineWords(info: LocalImageInfo | null, offline: boolean, version: number): string | null {
  if (info?.pending) {
    if (info.pending.state === 'conflict') return 'Drive changed meanwhile · both copies kept';
    if (info.pending.state === 'recipe-pending') return `Uploaded as v${info.pending.willBe} · layers still to send`;
    return `${offline ? 'Offline' : 'Saved here'} · will upload as v${info.pending.willBe}`;
  }
  if (offline && info?.synced) return `Offline · will upload as v${(info.version ?? version) + 1}`;
  if (offline) return 'Offline';
  return null;
}
