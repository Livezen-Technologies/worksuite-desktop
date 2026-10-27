import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the emergency stop says afterwards (WS-MEET-ENH-01 RC15), and what the
 * quit guard covers.
 *
 * Read from the source rather than driven: both live inside the
 * remote-control service's chord registration and main's quit path, which need
 * a real Electron app and a live session to exercise. What can go wrong here
 * is the wording and the coverage, and both are visible in the text.
 *
 * The thing worth protecting: pressing the chord ends control but **not** the
 * share, and somebody who pressed it in a hurry has to be told that their
 * screen is still visible. A notice that said only "Remote control stopped"
 * would leave them believing they were private.
 */

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('the notice after the emergency stop', () => {
  const src = read('electron/services/remote-control/service.ts');

  it('says nobody can use the mouse or keyboard any more', () => {
    expect(src).toContain('Nobody can use your mouse or keyboard');
  });

  it('says the screen is still shared, when it still is', () => {
    expect(src).toMatch(/still shared/);
    // And only then: telling somebody who is not sharing that their screen is
    // visible would be its own kind of wrong.
    expect(src).toMatch(/isSharing\(\) \?/);
  });

  it('points at the sharing bar rather than growing a second Stop sharing', () => {
    // The bar (D03) is on screen whenever a share is live and already carries
    // that button; two of them would be two things to keep in step.
    expect(src).toMatch(/sharing bar/);
  });

  it('still fires the stop itself, not just the words', () => {
    const at = src.indexOf('Nobody can use your mouse or keyboard');
    const after = src.slice(at, at + 400);

    expect(after).toContain("stopAll('emergency_stop')");
  });
});

describe('the quit guard', () => {
  // The composition root's tray and lifecycle wiring (electron/main/wiring, audit D-G13).
  const main = read('electron/main/wiring/tray.ts') + read('electron/main/wiring/lifecycle.ts');
  const menu = read('electron/main/menu.ts');

  it('asks before quitting while somebody controls this computer', () => {
    const at = main.indexOf('const quit = (): void =>');

    expect(at).toBeGreaterThan(-1);

    const body = main.slice(at, at + 1400);

    expect(body).toMatch(/remoteControl\.isLive\(\)/);
    expect(body).toMatch(/is controlling this computer/);
    expect(body).toMatch(/Cancel/);
  });

  it('stops control when the person chooses to quit anyway', () => {
    const at = main.indexOf('const quit = (): void =>');
    const body = main.slice(at, at + 1400);

    expect(body).toMatch(/remoteControl\.shutdown\('stopped'\)/);
  });

  it('is reached by the menu’s Quit as well as the tray', () => {
    // A guard only the tray goes through is not a guard: ⌘Q is how people quit.
    expect(menu).toMatch(/label: 'Quit WorkSuite', accelerator: 'Cmd\+Q', click: actions\.quit/);
    expect(menu).toMatch(/label: 'Exit', click: actions\.quit/);
  });

  it('is reached when the last window closes off a Mac', () => {
    expect(main).toMatch(/if \(process\.platform !== 'darwin'\) root\.quit\(\);/);
  });
});
