// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MenuItem, MenuSection } from '../../../src/components/Menu';
import { setLanguage } from '../../../src/core/i18n';
import { CoreCallControls, entriesToSections } from '../../../src/modules/calls/ui/CoreCallControls';
import { viewSection } from '../../../src/modules/calls/ui/CallWorkspace';
import { callUi } from '../../../src/modules/calls/ui/state';
import { meetMoreSections, type MeetMenuActions, type MeetMenuState } from '../../../src/modules/meet/moreMenu';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({})), on: vi.fn(() => () => undefined), isMac: false, errorMessage: (e: unknown) => String(e) }));

afterEach(() => {
  cleanup();
  setLanguage('en');
});

function state(over: Partial<MeetMenuState> = {}): MeetMenuState {
  return {
    role: 'host',
    canManage: true,
    settings: { recording: true, record: 'host', transcription: true },
    mayRecord: true,
    mayStopRecording: true,
    recordingActive: false,
    recordingCommand: 'idle',
    recordHint: 'On the server · grid · 1080p',
    recordingMine: false,
    mayTranscribe: true,
    transcribingHere: false,
    transcribingElsewhere: null,
    locked: false,
    boardOnStage: false,
    controlling: null,
    words: { hostControls: 'Host controls', qa: 'Q&A', polls: 'Polls' },
    ...over,
  };
}

function actions(): MeetMenuActions {
  return {
    releaseControl: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    recordingSettings: vi.fn(),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    setLocked: vi.fn(),
    hostControls: vi.fn(),
    livestreaming: vi.fn(),
    panel: vi.fn(),
    toggleBoardOnStage: vi.fn(),
    copyLink: vi.fn(),
  };
}

const flat = (sections: MenuSection[]): MenuItem[] => sections.flatMap((s) => s.items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])]));
const item = (sections: MenuSection[], id: string) => flat(sections).find((i) => i.id === id);

describe('the meeting More menu (#124)', () => {
  it('groups into Meeting Tools and Host Controls, with secondary options in submenus', () => {
    const m = meetMoreSections(state(), actions());
    expect(m.map((s) => s.label)).toEqual(['Meeting Tools', 'Host Controls']);
    expect(m[0]!.items.map((i) => i.id)).toEqual(['recording', 'transcription', 'activities', 'info']);
    expect(m[1]!.items.map((i) => i.id)).toEqual(['host-controls', 'lock', 'livestream', 'recording-settings']);
    expect(flat(item(m, 'activities')!.submenu!).map((i) => i.id)).toEqual(['qa', 'polls', 'notes', 'files', 'board']);
    expect(flat(item(m, 'info')!.submenu!).map((i) => i.id)).toEqual(['details', 'link', 'room-settings']);
  });

  it('keeps every old item: each one still does what it did', () => {
    const a = actions();
    const m = meetMoreSections(state({ controlling: 'Nimal' }), a);
    const run = (id: string) => item(m, id)!.onSelect!();
    expect(m[0]!.items[0]).toMatchObject({ id: 'release', label: 'Release Control', description: 'Of Nimal’s computer', danger: true });
    run('release');
    run('recording');
    run('transcription');
    run('qa');
    run('polls');
    run('notes');
    run('files');
    run('board');
    run('details');
    run('link');
    run('room-settings');
    run('host-controls');
    run('lock');
    run('livestream');
    run('recording-settings');
    expect(a.releaseControl).toHaveBeenCalled();
    expect(a.startRecording).toHaveBeenCalled();
    expect(a.startTranscription).toHaveBeenCalled();
    expect(vi.mocked(a.panel).mock.calls.map((c) => c[0])).toEqual(['Q&A', 'Polls', 'Notes', 'Files', 'Info', 'Settings']);
    expect(a.toggleBoardOnStage).toHaveBeenCalled();
    expect(a.copyLink).toHaveBeenCalled();
    expect(a.hostControls).toHaveBeenCalled();
    expect(a.setLocked).toHaveBeenCalledWith(true);
    expect(a.livestreaming).toHaveBeenCalled();
    expect(a.recordingSettings).toHaveBeenCalled();
  });

  it('says what each stateful item will do now', () => {
    const idle = meetMoreSections(state(), actions());
    expect(item(idle, 'recording')).toMatchObject({ label: 'Start Recording', description: 'On the server · grid · 1080p', disabled: false });
    expect(item(idle, 'transcription')!.label).toBe('Start Transcription…');
    expect(item(idle, 'lock')).toMatchObject({ label: 'Lock Meeting', icon: 'lock' });
    expect(item(idle, 'board')!.checked).toBe(false);

    const a = actions();
    const live = meetMoreSections(state({ recordingActive: true, recordingMine: true, transcribingHere: true, locked: true, boardOnStage: true }), a);
    expect(item(live, 'recording')).toMatchObject({ label: 'Stop Recording', danger: true, description: 'It is finished and uploaded to your Drive after' });
    expect(item(live, 'transcription')).toMatchObject({ label: 'Stop Transcription', danger: true });
    expect(item(live, 'lock')).toMatchObject({ label: 'Unlock Meeting', icon: 'unlock' });
    expect(item(live, 'board')!.checked).toBe(true);
    item(live, 'recording')!.onSelect!();
    item(live, 'transcription')!.onSelect!();
    item(live, 'lock')!.onSelect!();
    expect(a.stopRecording).toHaveBeenCalled();
    expect(a.stopTranscription).toHaveBeenCalled();
    expect(a.setLocked).toHaveBeenCalledWith(false);

    expect(item(meetMoreSections(state({ recordingCommand: 'starting' }), actions()), 'recording')).toMatchObject({ label: 'Starting Recording…', disabled: true });
    expect(item(meetMoreSections(state({ recordingActive: true, recordingCommand: 'stopping' }), actions()), 'recording')).toMatchObject({ label: 'Stopping Recording…', disabled: true });
    // After a failed command it can be tried again.
    expect(item(meetMoreSections(state({ recordingCommand: 'error' }), actions()), 'recording')!.disabled).toBe(false);
  });

  it('shows a participant or a guest no host controls at all, not even disabled (#348)', () => {
    const m = meetMoreSections(state({ role: 'participant', canManage: false, mayRecord: false, mayStopRecording: false, mayTranscribe: false }), actions());
    expect(m.map((s) => s.label)).toEqual(['Meeting Tools']);
    for (const id of ['lock', 'recording', 'transcription', 'host-controls', 'livestream', 'recording-settings']) expect(item(m, id)).toBeUndefined();
    expect(m[0]!.items.map((i) => i.id)).toEqual(['activities', 'info']);
    // Everybody keeps the activities and the meeting's info.
    expect(item(m, 'qa')!.disabled).toBeUndefined();
    expect(item(m, 'link')!.disabled).toBeUndefined();

    const locked = meetMoreSections(state({ role: 'participant', canManage: false, locked: true, mayRecord: false, mayStopRecording: false, mayTranscribe: false, recordingActive: true, transcribingElsewhere: { by: 'Kamala' } }), actions());
    expect(item(locked, 'lock')).toBeUndefined();
    expect(item(locked, 'recording')).toBeUndefined();
    expect(item(locked, 'transcription')).toBeUndefined();
  });

  it('explains recording and transcription turned off for the meeting, and co-host recording', () => {
    const off = meetMoreSections(state({ settings: { recording: false, transcription: false }, mayRecord: false, mayTranscribe: false }), actions());
    expect(item(off, 'recording')!.reason).toBe("Recording isn't turned on for this meeting");
    expect(item(off, 'transcription')!.reason).toBe("Transcription isn't turned on for this meeting");
    const cohost = meetMoreSections(state({ role: 'cohost', settings: { recording: true, record: 'host' }, mayRecord: false, mayStopRecording: false }), actions());
    expect(item(cohost, 'recording')).toMatchObject({ disabled: true, reason: 'Only the host can record this meeting' });
    // A running recording a co-host may still stop after recording was turned off.
    const stoppable = meetMoreSections(state({ role: 'cohost', settings: { recording: false }, mayRecord: false, mayStopRecording: true, recordingActive: true }), actions());
    expect(item(stoppable, 'recording')).toMatchObject({ label: 'Stop Recording', disabled: false });
    expect(item(stoppable, 'recording-settings')).toBeDefined();
  });

  it('says who is transcribing when it is someone else', () => {
    const m = meetMoreSections(state({ transcribingElsewhere: { by: 'Kamala' } }), actions());
    expect(item(m, 'transcription')).toMatchObject({ label: 'Stop Transcription', disabled: true, reason: 'Kamala is transcribing; only they can stop it' });
    const anon = meetMoreSections(state({ transcribingElsewhere: { by: null } }), actions());
    expect(item(anon, 'transcription')!.reason).toBe('Someone else is transcribing; only they can stop it');
  });

  it('is translated: the stateful labels and reasons in Sinhala and Tamil', () => {
    setLanguage('si');
    const si = meetMoreSections(state({ locked: true, transcribingHere: true, role: 'cohost', mayRecord: false, mayStopRecording: false }), actions());
    expect(si.map((s) => s.label)).toEqual(['රැස්වීම් මෙවලම්', 'සත්කාරක පාලන']);
    expect(item(si, 'lock')!.label).toBe('රැස්වීමේ අගුළු අරින්න');
    expect(item(si, 'transcription')!.label).toBe('පිටපත් කිරීම නවත්වන්න');
    setLanguage('ta');
    const ta = meetMoreSections(state(), actions());
    expect(item(ta, 'recording')!.label).toBe('பதிவைத் தொடங்கு');
    expect(viewSection(view({ fullscreen: true })).items.find((i) => i.id === 'fullscreen')!.label).toBe('முழுத் திரையிலிருந்து வெளியேறு');
  });
});

function view(over: Partial<Parameters<typeof viewSection>[0]> = {}): Parameters<typeof viewSection>[0] {
  return {
    primary: false,
    layoutMode: 'auto',
    layouts: [
      { mode: 'auto', label: 'Auto', hint: 'Speaker for two, a grid for more' },
      { mode: 'grid', label: 'Grid', hint: 'Everybody the same size' },
    ],
    selfView: true,
    mirror: false,
    fill: true,
    pip: true,
    fullscreen: false,
    toggleFullscreen: vi.fn(),
    float: vi.fn(),
    ...over,
  };
}

describe('View & Layout', () => {
  it('has the layout and video options as submenus, full screen saying which way, and the floating window', () => {
    const v = viewSection(view());
    expect(v.label).toBe('View & Layout');
    expect(v.items.map((i) => i.id)).toEqual(['layout', 'video', 'fullscreen', 'float']);
    expect(v.items[0]!.description).toBe('Auto');
    expect(flat(v.items[0]!.submenu!).map((i) => [i.label, i.radio, i.checked])).toEqual([
      ['Auto', true, true],
      ['Grid', true, false],
    ]);
    expect(flat(v.items[1]!.submenu!).map((i) => [i.id, i.checked])).toEqual([
      ['self', true],
      ['mirror', false],
      ['fill', true],
      ['pip', true],
    ]);
    expect(v.items[2]).toMatchObject({ label: 'Enter Full Screen', shortcut: 'F11', icon: 'fullscreen' });
    expect(viewSection(view({ fullscreen: true })).items[2]).toMatchObject({ label: 'Exit Full Screen', icon: 'fullscreen-exit' });
  });

  it('changes the call surface as before', () => {
    const v = viewSection(view());
    flat(v.items[0]!.submenu!).find((i) => i.id === 'grid')!.onSelect!();
    expect(callUi.get().layoutMode).toBe('grid');
    flat(v.items[1]!.submenu!).find((i) => i.id === 'mirror')!.onSelect!();
    expect(callUi.get().mirror).toBe(true);
    flat(v.items[1]!.submenu!).find((i) => i.id === 'fill')!.onSelect!();
    expect(callUi.get().fit).toBe('fit');
  });
});

describe('the call controls with the More menu', () => {
  it('turns the flat lists (sharing, leaving) into sections at each heading or separator', () => {
    const s = entriesToSections([{ heading: 'Sharing' }, { label: 'Pause', onClick: vi.fn() }, 'sep', { label: 'Stop', danger: true, onClick: vi.fn() }], 'share');
    expect(s.map((x) => [x.label, x.items.map((i) => i.label)])).toEqual([
      ['Sharing', ['Pause']],
      [undefined, ['Stop']],
    ]);
  });

  it('opens More above the bar with its groups, from a click or the arrow keys, and goes back to the button', () => {
    const onHold = vi.fn();
    const sections = [...meetMoreSections(state({ role: 'participant', canManage: false, mayRecord: false, mayStopRecording: false, mayTranscribe: false }), actions()), viewSection(view())];
    render(<CoreCallControls buttons={[{ id: 'more', icon: 'more', label: 'More', sections }]} end={{ label: 'Leave', onClick: vi.fn(), menu: [{ label: 'End for everyone', onClick: vi.fn() }] }} visible compact={false} onHold={onHold} />);
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.keyDown(more, { key: 'ArrowUp' });
    const menu = screen.getByRole('menu', { name: 'More' });
    expect(onHold).toHaveBeenLastCalledWith(true);
    const headings = within(menu)
      .getAllByRole('group')
      .map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent);
    // A participant has no Host Controls group, and no Lock Meeting to see greyed out (#348).
    expect(headings).toEqual(['Meeting Tools', 'View & Layout']);
    expect(within(menu).queryByRole('menuitem', { name: 'Lock Meeting' })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(onHold).toHaveBeenLastCalledWith(false);

    // The leave menu is a menu too.
    fireEvent.click(screen.getByRole('button', { name: 'More ways to leave' }));
    expect(screen.getByRole('menuitem', { name: 'End for everyone' })).toBeTruthy();
  });
});
