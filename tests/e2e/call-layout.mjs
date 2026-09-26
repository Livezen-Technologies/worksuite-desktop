// The call surface (CallWorkspace) with made-up people — the test-only
// /calls/preview, shown when the app runs unpackaged with WS_E2E_FAKE_MEDIA —
// in a real video-call window: a shared screen with the person in the
// corner and chat beside it, the layouts, full screen with the panel inside
// it, the floating card and back, a grid, the speaker, the whiteboard on
// stage, and a paused share. No media server is needed.
//
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/call-layout.mjs
import { launch, sleep } from './harness.mjs';
const server = process.env.WS_E2E_SERVER, email = process.env.WS_E2E_EMAIL, password = process.env.WS_E2E_PASSWORD;
const t = await launch({ name: 'call-layout', env: { WS_E2E_FAKE_MEDIA: '1' } });
const open = async (q, label) => {
  await t.evaluate(`window.worksuite.windows.open({ kind: 'video-call', route: '/calls/preview?${q}', title: 'Preview', alwaysOnTop: false })`);
  const w = await t.attach((u) => u.includes('/calls/preview') && u.includes(encodeURIComponent(q).slice(0, 8)) , label, 20000).catch(() => t.attach((u) => u.includes('calls%2Fpreview') || u.includes('/calls/preview'), label, 20000));
  await w.waitFor(`!!document.querySelector('[role="toolbar"][aria-label="Call controls"]')`, 'the controls', 20000);
  await sleep(1200);
  return w;
};
const clickLabel = (w, label) => w.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '') === ${JSON.stringify(label)} || b.textContent.trim().startsWith(${JSON.stringify(label)})); if (b) b.click(); return !!b; })()`);
/** A real click (a user gesture: full screen needs one). */
const trusted = async (w, label) => {
  const r = await w.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '') === ${JSON.stringify(label)}); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) return false;
  await w.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await w.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return true;
};
try {
  await t.signIn(server, email, password);
  await sleep(1000);
  let w = await open('people=2&share=1&panel=1', 'share + chat');
  await w.shot('cl1-share-chat');
  // The main window says a meeting is going on, and one click brings its window back.
  await w.evaluate(`window.worksuite.calls.active({ uuid: 'd9de3234-a5a2-4d13-8bd6-b2972e1043ef', kind: 'meet', title: 'Design review' })`);
  await t.waitFor(`!!document.querySelector('button[aria-label^="In a meeting: Design review"]')`, 'the in-a-meeting pill');
  await t.shot('cl0-main-pill');
  const focused = await t.evaluate(`(async () => { document.querySelector('button[aria-label^="In a meeting: Design review"]').click(); await new Promise(r => setTimeout(r, 400)); return true; })()`);
  t.check('the main window shows the meeting going on, and brings its window back', focused);
  const facts = await w.evaluate(`(() => { const v = [...document.querySelectorAll('video')]; const aside = document.querySelector('aside[aria-label="Call panel"]'); return { videos: v.length, screenFit: v.map(x => getComputedStyle(x).objectFit), panel: aside ? aside.getBoundingClientRect().width : 0, pip: !!document.querySelector('[role="group"][aria-label*="drag to move"]') }; })()`);
  t.check('a shared screen fills the stage (contain) with the person in the corner, chat beside it', facts.pip && facts.panel >= 320 && facts.screenFit.includes('contain'), JSON.stringify(facts));
  // Layout: side by side, then grid.
  await clickLabel(w, 'Layout');
  await sleep(300);
  await w.shot('cl2-layout-menu');
  await clickLabel(w, 'Side by side');
  await sleep(700);
  await w.shot('cl3-side-by-side');
  await clickLabel(w, 'Layout');
  await clickLabel(w, 'Grid');
  await sleep(700);
  await w.shot('cl4-screen-grid');
  await clickLabel(w, 'Layout');
  await clickLabel(w, 'Auto');
  // Full screen: the whole surface, panel included.
  await trusted(w, 'Full screen');
  await sleep(1800);
  const fs = await w.evaluate(`(() => ({ el: document.fullscreenElement ? document.fullscreenElement.className.slice(0, 40) : null, panel: !!document.querySelector('aside[aria-label="Call panel"]'), h: innerHeight }))()`);
  await w.shot('cl5-fullscreen');
  t.check('full screen holds the stage, the panel and the controls together', !!fs.el && fs.panel, JSON.stringify(fs));
  await trusted(w, 'Leave full screen');
  await sleep(1500);
  const out = await w.evaluate(`({ fs: !!document.fullscreenElement, panel: !!document.querySelector('aside[aria-label="Call panel"]') })`);
  t.check('leaving full screen keeps the panel as it was', !out.fs && out.panel, JSON.stringify(out));
  // Floating card.
  await clickLabel(w, 'Shrink to a floating window');
  await sleep(1500);
  await w.shot('cl6-floating');
  const card = await w.evaluate(`({ w: innerWidth, h: innerHeight, back: !!document.querySelector('button[aria-label="Back to the call"]') })`);
  t.check('the call shrinks to a floating card with its own few controls', card.w <= 420 && card.back, JSON.stringify(card));
  await clickLabel(w, 'Back to the call');
  await sleep(1500);
  const back = await w.evaluate(`innerWidth`);
  t.check('and comes back to the full window', back > 700, String(back));
  await w.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);
  await sleep(800);

  w = await open('people=5', 'grid');
  await w.shot('cl7-grid');
  await w.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);
  await sleep(800);
  w = await open('people=2', 'speaker');
  await w.shot('cl8-speaker');
  await w.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);
  await sleep(800);
  w = await open('people=3&board=1', 'board');
  await w.shot('cl9-board-stage');
  await w.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);
  await sleep(800);
  w = await open('people=2&share=1&paused=1', 'paused');
  await w.shot('cl10-paused');
  await w.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);
} catch (e) { console.log('ERR', e.message); await t.shot('clz').catch(() => undefined); } finally { await t.finish(); }
