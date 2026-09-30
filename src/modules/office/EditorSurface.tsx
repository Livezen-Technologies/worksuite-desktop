import { useEffect, useRef, useState, type RefObject } from 'react';
import type { OfficeBootstrap, OfficeCommand, OfficeEditorEventName, OfficeViewEvent } from '@shared/office';
import { call, errorMessage, on } from '../../core/bridge';
import type { EditorPort, OfficeSession } from './session';

/**
 * Where the editor goes in the tab. The editor is not part of this page: it
 * is a view of its own (its partition, its process — office-editor.ts),
 * laid over this placeholder by the main process. This keeps the view where
 * the placeholder is and shows it only while the tab is on screen and
 * nothing of the shell is over it (a menu, a dialog, the command palette —
 * a native view would cover them).
 */
export function EditorSurface({ session, tabKey, organizationId, visible }: { session: OfficeSession; tabKey: string; organizationId: string | null; visible: boolean }) {
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

  useEditorPlacement(ref, viewId, visible);

  return <div ref={ref} data-office-editor className="relative min-h-0 min-w-0 flex-1 bg-white" />;
}

/**
 * Keeps an editor's view on its placeholder: its size, its place (the sidebar, a docked tab, a panel beside it),
 * and whether it shows.
 */
export function useEditorPlacement(ref: RefObject<HTMLDivElement | null>, viewId: string | null, visible: boolean): void {
  useEffect(() => {
    if (!viewId) return;
    let last = '';
    let frame = 0;
    const send = () => {
      frame = 0;
      const el = ref.current;
      const r = el?.getBoundingClientRect();
      const shown = visible && !!r && r.width > 0 && r.height > 0 && document.visibilityState !== 'hidden';
      const bounds = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : { x: 0, y: 0, width: 0, height: 0 };
      const key = `${shown}:${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`;
      if (key === last) return;
      last = key;
      void call('office:place', { viewId, bounds, visible: shown }).catch(() => undefined);
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };
    send();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    if (ref.current && ro) ro.observe(ref.current);
    window.addEventListener('resize', soon);
    document.addEventListener('visibilitychange', soon);
    // Moves that change no size (the sidebar folding, a docked tab's divider) are caught by looking again.
    const poll = setInterval(send, 400);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', soon);
      document.removeEventListener('visibilitychange', soon);
      clearInterval(poll);
      if (frame) cancelAnimationFrame(frame);
      void call('office:place', { viewId, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false }).catch(() => undefined);
    };
  }, [ref, viewId, visible]);
}
