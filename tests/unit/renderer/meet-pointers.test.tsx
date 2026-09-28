// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Pointing at and drawing over somebody's shared screen (RC-PTR-01…03,
 * RC08), as the web client does it: the same messages on the same topic,
 * checked before anything is drawn, and only the sharer clears for all.
 */

const sent = vi.hoisted(() => [] as Array<{ msg: unknown; topic?: string; reliable?: boolean }>);
const room = vi.hoisted(() => ({
  localParticipant: {
    identity: 'u5-me',
    name: 'Samali',
    publishData: async (data: Uint8Array, o: { topic?: string; reliable?: boolean }) => void sent.push({ msg: JSON.parse(new TextDecoder().decode(data)), topic: o.topic, reliable: o.reliable }),
  },
}));

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ bootstrap: { policy: {} } }), subscribe: () => () => undefined } }));
vi.mock('../../../src/modules/meet/session', () => ({ meet: { room } }));

import { apiGet, apiPost } from '../../../src/core/api';
import type { CallPerson } from '../../../src/modules/calls/ui/people';
import type { ControlSession, ControlState, Share } from '../../../src/modules/meet/remote/api';
import { remote } from '../../../src/modules/meet/remote/controller';
import { PointerLayer } from '../../../src/modules/meet/remote/PointerLayer';
import { pointers, readPointerMsg } from '../../../src/modules/meet/remote/pointers';

const enc = (m: unknown) => new TextEncoder().encode(JSON.stringify(m));
const avail = { can_request: true, code: 'available', reason: '', pointer: true, annotate: true, handover: false, notes: [] };
const share = (over: Partial<Share> = {}): Share => ({
  id: 44, user_id: 3, name: 'Hasarinda', identity: 'u3-hana', client: 'desktop', surface: 'screen', label: 'Screen 1', allow_requests: true,
  quality: 'auto', status: 'SHARING_VIEW_ONLY', paused: false, started_at: '2026-09-28 10:00:00', device: null, availability: avail, ...over,
});
const state = (shares: Share[], sessions: ControlSession[] = []): ControlState => ({
  shares, requests: [], asked: [], sessions,
  options: { remote_control_mode: 'participants', viewer_pointer: true, share_mode: 'everyone', record_type: null, can_edit: false, is_host: false },
  server: { signing: true, lease_s: 30, lease_renew_s: 10 }, at: 0,
});
const sharer: CallPerson = { id: 'u3-hana', name: 'Hasarinda', self: false, speaking: false, micOn: true, camera: null, screen: null, screenPaused: false };
const stroke = { id: 'u7-x-1', by: 'u7-x', kind: 'pen', color: '#ef4444', width: 3, points: [[0.1, 0.1], [0.2, 0.3]] };
let current: ControlState;

async function show(s: ControlState) {
  current = s;
  remote.start('m-1');
  await act(() => remote.refresh());
  render(
    <div>
      <video />
      <PointerLayer sharer={sharer} />
    </div>,
  );
}

beforeEach(() => {
  sent.length = 0;
  pointers.reset();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom has no PointerEvent: without one the coordinates never reach the handler.
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });
  vi.mocked(apiGet).mockImplementation(async () => structuredClone(current));
  // Releasing control posts the stop; the controller chains .catch on the answer.
  vi.mocked(apiPost).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  remote.stop();
  vi.unstubAllGlobals();
});

describe('messages on the pointer topic', () => {
  it('takes the web client’s messages as they are', () => {
    expect(readPointerMsg({ t: 'laser', share: 44, x: 0.5, y: 0.25, name: 'Ravi' })).toEqual({ t: 'laser', share: 44, x: 0.5, y: 0.25, name: 'Ravi' });
    expect(readPointerMsg({ t: 'stroke', share: 44, stroke })).toMatchObject({ t: 'stroke', stroke: { kind: 'pen', points: [[0.1, 0.1], [0.2, 0.3]] } });
    expect(readPointerMsg({ t: 'stroke', share: 44, stroke: { ...stroke, kind: 'text', text: 'here' } })).toMatchObject({ stroke: { text: 'here' } });
    expect(readPointerMsg({ t: 'annot', share: 44, on: false })).toEqual({ t: 'annot', share: 44, on: false });
  });

  it('drops anything out of shape instead of drawing it', () => {
    expect(readPointerMsg({ t: 'laser', share: 44, x: 1.5, y: 0 })).toBeNull();
    expect(readPointerMsg({ t: 'laser', x: 0.5, y: 0.5 })).toBeNull();
    expect(readPointerMsg({ t: 'stroke', share: 44, stroke: { ...stroke, color: 'url(javascript:x)' } })).toBeNull();
    expect(readPointerMsg({ t: 'stroke', share: 44, stroke: { ...stroke, kind: 'image' } })).toBeNull();
    expect(readPointerMsg({ t: 'stroke', share: 44, stroke: { ...stroke, points: [[0.1, -2]] } })).toBeNull();
    expect(readPointerMsg({ t: 'stroke', share: 44, stroke: { ...stroke, kind: 'text', text: 'x'.repeat(121) } })).toBeNull();
    expect(readPointerMsg({ t: 'annot', share: 44, on: 'no' })).toBeNull();
  });

  it('lets nobody draw in somebody else’s name, and only the sharer clear for all or switch annotation off', async () => {
    await show(state([share()]));
    pointers.receive(enc({ t: 'stroke', share: 44, stroke }), { identity: 'u9-other' });
    expect(pointers.of(44).strokes).toHaveLength(0);
    pointers.receive(enc({ t: 'stroke', share: 44, stroke }), { identity: 'u7-x' });
    expect(pointers.of(44).strokes).toHaveLength(1);
    pointers.receive(enc({ t: 'clear_all', share: 44 }), { identity: 'u7-x' });
    pointers.receive(enc({ t: 'annot', share: 44, on: false }), { identity: 'u7-x' });
    expect(pointers.of(44)).toMatchObject({ annotOn: true });
    expect(pointers.of(44).strokes).toHaveLength(1);
    pointers.receive(enc({ t: 'clear_all', share: 44 }), { identity: 'u3-hana' });
    pointers.receive(enc({ t: 'annot', share: 44, on: false }), { identity: 'u3-hana' });
    expect(pointers.of(44)).toMatchObject({ strokes: [], annotOn: false });
  });

  it('shows a pointer with its name until it stops moving, and says who points to the sharer', () => {
    let t = 1_000;
    pointers.now = () => t;
    pointers.receive(enc({ t: 'laser', share: 44, x: 0.5, y: 0.5, name: 'Ravi' }), { identity: 'u7-x' });
    expect(pointers.activity(44, 'u3-hana')).toEqual(['Ravi']);
    t += 2_500;
    expect(pointers.activity(44, 'u3-hana')).toEqual([]);
    pointers.now = () => Date.now();
  });
});

describe('a flood on the topic', () => {
  it('is dropped past sixty messages a second from one person, and nobody else is held back', () => {
    const t = 5_000;
    pointers.now = () => t;
    for (let i = 0; i < 100; i++) pointers.receive(enc({ t: 'stroke', share: 44, stroke: { ...stroke, id: `s${i}` } }), { identity: 'u7-x' });
    expect(pointers.of(44).strokes).toHaveLength(60);
    pointers.receive(enc({ t: 'stroke', share: 44, stroke: { ...stroke, id: 'other', by: 'u8-y' } }), { identity: 'u8-y' });
    expect(pointers.of(44).strokes).toHaveLength(61);
    pointers.now = () => Date.now();
  });
});

describe('over somebody’s shared screen', () => {
  it('offers Pointer and Annotate; a pointer goes out with this person’s name', async () => {
    await show(state([share()]));
    fireEvent.click(screen.getByRole('button', { name: 'Pointer' }));
    fireEvent.pointerMove(screen.getByLabelText('Point at the shared screen'), { clientX: 0, clientY: 0 });
    expect(sent.at(-1)).toEqual({ msg: { t: 'laser', share: 44, x: 0, y: 0, name: 'Samali' }, topic: 'rc.pointer', reliable: false });
  });

  it('draws with the chosen tool and sends the stroke as the web does', async () => {
    await show(state([share()]));
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arrow' }));
    const pad = screen.getByLabelText('Draw on the shared screen');
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(pad, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(pad);
    expect(sent.at(-1)).toMatchObject({ topic: 'rc.pointer', reliable: true, msg: { t: 'stroke', share: 44, stroke: { by: 'u5-me', kind: 'arrow', points: [[0, 0], [1, 1]] } } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear mine' }));
    expect(sent.at(-1)).toEqual({ msg: { t: 'clear', share: 44, by: 'u5-me' }, topic: 'rc.pointer', reliable: true });
    expect(pointers.of(44).strokes).toHaveLength(0);
  });

  it('stops drawing when the sharer switches annotation off, and offers nothing when the meeting does not allow it', async () => {
    await show(state([share()]));
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
    act(() => pointers.receive(enc({ t: 'annot', share: 44, on: false }), { identity: 'u3-hana' }));
    expect(screen.queryByRole('toolbar', { name: 'Annotation tools' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Annotate' })).toHaveProperty('disabled', true);
    cleanup();
    await show(state([share({ availability: { ...avail, pointer: false, annotate: false } })]));
    expect(screen.queryByRole('button', { name: 'Pointer' })).toBeNull();
  });

  it('is off while this person controls that screen: the mouse is the controller’s then', async () => {
    const s: ControlSession = {
      id: 12, share_id: 44, status: 'CONTROL_ACTIVE', role: 'controller', pause_reason: null, caps: { mouse: true, keyboard: true, clipboard: 'off', file_transfer: false, monitor_switch: false }, caps_label: 'Mouse and keyboard',
      sharer: { id: 3, name: 'Hasarinda', identity: 'u3-hana' }, controller: { id: 5, name: 'Samali', identity: 'u5-me' }, reason: null, duration: '15', approved_at: null, started_at: null, expires_at: null, key_version: 1, grant_waiting: false, type: 'meeting', ticket_id: null, mfa_passed: false,
    };
    await show(state([share()], [s]));
    expect(remote.session?.sharer.identity).toBe('u3-hana');
    expect(screen.queryByRole('button', { name: 'Pointer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull();
  });
});

describe('for the person sharing', () => {
  it('clears everybody’s marks and switches annotation off with the web’s own messages', () => {
    pointers.receive(enc({ t: 'stroke', share: 44, stroke }), { identity: 'u7-x' });
    pointers.clearAll(room as never, 44);
    expect(pointers.of(44).strokes).toEqual([]);
    expect(sent.at(-1)).toEqual({ msg: { t: 'clear_all', share: 44 }, topic: 'rc.pointer', reliable: true });
    pointers.setAnnot(room as never, 44, false);
    expect(pointers.of(44).annotOn).toBe(false);
    expect(sent.at(-1)).toEqual({ msg: { t: 'annot', share: 44, on: false }, topic: 'rc.pointer', reliable: true });
  });
});
