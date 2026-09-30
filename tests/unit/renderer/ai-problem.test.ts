import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/core/api';
import { assistantProblem } from '../../../src/modules/ai/assistant';

/**
 * What the AI dock says when a turn fails. A 502/504 with no words of its own
 * is the web server in front of WorkSuite giving up on a slow turn — "The
 * server answered 502." told the person nothing they could act on.
 */
describe('the assistant’s problems, in words', () => {
  it('says a gateway timeout is a slow answer, not a broken server', () => {
    expect(assistantProblem(new ApiError(502, 'The server answered 502.', null))).toMatch(/^WorkSuite took too long to answer this/);
    expect(assistantProblem(new ApiError(504, '', null))).toMatch(/^WorkSuite took too long to answer this/);
  });

  it('keeps the server’s own words when it has some', () => {
    expect(assistantProblem(new ApiError(502, 'AI Studio: No online node hosts this model', null))).toBe('AI Studio: No online node hosts this model');
    expect(assistantProblem(new ApiError(500, 'The server answered 500.', null))).toBe('The server answered 500.');
  });

  it('still says offline and not-switched-on as before', () => {
    expect(assistantProblem(new ApiError(0, 'x', 'NETWORK_UNREACHABLE'))).toBe('You are offline. The assistant needs a connection.');
    expect(assistantProblem(new ApiError(403, '', null))).toBe('The assistant is not switched on for you.');
  });
});
