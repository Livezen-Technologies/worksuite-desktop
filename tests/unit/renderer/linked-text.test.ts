import { describe, expect, it } from 'vitest';
import { linkTarget, splitLinks } from '../../../src/components/LinkedText';

describe('links in message text', () => {
  it('finds addresses and leaves sentence punctuation outside them', () => {
    const parts = splitLinks('Join: https://app.worksuite.lk/meet/d9de3234-a5a2-4d13-8bd6-b2972e1043ef\nMeeting ID: x. See https://example.com/a.');
    expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual(['https://app.worksuite.lk/meet/d9de3234-a5a2-4d13-8bd6-b2972e1043ef', 'https://example.com/a']);
    expect(parts.map((p) => p.text).join('')).toBe('Join: https://app.worksuite.lk/meet/d9de3234-a5a2-4d13-8bd6-b2972e1043ef\nMeeting ID: x. See https://example.com/a.');
    expect(splitLinks('no links here')).toEqual([{ text: 'no links here' }]);
  });

  it('opens a meeting link in the app, other server links in their tab, and the rest in the browser', () => {
    const uuid = 'd9de3234-a5a2-4d13-8bd6-b2972e1043ef';
    expect(linkTarget(`https://app.worksuite.lk/meet/${uuid}`, 'https://app.worksuite.lk')).toEqual({ kind: 'meeting', uuid });
    // The server's own invitations name app.worksuite.lk even when the desktop reaches the server by another address.
    expect(linkTarget(`https://app.worksuite.lk/meet/${uuid}`, 'https://10.0.0.5')).toEqual({ kind: 'meeting', uuid });
    expect(linkTarget('https://app.worksuite.lk/tasks?task=12', 'https://app.worksuite.lk')).toEqual({ kind: 'app', path: '/tasks?task=12' });
    expect(linkTarget('https://worksuite.lk/docs/guide', 'https://app.worksuite.lk')).toEqual({ kind: 'external', url: 'https://worksuite.lk/docs/guide' });
    expect(linkTarget('https://example.com/meet/' + uuid, 'https://app.worksuite.lk')).toEqual({ kind: 'external', url: 'https://example.com/meet/' + uuid });
    expect(linkTarget('javascript:alert(1)', 'https://app.worksuite.lk')).toBeNull();
  });
});
