/**
 * Countries too small to draw at world scale.
 *
 * WHY THIS FILE EXISTS. `worldMap.ts` is Natural Earth at 1:110 million, and at
 * that resolution a city-state has no outline — Singapore and Hong Kong are
 * simply absent from the polygon set. Without this they would be silently
 * missing from the map, which on this installation is not hypothetical: both
 * appear in the live visitor data. A country nobody can see is worse than a
 * country drawn imprecisely, because nothing on screen says it was dropped.
 *
 * WHY A POINT IS HONEST HERE. Plotting a pin inside a large country would claim
 * a precision the data does not have — location is resolved to a country and
 * nothing finer. But for a territory a few kilometres across, the country *is*
 * a point at this scale. The dot is not a guess about where in Singapore
 * somebody is; it is where Singapore is.
 *
 * HAND-MAINTAINED, and deliberately kept out of the generated file so that
 * regenerating the geometry cannot wipe it. Coordinates are the conventional
 * centre of each territory to about a tenth of a degree, which at this scale is
 * well under a pixel.
 */

export interface MapPoint {
  /** ISO 3166-1 alpha-2, matching ./countries.ts. */
  code: string;
  /** Degrees north. */
  lat: number;
  /** Degrees east. */
  lon: number;
}

export const WORLD_POINTS: MapPoint[] = [
  // Asia
  { code: 'SG', lat: 1.35, lon: 103.82 },
  { code: 'HK', lat: 22.32, lon: 114.17 },
  { code: 'MO', lat: 22.20, lon: 113.55 },
  { code: 'BH', lat: 26.07, lon: 50.55 },
  { code: 'MV', lat: 3.20, lon: 73.22 },

  // Europe
  { code: 'MT', lat: 35.90, lon: 14.51 },
  { code: 'LI', lat: 47.17, lon: 9.51 },
  { code: 'MC', lat: 43.73, lon: 7.42 },
  { code: 'SM', lat: 43.94, lon: 12.46 },
  { code: 'VA', lat: 41.90, lon: 12.45 },
  { code: 'AD', lat: 42.51, lon: 1.52 },
  { code: 'GI', lat: 36.14, lon: -5.35 },
  { code: 'JE', lat: 49.21, lon: -2.13 },
  { code: 'GG', lat: 49.47, lon: -2.59 },
  { code: 'IM', lat: 54.24, lon: -4.55 },

  // Caribbean and Atlantic
  { code: 'BB', lat: 13.19, lon: -59.54 },
  { code: 'GD', lat: 12.12, lon: -61.68 },
  { code: 'LC', lat: 13.91, lon: -60.98 },
  { code: 'VC', lat: 13.25, lon: -61.20 },
  { code: 'AG', lat: 17.06, lon: -61.80 },
  { code: 'KN', lat: 17.36, lon: -62.78 },
  { code: 'DM', lat: 15.41, lon: -61.37 },
  { code: 'AW', lat: 12.52, lon: -69.97 },
  { code: 'CW', lat: 12.17, lon: -69.00 },
  { code: 'SX', lat: 18.04, lon: -63.05 },
  { code: 'KY', lat: 19.31, lon: -81.25 },
  { code: 'VG', lat: 18.42, lon: -64.64 },
  { code: 'TC', lat: 21.69, lon: -71.80 },
  { code: 'MS', lat: 16.74, lon: -62.19 },
  { code: 'AI', lat: 18.22, lon: -63.07 },
  { code: 'BM', lat: 32.32, lon: -64.75 },

  // Africa and Indian Ocean
  { code: 'MU', lat: -20.35, lon: 57.55 },
  { code: 'SC', lat: -4.68, lon: 55.49 },
  { code: 'ST', lat: 0.19, lon: 6.61 },
  { code: 'KM', lat: -11.88, lon: 43.87 },
  { code: 'CV', lat: 15.12, lon: -23.61 },

  // Pacific
  { code: 'TO', lat: -21.18, lon: -175.20 },
  { code: 'WS', lat: -13.76, lon: -172.10 },
  { code: 'TV', lat: -8.52, lon: 179.19 },
  { code: 'NR', lat: -0.52, lon: 166.93 },
  { code: 'PW', lat: 7.51, lon: 134.58 },
  { code: 'MH', lat: 7.13, lon: 171.18 },
  { code: 'FM', lat: 7.43, lon: 150.55 },
  { code: 'KI', lat: 1.87, lon: -157.36 },
];
