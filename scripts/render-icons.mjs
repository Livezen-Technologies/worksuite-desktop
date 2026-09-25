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
const BRAND = '#3B5BDB';

// The W mark: a bold, slightly rounded W drawn as a stroke path on a 24-unit grid.
const W_PATH = 'M5 7.2 L8.1 17 L12 9.6 L15.9 17 L19 7.2';

function appIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4A6BEA"/><stop offset="1" stop-color="#23349E"/>
      </linearGradient>
    </defs>
    <rect x="72" y="72" width="880" height="880" rx="200" fill="url(#g)"/>
    <rect x="72" y="72" width="880" height="880" rx="200" fill="none" stroke="${NAVY}" stroke-opacity=".18" stroke-width="8"/>
    <g transform="translate(152 150) scale(30)">
      <path d="${W_PATH}" fill="none" stroke="#fff" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

// Tray glyphs. `template` = monochrome black on transparent (macOS menu bar
// template images; the OS inverts them for dark menu bars). Otherwise a
// coloured mark for the Windows notification area and Linux indicators.
function trayIcon(state, template) {
  const ink = template ? '#000' : '#fff';
  const tile = template
    ? `<rect x="2" y="2" width="28" height="28" rx="7" fill="none" stroke="#000" stroke-width="2.2" ${state === 'offline' ? 'stroke-dasharray="3 3"' : ''}/>`
    : `<rect x="1" y="1" width="30" height="30" rx="8" fill="${state === 'offline' ? '#8A90A2' : BRAND}"/>`;
  const glyph = `<g transform="translate(4 3.2) scale(1)"><path d="${W_PATH}" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ${state === 'offline' && template ? 'opacity=".55"' : ''}/></g>`;
  let badge = '';
  const cut = (cx, cy, r) => (template ? '' : `<circle cx="${cx}" cy="${cy}" r="${r + 1.6}" fill="${NAVY}"/>`);
  switch (state) {
    case 'unread':
      badge = `${cut(26, 6, 5)}<circle cx="26" cy="6" r="5" fill="${template ? '#000' : '#E0522F'}"/>`;
      break;
    case 'syncing':
      badge = `${cut(25, 25, 6)}<g transform="translate(19 19)"><circle cx="6" cy="6" r="6" fill="${template ? '#000' : '#0E7C86'}"/><path d="M3.2 5.2 A3 3 0 0 1 8.6 4.4 M8.8 6.8 A3 3 0 0 1 3.4 7.6" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>`;
      break;
    case 'monitoring':
      badge = template
        ? `<circle cx="16" cy="16" r="15" fill="none" stroke="#000" stroke-width="1.6"/>`
        : `<rect x="0.8" y="0.8" width="30.4" height="30.4" rx="8.4" fill="none" stroke="#1F7A4D" stroke-width="2.4"/>`;
      break;
    case 'error':
      badge = `${cut(25, 25, 6)}<g transform="translate(19 19)"><path d="M6 0.6 L11.6 11 H0.4 Z" fill="${template ? '#000' : '#B42318'}"/><path d="M6 4 V7.2 M6 9 V9.1" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></g>`;
      break;
    default:
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${tile}${glyph}${badge}</svg>`;
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
