import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/core/api';
import { setRegional } from '../../../src/core/time';
import { isNotOffered } from '../../../src/modules/marketing/api';
import { asBlocks, blocksToPlainText, imagesWithoutAlt } from '../../../src/modules/marketing/lib/blocks';
import { suggestMapping } from '../../../src/modules/marketing/lib/csv';
import { campaignChip } from '../../../src/modules/marketing/lib/consent';
import { isoDay, isoTime, localToUtc, maskPhone, parseStamp, when } from '../../../src/modules/marketing/lib/format';
import { INPUT, over } from '../../../src/modules/marketing/parts';

/**
 * What the review of the Marketing module found, kept found: times read and written on the WorkSuite clock whatever
 * the computer's own zone, masked phone numbers, "not offered" told apart from a missing record, content from another
 * client that the editor can still open, CSV headers named like object members, and parts a caller can restyle.
 */
describe('times on the WorkSuite clock, not the computer’s', () => {
  beforeAll(() => setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' }));
  afterAll(() => setRegional({}));

  it('reads a scheduled send into the form and writes the same instant back', () => {
    const at = parseStamp('2026-10-07 03:30:00')!;
    expect(isoDay(at)).toBe('2026-10-07');
    expect(isoTime(at)).toBe('09:00');
    expect(localToUtc(isoDay(at), isoTime(at))).toBe('2026-10-07 03:30:00');
  });

  it('crosses midnight on the WorkSuite calendar', () => {
    const at = parseStamp('2026-10-06 20:00:00')!;
    expect(isoDay(at)).toBe('2026-10-07');
    expect(isoTime(at)).toBe('01:30');
    expect(localToUtc('2026-10-07', '01:30')).toBe('2026-10-06 20:00:00');
  });

  it('refuses a time that is not one', () => {
    expect(localToUtc('2026-10-07', '24:00')).toBeNull();
    expect(localToUtc('2026-10-07', '9:00')).toBeNull();
    expect(localToUtc('07/10/2026', '09:00')).toBeNull();
  });

  it('says a send in the reader’s time and calendar', () => {
    expect(when('2026-10-07 03:30:00')).toMatch(/^7 Oct(?: 2026)? 0?9:00$/);
    expect(when(null)).toBe('—');
  });
});

describe('masked phone numbers (MKT-AUD-07)', () => {
  it('hides the digits before the last four, whatever the grouping', () => {
    expect(maskPhone('+94 77 123 4521')).toBe('+94 77 *** 4521');
    expect(maskPhone('077 123 4521')).toBe('077 *** 4521');
    expect(maskPhone('077-123-4521')).toBe('077-***-4521');
    expect(maskPhone('06 12 34 56 78')).toBe('06 1*** 56 78');
    expect(maskPhone('+94771234521')).toBe('+9477***4521');
  });

  it('leaves what is too short to mask, and says when there is nothing', () => {
    expect(maskPhone('12345')).toBe('12345');
    expect(maskPhone(null)).toBe('—');
  });
});

describe('not offered, as against a record that is not there', () => {
  it('is a missing route: 405, 501, or a 404 that names a route or says no more', () => {
    expect(isNotOffered(new ApiError(405, 'Method Not Allowed', null))).toBe(true);
    expect(isNotOffered(new ApiError(501, 'Not Implemented', null))).toBe(true);
    expect(isNotOffered(new ApiError(404, 'The route api/marketing/readiness could not be found.', null))).toBe(true);
    expect(isNotOffered(new ApiError(404, 'Not Found', null))).toBe(true);
    expect(isNotOffered(new ApiError(404, 'The server answered 404.', null))).toBe(true);
  });

  it('is not a record that went away, a refusal, or anything else', () => {
    expect(isNotOffered(new ApiError(404, 'No query results for model [Contact] 12', null))).toBe(false);
    expect(isNotOffered(new ApiError(404, 'Contact not found.', 'NOT_FOUND'))).toBe(false);
    expect(isNotOffered(new ApiError(404, 'Contact not found.', null))).toBe(false);
    expect(isNotOffered(new ApiError(404, 'The contact could not be found.', null))).toBe(false);
    expect(isNotOffered(new ApiError(403, 'Forbidden', null))).toBe(false);
    expect(isNotOffered(new Error('Not Found'))).toBe(false);
  });
});

describe('content another client saved', () => {
  it('opens with every field the editor reads in the shape it reads it', () => {
    const blocks = asBlocks([
      { id: 'a', type: 'image', src: 'https://img.example/x.png', alt: null, width: 'huge' },
      { id: 'b', type: 'button', label: 'Go' },
      { id: 'c', type: 'text' },
      { id: 'd', type: 'video', src: 'x' },
      { type: 'text', html: '<p>no id</p>' },
      null,
      'nonsense',
    ]);
    expect(blocks).toEqual([
      { id: 'a', type: 'image', src: 'https://img.example/x.png', alt: '', link: null, width: 'full' },
      { id: 'b', type: 'button', label: 'Go', url: '', align: 'left' },
      { id: 'c', type: 'text', html: '' },
    ]);
    expect(() => blocksToPlainText(blocks)).not.toThrow();
    expect(imagesWithoutAlt(blocks)).toHaveLength(1);
  });
});

describe('CSV headers named like object members', () => {
  it('are columns like any other', () => {
    const m = suggestMapping(['Email', 'constructor', 'toString']);
    expect(Object.keys(m).sort()).toEqual(['Email', 'constructor', 'toString']);
    expect(m.Email).toBe('email');
    expect(Object.hasOwn(m, 'constructor')).toBe(true);
    expect(typeof m.constructor).toBe('string');
  });
});

describe('parts a caller restyles', () => {
  it('replaces the part’s own padding, width or border colour instead of fighting it', () => {
    expect(over('min-h-0 flex-1 px-4 pb-4', 'px-0 pb-0')).toBe('min-h-0 flex-1 px-0 pb-0');
    expect(over('min-h-0 flex-1 px-4 pb-4', 'flex flex-col gap-3 pt-3.5')).toBe('min-h-0 flex-1 px-4 pb-4 flex flex-col gap-3 pt-3.5');
    expect(over(INPUT, 'w-[160px]').split(' ')).not.toContain('w-full');
    expect(over('border border-line', 'border-danger/50')).toBe('border border-danger/50');
    expect(over('px-4', null)).toBe('px-4');
  });
});

describe('a campaign’s chip, the same everywhere', () => {
  it('says why a paused campaign stopped', () => {
    expect(campaignChip({ status: 'paused', progress: 21, paused_reason: 'bounce_guard' }).label).toBe('Paused · bounce guard');
    expect(campaignChip({ status: 'paused', progress: 21, paused_reason: 'failed' })).toEqual({ label: 'Paused · failed', tone: 'danger' });
    expect(campaignChip({ status: 'sending', progress: 61.6 }).label).toBe('Sending · 62%');
  });
});
