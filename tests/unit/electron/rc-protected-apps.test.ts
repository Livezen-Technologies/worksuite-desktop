import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTECTED_APPS, PROTECTED_APP_LABELS } from '../../../shared/remote-control/protected-apps';
import { isProtected } from '../../../electron/services/remote-control/service';

/**
 * The apps control must never reach (WS-MEET-ENH-01 RC09).
 *
 * The list moved to `shared/` so Settings could show it. What this guards is
 * the reason that was the right move: **one list**. A copy written for the
 * screen would drift from the one that actually pauses control, and the screen
 * would then promise a protection that is not there.
 */

describe('the protected list', () => {
  it('is the one the service matches against', () => {
    const src = readFileSync(join(process.cwd(), 'electron/services/remote-control/service.ts'), 'utf8');

    expect(src).toMatch(/import \{ PROTECTED_APPS \} from '@shared\/remote-control\/protected-apps'/);
    // And no second list beside it.
    expect(src).not.toMatch(/const PROTECTED = \[/);
  });

  it('pauses on a password manager however the window is titled', () => {
    expect(isProtected({ app: '1Password 7', title: 'All Vaults' })).toBe(true);
    expect(isProtected({ app: 'Bitwarden', title: '' })).toBe(true);
    // The match is on the title too: a browser's password window counts.
    expect(isProtected({ app: 'Google Chrome', title: 'KeePassXC-Browser' })).toBe(true);
  });

  it('pauses on the system’s own prompts', () => {
    expect(isProtected({ app: 'SecurityAgent', title: '' })).toBe(true);
    expect(isProtected({ app: 'consent.exe', title: 'User Account Control' })).toBe(true);
    expect(isProtected({ app: 'gcr-prompter', title: 'Unlock' })).toBe(true);
  });

  it('leaves ordinary work alone', () => {
    expect(isProtected({ app: 'Code', title: 'service.ts' })).toBe(false);
    expect(isProtected({ app: 'Safari', title: 'Keeping notes' })).toBe(false);
    expect(isProtected(null)).toBe(false);
  });

  it('has a reading of every entry for the screen', () => {
    // Not one label per match — the labels group them — but nothing in the
    // list may be absent from what Settings says, or the screen under-promises.
    const said = PROTECTED_APP_LABELS.map((l) => `${l.label} ${l.what}`.toLowerCase()).join(' ');
    const missing = PROTECTED_APPS.filter((p) => !said.includes(p.split(/[. ]/)[0]!));

    expect(missing).toEqual([]);
  });
});
