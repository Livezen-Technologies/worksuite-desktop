import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { OfficeBootstrap, OfficeCommand, OfficeEditorEventName, OfficeViewEvent } from '@shared/office';
import { call, errorMessage, on } from '../../core/bridge';
import type { EditorPort, OfficeSession } from './session';

/**
 * Where the editor goes in the tab. The editor is not part of this page: it
 * is a view of its own (its partition, its process — office-editor.ts),
 * laid over this placeholder by the main process. This keeps the view where
 * the placeholder is and shows it only while the tab is on screen and
 * nothing of the shell is over it (a menu, a dialog, the command palette —
 * a native view would cover them). While it is hidden for a menu, `still` — a picture of it taken just before —
 * stands in, so the document stays on screen under the menu (worksuite-desktop#39); `snapshotRef` takes that picture.
 */
export function EditorSurface({
  session,
  tabKey,
  organizationId,
  visible,
  still = null,
  snapshotRef,
}: {
  session: OfficeSession;
  tabKey: string;
  organizationId: string | null;
  visible: boolean;
  still?: string | null;
  snapshotRef?: MutableRefObject<(() => Promise<string | null>) | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  useEffect(() => {
    let view: { id: string; ds: string } | null = null;
    let opening: Promise<void> | null = null;
    let gone = false;
    const pending: OfficeCommand[] = [];

    const openView = (boot: OfficeBootstrap, events: OfficeEditorEventName[]) =>
      call('office:open', {
        key: tabKey,
        fileId: boot.file.id,
        sessionId: boot.session_id,
        organizationId,
        documentServerUrl: boot.document_server_url,
        apiUrl: boot.api_url,
        config: boot.config,
        events,
      }).then(
        (r) => {
          if (gone) {
            void call('office:close', { viewId: r.viewId }).catch(() => undefined);
            return;
          }
          view = { id: r.viewId, ds: boot.document_server_url };
          setViewId(r.viewId);
          for (const cmd of pending.splice(0)) void call('office:command', { viewId: r.viewId, command: cmd }).catch(() => undefined);
        },
        (e) => {
          // Refused here (a Document Server address the desktop will not load, a closed window): the reason, and Reload.
          if (!gone) session.store.set({ editorProblem: errorMessage(e) });
        },
      );

    const port: EditorPort = {
      // One load at a time, in order: a reload asked for while the view is still opening goes to it once it is open.
      start: (boot, events) => {
        opening = (opening ?? Promise.resolve()).then(async () => {
          if (gone) return;
          // Another Document Server (the administrator moved it): a new view, allowed to reach the new one only.
          if (view && view.ds !== boot.document_server_url) {
            void call('office:close', { viewId: view.id }).catch(() => undefined);
            view = null;
            setViewId(null);
          }
          if (view) {
            await call('office:command', { viewId: view.id, sessionId: boot.session_id, command: { type: 'start', config: boot.config }, events }).catch(() => undefined);
            return;
          }
          await openView(boot, events);
        });
      },
      command: (cmd) => {
        if (view) void call('office:command', { viewId: view.id, command: cmd }).catch(() => undefined);
        else pending.push(cmd);
      },
    };
    session.attach(port);
    const off = on<OfficeViewEvent>('office:event', (ev) => {
      if (view && ev.viewId === view.id) session.onViewEvent(ev);
    });
    return () => {
      gone = true;
      off();
      session.detach(port);
      if (view) void call('office:close', { viewId: view.id }).catch(() => undefined);
      view = null;
    };
  }, [session, tabKey, organizationId]);

  const overlayStill = useEditorPlacement(ref, viewId, visible);

  useEffect(() => {
    if (!snapshotRef) return;
    snapshotRef.current = viewId ? () => call('office:snapshot', { viewId }).catch(() => null) : null;
    return () => {
      snapshotRef.current = null;
    };
  }, [snapshotRef, viewId]);

  // The whole space under the file header, in the app's background (#326). The AI launcher steps out of the
  // native view's way rather than taking a strip off the bottom of it (it would only be covered).
  return (
    <div ref={ref} data-office-editor data-hide-ai-launcher className="relative min-h-0 min-w-0 flex-1 bg-ground">
      {(!visible && still) || overlayStill ? (
        <img
          src={overlayStill ?? still!}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain object-left-top select-none"
        />
      ) : null}
    </div>
  );
}

/**
 * Keeps an editor's view on its placeholder: its size, its place (the sidebar, a docked tab, a panel beside it),
 * and whether it shows.
 */
export function useEditorPlacement(ref: RefObject<HTMLDivElement | null>, viewId: string | null, visible: boolean): string | null {
  const [overlayStill, setOverlayStill] = useState<string | null>(null);
  useEffect(() => {
    if (!viewId) return;
    let last = '';
    let frame = 0;
    let covered = false;
    let capturing = false;
    let captureTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setOverlayStill(null);
    });
    let generation = 0;
    const blocked = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], [role="listbox"], [data-native-overlay], aside[data-ai-assistant]')).some((overlay) => {
        if (overlay.closest('[hidden], [aria-hidden="true"]')) return false;
        for (let node: HTMLElement | null = overlay; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        if (overlay.hasAttribute('data-ai-assistant')) {
          const a = overlay.getBoundingClientRect();
          const b = ref.current?.getBoundingClientRect();
          return !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        }
        return true;
      });
    const send = () => {
      frame = 0;
      const el = ref.current;
      const r = el?.getBoundingClientRect();
      const nextCovered = visible && blocked();
      if (nextCovered !== covered) {
        covered = nextCovered;
        const request = ++generation;
        setOverlayStill(null);
        capturing = covered;
        if (captureTimer) clearTimeout(captureTimer);
        if (covered) {
          // Keep the view visible until its replacement image is ready, but never let a failed capture block a menu.
          const timeout = new Promise<null>((resolve) => {
            captureTimer = setTimeout(() => resolve(null), 250);
          });
          void Promise.race([call('office:snapshot', { viewId }).catch(() => null), timeout]).then((shot) => {
            if (disposed || !covered || request !== generation) return;
            if (captureTimer) clearTimeout(captureTimer);
            setOverlayStill(shot);
            capturing = false;
            soon();
          });
        }
      }
      const shown = visible && (!covered || capturing) && !!r && r.width > 0 && r.height > 0 && document.visibilityState !== 'hidden';
      const bounds = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : { x: 0, y: 0, width: 0, height: 0 };
      // A notice over the editor (an AI answer, with the drawer) must stay clickable without hiding the whole
      // document. The persistent launcher is not one: it steps aside for the editor (data-hide-ai-launcher, #326).
      if (r)
        for (const reserve of document.querySelectorAll<HTMLElement>('[data-native-reserve-space]')) {
          const a = reserve.getBoundingClientRect();
          if (a.width > 0 && a.height > 0 && a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top) {
            bounds.height = Math.max(0, Math.min(bounds.height, a.top - r.top - 8));
          }
        }
      const key = `${shown}:${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`;
      if (key === last) return;
      last = key;
      void call('office:place', { viewId, bounds, visible: shown }).catch(() => undefined);
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };
    send();
    const overlays = new MutationObserver(send);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'hidden', 'aria-hidden', 'class', 'style', 'data-native-overlay', 'data-native-reserve-space'],
    });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    if (ref.current && ro) ro.observe(ref.current);
    window.addEventListener('resize', soon);
    document.addEventListener('visibilitychange', soon);
    // Moves that change no size (the sidebar folding, a docked tab's divider) are caught by looking again.
    const poll = setInterval(send, 400);
    return () => {
      disposed = true;
      if (captureTimer) clearTimeout(captureTimer);
      overlays.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', soon);
      document.removeEventListener('visibilitychange', soon);
      clearInterval(poll);
      if (frame) cancelAnimationFrame(frame);
      void call('office:place', { viewId, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false }).catch(() => undefined);
    };
  }, [ref, viewId, visible]);
  return visible ? overlayStill : null;
}
