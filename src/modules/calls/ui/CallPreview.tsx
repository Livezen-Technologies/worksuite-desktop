import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Track } from 'livekit-client';
import { isE2E } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { Empty } from '../../../components/ui';
import { Whiteboard } from '../../meet/Whiteboard';
import { useNow } from '../../../components/CallKit';
import { CallWorkspace } from './CallWorkspace';
import type { ControlButton } from './CoreCallControls';
import type { CallPerson } from './people';
import { callUi } from './state';

/**
 * TEST RUNS ONLY (`/calls/preview`, shown when the app is unpackaged and
 * started with WS_E2E_FAKE_MEDIA): the call surface with made-up people, so
 * its layout can be checked without a media server. Cameras and the shared
 * screen are canvases drawn here. `?people=3&share=1&panel=1&paused=1&board=1`.
 */
function canvasTrack(draw: (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void, w: number, h: number): Track {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const start = performance.now();
  const tick = () => {
    draw(ctx, (performance.now() - start) / 1000, w, h);
    requestAnimationFrame(tick);
  };
  tick();
  const stream = c.captureStream(15);
  return {
    isMuted: false,
    attach(el: HTMLMediaElement) {
      el.srcObject = stream;
      void el.play().catch(() => undefined);
      return el;
    },
    detach(el: HTMLMediaElement) {
      el.srcObject = null;
      return [el];
    },
  } as unknown as Track;
}

const camera = (name: string, hue: number) =>
  canvasTrack(
    (ctx, t, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${hue} 45% 32%)`);
      g.addColorStop(1, `hsl(${hue + 40} 50% 18%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `hsl(${hue} 60% 78%)`;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 - 20 + Math.sin(t * 2) * 6, h * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(w / 2 - h * 0.28, h / 2 + h * 0.12, h * 0.56, h * 0.4);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = 'bold 28px system-ui';
      ctx.fillText(name, 24, 44);
    },
    640,
    360,
  );

const screenShare = () =>
  canvasTrack(
    (ctx, t, w, h) => {
      ctx.fillStyle = '#1E1E1E';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2D2D30';
      ctx.fillRect(0, 0, w, 44);
      ctx.fillStyle = '#252526';
      ctx.fillRect(0, 44, 260, h - 44);
      ctx.fillStyle = '#9CDCFE';
      ctx.font = '22px ui-monospace, Menlo, monospace';
      const lines = ['export function computeLayout(i: LayoutInput) {', '  const width = Math.max(0, i.width);', '  if (i.primary) return screenFocus(i);', '  return speakerOrGrid(i);', '}'];
      lines.forEach((l, n) => ctx.fillText(l, 300, 120 + n * 40));
      ctx.fillStyle = '#C586C0';
      ctx.fillRect(300 + ((t * 120) % 900), 360, 14, 26);
      ctx.fillStyle = '#CCCCCC';
      ctx.font = '18px system-ui';
      ctx.fillText('Shared screen — 1920 × 1080', 24, 29);
    },
    1920,
    1080,
  );

export function CallPreview() {
  const { query } = useTab();
  const ui = useSyncExternalStore(callUi.subscribe, callUi.get);
  const now = useNow();
  const [start] = useState(() => Date.now());
  const count = Math.max(1, Math.min(12, Number(query.get('people') ?? 2)));
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [share, setShare] = useState(query.get('share') === '1');
  const paused = query.get('paused') === '1';

  useEffect(() => {
    if (query.get('panel') === '1') callUi.set({ panelOpen: true, panelTab: 'Chat' });
    if (query.get('board') === '1') callUi.set({ boardOnStage: true });
  }, [query]);

  const tracks = useMemo(() => ({ me: camera('You', 220), screen: screenShare(), others: ['Dimuthu Anuraj', 'Bea Partner', 'Cid Third', 'Dana Fourth', 'Eli Fifth', 'Fay Sixth', 'Gus Seventh', 'Hana Eighth', 'Ivo Ninth', 'Jai Tenth', 'Kim Eleventh'].map((n, i) => ({ n, t: camera(n.split(' ')[0]!, (i * 47) % 360) })) }), []);

  if (!isE2E) return <Empty icon="video" title="Nothing here" />;

  const people: CallPerson[] = [
    { id: 'me', name: 'You', self: true, speaking: false, micOn: mic, camera: cam ? tracks.me : null, screen: null, screenPaused: false },
    ...tracks.others.slice(0, count - 1).map((o, i) => ({
      id: `p${i}`,
      name: o.n,
      self: false,
      speaking: i === 0,
      micOn: i !== 1,
      camera: i === 2 ? null : o.t,
      screen: share && i === 0 ? tracks.screen : null,
      screenPaused: share && i === 0 && paused,
    })),
  ];
  const buttons: ControlButton[] = [
    { id: 'mic', icon: mic ? 'mic' : 'mic-off', label: mic ? 'Mute' : 'Unmute', tone: mic ? undefined : 'warn', onClick: () => setMic(!mic) },
    { id: 'camera', icon: cam ? 'video' : 'video-off', label: cam ? 'Turn camera off' : 'Turn camera on', tone: cam ? undefined : 'warn', onClick: () => setCam(!cam) },
    { id: 'share', icon: 'screen-share', label: share ? 'Stop their share' : 'Simulate a share', tone: share ? 'active' : undefined, onClick: () => setShare(!share) },
    { id: 'chat', icon: 'chat', label: 'Chat', tone: ui.panelOpen && ui.panelTab === 'Chat' ? 'active' : undefined, onClick: () => callUi.togglePanel('Chat') },
    { id: 'board', icon: 'board', label: 'Whiteboard', tone: ui.boardOnStage ? 'active' : undefined, onClick: () => callUi.set({ boardOnStage: !ui.boardOnStage }) },
  ];
  const s = Math.floor((now - start) / 1000);
  return (
    <CallWorkspace
      title={`Call in progress · ${people[1]?.name ?? 'Preview'}`}
      clock={`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}
      people={people}
      board={ui.boardOnStage ? <Whiteboard stage /> : null}
      tabs={[
        {
          id: 'Chat',
          label: 'Chat',
          content: (
            <div className="flex flex-col gap-2 p-3 text-[13px]">
              <div className="self-start rounded-[10px] bg-subtle px-3 py-2">
                <b className="block text-[11.5px] text-ink-2">Dimuthu</b>Can you see my screen?
              </div>
              <div className="self-end rounded-[10px] bg-selection px-3 py-2">Yes — clear.</div>
            </div>
          ),
        },
        { id: 'People', label: 'People', content: <div className="p-3 text-[13px]">{people.map((p) => <div key={p.id}>{p.name}</div>)}</div> },
      ]}
      buttons={buttons}
      more={[]}
      end={{ label: 'Hang up', onClick: () => undefined }}
      status={null}
    />
  );
}
