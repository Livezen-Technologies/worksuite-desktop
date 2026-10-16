// End-to-end: the app at Windows display scaling (100% → 200%) on a Full HD screen. Every app on the sidebar, and
// each section of its own rail and tabs, is laid out at the CSS size the window has at each scale and checked for
// what a person would see go wrong: the whole window scrolling sideways, controls off the edge with no way to scroll
// to them, controls cut off by a box that does not scroll, a control covered by another, a button whose label
// wraps, and text cut off with no ellipsis. Findings go to scaling.json (and screenshots of every screen with one)
// in the output folder.
//
//   npm run build
//   WS_E2E_SERVER=http://127.0.0.1:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/scaling.mjs
//
// WS_SCALING_ONLY=crm,hr limits the apps (by their sidebar label, case-insensitive prefix); WS_SCALING_SCALES=150
// limits the scales.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

/**
 * The window's CSS size on a 1920 × 1080 screen at each Windows scale: the work area (the screen less a 48 px
 * taskbar) divided by the scale, the window maximised. The app draws its own title bar, so this is the page.
 */
export const SCALES = [
  { scale: 100, width: 1920, height: 1032 },
  { scale: 125, width: 1536, height: 826 },
  { scale: 150, width: 1280, height: 688 },
  { scale: 175, width: 1097, height: 590 },
  { scale: 200, width: 960, height: 516 },
];

/** Page code: what is wrong with the layout as it stands. */
export const DETECT = `(() => {
  const W = innerWidth, H = innerHeight, out = [];
  const modal = !!document.querySelector('[aria-modal="true"], [role="dialog"]:not([aria-hidden="true"])');
  const label = (el) => ((el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 48);
  const where = (el) => { const parts = []; for (let e = el, i = 0; e && e !== document.body && i < 5; e = e.parentElement, i++) { const a = e.getAttribute('aria-label') || e.getAttribute('data-testid'); parts.unshift(e.tagName.toLowerCase() + (a ? '[' + a.slice(0, 24) + ']' : '')); } return parts.join(' > '); };
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null; return r; };
  const scrolls = (p) => { const cs = getComputedStyle(p); return /(auto|scroll)/.test(cs.overflowX + ' ' + cs.overflowY); };
  const scroller = (el) => { for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) if (scrolls(p)) return p; return null; };
  /** The box that cuts the element off and cannot be scrolled to it, or null. */
  const clip = (el, r) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX + ' ' + cs.overflowY)) return null;
      const hx = /(hidden|clip)/.test(cs.overflowX), hy = /(hidden|clip)/.test(cs.overflowY);
      if (hx || hy) {
        const pr = p.getBoundingClientRect();
        const cutX = hx ? Math.max(0, r.right - pr.right) + Math.max(0, pr.left - r.left) : 0;
        const cutY = hy ? Math.max(0, r.bottom - pr.bottom) + Math.max(0, pr.top - r.top) : 0;
        if (cutX > r.width * 0.3 || cutY > r.height * 0.3) return p;
      }
    }
    return null;
  };
  /** How many lines the element's own words take (an icon above a one-line label is one line). */
  const lines = (el) => {
    const tops = new Set();
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rect of range.getClientRects()) if (rect.width > 1) tops.add(Math.round(rect.top / 4));
    }
    return tops.size;
  };
  /** Whether the element is scrolled out of its own scrolling box (there is nothing wrong with that). */
  const scrolledAway = (el, r) => { const p = scroller(el); if (!p) return false; const pr = p.getBoundingClientRect(); return r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1 || r.right <= pr.left + 1 || r.left >= pr.right - 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1; };
  const se = document.scrollingElement;
  if (se.scrollWidth > W + 1) out.push({ kind: 'window-scrolls-sideways', by: se.scrollWidth - W });
  if (se.scrollHeight > H + 1) out.push({ kind: 'window-scrolls-down', by: se.scrollHeight - H });
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=columnheader], th')];
  for (const el of controls) {
    const r = shown(el);
    if (!r) continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    // Past the window's edge, with nothing to scroll it into view.
    if ((r.left >= W - 1 || r.right > W + 1 || r.bottom > H + 1) && !scroller(el)) out.push({ kind: 'off-screen', what: label(el), at: where(el), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    const c = clip(el, r);
    if (c) out.push({ kind: 'cut-off', what: label(el), at: where(el), by: where(c) });
    // A button whose words wrap onto a second line (the "Mark as read" kind), or whose text is cut with no ellipsis.
    if (el.matches('button, [role=button], [role=tab], [role=menuitem], th, [role=columnheader]')) {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
      const words = (el.innerText || '').trim();
      if (words && words.length < 40 && !words.includes('\\n') && lines(el) > 1)
        out.push({ kind: 'label-wraps', what: label(el), at: where(el), w: Math.round(r.width), h: Math.round(r.height) });
      if (words && el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis')
        out.push({ kind: 'text-cut', what: label(el), at: where(el) });
    }
    // Covered by something else at its middle (not while a dialog is up: covering the page is its job).
    if (!modal && r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H && !scrolledAway(el, r)) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        const other = top.closest('button, a[href], input, select, textarea, [role=button], [role=tab], header, nav, aside, footer, [role=toolbar]');
        if (other && !other.contains(el) && !el.contains(other)) out.push({ kind: 'covered', what: label(el), at: where(el), by: where(top) });
      }
    }
  }
  // Text in a table cell or list row cut with no ellipsis.
  for (const el of document.querySelectorAll('td, [role=cell], [role=gridcell], li')) {
    const r = shown(el);
    if (!r || el.children.length > 3) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis') out.push({ kind: 'text-cut', what: label(el), at: where(el) });
  }
  const seen = new Set();
  return out.filter((f) => { const k = f.kind + '|' + (f.what || '') + '|' + (f.at || ''); if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

const js = (v) => JSON.stringify(v);
const only = (process.env.WS_SCALING_ONLY ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const scales = process.env.WS_SCALING_SCALES ? SCALES.filter((s) => process.env.WS_SCALING_SCALES.split(',').includes(String(s.scale))) : SCALES;

// A container runs as root, where Chromium needs its sandbox off.
const asRoot = process.getuid?.() === 0;
const t = await launch({ name: 'scaling', args: asRoot ? ['--no-sandbox'] : [], env: asRoot ? { ELECTRON_DISABLE_SANDBOX: '1' } : {} });
try {
  // Signed in through the app's own calls (the first-run screens are not what this checks): the server, which
  // reloads the window once (its CSP names the server), then the password and the setup.
  await t.waitFor(`!!window.worksuite?.auth`, 'the app', 60_000);
  await t.evaluate(`(window.__scalingReload = true, window.worksuite.auth.setServer({ url: ${js(server)} }).then(() => true, (e) => String(e)))`);
  await t.waitFor(`!window.__scalingReload && !!window.worksuite?.auth`, 'the reload after choosing the server', 30_000);
  const signedIn = await t.evaluate(`window.worksuite.auth.signIn({ email: ${js(email)}, password: ${js(password)} }).then((s) => JSON.stringify(s).slice(0, 300), (e) => 'ERR ' + String(e))`);
  console.log(`signed in: ${signedIn}`);
  await t.evaluate(`window.worksuite.auth.completeSetup().then(() => true, () => false)`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Apps"]')`, 'the shell', 60_000);
  await t.evaluate(`window.worksuite.settings.set({ lockOnSystemLock: false, appLockMinutes: 0 })`).catch(() => undefined);
  const size = async (s) => {
    await t.send('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: s.scale / 100, mobile: false });
    await sleep(450);
  };
  await size(SCALES[2]);
  const apps = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean)`);
  const report = [];
  let screens = 0;
  for (const app of apps) {
    if (only.length && !only.some((o) => app.toLowerCase().startsWith(o))) continue;
    const opened = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => (b.getAttribute('aria-label') || b.textContent || '').trim() === ${js(app)}); if (!b) return false; b.click(); return true; })()`);
    if (!opened) continue;
    await sleep(1800);
    // The app's own sections: its rail, else its first row of tabs.
    const sections = await t.evaluate(`(() => { const rail = [...document.querySelectorAll('main nav[aria-label], [data-module-rail] nav, nav[aria-label]')].find(n => n.getAttribute('aria-label') !== 'Apps' && n.querySelectorAll('button, a').length > 1); const items = rail ? [...rail.querySelectorAll('button, a')] : [...document.querySelectorAll('main [role="tablist"] [role="tab"]')]; return items.map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\\s+/g, ' ')).filter(Boolean).slice(0, 14); })()`);
    const visits = [null, ...sections.filter((x, i, a) => a.indexOf(x) === i)];
    for (const section of visits) {
      if (section) {
        const ok = await t.evaluate(`(() => { const rail = [...document.querySelectorAll('main nav[aria-label], [data-module-rail] nav, nav[aria-label]')].find(n => n.getAttribute('aria-label') !== 'Apps' && n.querySelectorAll('button, a').length > 1); const items = rail ? [...rail.querySelectorAll('button, a')] : [...document.querySelectorAll('main [role="tablist"] [role="tab"]')]; const b = items.find(b => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\\s+/g, ' ') === ${js(section)}); if (!b) return false; b.click(); return true; })()`);
        if (!ok) continue;
        await sleep(1300);
      }
      screens++;
      for (const s of scales) {
        await size(s);
        const found = await t.evaluate(DETECT).catch((e) => [{ kind: 'detector-error', what: String(e).slice(0, 120) }]);
        const name = `${app}${section ? ` › ${section}` : ''}`;
        if (found.length) {
          const file = `${String(screens).padStart(3, '0')}-${s.scale}-${name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}`;
          if (s.scale === 150 || s.scale === 200) await t.shot(file).catch(() => undefined);
          report.push({ screen: name, scale: s.scale, findings: found, shot: s.scale === 150 || s.scale === 200 ? file : null });
        }
        console.log(`${found.length ? 'ISSUES' : 'ok    '}  ${String(s.scale).padStart(3)}%  ${name}${found.length ? ` — ${found.length}: ${[...new Set(found.map((f) => f.kind))].join(', ')}` : ''}`);
      }
      await size(SCALES[2]);
    }
  }
  writeFileSync(join(t.outDir, 'scaling.json'), JSON.stringify({ screens, scales: scales.map((s) => s.scale), report }, null, 1));
  const byScale = Object.fromEntries(scales.map((s) => [s.scale, report.filter((r) => r.scale === s.scale).reduce((n, r) => n + r.findings.length, 0)]));
  console.log(`\n${screens} screens; findings by scale: ${JSON.stringify(byScale)} — ${join(t.outDir, 'scaling.json')}`);
  t.check('every app opened and was measured', screens > 0);
} catch (e) {
  await t.shot('failure').catch(() => undefined);
  console.log((await t.evaluate('document.body.innerText').catch(() => '')).slice(0, 600));
  t.check('scaling run', false, String(e?.stack ?? e).slice(0, 500));
}
await t.finish();
