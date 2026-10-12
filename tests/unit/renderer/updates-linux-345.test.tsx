// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { INSTALLED_AS, pipelineFor } from '../../../src/modules/settings/UpdatesPage';
import type { PipelineStep } from '../../../shared/types';

/** Settings › Updates on Linux (worksuite-desktop#345): no "Code signature", no Stage for a package, and how it updates. */
const steps: PipelineStep[] = (['manifest', 'download', 'sha256', 'codesign', 'stage'] as const).map((id) => ({ id, state: 'pending', detail: '' }));

describe('the update steps on Linux', () => {
  it('names the signed answer instead of a code signature, and drops Stage for a .deb or .rpm', () => {
    expect(pipelineFor(steps, 'deb').map((s) => s.label)).toEqual(['Manifest', 'Download', 'SHA-256', 'Release signature (Ed25519)']);
    expect(pipelineFor(steps, 'appimage').map((s) => s.label)).toEqual(['Manifest', 'Download', 'SHA-256', 'Release signature (Ed25519)', 'Stage']);
    expect(pipelineFor(steps, 'exe').map((s) => s.label)).toContain('Code signature');
  });

  it('says how each install type updates', () => {
    expect(INSTALLED_AS.deb).toEqual({ label: '.deb package', how: 'Update now asks for your password once' });
    expect(INSTALLED_AS.appimage!.how).toBe('Updates itself, no password needed');
  });
});
