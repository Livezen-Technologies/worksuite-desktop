import { useEffect, useState } from 'react';

/**
 * The live map's detailed outlines (WS-WCHAT MAP-09, MNFR-02): Natural Earth 1:10m, one pre-projected file per country
 * in ./detail (scripts/generate-map-detail.mjs), each under 60 KB. Nothing is loaded for the world view, which keeps the
 * 1:110m outlines; once the map is zoomed past a region, the countries in view are loaded, once each, from the app
 * itself — never fetched from anywhere (MNFR-03).
 */
const FILES = import.meta.glob<{ code: string; d: string }>('./detail/*.json', { import: 'default' });

const loaded = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

function load(code: string): Promise<void> {
  const have = pending.get(code);
  if (have) return have;
  const file = FILES[`./detail/${code}.json`];
  const p = file
    ? file().then(
        (f) => void loaded.set(code, f.d),
        () => undefined,
      )
    : Promise.resolve();
  pending.set(code, p);
  return p;
}

/** Whether a country has a detailed outline shipped with the app. */
export const hasDetail = (code: string) => `./detail/${code}.json` in FILES;

/** The detailed outlines of these countries as they arrive, by code; none while `codes` is empty. */
export function useDetail(codes: string[]): Map<string, string> {
  const key = codes.join(',');
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const missing = key.split(',').filter((c) => !loaded.has(c) && hasDetail(c));
    if (missing.length) void Promise.all(missing.map(load)).then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [key]);
  const out = new Map<string, string>();
  for (const c of codes) {
    const d = loaded.get(c);
    if (d) out.set(c, d);
  }
  return out;
}
