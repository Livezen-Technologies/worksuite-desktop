import { describe, expect, it } from 'vitest';
import { AUDIENCES, audienceOf } from '../../../shared/meet-chat';
import { PANEL_HELP, PANEL_PRIMARY, panelLayout } from '../../../shared/meet-panel';

/**
 * The meeting panel's own layout, and who reads a message sent from it (the
 * Meet Side Panel canvas).
 *
 * What these protect: nothing is lost behind More — a tool that stopped
 * appearing in either place would simply be gone from the meeting — and the
 * audience picker never points at a destination that is not there.
 */

const tabs = ['People', 'Chat', 'Q&A', 'Polls', 'Board', 'Notes', 'Files', 'Info', 'Settings'].map((id) => ({ id }));

describe('what the strip shows', () => {
  it('is Chat, People and Q&A, in the canvas’s order', () => {
    expect(panelLayout(tabs).tabs.map((t) => t.id)).toEqual(['Chat', 'People', 'Q&A']);
    expect(PANEL_PRIMARY).toEqual(['Chat', 'People', 'Q&A']);
  });

  it('puts everything else behind More, in the order it was given', () => {
    expect(panelLayout(tabs).more.map((t) => t.id)).toEqual(['Polls', 'Board', 'Notes', 'Files', 'Info', 'Settings']);
  });

  it('loses nothing: every tab is in one place or the other', () => {
    const { tabs: strip, more } = panelLayout(tabs);

    expect([...strip, ...more].map((t) => t.id).sort()).toEqual(tabs.map((t) => t.id).sort());
  });

  it('says what each tool behind More is for, since a name alone does not', () => {
    for (const t of panelLayout(tabs).more) expect(PANEL_HELP[t.id] ?? '').not.toBe('');
  });

  it('leaves a support session’s three tabs alone', () => {
    // RC-SUP-03 already reduced that room to Chat, Files and Session; hiding
    // one of three would be hiding a third of a panel to save nothing.
    const support = [{ id: 'Chat' }, { id: 'Files' }, { id: 'Session' }];

    expect(panelLayout(support, { support: true })).toEqual({ tabs: support, more: [] });
  });

  it('draws no More tab when there is nothing to put in it', () => {
    expect(panelLayout([{ id: 'Chat' }, { id: 'People' }]).more).toEqual([]);
  });

  it('skips a tab this meeting does not have rather than inventing one', () => {
    expect(panelLayout([{ id: 'Chat' }, { id: 'Files' }]).tabs.map((t) => t.id)).toEqual(['Chat']);
  });
});

describe('who reads a message', () => {
  it('offers the two destinations that exist, each saying who sees it', () => {
    expect(AUDIENCES.map((a) => a.id)).toEqual(['all', 'staff']);
    expect(AUDIENCES.every((a) => a.help.length > 0)).toBe(true);
    expect(audienceOf('staff').help).toMatch(/Hidden from guests/);
  });

  it('never points at a destination this meeting has not got', () => {
    // A meeting with no workspace conversation has no Staff only to choose.
    const onlyEveryone = AUDIENCES.filter((a) => a.id !== 'staff');

    expect(audienceOf('staff', onlyEveryone).id).toBe('all');
  });
});
