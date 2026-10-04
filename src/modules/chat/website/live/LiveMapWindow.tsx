import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { call, isMac, on } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { cx, ErrorNote, Spinner } from '../../../../components/ui';
import { useNow } from '../../../calls/parts';
import { useRingState } from '../Ringing';
import { homeOf, MAP_KEYS, NO_LIVE_PARAMS, Zooms, type LiveParams } from './LiveDashboard';
import { WebsiteLive } from '../WebsiteLive';
import { DeskTiles, NeedsYou, needsRows, useLiveDesk } from './LiveDesk';
import { countryBox, padded, placesNow, presetsFor, px, py, type Box, type Preset } from './liveMap';
import { findCountry } from './countries';
import { LiveMap } from './WorldMapView';

/**
 * The Live map window (worksuite-desktop L-04; WS-WCHAT MAP-UI-04, MAP-21): "Live map" popped out of the dashboard into
 * a native window of its own — the four small figures, the map on its region preset (World / Asia / LK), who needs you
 * with reply and join (UX-ALR-03), "Drag to another display · ⌘⇧M shows or hides" and Wall mode ↗. It can be pinned on
 * top of other apps ("📌 On top"); the window manager remembers its size and place, and this its preset and its pin.
 * An at-risk notification's Show on map brings it to that visitor's place (MAP-23).
 */

const REGION_KEY = 'ws.liveMap.preset';
const ON_TOP_KEY = 'ws.liveMap.onTop';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience */
  }
}

/** The window's presets: the home country by its code, as the window is narrow ("World · Asia · LK"). */
export function windowPresets(home: string | null): Preset[] {
  const code = home ? findCountry(home)?.code : null;
  return presetsFor(home).map((p) => (code && p.key === code.toLowerCase() ? { ...p, label: code } : p));
}

/** Where Show on map goes: the visitor's city, close up, or their country when only that is known. */
export function focusBox(v: { lat?: number | null; lng?: number | null; country: string | null }): Box | null {
  if (typeof v.lat === 'number' && typeof v.lng === 'number') return { x: px(v.lng) - 30, y: py(v.lat) - 15, w: 60, h: 30 };
  const b = countryBox(v.country);
  return b ? padded(b, 0.3) : null;
}

export function LiveMapWindow() {
  const desk = useLiveDesk();
  const ring = useRingState();
  const now = useNow(1_000);
  const { d, visitors, skew } = desk;
  const presets = useMemo(() => windowPresets(d ? homeOf(d, visitors) : null), [d, visitors]);
  // The region by default (MAP-UI-04 "Asia preset"), else the preset this window was left on.
  const [preset, setPreset] = useState<string | null>(() => stored(REGION_KEY));
  const [moved, setMoved] = useState<Box | null>(null);
  const box = moved ?? (presets.find((p) => p.key === preset) ?? presets[1] ?? presets[0])?.box ?? null;
  const [onTop, setOnTop] = useState(() => stored(ON_TOP_KEY) === '1');
  const [focus, setFocus] = useState<number | null>(() => Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('focus')) || null);

  // Pinned last time: pinned again.
  useEffect(() => {
    if (stored(ON_TOP_KEY) === '1') void call('windows:setAlwaysOnTop', { value: true }).catch(() => undefined);
  }, []);
  const pin = () =>
    void call('windows:setAlwaysOnTop', { value: !onTop }).then(
      (v) => {
        setOnTop(v);
        store(ON_TOP_KEY, v ? '1' : '0');
      },
      () => undefined,
    );

  // Show on map from a notification (MAP-23): to that visitor's place, with their row opened.
  // Once their row is in the list, the map goes to them — once for each Show on map.
  const [shownFocus, setShownFocus] = useState<number | null>(null);
  useEffect(
    () =>
      on<{ conversationId: number }>('live:focus', (p) => {
        setFocus(p.conversationId);
        setShownFocus(null);
      }),
    [],
  );
  const target = focus ? visitors.find((v) => v.conversation_id === focus) : undefined;
  if (target && shownFocus !== focus) {
    setShownFocus(focus);
    const b = focusBox(target);
    if (b) setMoved(b);
  }

  // ⌘⇧M hides the window again; ⌘⇧D opens the Live dashboard (MAP-21, MAP-22).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'm' && k !== 'd') return;
      e.preventDefault();
      void call('live:open', { to: k === 'm' ? 'toggleMap' : 'dashboard' }).catch(() => undefined);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const places = useMemo(() => placesNow(visitors), [visitors]);
  const needs = needsRows(visitors, now, skew);
  return (
    <section aria-label={text('Live map window')} className="flex h-full flex-col bg-surface text-[13px] text-ink">
      <div className="drag flex h-[38px] shrink-0 items-center gap-2.5 bg-[#111b3b] text-[12.5px] text-[#f1f4fb]" style={{ paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 12 : 140 }}>
        <span className="font-bold">{text('Live map')}</span>
        <span className="text-[#9aa3c4]">· {text('All sites')}</span>
        <span className="flex-1" />
        <button type="button" aria-pressed={onTop} onClick={pin} title={onTop ? text('Stop keeping on top') : text('Keep on top')}
          className={cx('no-drag flex items-center gap-[5px] rounded-[6px] px-2 py-0.5 text-[11px] font-semibold', onTop ? 'bg-[#1f2a5b] text-[#b3c0ff]' : 'text-[#8b93ad] hover:bg-white/10')}>
          <span aria-hidden>📌</span> {text('On top')}
        </button>
        <span className="flex items-center gap-[5px] text-[11px] font-bold text-[#8fe0b5]">
          <span className="h-[7px] w-[7px] rounded-full bg-[#2f9e67]" aria-hidden />
          {text('Live')}
        </span>
      </div>
      {desk.dash.error && !d ? <ErrorNote error={desk.dash.error} onRetry={() => void desk.dash.refetch()} /> : null}
      {!d && !desk.dash.error ? <Spinner /> : null}
      {d ? (
        <>
          <div className="shrink-0 bg-ground px-2.5 py-2">
            <DeskTiles d={d} last="chats" />
          </div>
          <div className="relative min-h-[200px] flex-1 border-y border-line">
            {box ? (
              <LiveMap places={places} box={box} onBox={setMoved} zoomButtons={false} edges={false} label="Map of visitors on the site now" className="absolute inset-0 bg-[#f8f9fc] dark:bg-ground" />
            ) : null}
            {box ? (
              <div className="absolute top-2 right-2">
                <Zooms
                  presets={presets}
                  box={box}
                  onBox={setMoved}
                  onPreset={(p) => {
                    setPreset(p.key);
                    setMoved(null);
                    store(REGION_KEY, p.key);
                  }}
                />
              </div>
            ) : null}
          </div>
          <div className="max-h-[45%] shrink-0 overflow-y-auto pt-1.5 pb-2 scroll-thin">
            <NeedsYou rows={needs} ring={ring} said={desk.said} now={now} skew={skew} focus={focus} limit={6} />
          </div>
        </>
      ) : null}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2 text-[11.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">{text('Drag to another display · {keys} shows or hides', { keys: MAP_KEYS })}</span>
        <button type="button" onClick={() => void call('live:open', { to: 'wall' }).catch(() => undefined)} className="font-bold whitespace-nowrap text-primary hover:underline">
          {text('Wall mode ↗')}
        </button>
      </div>
    </section>
  );
}

/**
 * Wall mode on a display (L-06; MAP-24, MAP-UI-05/06 "Wall mode on Display 2"): the dashboard's wall — names hidden, as it
 * always is — filling a window of its own on the screen the Wall mode sheet picked, which the main process keeps awake
 * when the sheet says so; the map cycles World → region → home country every 60 s when it says that. Esc closes it.
 */
export function WallWindow() {
  const close = () => void call('windows:close').catch(() => undefined);
  const info = useQuery({ queryKey: ['live', 'desk'], queryFn: () => call('live:info') });
  // Opened again from the sheet with other choices: read them again.
  const { refetch } = info;
  useEffect(() => on('live:wallChanged', () => void refetch()), [refetch]);
  const prefs = info.data?.wallPrefs;
  return (
    <WebsiteLive
      view="dashboard"
      live={WALL}
      onLive={(p) => p.wall === false && close()}
      selected={null}
      onSelect={() => undefined}
      onOpenChat={(id) => void call('live:open', { to: 'chat', id }).catch(() => undefined)}
      onSection={() => undefined}
      wall={{ cycle: prefs?.cycle ?? false, keepAwake: prefs?.keepAwake ?? true }}
    />
  );
}

const WALL: LiveParams = { ...NO_LIVE_PARAMS, wall: true };
