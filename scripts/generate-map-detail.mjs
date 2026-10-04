/**
 * Turns Natural Earth 1:10m country polygons into one pre-projected SVG path per country, for the live map's detail
 * outlines (WS-WCHAT MAP-09, MNFR-02): the map loads a country's file only once it is zoomed in past a region, and the
 * world view keeps the 1:110m outlines of worldMap.ts.
 *
 *   node scripts/generate-map-detail.mjs path/to/countries-10m.json
 *
 * The input is world-atlas's countries-10m.json (TopoJSON of Natural Earth Admin 0, public domain). The output —
 * src/modules/chat/website/live/detail/<ISO>.json — is committed, and this is NOT part of the build: it exists so the
 * geometry is reproducible rather than a blob somebody pasted in.
 *
 * Same equirectangular 1000×500 projection as worldMap.ts, so a detail outline lies exactly where the coarse one did.
 * Rounded to two decimals (about 0.4 km), simplified (Douglas–Peucker, in map units) only as far as it takes to keep
 * each file under the 60 KB MNFR-02 allows; islands too small to see at that tolerance are dropped.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const topo = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OUT = 'src/modules/chat/website/live/detail';
const BUDGET = 58 * 1024;

/* The ISO list the app already ships, so the detail files and the map agree on codes. */
const src = readFileSync('src/modules/chat/website/live/countries.ts', 'utf8');
const table = src.split('const TABLE = `')[1].split('`;')[0].trim().split('\n');
const byName = new Map();
for (const line of table) {
  const [name, code] = line.split('|');
  byName.set(name.toLowerCase(), code);
}

/* Names Natural Earth spells differently from ISO — written out, never fuzzy-matched: a wrong guess shades the wrong
 * country. Found by running this and reading what it could not match. */
const ALIAS = {
  'united states of america': 'US', 'russia': 'RU', 'dem. rep. congo': 'CD', 'congo': 'CG', 'central african rep.': 'CF',
  'eq. guinea': 'GQ', 's. sudan': 'SS', 'w. sahara': 'EH', 'dominican rep.': 'DO', 'falkland is.': 'FK',
  'fr. s. antarctic lands': 'TF', 'bosnia and herz.': 'BA', 'macedonia': 'MK', 'north macedonia': 'MK', 'czech rep.': 'CZ',
  'czechia': 'CZ', 'kosovo': 'XK', 'solomon is.': 'SB', 'timor-leste': 'TL', 'brunei': 'BN', 'laos': 'LA', 'vietnam': 'VN',
  'north korea': 'KP', 'south korea': 'KR', 'iran': 'IR', 'syria': 'SY', 'turkey': 'TR', "côte d'ivoire": 'CI',
  'swaziland': 'SZ', 'eswatini': 'SZ', 'tanzania': 'TZ', 'venezuela': 'VE', 'bolivia': 'BO', 'moldova': 'MD',
  'antarctica': 'AQ', 'greenland': 'GL', 'somaliland': 'SO', 'n. cyprus': 'CY', 'palestine': 'PS', 'myanmar': 'MM',
  'cape verde': 'CV', 'cabo verde': 'CV', 'gambia': 'GM', 'bahamas': 'BS', 'trinidad and tobago': 'TT', 'united kingdom': 'GB',
  'new caledonia': 'NC', 'puerto rico': 'PR', 'taiwan': 'TW', 'macao': 'MO', 'hong kong': 'HK', 'russia ': 'RU',
  'cook is.': 'CK', 'faeroe is.': 'FO', 'cayman is.': 'KY', 'turks and caicos is.': 'TC', 'british virgin is.': 'VG',
  'u.s. virgin is.': 'VI', 'n. mariana is.': 'MP', 'marshall is.': 'MH', 'pitcairn is.': 'PN', 'wallis and futuna is.': 'WF',
  'st. kitts and nevis': 'KN', 'st. vin. and gren.': 'VC', 'saint lucia': 'LC', 'antigua and barb.': 'AG',
  'são tomé and principe': 'ST', 'fr. polynesia': 'PF', 'heard i. and mcdonald is.': 'HM', 's. geo. and the is.': 'GS',
  'br. indian ocean ter.': 'IO', 'st. pierre and miquelon': 'PM', 'st-martin': 'MF', 'sint maarten': 'SX',
  'st-barthélemy': 'BL', 'micronesia': 'FM', 'vatican': 'VA', 'curaçao': 'CW', 'åland': 'AX', 'saint helena': 'SH',
  'american samoa': 'AS', 'guam': 'GU', 'aruba': 'AW', 'bermuda': 'BM', 'anguilla': 'AI', 'montserrat': 'MS', 'niue': 'NU',
  'norfolk island': 'NF', 'jersey': 'JE', 'guernsey': 'GG', 'isle of man': 'IM', 'gibraltar': 'GI', 'liechtenstein': 'LI',
  'san marino': 'SM', 'monaco': 'MC', 'andorra': 'AD', 'malta': 'MT', 'singapore': 'SG', 'bahrain': 'BH', 'palau': 'PW',
  'kiribati': 'KI', 'tonga': 'TO', 'samoa': 'WS', 'nauru': 'NR', 'tuvalu': 'TV', 'dominica': 'DM', 'grenada': 'GD',
  'barbados': 'BB', 'seychelles': 'SC', 'mauritius': 'MU', 'comoros': 'KM', 'maldives': 'MV', 'eswatini ': 'SZ',
};

/* TopoJSON arcs, delta-decoded and un-quantised. */
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});
const arcOf = (i) => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse());
const ringOf = (ids) => ids.flatMap((i, n) => (n === 0 ? arcOf(i) : arcOf(i).slice(1)));

const W = 1000, H = 500;
const px = (lon) => ((lon + 180) / 360) * W;
const py = (lat) => ((90 - lat) / 180) * H;

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, far = 0;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      // A closed ring starts and ends on one point: measure from it.
      const d = len < 1e-9 ? Math.hypot(x - ax, y - ay) : Math.abs(dy * x - dx * y + bx * ay - by * ax) / len;
      if (d > far) { far = d; best = i; }
    }
    if (far > tol && best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r2 = (n) => Math.round(n * 100) / 100;

function pathOf(rings, tol) {
  let d = '';
  for (const ring of rings) {
    const xs = ring.map(([lon, lat]) => [px(lon), py(lat)]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of xs) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // An island smaller than the tolerance would be a speck: leave it out.
    if (tol > 0 && Math.max(x1 - x0, y1 - y0) < tol * 3) continue;
    const pts = simplify(xs, tol);
    if (pts.length < 3) continue;
    let out = '', last = null;
    for (const [x, y] of pts) {
      const p = [r2(x), r2(y)];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      out += (out === '' ? 'M' : 'L') + p[0] + ' ' + p[1];
      last = p;
    }
    if (out) d += out + 'Z';
  }
  return d;
}

const shapes = new Map();
const unmatched = [];
for (const g of topo.objects.countries.geometries) {
  const name = String(g.properties?.name ?? '').trim();
  const code = byName.get(name.toLowerCase()) ?? ALIAS[name.toLowerCase()] ?? null;
  if (!code) { unmatched.push(name); continue; }
  if (code === 'AQ' || !g.arcs) continue;
  const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
  const rings = polys.flatMap((poly) => poly.map(ringOf));
  shapes.set(code, [...(shapes.get(code) ?? []), ...rings]);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let total = 0, largest = 0;
for (const [code, rings] of [...shapes.entries()].sort()) {
  let tol = 0.01;
  let json = JSON.stringify({ code, d: pathOf(rings, tol) });
  while (json.length > BUDGET) {
    tol *= 1.5;
    json = JSON.stringify({ code, d: pathOf(rings, tol) });
  }
  writeFileSync(join(OUT, `${code}.json`), json + '\n');
  total += json.length;
  largest = Math.max(largest, json.length);
}
console.log('countries:', readdirSync(OUT).length, 'total bytes:', total, 'largest:', largest);
console.log('unmatched:', unmatched.length ? unmatched.join(', ') : 'none');
