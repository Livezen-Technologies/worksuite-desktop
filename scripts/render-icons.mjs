// Renders the app icon and tray icons from SVG with Electron's own renderer,
// so the build needs no image tooling. Run: npx electron scripts/render-icons.mjs
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const trayDir = join(root, 'resources', 'tray');
const iconDir = join(root, 'resources', 'icons');

const NAVY = '#0F1B3D';

// The WorkSuite mark — the owner's original four squares (shared/brand.ts carries the same paths for the UI).
const MARK_VIEWBOX = '4.988 12.422 47.649 47.649';
const MARK = [
  ['#001842', 'M20.867 28.301h15.879v15.879H20.867z'], // the navy centre
  ['#00daf2', 'M4.988 44.191V28.301h15.879v15.89h15.891v15.879H20.867V44.191z'], // cyan, left and below
  ['#0a6cff', 'M20.867 28.301V12.422h31.77v31.769H36.758V28.301z'], // blue, above and right
];
const markPaths = (paint = (c) => c, centre = 1) =>
  MARK.map(([c, d], i) => `<path d="${d}" fill="${paint(c)}"${i === 0 && centre !== 1 ? ` fill-opacity="${centre}"` : ''}/>`).join('');
/** The mark placed in a box: x, y, size in the parent's units. */
const markAt = (x, y, size, inner) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}">${inner}</svg>`;

// The app icon: the mark on a white rounded tile, on Apple's 1024 grid (an 824 tile, 100 in from each edge, so the
// Dock lines it up with the system's icons); Windows and Linux take the same artwork from build/icon.png.
function appIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF3FB"/></linearGradient>
      <filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="${NAVY}" flood-opacity=".22"/></filter>
    </defs>
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#g)" filter="url(#s)"/>
    <rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="${NAVY}" stroke-opacity=".08" stroke-width="1"/>
    ${markAt(282, 282, 460, markPaths())}
  </svg>`;
}

// Tray glyphs. `template` = monochrome black on transparent (macOS menu bar template images; the OS recolours them
// for the menu bar): the mark's silhouette with its centre square at half strength, so the four squares still read.
// Otherwise the mark in colour for the Windows notification area and Linux indicators. A badge cuts a clear ring
// out of the mark (a mask), so it reads on any menu bar or taskbar colour.
function trayIcon(state, template) {
  const ink = template ? () => '#000' : (c) => c;
  const offline = state === 'offline';
  let badge = '';
  let cut = '';
  const hole = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r + 1.6}" fill="#000"/>`;
  switch (state) {
    case 'unread':
      cut = hole(26, 6, 5);
      badge = `<circle cx="26" cy="6" r="5" fill="${template ? '#000' : '#E0522F'}"/>`;
      break;
    case 'syncing':
      cut = hole(25, 25, 6);
      badge = `<g transform="translate(19 19)"><circle cx="6" cy="6" r="6" fill="${template ? '#000' : '#0E7C86'}"/><path d="M3.2 5.2 A3 3 0 0 1 8.6 4.4 M8.8 6.8 A3 3 0 0 1 3.4 7.6" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>`;
      break;
    case 'monitoring':
      badge = `<rect x="1" y="1" width="30" height="30" rx="7" fill="none" stroke="${template ? '#000' : '#1F7A4D'}" stroke-width="2"/>`;
      break;
    case 'error':
      cut = hole(25, 25, 6);
      badge = `<g transform="translate(19 19)"><path d="M6 0.6 L11.6 11 H0.4 Z" fill="${template ? '#000' : '#B42318'}"/><path d="M6 4 V7.2 M6 9 V9.1" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></g>`;
      break;
    default:
      break;
  }
  // The monitoring frame needs room inside it; otherwise the mark fills the 32 grid with a 1-unit margin.
  const [x, size] = state === 'monitoring' ? [5, 22] : [1, 30];
  const mark = markAt(x, x, size, markPaths(ink, template ? 0.5 : 1));
  const look = offline ? (template ? ' opacity=".45"' : ' opacity=".55" filter="url(#grey)"') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <defs>
      <filter id="grey"><feColorMatrix type="saturate" values="0"/></filter>
      <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/>${cut}</mask>
    </defs>
    <g mask="url(#m)"${look}>${mark}</g>${badge}</svg>`;
}

async function render(win, svg, size) {
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.setContentSize(size, size);
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const s = img.getSize();
  return s.width === size ? img : img.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  win.webContents.setFrameRate(10);
  for (const d of [buildDir, trayDir, iconDir]) mkdirSync(d, { recursive: true });

  const icon = await render(win, appIcon(), 1024);
  writeFileSync(join(buildDir, 'icon.png'), icon.toPNG());
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    writeFileSync(join(iconDir, `${size}x${size}.png`), (await render(win, appIcon(), size)).toPNG());
  }

  for (const state of ['normal', 'unread', 'syncing', 'offline', 'monitoring', 'error']) {
    // macOS: template images at 1x (16) and 2x (32).
    writeFileSync(join(trayDir, `${state}Template.png`), (await render(win, trayIcon(state, true), 16)).toPNG());
    writeFileSync(join(trayDir, `${state}Template@2x.png`), (await render(win, trayIcon(state, true), 32)).toPNG());
    // Windows / Linux: coloured.
    writeFileSync(join(trayDir, `${state}.png`), (await render(win, trayIcon(state, false), 32)).toPNG());
    writeFileSync(join(trayDir, `${state}@2x.png`), (await render(win, trayIcon(state, false), 64)).toPNG());
  }
  console.log('icons written');
  app.quit();
});
