import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INVOKE_CHANNELS } from '@shared/ipc/channels';

/**
 * Every channel a window may call is on its bridge, under its own name.
 *
 * `core/bridge.call('ai:localStatus')` looks for `window.worksuite.ai.localStatus`;
 * a channel added to the contract and to main, but not to the preload, answers
 * "WorkSuite Desktop is not available." — which is how Local AI, the lock
 * screen's PIN, Drive's covers and the built-in Office editor's own files all
 * shipped not working.
 */
const preload = readFileSync(join(__dirname, '../../../electron/preload/index.ts'), 'utf8');

describe('the main window bridge', () => {
  const exposed = [...preload.matchAll(/(\w+):\s*(?:call|invoke)\('([a-zA-Z]+):([a-zA-Z]+)'\)/g)];

  it('exposes every channel the contract lists', () => {
    const names = new Set(exposed.map((m) => `${m[2]}:${m[3]}`));
    // Exposed by hand: the three turn File objects into paths first; activity is the preload's own, on input.
    const byHand = new Set(['files:registerDropped', 'pdf:registerDropped', 'sinhala:registerDropped', 'security:activity']);
    const missing = INVOKE_CHANNELS.filter((c) => !names.has(c) && !byHand.has(c));
    expect(missing).toEqual([]);
  });

  it('under the name the renderer looks it up by', () => {
    const wrong = exposed.filter((m) => m[1] !== m[3]).map((m) => `${m[1]} → ${m[2]}:${m[3]}`);
    expect(wrong).toEqual([]);
  });
});
