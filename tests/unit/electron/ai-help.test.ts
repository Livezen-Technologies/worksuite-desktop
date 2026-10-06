import { describe, expect, it } from 'vitest';
import { captureName, helpLogText } from '../../../electron/services/ai-help';

/** What Contact Support may attach (WS-SUPPORT-SRS-001 D-11, desktop T29): the last day's log that fits, and the capture's name. */
describe('Contact Support’s attachments', () => {
  it('keeps the newest log lines of the last day that fit', () => {
    const now = Date.parse('2026-10-06T10:00:00Z');
    const lines = ['{"t":"2026-10-04T10:00:00Z","msg":"old"}', '{"t":"2026-10-06T08:00:00Z","msg":"a"}', '{"t":"2026-10-06T09:00:00Z","msg":"b"}'];
    expect(helpLogText(lines, now).lines).toBe(2);
    expect(helpLogText(lines, now).text).not.toContain('old');
    const small = helpLogText(lines, now, 45);
    expect(small.text).toBe(lines[2]);
    expect(captureName(new Date(2026, 9, 6, 9, 47))).toBe('window-capture-2026-10-06-0947.png');
  });

});
